// credential-reader.mjs — 读取共享登录态并内存解密（G3 探测用）
// 约束（AGENTS.md/G11）：只读不写；解密仅在内存；令牌不落日志/trace（redact.mjs 对 requestAuth 整体脱敏）；
// 仅用于回答 interaction/requestProviderRuntimeHeaders（与桌面宿主行为同构），不得外传。
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

let cache = null;

function loadCredentials() {
  if (cache) return cache;
  const file = path.join(os.homedir(), ".zcode", "v2", "credentials.json");
  cache = JSON.parse(fs.readFileSync(file, "utf8"));
  return cache;
}

function deriveKey() {
  // 与 CLI/桌面相同的 fallback 派生（未设置 ZCODE_CREDENTIAL_SECRET 时的机器派生密钥）
  const secret = `zcode-credential-fallback:${process.platform}:${os.homedir()}:${os.userInfo().username}`;
  return crypto.createHash("sha256").update(secret).digest();
}

export function decryptCredential(keyName) {
  const creds = loadCredentials();
  const enc = creds[keyName];
  if (typeof enc !== "string" || !enc.startsWith("enc:v1:")) return null;
  const [iv, tag, data] = enc.slice(7).split(".").map(x => Buffer.from(x, "base64url"));
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", deriveKey(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function getActiveProvider() {
  const v = decryptCredential("oauth:active_provider");
  return v; // 如 "bigmodel"（非机密，可记录）
}
