# 安全与隐私 Review — 公开仓库 zcode-acp-recon

日期：2026-11-12 · 范围：公开仓库全历史（104 tracked 文件、全部 blob）+ fork 公开分支（3 条）+ 探测工具链
方法：Mimosa deep scan（scanId `scan-2026-11-12T15-43-38.557Z-50de50ac0e42`，seal `sha256:24a6…a89a8`，findingCount **0**）+ 人工逐项核查（本文件）

## 总评

**可以保持公开。** 未发现凭据、令牌或高敏感数据泄漏；存在三类已披露的个人数据残留（低危）与一条方法论公开说明（信息级）。

## 一、凭据与机密（扫描零命中）

| 检查 | 结果 |
|---|---|
| 全历史 blob 扫描：JWT 形态（eyJ…30+）/ Bearer 值 / sk- / ghp_ / AKIA / xox* | **0 命中** |
| 全历史：zcodejwttoken / access_token 的**值**泄漏（键名引用不算） | **0** |
| `traces/raw/`（含凭据材料，本地专用）入库检查 | **0** —— 从未提交 |
| 已跟踪 sanitized trace 与 contract fixtures 的 `requestAuth` 字段 | **全部 `<redacted>`**（逐条核对） |
| fork 公开分支（upstream-file-uri / windows / creds-v2）敏感形态扫描 | **各 0 命中** |
| Mimosa deep scan | **findingCount 0** |

## 二、隐私暴露清单（个人数据，已披露为研究材料）

| 数据 | 出现位置 | 等级 | 说明 |
|---|---|---|---|
| Windows 用户名（`Users\Rt` 路径） | 9 个 tracked 文件（reports/traces 元数据） | **低** | 仓库公开时已知悉披露；与他人数据无关联 |
| 自有计划名/plan_id/额度（billing 取证） | reports（finalize.json、matrix） | **低** | 用户自有订阅元数据 |
| 凭证**键名**（zcodejwttoken 等，无值） | runtime-compat 报告 | **低** | 键名结构在 CLI bundle 中本就公开 |
| sessionId 前缀（截断 12 位） | 验收 JSON | **低** | 本地会话标识，无账户关联 |
| 本机目录布局（.zcode 结构） | runtime-compat 报告 | **低** | 结构在 CLI bundle 公开可见 |

## 三、方法论公开说明（信息级，非漏洞）

`probe/credential-reader.mjs` 与 `probe/v2-decrypt-test.mjs` 公开了 v1 派生公式与 v2 钥匙串取钥方法。评估：

- v1 公式（`sha256(zcode-credential-fallback:{platform}:{homedir}:{username})`）**本就存在于公开的 CLI bundle**（`zcode.cjs` 明文可见），发布不增加新能力
- v2 钥匙串密钥受 OS 凭据库保护（同用户会话才能取）；公开方法不降低攻击门槛
- 组合风险：本仓库同时公开了 username → 持有 `credentials.json` 文件的本地攻击者可离线解密。但本地用户级权限本就等价于直接运行 CLI 解密——**无额外能力授予**。已在 SECURITY.md 政策框架内，无需整改

## 四、代码级安全说明（fork 适配器）

- `requestCredentialCipher` 应答器：桥接器为同用户的后端子进程提供加解密委托——信任边界与桌面宿主设计一致（stdio 无鉴权 = 与上游架构相同），已在 PR #374 描述中注明
- spawn 纪律（args 数组/shell:false/windowsHide）+ stdin 写保护 + EPIPE 防崩均已在位（Phase 2/4 审计）

## 五、残留风险与建议

| 项 | 等级 | 建议 |
|---|---|---|
| 用户名/计划信息随公开披露 | 低 | 已由用户知情选择；如需收紧可路径化名（重写历史，代价大，不建议） |
| probe 工具公开了凭证解密方法论 | 信息 | SECURITY.md 已覆盖 raw-trace 政策；可选补一段"本仓库公开解密方法说明" |
| contract/logs 本地帧日志 | 信息 | 未入库 ✓；其中含桥接器应答帧（v2 修复前样本无凭据，v2 后样本含 JWT——**保持 gitignore，勿入库**） |
| `traces/raw/` 本地保留 | 低 | 政策已定：本地专用；如需彻底消除可删除（证据链已有 sanitized 副本） |
