// discover2.mjs — 按已提取 schema 重探：create → requestRuntimePreferences(反向) → subscribe → send → turn 完成
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

const traceFile = path.join(RAW, "discover2.jsonl");
const report = {};
const events = [];
const seenTypes = new Map();
function trunc(v, n = 800) { const s = JSON.stringify(v); return s && s.length > n ? s.slice(0, n) + `…(+${s.length - n})` : s; }

const { child, spawnMeta, getStderrTail } = launchAppServer({ cwd: WS, traceFile });
console.log("[spawn]", JSON.stringify({ node: spawnMeta.nodeVersion, cli: spawnMeta.cliPath, args: spawnMeta.args }));
const rpc = createRpcClient({ child, traceFile });

// 反向请求：runtime 偏好（schema Uon，nativeSearchEnhancementsEnabled 必填）
rpc.onInboundRequest("session/requestRuntimePreferences", (params) => {
  console.log("[inbound] session/requestRuntimePreferences scope=" + params?.scope);
  return {
    nativeSearchEnhancementsEnabled: false,
    toolSearchMode: "off",
    memoryEnabled: false,
    askUserQuestionAutoResolutionEnabled: true,
    modelContextBudgetStrategy: "preflight-v1",
  };
});
// 其余未知入站请求：先记录再返回空对象（在 trace 中可见）
rpc.onInboundRequest("__unknown__", () => ({}));

rpc.onNotification(msg => {
  const t = msg.method === "session/event" ? `session/event:${msg.params?.type ?? "?"}` : msg.method;
  seenTypes.set(t, (seenTypes.get(t) || 0) + 1);
  if (msg.method === "session/event") events.push(msg.params);
});

try {
  const createRes = await rpc.request("session/create", {
    workspace: { workspacePath: WS, workspaceKey: "workspace" },
  }, { timeoutMs: 30000 });
  const sessionId = createRes?.session?.sessionId ?? createRes?.sessionId;
  report.create = { ok: true, responseShape: trunc(createRes, 1500) };
  console.log("[create] OK sessionId=" + sessionId + "\n  response: " + trunc(createRes, 1000));

  const subRes = await rpc.request("session/subscribe", { sessionId, deliveryKind: "desktop-continuous", includeSnapshot: true }, { timeoutMs: 20000 });
  report.subscribe = { ok: true, responseShape: trunc(subRes, 1500) };
  console.log("[subscribe] OK → " + trunc(subRes, 800));
  if (subRes?.snapshot) {
    console.log("[snapshot keys]", Object.keys(subRes.snapshot));
    if (subRes.snapshot.settings) console.log("[settings]", trunc(subRes.snapshot.settings, 600));
    if (subRes.snapshot.projection) console.log("[projection]", trunc(subRes.snapshot.projection, 400));
  }

  const sendRes = await rpc.request("session/send", { sessionId, content: "Reply with exactly: OK" }, { timeoutMs: 20000 });
  report.send = { ok: true, responseShape: trunc(sendRes, 500) };
  console.log("[send] OK → " + trunc(sendRes, 300));

  const t0 = Date.now();
  let turnEnd = null, lastSeq = null;
  while (Date.now() - t0 < 120_000 && !turnEnd) {
    await new Promise(r => setTimeout(r, 400));
    for (const ev of events) {
      if (typeof ev.seq === "number") lastSeq = ev.seq;
      if (["turn.completed", "turn.failed", "turn.terminal"].includes(ev.type) && !turnEnd) turnEnd = ev;
    }
  }
  report.turnEnd = turnEnd ? { type: turnEnd.type, payload: trunc(turnEnd.payload, 1000) } : { timeout: true, events: events.length };
  report.seq = { lastSeq, count: events.length };
  console.log("[turnEnd]", JSON.stringify(report.turnEnd));
  console.log("[seq]", JSON.stringify(report.seq));
  console.log("[eventTypes]", JSON.stringify(Object.fromEntries(seenTypes)));

  // turn 结束后读 session/read 看投影
  try {
    const readRes = await rpc.request("session/read", { sessionId }, { timeoutMs: 15000 });
    report.read = trunc(readRes, 1500);
    console.log("[read]", trunc(readRes, 800));
  } catch (e) { console.log("[read] 失败", trunc(e, 200)); }
} catch (e) {
  report.fatal = trunc(e, 600);
  console.error("[fatal]", trunc(e, 500));
} finally {
  const term = await terminate(child, { mode: "graceful" });
  console.log("[terminate]", JSON.stringify(term));
  console.log("[stderr tail]", (getStderrTail() || "").slice(-500));
  console.log("[reader.stats]", JSON.stringify(rpc.reader.stats));
  fs.writeFileSync(path.join(ROOT, "reports", "discover2.json"), JSON.stringify(report, null, 2));
}
