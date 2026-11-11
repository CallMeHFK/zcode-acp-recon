# zcode-acp-recon

对 ZCode（智谱官方编码 agent，桌面版）私有 `app-server --stdio` 协议做**可行性预研**，为后续「ZCode 的 ACP（Agent Client Protocol）适配器」项目提供工程证据。本仓库是 Phase 0（可行性门禁 Spike）+ Phase 1 前置的完整产出：可执行的探测工具 + 脱敏协议证据 + 门禁验收报告。

## 一句话结论

**Go** —— P0 门禁十项全 PASS：真实 app-server 可独立无头运行；现有桌面登录态可复用为 GLM Coding Plan 认证（账户侧 billing 佐证权益归属）；Session 可跨进程恢复（含 taskkill 强杀）且历史一致；桌面数据零破坏、权限/取消语义可控。

## 核心发现（适配器设计的决定性事实）

1. **启动方式**：`node zcode.cjs app-server --stdio`（行分隔 JSON、无 `jsonrpc` 字段）；`ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` 须指向桌面资源目录的 `config/provider/zcode-builtin.json`。
2. **宿主角色三必答**（客户端 = 未来适配器必须实现的入站请求）：
   - `session/requestRuntimePreferences`（runtime-materialization / user-execution 两个 scope）
   - `interaction/requestProviderRuntimeHeaders` —— **每次模型请求前**供给 `{headersApplied:true, requestAuth:{apiKey:<共享登录态JWT>}}`（anthropic 形态要求 apiKey，headers.authorization 会被拒绝）
   - `interaction/requestPermission`（options: allow_once / allow_always / deny）
3. **模型注册链**：`provider/updateAccountConfig`（账户配置需 `builtinModelIds` 绑定模型 + `basedOnZCodeBuiltinRevision` = 内置配置文件**解析路径的 sha256**）→ `session/create` 带 model+reasoningLevel（GLM-5.3-Flash: low/high/max，默认 max）。
4. **取消语义**：`session/stop` 须以**请求**形式发送 → `turn.completed{resultType:"cancelled"}`。
5. **断连安全**：客户端断开后后端不会失控执行（回合挂起等待鉴权头），重连后状态干净。
6. 已知坑：text_delta 存在重复（"OK" 产生 3 份增量，最终 response 权威）；Windows 反斜杠路径传 `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` 会致启动崩溃。

## 目录

```
AGENTS.md            执行约束（环境保护/数据安全/门禁状态机）
TASKS.md             逐项任务与 Gate 绑定（已全部执行）
docs/report-template.md   验收报告模板
probe/               探测工具（launcher/jsonl-reader/rpc-client/session-helper/suite/finalize/redact）
reports/             Runtime Compatibility Report · Gate Matrix 报告 · 各场景结果 JSON
traces/*.sanitized.json   脱敏协议证据（L1 原始证据，含统一元数据）
```

## 运行

```bash
node --version            # 需 ≥ 22（node:sqlite）
node probe/discover9.mjs  # 单场景：账户配置推送 + 模型注册 + 真实推理
node probe/suite.mjs      # 全场景套件（normal/permission/cancel/crash/resume/disconnect）
node probe/finalize.mjs   # billing 取证 + 并存观察 + 脱敏导出
```

前置：本机安装 ZCode 桌面版并已登录（凭证 `~/.zcode/v2/credentials.json`）；探测为只读观察，不修改任何 ZCode 数据。

## 证据与报告

- [reports/gate-matrix.md](reports/gate-matrix.md) — P0 门禁十项 + 证据引用 + Go/No-Go
- [reports/runtime-compat.md](reports/runtime-compat.md) — 运行时与凭证链路盘点
- [reports/phase1/](reports/phase1/baseline-decision.md) — 上游审计、基线锁定、Windows 改造边界
- [reports/phase2/windows-mvp.md](reports/phase2/windows-mvp.md) — Windows MVP 验收
- [reports/phase3/contract-tests.md](reports/phase3/contract-tests.md) — 协议契约测试验收
- [TASKS.md](TASKS.md) — 任务书（三轮评审冻结的 v4.1）+ 各阶段执行记录
- 原始 trace（`traces/raw/`）含凭据材料，**仅保留在本地、已 gitignore、不入库**（见 AGENTS.md G11）。

## Phase 3 契约测试（离线、可回归）

```bash
node contract/build-fixtures.mjs   # golden trace → 复放夹具（含 SHA-256 证据链）
node contract/run.mjs              # L1 + L2 两层测试 → reports/phase3/contract-results.json
```

`contract/` 以 `ZCODE_BIN` 注入假 app-server，驱动**真实适配器进程**复放八场景；不依赖网络、账户计划包、桌面登录态或 ZCode CLI 二进制。详见 [contract/README.md](contract/README.md)。

## License

Apache-2.0 — see [LICENSE](LICENSE). Evidence traces contain this machine's own protocol captures (paths, plan metadata); they are published as-is as research material.
