# Phase 3 — 协议契约测试（Golden Trace Contract Suite）

目标：把 Phase 0 的八场景脱敏 golden trace 变成**可执行、可回归、完全离线**的契约测试，闭合 `architecture-note.md` 里的证据链：

```
Phase 0 probe（黑盒） → 适配器实现（白盒） → 同一 trace 复放比对
```

## 为什么需要它

Phase 2 的 ACP e2e 依赖**真实推理**：周末计划包到期后就无法复跑，且只能覆盖一条 happy path。Phase 3 用 `ZCODE_BIN` 注入假 app-server，把 trace 里的请求/应答/事件流复放给**真实的适配器进程**（`dist/index.js`），于是：

- 不依赖网络、账户计划、桌面登录态或 CLI 0.17.1 二进制；
- 用隔离 `ZCODE_HOME`（纯假凭证）驱动，绝不读用户真实凭证；
- 八场景全部可重复，断言同时覆盖 ACP 客户端侧与后端宿主侧。

## 两层结构

| 层 | 文件 | 断言对象 | 用例数 |
|---|---|---|---|
| **L0** | `build-fixtures.mjs --check` | 夹具可从 trace **逐字节重新派生**（SHA-256 之外的真派生校验） | 门禁 |
| **L1** | `trace-contract.test.mjs` | 原始 trace 本身（seq 连续、终局有无、宿主应答独立重配对、权限选项、stop 请求语义、脱敏）+ 夹具保真 + 证据链 | 36 |
| **L2** | `adapter-contract.test.mjs` | 真实适配器进程：initialize / session-new / 事件顺序 / stopReason / stdout 纪律 / 宿主应答 / 权限转发 / cancel→stop，**以及复放引擎自身的保真度** | 14 |

**fork 侧回归网**：`tests/contract/golden-contract.test.ts`（vitest，11 用例）消费紧凑清单 `tests/contract/fixtures/contract-manifest.json`，随 `pnpm test` 一起跑；另有 3 个单元测试直接验证 `ZcodeBackend.handleServerRequest` 的到达即答行为。

## 运行

前置：fork 已构建（`tsc` 产出 `dist/index.js`）。默认路径按目录结构推导，可用 `ZCODE_ACP_DIST` 覆盖。

```bash
# 1) 由 golden trace 重新生成夹具（trace 变动后必做；会更新 SHA-256 清单）
node contract/build-fixtures.mjs

node contract/build-fixtures.mjs --check   # 校验已提交夹具未漂移

# 2) 导出紧凑清单给 fork 的 vitest
# 一键门禁 run.mjs 会自动同步 fork 侧清单；手动导出时用：
node contract/export-manifest.mjs "$ZCODE_ACP_REPO/tests/contract/fixtures/contract-manifest.json"

# 3) 分层测试
node --test --test-timeout=180000 contract/trace-contract.test.mjs
node --test --test-timeout=180000 contract/adapter-contract.test.mjs

# 4) 一键门禁 + 证据报告（自动跑 L0/L1/L2 并刷新清单）
node contract/run.mjs        # → reports/phase3/contract-results.json
```

路径可用环境变量覆盖：`ZCODE_ACP_REPO`（fork 根目录）、`ZCODE_ACP_DIST`（已构建的 dist）。

## 文件与证据链

| 文件 | 作用 |
|---|---|
| `traces/*.sanitized.json` | L1 原始证据（Phase 0，已脱敏） |
| `build-fixtures.mjs` | trace → 紧凑复放脚本；记录源 trace 的 SHA-256 |
| `fixtures/<scenario>.json` | 八场景复放脚本（results / hostAsks / turnEvents / steps） |
| `fixtures/manifest.json` | 每个夹具与源 trace 的 SHA-256，L1 校验漂移 |
| `fixtures/contract-manifest.json` | 仅不变量，供 fork vitest 消费 |
| `fake-app-server.mjs` | 作为 `ZCODE_BIN` 被真实适配器 spawn；按脚本复放，逐帧记日志 |
| `acp-client.mjs` | 最小 ACP 客户端（含 `session/request_permission` 应答） |
| `logs/*.jsonl` | 每次运行的后端帧日志 + ACP 帧日志（本地，gitignore） |
| `reports/phase3/contract-results.json` | 一键门禁产出的证据摘要 |

八场景取自 `probe/suite.mjs` / `reports/suite-results.json`：normal、permission-allow、permission-deny、cancel、crash、disconnect、resume-graceful、resume-force。

## 诚实的设计取舍（review 必读）

1. **`server-N` 与数值请求 id 都跨连接复用。** 合并 trace 里每个新会话都重新编号，应答与结果一律**按位置配对**（该记录之后第一个同 id 的 answer），不能建全局 id→answer 映射；否则权限请求会错配到鉴权头应答。L1 用独立实现重配对原始 trace 来校验夹具。
2. **所有脚本步骤在启动时预注册 waiter。** 适配器几乎同时发出 `session/create` / `session/subscribe` / `session/send`；若顺序循环先卡在可选步骤上等待，这三个请求会在等待期间被提前 generic-reply，`step.reply` 变成死代码，事件也就在应答之后才发 —— 测的会变成「适配器是否容忍乱序」而不是「忠实复放」。L2 现在断言：脚本内方法不得出现在 `genericReply`、每个 `reply` 都由 `scriptedReply` 真正发出、`matchedSteps === expectedSteps`。
3. **权限应答的等待点在终局事件之前。** 适配器要等回合事件流开始才轮询 server-request 队列；在发事件前等权限应答会互相等待。因此 `session/send` 步骤只等「到达即答」的鉴权头，权限 ask 在事件步骤里等到终局事件之前才收答案。
4. **crash / disconnect 没有终局事件**（后端被杀、客户端断连），这本身就是证据。L1 直接对原始 trace 断言「无终局」；L2 为了让 ACP 回合能收口，由**测试夹具**注入显式标记 `syntheticTerminal`、且 `resultType:"harness_closed"`（非 success）的终局，日志留痕、清单记录 `syntheticFrameCount`。L2 对这两个场景**不断言任何产品结果**（stopReason / 消息内容），只断言握手、stdout 纪律与复放保真度。
5. **`session/requestRuntimePreferences` 的应答形状与桌面宿主不同且是有意的**：桥接器固定 `askUserQuestionAutoResolutionEnabled:false`，以便 AskUserQuestion 走桥接器交互通道。契约只断言必需布尔位存在，不强行对齐桌面值。
6. **`interaction/requestPermission` 的后端应答形状不同**：Phase 0 probe 回 `{optionId:"allow_once"}`；桥接器把 ACP 选择翻译为 `{action:"accept"/"decline"}`。契约断言「客户端批准时不得回 decline」，不臆断哪种形状才是唯一合法。
7. **ACP 响应帧必须带 `jsonrpc:"2.0"`**。SDK 对裸请求宽容、对入站响应严格；缺字段会被判 `-32600 Invalid request`，适配器随即 decline 权限请求。这是测试客户端踩过的坑，不是产品缺陷。
8. **`session/stop` 顺序步骤故意不做**。适配器在回合结束、stdin 关闭时立刻退出，尾部阻塞等待会让复放脚本永远完不成；改为在帧日志里捕获入站 `session/stop` 并断言其带 id（请求形式）。
9. **未脚本化的适配器自有请求**（`workspace/updateDynamicWorkflowPolicy`、`session/messages`、`session/read` 等）不在 golden trace 里，假后端以 `{}` 应答并在 `scriptComplete.defaultedMethods` 中如实列出；有记录结果的方法则复用记录形状。这是明确的口径，不冒充实测应答。
10. **进程与日志卫生**：假后端 stdin 关闭即 `process.exit(0)`；ACP 客户端在 `finally` 里无条件对 Windows 进程树执行 `taskkill /T /F`（干净退出也可能留下 detached 的假后端）；主场景写固定日志名，其它探针用唯一日志名，互不覆盖。
11. **假后端不模拟真实模型输出**，只复放 trace 里记录的事件。因此 L2 验证的是**协议契约与翻译行为**，不是推理质量。
12. **隐私口径**：夹具把 session id、探针工作区路径（`<CWD>`）、用户 ZCode 家目录前缀（`<ZCODE_HOME>`）规范化；但 sanitized trace 里其它绝对路径（如插件 hook 的 `commandDisplay`）会原样继承 —— 这些路径在已提交的 `traces/*.sanitized.json` 里本就存在，不构成新增泄露。**面向 fork 的紧凑清单经测试确认不含任何绝对用户路径或凭证。**

## 本阶段发现并修复的产品缺陷

`interaction/requestOfficialMcpAuthHeaders`：桌面宿主在 8/8 场景回 `{}`，上游桥接器却落到通用 unsupported 分支回 `-32601`（Phase 2 e2e 日志里 6 次 `⚠ unhandled server→client request`）。L2 契约测试先复现，再在 `src/backend/client.ts` 的 `handleServerRequest` 里加到达即答分支，并补 fork 单元测试。

## 带入 Phase 4

- `provider-registry: sync threw (Cannot read Desktop credential configuration)`（best-effort 路径，本阶段用隔离 HOME 时必现，需定位）
- text_delta 重复模式（Phase 0 已记，需定规则后写契约）
- 上游 Windows 测试基线剩余失败集（本阶段未逐类消除）
