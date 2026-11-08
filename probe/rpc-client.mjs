// rpc-client.mjs — ZCode app-server 行分隔 JSON-RPC（无 jsonrpc 字段）客户端
// 支持：出站请求/响应配对、通知分发、入站请求（必须回同 id 响应）。
import { createLineReader, classifyMessage } from "./jsonl-reader.mjs";
import fs from "node:fs";

export function classifyError(err) {
  if (!err || typeof err !== "object") return { kind: "unknown" };
  const code = err.code;
  const msg = String(err.message || "").toLowerCase();
  if (code === -32601 || /method not found|unknown method|not found/i.test(msg)) return { kind: "method_not_found", code };
  if (code === -32602 || /invalid params|invalid argument/i.test(msg)) return { kind: "invalid_params", code };
  if (/auth|unauthorized|forbidden|login|token/i.test(msg) || code === 1301 || code === 1304) return { kind: "auth", code };
  if (code === 1302 || /rate limit/i.test(msg)) return { kind: "rate_limit", code };
  if (code === 1308 || /prompt is running|busy/i.test(msg)) return { kind: "busy", code };
  if (typeof code === "number") return { kind: "server_error", code };
  return { kind: "unknown", code };
}

export function createRpcClient({ child, traceFile, onEvent }) {
  let nextId = 1;
  const pending = new Map();          // 出站: id -> {resolve,reject,timer,method}
  const inboundHandlers = new Map();  // method -> async (params,msg)=>responseResult
  const notificationHandlers = [];    // (msg)=>void
  const reader = createLineReader((obj, rawLine) => {
    if (traceFile) { try { fs.appendFileSync(traceFile, rawLine + "\n"); } catch {} }
    if (obj === null) return; // 非 JSON 行（G9 证据由 reader.stats 汇总）
    const kind = classifyMessage(obj);
    if (kind === "response") {
      const p = pending.get(obj.id);
      if (!p) return;
      pending.delete(obj.id);
      clearTimeout(p.timer);
      if (obj.error) p.reject(obj.error);
      else p.resolve(obj.result);
    } else if (kind === "request") {
      // 入站请求：必须有 handler；回同 id
      const h = inboundHandlers.get(obj.method);
      (async () => {
        let result, error;
        try { result = h ? await h(obj.params, obj) : undefined; }
        catch (e) { error = e; }
        const payload = error
          ? { id: obj.id, error: { code: error.code ?? -32603, message: String(error.message || "internal") } }
          : { id: obj.id, result: result === undefined ? {} : result };
        sendRaw(payload);
      })();
    } else if (kind === "notification") {
      for (const h of notificationHandlers) { try { h(obj); } catch {} }
    }
  });

  child.stdout.on("data", d => reader.push(d));
  const stdoutEnd = new Promise(r => child.stdout.on("end", r));
  child.stdout.on("end", () => reader.flush());

  function sendRaw(obj) {
    if (traceFile) { try { fs.appendFileSync(traceFile, JSON.stringify(obj) + "\n"); } catch {} }
    child.stdin.write(JSON.stringify(obj) + "\n");
  }

  function request(method, params, { timeoutMs = 15000 } = {}) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Object.assign(new Error(`timeout after ${timeoutMs}ms: ${method}`), { code: "TIMEOUT", method }));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer, method });
      sendRaw({ id, method, ...(params !== undefined ? { params } : {}) });
    });
  }

  function notify(method, params) { sendRaw({ method, ...(params !== undefined ? { params } : {}) }); }

  return {
    child, reader, stdoutEnd, spawnMetaRef: null,
    request, notify, sendRaw,
    onNotification: h => { notificationHandlers.push(h); return () => { const i = notificationHandlers.indexOf(h); if (i !== -1) notificationHandlers.splice(i, 1); }; },
    onInboundRequest: (method, h) => inboundHandlers.set(method, h),
    pendingCount: () => pending.size,
  };
}
