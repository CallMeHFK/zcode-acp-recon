// scan-selftest.mjs — 验证扫描器有效性：造含已知假密钥的提交，确认模式命中
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const scratch = path.join(process.env.TEMP, "scan-selftest");
fs.rmSync(scratch, { recursive: true, force: true });
fs.mkdirSync(scratch, { recursive: true });
const run = (args) => execFileSync("git", args, { cwd: scratch, encoding: "utf8" });
run(["init", "-q"]);
run(["config", "user.email", "t@t"]);
run(["config", "user.name", "t"]);
fs.writeFileSync(path.join(scratch, "cfg.py"), 'API_KEY = "AKIAIOSFODNN7EXAMPLE"\ntoken = "ghp_' + "A".repeat(36) + '"\n');
run(["add", "-A"]);
run(["commit", "-q", "-m", "x"]);
const revs = run(["rev-list", "--all"]).trim().split("\n").filter(Boolean);

const PATTERNS = [
  ["aws-ak", "AKIA[0-9A-Z]{16}"],
  ["gh-token", "gh[pousr]_[A-Za-z0-9]{20,}"],
  ["assign", '(api[_-]?key|apikey|token)["\'`]?[[:space:]]*[:=][[:space:]]*["\'`]?[A-Za-z0-9+/_-]{20,}'],
];
let allOk = true;
for (const [name, re] of PATTERNS) {
  let hit = false;
  try {
    const out = execFileSync("git", ["grep", "-lE", re, ...revs, "--"], { cwd: scratch, encoding: "utf8" });
    hit = out.trim().length > 0;
  } catch { hit = false; }
  console.log(`自测模式 ${name}: ${hit ? "✓ 命中" : "✗ 未命中"}`);
  if (!hit) allOk = false;
}
console.log(allOk ? "扫描器有效性: ✓" : "扫描器有效性: ✗ 需修模式");
fs.rmSync(scratch, { recursive: true, force: true });
