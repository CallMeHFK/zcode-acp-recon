#!/usr/bin/env node
/**
 * build-fixtures.mjs — Phase 3 evidence-chain bridge: golden trace -> contract fixture.
 *
 * Reads the Phase 0 sanitized traces (traces/*.sanitized.json) and emits compact
 * replay scripts under contract/fixtures/. Each fixture records the source trace
 * SHA-256, and `--check` re-derives every fixture and compares it byte-for-byte
 * with what is committed — so a stale or hand-edited fixture is caught.
 *
 * Nothing here talks to the network and nothing reads live credentials: traces
 * are already redacted by probe/redact.mjs (G11). Session ids, the probe's
 * workspace path and the user's ZCode home prefix are canonicalised into
 * <CWD> / <ZCODE_HOME> tokens (the fake backend substitutes them at runtime).
 * Other absolute paths inherited from the sanitized traces may remain; the
 * fork-facing contract manifest contains none of them.
 *
 * Usage:
 *   node contract/build-fixtures.mjs           # regenerate
 *   node contract/build-fixtures.mjs --check  # verify committed fixtures are derivable
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TRACES = path.join(ROOT, "traces");
const OUT = path.join(ROOT, "contract", "fixtures");

/** The eight Phase 0 scenarios (probe/suite.mjs + reports/suite-results.json). */
const SCENARIOS = [
  { name: "normal", trace: "normal.sanitized.json", terminal: "success" },
  { name: "permission-allow", trace: "permission-allow.sanitized.json", terminal: "success" },
  { name: "permission-deny", trace: "permission-deny.sanitized.json", terminal: "success" },
  { name: "cancel", trace: "cancel.sanitized.json", terminal: "cancelled" },
  // crash / disconnect deliberately have NO terminal event: the backend was
  // killed or the client went away mid-turn. That absence IS the evidence.
  { name: "crash", trace: "crash.sanitized.json", terminal: "none" },
  { name: "resume-graceful", trace: "resume-graceful.sanitized.json", terminal: "success" },
  { name: "resume-force", trace: "resume-force.sanitized.json", terminal: "success" },
  { name: "disconnect", trace: "disconnect-probe.sanitized.json", terminal: "none" },
];

const isAsk = (r) => typeof r.id === "string" && String(r.id).startsWith("server-") && !!r.method;
const isRequest = (r) => typeof r.id === "number" && !!r.method;
const isAnswer = (r) => r.id !== undefined && !r.method && ("result" in r || "error" in r);
const isNotification = (r) => r.id === undefined && !!r.method;

/**
 * Machine-independent home canonicalisation: derive the prefix FROM THE TRACE
 * STRING, never from os.homedir()/USERPROFILE. An earlier version used the
 * generating machine's home, which made `--check` fail on any other user/CI
 * host (review should-fix #1). `[\\/]+` also covers the doubled backslashes
 * found inside escaped commandDisplay strings.
 */
const HOME_PATH_RE = /[A-Za-z]:[\\/]+Users[\\/]+[^\\/]+[\\/]+\.zcode/gi;

/**
 * Canonicalise a frame:
 *  - every recorded session/turn id -> one stable id;
 *  - the probe's absolute workspace path -> <CWD>;
 *  - any user's home prefix + ".zcode" -> <ZCODE_HOME>;
 *  - drop the probe's own bookkeeping fields.
 * The fake backend substitutes the tokens with the isolated test paths.
 */
function canonicalise(value, sid, cwdTokens) {
  if (typeof value === "string") {
    let s = value.replace(/sess_[0-9a-f-]{20,}/gi, sid).replace(/turn_[0-9a-f-]{20,}/gi, "turn_contract");
    for (const token of cwdTokens) if (token) s = s.split(token).join("<CWD>");
    s = s.replace(HOME_PATH_RE, "<ZCODE_HOME>");
    return s;
  }
  if (Array.isArray(value)) return value.map((v) => canonicalise(v, sid, cwdTokens));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "trace" || k === "ts" || k === "dir") continue;
      out[k] = canonicalise(v, sid, cwdTokens);
    }
    return out;
  }
  return value;
}

/** Collect every workspace-ish absolute path present in a trace. */
function workspaceTokens(records) {
  const tokens = new Set();
  const visit = (v) => {
    if (typeof v === "string") {
      const m = v.match(/[A-Za-z]:\\Users\\[^"']*?traces[\\/]workspace/);
      if (m) tokens.add(m[0]);
    } else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") Object.values(v).forEach(visit);
  };
  records.forEach(visit);
  return [...tokens];
}

/**
 * First recorded result for each outbound method. Pair POSITIONALLY: numeric
 * request ids also restart across connections in a merged trace, so a global
 * id -> method map would mis-attribute a response.
 */
function firstResults(records, sid, tokens) {
  const results = {};
  for (let i = 0; i < records.length; i++) {
    const req = records[i];
    if (!isRequest(req)) continue;
    if (results[req.method] !== undefined) continue;
    for (let j = i + 1; j < records.length; j++) {
      const a = records[j];
      if (!isAnswer(a) || String(a.id) !== String(req.id)) continue;
      if (!a.error) results[req.method] = canonicalise(a.result ?? {}, sid, tokens);
      break;
    }
  }
  return results;
}

/**
 * All host-inbound asks paired with their recorded answers.
 *
 * `server-N` ids RESTART on every new backend connection, and a merged trace
 * can hold several connections. Pair positionally: the first matching answer
 * AFTER the ask. An ask with no later answer is genuinely unanswered (backend
 * killed) and is recorded with answered:false rather than being invented.
 */
function hostAsks(records, sid, tokens) {
  const seen = new Set();
  const asks = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (!isAsk(r)) continue;
    let answer = null;
    for (let j = i + 1; j < records.length; j++) {
      const a = records[j];
      if (isAnswer(a) && String(a.id) === String(r.id)) {
        answer = a.result ?? a.error ?? {};
        break;
      }
    }
    const options = Array.isArray(r.params?.options)
      ? r.params.options.map((o) => o?.kind ?? o?.optionId).filter(Boolean)
      : undefined;
    const signature = r.method + "|" + JSON.stringify(options ?? {}) + "|" + JSON.stringify(answer);
    if (seen.has(signature)) continue;
    seen.add(signature);
    asks.push({
      id: String(r.id),
      method: r.method,
      params: canonicalise(r.params ?? {}, sid, tokens),
      answer: answer === null ? null : canonicalise(answer, sid, tokens),
      answered: answer !== null,
      ...(options ? { options } : {}),
    });
  }
  return asks;
}

/** Split session/event records into turns (seq resets to 1 on a new turn). */
function eventTurns(records) {
  const turns = [];
  let current = [];
  for (const r of records) {
    if (r.method !== "session/event" || !isNotification(r)) continue;
    const seq = Number(r.params?.seq ?? 0);
    if (seq === 1 && current.length) {
      turns.push(current);
      current = [];
    }
    current.push(r);
  }
  if (current.length) turns.push(current);
  return turns;
}

const terminalOf = (turn) => {
  const last = [...turn].reverse().find(
    (r) => r.params?.type === "turn.completed" || r.params?.type === "turn.failed",
  );
  return last?.params?.payload?.resultType ?? (last?.params?.type === "turn.failed" ? "error" : "success");
};

/** Pick the target turn and emit replay frames, preserving the ORIGINAL seq. */
function targetTurnEvents(records, wanted, sid, tokens) {
  const turns = eventTurns(records);
  const matches = (t) => wanted === "any" || wanted === "none" || terminalOf(t) === wanted;
  const turn = [...turns].reverse().find(matches) ?? turns[turns.length - 1] ?? [];
  return turn.map((r) => ({
    method: "session/event",
    sourceSeq: Number(r.params?.seq ?? 0),
    params: canonicalise({ ...r.params, sessionId: sid }, sid, tokens),
  }));
}

/** Build the ordered replay steps the fake backend executes. */
function buildSteps(records, fixture, sid, tokens, scenario) {
  const results = fixture.results;
  const asks = fixture.hostAsks;
  const pickAsk = (method) => asks.find((a) => a.method === method && a.answered);
  const asFrame = (a) => ({ id: a.id, method: a.method, params: a.params });

  const prefs = pickAsk("session/requestRuntimePreferences");
  const mcp = pickAsk("interaction/requestOfficialMcpAuthHeaders");
  const headers = pickAsk("interaction/requestProviderRuntimeHeaders");
  const permission = pickAsk("interaction/requestPermission");

  const findNotif = (method, predicate) =>
    records.find((r) => r.method === method && isNotification(r) && predicate(r.params));
  // Only emit notifications that literally exist in the golden trace: no
  // fabricated state.updated frames.
  const notif = (r) =>
    r ? { method: r.method, params: canonicalise({ ...r.params, sessionId: sid }, sid, tokens) } : null;
  const lifecycle = notif(findNotif("session/lifecycle/changed", (p) => p?.state === "ready"));
  const stateRunning = notif(findNotif("state.updated", (p) => p?.patch?.status === "running"));
  const stateIdle = notif(findNotif("state.updated", (p) => p?.patch?.status === "idle"));

  const steps = [];
  // provider/updateAccountConfig is intentionally NOT a sequential step: it is
  // best-effort (a headless install with no credentials never sends it), and
  // putting a timeout-gated step first stalled the whole replay while every
  // real request arrived and was answered out of order (review B1). The fake
  // backend answers it from fixture.results as an unscripted request instead.
  const createEmit = [lifecycle, prefs && asFrame(prefs), mcp && asFrame(mcp)].filter(Boolean);
  steps.push({
    on: "session/create",
    timeout: 15000,
    emit: createEmit,
    waitAnswers: prefs ? [prefs.id] : [],
    reply: results["session/create"] ?? {},
  });

  steps.push({
    on: "session/subscribe",
    optional: true,
    // Same budget as the other scripted steps: a hot waiter expiry on a slow
    // CI host would generic-reply a scripted method and fail the L2 gate.
    timeout: 15000,
    emit: [],
    reply: results["session/subscribe"] ?? {},
  });

  // Golden trace order: session/send request -> host asks -> state.updated
  // running -> session/send RESPONSE -> the turn's event stream. Split into two
  // steps so the response is actually sent before the events.
  const sendEmit = [stateRunning, headers && asFrame(headers), permission && asFrame(permission)].filter(Boolean);
  steps.push({
    on: "session/send",
    timeout: 15000,
    emit: sendEmit,
    // The runtime-headers responder answers at frame arrival. A PERMISSION
    // ask is different: the adapter only polls its server-request queue once
    // the turn's event stream starts, so waiting for it here would deadlock.
    waitAnswers: [headers?.id].filter(Boolean),
    reply: results["session/send"] ?? {},
  });

  const eventEmit = [...fixture.turnEvents.map((e) => ({ method: e.method, params: e.params })), stateIdle].filter(Boolean);
  steps.push({
    // Auto step: no request to wait for. Preserves the emit order above.
    emit: eventEmit,
    ...(permission ? { waitAnswersBeforeTerminal: [permission.id] } : {}),
    // Give the ACP client time to send session/cancel so the adapter's
    // request-form session/stop is observable in the cancel scenario.
    ...(scenario.name === "cancel" ? { pauseBeforeLastEmit: 2500 } : {}),
  });

  if (fixture.contract.expectedTerminal === "none") {
    // The golden trace has no terminal event because the backend was killed /
    // disconnected. The HARNESS needs one to close the ACP turn; it is marked
    // non-success and L1/L2 never treat it as an observed product outcome.
    steps.push({
      syntheticTerminal: true,
      emit: [
        {
          method: "session/event",
          params: {
            sessionId: sid,
            seq: 900,
            deliveryKind: "desktop-continuous",
            type: "turn.completed",
            payload: { response: "", resultType: "harness_closed", toolCallCount: 0 },
          },
        },
      ],
    });
  }
  return steps;
}

/** Derive one fixture (pure: no writes) so --check can compare deterministically. */
function derive(s) {
  const tracePath = path.join(TRACES, s.trace);
  const raw = fs.readFileSync(tracePath);
  const trace = JSON.parse(raw.toString("utf8"));
  const records = trace.records ?? [];
  const sid = `sess_contract_${s.name.replace(/-/g, "_")}`;
  const tokens = workspaceTokens(records);

  const fixture = {
    schema: 1,
    scenario: s.name,
    source: {
      trace: `traces/${s.trace}`,
      sha256: crypto.createHash("sha256").update(raw).digest("hex"),
      records: records.length,
      metadata: trace.metadata ?? {},
    },
    sessionId: sid,
    results: firstResults(records, sid, tokens),
    hostAsks: hostAsks(records, sid, tokens),
    turnEvents: targetTurnEvents(records, s.terminal, sid, tokens),
    contract: {
      expectedTerminal: s.terminal,
      syntheticTerminal: s.terminal === "none",
      seqContinuous: true,
      stopMustBeRequest: true,
      stdoutMustBeJsonLines: true,
    },
  };
  fixture.steps = buildSteps(records, fixture, sid, tokens, s);
  return fixture;
}

function main() {
  const check = process.argv.includes("--check");
  if (!check) fs.mkdirSync(OUT, { recursive: true });
  const manifest = { schema: 1, generatedAt: new Date().toISOString(), fixtures: [] };
  let drift = 0;

  for (const s of SCENARIOS) {
    const fixture = derive(s);
    const text = JSON.stringify(fixture, null, 2) + "\n";
    const file = path.join(OUT, `${s.name}.json`);
    if (check) {
      const committed = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      const same = committed === text;
      if (!same) drift++;
      console.log(`${same ? "OK  " : "DRIFT"} ${s.name}`);
    } else {
      fs.writeFileSync(file, text);
    }
    const syntheticFrameCount = fixture.steps
      .filter((step) => step.syntheticTerminal)
      .reduce((n, step) => n + (step.emit?.length ?? 0), 0);
    manifest.fixtures.push({
      scenario: s.name,
      file: `contract/fixtures/${s.name}.json`,
      sha256: crypto.createHash("sha256").update(Buffer.from(text)).digest("hex"),
      sourceSha256: fixture.source.sha256,
      records: fixture.source.records,
      hostAsks: fixture.hostAsks.length,
      turnEvents: fixture.turnEvents.length,
      syntheticFrameCount,
    });
    if (!check) {
      console.log(
        `${s.name.padEnd(20)} records=${String(fixture.source.records).padStart(4)} ` +
          `results=${Object.keys(fixture.results).length} asks=${fixture.hostAsks.length} ` +
          `turnEvents=${fixture.turnEvents.length} steps=${fixture.steps.length} synthetic=${syntheticFrameCount}`,
      );
    }
  }
  if (check) {
    const manifestPath = path.join(OUT, "manifest.json");
    const committed = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : null;
    const comparable = (m) => JSON.stringify({ schema: m?.schema, fixtures: m?.fixtures });
    const manifestOk = committed && comparable(committed) === comparable(manifest);
    console.log(`manifest: ${manifestOk ? "OK" : "DRIFT"} (ignored generatedAt)`);
    if (drift || !manifestOk) {
      console.error(`--check FAILED: ${drift} fixture(s) + ${manifestOk ? 0 : 1} manifest drifted`);
      process.exit(1);
    }
    console.log("--check PASS: all fixtures are byte-for-byte derivable from the traces");
    return;
  }
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`manifest: ${manifest.fixtures.length} fixtures`);
}

main();
