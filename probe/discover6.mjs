// discover6.mjs — 补齐宿主启动序列：create → provider/updateAccountConfig → refreshRegistry → setModel/send
// 账户配置镜像桌面 registry.ready 中的 accountRevision 内容（entitled:false 原样，真实权益由服务端计费侧决定）
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { launchAppServer, terminate } from "./launcher.mjs";
import { createRpcClient } from "./rpc-client.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW = path.join(ROOT, "traces", "raw");
const WS = path.join(ROOT, "traces", "workspace");
fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(WS, { recursive: true });

const providerId = process.argv[2] || "account:bigmodel-start-plan";
const modelId = process.argv[3] || "GLM-5.3-Flash";
const traceFile = path.join(RAW, "discover6.jsonl");
const report = { providerId, modelId, steps: {} };
const events = [];
function trunc(v, n = 700) { const s = JSON.stringify(v); return s && s.length > n ? s.slice(0, n) + `…(+${s.length - n})` : s; }

// 账户配置（与桌面推送同构；entitled:false 与桌面日志一致）
const ACCOUNT_FAMILIES = ["zai", "bigmodel"];
const ACCOUNT_KINDS = ["individual-coding-plan", "team-coding-plan", "start-plan", "offpeak-idle-plan", "highspeed-card"];
const providers = {};
for (const fam of ACCOUNT_FAMILIES) {
  for (const kind of ACCOUNT_KINDS) {
    const id = `account:${fam}-${kind}`;
    providers[id] = { access: { type: "zhipu-account", entitled: false } };
  }
}
// 内置直连 provider（builtin:bigmodel / builtin:zai）也一并镜像
providers["builtin:bigmodel"] = { access: null };
providers["builtin:zai"] = { access: null };
const states = {};
for (const id of Object.keys(providers)) {
  states[id] = { availability: "available", entitled: false };
}
// revision 仿桌面格式: zcode-builtin:<n>:<sha256-of-builtin-config>
const builtinCfg = fs.readFileSync("C:/Program Files/ZCode/resources/config/provider/zcode-builtin.json");
const builtinHash = crypto.createHash("sha256").update(builtinCfg).digest("hex");
const accountPayload = {
  revision: `zcode-builtin:43:${builtinHash}`,
  basedOnZCodeBuiltinRevision: builtinHash,
  providers,
  states,
};

const { child, spawnMeta, getStderrTail } = launchAppServer({ cwd: WS, traceFile });
console.log("[spawn] node=" + spawnMeta.nodeVersion);
const rpc = createRpcClient({ child, traceFile });
rpc.onInboundRequest("session/requestRuntimePreferences", () => ({
  nativeSearchEnhancementsEnabled: false, toolSearchMode: "off", memoryEnabled: false,
  askUserQuestionAutoResolutionEnabled: true, modelContextBudgetStrategy: "preflight-v1",
}));
rpc.onNotification(msg => { if (msg.method === "session/event") events.push(msg.params); });

try {
  // 1) 先推账户配置（宿主在 create 前推送；此处先试 create 前后两种时序）
  const upd = await rpc.request("provider/updateAccountConfig", accountPayload, { timeoutMs: 15000 });
  report.steps.updateAccountConfig = trunc(upd, 400);
  console.log("[updateAccountConfig]", trunc(upd, 300));

  const ref = await rpc.request("provider/refreshRegistry", { reason: "probe" }, { timeoutMs: 15000 });
  report.steps.refreshRegistry = trunc(ref, 200);
  console.log("[refreshRegistry]", trunc(ref, 150));

  // 2) 创建会话（此时可尝试带 model）
  let createRes, sessionId;
  try {
    createRes = await rpc.request("session/create", {
      workspace: { workspacePath: WS, workspaceKey: "workspace" },
      model: { providerId, modelId },
    }, { timeoutMs: 30000 });
    report.steps.create = { withModel: true, ok: true };
    console.log("[create] with model OK");
  } catch (e) {
    report.steps.create = { withModel: true, ok: false, error: trunc(e, 300) };
    console.log("[create] with model 失败:", trunc(e, 250), "→ 回退无 model 创建");
    createRes = await rpc.request("session/create", { workspace: { workspacePath: WS, workspaceKey: "workspace" } }, { timeoutMs: 30000 });
  }
  sessionId = createRes?.session?.sessionId;
  console.log("[create] sessionId=" + sessionId);

  await rpc.request("session/subscribe", { sessionId, deliveryKind: "desktop-continuous", includeSnapshot: true }, { timeoutMs: 20000 });

  // 3) 轮询模型注册
  let avail = [], waited = 0;
  const tw = Date.now();
  while (Date.now() - tw < 60_000) {
    const rd = await rpc.request("session/read", { sessionId }, { timeoutMs: 10000 }).catch(() => null);
    avail = rd?.settings?.model?.available ?? [];
    if (avail.length) break;
    await new Promise(r => setTimeout(r, 2000));
    waited = Date.now() - tw;
  }
  report.steps.models = { count: avail.length, waitedMs: waited, sample: trunc(avail.slice(0, 5), 600) };
  console.log("[models] count=" + avail.length, trunc(avail.slice(0, 3), 300));

  // 4) setModel + send
  if (avail.length) {
    try {
      const sm = await rpc.request("session/setModel", { sessionId, model: { providerId, modelId } }, { timeoutMs: 15000 });
      report.steps.setModel = { ok: true, r: trunc(sm, 300) };
      console.log("[setModel] OK");
    } catch (e) { report.steps.setModel = { ok: false, error: trunc(e, 300) }; console.log("[setModel] 失败:", trunc(e, 250)); }
  }
  const sendParams = { sessionId, content: "Reply with exactly: OK" };
  if (!avail.length) sendParams.modelSelection = { providerId, modelId };
  await rpc.request("session/send", sendParams, { timeoutMs: 20000 });

  // 5) 等回合结束
  const t0 = Date.now(); let end = null; const chunks = [];
  while (Date.now() - t0 < 120_000 && !end) {
    await new Promise(r => setTimeout(r, 400));
    for (const ev of events) {
      if (["turn.completed", "turn.failed", "turn.terminal"].includes(ev.type) && !end) end = ev;
      if (ev.type === "model.streaming" && ev.payload?.kind === "text_delta") chunks.push(ev.payload?.delta ?? "");
    }
  }
  report.steps.turn = end ? { type: end.type, payload: trunc(end.payload, 1100) } : { timeout: true };
  report.replyText = chunks.join("").slice(0, 200);
  console.log("[reply]", JSON.stringify(report.replyText));
  console.log("[turn]", JSON.stringify(report.steps.turn));

  if (end?.type === "turn.completed") {
    report.usage = end.payload?.usage ?? null;
    console.log("[usage]", trunc(report.usage, 600));
  }
} catch (e) {
  report.fatal = trunc(e, 600);
  console.error("[fatal]", trunc(e, 400));
} finally {
  report.terminate = await terminate(child, { mode: "graceful" });
  console.log("[term]", JSON.stringify(report.terminate), "[stderr]", (getStderrTail() || "").slice(-200));
  fs.writeFileSync(path.join(ROOT, "reports", "discover6.json"), JSON.stringify(report, null, 2));
}
