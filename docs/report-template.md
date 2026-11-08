# Gate Matrix 验收报告模板

> 复制本模板为 `reports/gate-matrix.md` 并逐项填写。每条结论必须附证据引用（文件 + 位置）。证据来源不可确认 → `UNVERIFIED`，禁止默认 `PASS`。

## 元信息

```json
{
  "reportGeneratedAt": "",
  "machine": { "os": "windows", "osVersion": "", "arch": "x64" },
  "zcode": { "desktopVersion": "", "cliLauncherVersion": "", "cliRuntimeVersion": "", "cliPath": "" },
  "runtimes": { "bridgeNode": "", "spawnNode": "", "electronNode": "" },
  "probeVersion": ""
}
```

## Gate Matrix

| Gate | 优先级 | 状态(PASS/FAIL/UNVERIFIED/N/A) | 验证内容概述 | 证据引用 |
|---|---|---|---|---|
| G1 CLI 版本及能力 | P0 | | 能力探测四类判定 | |
| G2 运行时一致性 | P0 | | 实际 spawn Node；node:sqlite 依赖证据 | |
| G3 Coding Plan 真实认证 | P0 | | 七条逐项 + 证据来源 | |
| G4 事件流与 seq 语义 | P0 | | seq 作用域 + 连续性 | |
| G5 双向 Permission RPC | P0 | | 请求/响应精确 JSON | |
| G6 Resume 历史一致性 | P0 | | 三种退出方式分别记录 | |
| G7 桌面数据隔离 | P0 | | 只读指标 + 并存矩阵 | |
| G8 权限安全与取消语义 | P0 | | 四层断连观察 | |
| G9 stdout 纪律 | P1 | | 非 JSON 行统计 | |
| G10 spawn 纪律 | P1 | | args 数组/shell:false/windowsHide/cwd | |
| G11 数据安全与可重复性 | P0 | | security 块 | |

**规则**：任一 P0 项 FAIL 或 UNVERIFIED → 不进入 Phase 1；P1 项记录待修复，进 Phase 2 前解决。

## 分门禁详录（每 Gate 一节）

### Gx <名称>
- 状态：
- 方法：
- 证据：
  - <trace 文件> @ <行号/事件指针> — <说明>
- 反例/异常：
- 备注（含版本相关性、可重复性观察）：

### G3 认证归属七条（专用表）

| 条目 | 结果 | 证据来源(app-server 日志/配置/账户页面/使用记录) | 引用 |
|---|---|---|---|
| A 无独立 API Key 配置 | | | |
| B 使用现有桌面登录态 | | | |
| C app-server 真实推理成功 | | | |
| D 确认实际 Provider | | | |
| E 确认预期 Coding Plan 账户 | | | |
| F 额度/使用证据 | | | |
| G 推理后桌面 App 正常 | | | |

### G6 三种退出方式（专用表）

| 退出方式 | Resume 可用 | 历史一致 | 工具调用/结果完整 | 无重复 | 顺序保持 | 可继续对话 | seq 衔接 | 引用 |
|---|---|---|---|---|---|---|---|---|
| ① 正常退出 | | | | | | | | |
| ② 强制终止 (taskkill /T /F) | | | | | | | | |
| ③ 桌面 App 退出 | | | | | | | | |

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

> `sensitiveDataDetected:false` 必须来自扫描结果；`scanErrors` 非空或 `scanCoverage` < 1 时，G11 不得为 PASS。

## Trace 清单

| 文件 | scenario | 元数据完整 | 最低验收达成 | 引用 |
|---|---|---|---|---|
| traces/normal.sanitized.jsonl | normal | | 完整收到 Turn 结束事件 | |
| traces/permission-allow.sanitized.jsonl | permission_allow | | 记录双向请求及响应 | |
| traces/permission-deny.sanitized.jsonl | permission_deny | | 记录拒绝后真实后端行为 | |
| traces/cancel.sanitized.jsonl | cancel | | 记录取消前后完整事件 | |
| traces/crash.sanitized.jsonl | crash | | 记录异常退出与恢复行为 | |
| traces/resume-*.sanitized.jsonl | resume | | 历史一致并可继续对话 | |

## 结论

- **Go / No-Go**：
- 依据（P0 门禁状态汇总）：
- 遗留风险：
- P1 待修复清单：
