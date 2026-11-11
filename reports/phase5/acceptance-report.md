# Phase 5 — 公开与验收报告（Acceptance Report）

日期：2026-11-11 · 用户指令：公开仓库 + 由 Agent 验收

## 一、仓库公开（Class B → Class A 转换，按 open-source-repo-rules 执行）

### 公开前审计（全历史扫描，凭据零容忍）
| 检查 | 结果 |
|---|---|
| 全历史 blob 密钥形态扫描（enc:v1 实值 / eyJ JWT / sk- / ghp_ / AKIA / xox） | **零真实凭据**（`enc:v1` 命中为代码中的格式标记常量；唯一 access_token 赋值为并行会话的假 fixture `"contract-fixture-oauth-token"`，可说明保留） |
| `traces/raw/`（凭据材料）全历史入库检查 | **0** —— 从未入库 |
| zcodejwttoken 值泄漏 | 0 |
| 个人数据公开清单（用户自有数据，随公开披露） | Windows 用户名路径、自有计划名/额度（billing 取证）、凭证键名（无值） |

### Class A 检查单（落地文件）
LICENSE（Apache-2.0，正文占位已填，appendix 合规保留）✓ · CODE_OF_CONDUCT.md（Contributor Covenant 3.0）✓ · CONTRIBUTING.md（含离线门禁命令、Conventional Commits、PR 规则）✓ · SECURITY.md（含 raw-trace 政策与历史重写例外）✓ · bug/PR 模板 ✓ · CODEOWNERS ✓ · **CI workflow**（ubuntu+windows × node22/24：语法检查 + L0 派生校验 + L1 36 用例离线门禁）✓ · README License 节 ✓

### 翻转与能力探测（probe, never assume）
| 能力 | 公开前/后 |
|---|---|
| visibility | private:false ✓ |
| private-vulnerability-reporting | false → **启用 true** ✓ |
| vulnerability-alerts | disabled → **启用** ✓ |
| 分支保护（免费档公开仓库可用） | **已设**：linear history ✓ / 禁强推 ✓ / 禁删除 ✓ / strict 状态检查（offline, ubuntu, 24）✓ |
| CI 首跑 | 初次失败（autocrlf L0 漂移，见下）→ 修复 → **success 21s** ✓ |

### 过程缺陷：autocrlf 检出漂移（已修复 `da277e6`）
L0 门禁在 CI 全体 DRIFT 而本地 PASS——根因：Windows 新克隆以 CRLF 检出 trace 文件，checkout 口味的 SHA 与提交的 fixture SHA 不一致。修复：哈希/比较统一走 LF 归一化字节 + `.gitattributes` 钉 `eol=lf` + `--check` 比较两侧归一化。

## 二、验收 A（公开性）—— PASS

以陌生人身份克隆公开仓库（GitHub HTTPS），离线门禁开箱即用：L0 派生校验 PASS + L1 契约 **36/36**。社区档案文件齐全（license/COC/contributing/readme）。

## 三、验收 B（适配器 Zed 同规格实测）—— **受阻于外部环境变更**

### 经过
1. 活体清扫：billing 查询 401 → 排查发现 **桌面 App 已于 11-10/11 将共享凭证库从 `enc:v1`（机器派生密钥）迁移到 `enc:v2:os`（OS 钥匙串）**（`~/.zcode/v2/credential-source` = "os"，mtime 11-10 22:36；全部键值改 `enc:v2:os:` 前缀；v1 解密全数失败）
2. 级联失效：桥接侧所有凭据读取失效 → JWT 无法供给 → 上游启发式误配 individual 计划 → 网关拒绝 → OAuth 兑换路径亦失败（兑换本身需要桥读不到的凭证）
3. 实验：`headersApplied:false` 交还后端 client-signing（CLI 0.17.1 支持 v2）→ 后端仍 `model_request_failed`（bridge `56dcfde` 记录实验与观察）

### 定性
**外部环境变更，非本工作回归**：同一代码在 11-09 的 v1 凭证库上全绿（八场景 + 真实推理）；11-10/11 桌面自动迁移后失效。这不是 Windows 适配缺陷，而是**上游桥接器普遍面临的新兼容性问题**（所有 macOS 用户在桌面升级后同样会断）。

### 解除阻塞的路径（按优先级）
1. **port v2:os 支持**进 fork 的 credential reader（需识别 CLI 的 OS keyring 机制——CLI 0.17.1 自身已支持，代码在 `zcode.cjs` enc:v2:os 处；Phase 4+ 主攻项）
2. 或等待上游适配 v2（所有用户都会撞上）
3. 或用户在桌面 App 重新登录一次观察是否回落 v1（未验证，需确认）

## 四、验收清单终态

| 项 | 结果 |
|---|---|
| 仓库公开 + Class A 检查单 | ✅ |
| 公开性验收（陌生人克隆 → 门禁开箱即用） | ✅ |
| CI（ubuntu+windows × node22/24） | ✅ success |
| 分支保护 + 漏洞报告 + 警报 | ✅ |
| 适配器 Zed 同规格验收 | ⚠️ 受阻于桌面凭证 v2:os 迁移（外部变更，证据链完整：昨天 v1 全绿） |

## 五、下一步
1. v2:os 凭证支持（识别 CLI keyring 机制 → port 进 fork credential-store → 契约门禁复跑）
2. 上游沟通：#363 根因 + #123 captcha 结论过时 + v2:os 兼容性问题（三连 PR/issue 素材）
3. Zed 实机验收在 v2 解除后复跑
