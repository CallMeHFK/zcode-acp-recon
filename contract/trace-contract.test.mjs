/**
 * Layer 1 — golden-trace contract assertions (no adapter, no network).
 *
 * Verifies the Phase 0 EVIDENCE ITSELF, not just the derived fixture: seq
 * contiguity and terminal presence/absence are asserted against the raw
 * traces/*.sanitized.json records, host asks are re-paired independently, and
 * build-fixtures.mjs --check proves every committed fixture is byte-for-byte
 * derivable from those traces.
 *
 * Run: node --test contract/trace-contract.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIX = path.join(ROOT, "contract", "fixtures");
const manifest = JSON.parse(fs.readFileSync(path.join(FIX, "manifest.json"), "utf8"));

const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const load = (name) => JSON.parse(fs.readFileSync(path.join(FIX, `${name}.json`), "utf8"));
const traceOf = (fx) => JSON.parse(fs.readFileSync(path.join(ROOT, fx.source.trace), "utf8"));
const scenarios = manifest.fixtures.map((f) => f.scenario);

// Independent re-implementation of the trace semantics used by the builder.
const isAsk = (r) => typeof r.id === "string" && String(r.id).startsWith("server-") && !!r.method;
const isAnswer = (r) => r.id !== undefined && !r.method && ("result" in r || "error" in r);
const isTerminal = (r) => ["turn.completed", "turn.failed"].includes(r.params?.type);

function rawTurns(trace) {
  const turns = [];
  let current = [];
  for (const r of trace.records) {
    if (r.method !== "session/event" || r.id !== undefined) continue;
    if (Number(r.params?.seq ?? 0) === 1 && current.length) {
      turns.push(current);
      current = [];
    }
    current.push(r);
  }
  if (current.length) turns.push(current);
  return turns;
}

function rawAskPairs(trace) {
  const out = [];
  for (let i = 0; i < trace.records.length; i++) {
    const r = trace.records[i];
    if (!isAsk(r)) continue;
    let answer = null;
    for (let j = i + 1; j < trace.records.length; j++) {
      const a = trace.records[j];
      if (isAnswer(a) && String(a.id) === String(r.id)) {
        answer = a.result ?? a.error ?? {};
        break;
      }
    }
    out.push({ method: r.method, answered: answer !== null, answer });
  }
  return out;
}

test("evidence chain: --check proves every fixture is derivable from the traces", () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, "contract", "build-fixtures.mjs"), "--check"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60000,
  });
  assert.equal(r.status, 0, `--check failed:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /--check PASS/);
});

test("evidence chain: every fixture matches its recorded SHA-256", () => {
  for (const entry of manifest.fixtures) {
    assert.equal(sha(path.join(ROOT, entry.file)), entry.sha256, `${entry.scenario} fixture drift`);
    const fx = load(entry.scenario);
    assert.equal(sha(path.join(ROOT, fx.source.trace)), entry.sourceSha256, `${entry.scenario} source trace drift`);
  }
});

test("evidence chain: fixture record counts and trace metadata are genuine", () => {
  for (const entry of manifest.fixtures) {
    const fx = load(entry.scenario);
    const trace = traceOf(fx);
    assert.equal(trace.records.length, fx.source.records, entry.scenario);
    // Assert the evidence's own provenance fields, not a self-comparison.
    assert.equal(typeof trace.metadata?.captureTimestamp, "string", `${entry.scenario}: captureTimestamp`);
    assert.equal(trace.metadata?.evidenceLevel, "observed", `${entry.scenario}: evidenceLevel`);
    assert.equal(trace.metadata?.redactionVersion, "1", `${entry.scenario}: redactionVersion`);
    assert.equal(trace.metadata?.os, "win32");
    assert.equal(trace.metadata?.zcodeVersion, "0.17.1");
  }
});

test("fixtures carry no live credentials (G11 redaction survived)", () => {
  for (const name of scenarios) {
    const raw = fs.readFileSync(path.join(FIX, `${name}.json`), "utf8");
    assert.doesNotMatch(raw, /eyJ[A-Za-z0-9_-]{20,}/, `${name}: JWT leaked`);
    assert.doesNotMatch(raw, /Bearer\s+[A-Za-z0-9._-]{20,}/, `${name}: bearer token leaked`);
    assert.doesNotMatch(raw, /"apiKey"\s*:\s*"(?!<redacted>)[^"]{24,}"/, `${name}: apiKey leaked`);
  }
});

test("fork-facing manifest has no absolute user paths", () => {
  const p = path.join(FIX, "contract-manifest.json");
  assert.ok(fs.existsSync(p), "run export-manifest.mjs first (run.mjs does it)");
  const raw = fs.readFileSync(p, "utf8");
  assert.doesNotMatch(raw, /[A-Za-z]:[\\/]Users[\\/]/, "manifest leaked a machine home path");
  assert.doesNotMatch(raw, /eyJ[A-Za-z0-9_-]{20,}/, "manifest leaked a JWT");
});

test("host asks in fixtures match an independent re-pairing of the raw traces", () => {
  for (const name of scenarios) {
    const fx = load(name);
    const raw = rawAskPairs(traceOf(fx));
    const methods = [...new Set(fx.hostAsks.map((a) => a.method))];
    for (const method of methods) {
      const fixtureAsk = fx.hostAsks.find((a) => a.method === method);
      const rawFirst = raw.find((a) => a.method === method);
      assert.ok(rawFirst, `${name}: ${method} not present in the raw trace`);
      assert.equal(fixtureAsk.answered, rawFirst.answered, `${name}: ${method} answered flag`);
    }
    // No ask in the fixture claims an answer that the raw trace never gave.
    for (const a of fx.hostAsks.filter((x) => x.answered)) {
      assert.ok(raw.some((r) => r.method === a.method && r.answered), `${name}: invented ${a.method} answer`);
    }
  }
});

for (const name of scenarios) {
  test(`L1 ${name}: raw trace turn stream is contiguous and terminates as recorded`, () => {
    const fx = load(name);
    const trace = traceOf(fx);
    const turns = rawTurns(trace);
    assert.ok(turns.length > 0, "no session/event turns in the raw trace");
    const wanted = fx.contract.expectedTerminal;
    const terminalOf = (t) => {
      const last = [...t].reverse().find(isTerminal);
      return last?.params?.payload?.resultType ?? (last?.params?.type === "turn.failed" ? "error" : "success");
    };
    const target = wanted === "none" ? turns[turns.length - 1] : [...turns].reverse().find((t) => terminalOf(t) === wanted);
    assert.ok(target, `no turn with terminal=${wanted} in the raw trace`);
    target.forEach((r, i) => assert.equal(Number(r.params?.seq), i + 1, `raw seq gap at ${i}`));

    if (wanted === "none") {
      assert.ok(!target.some(isTerminal), "raw target turn unexpectedly has a terminal event");
      assert.equal(fx.contract.syntheticTerminal, true, "synthetic terminal must be declared");
    } else {
      const last = target[target.length - 1];
      assert.ok(isTerminal(last), `raw target turn has no terminal event (${last.params?.type})`);
      assert.equal(last.params?.payload?.resultType ?? "success", wanted, "raw terminal resultType mismatch");
    }
  });

  test(`L1 ${name}: fixture preserves every raw turn event in order`, () => {
    const fx = load(name);
    const trace = traceOf(fx);
    const turns = rawTurns(trace);
    const wanted = fx.contract.expectedTerminal;
    const terminalOf = (t) => {
      const last = [...t].reverse().find(isTerminal);
      return last?.params?.payload?.resultType ?? (last?.params?.type === "turn.failed" ? "error" : "success");
    };
    const target = wanted === "none" ? turns[turns.length - 1] : [...turns].reverse().find((t) => terminalOf(t) === wanted);
    assert.equal(fx.turnEvents.length, target.length, "fixture dropped or added turn events");
    fx.turnEvents.forEach((e, i) => {
      assert.equal(e.method, "session/event");
      assert.equal(e.params.type, target[i].params?.type, `event type changed at ${i}`);
      assert.equal(e.sourceSeq, i + 1, `sourceSeq not the raw seq at ${i}`);
      assert.equal(e.params.seq, i + 1, `replay seq gap at ${i}`);
      assert.equal(e.params.sessionId, fx.sessionId, "session id not canonicalised");
      assert.match(String(target[i].params?.sessionId ?? ""), /^sess_[0-9a-f-]{20,}$/i, "raw sessionId is not a real recorded id");
    });
    if (wanted === "none") {
      assert.ok(!fx.turnEvents.some((e) => isTerminal(e)), "fixture fabricated a terminal event");
    }
  });

  test(`L1 ${name}: host asks are correctly paired and never answered with an RPC error`, () => {
    const fx = load(name);
    assert.ok(fx.hostAsks.length > 0, "no host asks recorded");
    assert.ok(fx.hostAsks.some((a) => a.answered), "no answered host ask at all");
    for (const ask of fx.hostAsks) {
      assert.ok(String(ask.id).startsWith("server-"), `unexpected ask id ${ask.id}`);
      assert.ok(ask.method, "ask without method");
      assert.equal(typeof ask.answered, "boolean", "answered flag missing");
      if (ask.answered) {
        assert.ok(!("code" in (ask.answer ?? {})), `${ask.method} was answered with an error: ${JSON.stringify(ask.answer)}`);
      }
    }
  });
}

const answeredAsks = (fx, method) => fx.hostAsks.filter((a) => a.method === method && a.answered && a.answer);

test("L1 contract: runtime-preferences host answer carries the required flags", () => {
  let seen = 0;
  for (const name of scenarios) {
    for (const a of answeredAsks(load(name), "session/requestRuntimePreferences")) {
      seen++;
      assert.equal(typeof a.answer.memoryEnabled, "boolean", `${name}: memoryEnabled`);
      assert.equal(typeof a.answer.askUserQuestionAutoResolutionEnabled, "boolean", `${name}: autoResolution`);
    }
  }
  assert.ok(seen >= 6, `expected runtime-preference answers, got ${seen}`);
});

test("L1 contract: official MCP auth headers are answered with an empty object", () => {
  let seen = 0;
  let rawSeen = 0;
  for (const name of scenarios) {
    const fx = load(name);
    for (const a of answeredAsks(fx, "interaction/requestOfficialMcpAuthHeaders")) {
      seen++;
      assert.deepEqual(a.answer, {}, `${name}: golden host answer is {}`);
    }
    // Also assert against the RAW trace, independently of the fixture.
    for (const pair of rawAskPairs(traceOf(fx)).filter(
      (p) => p.method === "interaction/requestOfficialMcpAuthHeaders" && p.answered,
    )) {
      rawSeen++;
      assert.deepEqual(pair.answer, {}, `${name}: raw trace host answer is not {}`);
    }
  }
  assert.ok(seen >= 5, `expected MCP auth answers in the evidence, got ${seen}`);
  assert.ok(rawSeen >= seen, "raw trace has fewer MCP auth answers than the derived fixture");
});

test("L1 contract: provider runtime headers are answered with applied auth", () => {
  let seen = 0;
  for (const name of scenarios) {
    for (const a of answeredAsks(load(name), "interaction/requestProviderRuntimeHeaders")) {
      seen++;
      assert.equal(a.answer.headersApplied, true, `${name}: headersApplied`);
      assert.ok("requestAuth" in a.answer, `${name}: requestAuth missing`);
      assert.doesNotMatch(JSON.stringify(a.answer), /eyJ[A-Za-z0-9_-]{20,}/, "redaction failed");
    }
  }
  assert.ok(seen >= 3, `expected runtime-header answers, got ${seen}`);
});

test("L1 contract: permission options are the ACP-legal triple", () => {
  for (const name of ["permission-allow", "permission-deny"]) {
    const asks = answeredAsks(load(name), "interaction/requestPermission");
    assert.ok(asks.length > 0, `${name}: no answered permission ask`);
    for (const a of asks) {
      assert.ok(a.options.includes("allow_once"), "allow_once missing");
      assert.ok(a.options.includes("allow_always"), "allow_always missing");
      assert.ok(a.options.includes("deny"), "deny missing");
      assert.ok(typeof a.answer.optionId === "string", `no selected optionId: ${JSON.stringify(a.answer)}`);
    }
  }
  assert.deepEqual(answeredAsks(load("permission-allow"), "interaction/requestPermission")[0].answer, { optionId: "allow_once" });
  assert.deepEqual(answeredAsks(load("permission-deny"), "interaction/requestPermission")[0].answer, { optionId: "deny" });
});

test("L1 contract: session/stop is a request (with id) in the cancel evidence", () => {
  const trace = traceOf(load("cancel"));
  const stops = trace.records.filter((r) => r.method === "session/stop" && r.id !== undefined);
  assert.ok(stops.length > 0, "no request-form session/stop in the golden trace");
  const cancelled = trace.records.filter(
    (r) => r.method === "session/event" && r.params?.type === "turn.completed" && r.params?.payload?.resultType === "cancelled",
  );
  assert.ok(cancelled.length > 0, "no cancelled terminal event");
});

test("L1 contract: synthetic frames are declared and never success-shaped", () => {
  for (const entry of manifest.fixtures) {
    const fx = load(entry.scenario);
    const synthetic = fx.steps.filter((s) => s.syntheticTerminal);
    const frames = synthetic.flatMap((s) => s.emit ?? []);
    assert.equal(frames.length, entry.syntheticFrameCount, `${entry.scenario}: synthetic frame count mismatch`);
    if (fx.contract.expectedTerminal === "none") {
      assert.equal(fx.contract.syntheticTerminal, true);
      assert.ok(frames.length > 0, "interrupted turn needs a harness close frame");
      for (const f of frames) assert.notEqual(f.params?.payload?.resultType, "success", "synthetic frame fabricated success");
    } else {
      assert.equal(fx.contract.syntheticTerminal, false);
      assert.equal(frames.length, 0, `${entry.scenario}: unexpected synthetic frames`);
    }
  }
});
