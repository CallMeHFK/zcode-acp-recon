// discover.mjs — 0B 首次活体接触：探测 session/create·subscribe·send 的真实参数与事件信封
// 只做一次最小推理（"Reply with exactly: OK"），全部原始 JSONL 落 traces/raw/discover.jsonl
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

const traceFile = path.join(RAW, "discover.jsonl");
const events = [];
const seenTypes = new Map();
const report = { create: null, subscribe: null, send: null, eventTypes: {}, turnEnd: null, errors: [] };

function trunc(v, n = 700) { const s = JSON.stringify(v); return s && s.length > n ? s.slice(0, n) + `…(+${s.length - n})` : s; }

const { child, spawnMeta, getStderrTail } = launchAppServer({ cwd: WS, traceFile });
console.log("[spawn]", JSON.stringify(spawnMeta));
const rpc = createRpcClient({ child, traceFile });

rpc.onNotification(msg => {
  const t = msg.method === "session/event" ? `session/event:${msg.params?.type ?? "?"}` : msg.method;
  seenTypes.set(t, (seenTypes.get(t) || 0) + 1);
  if (!report.eventTypes[t]) report.eventTypes[t] = { method: msg.method, paramsShape: trunc(msg.params, 900) };
  if (msg.method === "session/event") events.push(msg.params);
  else events.push({ type: `__notify__${msg.method}`, payload: msg.params });
});

try {
  // ---- session/create 参数变体探测 ----
  const createVariants = [
    ["empty", {}],
    ["workspace-obj", { workspace: { workspacePath: WS, workspaceKey: "workspace" } }],
    ["workspace-flat", { workspacePath: WS, workspaceKey: "workspace" }],
    ["cwd", { cwd: WS }],
  ];
  let sessionId = null;
  for (const [label, params] of createVariants) {
    try {
      const res = await rpc.request("session/create", params, { timeoutMs: 20000 });
      report.create = { ok: true, variant: label, params: trunc(params, 300), responseShape: trunc(res, 1200) };
      sessionId = res?.session?.sessionId ?? res?.sessionId ?? res?.session?.id ?? null;
      console.log(`[create] OK via "${label}" → sessionId=${sessionId}\n  response: ${trunc(res, 800)}`);
      break;
    } catch (e) {
      const errText = trunc(e, 300);
      report.create = report.create || { ok: false };
      report.errors.push({ step: "create", variant: label, error: errText });
      console.log(`[create] "${label}" 失败: ${errText}`);
      if (String(e?.message || "").includes("timeout")) break;
    }
  }
  if (!sessionId) throw new Error("session/create 所有变体均失败");

  // ---- session/subscribe 变体 ----
  const subVariants = [
    ["desktop-continuous", { sessionId, deliveryKind: "desktop-continuous", includeSnapshot: true }],
    ["plain", { sessionId, includeSnapshot: true }],
    ["minimal", { sessionId }],
  ];
  let subRes = null, subVariant = null;
  for (const [label, params] of subVariants) {
    try {
      subRes = await rpc.request("session/subscribe", params, { timeoutMs: 20000 });
      subVariant = label;
      console.log(`[subscribe] OK via "${label}" → ${trunc(subRes, 600)}`);
      break;
    } catch (e) {
      report.errors.push({ step: "subscribe", variant: label, error: trunc(e, 300) });
      console.log(`[subscribe] "${label}" 失败: ${trunc(e, 200)}`);
    }
  }
  report.subscribe = { ok: !!subRes, variant: subVariant, responseShape: trunc(subRes, 1200) };
  if (subRes?.snapshot) console.log("[subscribe.snapshot keys]", Object.keys(subRes.snapshot));

  // ---- session/send 内容变体（最小推理） ----
  const sendVariants = [
    ["string", { sessionId, content: "Reply with exactly: OK" }],
    ["text-blocks", { sessionId, content: [{ type: "text", text: "Reply with exactly: OK" }] }],
  ];
  let sendOk = null;
  for (const [label, params] of sendVariants) {
    try {
      const res = await rpc.request("session/send", params, { timeoutMs: 20000 });
      sendOk = { variant: label, response: trunc(res, 400) };
      console.log(`[send] OK via "${label}" → ${trunc(res, 300)}`);
      break;
    } catch (e) {
      report.errors.push({ step: "send", variant: label, error: trunc(e, 300) });
      console.log(`[send] "${label}" 失败: ${trunc(e, 200)}`);
    }
  }
  report.send = sendOk || { ok: false };

  // ---- 等待 turn 结束 ----
  const t0 = Date.now();
  let turnEnded = null;
  while (Date.now() - t0 < 120_000 && !turnEnded) {
    await new Promise(r => setTimeout(r, 500));
    for (const ev of events) {
      if ((ev.type === "turn.completed" || ev.type === "turn.failed" || ev.type === "turn.terminal") && !turnEnded) {
        turnEnded = { type: ev.type, payload: trunc(ev.payload, 900) };
      }
    }
  }
  report.turnEnd = turnEnded || { timeout: true, eventCount: events.length };
  console.log("[turnEnd]", JSON.stringify(turnEnded));
  console.log("[eventTypes]", JSON.stringify(Object.fromEntries(seenTypes)));
} catch (e) {
  report.errors.push({ step: "fatal", error: trunc(e, 500) });
  console.error("[fatal]", e);
} finally {
  const term = await terminate(child, { mode: "graceful" });
  console.log("[terminate]", JSON.stringify(term));
  console.log("[stderr tail]", (getStderrTail() || "").slice(-600));
  console.log("[reader.stats]", JSON.stringify(rpc.reader.stats));
  fs.writeFileSync(path.join(ROOT, "reports", "discover.json"), JSON.stringify(report, null, 2));
}
