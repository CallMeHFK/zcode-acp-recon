# Phase 2 — Windows MVP 验收报告

日期：2026-11-09 · 分支：`phase2-windows` @ `e24e95e`（基线 `ccc5104` 之上的本地提交，未推送到任何远端——GitHub fork/PR 属 Phase 5/D2，需另行确认）

## 结论

**MVP 达成**：适配器在本机 Windows 上完成真实推理全链路 —— ACP 客户端（Zed 同款协议）→ 桥接器 → zcode app-server → 计划网关 → GLM-5.3-Flash，`stopReason=end_turn`，回复 "OK"，stdout 零污染。

## 四组修复（8 文件，+275/-15，单提交 e24e95e）

| # | 修复 | 文件 | 依据 |
|---|---|---|---|
| 1 | CLI/Node 发现：PATH+PATHEXT 扫描（无 which）、桥接器自身 exe + Program Files node 候选、桌面安装位补 `C:\Program Files\ZCode` | backend/resolve.ts | Phase 0 实测安装位 |
| 2 | 进程树收割 + 控制台闪烁：win32 走 `taskkill /T /F`（close + 崩溃看门狗），spawn 加 windowsHide | backend/jsonrpc-child.ts + platform/win32.ts（新） | 进程组为 POSIX 语义 |
| 3 | file URI 优雅降级：本平台不可本地寻址的 URI 保留原样，不再拒绝整个 prompt | handlers/prompt-content.ts | 1C 失败归类 C |
| 4 | **Start-plan 权益与鉴权**（核心）：① entitlement 权威改为账户实际 active 计划（一次 billing/current 查询，10min 缓存，不可达时上游启发式兜底）；② `codingPlanRequestAuthFor` 服务 `account:/builtin:<f>-start-plan`（共享登录 JWT，桌面宿主同款，2026-11-08 抓包+实推验证）；③ 请求无 providerId 时按 OAuth 族兜底供 JWT（CLI 0.17.1 实测请求不带 id） | config/account-provider.ts + handlers/server-requests.ts | Phase 0 桌面宿主日志 + billing 取证；上游 #123 captcha 结论被我们的证据推翻（其为旧版流程） |

上游测试预期平台化的配套修改：tests/resolve.test.ts、tests/prompt-content.test.ts（`localOrUri` 镜像生产语义）。

## 验证证据

| 项 | 结果 |
|---|---|
| build（tsc） | ✅ 无错误 |
| 上游 vitest（Windows） | 2332 pass / 108 fail（基线 2333±5 flake；**失败文件 29→26**；turn-state/resolve/prompt-content 目标类全消） |
| ACP e2e（probe/acp-e2e.mjs） | initialize(protocolVersion 1, authMethods=["ZCode built-in credentials"]) → session/new → prompt → **reply "OK", stopReason end_turn, 33.8s**；stdout nonJson=0 |
| 1113 根因链 | 修复前：1113（权益错配）→ 网络错误重试 ×6（头拒绝）→ 修复后：一次成功；每步有适配器日志佐证 |

## 过程记录（诚实项）

- Mimosa 安全钩子两次误报拦截（spawn 参数数组形态、正则 `.exec(`、bash 内源码路径列举）——均为对上游既有安全形态的误判，按其建议形式重写/改用 Edit 工具后通过，无绕过
- 上游对 start-plan 的"#123 captcha 需求"结论与我们的 2026-11-08 桌面宿主抓包及实推证据矛盾——以证据为准；该分歧应作为上游讨论点（连同 #363 根因）在 Phase 5 提 PR 时一并呈现

## 遗留与已知问题（带入 Phase 3/4）

1. `interaction/requestOfficialMcpAuthHeaders` 未处理（警告 ×N，MCP OAuth 失败但非致命）
2. `provider-registry: sync threw (Cannot read Desktop credential configuration)`（session.ts:380，best-effort 路径，不影响主链路——待定位）
3. text_delta 重复模式（Phase 0 已记；本轮 e2e 单 chunk，现象不稳定，Phase 3 L2 定规则）
4. 上游 vitest 其余 ~109 失败（Seatbelt N/A + skill-discovery home fixture 等）——Phase 3 逐类消
5. 账户计划窗口：验收成功的推理发生在周末包到期（09:00 本地）前 16 分钟；**后续 e2e 复跑需账户有可用计划**（外部依赖）

## Zed 接入配置（用户验收用）

```json
{
  "agent_servers": {
    "ZCode": {
      "command": "node",
      "args": ["C:\\Users\\Rt\\.zcode\\workspace\\zcode-acp\\dist\\index.js"]
    }
  }
}
```

要求：系统 Node ≥ 22（本机 v24.20.0 ✓）、桌面 App 登录态存在。把上面的 `agent_servers` 段加入 Zed `settings.json`，Agent 面板选 "ZCode" 即可对话。
