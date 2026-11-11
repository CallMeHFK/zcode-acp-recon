// 决定性单测：完整复刻 v2:os 解密链（在 fork dist 上下文中）
import { createRequire } from "node:module";
import { createHash, createDecipheriv } from "node:crypto";
import path from "node:path";
import fs from "node:fs";

const FORK = "C:/Users/Rt/.zcode/workspace/zcode-acp";
const req = createRequire(path.join(FORK, "dist", "backend", "credential-store.js"));
const file = path.resolve(process.env.HOME, ".zcode", "v2", "credentials.json");

console.log("[1] file:", file);
const account = createHash("sha256").update(file).digest("hex");
console.log("[2] account:", account.slice(0, 16) + "…");

let Entry;
try {
  ({ Entry } = req("@napi-rs/keyring"));
  console.log("[3] @napi-rs/keyring loaded");
} catch (e) {
  console.log("[3] keyring load FAILED:", String(e.message).slice(0, 120));
  process.exit(1);
}

let password;
try {
  password = new Entry("ZCode Credential Encryption", account).getPassword();
  console.log("[4] keyring password:", password === null ? "null" : `len=${password.length} 43格式=${/^[A-Za-z0-9_-]{43}$/.test(password)}`);
} catch (e) {
  console.log("[4] getPassword ERROR:", String(e.message).slice(0, 150));
  process.exit(1);
}
if (!password) process.exit(1);
const key = Buffer.from(password, "base64url");
console.log("[5] key bytes:", key.length);

const creds = JSON.parse(fs.readFileSync(file, "utf8"));
const v2 = Object.entries(creds).filter(([k, v]) => String(v).startsWith("enc:v2:os:"));
console.log("[6] v2:os 条目数:", v2.length);
for (const [k, v] of v2.slice(0, 4)) {
  const parts = String(v).slice("enc:v2:os:".length).split(".");
  try {
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[0], "base64url"));
    d.setAuthTag(Buffer.from(parts[1], "base64url"));
    const out = Buffer.concat([d.update(Buffer.from(parts[2], "base64url")), d.final()]).toString("utf8");
    console.log(`  ${k.slice(0, 36)} → DECRYPTED len=${out.length}`);
  } catch (e) {
    console.log(`  ${k.slice(0, 36)} → FAIL: ${String(e.message).slice(0, 80)}`);
  }
}
