# Phase 3 — 协议契约测试验收报告

日期：2026-11-09/10 · 主基线：`william0wang/zcode-acp @ ccc5104`（v0.82.3）
分支：fork `phase3-contract`（基于 `phase2-windows @ e24e95e`）· recon `main`

## 结论

**契约网闭合**：Phase 0 的八场景脱敏 golden trace 已变成可重复执行的离线契约测试。真实适配器进程由 `ZCODE_BIN` 假后端驱动，不需要网络、账户计划包或桌面登录态 —— 周末包到期造成的 Phase 2 验收不可复跑问题被彻底消除。测试先复现并促成修复了一个真实产品缺陷。

## 交付物

| 仓库 | 文件 | 内容 |
|---|---|---|
| recon | `contract/build-fixtures.mjs` | golden trace → 紧凑复放脚本；记录源 trace SHA-256 |
| recon | `contract/fixtures/*.json`（8 个）+ `manifest.json` | 八场景复放脚本与证据链指纹 |
| recon | `contract/fake-app-server.mjs` | 作为 `ZCODE_BIN` 被真实适配器 spawn 的假后端，逐帧记日志 |
| recon | `contract/acp-client.mjs` | 最小 ACP 客户端（含 `session/request_permission` 应答） |
| recon | `contract/build-fixtures.mjs --check` | **L0** 逐字节派生校验：夹具确实由 trace 生成，不只是哈希对得上 |
| recon | `contract/trace-contract.test.mjs` | **L1** 36 用例：对**原始 trace** 断言 seq/终局、宿主应答独立重配对、权限选项、stop 语义、脱敏，并校验夹具保真与证据链 |
| recon | `contract/adapter-contract.test.mjs` | **L2** 14 用例：真机 ACP 握手/事件顺序/stopReason/stdout 纪律/宿主应答/权限转发/cancel→stop，**外加复放引擎自身保真度**（脚本应答必达、无脚本内方法被 generic-reply、无未应答 ask） |
| recon | `contract/export-manifest.mjs` + `fixtures/contract-manifest.json` | 导出仅不变量的紧凑清单，供 fork CI 消费（经验证不含绝对用户路径/凭证） |
| recon | `contract/run.mjs` | 一键门禁 L0+L1+L2 → `reports/phase3/contract-results.json` |
| recon | `contract/README.md` | 运行说明、证据链、12 条诚实的设计取舍 |
| fork | `src/backend/client.ts` | 修复 `interaction/requestOfficialMcpAuthHeaders` 到达即答 |
| fork | `tests/contract/golden-contract.test.ts` + `fixtures/contract-manifest.json` | vitest 11 用例，随 `pnpm test` 跑 |

## 验证证据

| 项 | 结果 |
|---|---|
| **L0 夹具派生校验** | **`--check PASS`（8 夹具 + manifest 零漂移）** |
| **L1 golden trace 契约** | **36 / 36 PASS** |
| **L2 适配器契约（8 场景 + 宿主三必答 + 权限 + cancel + 复放保真）** | **14 / 14 PASS** |
| **fork vitest 新增契约文件** | **11 / 11 PASS** |
| ACP `initialize` | protocolVersion 1、`authMethods=["ZCode built-in credentials"]`、`agentCapabilities` 存在 |
| ACP `session/new → prompt` | 8 场景均返回会话 id 并到达终局；normal 等 `stopReason=end_turn`，cancel 场景 `cancelled` |
| stdout 纪律（G9） | 8 场景 `nonJsonLines=0` |
| 宿主 `session/requestRuntimePreferences` | 到达即答，必需布尔位齐全，`askUserQuestionAutoResolutionEnabled=false`（桥接器有意为之） |
| 宿主 `interaction/requestProviderRuntimeHeaders` | `headersApplied:true` + `requestAuth.apiKey`（Phase 2 的 start-plan JWT 修复在离线夹具上仍生效） |
| 宿主 `interaction/requestOfficialMcpAuthHeaders` | 修复后 `{}`；修复前 `-32601` |
| 权限链路 | 后端 `interaction/requestPermission` → ACP `session/request_permission` → 客户端选择 → 后端收到非 decline 应答 |
| cancel | ACP `session/cancel` → 后端收到**带 id 的请求形式** `session/stop` → `stopReason=cancelled` |
| 证据链 | L0 逐字节重派生；L1 校验 SHA-256、**对原始 trace 断言** seq/终局，并独立重配对 `server-N` 应答 |
| 复放保真 | 8 场景均 `matchedSteps=3/3`、脚本应答全部发出、脚本内方法零 `genericReply`、零未应答 ask |
| 未脚本化请求 | `workspace/updateDynamicWorkflowPolicy` / `session/messages` / `session/read` 等不在 trace 内，以 `{}` 应答并在 `defaultedMethods` 如实列出；有记录结果的方法复用记录形状 |
| 进程卫生 | 假后端 stdin 关闭即退出；ACP 客户端无条件 `taskkill /T /F` 回收 Windows 进程树 |
| fork 全量 vitest | 见下方「回归对照」 |

### 回归对照（fork 全量 vitest，Windows / Node v22.22.2）

历史记录里的 Phase 2 基线是 `2332/2440`（108 失败 / 26 文件），但它是在 **Node v24.20.0** 下测的；本次会话的 `node` 是 **v22.22.2**（WorkBuddy 自带），且堆栈里出现 WorkBuddy 的 `node-brokered-fs-shim.cjs`。为排除环境漂移，用 `git worktree` 检出干净的 `phase2-windows @ e24e95e`，在**完全相同的当前环境**下重跑全量：

| | 历史记录（Node v24.20.0） | **同环境 Phase 2 基线** | **同环境 Phase 3** | 判定 |
|---|---|---|---|---|
| 用例总数 | 2440 | 2440 | 2451 | +11（新增契约文件，全 PASS） |
| 通过 | 2332 | 2330 | 2341 | +11 |
| 失败 | 108 | 110 | **110** | **0** |
| 失败文件 | 26 | 27 | **27** | **0** |
| 失败文件集 | — | 27 个 | **27 个完全相同**（差集双向为空） | **零回归** |

Phase 3 连续跑了两轮全量，结果均为 2341/2451、27 失败文件、失败集逐文件一致；不是随机 flake。失败仍集中在 Phase 1 归类的 Seatbelt N/A、测试内 POSIX 路径 / home fixture 家族（含 `quota-thresholds` 的临时目录与超时、`crash-guards` 的子进程退出码），这些对 Node 版本与 FS shim 敏感 —— 历史记录多出的 2 个失败由此解释。Phase 2 修掉的目标类（`resolve` / `prompt-content`）未复活；`turn-state.test.ts` 现在失败的用例是「goal-loop 二进制 prompt 的临时目录残留」，与 Phase 2 修掉的 file-URI 用例不是同一个。

## 本阶段发现并修复的产品缺陷

**`interaction/requestOfficialMcpAuthHeaders` 被拒绝服务。** Phase 0 八场景 golden trace 一致显示桌面宿主以 `{}` 应答该 MCP OAuth 头请求；上游桥接器没有对应分支，请求落到通用 unsupported 路径回 `-32601 bridge unsupported`，后端因此反复重问（Phase 2 e2e stderr 中 6 次 `⚠ unhandled server→client request`）。

- **L2 先复现**：`L2 host duty: official MCP auth headers are answered, not rejected` 失败，错误信息 `host rejected the MCP auth ask: {"code":-32601,...}`。
- **修复**：`src/backend/client.ts` 的 `handleServerRequest` 增加到达即答分支，回 `{}` 并记日志；位置与 `session/requestRuntimePreferences` 的自动应答并列，避免占用交互队列。
- **固化**：fork `tests/contract/golden-contract.test.ts` 用 `route()` 直接验证「到达即答 + 不入队」，并另测未知请求仍入队（不放宽兜底行为）。

这是可回供上游的通用修复候选（与 Phase 2 的 file URI 降级同类），不属于 Windows 特化。

## Review 轮：发现并修掉一个阻塞级缺陷

首版 L1 24/24、L2 14/14 全绿，但复看假后端帧日志发现**绿得不诚实**：

> `stepTimeout waitingFor: provider/updateAccountConfig` 之后，日志里 `session/create` / `session/subscribe` / `session/send` 全部由 `genericReply` 提前应答，`scriptedReply` 一条都没有，事件流是在这些应答之后才发出的。

也就是说顺序复放被 1.2s 可选步骤卡住，`step.reply` 成了死代码，测试实际测的是「适配器能否容忍乱序」，不是「忠实复放 golden trace」。整改项：

| 级别 | 问题 | 处理 |
|---|---|---|
| **阻塞** | 顺序 waiter 导致脚本内请求被提前 generic-reply | 所有 `on:` 步骤在启动时**预注册 waiter**；移除会卡住的可选首步；L2 断言脚本内方法零 genericReply、每个 reply 有 `scriptedReply`、`matchedSteps === expectedSteps` |
| 应修 | 证据链只校验哈希，不校验派生 | `build-fixtures.mjs --check` 逐字节重派生（L0 门禁） |
| 应修 | L1 的 seq/sessionId 断言指向夹具自己重写过的字段（近似同义反复） | 改为**对原始 trace 记录**断言 seq 连续与终局有无，并独立重配对宿主应答、校验夹具未增删事件 |
| 应修 | crash / disconnect 用 `resultType:"success"` 的合成终局，却在 L2 断言 `end_turn`，把夹具行为当产品结果 | 合成帧改为 `harness_closed`（非 success）、清单记录 `syntheticFrameCount`；L2 对这两个场景**不断言 stopReason/消息**，测试标题改为「interrupted-turn harness close」 |
| 应修 | 结果表用全局 id→method 映射（同样受跨连接 id 复用影响）；`{}` 默认应答不可观测 | 结果改位置配对；默认应答的方法写入 `scriptComplete.defaultedMethods` |
| 应修 | 假后端可能残留；日志被后续探针覆盖 | stdin 关闭即 `process.exit(0)`；无条件回收进程树；主场景固定日志名、其它探针唯一日志名 |
| 提示 | 弱断言 / 自指校验 / 硬编码路径 / 报告里 prompt id 写死 | 断言补齐、清单 `requestAuth` 改断言 `<redacted>` 占位、`ZCODE_ACP_REPO`/`ZCODE_ACP_DIST` 可覆盖、prompt 响应按请求 id 定位 |

整改后做了独立复核（静态审阅 + 复放帧日志核对）：**阻塞级缺陷确认修复，无新增正确性问题，L2 保真断言均有真实日志支撑，隐私干净**。复核又提出两个「应修」，已一并处理：

| 应修 | 处理 | 验证 |
|---|---|---|
| `--check` 用生成机器的 `USERPROFILE` 做家目录规范化 → 换用户/CI 机器必然 DRIFT | 家目录前缀改为**从 trace 字符串本身**用通用正则派生（兼容转义后的双反斜杠），不再读 `os.homedir()` | `USERPROFILE=C:/Users/CI-Runner node contract/build-fixtures.mjs --check` → PASS |
| 一键门禁只刷新 recon 侧的不变量清单，fork 的 vitest 仍读旧副本 | `run.mjs` 每次把清单**按字节同步**到 fork；`export-manifest.mjs` 去掉 `generatedAt` 使产物确定 | 两侧文件 `cmp` 完全一致（零差异） |

另外按复核提示加固：`session/subscribe` waiter 超时提到 15s、重复 `server-N` 应答 id 可见、无终局事件时也不静默跳过等待、`answers` 断言补非空保护、stdin 关闭改为清 timer + `exitCode=0` 让 stdout 排空、报告对合成终局记 `harnessClosed:true` 且 `stopReason:null`。

最终：L0 PASS、L1 **36/36**、L2 **14/14**、fork vitest **11/11**，证据报告 `reports/phase3/contract-results.json` 由 `contract/run.mjs` 一次生成（`ok=true`）。

## 设计取舍（完整版见 `contract/README.md`）

1. `server-N` 与数值请求 id 都跨连接复用 → 应答/结果一律按位置配对；L1 用独立实现重配对原始 trace。
2. 所有脚本步骤**启动即预注册 waiter**，保证脚本内请求不会被提前 generic-reply；`session/send` 的应答先于事件流，权限应答的等待点放在终局事件之前（否则与适配器轮询队列互相等待）。
3. crash / disconnect 的 golden trace **本就没有终局事件**（后端被杀/断连）。L1 直接对原始 trace 断言「无终局」；L2 由夹具注入显式标记 `syntheticTerminal`、`resultType:"harness_closed"` 的终局以收口 ACP 回合，日志留痕、清单计帧，且**不断言该场景的产品结果**。
4. 运行时偏好、权限应答的形状桥接器与桌面宿主有意不同（AskUserQuestion 需走桥接器交互通道；ACP 选择被翻译为 `action`），契约只断言语义不强行对齐字面值。
5. ACP 响应帧必须带 `jsonrpc:"2.0"` —— SDK 对入站响应严格校验，缺字段会判 `-32600` 并让适配器 decline；这是测试客户端的坑，已修。
6. `session/stop` 不做尾部阻塞步骤（适配器回合结束即退出），改为在帧日志里断言其请求形式。
7. 未脚本化的适配器自有请求以 `{}` 应答并在 `defaultedMethods` 如实列出；隐私上夹具继承 trace 里已有的绝对路径，但**面向 fork 的紧凑清单经断言确认不含绝对用户路径或凭证**。
8. 全部离线：`ZCODE_HOME` 指向隔离假凭证树，不读用户真实凭证；`ZCODE_BIN` 指向本仓库脚本；无网络调用、无账户计划依赖、无 CLI 0.17.1 二进制依赖。

## 遗留与带入 Phase 4

1. `provider-registry: sync threw (Cannot read Desktop credential configuration)` —— 隔离 HOME 下必现的 best-effort 路径异常，需定位（Phase 2 已记）。
2. text_delta 重复模式（Phase 0 已记，现象不稳定），待定规则后补契约。
3. 上游剩余 110 个（同环境）Windows 测试失败逐类消除 + Windows CI 矩阵（Phase 5 前置）。
4. crash / disconnect 的真实进程死亡与断连语义需一个会主动退出的假后端来测（当前仅 L1 证据 + 合成终局）。
5. Phase 5 回供上游时，把 file URI 降级、`requestOfficialMcpAuthHeaders` 自动应答、#363/#123 的 start-plan 证据链一并呈现。

## 复现

```bash
# fork：构建（契约 L2 需要 dist/index.js）
cd C:/Users/Rt/.zcode/workspace/zcode-acp && ./node_modules/.bin/tsc

# recon：重建夹具 + 跑两层 + 出一键报告
cd C:/Users/Rt/.zcode/workspace/draft-26e30bc0-b470-4d11-afa5-0072a7c3058e/zcode-acp-recon
node contract/build-fixtures.mjs --check   # L0：夹具可逐字节重派生
node contract/run.mjs                      # L0 + L1 + L2 → 证据报告
```

## 回归判定

**零回归。** 同环境 Phase 2 基线 2330/2440（110 失败 / 27 文件）→ Phase 3 2341/2451（110 失败 / 27 文件）：失败用例数与失败文件集**逐项相同**，新增的 11 个用例全部通过。`src/backend/client.ts` 的改动只作用于 `interaction/requestOfficialMcpAuthHeaders` 这一条方法分支，现有测试中没有其它用例引用该字符串，且 fork 单元测试额外验证「未知请求仍入队」的兜底行为未被放宽。

与 Phase 2 历史记录（108 失败 / 26 文件）的 2 个差异来自运行环境（Node 版本 + FS shim），已由干净 worktree 的对照实验证明，不能算作 Phase 3 引入的回归。复现命令：

```bash
git worktree add /c/Users/Rt/.zcode/tmp/phase2-baseline phase2-windows   # 干净基线
# 链接 node_modules 后在该目录跑 ./node_modules/.bin/vitest run
```
