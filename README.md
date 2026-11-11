# zcode-acp-recon

ZCode（智谱官方编码 agent，桌面版）私有 `app-server --stdio` 协议的**逆向工程与适配器可行性研究**。本项目从零证据起步，交付了一套可运行的 **ZCode ACP（Agent Client Protocol）适配器**（fork 自 [william0wang/zcode-acp](https://github.com/william0wang/zcode-acp) 并完成 Windows + start-plan 账户适配），以及支撑它的全部工程证据：探测工具、脱敏协议 trace、三层契约测试和逐阶段验收报告。

## 当前状态（2026-11-11）

**Phase 0-4 全部完成并验收**：预研门禁十项全 PASS → 上游基线锁定 → Windows MVP（真实推理端到端）→ 协议契约层（L0/L1/L2 三层门禁）→ 生产候选（加固审计 + 证据补采）。当前已知唯一未决项：桌面 App 凭证库迁移到 `enc:v2:os` 后的适配（**已当日修复**，见下），以及 Phase 5 的上游回供（待授权）。

## 核心发现（适配器设计的决定性事实）

1. **启动方式**：`node zcode.cjs app-server --stdio`（行分隔 JSON、无 `jsonrpc` 字段）；Windows 上须以正斜杠路径设置 `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` 指向桌面资源目录的 `config/provider/zcode-builtin.json`。
2. **宿主角色四必答**（客户端 = 适配器必须实现的入站请求）：
   - `session/requestRuntimePreferences`（runtime-materialization / user-execution 两个 scope）
   - `interaction/requestProviderRuntimeHeaders` —— **每次模型请求前**供给 `{headersApplied:true, requestAuth:{apiKey:<共享登录态JWT>}}`（anthropic 形态要求 apiKey；CLI 0.17.1 的请求可能**不带 providerId**，须按 OAuth 族兜底）
   - `interaction/requestPermission`（options: allow_once / allow_always / deny）
   - `interaction/requestCredentialCipher` —— CLI 把凭证加解密**委托给宿主**（v2 凭证库下必答）
3. **模型注册链**：`provider/updateAccountConfig`（账户配置需 `builtinModelIds` 绑定模型 + `basedOnZCodeBuiltinRevision` = 内置配置文件**解析路径的 sha256**）→ `session/create` 带 model+reasoningLevel（GLM-5.3-Flash: low/high/max，默认 max）。
4. **权益权威**：上游启发式会把 OAuth 连接误判为 individual 计划；正确做法是以 **billing/current 查询**（共享 JWT 可用）得到的实际 active 计划为准（start-plan 账户类必踩 1113 坑，见 issue #363）。
5. **凭证库 v2 迁移**：桌面 App 于 2026-11-10/11 将 `~/.zcode/v2/credentials.json` 迁移到 `enc:v2:os`（OS 钥匙串）加密——密钥存于 `@napi-rs/keyring`（service "ZCode Credential Encryption"，account = hex(sha256(解析路径))）；封包 `enc:v2:os:<source>:<指纹24hex>:<iv>.<tag>.<data>`。上游桥接器普遍会在此断掉，本项目已实现适配。
6. **取消语义**：`session/stop` 须以**请求**形式发送 → `turn.completed{resultType:"cancelled"}`；懒物化窗口内的早取消会被静默丢弃（已在 fork 修复）。
7. **断连安全**：客户端断开后后端不会失控执行（回合挂起等待鉴权头），重连后状态干净。
8. 已知坑：text_delta 存在重复（最终 response 权威）；Windows 反斜杠路径传 `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` 会致启动崩溃。

## 仓库结构

```
AGENTS.md            执行约束（环境保护/数据安全/门禁状态机）
TASKS.md             逐项任务与 Gate 绑定（Phase 0-4 全部执行）
docs/report-template.md   验收报告模板
probe/               探测工具（launcher/jsonl-reader/rpc-client/suite/finalize/
                     acp-e2e/zed-acceptance/v2-decrypt-test/redact）
contract/            离线协议契约门禁（L0 派生校验 + L1 36 用例 + L2 适配器契约）
reports/phase1..5/   逐阶段验收报告（审计/基线/MVP/契约矩阵/公开与验收）
traces/*.sanitized.json   脱敏协议证据（L1 原始证据，含统一元数据）
```

适配器代码在 fork 克隆 `../zcode-acp`（branch `phase3-contract`，基线 `ccc5104` + Windows/start-plan 提交），本仓库承载其证据链与验收。

## 运行

```bash
node --version                 # 需 ≥ 22（node:sqlite）

# 离线契约门禁（无需网络/账户/桌面登录态）
node contract/build-fixtures.mjs --check   # L0: 夹具派生完整性
node --test contract/trace-contract.test.mjs   # L1: 36 用例

# 实时探测（需本机 ZCode 桌面版已登录）
node probe/acp-e2e.mjs <adapter-dist>      # ACP 全链路：真实推理
node probe/suite.mjs                       # 八场景套件（含断连/强杀/恢复）
node probe/finalize.mjs                    # billing 取证 + 并存观察 + 脱敏导出
```

前置：本机安装 ZCode 桌面版并已登录（凭证 `~/.zcode/v2/credentials.json`）；探测为只读观察，不修改任何 ZCode 数据。

## Zed 接入

适配器构建（fork 克隆内）：`corepack pnpm install && corepack pnpm build`，然后在 Zed `settings.json`：

```json
{
  "agent_servers": {
    "ZCode": {
      "command": "node",
      "args": ["<fork 克隆路径>/dist/index.js"]
    }
  }
}
```

## 证据与报告

- [reports/gate-matrix.md](reports/gate-matrix.md) — Phase 0 门禁十项 + 证据引用
- [reports/phase1/](reports/phase1/baseline-decision.md) — 上游审计、基线锁定、Windows 改造边界
- [reports/phase2/windows-mvp.md](reports/phase2/windows-mvp.md) — Windows MVP 验收 + Zed 配置
- [reports/phase3/protocol-compatibility-matrix.md](reports/phase3/protocol-compatibility-matrix.md) — 协议兼容性矩阵（四级证据分级）
- [reports/phase4/production-candidate.md](reports/phase4/production-candidate.md) — 加固审计与就绪清单
- [reports/phase5/acceptance-report.md](reports/phase5/acceptance-report.md) — 公开化与验收报告（含 v2:os 阻塞与解法）
- [TASKS.md](TASKS.md) — 任务书（三轮评审冻结的 v4.1）+ 各阶段执行记录
- 原始 trace（`traces/raw/`）含凭据材料，**仅保留在本地、已 gitignore、不入库**（见 AGENTS.md G11）。

## License

Apache-2.0 — see [LICENSE](LICENSE). Evidence traces contain this machine's own protocol captures (paths, plan metadata); they are published as-is as research material.
