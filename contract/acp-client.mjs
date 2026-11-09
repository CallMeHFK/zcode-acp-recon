/**
 * acp-client.mjs — minimal Agent Client Protocol client for contract tests.
 *
 * Drives the REAL adapter (dist/index.js) over stdio with no editor and no
 * network. Captures every ACP frame so tests can assert the outbound contract
 * (event order, stopReason, stdout discipline) as well as answer the adapter's
 * inbound session/request_permission calls.
 */
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import fs from "node:fs";
import path from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} opts
 * @param {string} opts.distDir   adapter dist directory (contains index.js)
 * @param {string} opts.cwd       isolated project cwd
 * @param {object} opts.env       extra environment (ZCODE_BIN, ZCODE_HOME, ...)
 * @param {string} [opts.prompt]  prompt text
 * @param {number} [opts.cancelAfterMs] send session/cancel after this delay
 * @param {string} [opts.permissionChoice] "allow_once" | "deny" | "reject_once"
 * @param {number} [opts.timeoutMs] overall prompt timeout
 * @param {string} [opts.traceFile] optional JSONL sink for all ACP frames
 */
export async function runAcp(opts) {
  const entry = path.join(opts.distDir, "index.js");
  if (!fs.existsSync(entry)) throw new Error(`adapter entry missing: ${entry}`);
  const traceFile = opts.traceFile;
  if (traceFile) fs.writeFileSync(traceFile, "");

  const child = spawn(process.execPath, [entry], {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  const result = {
    updates: [],
    responses: [],
    clientRequests: [],
    nonJsonLines: [],
    stderrTail: "",
    initialize: null,
    sessionNew: null,
    prompt: null,
    ok: false,
    fatal: null,
    durationMs: 0,
  };

  child.stderr.on("data", (d) => {
    result.stderrTail = (result.stderrTail + d.toString("utf8")).slice(-8000);
  });

  let nextId = 1;
  const pending = new Map();
  // ACP rides on JSON-RPC 2.0. The SDK accepts bare *requests*, but validates
  // inbound *responses* strictly — a reply without jsonrpc:"2.0" is rejected
  // as -32600 "Invalid request" and the adapter declines the interaction.
  const write = (obj) => {
    const line = JSON.stringify({ jsonrpc: "2.0", ...obj });
    if (traceFile) fs.appendFileSync(traceFile, line + "\n");
    child.stdin.write(line + "\n");
  };
  const request = (method, params, timeoutMs = 60000) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timeout ${method}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      write({ id, method, params });
    });

  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  rl.on("line", (line) => {
    const t = line.trim();
    if (!t) return;
    let msg;
    try {
      msg = JSON.parse(t);
    } catch {
      result.nonJsonLines.push(t.slice(0, 200));
      if (traceFile) fs.appendFileSync(traceFile, JSON.stringify({ nonJson: t.slice(0, 200) }) + "\n");
      return;
    }
    if (traceFile) fs.appendFileSync(traceFile, t + "\n");

    if (msg.id !== undefined && msg.method === undefined) {
      const p = pending.get(msg.id);
      if (p) {
        clearTimeout(p.timer);
        pending.delete(msg.id);
        msg.error ? p.reject(Object.assign(new Error(String(msg.error.message ?? msg.error)), { code: msg.error.code })) : p.resolve(msg.result);
      }
      result.responses.push(msg);
      return;
    }
    if (msg.method === "session/update") {
      const u = msg.params?.update ?? {};
      result.updates.push(u);
      return;
    }
    if (msg.id !== undefined && msg.method !== undefined) {
      // Adapter -> client request. Answer it so a turn never hangs.
      result.clientRequests.push(msg);
      const options = msg.params?.options ?? [];
      const wanted = opts.permissionChoice ?? "allow_once";
      const pick =
        options.find((o) => o?.kind === wanted || o?.optionId === wanted) ?? options[0];
      const optionId = pick?.optionId ?? wanted;
      write({
        id: msg.id,
        result: { outcome: { outcome: "selected", optionId } },
      });
    }
  });

  const t0 = Date.now();
  try {
    const init = await request("initialize", { protocolVersion: 1, clientCapabilities: {} }, 30000);
    result.initialize = {
      protocolVersion: init?.protocolVersion,
      authMethods: (init?.authMethods ?? []).map((a) => a.name ?? a),
      hasAgentCapabilities: !!init?.agentCapabilities,
    };

    const sn = await request("session/new", { cwd: opts.cwd, mcpServers: [] }, 60000);
    const sessionId = sn?.sessionId;
    result.sessionNew = { sessionId: sessionId ?? null };
    if (!sessionId) throw new Error("session/new returned no sessionId");

    if (opts.cancelAfterMs) {
      setTimeout(() => {
        write({ method: "session/cancel", params: { sessionId } });
      }, opts.cancelAfterMs).unref?.();
    }

    const promptRes = await request(
      "session/prompt",
      { sessionId, prompt: [{ type: "text", text: opts.prompt ?? "Reply with exactly: OK" }] },
      opts.timeoutMs ?? 90000,
    );
    result.durationMs = Date.now() - t0;
    const chunks = result.updates
      .filter((u) => (u.sessionUpdate ?? u.kind) === "agent_message_chunk")
      .map((u) => u.content?.text ?? "")
      .join("");
    result.prompt = {
      stopReason: promptRes?.stopReason ?? null,
      replyText: chunks.slice(0, 2000),
      chunkEvents: result.updates.filter((u) => (u.sessionUpdate ?? u.kind) === "agent_message_chunk").length,
    };
    result.ok = promptRes?.stopReason === "end_turn";
  } catch (e) {
    result.fatal = String(e?.message ?? e).slice(0, 500);
    result.durationMs = Date.now() - t0;
  } finally {
    try {
      child.stdin.end();
    } catch {
      /* already closed */
    }
    await Promise.race([
      new Promise((r) => child.once("exit", () => r())),
      sleep(5000),
    ]);
    // ALWAYS reap the whole Windows tree, even after a "clean" exit: the
    // adapter spawns the fake backend detached in its own group, so killing
    // only the bridge (or skipping the kill because it already exited) can
    // leave an orphan fake app-server behind (review S6).
    try {
      if (process.platform === "win32" && child.pid) {
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
          timeout: 5000,
        });
      } else if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    } catch {
      /* best effort */
    }
  }
  return result;
}

/** Ordered list of ACP sessionUpdate kinds (for sequence assertions). */
export function updateKinds(run) {
  return run.updates.map((u) => u.sessionUpdate ?? u.kind ?? "?");
}
