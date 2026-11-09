#!/usr/bin/env node
/**
 * fake-app-server.mjs — hermetic ZCode app-server stand-in for Phase 3 contract tests.
 *
 * The adapter launches it as ZCODE_BIN (resolveZcodeCommand builds
 * `[node, thisFile, "app-server", "--stdio", ...]`). It replays a compact
 * fixture derived from a Phase 0 sanitized golden trace:
 *
 *   adapter --request--> fake : answered with the recorded result shape
 *   fake    --ask------> host : the three host duties the golden trace recorded
 *   fake    --event----> host : the recorded turn's session/event stream
 *
 * IMPORTANT (review B1): every scripted `on:` step registers its request
 * waiter AT STARTUP. The adapter fires session/create, session/subscribe and
 * session/send almost at once; a sequential "wait for step N" loop would let
 * those requests arrive while step 0 was still waiting and answer them out of
 * order with generic replies. Waiters are pre-registered so scripted methods
 * are claimed before any generic reply, and each step's `reply` is really sent.
 *
 * Everything is JSONL on stdout (no logging, no noise). Observations are
 * appended to ZCODE_FAKE_LOG as JSONL so they survive a taskkill /T /F reap.
 * No network, no credential reads, no writes outside the log file.
 *
 * Env:
 *   ZCODE_FAKE_SCRIPT  absolute path to contract/fixtures/<scenario>.json
 *   ZCODE_FAKE_LOG     absolute path for the observation log (JSONL)
 *   ZCODE_FAKE_CWD     workspace path substituted for <CWD> in fixtures
 *   ZCODE_HOME         substituted for <ZCODE_HOME> in fixtures
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

const scriptPath = process.env.ZCODE_FAKE_SCRIPT;
const logPath = process.env.ZCODE_FAKE_LOG;
const cwd = process.env.ZCODE_FAKE_CWD || process.cwd();
const zcodeHome = process.env.ZCODE_HOME || path.join(os.homedir(), ".zcode");

if (!scriptPath) {
  process.stderr.write("fake-app-server: ZCODE_FAKE_SCRIPT is required\n");
  process.exit(2);
}
const fixture = JSON.parse(fs.readFileSync(scriptPath, "utf8"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOKEN = (s) => s.replace(/\\/g, "/");

function observe(entry) {
  if (!logPath) return;
  try {
    fs.appendFileSync(logPath, JSON.stringify({ t: Date.now(), ...entry }) + "\n");
  } catch {
    /* a missing log dir must never break the protocol */
  }
}

function substitute(value) {
  if (typeof value === "string") {
    return value.split("<CWD>").join(TOKEN(cwd)).split("<ZCODE_HOME>").join(TOKEN(zcodeHome));
  }
  if (Array.isArray(value)) return value.map(substitute);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = substitute(v);
    return out;
  }
  return value;
}

function send(frame) {
  const out = substitute(frame);
  process.stdout.write(JSON.stringify(out) + "\n");
  observe({ dir: "out", frame: out });
}

// ---------- pre-registered step waiters ----------

/** @type {Array<{step:any,index:number,promise:Promise<any>,resolve:Function,timer:any,req:any,claimed:boolean,expired:boolean}>} */
const arrivals = (fixture.steps ?? []).map((step, index) => {
  let resolve;
  const promise = step.on
    ? new Promise((r) => { resolve = r; })
    : Promise.resolve(null);
  const a = { step, index, promise, resolve, timer: null, req: null, claimed: false, expired: false };
  if (step.on) {
    a.timer = setTimeout(() => {
      // Expire the waiter so a late request is answered generically instead of
      // being claimed by a step nobody will drive (which would hang the adapter).
      a.expired = true;
      observe({ type: "stepWaiterExpired", index, on: step.on, timeout: step.timeout ?? 12000 });
      resolve(null);
    }, step.timeout ?? 12000);
  }
  return a;
});

const answers = new Map();
const answerWaiters = [];
const replied = new Set();
const defaultedMethods = new Set();
const scriptedMethods = new Set(arrivals.filter((a) => a.step.on).map((a) => a.step.on));

function onFrame(msg) {
  observe({ dir: "in", frame: msg });
  if (msg.id !== undefined && msg.method !== undefined) {
    const a = arrivals.find((x) => x.step.on === msg.method && !x.claimed && !x.expired);
    if (a) {
      a.claimed = true;
      a.req = msg;
      clearTimeout(a.timer);
      a.resolve(msg);
      return;
    }
    // Unscripted (or late) request: answer with the recorded result shape when
    // one exists, otherwise an empty object, and record that it was defaulted.
    if (!replied.has(String(msg.id))) {
      replied.add(String(msg.id));
      const recorded = fixture.results?.[msg.method];
      if (recorded === undefined) defaultedMethods.add(msg.method);
      send({ id: msg.id, result: substitute(recorded ?? {}) });
      observe({ type: "genericReply", method: msg.method, id: msg.id, defaulted: recorded === undefined });
    }
    return;
  }
  if (msg.id !== undefined && ("result" in msg || "error" in msg)) {
    const key = String(msg.id);
    // server-N ids restart across connections. Current fixtures emit unique
    // ids, but make a collision visible instead of silently collapsing two
    // answers into one (which could make waitForAnswers report a false pass).
    if (answers.has(key)) observe({ type: "duplicateAnswerId", id: key });
    if (!answers.has(key)) answers.set(key, msg.result ?? msg.error ?? {});
    observe({ type: "answer", id: key, answer: answers.get(key) });
    for (let i = answerWaiters.length - 1; i >= 0; i--) {
      const w = answerWaiters[i];
      if (w.ids.every((id) => answers.has(String(id)))) {
        answerWaiters.splice(i, 1);
        clearTimeout(w.timer);
        w.resolve(true);
      }
    }
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const t = line.trim();
  if (!t) return;
  let msg;
  try {
    msg = JSON.parse(t);
  } catch {
    observe({ type: "nonJsonInbound", line: t.slice(0, 200) });
    return;
  }
  onFrame(msg);
});
rl.on("close", () => {
  observe({ type: "stdinClosed" });
  // Clear the pre-registered expiry timers so no pending timer keeps an orphan
  // process alive, but let stdout drain naturally instead of process.exit()
  // (which could drop a buffered JSONL frame mid-emit).
  for (const a of arrivals) if (a.timer) clearTimeout(a.timer);
  for (const w of answerWaiters) clearTimeout(w.timer);
  process.exitCode = 0;
});

async function waitForAnswers(ids, timeoutMs = 6000) {
  const pending = ids.map(String).filter((id) => !answers.has(id));
  if (pending.length === 0) return true;
  await new Promise((resolve) => {
    const w = { ids: pending, resolve, timer: null };
    w.timer = setTimeout(() => {
      const i = answerWaiters.indexOf(w);
      if (i >= 0) answerWaiters.splice(i, 1);
      resolve(false);
    }, timeoutMs);
    answerWaiters.push(w);
  });
  const missing = pending.filter((id) => !answers.has(id));
  if (missing.length) observe({ type: "missingAnswers", ids: missing });
  return missing.length === 0;
}

// ---------- replay driver ----------

async function run() {
  observe({
    type: "start",
    scenario: fixture.scenario,
    sourceSha256: fixture.source?.sha256,
    pid: process.pid,
    scriptedMethods: [...scriptedMethods],
  });
  let matched = 0;
  for (const a of arrivals) {
    const step = a.step;
    const req = step.on ? await a.promise : null;
    if (step.on && !req) {
      observe({ type: "stepSkipped", index: a.index, on: step.on, optional: !!step.optional });
      continue;
    }
    if (step.on) matched++;
    observe({ type: "step", index: a.index, on: step.on ?? "(auto)", matched: !!req, id: req?.id });
    if (step.syntheticTerminal) observe({ type: "syntheticTerminal", scenario: fixture.scenario });

    const emit = step.emit ?? [];
    // Pause immediately BEFORE the terminal event (not the trailing state
    // notification), so session/cancel can land while the turn is still open.
    let pauseAt = -1;
    if (step.pauseBeforeLastEmit || step.waitAnswersBeforeTerminal?.length) {
      for (let j = 0; j < emit.length; j++) {
        const f = emit[j];
        if (f.method === "session/event" && ["turn.completed", "turn.failed"].includes(f.params?.type)) pauseAt = j;
      }
    }
    for (let j = 0; j < emit.length; j++) {
      if (j === pauseAt) {
        if (step.pauseBeforeLastEmit) await sleep(step.pauseBeforeLastEmit);
        if (step.waitAnswersBeforeTerminal?.length) {
          const ok = await waitForAnswers(step.waitAnswersBeforeTerminal);
          observe({ type: "answers", index: a.index, ids: step.waitAnswersBeforeTerminal, complete: ok, beforeTerminal: true });
        }
      }
      send(emit[j]);
      // A host ask is part of the golden trace: give the adapter a turn to
      // answer before the next frame so ordering matches a real app-server.
      if (emit[j].id !== undefined && emit[j].method !== undefined) await sleep(4);
    }

    // A step can request a pre-terminal wait even when this particular turn
    // has NO terminal event (pauseAt === -1). Never skip the wait silently —
    // otherwise the L2 "no missing answers" gate would be vacuous.
    if (pauseAt === -1 && step.waitAnswersBeforeTerminal?.length) {
      const ok = await waitForAnswers(step.waitAnswersBeforeTerminal);
      observe({ type: "answers", index: a.index, ids: step.waitAnswersBeforeTerminal, complete: ok, beforeTerminal: true });
    }

    const waitIds = step.waitAnswers ?? [];
    if (waitIds.length) {
      const ok = await waitForAnswers(waitIds);
      observe({ type: "answers", index: a.index, ids: waitIds, complete: ok });
    }
    if (step.reply !== undefined && req) {
      send({ id: req.id, result: substitute(step.reply) });
      observe({ type: "scriptedReply", index: a.index, method: step.on, id: req.id });
    }
  }
  observe({
    type: "scriptComplete",
    matchedSteps: matched,
    expectedSteps: [...scriptedMethods].length,
    defaultedMethods: [...defaultedMethods],
  });
}

run().catch((e) => {
  observe({ type: "driverError", message: String(e?.message ?? e) });
});
