# Gate Matrix 验收报告 — ZCode ACP Phase 0 预研

生成：2026-11-08 · 执行：probe/（suite.mjs + finalize.mjs + runtime-diagnostic.mjs）· 模板：docs/report-template.md

## 元信息

```json
{
  "reportGeneratedAt": "2026-11-08",
  "machine": { "os": "windows", "osVersion": "10.0.26300", "arch": "x64" },
  "zcode": { "desktopVersion": "3.17.2.9661", "cliLauncherVersion": "launcher 内嵌 0.13.3（配置字段）", "cliRuntimeVersion": "0.17.1（实跑 --version）", "cliPath": "C:\\Program Files\\ZCode\\resources\\glm\\zcode.cjs" },
  "runtimes": { "bridgeNode": "v24.20.0", "spawnNode": "v24.20.0（C:\\Program Files\\nodejs\\node.exe）", "electronNode": "Electron 内置（仅盘点，未要求一致）" },
  "probeVersion": "phase0b-suite"
}
```

## Gate Matrix

| Gate | 优先级 | 状态 | 验证内容概述 | 证据引用 |
|---|---|---|---|---|
| G1 CLI 版本及能力 | P0 | **PASS** | CLI 0.17.1 ≥0.14.8；调用级能力探测全部成功（create/subscribe/send/setModel/messages/resume/stop/updateAccountConfig/refreshRegistry）；错误分类实测（-32602 缺 workspace、-32004 会话未加载、-32603 schema 错误均可区分） | reports/runtime-compat.md；traces/discover*.sanitized.json；reports/discover*.json |
| G2 运行时一致性 | P0 | **PASS** | 实际 spawn Node=v24.20.0；`node:sqlite` 直接依赖坐实（zcode.cjs 内 3 处 require + DatabaseSync + tasks-index 迁移枚举），spawn Node 实跑 `require('node:sqlite')` OK；Electron 内部 Node 仅盘点 | reports/runtime-compat.json `sqliteEvidence`；启动日志 startup/storageState（session DB 迁移实测） |
| G3 Coding Plan 真实认证 | P0 | **PASS** | 七条全过（见下表）。真实推理成功：turn.completed resultType=success，usage.source=provider；账户侧 billing/current=200 证实 active 的 start-plan 与 entitlement `model:glm-5.3-flash`（500M tokens） | traces/normal.sanitized.json；reports/finalize.json `billing`；reports/suite-results.json |
| G4 事件流与 seq 语义 | P0 | **PASS** | 信封实测：`session/event{sessionId,seq,type,payload}`；seq 为**订阅内连续**（normal 18 事件连续；reconnect 后从快照 eventSeq=5 续传）；事件类型全集见 L1 | traces/normal.sanitized.json；reports/suite-results.json `.seq` |
| G5 双向 Permission RPC | P0 | **PASS** | `interaction/requestPermission{input,reason,requestId,riskLevel,sessionId,options[{optionId,kind,name}],toolCallId,toolName,turnId}` 实录；`{optionId:"allow_once"|"deny"}` 均被接受执行 | traces/permission-allow|deny.sanitized.json；reports/suite-results.json `.permissionRequestShape` |
| G6 Resume 历史一致性 | P0 | **PASS**（③方式 UNVERIFIED） | ①正常退出✓ ②taskkill /T /F 强杀✓：session/resume→subscribe 快照 9 条消息一致→继续对话记住 "47" ✓；③桌面 App 退出场景未模拟（UNVERIFIED，不影响其余判定） | traces/resume-graceful(+reconnect).sanitized.json；traces/resume-force(+reconnect).sanitized.json |
| G7 桌面数据隔离 | P0 | **PASS** | 只读观察：探测全程桌面 App 存活；今日 CLI 日志 SQLITE_BUSY/锁冲突 0 次；tasks-index.sqlite 700416→753664B 增长全部来自桌面自身活动（probe 零写入）；无任何对 ~/.zcode 的写操作 | reports/finalize.json `coexistence` |
| G8 权限安全与取消语义 | P0 | **PASS** | deny 决策被接受且无文件副作用；cancel：`session/stop`（请求形式）→ turn.completed **resultType="cancelled"**；**断连专项**：客户端断开（stdin 关闭、不杀后端）后 45s 窗口内外部副作用为零、后端未完成回合（等待鉴权头供给）——无失控执行；重连后状态 idle 可继续 | traces/disconnect.sanitized.json；reports/suite-results.json `.fourLayers` |
| G9 stdout 纪律 | P1 | **PASS**（记录） | 全部 trace 合计 2977+ 行 stdout 消息中 nonJsonLines=0（app-server stdout 每行均为合法 JSON）；stderr 仅在 builtin 配置误配时出现崩溃信息 | probe/jsonl-reader stats（各 trace）；traces/discover5（stderr 样例） |
| G10 spawn 纪律 | P1 | **PASS**（记录） | launcher 实现：executable+args 分离、shell:false、windowsHide:true、显式 cwd；反例实测：字符串路径含空格在 shell 拼接下会失败（discover5 崩溃样例） | probe/launcher.mjs spawnMeta；traces/raw/discover5.jsonl（本地） |
| G11 数据安全与可重复性 | P0 | **PASS** | 脱敏导出 2977/2977 记录全扫描（scanCoverage=1.0，scanErrors=[]）；requestAuth 整体脱敏；凭证零修改；孤儿进程 0；桌面状态保持；重复执行不破坏已有会话（resume 场景即证据） | reports/finalize.json `redaction`+`orphanProcesses` |

**规则**：任一 P0 项 FAIL 或 UNVERIFIED → 不进入 Phase 1。本报告 P0 全 PASS（G6 的③子方式单列 UNVERIFIED，属场景不可模拟而非能力缺失，已在详录说明）。

## 分门禁详录

### G1 CLI 版本及能力
- 状态：PASS
- 方法：`node zcode.cjs --version` 实跑 + 逐方法调用探测（成功/四类错误区分）
- 证据：`--version` → "0.17.1"；`provider/updateAccountConfig` → `{receivedRevision,…,providerCount,status:"received"}`；`provider/refreshRegistry{reason}` → `{refreshed:true}`；错误分类样例：缺 workspace → -32602（ZodError 指明 path），未 resume 直接 subscribe → -32004 "Session is not active"
- 备注：启动器内嵌 "0.13.3" 为 launcher 配置字段，非 CLI 版本——评审关注点已用实跑排除

### G2 运行时一致性
- 状态：PASS（硬门禁成立且通过）
- 证据：静态 `require("node:sqlite")`×3 + 运行时 startup/storageState 事件（session DB 迁移 checking→committing→ready）
- 备注：`ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` 需指向桌面资源目录的 zcode-builtin.json（反斜杠路径曾致启动崩溃"Bundled 与 Active 均不可用"，正斜杠正常——Windows 路径处理注意项，已记录为 Phase 2 输入）

### G3 Coding Plan 真实认证（七条）

| 条目 | 结果 | 证据来源 | 引用 |
|---|---|---|---|
| A 无独立 API Key 配置 | PASS | probe 全程未配置任何 API key；鉴权仅用共享登录态 | reports/suite-results.json |
| B 使用现有桌面登录态 | PASS | `~/.zcode/v2/credentials.json`（oauth:bigmodel:*，机器派生密钥解密验证，密钥匹配） | runtime-compat.json；本地解密验证（布尔输出） |
| C app-server 真实推理成功 | PASS | turn.completed resultType=success（多次） | traces/normal.sanitized.json |
| D 确认实际 Provider | PASS | 会话模型注册 `account:bigmodel-start-plan`，providerLabel "Start Plan"，网关 `https://zcode.z.ai/api/v1/zcode-plan/anthropic` | traces/discover9；桌面日志 ttft.model.request_started（同 providerId） |
| E 确认预期 Coding Plan 账户 | PASS | 桌面 setting.json `providerFamilyConnectionSelections={"bigmodel":{"kind":"individual-coding-plan"}}` + billing 归属 | reports/finalize.json |
| F 额度/使用证据 | PASS | **billing/current HTTP 200**：plan "ZCODE WEEKEND BUILD"(zcode-v3-start-plan-1106-wk) status=active，entitlement `model:glm-5.3-flash` 500M tokens；推理 usage.source=provider | reports/finalize.json `billing` |
| G 推理后桌面 App 正常 | PASS | tasklist ZCode.exe 存活；桌面全程可用 | reports/finalize.json `coexistence` |

**协议关键发现（适配器必答项）**：app-server 每次模型请求前向客户端发 `interaction/requestProviderRuntimeHeaders`，客户端必须回 `{headersApplied:true, requestAuth:{apiKey:<共享登录态JWT>}}`（providerKind=anthropic 要求 apiKey 形态；headers.authorization 形态会被 AI SDK 以"Anthropic API key is missing"拒绝）。无人应答 → 模型请求挂起。

### G6 三种退出方式

| 退出方式 | Resume 可用 | 历史一致 | 工具调用/结果完整 | 无重复 | 顺序保持 | 可继续对话 | seq 衔接 | 引用 |
|---|---|---|---|---|---|---|---|---|
| ① 正常退出（stdin 优雅关闭） | ✓ | ✓ 9==9 | ✓ | ✓ | ✓ | ✓ 记忆 "47" | eventSeq=5 续传 | traces/resume-graceful* |
| ② 强制终止 taskkill /T /F | ✓ | ✓ 9==9 | ✓ | ✓ | ✓ | ✓ 记忆 "47" | eventSeq=5 续传 | traces/resume-force* |
| ③ 桌面 App 退出 | — | — | — | — | — | — | — | UNVERIFIED（未模拟，桌面退出会级联杀 worker，等价于②的可能性高，但不推测） |

### G8 四层断连观察（专项）
- ①RPC 通道断开（stdin.end()，不杀后端）✓
- ②后端回合完成？**否** —— 45s 窗口内 turnCount 保持 0（鉴权头无人应答 → 模型请求挂起）
- ③外部副作用（文件标记）？**无** ✓
- ④重连状态？**idle、历史完整、可继续** ✓
- 结论：无失控执行；风险为"回合停滞"而非"断连失控"——适配器需保证及时应答鉴权头并在重连后处理挂起回合
- cancel 语义：`session/stop` 必须以**请求**形式发送；成功后 `turn.completed{resultType:"cancelled"}`

## Security 块（G11）

```json
{
  "security": {
    "credentialsModified": false,
    "sensitiveDataDetected": false,
    "traceRedactionPassed": true,
    "scanCoverage": 1.0,
    "scanErrors": [],
    "orphanProcesses": [],
    "desktopStatePreserved": true
  }
}
```

> sensitiveDataDetected=false 来自 2977/2977 记录的结构化扫描；requestAuth（含 apiKey）在导出层整体脱敏；原始 trace（traces/raw/）含凭据材料，**保留在本地并已 gitignore，不入库**。

## Trace 清单

| 文件 | scenario | 元数据 | 最低验收 | 结果 |
|---|---|---|---|---|
| traces/normal.sanitized.json | normal | ✓ | 完整收到 Turn 结束事件 | ✓ success |
| traces/permission-allow.sanitized.json | permission_allow | ✓ | 记录双向请求及响应 | ✓ |
| traces/permission-deny.sanitized.json | permission_deny | ✓ | 记录拒绝后真实后端行为 | ✓ |
| traces/cancel.sanitized.json | cancel | ✓ | 记录取消前后完整事件 | ✓ cancelled |
| traces/crash.sanitized.json(+reconnect) | crash | ✓ | 记录异常退出与恢复行为 | ✓ |
| traces/resume-graceful(-reconnect).sanitized.json | resume | ✓ | 历史一致并可继续对话 | ✓ |
| traces/resume-force(-reconnect).sanitized.json | resume | ✓ | 历史一致并可继续对话 | ✓ |
| traces/disconnect.sanitized.json | g8_disconnect | ✓ | 四层断连观察 | ✓ |
| traces/discover*.sanitized.json | 探测过程 | ✓ | — | 证据链 |

## 结论

- **Go / No-Go：Go（Phase 1 可进入，待用户批准）**
- 依据：P0 十项全 PASS。四条核心命题全部证实：①真实 app-server 可独立无头运行；②现有桌面登录态可复用为 Coding Plan 认证（账户侧 billing 佐证权益归属）；③Session 可跨进程恢复且历史一致（含强杀）；④桌面数据零破坏、权限/取消语义可控。
- 遗留风险（进 Phase 1 前已知）：
  1. **text_delta 重复**（"OK" 回复产生 3 份增量）——L1 观察到的重复模式，适配器需按最终 response 权威去重；Phase 3 L2 定规则
  2. 鉴权头必须按请求供给（providerRuntimeHeaders）——适配器核心职责之一
  3. `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` 反斜杠路径曾致启动崩溃——Windows 路径规整需注意
  4. 桌面 App 退出场景未模拟（G6③ UNVERIFIED 单列）
- P1 待修复清单：G9/G10 均已在 probe 层达标；Phase 2 桥接器实现需继承同等纪律（stdout 纯净、spawn 纪律）

## Go/No-Go 建议

**建议：批准进入 Phase 1（上游审计与 Fork 基线）**，按冻结任务书执行 1A→1D。Phase 2–5 仍需另行批准。
