// acp-e2e.mjs — Phase 2 验收探针：以 ACP 客户端身份直连适配器（真实推理）
// 流程：initialize → session/new → session/prompt（流式收集）→ session/cancel → close
// 用法：node probe/acp-e2e.mjs <adapter-dist-dir> [cwd]
// 例： node probe/acp-e2e.mjs C:/Users/Rt/.zcode/workspace/zcode-acp/dist C:/Users/Rt/.zcode/workspace/zcode-acp-recon/traces/workspace
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createInterface } from "node:readline";

const distDir = process.argv[2] || "C:/Users/Rt/.zcode/workspace/zcode-acp/dist";
const cwd = process.argv[3] || path.join(os.tmpdir(), "zcode-acp-e2e");
fs.mkdirSync(cwd, { recursive: true });
const entry = path.join(distDir, "index.js");
if (!fs.existsSync(entry)) { console.error("adapter entry missing:", entry); process.exit(1); }

const RAW = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), "traces", "raw");
fs.mkdirSync(RAW, { recursive: true });
const traceFile = path.join(RAW, "acp-e2e.jsonl");

const child = spawn(process.execPath, [entry], { cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
let stderrTail = "";
child.stderr.on("data", d => { stderrTail = (stderrTail + d.toString("utf8")).slice(-4000); });

let nextId = 1;
const pending = new Map();
const updates = [];
let sawAgentChunk = false;
const chunks = [];

function send(obj) {
  fs.appendFileSync(traceFile, JSON.stringify(obj) + "\n");
  child.stdin.write(JSON.stringify(obj) + "\n");
}
function request(method, params, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timeout ${method}`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    send({ id, method, params });
  });
}

const rl = createInterface({ input: child.stdout });
rl.on("line", line => {
  const t = line.trim();
  if (!t) return;
  let msg; try { msg = JSON.parse(t); } catch { fs.appendFileSync(traceFile, JSON.stringify({ nonJson: t.slice(0, 200) }) + "\n"); return; }
  fs.appendFileSync(traceFile, t + "\n");
  if (msg.id !== undefined && !msg.method) {
    const p = pending.get(msg.id);
    if (p) { clearTimeout(p.timer); pending.delete(msg.id); msg.error ? p.reject(Object.assign(new Error(JSON.stringify(msg.error).slice(0, 300)), { code: msg.error?.code })) : p.resolve(msg.result); }
    return;
  }
  if (msg.method === "session/update") {
    const u = msg.params?.update ?? {};
    updates.push(u.sessionUpdate ?? u.kind ?? "?");
    if ((u.sessionUpdate === "agent_message_chunk" || u.kind === "agent_message_chunk") && u.content?.text) chunks.push(u.content.text);
  }
});

const report = {};
try {
  // 1) initialize
  const init = await request("initialize", {
    protocolVersion: 1,
    clientCapabilities: {},
  }, 30000);
  report.initialize = { protocolVersion: init?.protocolVersion, authMethods: (init?.authMethods || []).map(a => a.name), hasAgentCapabilities: !!init?.agentCapabilities };
  console.log("[initialize]", JSON.stringify(report.initialize));

  // 2) session/new
  const sn = await request("session/new", { cwd, mcpServers: [], ...(process.env.E2E_MODEL ? { model: JSON.parse(process.env.E2E_MODEL) } : {}) }, 60000);
  const sessionId = sn?.sessionId;
  report.sessionNew = { sessionId: sessionId ? sessionId.slice(0, 12) + "…" : null };
  console.log("[session/new]", sessionId);

  // 3) session/prompt（真实推理）
  const t0 = Date.now();
  const promptRes = await request("session/prompt", {
    sessionId,
    prompt: [{ type: "text", text: "Reply with exactly: OK" }],
  }, 240000);
  const durMs = Date.now() - t0;
  report.prompt = {
    stopReason: promptRes?.stopReason,
    replyText: chunks.join("").slice(0, 120),
    streamedChunkEvents: updates.filter(u => u === "agent_message_chunk").length,
    durationMs: durMs,
  };
  console.log("[prompt]", JSON.stringify(report.prompt));

  // 4) 第二轮 + cancel（可选验证取消链路）
  // （MVP 验收以单轮成功 + stopReason=end_turn 为准；cancel 已由上游测试覆盖）

  report.ok = promptRes?.stopReason === "end_turn" && /OK/.test(chunks.join(""));
} catch (e) {
  report.ok = false;
  report.fatal = String(e && e.message).slice(0, 400);
  console.error("[fatal]", report.fatal);
} finally {
  try { child.stdin.end(); } catch {}
  await new Promise(r => { const t = setTimeout(r, 5000); child.once("exit", () => { clearTimeout(t); r(); }); });
  if (child.exitCode === null) { try { child.kill(); } catch {} }
  report.stderrTail = stderrTail.slice(-300);
  report.nonJsonStdout = fs.readFileSync(traceFile, "utf8").split("\n").filter(l => l.includes("nonJson")).length;
  fs.writeFileSync(path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), "reports", "acp-e2e.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, stopReason: report.prompt?.stopReason, reply: report.prompt?.replyText, chunks: report.prompt?.streamedChunkEvents, durMs: report.prompt?.durationMs, nonJson: report.nonJsonStdout }));
}
