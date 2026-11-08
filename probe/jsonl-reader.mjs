// jsonl-reader.mjs — 行分隔 JSON 读取器
// G10/G9 相关：Buffer 累积 + 流式 UTF-8 解码（容忍多字节字符跨块）、\r\n 容忍、退出 flush。
export function createLineReader(onLine) {
  const decoder = new TextDecoder("utf-8");
  let buf = "";
  const stats = { lines: 0, nonJsonLines: 0, bytes: 0, nonJsonSamples: [] };

  function handleLine(line) {
    stats.lines++;
    const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (trimmed.length === 0) return;
    let obj = null;
    try { obj = JSON.parse(trimmed); } catch {
      stats.nonJsonLines++;
      if (stats.nonJsonSamples.length < 20) stats.nonJsonSamples.push(trimmed.slice(0, 300));
      onLine(null, trimmed);
      return;
    }
    onLine(obj, trimmed);
  }

  return {
    push(chunk) {
      stats.bytes += chunk.length;
      buf += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        handleLine(line);
      }
    },
    flush() {
      buf += decoder.decode(); // flush 解码器
      if (buf.length > 0) { handleLine(buf); buf = ""; }
    },
    stats,
  };
}

// 消息分类（ZCode app-server 协议：无 jsonrpc 字段）
// id+method=请求(双向) / 仅 method=通知 / 仅 id=响应
export function classifyMessage(obj) {
  if (obj == null || typeof obj !== "object") return "invalid";
  const hasId = obj.id !== undefined && obj.id !== null;
  const hasMethod = typeof obj.method === "string";
  if (hasId && hasMethod) return "request";
  if (hasMethod) return "notification";
  if (hasId) return "response";
  return "invalid";
}
