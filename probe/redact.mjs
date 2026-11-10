// redact.mjs — 结构化脱敏（G11）
// 原则：保存前脱敏；递归嵌套；键名黑名单 + 字符串内凭证模式 + URL 查询参数 + 长 base64；
// 输出 scanCoverage / scanErrors —— 扫描失败不得报告安全通过。
const KEY_BLOCKLIST = [
  "token", "accesstoken", "access_token", "refreshtoken", "refresh_token", "apikey", "api_key", "api-key",
  "authorization", "cookie", "set-cookie", "password", "passwd", "secret", "secretkey", "client_secret",
  "credential", "credentials", "privatekey", "private_key", "sessionkey", "idtoken", "id_token", "jwttoken",
  "apikeyforthisrequest", "x-api-key", "x-goog-api-key", "proxy-authorization",
];
const SENSITIVE_KEY_HINT = /(token|secret|password|apikey|api_key|credential|authorization|cookie)/i;
const B64_RE = /^[A-Za-z0-9+/=\s]{512,}$/;
const BEARER_RE = /(Bearer\s+)[A-Za-z0-9._\-]+/g;
const SK_RE = /\b(sk-[A-Za-z0-9]{8})[A-Za-z0-9]+/g;
import __fs from "node:fs";

export function createRedactor() {
  const scanErrors = [];
  let scanned = 0, total = 0;

  function redactString(s) {
    let out = s;
    out = out.replace(BEARER_RE, "$1<redacted>");
    out = out.replace(SK_RE, "$1<redacted>");
    if (B64_RE.test(out)) return `<base64:${out.length} chars>`;
    return out;
  }

  function redactUrl(u) {
    try {
      const url = new URL(u);
      let changed = false;
      for (const [k] of url.searchParams) {
        if (SENSITIVE_KEY_HINT.test(k)) { url.searchParams.set(k, "<redacted>"); changed = true; }
      }
      return changed ? url.toString() : u;
    } catch { return redactString(u); }
  }

  function walk(v, keyPath, depth) {
    if (depth > 24) return "<deep>";
    if (v === null || typeof v === "number" || typeof v === "boolean") return v;
    if (typeof v === "string") {
      if (/^https?:\/\//i.test(v)) return redactUrl(v);
      return redactString(v);
    }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${keyPath}[${i}]`, depth + 1));
    if (typeof v === "object") {
      const out = {};
      for (const [k, val] of Object.entries(v)) {
        const kl = k.toLowerCase().replace(/[-_\s]/g, "");
        const numericCount = /token/i.test(k) && typeof val === "number"; // 计数字段非凭据（如 outputTokens）
        if (KEY_BLOCKLIST.includes(kl) && !numericCount) out[k] = "<redacted>";
        else if (SENSITIVE_KEY_HINT.test(k) && !numericCount && typeof val === "string" && val.length > 0) out[k] = "<redacted:key-hint>";
        else out[k] = walk(val, `${keyPath}.${k}`, depth + 1);
      }
      return out;
    }
    return String(v);
  }

  return {
    redactRecord(obj) {
      total++;
      try {
        const out = walk(obj, "$", 0);
        scanned++;
        return out;
      } catch (e) {
        scanErrors.push({ record: total, error: String(e && e.message).slice(0, 200) });
        return { redactionFailed: true };
      }
    },
    report() {
      return {
        scanCoverage: total === 0 ? 1 : scanned / total,
        scanErrors: [...scanErrors],
        totalRecords: total,
      };
    },
  };
}

// 便捷：读 raw jsonl → 脱敏 → 写 sanitized jsonl
export function sanitizeJsonlFile(rawPath, outPath) {
  const fs = __fs;
  const r = createRedactor();
  const lines = fs.readFileSync(rawPath, "utf8").split("\n").filter(l => l.trim().length > 0);
  const out = lines.map(l => {
    let obj;
    try { obj = JSON.parse(l); } catch { return JSON.stringify({ unparseable: l.slice(0, 300) }); }
    return JSON.stringify(r.redactRecord(obj));
  });
  fs.writeFileSync(outPath, out.join("\n") + (out.length ? "\n" : ""));
  return r.report();
}
