# P1 Phase D：Agent 命令契约开发计划

日期：2026-07-10 ｜ 分支：feat/p1-agent-contract ｜ 基线：8ffb197

## 目标

- 完成 P1 双契约的 Phase D：定稿 actor、partition、idempotency key、expected revision 与 changeset metadata 骨架。
- 将五个 Agent 写端点统一到服务端校验和幂等执行路径，MCP 只负责转发命令信封。
- 将 revision 冲突从一次性提示升级为可恢复状态，避免 autosave 循环报错或轮询覆盖本地草稿。
- 把 MCP 412 冲突改为稳定、可解析的结构化错误。

## 契约决策

### Actor 与认证

- `ActorKind` 固定为 `human | agent`，`ActorRef` 包含 `id`、`kind`、`label`。
- actor 只从服务端认证上下文派生，客户端请求体和 MCP 参数不得提交 `actor`、`author` 或 `pending`。
- Bearer token 使用 token ID 作为 actor ID，`actorKind` 来自签发信息，displayName 作为 label。
- 本地无认证和 owner API key 固定映射为 `local-owner/human`；旧 token 缺少 `actorKind` 时迁移为 `human`。

### 命令信封与分区

- HTTP 写命令使用 `X-CodeMind-Partition`、`Idempotency-Key` 和现有 `If-Match`。
- MCP 五个写工具将 `partition`、`idempotencyKey`、`expectedRevision` 设为必填，并转发为相同 HTTP header。
- `Partition` 固定为 `requirements | development | stable`。
- 本阶段验证分区声明并拒绝 `stable` 写入；现有 viewer/editor/owner 权限继续生效。
- 当前模型尚无实体级分区归属，因此不声称已实现节点级稳定区权限。

### 幂等语义

- 去重作用域为 `actorId + mapId + idempotencyKey`。
- 请求指纹包含 operation、target、partition、expectedRevision 与规范化 payload。
- 同 key、同指纹重放首次成功响应，不再次执行写入或递增 revision。
- 同 key、不同指纹返回 `409 idempotency_key_reused`。
- 并发相同请求只执行一次，其他请求等待并重放；幂等查询先于 revision 比较。
- 仅缓存成功响应；采用有界、带 TTL 的进程内缓存，进程重启后不保证重放历史。

### Changeset 骨架

- 定义 `ChangeSetMetadata`：`id`、`author`、`partition`、`idempotencyKey`、`baseRevision`、`resultRevision`、`createdAt`。
- 本阶段只定型类型，不持久化 pending/changeset，不实现 accept/reject、聚合窗口或评审 UI。

### 前端冲突恢复

- 412 后锁存独立 `revisionConflict`，保留当前文档和 `dirty=true`；普通 autosave 停止发请求。
- “重新加载服务端”经确认后加载最新文档、放弃本地草稿并清理冲突、dirty、history 和遗留 autosave。
- “用本地草稿覆盖”经确认后以服务端最新 revision 做条件保存，不使用 `If-Match: *`。
- 覆盖再次遇到 412 时继续保留草稿并刷新实际 revision。
- dirty 或冲突期间 polling 不得重载文档；异步响应不得覆盖切图后状态或请求期间产生的新编辑。

### MCP 结构化冲突

- 保持 MCP `isError: true` tool result 语义。
- 412 的 `content[0].text` 输出稳定 JSON，包含 `code=revision_conflict`、`httpStatus`、message、expectedRevision 和 actualRevision。
- 测试反序列化 JSON 并逐字段断言，不依赖错误字符串匹配。

## 实施拆分

1. 后端领域与认证：新增契约类型、token actorKind 兼容迁移、请求 actor 上下文。
2. 后端命令入口：新增分区/幂等 header 校验、并发单飞缓存和统一响应重放，接入五个 Agent 写端点。
3. MCP：扩充工具 schema、转发信封 header、结构化 REST 错误。
4. 前端：增加冲突状态、两个恢复命令和双 chrome 入口，补 polling/autosave 竞态守卫。
5. 验证与交付：定向和全量测试、lint/build、端口检查、1.14.0 桌面打包、总结与 commit。

## 测试门槛

- actor 必须来自 token，旧 token 默认 human，客户端不能伪造 actor。
- 五个 REST 写端点覆盖缺 header、非法 partition、stable 拒写和成功写入矩阵。
- 覆盖顺序重放、冲突前重放、同 key 不同 payload、并发单飞、失败不缓存和 revision 只增一次。
- MCP 覆盖 schema 必填项、header 转发、结构化 412。
- 前端覆盖 412 保留草稿、停止重复保存、reload、overwrite、二次 412、polling 守卫和切图竞态。
- `go test ./...`、`go vet ./...`、`cd frontend && npm test`、`npm run lint`、`npm run build`、`cd vscode-extension && npm run compile` 全部通过。

## 明确非目标与跟进

- Go 对畸形 sibling order 的读时自愈另开修复，不在本阶段改变严格格式校验策略。
- 非条件 `Save/Rename/Delete` 的 deprecated/删除、只读 GET 落盘行为、legacy order 坐标派生另行处理。
- stable 区文件系统物化时，必须在任何百分号解码前检查 `%2e%2e` 等路径穿越形式。
- Git 格式使用 `DisallowUnknownFields`；同一 schemaVersion 不支持新增可选字段。annotation、viewport 在 v1 未预留，引入时必须提升 `schemaVersion`。
- 冲突状态码文案统一为 412，不再使用“409/412”表述。
