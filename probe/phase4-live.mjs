// phase4-live.mjs — 实时补采 Phase 3 缺口场景的 L3 证据（需账户计划有效）
// 场景：background（后台任务卡片）/ ask-user（交互问答）/ multibyte（大输出中文流）
// 每场景落 reports/phase3/live-<scenario>.json（元数据 + 会话更新序列 + 宿主交互帧）
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createInterface } from "node:readline";

const distDir = process.argv[2] || "C:/Users/Rt/.zcode/workspace/zcode-acp/dist";
const cwd = process.argv[3] || path.join(os.tmpdir(), "zcode-acp-live");
fs.mkdirSync(cwd, { recursive: true });
const entry = path.join(distDir, "index.js");

const RECON = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const OUT = path.join(RECON, "reports", "phase3");
fs.mkdirSync(OUT, { recursive: true });

function launch() {
  const child = spawn(process.execPath, [entry], { cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let nextId = 1;
  const pending = new Map();
  const updates = [];
  const inbound = [];
  function send(obj) { child.stdin.write(JSON.stringify(obj) + "\n"); }
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
    let msg; try { msg = JSON.parse(t); } catch { return; }
    if (msg.id !== undefined && !msg.method) {
      const p = pending.get(msg.id);
      if (p) { clearTimeout(p.timer); pending.delete(msg.id); msg.error ? p.reject(Object.assign(new Error(JSON.stringify(msg.error).slice(0, 200)))) : p.resolve(msg.result); }
      return;
    }
    if (msg.method === "session/update") {
      const u = msg.params?.update ?? {};
      updates.push({ kind: u.sessionUpdate ?? u.kind ?? "?", ...u });
    }
    if (msg.id !== undefined && msg.method) {
      // 宿主→客户端请求：按方法自动应答并留证
      inbound.push({ method: msg.method, params: msg.params });
      let result = {};
      if (msg.method === "session/request_permission") {
        const opt = (msg.params?.options || []).find(o => String(o.kind).startsWith("allow")) ?? msg.params?.options?.[0];
        result = { outcome: { outcome: "selected", optionId: opt?.optionId } };
      } else if (/ask|elicitation|question/i.test(msg.method)) {
        result = { action: "accept", content: { q_0: "猫" }, value: "猫" };
      }
      send({ id: msg.id, result });
    }
  });
  return { child, request, updates, inbound, send, close: async () => { try { child.stdin.end(); } catch {} await new Promise(r => { const t = setTimeout(r, 4000); child.once("exit", () => { clearTimeout(t); r(); }); }); if (child.exitCode === null) try { child.kill(); } catch {} } };
}

async function runScenario(name, prompt, { settleMs = 90000, interactMs = 60000 } = {}) {
  const st = launch();
  const report = { scenario: name, prompt, updates: [], inbound: [], ok: false };
  try {
    const init = await st.request("initialize", { protocolVersion: 1, clientCapabilities: {} }, 30000);
    report.agentCapabilities = Object.keys(init?.agentCapabilities ?? {});
    const sn = await st.request("session/new", { cwd, mcpServers: [] }, 60000);
    report.sessionId = sn?.sessionId;
    await st.request("session/prompt", { sessionId: sn.sessionId, prompt: [{ type: "text", text: prompt }] }, 30000).catch(e => report.sendError = String(e.message).slice(0, 150));
    const t0 = Date.now();
    while (Date.now() - t0 < settleMs + interactMs) {
      await new Promise(r => setTimeout(r, 500));
      const done = st.updates.some(u => (u.sessionUpdate === "finished" || u.kind === "finished"));
      const terminal = report.inbound.length > 0 && Date.now() - t0 > interactMs;
      if (done || (report.updates.length && Date.now() - t0 > settleMs)) break;
    }
    report.updates = st.updates.map(u => {
      const c = u.content?.text ?? u.content?.data ? undefined : undefined;
      return { kind: u.kind, text: typeof u.text === "string" ? u.text.slice(0, 80) : undefined, status: u.status, toolKind: u.kind === "tool_call" ? u.kind : undefined, title: u.title, raw: JSON.stringify(u).length };
    });
    report.inbound = st.inbound.map(i => ({ method: i.method, paramKeys: Object.keys(i.params ?? {}), toolName: i.params?.toolName, options: (i.params?.options || []).map(o => o.kind) }));
    report.updateKinds = {};
    for (const u of st.updates) report.updateKinds[u.kind] = (report.updateKinds[u.kind] || 0) + 1;
    report.ok = true;
  } catch (e) {
    report.fatal = String(e && e.message).slice(0, 300);
  } finally {
    await st.close();
  }
  fs.writeFileSync(path.join(OUT, `live-${name}.json`), JSON.stringify(report, null, 1));
  return report;
}

const results = {};
// 1) 后台任务
console.log("== background ==");
results.background = await runScenario("background",
  "请使用后台任务方式（run_in_background: true）运行命令 echo bg-probe-ok，然后立即告诉我你已在后台启动了它。不要等待它完成。",
  { settleMs: 60000 });
console.log(JSON.stringify({ kinds: results.background.updateKinds, inbound: results.background.inbound?.length, fatal: results.background.fatal }));

// 2) AskUserQuestion 交互
console.log("== ask-user ==");
results.askUser = await runScenario("ask-user",
  "请调用 AskUserQuestion 工具问我一个问题：我更喜欢猫还是狗？提供选项：猫、狗。我回答后请复述我的选择。",
  { settleMs: 90000, interactMs: 60000 });
console.log(JSON.stringify({ inbound: results.askUser.inbound, fatal: results.askUser.fatal }));

// 3) 多字节大输出
console.log("== multibyte ==");
results.multibyte = await runScenario("multibyte",
  "请输出 30 句不同的中文格言，每句一行，编号 1 到 30，不要省略。",
  { settleMs: 120000 });
const mb = results.multibyte;
mb.ok = (mb.updateKinds?.agent_message_chunk || 0) > 10;
console.log(JSON.stringify({ chunks: mb.updateKinds?.agent_message_chunk, fatal: mb.fatal }));

fs.writeFileSync(path.join(OUT, "live-capture-results.json"), JSON.stringify(results, null, 2));
console.log("\nwritten: reports/phase3/live-capture-results.json");
