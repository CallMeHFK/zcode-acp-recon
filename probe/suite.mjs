// suite.mjs — Phase 0B/0C 场景套件：normal / permission-allow / permission-deny / cancel / crash / resume(graceful|force)
// 每场景产出 traces/raw/<scenario>.jsonl（原始）与元数据；脱敏导出由 export-sanitized.mjs 完成
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { terminate } from "./launcher.mjs";
import { launchBootstrapped, createSession, subscribe, sendAndWaitTurnEnd, getMessages, killTree, MODEL, ENV_BUILTIN, builtinBasedOn, buildAccountPayload } from "./session-helper.mjs";
import { createRpcClient } from "./rpc-client.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW = path.join(ROOT, "traces", "raw");
const WS = path.join(ROOT, "traces", "workspace");
fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(WS, { recursive: true });

const only = process.argv[2] || ""; // 可传单场景名调试
const results = {};
function trunc(v, n = 700) { const s = JSON.stringify(v); return s && s.length > n ? s.slice(0, n) + `…(+${s.length - n})` : s; }
const shouldRun = name => !only || only === name;

// 权限请求处理器注册：记录请求并按场景决策（allow/deny）
function registerPermission(rpc, state, decide) {
  rpc.onInboundRequest("interaction/requestPermission", (params) => {
    state.inboundLog.push({ method: "interaction/requestPermission", toolName: params?.toolName, requestId: params?.requestId, options: (params?.options || []).map(o => ({ optionId: o.optionId, kind: o.kind, name: o.name })) });
    state.lastPermissionRequest = params;
    return decide(params);
  });
  rpc.onInboundRequest("interaction/requestUserInput", (params) => {
    state.inboundLog.push({ method: "interaction/requestUserInput", schema: params?.schema?.interaction, questions: Array.isArray(params?.questions) ? params.questions.length : undefined });
    state.lastUserInputRequest = params;
    return { action: "cancel" };
  });
}

function pickOption(params, kindPrefix) {
  const opt = (params?.options || []).find(o => String(o.kind || "").startsWith(kindPrefix));
  return opt ? { optionId: opt.optionId } : { action: kindPrefix.startsWith("allow") ? "accept" : "decline" };
}

async function withFreshApp(traceName, { authHeader } = {}) {
  const traceFile = path.join(RAW, traceName + ".jsonl");
  const state = await launchBootstrapped({ cwd: WS, traceFile, authHeader });
  state.traceFile = traceFile;
  return state;
}

// ---------- 场景 ----------
async function scenarioNormal() {
  results.normal = {};
  const st = await withFreshApp("normal");
  try {
    const cr = await createSession(st.rpc, WS);
    st.sessionId = cr?.session?.sessionId;
    await subscribe(st.rpc, st.sessionId);
    const { end, replyText, events } = await sendAndWaitTurnEnd(st.rpc, st.sessionId, "Reply with exactly: OK");
    const seqs = events.map(e => e.seq).filter(s => typeof s === "number");
    results.normal = {
      ok: end?.type === "turn.completed",
      reply: replyText.slice(0, 100),
      turnEnd: end ? { type: end.type, resultType: end.payload?.resultType, usageSource: end.payload?.usage?.source } : null,
      seq: { count: seqs.length, continuous: seqs.every((s, i) => i === 0 || s === seqs[i - 1] + 1) },
      eventTypes: [...new Set(events.map(e => e.type))],
    };
  } finally { results.normal.terminate = await terminate(st.child, { mode: "graceful" }); }
}

async function scenarioPermission(kind) {
  const name = "permission-" + kind;
  results[name] = {};
  const st = await withFreshApp(name);
  try {
    registerPermission(st.rpc, st, params => pickOption(params, kind));
    const cr = await createSession(st.rpc, WS);
    st.sessionId = cr?.session?.sessionId;
    await subscribe(st.rpc, st.sessionId);
    const { end, events } = await sendAndWaitTurnEnd(st.rpc, st.sessionId,
      "请在当前目录创建名为 probe-permission-test.txt 的文件，内容为一行文字 hello，然后告诉我创建结果。", { timeoutMs: 150_000 });
    const toolEvents = events.filter(e => e.type === "tool.updated");
    results[name] = {
      ok: end?.type === "turn.completed",
      permissionAsked: !!st.lastPermissionRequest,
      permissionRequestShape: st.lastPermissionRequest ? {
        keys: Object.keys(st.lastPermissionRequest),
        toolName: st.lastPermissionRequest.toolName,
        options: (st.lastPermissionRequest.options || []).map(o => ({ optionId: o.optionId, kind: o.kind, name: o.name })),
      } : null,
      decisionSent: kind,
      toolKinds: toolEvents.map(e => e.payload?.kind),
      toolNames: [...new Set(toolEvents.map(e => e.payload?.toolName))],
      turnEnd: end ? { type: end.type, resultType: end.payload?.resultType, error: end.payload?.error?.code } : null,
      fileCreated: fs.existsSync(path.join(WS, "probe-permission-test.txt")),
      inboundLog: st.inboundLog,
    };
    if (kind === "allow" && st.lastPermissionRequest) {
      // 落盘完整请求 JSON（脱敏由导出器处理）
      results[name].fullPermissionRequest = st.lastPermissionRequest;
    }
  } finally { results[name].terminate = await terminate(st.child, { mode: "graceful" }); }
}

async function scenarioCancel() {
  results.cancel = {};
  const st = await withFreshApp("cancel");
  try {
    const cr = await createSession(st.rpc, WS);
    st.sessionId = cr?.session?.sessionId;
    await subscribe(st.rpc, st.sessionId);
    const events = [];
    const off = st.rpc.onNotification(msg => { if (msg.method === "session/event" && msg.params?.sessionId === st.sessionId) events.push(msg.params); });
    await st.rpc.request("session/send", { sessionId: st.sessionId, content: "请从 1 数到 60，每行输出一个数字，不要省略。", modelSelection: { providerId: MODEL.providerId, modelId: MODEL.modelId, options: { reasoningLevel: MODEL.reasoningLevel } } }, { timeoutMs: 20000 });
    // 等 turn.started 后短暂等待即取消（high reasoning 可能长时间无文本增量）
    let started = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 60_000 && !started) {
      await new Promise(r => setTimeout(r, 300));
      started = events.some(e => e.type === "turn.started");
    }
    await new Promise(r => setTimeout(r, 5000));
    const cancelAt = Date.now() - t0;
    // session/stop 以请求形式发送（handler 返回 {}；通知形式不保证路由）
    let stopRes = null;
    try { stopRes = await st.rpc.request("session/stop", { sessionId: st.sessionId }, { timeoutMs: 10000 }); } catch (e) { stopRes = { error: trunc(e, 150) }; }
    let end = null;
    const t1 = Date.now();
    while (Date.now() - t1 < 60_000 && !end) {
      await new Promise(r => setTimeout(r, 300));
      end = events.find(e => ["turn.completed", "turn.failed", "turn.terminal"].includes(e.type)) || end;
    }
    off();
    results.cancel = {
      startedBeforeCancel: started,
      cancelAfterMs: cancelAt,
      stopResponse: trunc(stopRes, 200),
      turnEndAfterCancel: end ? { type: end.type, resultType: end.payload?.resultType, errorCode: end.payload?.error?.code, errorMessage: String(end.payload?.error?.message || "").slice(0, 160) } : null,
      postCancelEventCount: events.length,
      postCancelEventTypes: events.slice(-6).map(e => e.type),
    };
  } finally { results.cancel.terminate = await terminate(st.child, { mode: "graceful" }); }
}

async function doResumeFlow(mode) {
  const name = "resume-" + mode;
  results[name] = {};
  const st = await withFreshApp(name);
  let resumeState;
  try {
    const cr = await createSession(st.rpc, WS);
    st.sessionId = cr?.session?.sessionId;
    await subscribe(st.rpc, st.sessionId);
    const r1 = await sendAndWaitTurnEnd(st.rpc, st.sessionId, "请记住数字 47，然后只回复 OK。");
    const before = await getMessages(st.rpc, st.sessionId);
    const lastSeq = Math.max(0, ...[]); // 从 events 无法直接取——改由 subscribe eventSeq
    if (mode === "graceful") await terminate(st.child, { mode: "graceful" });
    else { await killTree(st.child); }
    await new Promise(r => setTimeout(r, 1500));

    // 新进程恢复：先 session/resume（跨进程载入），再 subscribe
    resumeState = await withFreshApp(name + "-reconnect");
    const rpc2 = resumeState.rpc;
    const resumed = await rpc2.request("session/resume", { sessionId: st.sessionId, workspace: { workspacePath: WS, workspaceKey: "workspace" } }, { timeoutMs: 30000 }).catch(e => ({ error: trunc(e, 200) }));
    const sub = await rpc2.request("session/subscribe", { sessionId: st.sessionId, deliveryKind: "desktop-continuous", includeSnapshot: true }, { timeoutMs: 20000 }).catch(e => ({ error: trunc(e, 200) }));
    results[name].resumeCall = resumed?.error ? { error: resumed.error } : { sessionKeys: Object.keys(resumed?.session || {}) };
    const msgs2 = await getMessages(rpc2, st.sessionId).catch(e => ({ error: trunc(e, 200) }));
    // 历史一致性粗比较：条数与首条用户文本
    const beforeMsgs = before?.messages ?? [];
    const afterMsgs = msgs2?.messages ?? [];
    const sameCount = beforeMsgs.length === afterMsgs.length && beforeMsgs.length > 0;
    // 历史保留检查：恢复后的消息体中能找到首条提示中的关键数字
    const preserved = JSON.stringify(afterMsgs).includes("47");
    // 继续对话
    const r2 = await sendAndWaitTurnEnd(rpc2, st.sessionId, "我刚才请你记住的数字是多少？只回答这个数字。", { timeoutMs: 120_000 });
    results[name] = {
      firstTurn: { ok: r1.end?.type === "turn.completed", reply: r1.replyText.slice(0, 40) },
      exitMode: mode,
      reconnectSubscribe: sub?.error ? { error: sub.error } : { eventSeq: sub?.eventSeq, snapshotMessages: sub?.snapshot?.messages?.length ?? null },
      historyCompare: { beforeCount: beforeMsgs.length, afterCount: afterMsgs.length, sameCount, preserved },
      continueTurn: { ok: r2.end?.type === "turn.completed", reply: r2.replyText.slice(0, 60), rememberedCorrect: r2.replyText.includes("47") },
      ok: sameCount && preserved && r2.end?.type === "turn.completed" && r2.replyText.includes("47"),
    };
  } catch (e) {
    results[name] = { fatal: trunc(e, 400) };
  } finally {
    if (resumeState) results[name].terminate = await terminate(resumeState.child, { mode: "graceful" });
    else if (st.child.exitCode === null) results[name].terminate = await terminate(st.child, { mode: "force" });
  }
}

async function scenarioCrash() {
  results.crash = {};
  const st = await withFreshApp("crash");
  let resumeState;
  try {
    const cr = await createSession(st.rpc, WS);
    st.sessionId = cr?.session?.sessionId;
    await subscribe(st.rpc, st.sessionId);
    const events = [];
    const off = st.rpc.onNotification(msg => { if (msg.method === "session/event" && msg.params?.sessionId === st.sessionId) events.push(msg.params); });
    await st.rpc.request("session/send", { sessionId: st.sessionId, content: "请从 1 数到 60，每行输出一个数字。", modelSelection: { providerId: MODEL.providerId, modelId: MODEL.modelId, options: { reasoningLevel: MODEL.reasoningLevel } } }, { timeoutMs: 20000 });
    let started = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 60_000 && !started) {
      await new Promise(r => setTimeout(r, 300));
      started = events.some(e => e.type === "turn.started");
    }
    const killedAt = Date.now() - t0;
    await killTree(st.child); // 回合进行中强杀
    off();
    // 新进程恢复：观察被中断回合的状态
    resumeState = await withFreshApp("crash-reconnect");
    const rpc2 = resumeState.rpc;
    const resumed = await rpc2.request("session/resume", { sessionId: st.sessionId, workspace: { workspacePath: WS, workspaceKey: "workspace" } }, { timeoutMs: 30000 }).catch(e => ({ error: trunc(e, 200) }));
    const sub = await rpc2.request("session/subscribe", { sessionId: st.sessionId, deliveryKind: "desktop-continuous", includeSnapshot: true }, { timeoutMs: 20000 }).catch(e => ({ error: trunc(e, 200) }));
    const proj = sub?.snapshot?.projection ?? resumed?.projection ?? null;
    const r2 = await sendAndWaitTurnEnd(rpc2, st.sessionId, "继续：请从 1 数到 5，每行一个数字。", { timeoutMs: 120_000 }).catch(e => ({ fatal: trunc(e, 200) }));
    results.crash = {
      turnStartedBeforeKill: started,
      killedAtMs: killedAt,
      resumeCall: resumed?.error ? { error: resumed.error } : { ok: true },
      snapshotProjection: proj ? { status: proj.status, turnCount: proj.turnCount } : null,
      continueAfterCrash: r2.fatal ? { fatal: r2.fatal } : { ok: r2.end?.type === "turn.completed", resultType: r2.end?.payload?.resultType, reply: r2.replyText.slice(0, 40) },
      ok: !!proj && !r2.fatal && r2.end?.type === "turn.completed",
    };
  } catch (e) { results.crash.fatal = trunc(e, 400); }
  finally {
    if (resumeState) results.crash.terminate = await terminate(resumeState.child, { mode: "graceful" });
    else if (st.child.exitCode === null) results.crash.terminate = await terminate(st.child, { mode: "force" });
  }
}

// ---------- G8 断连场景：客户端断开（stdin 关闭，不杀后端），观察后端是否继续执行 ----------
async function scenarioDisconnect() {
  results.disconnect = {};
  const orphanProbe = path.join(RAW, "disconnect-probe.jsonl");
  const st = await launchBootstrapped({ cwd: WS, traceFile: orphanProbe });
  let resumeState = null;
  try {
    // 断连期间后端会调用 requestProviderRuntimeHeaders —— 无人应答会导致模型请求挂起/失败；
    // 记录该行为本身就是 G8 证据（后端是否在无人值守下继续推进）。
    const cr = await createSession(st.rpc, WS);
    st.sessionId = cr?.session?.sessionId;
    await subscribe(st.rpc, st.sessionId);
    // 独立文件副作用标记：让模型写一个特定文件
    const marker = path.join(WS, "disconnect-marker.txt");
    try { fs.rmSync(marker, { force: true }); } catch {}
    await st.rpc.request("session/send", { sessionId: st.sessionId, content: "请创建文件 disconnect-marker.txt，内容为一行文字 done，然后回复 OK。", modelSelection: { providerId: MODEL.providerId, modelId: MODEL.modelId, options: { reasoningLevel: "low" } } }, { timeoutMs: 20000 });
    // 等模型开始流式输出即断开（不杀后端）
    const events = [];
    const off = st.rpc.onNotification(msg => { if (msg.method === "session/event" && msg.params?.sessionId === st.sessionId) events.push(msg.params); });
    let started = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 60_000 && !started) {
      await new Promise(r => setTimeout(r, 300));
      started = events.some(e => e.type === "turn.started");
    }
    const disconnectAt = Date.now() - t0;
    try { st.child.stdin.end(); } catch {}
    off();
    // 等待观察窗口（后端是否在无客户端情况下继续完成回合/工具）
    await new Promise(r => setTimeout(r, 45_000));
    const markerAfterWindow = fs.existsSync(marker);
    // 重连新进程观察状态
    resumeState = await withFreshApp("disconnect-reconnect");
    const rpc2 = resumeState.rpc;
    await rpc2.request("session/resume", { sessionId: st.sessionId, workspace: { workspacePath: WS, workspaceKey: "workspace" } }, { timeoutMs: 30000 }).catch(e => ({}));
    const sub = await rpc2.request("session/subscribe", { sessionId: st.sessionId, deliveryKind: "desktop-continuous", includeSnapshot: true }, { timeoutMs: 20000 }).catch(e => ({ error: trunc(e, 150) }));
    const proj = sub?.snapshot?.projection ?? null;
    const msgs = await getMessages(rpc2, st.sessionId).catch(() => null);
    results.disconnect = {
      turnStartedBeforeDisconnect: started,
      disconnectAfterMs: disconnectAt,
      markerCreatedWhileDisconnected: markerAfterWindow,
      projectionAfterReconnect: proj ? { status: proj.status, turnCount: proj.turnCount } : null,
      historyCount: Array.isArray(msgs?.messages) ? msgs.messages.length : null,
      // 四层观察：①RPC 通道断开（事实）②后端回合是否完成 ③外部副作用(文件) ④重连后状态
      fourLayers: {
        rpcChannelClosed: true,
        backendTurnCompletedWhileDisconnected: proj?.turnCount ? proj.turnCount >= 1 : "unknown",
        externalSideEffect: markerAfterWindow,
        reconnectState: proj?.status ?? "unknown",
      },
    };
  } catch (e) { results.disconnect.fatal = trunc(e, 400); }
  finally {
    if (resumeState) results.disconnect.terminate = await terminate(resumeState.child, { mode: "graceful" });
    // 断连的孤儿后端：清理（避免残留进程）
    if (st.child.exitCode === null) { await terminate(st.child, { mode: "force" }); results.disconnect.orphanBackendCleaned = true; }
  }
}

// ---------- 执行 ----------
(async () => {
  if (shouldRun("normal")) { console.log("== normal =="); await scenarioNormal(); console.log(JSON.stringify(results.normal)); }
  if (shouldRun("permission-allow")) { console.log("== permission-allow =="); await scenarioPermission("allow"); console.log(JSON.stringify({ ...results["permission-allow"], fullPermissionRequest: undefined })); }
  if (shouldRun("permission-deny")) { console.log("== permission-deny =="); await scenarioPermission("deny"); console.log(JSON.stringify(results["permission-deny"])); }
  if (shouldRun("cancel")) { console.log("== cancel =="); await scenarioCancel(); console.log(JSON.stringify(results.cancel)); }
  if (shouldRun("crash")) { console.log("== crash =="); await scenarioCrash(); console.log(JSON.stringify(results.crash)); }
  if (shouldRun("disconnect")) { console.log("== disconnect =="); await scenarioDisconnect(); console.log(JSON.stringify(results.disconnect)); }
  if (shouldRun("resume-graceful")) { console.log("== resume-graceful =="); await doResumeFlow("graceful"); console.log(JSON.stringify(results["resume-graceful"])); }
  if (shouldRun("resume-force")) { console.log("== resume-force =="); await doResumeFlow("force"); console.log(JSON.stringify(results["resume-force"])); }
  fs.writeFileSync(path.join(ROOT, "reports", "suite-results.json"), JSON.stringify(results, null, 2));
  console.log("\nwritten: reports/suite-results.json");
})().catch(e => { console.error("[suite fatal]", e); process.exit(1); });
