/**
 * Layer 2 — adapter contract tests (hermetic, real adapter process).
 *
 * For each Phase 0 scenario the real adapter (dist/index.js) is launched with
 * ZCODE_BIN pointing at contract/fake-app-server.mjs, which replays the
 * fixture derived from that scenario's golden trace. Assertions cover the ACP
 * side (initialize / session-new / event order / stopReason / stdout discipline)
 * and the host side (the three host duties recorded in the golden trace), plus
 * the replay engine's OWN fidelity (scripted replies actually sent, no
 * scripted method answered generically, no missing host answers).
 *
 * No network, no live account, no reads of the user's real ZCode credentials:
 * ZCODE_HOME points at an isolated fixture tree.
 *
 * Run: node --test contract/adapter-contract.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAcp, updateKinds } from "./acp-client.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT = path.join(ROOT, "contract");
const FIX = path.join(CONTRACT, "fixtures");
const LOGS = path.join(CONTRACT, "logs");
const WORKSPACE = path.join(ROOT, "traces", "workspace");
const HOME = path.join(WORKSPACE, "contract-home", ".zcode");
const CWD = path.join(WORKSPACE, "contract-cwd");
const DIST = process.env.ZCODE_ACP_DIST ?? path.join(path.dirname(path.dirname(ROOT)), "zcode-acp", "dist");
const FAKE = path.join(CONTRACT, "fake-app-server.mjs");

const manifest = JSON.parse(fs.readFileSync(path.join(FIX, "manifest.json"), "utf8"));
const scenarios = manifest.fixtures.map((f) => f.scenario);
let runCounter = 0;

function prepare() {
  fs.mkdirSync(path.join(HOME, "v2"), { recursive: true });
  fs.mkdirSync(CWD, { recursive: true });
  fs.mkdirSync(LOGS, { recursive: true });
  // Plaintext entries are accepted verbatim by readCredentialStoreSync —
  // enough to exercise the OAuth/JWT path without touching real credentials.
  fs.writeFileSync(
    path.join(HOME, "v2", "credentials.json"),
    JSON.stringify({
      "oauth:bigmodel:access_token": "contract-fixture-oauth-token",
      zcodejwttoken: "contract-fixture-jwt.payload.signature",
    }) + "\n",
  );
}

function readLog(file) {
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function answersFrom(log) {
  const byId = new Map();
  for (const e of log) if (e.type === "answer") byId.set(e.id, e.answer);
  return byId;
}

/**
 * Run one scenario. `canonical:true` writes the stable log names consumed by
 * run.mjs; every other invocation gets a unique name so concurrent/subsequent
 * runs never clobber another run's evidence (review S6/N5).
 */
async function runScenario(name, extra = {}) {
  prepare();
  runCounter++;
  const label = extra.canonical ? name : `${name}-${runCounter}${extra.logSuffix ?? ""}`;
  const logFile = path.join(LOGS, `${label}.jsonl`);
  const acpFile = path.join(LOGS, `${label}-acp.jsonl`);
  if (fs.existsSync(logFile)) fs.rmSync(logFile);
  const env = {
    ZCODE_BIN: FAKE,
    ZCODE_FAKE_SCRIPT: path.join(FIX, `${name}.json`),
    ZCODE_FAKE_LOG: logFile,
    ZCODE_FAKE_CWD: CWD,
    ZCODE_HOME: HOME,
    ...extra.env,
  };
  const run = await runAcp({
    distDir: DIST,
    cwd: CWD,
    env,
    prompt: "Reply with exactly: OK",
    traceFile: acpFile,
    timeoutMs: 60000,
    ...extra.acp,
  });
  const log = fs.existsSync(logFile) ? readLog(logFile) : [];
  return { run, log, answers: answersFrom(log) };
}

const fixtureFor = (name) => JSON.parse(fs.readFileSync(path.join(FIX, `${name}.json`), "utf8"));
const scriptedMethods = (fx) => fx.steps.filter((s) => s.on).map((s) => s.on);

test("precondition: built adapter and fake backend exist", () => {
  assert.ok(fs.existsSync(path.join(DIST, "index.js")), `dist/index.js missing — run tsc in the fork (${DIST})`);
  assert.ok(fs.existsSync(FAKE));
});

for (const name of scenarios) {
  const fx = fixtureFor(name);
  const interrupted = fx.contract.expectedTerminal === "none";
  const title = interrupted
    ? `L2 ${name}: interrupted-turn harness close (no product outcome asserted)`
    : `L2 ${name}: ACP handshake, event order and stdout discipline`;
  test(title, async () => {
    const { run, log } = await runScenario(name, { canonical: true });
    assert.equal(run.fatal, null, `fatal: ${run.fatal}\nstderr: ${run.stderrTail.slice(-600)}`);
    assert.equal(run.initialize?.protocolVersion, 1);
    assert.ok(run.initialize?.hasAgentCapabilities);
    assert.ok(run.initialize?.authMethods.includes("ZCode built-in credentials"));
    assert.ok(run.sessionNew?.sessionId, "session/new returned no id");
    assert.deepEqual(run.nonJsonLines, [], "non-JSON line on adapter stdout (G9)");

    const kinds = updateKinds(run);
    if (interrupted) {
      // crash / disconnect traces contain no model output. The harness frame
      // exists only to close the turn; NO product outcome is asserted here.
      assert.ok(kinds.includes("session_info_update"), `no session_info_update: ${kinds.join(",")}`);
      assert.ok(log.some((e) => e.type === "syntheticTerminal"), "synthetic terminal was not declared");
    } else {
      assert.ok(kinds.includes("agent_message_chunk"), `no agent_message_chunk: ${kinds.join(",")}`);
      const expectedStop = fx.contract.expectedTerminal === "cancelled" ? "cancelled" : "end_turn";
      assert.equal(run.prompt?.stopReason, expectedStop, `stopReason=${run.prompt?.stopReason}`);
    }
    const infoAt = kinds.indexOf("session_info_update");
    const firstChunk = kinds.indexOf("agent_message_chunk");
    if (infoAt >= 0 && firstChunk >= 0) assert.ok(infoAt < firstChunk, "session_info_update must precede the first chunk");

    // ---- replay-engine fidelity (review B1/N1) ----
    assert.ok(!log.some((e) => e.type === "driverError"), "fake backend driver threw");
    const done = log.find((e) => e.type === "scriptComplete");
    assert.ok(done, "replay script did not complete");
    assert.ok(done.matchedSteps > 0, "no scripted step ever matched a real request");
    assert.equal(done.matchedSteps, done.expectedSteps, "some scripted steps were skipped");
    const generic = log.filter((e) => e.type === "genericReply").map((e) => e.method);
    for (const method of scriptedMethods(fx)) {
      assert.ok(!generic.includes(method), `scripted ${method} was answered out of order by genericReply`);
    }
    assert.ok(
      !log.some((e) => e.type === "missingAnswers"),
      "a recorded host ask went unanswered",
    );
    assert.ok(!log.some((e) => e.type === "duplicateAnswerId"), "duplicate server-N answer id collapsed");
    const answerEvents = log.filter((x) => x.type === "answers");
    assert.ok(answerEvents.length > 0, "no host answer was ever awaited (vacuous replay)");
    for (const e of answerEvents) {
      assert.equal(e.complete, true, `host answers incomplete for step ${e.index}`);
    }
    const scriptedReplies = log.filter((e) => e.type === "scriptedReply").map((e) => e.method);
    for (const method of scriptedMethods(fx)) {
      if (fx.steps.find((s) => s.on === method)?.reply !== undefined) {
        assert.ok(scriptedReplies.includes(method), `${method} reply was never sent by the replay engine`);
      }
    }
  });
}

test("L2 host duty: runtime preferences are answered with the bridge defaults", async () => {
  const { log, answers } = await runScenario("normal", { logSuffix: "-runtime-prefs" });
  const asks = log.filter((e) => e.dir === "out" && e.frame?.method === "session/requestRuntimePreferences");
  assert.ok(asks.length > 0, "fake backend never asked for runtime preferences");
  for (const a of asks) {
    const ans = answers.get(String(a.frame.id));
    assert.ok(ans, `runtime preferences unanswered (id=${a.frame.id})`);
    assert.equal(typeof ans.memoryEnabled, "boolean");
    assert.equal(ans.askUserQuestionAutoResolutionEnabled, false, "bridge must keep AskUserQuestion in-band");
  }
});

test("L2 host duty: provider runtime headers carry the shared login JWT", async () => {
  const { log, answers } = await runScenario("normal", { logSuffix: "-runtime-headers" });
  const asks = log.filter((e) => e.dir === "out" && e.frame?.method === "interaction/requestProviderRuntimeHeaders");
  assert.ok(asks.length > 0, "fake backend never asked for provider runtime headers");
  for (const a of asks) {
    const ans = answers.get(String(a.frame.id));
    assert.ok(ans, `runtime headers unanswered (id=${a.frame.id})`);
    assert.equal(ans.headersApplied, true, JSON.stringify(ans));
    assert.equal(typeof ans.requestAuth?.apiKey, "string", "requestAuth.apiKey missing (start-plan regression)");
    assert.ok(ans.requestAuth.apiKey.length > 0);
    assert.ok(!("code" in ans), "host answered the runtime-header ask with an error");
  }
});

test("L2 host duty: official MCP auth headers are answered, not rejected", async () => {
  const { log, answers } = await runScenario("normal", { logSuffix: "-mcp-auth" });
  const asks = log.filter((e) => e.dir === "out" && e.frame?.method === "interaction/requestOfficialMcpAuthHeaders");
  assert.ok(asks.length > 0, "fake backend never asked for official MCP auth headers");
  for (const a of asks) {
    const ans = answers.get(String(a.frame.id));
    assert.ok(ans, `official MCP auth headers unanswered (id=${a.frame.id})`);
    assert.ok(!("code" in ans), `host rejected the MCP auth ask: ${JSON.stringify(ans)}`);
    assert.deepEqual(ans, {}, "golden host answers this ask with {}");
  }
});

test("L2 permission: the backend permission ask reaches the ACP client and is answered", async () => {
  for (const name of ["permission-allow", "permission-deny"]) {
    const { run, log, answers } = await runScenario(name, {
      logSuffix: "-permission",
      acp: { permissionChoice: name === "permission-allow" ? "allow_once" : "deny" },
    });
    assert.ok(
      run.clientRequests.some((r) => r.method === "session/request_permission"),
      `${name}: adapter never forwarded session/request_permission`,
    );
    const asks = log.filter((e) => e.dir === "out" && e.frame?.method === "interaction/requestPermission");
    assert.ok(asks.length > 0, `${name}: backend never asked for permission`);
    for (const a of asks) {
      const ans = answers.get(String(a.frame.id));
      assert.ok(ans, `${name}: permission ask unanswered`);
      // The bridge translates the ACP pick into {action:"accept"/"decline"},
      // while the Phase 0 probe answered {optionId}. Both are allow/deny
      // signals; the contract is that the bridge never DECLINES an approval.
      const approved = name === "permission-allow";
      const declined = ans.action === "decline" || ans.decision === "deny" || ans.optionId === "deny" || ("code" in ans);
      assert.equal(declined, !approved, `${name}: unexpected permission decision ${JSON.stringify(ans)}`);
    }
  }
});

test("L2 cancel: session/stop reaches the backend as a request (not a notification)", async () => {
  // Cancel must land MID-TURN: the recorded cancel-scenario stream carries
  // turn.completed(cancelled) itself, and the fake backend replays it in
  // well under 700ms — a late cancel lands after the turn finished and is
  // (correctly) a no-op. 120ms puts the cancel inside the streamed turn.
  const { run, log } = await runScenario("cancel", {
    logSuffix: "-cancel-probe",
    acp: { cancelAfterMs: 120 },
  });
  assert.equal(run.prompt?.stopReason, "cancelled", `stopReason=${run.prompt?.stopReason}`);
  const stops = log.filter((e) => e.dir === "in" && e.frame?.method === "session/stop");
  assert.ok(stops.length > 0, "adapter never sent session/stop after session/cancel");
  for (const s of stops) {
    assert.notEqual(s.frame.id, undefined, "session/stop was sent without an id (notification)");
  }
});
