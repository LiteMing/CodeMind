# CodeMind Platform Evolution 继续开发计划

## 目标

继续 `.kiro/specs/codemind-platform-evolution/tasks.md` 中未完成工作，优先补齐协作后端基础设施，使后续 CRDT、Presence、前端 WebSocket 与 Web Projection 能接入稳定的传输层。

## 当前状态

- 已完成：Token Store/Auth、Token REST API、MCP Server、VS Code Extension、Note Panel、Markdown Renderer 等主体实现。
- 未完成：协作后端、CRDT/OpLog、Presence、前端协作接入、Web Projection、相关属性测试。
- 观察：任务文件中 8.x/9.x/10.x 标记为 `~`，但当前工作区缺少 `internal/collab` 目录，需要从协作基础设施重新落地。
- 风险：当前 Git 工作区已有大量平台演进相关未提交改动，应避免无关改动与破坏已有实现。

## 本轮范围

1. 创建 `internal/collab` 协作后端基础结构。
2. 实现 WebSocket Server/Hub/Client/Auth/Heartbeat 的最小可运行版本。
3. 接入应用启动流程，协作服务启动失败时仅记录错误并降级为 HTTP-only。
4. 为 Hub 与认证关键路径补充基础测试或属性测试。
5. 更新任务状态、运行 Go 相关测试并提交。

## 技术方案

- 使用 `github.com/gorilla/websocket` 提供 WebSocket 升级与 ping/pong。
- `Hub` 按 `mapId` 管理房间，每房间最多 20 个客户端。
- 通过 TokenStore 校验 `?token=` 或首条认证消息，认证失败使用关闭码 `4001`，房间满使用 `4004`。
- viewer 发送写操作时返回权限错误并保持连接。
- 服务端定时 ping，超时未 pong 则断开并从房间移除。

## 验证计划

- 运行 `go test ./internal/collab ./internal/server ./internal/store`。
- 如公共 API 变更导致更大范围受影响，再运行 `go test ./...`。
