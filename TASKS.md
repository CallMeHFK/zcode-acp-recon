# TASKS.md — Phase 0 逐项任务（Gate 绑定 + 证据要求）

> **执行结果（2026-11-08）**：Phase 0A/0B/0C 全部完成，P0 门禁十项全 PASS，Go 建议——见 [reports/gate-matrix.md](reports/gate-matrix.md)。下表 ✅ 为已执行项。
>
> 执行顺序：0A → 0B → 0C 严格递进。每项任务完成后在 [状态] 标记 PASS/FAIL/UNVERIFIED/N/A 并附证据路径。
> 门禁状态定义与全局约束见 [AGENTS.md](AGENTS.md)；报告格式见 [docs/report-template.md](docs/report-template.md)。

## Phase 0A — 静态诊断（不启动 app-server）

| # | 任务 | 绑定 Gate | 证据要求 | 状态 |
|---|---|---|---|---|
| A1 | 桌面安装结构盘点：`C:\Program Files\ZCode` 目录树（≤3 层）、ZCode.exe 文件版本、resources/glm 内容清单 | — | reports/runtime-compat.json `desktop` 块 | ✅ |
| A2 | zcode.cjs 真实路径确认 + 内嵌版本静态读取（启动器自称 0.13.3 需复核）+ `node zcode.cjs --version` 实跑（不启动 app-server） | G1（部分） | 版本字符串来源 + 实跑输出摘录 | ✅ |
| A3 | 三个运行时盘点：系统 Node（PATH）、zcode 捆绑 node-runtime（是否存在 node.exe）、Electron 内部 Node（仅记录 ZCode.exe/Electron 版本，不要求一致） | G2（输入） | 各 Node 可执行路径 + 版本 | ✅ |
| A4 | 凭证文件结构盘点：`~/.zcode/cli/config.json`、`~/.zcode/v2/{setting.json,provider_config.json,credentials.json,config.json?}` —— **仅顶层键名/值类型/文件大小/mtime**，不读取值内容、不修改 | G3（输入） | 结构清单 JSON | ✅ |
| A5 | node:sqlite 静态证据：在 zcode.cjs 与 packages 内 grep `node:sqlite`/`DatabaseSync`/`tasks-index` 调用线索；确认是否存在原生二进制 | G2（判定 N/A 还是硬门禁） | grep 命中行摘录 | ✅ |
| A6 | 汇总产出 Runtime Compatibility Report 初版 | — | reports/runtime-compat.json + .md | ✅ |

**0A 出口条件**：zcode.cjs 路径与可执行运行时明确；G2 依赖证据已收集。若 zcode.cjs 不可执行且无替代运行时 → 停止，G1 判 FAIL。

## Phase 0B — 协议探测（独立测试 Session；隔离工作区 traces/workspace/）

| # | 任务 | 绑定 Gate | 证据要求 | 状态 |
|---|---|---|---|---|
| B1 | probe/ 基础设施：launcher（解析 ZCODE_BIN→PATH→Program Files zcode.cjs；spawn 用 args 数组、shell:false、windowsHide、显式 cwd=G10 自证）、jsonl-reader（Buffer 累积 + 流式 UTF-8 解码、容忍 \r\n、退出时 flush）、rpc-client（id 配对、超时、错误分类） | G10（自证） | 代码 + 单元自测输出 | ✅ |
| B2 | G1 能力探测：对目标方法逐一调用并**区分 Method-not-found / Invalid params / Unauthorized / Success**（非 Success ≠ 能力不存在）；记录 CLI 版本与兼容区间（0.14.8 仅历史经验） | G1 | 每方法四态判定表 | ✅ |
| B3 | G2 运行时一致性：对**实际 spawn 的 Node** 跑版本与 `node -e "require('node:sqlite')"`；结合 A5 证据判定 PASS/FAIL/N/A | G2 | 运行时报告 | ✅ |
| B4 | G3 认证归属（七条）：无独立 API key 配置／现有登录态／真实推理成功／确认实际 Provider／确认预期 Coding Plan 账户／额度或账户侧使用证据／推理后桌面 App 正常。**每条注明证据来源（app-server 日志 / 配置 / 账户页面 / 使用记录）；来源不可确认 → UNVERIFIED** | G3 | auth-evidence.json（脱敏） | ✅ |
| B5 | G4 事件流与 seq 语义：采集完整 turn 事件流；探明 seq 作用域（全局/会话/订阅/连接、snapshot 边界）后仅对同订阅连续流断言连续性 | G4 | trace normal.jsonl + seq 分析 | ✅ |
| B6 | G5 双向 Permission RPC：触发工具权限请求，落盘请求与响应精确 JSON（结构未知，以实测为准） | G5 | trace allow/deny.jsonl | ✅ |
| B7 | G6 Resume 历史一致性：create→消息A→记录末 seq→退出→重启→resume→messages→与原历史逐项比对（完整性/工具调用与结果/重复/顺序）→发消息B→新流正常→seq 衔接。**三种退出方式分别记录：①正常退出 ②强制终止(taskkill /T /F) ③桌面 App 退出（如不可模拟则记 UNVERIFIED 并注明）** | G6 | trace resume-*.jsonl + 比对报告 | ✅ |
| B8 | Trace 采集与脱敏：六场景（Normal/Permission Allow/Permission Deny/Cancel/Crash/Resume）+ 统一元数据（zcodeVersion/runtimeVersion/os/arch/captureTimestamp/scenario/evidenceLevel/redactionVersion）+ redact.mjs 结构化脱敏 | G11（部分） | traces/*.sanitized.jsonl + 脱敏报告 | ✅ |

**0B 出口条件**：G1–G5 已判定；G6 至少完成①②两种退出方式。任一 P0 项 FAIL → 按门禁规则处理（G1 即 No-Go）。

## Phase 0C — 安全与并存（0A+0B 通过后）

| # | 任务 | 绑定 Gate | 证据要求 | 状态 |
|---|---|---|---|---|
| C1 | G8 权限安全（隔离工作区内）：拒绝确实中止操作／超时≠允许／取消后旧请求不执行／**客户端断开后后端是否继续执行已发出工具调用**——ACP 侧取消 / ZCode Turn 停止 / 外部进程停止 / 延迟副作用四层分别观察 | G8 | trace 断连场景.jsonl + 四层观察表 | ✅ |
| C2 | G7 桌面数据隔离（**只读观察**）：并存矩阵（桌面空闲/生成中/退出中/桥接器被杀）；指标=tasks-index.sqlite(-wal/-shm) 文件大小与 mtime 变化、日志中 SQLITE_BUSY/锁冲突、桌面 App 进程存活与异常恢复 | G7 | coexistence.json（前后对比） | ✅ |
| C3 | G11 数据安全收口：security 块 = credentialsModified / sensitiveDataDetected（扫描结果）/ traceRedactionPassed / **scanCoverage / scanErrors（扫描失败不得报安全通过）** / orphanProcesses（枚举残留子进程）/ desktopStatePreserved | G11 | security.json | ✅ |
| C4 | G9 stdout 纪律记录：子进程 stdout 每行是否均为合法 JSON；异常行记为 P1 待修复证据 | G9 | stdout-discipline.log | ✅ |

## 汇总

| # | 任务 | 证据要求 | 状态 |
|---|---|---|---|
| S1 | Gate Matrix 报告：G1–G11 四态 + 每条证据引用 + Go/No-Go 建议 | reports/gate-matrix.md + .json | ✅ |
| S2 | 若 No-Go：停止，仅交付证据；若 Go：Phase 1 待用户另行批准 | — | ✅ |

## Phase 1（2026-11-09 已执行，产出见 reports/phase1/）

> **Phase 2 亦已执行**（用户批准继续）：Windows MVP 达成——分支 phase2-windows @ e24e95e，四组修复 + ACP e2e 真实推理成功，见 [reports/phase2/windows-mvp.md](reports/phase2/windows-mvp.md)。
1A 三仓库静态审计（william0wang 主基线候选 / BrokkAi 第二参考 / haowei2000 下游）→ 1B 锁定审计 Commit SHA（npm 版本/锁文件/engines）→ 1C Fork + 测试基线 → 1D Windows 改造边界设计（platform/windows/* + runtime/* 隔离）。
