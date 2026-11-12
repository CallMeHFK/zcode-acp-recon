// gh-audit-scan.mjs — 全历史凭据扫描（无 shell：execFileSync + 参数数组）
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = "C:/Users/Rt/AppData/Local/Temp/gh-audit";
const PATTERNS = [
  ["jwt", "eyJ[A-Za-z0-9_-]{20,}\\.eyJ[A-Za-z0-9_-]{10,}"],
  ["sk-key", "sk-[A-Za-z0-9_-]{20,}"],
  ["gh-token", "gh[pousr]_[A-Za-z0-9]{20,}"],
  ["gh-pat", "github_pat_[A-Za-z0-9_]{20,}"],
  ["aws-ak", "AKIA[0-9A-Z]{16}"],
  ["slack", "xox[baprs]-[A-Za-z0-9-]{10,}"],
  ["google", "AIza[0-9A-Za-z_-]{30,}"],
  ["gitlab", "glpat-[A-Za-z0-9_-]{15,}"],
  ["npm", "npm_[A-Za-z0-9]{30,}"],
  ["pypi", "pypi-[A-Za-z0-9_-]{40,}"],
  ["privkey", "-----BEGIN [A-Z ]*PRIVATE KEY-----"],
  ["zcode-enc", "enc:v[12]:"],
  ["bearer", "[Bb]earer [A-Za-z0-9._-]{28,}"],
  ["assign", "(api[_-]?key|apikey|secret|token|passwd|password|credential|passwort)[\"'`]?[[:space:]]*[:=][[:space:]]*[\"'`]?[A-Za-z0-9+/_-]{20,}"],
  ["conn-str", "(mongodb(\\+srv)?|postgres(ql)?|mysql|redis|amqp|smtp)://[^[:space:]\"'`]{10,}@"],
];
const FILENAME_HINTS = /\.env($|\.)|\.pem$|\.key$|id_rsa|id_ed25519|credentials?\.(json|txt|yaml)|secret/i;

function scanHistory(repoDir) {
  const revs = execFileSync("git", ["rev-list", "--all"], { cwd: repoDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .trim().split("\n").filter(Boolean);
  const hits = {};
  for (const [name, re] of PATTERNS) {
    const args = ["grep", "-lE", "-e", re, ...revs, "--"];
    try {
      const out = execFileSync("git", args, { cwd: repoDir, encoding: "utf8", maxBuffer: 128 * 1024 * 1024, timeout: 180000 });
      if (out.trim()) {
        hits[name] = [...new Set(out.trim().split("\n").map(l => l.replace(/^[0-9a-f]{40}:/, "")))].slice(0, 8);
      }
    } catch (e) {
      if (e.status !== 1 && e.status !== 0) hits[name] = ["ERROR status=" + e.status];
    }
  }
  try {
    const names = execFileSync("git", ["log", "--all", "--name-only", "--pretty=format:"], { cwd: repoDir, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
    const flagged = [...new Set(names.split("\n").filter(Boolean).filter(f => FILENAME_HINTS.test(f)))].slice(0, 8);
    if (flagged.length) hits["sensitive-filenames"] = flagged;
  } catch {}
  return hits;
}

const repos = fs.readdirSync(ROOT).filter(d => fs.existsSync(path.join(ROOT, d, ".git")));
// 全量：包含 priv-* 前缀（私有仓库克隆）
const report = {};
for (const repo of repos) {
  report[repo] = scanHistory(path.join(ROOT, repo));
  const total = Object.values(report[repo]).reduce((a, b) => a + (Array.isArray(b) ? b.length : 0), 0);
  console.log(`${repo}: ${total === 0 ? "CLEAN" : total + " 命中"}`);
}
fs.writeFileSync(path.join(ROOT, "audit-results.json"), JSON.stringify(report, null, 2));
console.log("\nwritten: audit-results.json");
