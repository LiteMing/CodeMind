# CodeMind Agent 契约文档审查总结

日期：2026-07-10 ｜ 分支：feat/p1-agent-contract

## 完成内容

- 重写 `.claude/skills/codemind/SKILL.md`，整理触发描述、在线检测、目标图确认、写入循环、幂等重试和二次确认清单。
- 修正 scoped editor/viewer token 无权 `list_maps` 的关键流程：已知 mapId 时先 `get_tree`；未知时向用户询问或读取签发结果，不能绕过权限。
- 将 requirements 的 Agent 行为规范与 stable 的服务端 403 强制边界分开表述。
- 明确当前 actor 只用于认证和幂等作用域，尚未持久化 author；partition 也尚未成为实体级归属。
- 删除“已进入 pending/changeset 评审流”等超前表述，任务完成改为在 note 中标记“待人工评审”。
- 重写 `docs/agent-protocol.md`，将规范源、可执行 Skill、机制层 API 文档的职责分开，并增加 Phase D 当前能力边界表。
- 重写人工验证清单，修正 token 字段 `accessLevel`、命令 header、错误码、MCP 412 路径和 Git semantic 单文件 diff 描述。
- 为 REST 基准写请求补充可执行 curl 模板，并明确 `If-Match` 必须保留字面双引号。
- 增加 actor 幂等作用域、DELETE query 指纹、失败不缓存、scoped list 限制、跨图慢保存等人工验收项。
- 明确 MCP 不负责自动重试；“最多 3 次”是外部 Agent 行为协议，并给出工具调用轨迹判定方法。

## 验证

- `skill-creator` 的 `quick_validate.py`：通过（`Skill is valid!`）。
- 独立前向测试：给定 scoped editor agent token 且未知 mapId 时，Agent 正确询问 mapId，没有调用 `list_maps` 或更换凭据绕过。
- 独立清单审计：发现并修正 Bearer 不能替代命令信封、C6 必须 REST 直测、MCP 冲突字段路径和重试观察方法。
- 对照 `internal/server/command.go`、`auth.go`、`tokens.go` 与 `internal/mcp/mcp.go` 复核字段、状态码和错误结构。
- 文档链接存在，`git diff --check` 通过。

## 保留边界

- scoped token 仍缺少“查询自身绑定 mapId”的 whoami/metadata 工具；当前必须由签发结果、项目配置或用户提供 mapId。
- requirements 尚未由服务端按 actor kind 强制只读；当前依赖 Agent 协议约束。
- author、pending、changeset、accept/reject、稳定区物化仍是后续阶段能力，文档已避免把它们写成当前功能。
