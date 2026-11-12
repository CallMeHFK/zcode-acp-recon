# 全仓库安全审计报告 — CallMeHFK 名下全部 28 个仓库

日期：2026-11-12 · 方法：GitHub API 全量枚举（含组织/协作/私有）→ 27 个含内容仓库全克隆 → 全历史（git rev-list --all）15 类凭据模式 + 敏感文件名扫描 → 25 处命中逐条分诊（掩码预览，不外显完整值）→ 扫描器自测（已知假密钥注入命中验证）

## 总评

**全部 28 个仓库：零真实凭据泄漏。** 25 处模式命中经逐条分诊均为良性（文档示例键 / 测试夹具 / CSS 类名巧合 / 环境变量名映射），无需轮换密钥或改写历史。

## 覆盖范围

| 类别 | 数量 | 扫描深度 |
|---|---|---|
| 公开原创仓库 | 15 | 全历史 15 类模式 + 敏感文件名 |
| 私有仓库 | 12 | 同上（低一档暴露面，仍全扫） |
| fork（上游镜像） | 1（zcode-acp，含 3 条贡献分支） | 分支级敏感形态扫描（0 命中，见 phase5/security-privacy-review.md） |
| **合计** | **28** | 扫描器自测 ✓（已知假密钥注入 → 全部命中验证有效） |

## 命中分诊明细（25 处，全部良性）

| 仓库 | 模式 | 命中数 | 定性 |
|---|---|---|---|
| agent-task-callback | sk-key ×5 | `sk-callback-qw…` 为项目自有插件命名（zip 文件名），非 OpenAI 形态密钥 | 良性 |
| quartz-trail-charm-royal | sk-key ×11 | `sk-image-linear` 等 Tailwind CSS 类名（.vercel 构建产物） | 良性 |
| dispatch-guard | aws-ak ×1 | `AKIAIOSFODNN7EXAMPLE` — AWS 官方文档标准示例键 | 良性 |
| notescientist（私有） | sk-key ×3 | `sk-abcdefghijk…` 明显占位符 + 断言"不得出现在输出中"的测试 | 良性 |
| priv-magpie-loomy-provider | assign ×2 | 测试夹具 token/secret（"someone…"、"0f1e…"） | 良性 |
| priv-agent-chatroom | assign ×1 | 测试 fixture（"unit…"） | 良性 |
| priv-CPUTracking | assign ×3 | Azure `DeviceCodeCredential(...)` 类实例化（代码非密钥） | 良性 |
| agent-shepherd | assign ×1 | **环境变量名映射表**（SHEPHERD_API_KEY 等），紧随 `SECRET_FIELDS` 定义——正确处理 | 良性 |
| qwenpaw-secret-input | assign + 文件名 ×4 | "secret-input 插件"的设计文档与测试（主题即安全输入） | 良性 |
| CallMeHFK.github.io / priv-site-kg / priv-ai-photo-restorer | 文件名 ×3 | 作品页引用 / .example.env 模板 | 良性 |

## 隐私暴露面（公开仓库部分）

| 数据 | 范围 | 等级 |
|---|---|---|
| GitHub 用户名/路径 | 全部 16 个公开仓库 | 低（公开身份固有） |
| ZCode 计划名/额度/plan_id | zcode-acp-recon 报告 | 低（自有订阅元数据，知情披露） |
| Windows 用户名路径 | zcode-acp-recon 9 个文件 | 低（已披露） |
| 主机名 / .mimosa 状态 / .mimosa instanceToken | **0**（未入库） | — |

## 已知限制

1. GitHub 代码搜索兜底仅覆盖默认分支 HEAD（fork 的非默认分支未入搜索索引——已由本地 fork 分支扫描覆盖 3 条，其余 fork 为上游镜像）
2. 二进制文件与大文件（>100MB）不在 git grep 文本扫描范围
3. `qwenpaw-secret-input` 等安全主题项目的高密度命中已逐条人工确认为设计文档/测试
