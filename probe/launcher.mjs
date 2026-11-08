// launcher.mjs — 解析并启动 ZCode app-server --stdio
// G10 spawn 纪律自证：executable 与 args 分离、shell:false、windowsHide:true、显式 cwd。
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CANDIDATE_CJS = "C:\\Program Files\\ZCode\\resources\\glm\\zcode.cjs";
const CANDIDATE_LOCALAPPDATA = path.join(process.env.LOCALAPPDATA || "", "Programs", "ZCode", "resources", "glm", "zcode.cjs");

export function resolveZcodeCli() {
  const trail = [];
  if (process.env.ZCODE_BIN) {
    if (fs.existsSync(process.env.ZCODE_BIN)) { trail.push({ source: "ZCODE_BIN", path: process.env.ZCODE_BIN }); return { cliPath: process.env.ZCODE_BIN, needsNode: !/\.exe$/i.test(process.env.ZCODE_BIN), trail }; }
    trail.push({ source: "ZCODE_BIN", path: process.env.ZCODE_BIN, missing: true });
  }
  const pathDirs = (process.env.PATH || "").split(";");
  for (const d of pathDirs) {
    for (const name of ["zcode.exe", "zcode.cmd", "zcode"]) {
      try { const p = path.join(d, name); if (fs.existsSync(p)) { trail.push({ source: "PATH", path: p }); return { cliPath: p, needsNode: !/\.exe$/i.test(p), trail }; } } catch {}
    }
  }
  for (const cand of [CANDIDATE_CJS, CANDIDATE_LOCALAPPDATA]) {
    if (cand && fs.existsSync(cand)) { trail.push({ source: "install-dir", path: cand }); return { cliPath: cand, needsNode: true, trail }; }
  }
  trail.push({ source: "none", missing: true });
  return { cliPath: null, needsNode: false, trail };
}

export function launchAppServer({ cwd, traceFile, env = {} }) {
  const { cliPath, needsNode, trail } = resolveZcodeCli();
  if (!cliPath) throw new Error("zcode CLI not found: " + JSON.stringify(trail));
  const nodeExe = process.execPath; // 实际 spawn 的 Node（G2 复核对象）
  const args = needsNode ? [cliPath, "app-server", "--stdio"] : ["app-server", "--stdio"];
  const spawnMeta = {
    nodeExe, nodeVersion: process.version, cliPath, args,
    shell: false, windowsHide: true, cwd: cwd || process.cwd(),
    envKeys: Object.keys(env),
  };
  const child = spawn(needsNode ? nodeExe : cliPath, args, {
    shell: false, windowsHide: true, cwd: cwd || process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });
  let stderrBuf = "";
  child.stderr.on("data", d => {
    stderrBuf += d.toString("utf8");
    if (stderrBuf.length > 200_000) stderrBuf = stderrBuf.slice(-100_000);
    if (traceFile) fs.appendFileSync(traceFile, JSON.stringify({ dir: "child-stderr", ts: new Date().toISOString(), text: d.toString("utf8") }) + "\n");
  });
  return { child, spawnMeta, trail, getStderrTail: () => stderrBuf.slice(-4000) };
}

export async function terminate(child, { mode = "graceful", timeoutMs = 8000 } = {}) {
  // 阶段1: 优雅结束 stdin（协议通道关闭）; 阶段2: kill(); 阶段3: taskkill /T /F 兜底
  if (child.exitCode !== null || child.killed) return { mode, alreadyExited: true };
  if (mode === "graceful") {
    try { child.stdin.end(); } catch {}
    const exited = await Promise.race([
      new Promise(r => child.once("exit", r)),
      new Promise(r => setTimeout(() => r(null), timeoutMs)),
    ]);
    if (exited !== null) return { mode, gracefulStdinClose: true };
  }
  if (mode === "force" || mode === "graceful") {
    if (mode === "graceful") {
      try { child.kill(); } catch {}
      const exited = await Promise.race([
        new Promise(r => child.once("exit", r)),
        new Promise(r => setTimeout(() => r(null), timeoutMs)),
      ]);
      if (exited !== null) return { mode, sigtermEquivalent: true };
    }
  }
  // 阶段3: taskkill /T /F
  await new Promise(r => {
    const tk = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { shell: false, windowsHide: true });
    tk.on("exit", r); tk.on("error", r);
  });
  const exited = await Promise.race([
    new Promise(r => child.once("exit", r)),
    new Promise(r => setTimeout(() => r(null), timeoutMs)),
  ]);
  return { mode, taskkillUsed: true, exited: exited !== null };
}
