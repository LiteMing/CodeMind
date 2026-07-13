# CodeMind Agent 契约文档审查计划

日期：2026-07-10 ｜ 分支：feat/p1-agent-contract ｜ 基线：fc6d226

## 目标

- 对 `.claude/skills/codemind/SKILL.md`、`docs/agent-protocol.md` 和 P1 人工验证清单进行契约级复核。
- 对齐 Phase D 已实现行为，删去会误导 Agent 或人工验收的超前表述。
- 整理中文语序、术语、标点和操作步骤，使文档可以直接照做。

## 重点检查

1. scoped Bearer token 的 map scope 与 `list_maps` 权限限制。
2. actor 派生、幂等作用域与尚未持久化的 author/changeset 边界。
3. requirements 行为规范与 stable 服务端强制只读的区别。
4. REST/MCP 的 revision、partition、idempotency header/参数和错误结构。
5. token REST 字段、手工 curl 示例和 Git semantic/layout 验收描述。
6. 当前能力与未来稳定区/评审门目标是否混写。

## 验收

- 三份文档互相引用但不循环定义权威来源。
- 所有示例字段和状态码与 `fc6d226` 实现一致。
- scoped agent token 在不知道 mapId 时的限制和处理方式明确。
- 不再声称当前已经持久化 author、pending、changeset 或实体级 partition。
- Markdown 格式检查通过，完成总结并提交文档变更。
