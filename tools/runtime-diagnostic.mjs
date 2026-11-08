#!/usr/bin/env node
// Phase 0A — 静态诊断（只读；不启动 app-server）
// 产出: ../reports/runtime-compat.json (+ stdout 摘要)
// 约束: 见 ../AGENTS.md —— 不修改被测环境；凭证文件仅采集顶层键名/值类型。
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const pexec = promisify(execFile);
const HOME = os.homedir();
const DESKTOP = "C:\\Program Files\\ZCode";
const GLM = path.join(DESKTOP, "resources", "glm");
const ZCODE_CJS = path.join(GLM, "zcode.cjs");
const REPORT_DIR = path.join(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), "reports");
const report = { generatedAt: new Date().toISOString(), machine: {}, desktop: {}, cli: {}, runtimes: {}, credentials: {}, sqliteEvidence: {}, notes: [] };

function walk(dir, depth, maxDepth = 3, out = [], budget = { n: 0 }) {
  if (depth > maxDepth || budget.n > 400) return out;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (budget.n++ > 400) break;
    const full = path.join(dir, e.name);
    let size = null;
    try { if (e.isFile()) size = fs.statSync(full).size; } catch {}
    out.push({ path: full, type: e.isDirectory() ? "dir" : e.isFile() ? "file" : "other", size });
    if (e.isDirectory()) walk(full, depth + 1, maxDepth, out, budget);
  }
  return out;
}

function jsonTopKeys(file) {
  // 仅返回顶层键名与值类型，绝不返回值内容
  try {
    const raw = fs.readFileSync(file, "utf8");
    const obj = JSON.parse(raw);
    const keys = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === null) keys[k] = "null";
      else if (Array.isArray(v)) keys[k] = `array(${v.length})`;
      else if (typeof v === "object") keys[k] = `object{${Object.keys(v).length}}`;
      else keys[k] = typeof v;
    }
    return { exists: true, size: raw.length, topKeys: keys };
  } catch (e) {
    return { exists: fs.existsSync(file), error: e.code === "ENOENT" ? "not_found" : "parse_error:" + e.name };
  }
}

async function fileVersion(psqlPath) {
  try {
    const { stdout } = await pexec("powershell", ["-NoProfile", "-Command",
      `(Get-Item '${psqlPath}').VersionInfo | Select-Object ProductName,ProductVersion,FileVersion | ConvertTo-Json`], { timeout: 15000 });
    return JSON.parse(stdout);
  } catch (e) { return { error: String(e.message).slice(0, 200) }; }
}

async function runVersionProbe(nodeExe, args, label) {
  try {
    const { stdout, stderr } = await pexec(nodeExe, args, { timeout: 20000, windowsHide: true, shell: false });
    return { label, code: 0, stdout: stdout.trim().slice(0, 400), stderrTail: stderr.trim().slice(-400) };
  } catch (e) {
    return { label, code: e.code ?? "ERR", stdout: (e.stdout || "").trim().slice(0, 400), stderrTail: (e.stderr || String(e.message)).trim().slice(-400) };
  }
}

// ---------- A1 桌面安装结构 ----------
report.machine = { os: "windows", osVersion: os.release(), arch: os.arch(), hostname: "<redacted>" };
if (fs.existsSync(DESKTOP)) {
  report.desktop.installPath = DESKTOP;
  report.desktop.zcodeExeVersion = await fileVersion(path.join(DESKTOP, "ZCode.exe"));
  report.desktop.glmTree = walk(GLM, 0, 2).slice(0, 120);
  report.desktop.hasNativeBinary = fs.existsSync(path.join(GLM, "zcode-agent.exe"));
} else {
  report.desktop.installPath = null;
  report.notes.push("desktop_not_found_at_" + DESKTOP);
}

// ---------- A2 CLI 真实版本 ----------
if (fs.existsSync(ZCODE_CJS)) {
  const src = fs.readFileSync(ZCODE_CJS, "utf8");
  const versions = [...src.matchAll(/version:\s*"(<|code_suffix|><d8f643e8>)"/g)].map(m => m[1]);
  report.cli.path = ZCODE_CJS;
  report.cli.sizeBytes = src.length;
  report.cli.embeddedVersionStrings = [...new Set(versions)];
  report.cli.zcodeOnPath = (() => {
    const pathEnv = process.env.PATH || "";
    return pathEnv.split(";").some(d => { try { return fs.existsSync(path.join(d, "zcode.cmd")) || fs.existsSync(path.join(d, "zcode.exe")); } catch { return false; } });
  })();
  // 实跑 --version（不启动 app-server；超时 20s 杀掉）
  const sysNode = process.execPath;
  report.cli.versionProbeSystemNode = await runVersionProbe(sysNode, [ZCODE_CJS, "--version"], "system-node --version");
} else {
  report.cli.path = null;
  report.notes.push("zcode_cjs_not_found");
}

// ---------- A3 运行时盘点 ----------
report.runtimes.bridgeNode = { execPath: process.execPath, version: process.version };
report.runtimes.spawnNodeCandidate = { execPath: process.execPath, version: process.version }; // 0B 实际 spawn 时复核
const bundledNodeCandidates = [];
try {
  for (const e of fs.readdirSync(GLM, { withFileTypes: true })) {
    if (e.isDirectory() && /node/i.test(e.name)) {
      // 递归找 node.exe（限制深度/数量）
      const find = (d, dep) => {
        if (dep > 3) return;
        let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const x of es) {
          const f = path.join(d, x.name);
          if (x.isFile() && /^node(\.exe)?$/i.test(x.name)) bundledNodeCandidates.push(f);
          else if (x.isDirectory()) find(f, dep + 1);
        }
      };
      find(path.join(GLM, e.name), 0);
    }
  }
} catch {}
report.runtimes.bundledNodeCandidates = bundledNodeCandidates;
report.runtimes.electron = { exe: path.join(DESKTOP, "ZCode.exe"), versionInfo: report.desktop.zcodeExeVersion || null };

// node:sqlite 能力（仅对候选 spawn Node 自身；此检查是探测，不是依赖证明）
try {
  await pexec(process.execPath, ["-e", "require('node:sqlite'); console.log('OK')"], { timeout: 10000, windowsHide: true });
  report.runtimes.spawnNodeSqliteModuleAvailable = true;
} catch { report.runtimes.spawnNodeSqliteModuleAvailable = false; }

// ---------- A4 凭证文件结构（仅键名/类型） ----------
const credFiles = {
  "cli/config.json": path.join(HOME, ".zcode", "cli", "config.json"),
  "v2/setting.json": path.join(HOME, ".zcode", "v2", "setting.json"),
  "v2/provider_config.json": path.join(HOME, ".zcode", "v2", "provider_config.json"),
  "v2/credentials.json": path.join(HOME, ".zcode", "v2", "credentials.json"),
  "v2/config.json": path.join(HOME, ".zcode", "v2", "config.json"),
};
report.credentials = {};
for (const [k, f] of Object.entries(credFiles)) {
  const info = jsonTopKeys(f);
  try { const st = fs.statSync(f); info.mtime = st.mtime.toISOString(); } catch {}
  report.credentials[k] = info;
}
// tasks-index.sqlite 存在性（G7 基线）
const dbFile = path.join(HOME, ".zcode", "v2", "tasks-index.sqlite");
try { const st = fs.statSync(dbFile); report.credentials["v2/tasks-index.sqlite"] = { exists: true, size: st.size, mtime: st.mtime.toISOString() }; } catch { report.credentials["v2/tasks-index.sqlite"] = { exists: false }; }

// ---------- A5 node:sqlite 静态证据 ----------
if (fs.existsSync(ZCODE_CJS)) {
  const src = fs.readFileSync(ZCODE_CJS, "utf8");
  const hits = {};
  for (const pat of ["node:sqlite", "DatabaseSync", "tasks-index", "tasks-index.sqlite", "better-sqlite3", ".sqlite"]) {
    const idxs = [];
    let i = -1;
    while ((i = src.indexOf(pat, i + 1)) !== -1 && idxs.length < 5) {
      idxs.push(src.slice(Math.max(0, i - 60), i + pat.length + 60).replace(/\s+/g, " "));
    }
    hits[pat] = { count: (src.match(new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length, samples: idxs };
  }
  report.sqliteEvidence.zcodeCjs = hits;
}

// ---------- 输出 ----------
fs.mkdirSync(REPORT_DIR, { recursive: true });
const outJson = path.join(REPORT_DIR, "runtime-compat.json");
fs.writeFileSync(outJson, JSON.stringify(report, null, 2));
console.log("written:", outJson);
console.log("\n=== 摘要 ===");
console.log("desktop:", report.desktop.installPath, "nativeBinary:", report.desktop.hasNativeBinary);
console.log("cli embedded versions:", report.cli.embeddedVersionStrings);
console.log("cli --version (system node):", JSON.stringify(report.cli.versionProbeSystemNode));
console.log("bridge node:", report.runtimes.bridgeNode.version, "sqliteModule:", report.runtimes.spawnNodeSqliteModuleAvailable);
console.log("bundled node candidates:", bundledNodeCandidates);
console.log("credential files:", Object.fromEntries(Object.entries(report.credentials).map(([k, v]) => [k, v.exists ? "exists(" + (v.size ?? "?") + "B)" : "missing"])));
console.log("sqlite evidence counts:", Object.fromEntries(Object.entries(report.sqliteEvidence.zcodeCjs || {}).map(([k, v]) => [k, v.count])));
