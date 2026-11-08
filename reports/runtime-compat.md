# Runtime Compatibility Report（Phase 0A）

生成：2026-11-08 · 采集工具：tools/runtime-diagnostic.mjs · 原始数据：reports/runtime-compat.json

## 结论速览

| 项 | 结果 | 说明 |
|---|---|---|
| CLI 实测版本 | **0.17.1**（`node zcode.cjs --version` 实跑，exit 0） | ≥0.14.8 兼容区间、>0.16.0 → G1 版本风险解除。启动器内嵌 `version:"0.13.3"` 为启动器配置字段，非 CLI 版本 |
| 桌面 App | 3.17.2.9661 | `C:\Program Files\ZCode\ZCode.exe` VersionInfo |
| 原生二进制 | 不存在（zcode-agent.exe 无） | CLI 以 node + zcode.cjs（node-bundle 模式）运行 |
| 系统 Node | v24.20.0（`C:\Program Files\nodejs\node.exe`） | `node:sqlite` 模块可用（实跑 require 通过） |
| 捆绑 Node | 无 node.exe（resources/glm/node-runtime 仅含 npm） | spawn 运行时 = 系统 Node |
| zcode on PATH | 否 | launcher 必须走显式路径（ZCODE_BIN / Program Files 兜底） |
| node:sqlite 依赖 | **静态证据成立（直接依赖）** → G2 为硬门禁 | zcode.cjs 内 3 处 `require("node:sqlite")` + DatabaseSync + "tables.sqlite" + databaseKind 枚举含 "tasks-index"/"session" 迁移 |
| tasks-index.sqlite | 700,416 B，mtime 2026-11-08（桌面 App 活跃写入） | G7 观察基线 |

## 凭证链路结构（仅键名/类型，值未读取）

| 文件 | 存在 | 顶层结构 | 作用判定（待 0B 验证） |
|---|---|---|---|
| `~/.zcode/cli/config.json` | ✓ 1217B | `{plugins:object{2}, mcp:object{1}}` | CLI 配置（插件/MCP），**非** provider 凭证 |
| `~/.zcode/v2/credentials.json` | ✓ 7533B | 键名含 `oauth:bigmodel:access_token`、`zcodejwttoken`、`oauth:bigmodel:user_info`、`oauth:active_provider`、`mcp:oauth:*:discovery_state`、`bot:*:credential` | **OAuth(bigmodel) 登录态存储** = Coding Plan 认证来源候选 |
| `~/.zcode/v2/provider_config.json` | ✓ 231B | `{schemaVersion:number, config:object{3}}` | provider 注册 |
| `~/.zcode/v2/setting.json` | ✓ 2749B | 含 `enabledBuiltinAgentCliProviders:array(1)`、`providerFamilyDomain`、`webRemoteControlRelayV2Device` 等 | 桌面设置 |
| `~/.zcode/v2/config.json` | **缺失** | — | 上游 README 所述路径在本安装不存在（记录为版本差异） |

## 对门禁的影响

- **G1**：版本条件满足（0.17.1）。能力探测（0B-B2）仍需执行。
- **G2**：静态证据 → 硬门禁；0B 对实际 spawn 的 Node（= 系统 Node v24.20.0）复核 `node:sqlite`，预期 PASS。
- **G3**：认证来源指向 `v2/credentials.json` 的 `oauth:bigmodel:*`（值未读取）。0B 通过真实推理 + app-server 日志取证。
- **G7**：tasks-index.sqlite 由桌面 App 活跃写入 → 并存观察有必要（0C 只读对比）。
- **启动方式**：`<系统Node> C:\Program Files\ZCode\resources\glm\zcode.cjs app-server --stdio`（spawn 纪律：args 数组、shell:false、windowsHide、显式 cwd）。

## 备注

- `embeddedVersionStrings` 正则未命中（`version:"0.13.3"` 存在于源码但模式未匹配，疑为转义/格式差异）——以 `--version` 实跑结果为准，不影响结论。
- 未发现 PATH 上的 zcode；未发现第三方安装目录（%LOCALAPPDATA%\Programs 下无 ZCode）。
