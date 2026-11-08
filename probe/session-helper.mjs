// session-helper.mjs — 0B/0C 套件共享：启动 + 宿主同构引导 + 会话工具
// 引导序列（0B 实测确立）：
//   spawn → answer session/requestRuntimePreferences(两 scope) →
//   provider/updateAccountConfig(宿主同构, builtinModelIds 绑定模型) →
//   session/create(with model+reasoningLevel) → session/subscribe →
//   answer interaction/requestProviderRuntimeHeaders(requestAuth.apiKey = 共享登录态 JWT)
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { launchAppServer, terminate } from "./launcher.mjs";
import { createRpcClient } from "./rpc-client.mjs";
import { decryptCredential } from "./credential-reader.mjs";

export const ENV_BUILTIN = "C:/Program Files/ZCode/resources/config/provider/zcode-builtin.json";
export const MODEL = { providerId: process.env.PROBE_PROVIDER || "account:bigmodel-start-plan", modelId: process.env.PROBE_MODEL || "GLM-5.3-Flash", reasoningLevel: process.env.PROBE_LEVEL || "high" };

export function builtinBasedOn() {
  const h = crypto.createHash("sha256").update(path.resolve(ENV_BUILTIN)).digest("hex");
  return `zcode-builtin:43:${h}`;
}

export function buildAccountPayload(modelId = MODEL.modelId) {
  const basedOn = builtinBasedOn();
  const families = ["zai", "bigmodel"];
  const kinds = ["individual-coding-plan", "team-coding-plan", "start-plan", "offpeak-idle-plan", "highspeed-card"];
  const providersRecord = {}, providersArr = [], states = {};
  for (const f of families) for (const k of kinds) {
    const id = `account:${f}-${k}`;
    const isMine = id === MODEL.providerId;
    providersRecord[id] = { access: { type: "zhipu-account", entitled: isMine }, ...(isMine ? { builtinModelIds: [modelId] } : {}) };
    providersArr.push({ providerId: id, config: providersRecord[id] });
    states[id] = { availability: isMine ? "available" : "unavailable", entitled: isMine, current: isMine, ...(isMine ? {} : { unavailableReason: f === "zai" ? "not-connected" : "not-entitled" }) };
  }
  const revision = "account:" + JSON.stringify([basedOn, providersArr, states]);
  return { revision, basedOnZCodeBuiltinRevision: basedOn, providers: providersRecord, states };
}

export async function launchBootstrapped({ cwd, traceFile, authHeader = "jwt-apikey" }) {
  const { child, spawnMeta, getStderrTail } = launchAppServer({ cwd, traceFile, env: { ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: ENV_BUILTIN } });
  const rpc = createRpcClient({ child, traceFile });
  const state = { child, rpc, spawnMeta, getStderrTail, sessionId: null, runtimeHeadersAsked: 0, inboundLog: [] };

  rpc.onInboundRequest("session/requestRuntimePreferences", () => ({
    nativeSearchEnhancementsEnabled: false, toolSearchMode: "off", memoryEnabled: false,
    askUserQuestionAutoResolutionEnabled: true, modelContextBudgetStrategy: "preflight-v1",
  }));
  rpc.onInboundRequest("interaction/requestProviderRuntimeHeaders", (params) => {
    state.runtimeHeadersAsked++;
    state.inboundLog.push({ method: "interaction/requestProviderRuntimeHeaders", reason: params?.reason, attempt: params?.attempt });
    if (authHeader === "none") return { headersApplied: false, errorMessage: "probe: disabled" };
    const token = authHeader === "access-apikey" ? decryptCredential("oauth:bigmodel:access_token") : decryptCredential("zcodejwttoken");
    if (!token) return { headersApplied: false, errorMessage: "probe: decrypt failed" };
    return { headersApplied: true, requestAuth: { apiKey: token } };
  });
  // 权限/用户输入等其余入站交互：交给场景注册的 handler；无 handler 时挂起等待
  rpc.onInboundRequest("__default__", () => ({}));

  await rpc.request("provider/updateAccountConfig", buildAccountPayload(), { timeoutMs: 15000 });
  return state;
}

export async function createSession(rpc, cwd) {
  const res = await rpc.request("session/create", {
    workspace: { workspacePath: cwd, workspaceKey: path.basename(cwd) },
    model: { providerId: MODEL.providerId, modelId: MODEL.modelId, options: { reasoningLevel: MODEL.reasoningLevel } },
  }, { timeoutMs: 30000 });
  return res;
}

export async function subscribe(rpc, sessionId) {
  return rpc.request("session/subscribe", { sessionId, deliveryKind: "desktop-continuous", includeSnapshot: true }, { timeoutMs: 20000 });
}

export async function sendAndWaitTurnEnd(rpc, sessionId, content, { timeoutMs = 120_000, withModelSelection = true } = {}) {
  const events = [];
  const off = rpc.onNotification(msg => { if (msg.method === "session/event" && msg.params?.sessionId === sessionId) events.push(msg.params); });
  const params = { sessionId, content };
  if (withModelSelection) params.modelSelection = { providerId: MODEL.providerId, modelId: MODEL.modelId, options: { reasoningLevel: MODEL.reasoningLevel } };
  const sendRes = await rpc.request("session/send", params, { timeoutMs: 20000 });
  const t0 = Date.now();
  let end = null;
  const chunks = [];
  while (Date.now() - t0 < timeoutMs && !end) {
    await new Promise(r => setTimeout(r, 300));
    for (const ev of events) {
      if (["turn.completed", "turn.failed", "turn.terminal"].includes(ev.type) && !end) end = ev;
      if (ev.type === "model.streaming" && ev.payload?.kind === "text_delta") chunks.push(ev.payload?.delta ?? "");
    }
  }
  off(); // 移除监听（onNotification 返回 undefined 亦无害）
  return { sendRes, end, events, replyText: chunks.join("") };
}

export async function getMessages(rpc, sessionId) {
  return rpc.request("session/messages", { sessionId }, { timeoutMs: 15000 });
}

// 强杀进程树（Windows）：taskkill /T /F
import { spawn as nodeSpawn } from "node:child_process";
export async function killTree(child) {
  await new Promise(r => { const tk = nodeSpawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { shell: false, windowsHide: true }); tk.on("exit", r); tk.on("error", r); });
}
