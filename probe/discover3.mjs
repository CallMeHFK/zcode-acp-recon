// discover3.mjs — 带模型选择的完整单轮推理：验证订阅认证、事件流、seq、usage
// 用法: node probe/discover3.mjs [providerId] [modelId] [reasoningLevel]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchAppServer, terminate } from "./launcher.mjs";
import { createRpcClient } from "./rpc-client.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW = path.join(ROOT, "traces", "raw");
const WS = path.join(ROOT, "traces", "workspace");
fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(WS, { recursive: true });

const providerId = process.argv[2] || "builtin:bigmodel-coding-plan";
const modelId = process.argv[3] || "GLM-5.3-Flash";
const reasoningLevel = process.argv[4] || undefined;

const tag = `discover3-${providerId.replace(/[^a-z0-9]+/gi, "-")}-${modelId}`.toLowerCase();
const traceFile = path.join(RAW, tag + ".jsonl");
const report = { providerId, modelId, reasoningLevel, steps: {} };
const events = [];
const seenTypes = new Map();
function trunc(v, n = 800) { const s = JSON.stringify(v); return s && s.length > n ? s.slice(0, n) + `…(+${s.length - n})` : s; }

const { child, spawnMeta, getStderrTail } = launchAppServer({ cwd: WS, traceFile });
const rpc = createRpcClient({ child, traceFile });
rpc.onInboundRequest("session/requestRuntimePreferences", () => ({
  nativeSearchEnhancementsEnabled: false, toolSearchMode: "off", memoryEnabled: false,
  askUserQuestionAutoResolutionEnabled: true, modelContextBudgetStrategy: "preflight-v1",
}));
rpc.onNotification(msg => {
  const t = msg.method === "session/event" ? `session/event:${msg.params?.type ?? "?"}` : msg.method;
  seenTypes.set(t, (seenTypes.get(t) || 0) + 1);
  if (msg.method === "session/event") events.push(msg.params);
});

try {
  const createRes = await rpc.request("session/create", {
    workspace: { workspacePath: WS, workspaceKey: "workspace" },
  }, { timeoutMs: 30000 });
  const sessionId = createRes?.session?.sessionId;
  report.steps.create = { ok: true, sessionId, settings: trunc(createRes?.settings, 700) };
  console.log("[create] OK", sessionId, "settings:", trunc(createRes?.settings, 400));

  const subRes = await rpc.request("session/subscribe", { sessionId, deliveryKind: "desktop-continuous", includeSnapshot: true }, { timeoutMs: 20000 });
  report.steps.subscribe = { ok: true, eventSeq: subRes?.eventSeq };
  console.log("[subscribe] eventSeq=" + subRes?.eventSeq);

  // 等待模型注册（entitlement 异步加载）：轮询 session/read 直到 model.available 非空
  let modelsAvailable = null, waitedMs = 0;
  const tWait = Date.now();
  while (Date.now() - tWait < 90_000) {
    try {
      const rd = await rpc.request("session/read", { sessionId }, { timeoutMs: 10000 });
      const avail = rd?.settings?.model?.available ?? [];
      if (avail.length > 0) { modelsAvailable = { afterMs: waitedMs, count: avail.length, sample: trunc(avail.slice(0, 6), 500) }; break; }
    } catch {}
    await new Promise(r => setTimeout(r, 2000));
    waitedMs = Date.now() - tWait;
  }
  report.steps.modelWait = modelsAvailable || { timeoutAfterMs: waitedMs };
  console.log("[modelWait]", JSON.stringify(report.steps.modelWait));

  // 注册完成后设置模型（session/setModel，params: {sessionId, model, expectedRevision?}）
  if (modelsAvailable) {
    try {
      const setRes = await rpc.request("session/setModel", { sessionId, model: { providerId, modelId } }, { timeoutMs: 15000 });
      report.steps.setModel = { ok: true, response: trunc(setRes, 400) };
      console.log("[setModel] OK", trunc(setRes, 300));
    } catch (e) {
      report.steps.setModel = { ok: false, error: trunc(e, 400) };
      console.log("[setModel] 失败:", trunc(e, 300));
    }
  }

  // send：带 modelSelection（execution 作用域解析）
  const sendParams = { sessionId, content: "Reply with exactly: OK" };
  if (process.env.PROBE_SEND_MODEL !== "0") {
    sendParams.modelSelection = { providerId, modelId };
  }
  const sendRes = await rpc.request("session/send", sendParams, { timeoutMs: 20000 });
  report.steps.send = { ok: true, response: trunc(sendRes, 300) };
  console.log("[send]", trunc(sendRes, 200));

  const t0 = Date.now();
  let turnEnd = null;
  const textChunks = [];
  while (Date.now() - t0 < 120_000 && !turnEnd) {
    await new Promise(r => setTimeout(r, 300));
    for (const ev of events) {
      if (ev.type === "turn.completed" || ev.type === "turn.failed" || ev.type === "turn.terminal") turnEnd ||= ev;
      if (ev.type === "model.streaming" && ev.payload?.kind === "text_delta") textChunks.push(ev.payload?.delta ?? "");
    }
  }
  const reply = textChunks.join("");
  report.steps.turn = turnEnd ? { type: turnEnd.type, payload: trunc(turnEnd.payload, 1200) } : { timeout: true };
  report.replyText = reply.slice(0, 300);
  console.log("[reply]", JSON.stringify(reply.slice(0, 200)));
  console.log("[turn]", JSON.stringify(report.steps.turn));

  // seq 连续性检查
  const seqs = events.map(e => e.seq).filter(s => typeof s === "number");
  const continuous = seqs.every((s, i) => i === 0 || s === seqs[i - 1] + 1);
  report.seq = { count: seqs.length, first: seqs[0], last: seqs[seqs.length - 1], continuous };
  console.log("[seq]", JSON.stringify(report.seq));

  // usage（turn.completed payload）
  if (turnEnd?.type === "turn.completed") {
    report.usage = turnEnd.payload?.usage ?? null;
    console.log("[usage]", trunc(report.usage, 500));
  }

  // 读取消息历史（G6 用基线）
  const msgs = await rpc.request("session/messages", { sessionId }, { timeoutMs: 15000 });
  report.steps.messages = { count: Array.isArray(msgs?.messages) ? msgs.messages.length : -1, shape: trunc(msgs, 600) };
  console.log("[messages] count=" + report.steps.messages.count);
} catch (e) {
  report.fatal = trunc(e, 600);
  console.error("[fatal]", trunc(e, 400));
} finally {
  const term = await terminate(child, { mode: "graceful" });
  report.terminate = term;
  console.log("[terminate]", JSON.stringify(term), "[stderr]", (getStderrTail() || "").slice(-300));
  fs.writeFileSync(path.join(ROOT, "reports", tag + ".json"), JSON.stringify(report, null, 2));
}
