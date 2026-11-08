// discover9.mjs — 完整宿主时序复刻：updateAccountConfig(宿主同构负载) → create(with model) → subscribe → send
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { launchAppServer, terminate } from "./launcher.mjs";
import { createRpcClient } from "./rpc-client.mjs";
import * as authModule from "./credential-reader.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW = path.join(ROOT, "traces", "raw");
const WS = path.join(ROOT, "traces", "workspace");
fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(WS, { recursive: true });

const providerId = process.argv[2] || "account:bigmodel-start-plan";
const modelId = process.argv[3] || "GLM-5.3-Flash";
const reasoningLevel = process.argv[4] || undefined;
const traceFile = path.join(RAW, "discover9.jsonl");
const report = { providerId, modelId, steps: {} };
const events = [];
function trunc(v, n = 700) { const s = JSON.stringify(v); return s && s.length > n ? s.slice(0, n) + `…(+${s.length - n})` : s; }

// —— 宿主同构账户负载（依据桌面 2026-11-08 宿主日志交付记录逐字段镜像；connectionKey 省略）——
// basedOnZCodeBuiltinRevision = 子进程对 ZCODE_BUILTIN_PROVIDER_CONFIG_FILE 解析路径的 sha256（见 CLI #n 计算）
const ENV_BUILTIN = "C:/Program Files/ZCode/resources/config/provider/zcode-builtin.json";
const builtinHash = crypto.createHash("sha256").update(path.resolve(ENV_BUILTIN)).digest("hex");
const basedOn = `zcode-builtin:43:${builtinHash}`;
const families = ["zai", "bigmodel"];
const kinds = ["individual-coding-plan", "team-coding-plan", "start-plan", "offpeak-idle-plan", "highspeed-card"];
const providersRecord = {};
const providersArr = [];
const states = {};
for (const f of families) {
  for (const k of kinds) {
    const id = `account:${f}-${k}`;
    const isMine = id === providerId;
    const cfg = { access: { type: "zhipu-account", entitled: isMine }, ...(isMine ? { builtinModelIds: [modelId] } : {}) };
    providersRecord[id] = cfg;
    providersArr.push({ providerId: id, config: cfg });
    states[id] = {
      availability: isMine ? "available" : "unavailable",
      entitled: isMine,
      current: isMine,
      ...(isMine ? {} : { unavailableReason: f === "zai" ? "not-connected" : "not-entitled" }),
    };
  }
}
const revision = "account:" + JSON.stringify([basedOn, providersArr, states]);

const { child, spawnMeta, getStderrTail } = launchAppServer({
  cwd: WS, traceFile,
  env: { ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: ENV_BUILTIN },
});
console.log("[spawn] node=" + spawnMeta.nodeVersion);
const rpc = createRpcClient({ child, traceFile });
rpc.onInboundRequest("session/requestRuntimePreferences", () => ({
  nativeSearchEnhancementsEnabled: false, toolSearchMode: "off", memoryEnabled: false,
  askUserQuestionAutoResolutionEnabled: true, modelContextBudgetStrategy: "preflight-v1",
}));
// 模型请求前的鉴权头供给（与桌面宿主同构；令牌仅在内存，trace 由 redact 阶段脱敏）
const headerVariant = process.env.PROBE_AUTH_HEADER || "jwt-bearer";
rpc.onInboundRequest("interaction/requestProviderRuntimeHeaders", (params) => {
  report.runtimeHeadersAsked = { attempt: params?.attempt, reason: params?.reason, providerId: params?.providerId };
  const { decryptCredential } = authModule;
  if (headerVariant === "none") return { headersApplied: false, errorMessage: "probe: headers disabled" };
  const token =
    headerVariant === "jwt-bearer" ? authModule.decryptCredential("zcodejwttoken") :
    headerVariant === "access-bearer" ? authModule.decryptCredential("oauth:bigmodel:access_token") :
    null;
  if (!token) return { headersApplied: false, errorMessage: "probe: credential decrypt failed" };
  // providerKind=anthropic → 需以 apiKey 形态供给（AI SDK 要求），而非 headers.authorization
  return { headersApplied: true, requestAuth: { apiKey: token } };
});
rpc.onNotification(msg => { if (msg.method === "session/event") events.push(msg.params); });

try {
  const upd = await rpc.request("provider/updateAccountConfig", { revision, basedOnZCodeBuiltinRevision: basedOn, providers: providersRecord, states }, { timeoutMs: 15000 });
  report.steps.updateAccountConfig = trunc(upd, 300);
  console.log("[updateAccountConfig]", trunc(upd, 200));

  const createRes = await rpc.request("session/create", {
    workspace: { workspacePath: WS, workspaceKey: "workspace" },
    model: { providerId, modelId, ...(reasoningLevel ? { options: { reasoningLevel } } : {}) },
  }, { timeoutMs: 30000 });
  const sessionId = createRes?.session?.sessionId;
  report.steps.create = { ok: true, sessionId, modelSettings: trunc(createRes?.settings?.model, 500) };
  console.log("[create with model] OK settings.model:", trunc(createRes?.settings?.model, 350));

  const subRes = await rpc.request("session/subscribe", { sessionId, deliveryKind: "desktop-continuous", includeSnapshot: true }, { timeoutMs: 20000 });
  report.steps.subscribe = { ok: true, eventSeq: subRes?.eventSeq };

  const sendParams = { sessionId, content: "Reply with exactly: OK" };
  if (reasoningLevel) sendParams.modelSelection = { providerId, modelId, options: { reasoningLevel } };
  const sendRes = await rpc.request("session/send", sendParams, { timeoutMs: 20000 });
  report.steps.send = { ok: true, r: trunc(sendRes, 200) };
  console.log("[send]", trunc(sendRes, 150));

  const t0 = Date.now(); let end = null; const chunks = [];
  while (Date.now() - t0 < 120_000 && !end) {
    await new Promise(r => setTimeout(r, 400));
    for (const ev of events) {
      if (["turn.completed", "turn.failed", "turn.terminal"].includes(ev.type) && !end) end = ev;
      if (ev.type === "model.streaming" && ev.payload?.kind === "text_delta") chunks.push(ev.payload?.delta ?? "");
    }
  }
  report.steps.turn = end ? { type: end.type, payload: trunc(end.payload, 1200) } : { timeout: true };
  report.replyText = chunks.join("").slice(0, 200);
  console.log("[reply]", JSON.stringify(report.replyText));
  console.log("[turn]", JSON.stringify(report.steps.turn));
  if (end?.type === "turn.completed") {
    report.usage = end.payload?.usage ?? null;
    console.log("[usage]", trunc(report.usage, 700));
  }
} catch (e) {
  report.fatal = trunc(e, 600);
  console.error("[fatal]", trunc(e, 400));
} finally {
  report.terminate = await terminate(child, { mode: "graceful" });
  console.log("[term]", JSON.stringify(report.terminate), "[stderr]", (getStderrTail() || "").slice(-200));
  fs.writeFileSync(path.join(ROOT, "reports", "discover9.json"), JSON.stringify(report, null, 2));
}
