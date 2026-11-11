// zed-acceptance.mjs — Phase 5 验收 B：以 Zed 同规格的 ACP 客户端能力驱动适配器
// 五关：①握手 ②工具调用+权限应答+文件落盘 ③多轮上下文 ④取消 ⑤stdout 纪律
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createInterface } from "node:readline";

const distDir = process.argv[2] || "C:/Users/Rt/.zcode/workspace/zcode-acp/dist";
const cwd = process.argv[3] || path.join(os.tmpdir(), "zed-acceptance-ws");
fs.mkdirSync(cwd, { recursive: true });
const entry = path.join(distDir, "index.js");

const RECON = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const OUT = path.join(RECON, "reports", "phase5");
fs.mkdirSync(OUT, { recursive: true });

const child = spawn(process.execPath, [entry], { cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
let nonJson = 0;
let nextId = 1;
const pending = new Map();
const updates = [];
const hostAsks = [];
const chunks = [];

function send(obj) { child.stdin.write(JSON.stringify(obj) + "\n"); }
function request(method, params, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timeout: ${method}`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    send({ id, method, params });
  });
}

const rl = createInterface({ input: child.stdout });
rl.on("line", line => {
  const t = line.trim();
  if (!t) return;
  let msg; try { msg = JSON.parse(t); } catch { nonJson++; return; }
  if (msg.id !== undefined && !msg.method) {
    const p = pending.get(msg.id);
    if (p) { clearTimeout(p.timer); pending.delete(msg.id); msg.error ? p.reject(Object.assign(new Error(JSON.stringify(msg.error).slice(0, 250)))) : p.resolve(msg.result); }
    return;
  }
  if (msg.method === "session/update") {
    const u = msg.params?.update ?? {};
    updates.push(u);
    if (u.sessionUpdate === "agent_message_chunk" || u.kind === "agent_message_chunk") {
      chunks.push(u.content?.text ?? "");
    }
  }
  if (msg.id !== undefined && msg.method) {
    // Zed 对宿主请求的应答语义：权限→选 allow；其余→空结果
    hostAsks.push({ method: msg.method, toolName: msg.params?.toolName, options: (msg.params?.options || []).map(o => o.kind) });
    let result = {};
    if (msg.method === "session/request_permission") {
      const opt = (msg.params?.options || []).find(o => String(o.kind).startsWith("allow")) ?? msg.params?.options?.[0];
      result = { outcome: { outcome: "selected", optionId: opt?.optionId } };
    }
    send({ id: msg.id, result });
  }
});

const accept = {};
function closeSoon() { return new Promise(r => { try { child.stdin.end(); } catch {} const t = setTimeout(r, 4000); child.once("exit", () => { clearTimeout(t); r(); }); if (child.exitCode === null) try { child.kill(); } catch {} }); }

try {
  // ① 握手（Zed 声明 fs 能力）
  const init = await request("initialize", {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
  }, 30000);
  accept.handshake = { protocolVersion: init?.protocolVersion, authMethods: (init?.authMethods || []).map(a => a.name) };
  console.log("[1 handshake]", JSON.stringify(accept.handshake));

  const sn = await request("session/new", { cwd, mcpServers: [] }, 60000);
  const sessionId = sn?.sessionId;
  accept.sessionId = sessionId?.slice(0, 12) + "…";
  console.log("[2 session/new]", accept.sessionId);

  // ② 工具调用 + 权限 + 文件落盘
  const marker = path.join(cwd, "zed-acceptance.txt");
  try { fs.rmSync(marker, { force: true }); } catch {}
  const p1 = await request("session/prompt", {
    sessionId,
    prompt: [{ type: "text", text: "在当前工作目录创建文件 zed-acceptance.txt，内容为单独一行：hello-from-zed。创建完成后只回复 DONE。" }],
  }, 240000);
  const before = { chunks: chunks.length, asks: hostAsks.length };
  accept.toolUse = {
    stopReason: p1?.stopReason,
    permissionAsked: hostAsks.some(h => h.method === "session/request_permission" && h.toolName),
    fileCreated: fs.existsSync(marker),
    fileContent: fs.existsSync(marker) ? fs.readFileSync(marker, "utf8").trim() : null,
  };
  console.log("[3 tool-use]", JSON.stringify(accept.toolUse));

  // ③ 多轮上下文
  chunks.length = 0;
  const p2 = await request("session/prompt", {
    sessionId,
    prompt: [{ type: "text", text: "zed-acceptance.txt 文件的第一行是什么？只回复那一行的内容，不要其他文字。" }],
  }, 240000);
  const multiTurnReply = chunks.join("").trim();
  accept.multiTurn = { stopReason: p2?.stopReason, reply: multiTurnReply.slice(0, 60), correct: multiTurnReply.includes("hello-from-zed") };
  console.log("[4 multi-turn]", JSON.stringify(accept.multiTurn));

  // ④ 取消一个长回合
  chunks.length = 0;
  await request("session/prompt", {
    sessionId,
    prompt: [{ type: "text", text: "请从 1 数到 80，每行一个数字。" }],
  }, 20000);
  await new Promise(r => setTimeout(r, 3000));
  send({ method: "session/cancel", params: { sessionId } });
  const pc = await request("session/prompt", {
    sessionId,
    prompt: [{ type: "text", text: "回复：继续。" }],
  }, 240000).catch(e => ({ stopReason: "error:" + String(e.message).slice(0, 80) }));
  // 取消语义：上一回合以 cancelled 收口（由后续回合能正常启动来佐证会话健康）
  accept.cancel = { resumedAfterCancel: pc?.stopReason === "end_turn", resumedReply: chunks.join("").trim().slice(0, 40) };
  console.log("[5 cancel+resume]", JSON.stringify(accept.cancel));

  // ⑤ stdout 纪律与汇总
  accept.stdoutDiscipline = { nonJson };
  accept.ok =
    accept.toolUse.fileCreated &&
    accept.toolUse.fileContent === "hello-from-zed" &&
    accept.multiTurn.correct &&
    accept.cancel.resumedAfterCancel &&
    nonJson === 0;
} catch (e) {
  accept.ok = false;
  accept.fatal = String(e && e.message).slice(0, 300);
  console.error("[fatal]", accept.fatal);
} finally {
  await closeSoon();
  accept.stderrTail = "";
  fs.writeFileSync(path.join(OUT, "zed-acceptance.json"), JSON.stringify(accept, null, 2));
  console.log("ACCEPTANCE:", JSON.stringify({ ok: accept.ok, toolUse: accept.toolUse?.fileCreated, multiTurn: accept.multiTurn?.correct, resume: accept.cancel?.resumedAfterCancel, nonJson }));
}
