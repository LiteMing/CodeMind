# P1 Phase A：Revision 与 If-Match 开发计划

日期：2026-07-10 ｜ 分支：feat/p1-map-agent-contract ｜ 版本：1.11.0 ｜ 上位计划：docs/plan-p1-map-agent-contract.md

## 目标

- 为脑图增加真实、单调递增的 `meta.revision`，与现有 schema `meta.version` 分工。
- 保证 revision 比较与写盘在 FileStore 同一临界区内完成，阻止并发写静默覆盖。
- 所有修改已有脑图的 REST 接口强制使用 `If-Match`，冲突返回 `412 Precondition Failed`。
- 桌面前端和 MCP 同步携带 expected revision，并将冲突明确呈现给用户或 Agent。

## 接口规则

- 新建脑图：不要求 `If-Match`，初始 revision 为 `1`。
- 读取脑图及其子资源：响应 `ETag: "rev-{revision}"`。
- 修改已有脑图：必须携带 `If-Match: "rev-{expectedRevision}"`。
- 缺少头：`428 Precondition Required`；格式错误：`400 Bad Request`。
- revision 不匹配：`412 Precondition Failed`，响应包含 expected/actual revision 和当前 ETag。
- 成功持久写：revision 恰好加一；只读打开和 `lastOpenedAt` 更新不增加 revision。

## 覆盖范围

- `PUT/PATCH/DELETE /api/maps/{mapId}`。
- 节点 create/update/delete。
- batch operations 和 import-fragment。
- map/tree/node/nodes/version/poll 的 revision/ETag 输出。
- 前端整图保存、重命名、删除和 AI 整图落库。
- VS Code 插件的树/节点读取、节点增删改和注释保存。
- MCP 五个写工具的 `expectedRevision` 必填参数及成功响应 revision。

## 实现步骤

1. 扩展 Go/TypeScript 文档元数据和旧文件读取兼容。
2. FileStore 新增 `SaveIfRevision`、`DeleteIfRevision` 与 revision conflict 类型。
3. 服务端增加 ETag 解析/写入和标准冲突响应。
4. 接入所有地图读写 handler，消除无条件写旁路。
5. 前端 API 自动生成 If-Match，冲突时保留 dirty 文档并显示专用状态。
6. MCP 工具要求 expectedRevision，写成功返回新 revision。
7. 增加 store 并发测试、API 契约测试、MCP schema/请求测试和前端冲突测试。

## 验证

- 两个相同 expected revision 的并发保存最多一个成功。
- 旧 JSON 缺少 revision 时按 revision `1` 读取，首次成功写后变为 `2`。
- 所有已有地图写接口缺少 If-Match 均被拒绝。
- 前端冲突后文档仍为 dirty，不自动加载服务端覆盖本地内容。
- `go test ./...`
- `cd frontend && npm test`
- `cd frontend && npm run lint`
- `cd frontend && npm run build`
- `cd vscode-extension && npm run compile`
- `npm run build:desktop`
