# Phase 1A — 上游仓库审计（Repository Audit）

日期：2026-11-09 · 审计人角色：Phase 1（任务书 1A）· 方法：GitHub API 元数据 + 本地克隆（`C:\Users\Rt\.zcode\workspace\zcode-acp`）+ 实跑测试套件

## 三仓库元数据（gh api 实测 2026-11-09）

| 仓库 | 性质 | Stars | 最近推送 | 创建 | License | 独立维护价值 |
|---|---|---|---|---|---|---|
| **william0wang/zcode-acp** | **源仓库**（fork:false） | 83 | **2026-11-07**（审计前一日，release 0.82.3） | 2026-07-05 | Apache-2.0 | —（即上游） |
| BrokkAi/zcode-acp | GitHub fork（parent=william0wang） | 0 | 2026-09-15（停滞） | 2026-09-14 | Apache-2.0 | 无独立基线价值；其 `docs/PROTOCOL.md` 保留为协议文档参考 |
| haowei2000/zcode-acp | GitHub fork（parent=william0wang） | 0 | 2026-09-01（创建当日后未动） | 2026-09-01 | Apache-2.0 | 无（早前评审已注：package 0.14.3 且 README 指回 william0wang） |

**结论**：三仓非同等候选——william0wang 是唯一活跃源仓库，两个"候选"皆为其冻结 fork。修正了 Phase 0 评审阶段对仓库关系的部分假设（评审方向正确，证据 now 闭环）。

## 上游快照（william0wang/zcode-acp @ HEAD）

- HEAD：`ccc510421faece1b3d64bedd0c6d09affacb0630`（2026-11-07，"chore(main): release 0.82.3 (#362)"），487 commits
- npm：`zcode-acp-server@0.82.3` = dist-tags.latest（release-please 自动化，GitHub 版本与 npm 同步）
- engines：`node >=22.0.0`（本机 v24.20.0 满足）；包管理 pnpm（lockfileVersion 9.0）
- 运行时依赖仅 3 个：`@agentclientprotocol/sdk`、`ws`、`zcode-acp-martty`；dev 含 vitest/zod/typescript/eslint
- 测试：**155 个测试文件 / 2440 用例**；CI（ci.yml）**仅 ubuntu-latest**，Node 版本矩阵——**上游完全未在 Windows 上测试过**（107 个失败全部可由此解释）
- 唯一 open issue：**#363 "Start Plan models don't show up in T3 Code"** —— 与 Phase 0 的关键发现互证：第三方 ACP 客户端不会像桌面宿主那样推送账户配置（`provider/updateAccountConfig`），导致账户模型不注册。我们的 Phase 0 证据链即该 issue 的根因分析 + 解法（潜在上游贡献点）。

## 1C — Windows 测试基线（pnpm 12.18.0 / Node v24.20.0）

`corepack pnpm install`（30.8s，无错误）→ `corepack pnpm test`：

| 指标 | 数值 |
|---|---|
| 通过 | **2333 / 2440（95.6%）** |
| 失败 | 107（29 个文件） |
| 结论 | 上游代码在 Windows 上基本健康；失败集中于平台假设，非架构性损坏 |

失败归类（已抽样复核根因）：

| 类别 | 代表文件（失败数） | 根因 | Phase 2 定性 |
|---|---|---|---|
| A. macOS Seatbelt 沙箱 | sandbox.test.ts (6)、sandbox-allow.test.ts (8)、hub-sandbox.test.ts (2) | 断言 `sandbox-exec` profile 的 POSIX 子路径串——Seatbelt 为 macOS 专属特性 | **N/A**（Windows 无 Seatbelt；任务书已裁剪） |
| B. 测试内 POSIX 路径假设 | resolve.test.ts (2)、skill-discovery.test.ts (13)、settings-* / workflow-* 等 | 用例硬编码 `/tmp/...`、`~/.zcode/...`；Windows 下 path.resolve 产出 `C:\tmp`、home 探测差异 | 测试修复（Windows 适配的一部分，可上游） |
| C. 产品代码平台缺口 | turn-state.test.ts (2)（`prompt-content.ts:48` "Invalid local file URI"） | file:// URI 构造在 Windows 盘符路径下失效——**疑似真实产品缺陷**，不只测试问题 | 产品修复候选（高价值上游 PR） |
| D. 其余（mcp-list、push-config、lazy-sessions、crash-guards、boot-resume 等） | 各 2–9 例 | 待逐个归类（预计多属 B/C 家族） | Phase 2 逐项定位 |

## 风险与备注

- 上游无 Windows CI：我们的适配器必须在自身仓库补 Windows 测试矩阵（Phase 5 计划已有），否则回归无从拦截
- `postinstall` 钩子执行 `dist/remote/hub-upgrade-notify.js`（带 `|| true` 兜底）——供应链面小，已审阅无异常
- 依赖面极窄（3 个运行时依赖），锁文件齐全，审计成本低
