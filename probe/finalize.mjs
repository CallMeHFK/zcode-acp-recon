// finalize.mjs — 0B/0C 收口：billing 取证 / 并存观察 / 孤儿进程 / 脱敏导出 / 汇总数据
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { decryptCredential, getActiveProvider } from "./credential-reader.mjs";

const pexec = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW = path.join(ROOT, "traces", "raw");
const OUT = path.join(ROOT, "traces");
const out = {};

function redactValue(v, depth = 0) {
  if (depth > 12) return "<deep>";
  if (v === null || typeof v !== "object") {
    if (typeof v === "string") {
      if (/^https?:\/\//i.test(v)) {
        try { const u = new URL(v); for (const k of [...u.searchParams.keys()]) if (/token|key|secret|sign/i.test(k)) u.searchParams.set(k, "<redacted>"); return u.toString(); } catch { return v; }
      }
      if (/^enc:v1:/.test(v)) return "<redacted:encrypted>";
      if (/^[A-Za-z0-9+/=]{512,}$/.test(v)) return `<base64:${v.length}>`;
      return v.replace(/(Bearer\s+)[A-Za-z0-9._\-]+/g, "$1<redacted>").replace(/\b(sk-[A-Za-z0-9]{8})[A-Za-z0-9]+/g, "$1<redacted>");
    }
    return v;
  }
  if (Array.isArray(v)) return v.map(x => redactValue(x, depth + 1));
  const o = {};
  for (const [k, val] of Object.entries(v)) {
    if (/(requestauth|authorization|cookie|password|secret|refreshtoken|accesstoken|jwttoken|zcodejwttoken|apikey|api_key|credential|token|connectionkey)/i.test(k.replace(/[-_\s]/g, ""))) o[k] = "<redacted>";
    else o[k] = redactValue(val, depth + 1);
  }
  return o;
}

// ---------- G3-F: billing 取证（账户侧额度；仅 https 公网域；令牌仅内存） ----------
out.billing = { provider: getActiveProvider() };
try {
  const jwt = decryptCredential("zcodejwttoken");
  const url = "https://zcode.z.ai/api/v1/zcode-plan/billing/current";
  const res = await fetch(url, { headers: { authorization: "Bearer " + jwt } });
  out.billing = { ...out.billing, endpoint: url, status: res.status };
  if (res.ok) {
    const body = await res.json();
    out.billing.bodyShape = redactValue(body);
    out.billing.ok = true;
  } else {
    out.billing.ok = false;
    out.billing.error = "HTTP " + res.status;
  }
} catch (e) { out.billing.ok = false; out.billing.error = String(e && e.message).slice(0, 200); }

// 备选端点：balance
if (!out.billing.ok) {
  try {
    const jwt = decryptCredential("zcodejwttoken");
    const url = "https://zcode.z.ai/api/v1/zcode-plan/billing/balance";
    const res = await fetch(url, { headers: { authorization: "Bearer " + jwt } });
    out.billing.balance = { endpoint: url, status: res.status };
    if (res.ok) { out.billing.balance.bodyShape = redactValue(await res.json()); out.billing.balance.ok = true; }
  } catch (e) { out.billing.balance = { error: String(e && e.message).slice(0, 160) }; }
}

// ---------- G7: 桌面数据只读观察 ----------
function stat(p) { try { const s = fs.statSync(p); return { size: s.size, mtime: s.mtime.toISOString() }; } catch { return null; } }
const db = path.join(os.homedir(), ".zcode", "v2", "tasks-index.sqlite");
out.coexistence = {
  dbNow: { sqlite: stat(db), wal: stat(db + "-wal"), shm: stat(db + "-shm") },
  desktopAlive: null,
  sqliteBusyInLog: 0,
};
try {
  const { stdout } = await pexec("tasklist", ["/FI", "IMAGENAME eq ZCode.exe", "/FO", "CSV", "/NH"], { timeout: 15000 });
  out.coexistence.desktopAlive = /ZCode\.exe/i.test(stdout);
} catch { out.coexistence.desktopAlive = "unknown"; }
try {
  const log = fs.readFileSync(path.join(os.homedir(), ".zcode", "cli", "log", "zcode-2026-11-08.jsonl"), "utf8");
  out.coexistence.sqliteBusyInLog = (log.match(/SQLITE_BUSY|database is locked/gi) || []).length;
} catch {}

// ---------- G11: 孤儿进程（残留 zcode-acp-recon 相关 node 进程） ----------
try {
  const { stdout } = await pexec("powershell", ["-NoProfile", "-Command",
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*zcode-acp-recon*' } | Select-Object ProcessId,CommandLine | ConvertTo-Json"], { timeout: 20000 });
  let arr = [];
  try { const j = JSON.parse(stdout || "[]"); arr = Array.isArray(j) ? j : (j ? [j] : []); } catch {}
  out.orphanProcesses = arr.map(p => ({ pid: p.ProcessId, cmd: String(p.CommandLine || "").slice(0, 120) }));
} catch (e) { out.orphanProcesses = "unknown:" + String(e && e.message).slice(0, 80); }

// ---------- G11: 脱敏导出 ----------
const metaBase = {
  zcodeVersion: "0.17.1",
  runtimeVersion: process.version,
  os: "win32", arch: os.arch(),
  captureTimestamp: new Date().toISOString(),
  evidenceLevel: "observed",
  redactionVersion: "1",
};
out.sanitized = {};
let scanTotal = 0, scanOk = 0; const scanErrors = [];
for (const f of fs.readdirSync(RAW)) {
  if (!f.endsWith(".jsonl")) continue;
  const scenario = f.replace(/\.jsonl$/, "");
  const lines = fs.readFileSync(path.join(RAW, f), "utf8").split("\n").filter(l => l.trim());
  const exported = lines.map(l => {
    scanTotal++;
    let o; try { o = JSON.parse(l); } catch { return JSON.stringify({ unparseable: l.slice(0, 200) }); }
    // requestAuth 整体脱敏（含 apiKey/headers）
    if (o && o.result && typeof o.result === "object" && "requestAuth" in o.result) o.result.requestAuth = "<redacted>";
    if (o && o.params && typeof o.params === "object" && "requestAuth" in o.params) o.params.requestAuth = "<redacted>";
    try {
      const v = redactValue(o);
      scanOk++;
      return JSON.stringify(v);
    } catch (e) { scanErrors.push({ file: f, error: String(e && e.message).slice(0, 120) }); return JSON.stringify({ redactionFailed: true }); }
  });
  const wrapped = { metadata: { ...metaBase, scenario }, records: exported.map(x => JSON.parse(x)) };
  const outFile = path.join(OUT, scenario + ".sanitized.json");
  fs.writeFileSync(outFile, JSON.stringify(wrapped, null, 1));
  out.sanitized[scenario] = { records: exported.length, file: path.relative(ROOT, outFile) };
}
out.redaction = { scanCoverage: scanTotal === 0 ? 1 : scanOk / scanTotal, scanErrors, totalRecords: scanTotal, scannedOk: scanOk };

fs.writeFileSync(path.join(ROOT, "reports", "finalize.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  billing: { ok: out.billing.ok, status: out.billing.status, provider: out.billing.provider, balanceStatus: out.billing.balance?.status, planKeys: out.billing.bodyShape ? Object.keys(out.billing.bodyShape).slice(0, 10) : (out.billing.balance?.bodyShape ? Object.keys(out.billing.balance.bodyShape).slice(0, 10) : null) },
  coexistence: { desktopAlive: out.coexistence.desktopAlive, sqliteBusyInLog: out.coexistence.sqliteBusyInLog, dbSize: out.coexistence.dbNow.sqlite?.size, walSize: out.coexistence.dbNow.wal?.size },
  orphans: Array.isArray(out.orphanProcesses) ? out.orphanProcesses.length : out.orphanProcesses,
  sanitizedFiles: Object.keys(out.sanitized).length,
  redaction: out.redaction,
}, null, 1));
