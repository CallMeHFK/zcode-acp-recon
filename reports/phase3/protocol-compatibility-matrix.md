# Protocol Compatibility Matrix — ZCode app-server 0.17.1 ↔ ACP（zcode-acp 桥接）

日期：2026-11-10 · 环境：Windows 11 / Node v24.20.0 / 桌面 3.17.2 · 证据链：recon repo `traces/*.sanitized.json` + fork `tests/fixtures/protocol-contract/*.json`

**证据分级**（评审规则）：
- **Confirmed** — 多次独立实测且语义明确，可作硬断言
- **Observed** — 至少一次真实观测，仅对该样本作断言
- **Inferred** — 从多事件/上游代码推导，不得单独作硬断言
- **Unknown** — 未验证；矩阵中显式留白，禁止推测

## 1. 传输与发现

| 协议面 | 行为契约 | 证据级 | 引用 |
|---|---|---|---|
| 启动 | `node zcode.cjs app-server --stdio`；行分隔 JSON、无 `jsonrpc` 字段；id+method=请求 / method=通知 / id=响应 | **Confirmed**（全部 trace） | phase0/2 |
| CLI 发现（Windows） | `ZCODE_BIN` → PATH(PATHEXT 扫描) → `%LOCALAPPDATA%\Programs\ZCode` 与 `C:\Program Files\ZCode` 的 `resources/glm/zcode.cjs`；Node 候选=ZCODE_NODE→桥自身 exe(非 Electron)→Program Files nodejs | **Confirmed** | phase2 e2e |
| Provider 配置注入 | `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE`(指向 `<resources>/config/provider/zcode-builtin.json`)+`ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` 两者必须同时显式；反斜杠路径会启动崩溃 | **Confirmed** | discover5（崩溃样例）+ e2e |
| 启动事件 | `startup/storageState` 通知序列（session DB 迁移 checking→committing→ready） | **Confirmed** | discover/discover2 |

## 2. 会话生命周期

| 协议面 | 行为契约 | 证据级 | 引用 |
|---|---|---|---|
| `session/create` | params 必含 `workspace{workspacePath,workspaceKey}`(strict)；可选 `model{providerId,modelId,options{reasoningLevel}}`；响应含 settings.model.available 全量注册表 | **Confirmed** | discover2/discover9 |
| `session/requestRuntimePreferences`（入站） | 两个 scope（runtime-materialization / user-execution）；响应须含 `nativeSearchEnhancementsEnabled:boolean`（必填）等（schema Uon） | **Confirmed** | 每次 create |
| `session/subscribe` | `{sessionId, deliveryKind:"desktop-continuous", includeSnapshot}`；响应含 eventSeq+snapshot(messages/projection/settings/todos/slashCommands) | **Confirmed** | suite 各场景 |
| seq 语义 | 单订阅内连续（多轮实测无一跳号）；跨生命周期重置；reconnect 从快照 eventSeq 续传 | **Confirmed** | normal/cancel/resume fixtures |
| `session/read` | projection(status/contextUsed/turnCount)+settings+messages | **Confirmed** | suite |
| `session/messages` | `{sessionId, afterMessageId?, limit?}` → 历史数组；跨进程一致（9==9） | **Confirmed** | resume fixtures |
| `session/resume` | `{sessionId, workspace?}`；新进程载入后 subscribe 可续；未知会话报 -32004 | **Confirmed**（①优雅退出 ②taskkill 强杀）| resume fixtures |
| `session/stop` | **必须请求形式**（非通知）；成功后 `turn.completed{resultType:"cancelled"}` | **Confirmed** | cancel fixture |
| `session/setModel` | `{sessionId, model, expectedRevision?}`；模型须已在注册表 | **Confirmed** | discover9 |
| `session/close` / `session/list` / `session/compact` / `session/fork` / `session/goal` | 方法存在于方法表 | **Inferred**（上游代码 + 部分调用） | 源码方法表 |
| 桌面 App 退出级联 | — | **Unknown**（未模拟） | — |

## 3. 模型与权益（start-plan 账户类）

| 协议面 | 行为契约 | 证据级 | 引用 |
|---|---|---|---|
| `provider/updateAccountConfig` | 载荷 `{revision, basedOnZCodeBuiltinRevision, providers{…access{type:"zhipu-account",entitled}, builtinModelIds}, states{availability,entitled,current}}`；basedOn = `zcode-builtin:43:sha256(resolve(builtin配置文件路径))`（哈希对象是**路径**非内容）；不匹配则注册表忽略 | **Confirmed** | 桌面宿主日志逐字段比对 + e2e |
| 鉴权头（入站，每次模型请求） | `interaction/requestProviderRuntimeHeaders`；回复 `{headersApplied:true, requestAuth:{apiKey:<共享登录态 JWT>}}`；**headers.authorization 形态被 AI SDK 拒绝**（"Anthropic API key is missing"）；CLI 0.17.1 请求可**不含 providerId**（须按 OAuth 族兜底） | **Confirmed** | Phase 2 e2e（成功+六次重试两个形态均实测） |
| start-plan 权益 | billing/current（JWT 可查，HTTP 200）是权益权威：plan_id `zcode-v3-start-plan-*` + entitlement capability `model:glm-5.3-flash`；上游"start-plan 需 captcha（#123）"与桌面宿主实测矛盾（JWT 直供即可推理） | **Confirmed** | finalize.json billing + e2e |
| 1113 语义 | 网关对"无权益计划"返回 `{code:"1113", message:"余额不足或无可用资源包"}`；经适配器错误通道透传 | **Confirmed** | discover9 失败样例 |
| 模型注册 | 仅 pushed-entitled 的 `builtinModelIds` 进入 `settings.model.available`；reasoning levels（Flash: low/high/max, default max）随模型元数据下发 | **Confirmed** | discover9 settings |

## 4. 回合与事件流（L2 归一化）

| 协议面 | 行为契约 | 证据级 | 引用 |
|---|---|---|---|
| 事件信封 | `session/event{sessionId, seq:int, type, payload}`（0.16.9+ turnId 在信封） | **Confirmed** | 全部 fixtures |
| `model.streaming` kinds 实测全集 | `text_delta` / `reasoning_delta` / `tool_call` / `tool_input_start` / `tool_input_delta` / `tool_input_end` | **Observed**（单轮样本；跨轮稳定性待更多样本） | permission-allow fixture |
| text_delta 重复 | 同一文本出现 1–3 份增量（不稳定）；最终 `turn.completed.payload.response` 为权威文本 | **Observed**（跨 run 计数不一致） | normal/replay |
| `tool.updated` 生命周期 | scheduled→started→progress?→result/**failed**；input 在 scheduled 时可 `inputOmitted`（先于其到达的 model.streaming tool_call 已缓存） | **Confirmed**（上游注释+fixture 双证） | permission fixtures |
| 工具失败语义 | 授权后工具仍可能执行失败：卡片以 failed 闭合、模型如实上报、回合 resultType=success | **Observed** | permission-allow（Write 失败样本） |
| turn 终态 | `turn.completed{resultType:"success"|"cancelled", usage?, response}`；**取消走 completed 而非 failed**；`turn.failed{error{code,message,attribution}}`；`turn.terminal` 在 0.17.1 **未观测到** | **Confirmed**（success/cancelled/failed 三形态）+ **Unknown**(terminal) | cancel/normal fixtures |
| 回合外事件 | `permission.requested/resolved`、`streamRecovery.updated`、`session.updated`（后台/插件/usage）、`session.titleUpdated`（自动命名一次后冻结）——PROTOCOL.md 文档未载 | **Observed** | fixtures 类型清单 |
| usage 字段类型 | `*Tokens` 等为 **number**；`tokenCount` 亦有 string 形态样本（红改器数值豁免后以 L1 为准） | **Observed** | finalize 后 fixtures |
| 早期取消竞态 | cancel 落在懒物化窗口（resolveSid 未绑定）时被静默丢弃、回合继续耗额度——已修复：park 到会话绑定即触发（L2 cancel 120ms 用例转绿） | **Confirmed**（修复前后 L2 对比） | fork 71a62fe |
| 断连语义 | 客户端断开（stdin 关闭不杀后端）→ 无鉴权头供给 → 回合挂起不执行、无外部副作用；重连 idle 可继续 | **Confirmed** | disconnect 场景 |

## 5. 权限与用户输入

| 协议面 | 行为契约 | 证据级 | 引用 |
|---|---|---|---|
| `interaction/requestPermission` | `{input,reason,requestId,riskLevel,sessionId,options[{optionId,kind,name}],toolCallId,toolName,turnId}`；kind∈allow_once/allow_always/deny（实测全集）；回复 `{optionId}` 即生效 | **Confirmed** | allow/deny fixtures |
| deny 行为 | 拒绝后回合正常完成（模型如实上报），无文件副作用 | **Confirmed** | permission-deny |
| `interaction/requestUserInput` | 出现于 schema；本套件以 `{action:"cancel"}` 应答（未深测表单） | **Observed**（浅） | — |
| `interaction/requestOfficialMcpAuthHeaders` | 桥未处理→警告，MCP OAuth 失败但非致命 | **Observed** | adapter log |
| elicitation（plan_approval/AskUserQuestion 表单） | — | **Unknown**（Windows MVP 未触发） | — |

## 6. ACP 侧输出（L3，适配器行为）

| ACP 面 | 行为契约 | 证据级 | 引用 |
|---|---|---|---|
| initialize | protocolVersion 1；authMethods=["ZCode built-in credentials"]；agentCapabilities 完整 | **Confirmed** | acp-e2e |
| session/prompt 流 | agent_message_chunk 逐增量；终止 stopReason=end_turn（正常/cancelled 场景的 ACP 映射由上游 turn 逻辑+contract 测试钉住） | **Confirmed** | acp-e2e + protocol-contract.test |
| stopReason 映射实测 | end_turn（成功）、cancelled（取消）| **Confirmed** | e2e/cancel |
| stopReason 映射未观测 | refusal / max_tokens / max_turn_requests | **Unknown**（上游代码存在对应分支） | — |
| stdout 纪律 | 协议独占 stdout：全量 trace 4989 行 0 非 JSON | **Confirmed** | reader.stats |

## 6.5 2026-11-10 实时补采（新计划窗口，ZCODE GLOBAL BUILD）

| 协议面 | 行为契约 | 证据级 | 引用 |
|---|---|---|---|
| 后台任务卡片（T10） | 后台 Bash 以 execute 卡片呈现：pending → in_progress → completed 全生命周期经适配器透传 | **Confirmed** | live-background.json |
| AskUserQuestion 映射 | 本构建经 **session/request_permission** 呈现（paramKeys: options/sessionId/toolCall；allow_once×2+reject_once），非 elicitation 表单；optionId 应答后继续 | **Observed**（上游 parseAskUserResponse 的表单路径在声明 elicitation 能力的客户端才走） | live-ask-user.json |
| 大输出多字节（T14） | 20 段中文增量流经适配器，0 个 U+FFFD（UTF-8 端到端无乱码） | **Confirmed** | live-multibyte.json |
| 活体复验 | 计划切换（WEEKEND→GLOBAL BUILD）后 e2e 仍 end_turn/OK | **Confirmed** | reports/acp-e2e.json |

## 6.7 凭证库 v2:os 迁移适配（2026-11-11，当日发现当日修复）

| 协议面 | 行为契约 | 证据级 | 引用 |
|---|---|---|---|
| 凭证库 v2 迁移 | 桌面 App 将 credentials.json 全量迁移到 enc:v2:os（OS 钥匙串）；CLI 0.17.1 同步支持（v1 机器派生密钥失效） | **Confirmed** | credential-source="os" + 全键 enc:v2:os: 前缀实测 |
| v2:os 解密链 | 密钥=OS 钥匙串 @napi-rs/keyring（service 'ZCode Credential Encryption', account=hex(sha256(解析路径))）的 32B base64url 值；封包 enc:v2:os:<source>:<fp24>:<iv>.<tag>.<data>，fp24=hex(sha256(key)).slice(0,24) | **Confirmed**（11/11 真实条目解密） | fork 3f29791 |
| requestCredentialCipher（入站） | CLI 把加解密委托给宿主（operation: encrypt/decrypt + value）→ 桥以 v2 密钥应答 {ok:true, value} | **Confirmed** | fork server-requests.ts + e2e |
| 恢复验证 | v2 适配后 ACP e2e 真实推理 end_turn/OK；L0+L1 36 + L2 14 门禁全绿 | **Confirmed** | contract-results.json ok=true |

## 7. 覆盖缺口（下一步证据采集清单）

1. T10/T14 已于 2026-11-10 补采（见 6.5）；T12 的 elicitation 表单路径（声明 form 能力的客户端）仍待采；T13 乱序重复待构造
2. `turn.terminal` 事件（0.15.2+ 文档载明，0.17.1 未观测）
3. `session/goal|fork|compact|subagents`、remote hub —— 上游代码在，行为未验证
4. 多客户端（`ZCODE_ACP_REMOTE=1`）first-response-wins —— 未验证
5. 账户计划过期后适配器行为（当前预期：模型列表清空 + 明确失败）—— 可低成本实测
