// triage.mjs — 对审计命中逐条分诊：打印位置 + 掩码预览 + 分类判断线索
// 用法：node probe/triage.mjs <workspace 目录>（与 gh-audit-scan.mjs 的 workspace 一致）
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(process.argv[2] || path.join(REPO_ROOT, ".audit-workspace"));
const report = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "reports", "phase5", "all-repos-audit-results.json"), "utf8"));

const PATTERNS = {
  jwt: /eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{10,}/,
  "sk-key": /sk-[A-Za-z0-9_-]{20,}/,
  "gh-token": /gh[pousr]_[A-Za-z0-9]{20,}/,
  "gh-pat": /github_pat_[A-Za-z0-9_]{20,}/,
  "aws-ak": /AKIA[0-9A-Z]{16}/,
  slack: /xox[baprs]-[A-Za-z0-9-]{10,}/,
  google: /AIza[0-9A-Za-z_-]{30,}/,
  gitlab: /glpat-[A-Za-z0-9_-]{15,}/,
  npm: /npm_[A-Za-z0-9]{30,}/,
  pypi: /pypi-[A-Za-z0-9_-]{40,}/,
  privkey: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  "zcode-enc": /enc:v[12]:/,
  bearer: /[Bb]earer [A-Za-z0-9._-]{28,}/,
  assign: /(api[_-]?key|apikey|secret|token|passwd|password|credential|passwort)["'` ]*[=:][ "'`]*[A-Za-z0-9+/_-]{20,}/i,
  "conn-str": /(mongodb(\+srv)?|postgres(ql)?|mysql|redis|amqp|smtp):\/\/[^\s"'`]{10,}@/,
};

function mask(m) {
  // 只保留前 14 字符 + 长度，其余掩码
  return m.slice(0, 14) + `…(len=${m.length})`;
}

for (const [repo, hits] of Object.entries(report)) {
  for (const [patName, files] of Object.entries(hits)) {
    if (!Array.isArray(files)) continue;
    for (const file of files) {
      // 文件名提示类直接列出
      if (patName === "sensitive-filenames") {
        console.log(`◆ ${repo} [${patName}] ${file}`);
        continue;
      }
      const re = PATTERNS[patName];
      if (!re) continue;
      let fp = path.join(ROOT, repo, file);
      if (!fs.existsSync(fp)) continue;
      const lines = fs.readFileSync(fp, "utf8").split("\n");
      lines.forEach((line, ln) => {
        const m = line.match(re);
        if (m) {
          // 掩码预览：模式名 + 匹配前缀 + 行号 + 上下文关键词
          const ctxWords = line
            .replace(m[0], mask(m[0]))
            .trim()
            .slice(0, 90);
          console.log(`◆ ${repo} [${patName}] ${file}:${ln + 1} → ${mask(m[0])} | ${ctxWords}`);
        }
      });
    }
  }
}
