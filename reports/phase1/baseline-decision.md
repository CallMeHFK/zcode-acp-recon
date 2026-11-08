# Phase 1B — 主基线与 Commit 选定（Baseline Decision）

日期：2026-11-09 · 前置：repository-audit.md（1A）

## 决定

**主基线 = william0wang/zcode-acp @ `ccc510421faece1b3d64bedd0c6d09affacb0630`（tag v0.82.3）**

## 基线指纹（复现所需全量字段）

| 字段 | 值 |
|---|---|
| 上游仓库 | https://github.com/william0wang/zcode-acp |
| Commit SHA | `ccc510421faece1b3d64bedd0c6d09affacb0630` |
| 提交信息 | "chore(main): release 0.82.3 (#362)"（2026-11-07） |
| 上游版本 | 0.82.3（release-please；npm `zcode-acp-server@0.82.3` = dist-tags.latest，两处一致） |
| 锁文件 | `pnpm-lock.yaml`，lockfileVersion 9.0（已提交于基线） |
| Node engines | `>=22.0.0`（基线验证用 v24.20.0） |
| 包管理器 | pnpm v12.18.0（corepack；lockfile v9 兼容） |
| 许可证 | Apache-2.0（根 LICENSE 在；注意义务：保留 LICENSE/NOTICE、修改文件保留原始版权声明） |
| 本地基线克隆 | `C:\Users\Rt\.zcode\workspace\zcode-acp`（main @ ccc5104，未做任何修改） |

## 选定理由

1. 唯一活跃源仓库（83★、26 forks、审计前一日仍在发版）；其余两仓为冻结 fork（1A 证据）
2. 与 npm 发布通道一致（0.82.3 同版本），上游追踪与补丁回供走同一条 release-please 主线
3. 测试面完整（155 文件/2440 用例），Windows 基线 95.6% 通过——适配工作有可靠回归网
4. 我们 Phase 0 的协议证据（八场景 trace）全部来自同一上游驱动的 CLI 0.17.1——基线与其驱动的后端兼容性已被 Phase 0 实测背书

## 为什么不直接用最新 main 之外的分支/tag

release-please 模式下 main HEAD 即最新 release commit（0.82.3），无更细的"稳定 tag"可选；锁 SHA 已消除漂移。后续上游同步策略见 architecture-note.md。

## 已知起点问题（带入 Phase 2 的清单）

1. 107 个 Windows 测试失败（四类：Seatbelt N/A / 测试 POSIX 路径 / **prompt-content.ts file URI 疑似产品缺陷** / 待归类）——见 repository-audit.md
2. open issue #363（T3 Code 看不到 Start Plan 模型）= 客户端未推送账户配置——Phase 0 已有根因与解法证据
3. `postinstall` 会尝试执行 `dist/remote/hub-upgrade-notify.js`（构建后存在；失败静默）——行为已知
