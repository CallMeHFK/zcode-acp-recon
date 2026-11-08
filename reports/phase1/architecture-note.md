# Phase 1D — Windows 改造边界设计（Architecture Note）

日期：2026-11-09 · 前置：baseline-decision.md · 目标读者：Phase 2–4 实施者

## 原则

**Windows 判断不散落业务模块。** 上游 src/ 已有清晰分层（backend/translators/interaction/handlers/config/...）；我们的全部 Windows 特化收敛到两个新增层，业务模块只面向接口。

## 新增模块边界（目标树）

```
src/
  runtime/                      # 进程与 CLI 解析（跨平台接口，Windows 实现注入）
    cli-discovery.ts            # ZCODE_BIN → PATH → Program Files → LOCALAPPDATA → 诊断失败
    node-resolver.ts            # ZCODE_NODE → 系统 Node；node:sqlite 能力预检（G2 复检逻辑）
    process-manager.ts          # spawn 纪律（args 数组/shell:false/windowsHide/cwd 显式）+ 三阶段终止
  platform/
    windows/
      process.ts                # SIGTERM 语义模拟 → taskkill /T /F 兜底（保留 POSIX 分支为空实现）
      paths.ts                  # Program Files/LOCALAPPDATA 常量、空格/中文路径规整、file URI 构造
      signals.ts                # Windows 信号差异封装
```

规则：`import.meta`/`process.platform === "win32"` 判断只允许出现在 `platform/` 与 `runtime/`；review 时以 grep 门禁约束（Phase 2 加 lint 规则）。

## Phase 2 必须修复的已知产品缺口（来自 1A/1C 实测）

1. **file:// URI 盘符缺陷**（`src/handlers/prompt-content.ts:48` "Invalid local file URI"）——Windows 盘符路径构造 file URL 失败；疑似真实产品缺陷，**优先上游 PR 候选**
2. CLI 解析顺序缺 Windows 安装位（`C:\Program Files\ZCode\...` 实测存在、`%LOCALAPPDATA%\Programs\ZCode\...` 为上游默认假设）——两处都收进 cli-discovery
3. `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` 反斜杠路径启动崩溃（Phase 0 discover5 实测）——paths.ts 统一规整
4. 测试套件 POSIX 路径假设（~13+2+… 例）——随产品修复逐文件回归

## 明确不做（与任务书一致）

- macOS Seatbelt 沙箱（sandbox-* 测试在 Windows 记为 N/A，不修）
- 远程 hub、quota、TUI 的 Windows 特化（沿用上游实现，出问题再修）

## 维护策略（成文，随基线提交）

- **主分支策略**：fork 的 `main` 跟踪上游 `main`（release-please 节奏，当前 0.82.3/487 commits）；我们的工作分支从锁定的 `ccc5104` 拉出（`phase2-windows`）
- **提交边界**：Windows 特化改动独立成 commit（scope `win`）；通用协议/缺陷修复独立成 commit（便于 cherry-pick 回上游）
- **上游优先**：通用修复（如 file URI 缺陷、测试 POSIX 路径）先向上游提 PR；被拒或滞后时才留在 fork，并在 commit message 标注 `Refs: william0wang/zcode-acp#<issue>`
- **无证据不改协议**：任何对 ZCode 协议行为的适配调整必须引用 Phase 0 golden trace（recon 仓库 `traces/*.sanitized.json`）
- **同步检查**：每次上游同步后必跑两套验证——上游 vitest（对照 2333/2440 基线，失败集不得扩大）+ recon probe 套件八场景（全 PASS）

## 与 recon 证据链的接口

Phase 2 实现对 Phase 0 八场景逐一落地为集成测试（suite 的每个场景 ↔ 一个 e2e 用例），证据链闭合：probe（黑盒）→ 适配器实现（白盒）→ 同一 trace 复放比对。
