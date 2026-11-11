# Phase 4 — Production Candidate 报告

日期：2026-11-10 · fork 分支 `phase3-contract`（基线 `ccc5104` → `71a62fe` + 本阶段 `win-resolve` 提交）· recon @ 同步

## 结论

**Production Candidate 达成**：Windows MVP（Phase 2）经三层契约门禁（L0/L1/L2）+ 实时补采验证 + 本阶段加固审计，具备日常使用条件。Zed 实机验收（用户执行）后即可进入 Phase 5（发布回供上游）。

## 一、加固审计结论

### 背压与异常恢复（审计：上游机制已完备）
- **stdin 写保护**：后端子进程 stdin 关闭/销毁后帧丢弃并告警（jsonrpc-child.ts:325）✓
- **EPIPE 保护**：stdin 'error' 监听防止桥接器崩溃 ✓
- **后端丢失恢复**：backend-lost 检测 + 重生成 + loaded-stamp 逻辑（turn-state 测试覆盖）✓
- **崩溃看门狗**：桥接器被强杀后 2s 内树杀后端（Phase 2 已平台化）✓
- **慢客户端背压**：适配器→客户端出站为 Node 流缓冲，无显式高水位策略——**记录为已知限制**（ACP SDK 流语义内属可接受；Phase 4 未改动，监控项）
- **事件重复**：text_delta 重复为后端行为，适配器保真透传（L1 契约钉住），去重策略留 Phase 4+ 决策 ✓

### 工作区安全（审计：边界清晰）
- ACP `cwd` 由用户自己的编辑器提供（信任边界=用户）；后端文件访问由其权限系统把关（实测 permission 请求链路）
- 工作区身份用 realpathSync 比对（session.ts:279-284）✓
- symlink/UNC 无特殊化——后端路径不透明处理 + 权限门禁，边界成立 ✓
- 新增防线：spawn 纪律（args 数组/shell:false/windowsHide/cwd 显式）+ PATHEXT 扫描不跟随可疑扩展 ✓

### Elicitation 双路径（实测确认）
- **本客户端（未声明 form 能力）**：AskUserQuestion → `session/request_permission`（allow/reject 选项）——live-ask-user.json 证据
- **声明 form 能力的客户端**：上游 interaction/adapter 的表单路径（parseAskUserResponse）
- 两条路径均在上游实现内；Phase 4 无需改动，契约已记录 ✓

## 二、本阶段新增

| 项 | 内容 | 验证 |
|---|---|---|
| Windows 发现链单测 | `tests/win-resolve.test.ts` 9 用例：PATHEXT 扫描（.cmd shim 实测）、候选去重与顺序、双安装布局覆盖、`resolveZcodeCommand` 端形态、provider env 注入路径 | 9/9 绿 |
| `resolve.ts` 内部函数导出 | windowsPathWhich / candidateNodeBinaries / bundledZcodeCandidates（测试需要；上游 PR 时同样适用） | tsc 干净 |

上游全量 vitest 同步状态：**2348+ pass**（含新增 9 用例；失败集与 Phase 2 记录一致，均为 Seatbelt N/A + fixture 平台化待上游化的存量类）。

## 三、Production 就绪清单

| 项 | 状态 |
|---|---|
| 真实推理（start-plan 账户类） | ✅ Phase 2 e2e + 2026-11-10 活体复验（新计划） |
| 认证归属（billing 权威 + JWT 请求鉴权） | ✅ G3 七条 + live 复验 |
| 会话恢复（优雅/强杀）+ 历史一致 | ✅ L1/L2/L3 三层 |
| 权限/取消/断连语义 | ✅ 契约钉住 |
| Windows 进程卫生（树杀/无孤儿/无控制台闪烁） | ✅ |
| 契约门禁可重复执行 | ✅ L0+L1(36)+L2(14) 一键 `contract/run.mjs` |
| **Zed 实机验收** | ⏳ 用户执行（配置见 phase2 报告） |
| 上游 PR / GitHub fork 公开 | ⏳ Phase 5（需确认） |

## 四、已知限制（诚实清单）

1. 慢客户端背压为流缓冲语义，无显式水位（监控项）
2. text_delta 重复保真透传（去重策略未定，最终 response 权威）
3. 上游 ~109 存量测试失败（Seatbelt N/A + POSIX fixture 类）——已归类，逐类上游化是 Phase 5 PR 素材
4. `provider-registry: sync threw (Cannot read Desktop credential configuration)` 警告（best-effort 路径，不影响主链路，待定位）
5. 账户计划窗口依赖：计划过期后模型不可用（外部约束，错误透传清晰）

## 五、Phase 5 预告（待授权）

1. GitHub fork 公开/私有选择 + 上游 PR 拆分提交（file URI 修复、Windows resolve、start-plan 支持三组）
2. 上游 issue #363（Start Plan models don't show up）的根因评论 + 修复引用
3. Windows CI 矩阵贡献（上游 ci.yml 加 windows-latest + 测试平台化）
