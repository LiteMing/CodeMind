# P1 Phase B：节点代码绑定与显式顺序开发计划

日期：2026-07-10 ｜ 分支：feat/p1-node-code-order ｜ 目标版本：1.12.0 ｜ 上位计划：docs/archive/development/plan-p1-map-agent-contract.md

## 目标

- 为节点增加可持久化的 `bindings[]`，建立脑图节点与仓库文件、目录、glob、symbol、asset 的稳定语义锚点。
- 为所有有父级的节点增加显式 `order`，统一桌面端、REST、MCP 和 VS Code 的 sibling 顺序。
- 兼容缺少 bindings/order 的旧文档，并从坐标稳定迁移顺序，不改变现有 revision/If-Match 契约。
- 覆盖所有创建、更新、移动、删除、批量和 fragment 导入路径，避免产生重复或断裂的 sibling order。

## 契约决策

### Binding

- 每项包含 `id`、`type`、`path`，可选 `symbol`、`glob`、`contentHash`。
- `type` 限定为 `file | directory | glob | symbol | asset`。
- binding ID 在整张脑图内唯一，作为未来 Git diff、批注和 rename-follow 的稳定锚点。
- 路径统一使用 `/`；拒绝空路径、绝对路径、Windows 盘符、UNC 和任何 `..` 路径段。
- `symbol` 类型必须提供非空 symbol，其他类型不得提供 symbol；`glob` 类型同理。
- 本阶段只建立字段、验证和接口，不扫描仓库、不执行 rename-follow，也不增加绑定编辑 UI。

### Sibling Order

- 有父级节点使用从 `1` 开始、同一父级下唯一且连续的正整数 `order`。
- root 和无父级 floating 节点使用 `order = 0`，不参与层级 sibling 排序。
- 旧 sibling group 按 `position.y -> position.x -> id` 稳定推导 `1..N`。
- 已存在的有效正 order 优先于坐标；拖动节点不得改变语义顺序。
- 新建节点默认追加；显式指定 order 时插入并顺移；删除后压紧。
- 非级联删除时，被提升的直接子节点替换被删除节点的位置，并保持其内部相对顺序。

## 任务拆分

1. 数据模型：增加 BindingType、NodeBinding、Node.Bindings、Node.Order，以及权威路径规范化、验证和旧文档迁移。
2. 排序帮助函数：统一 ChildrenOf、full tree、compact tree 和导出顺序，提供插入、移动、删除后的重排能力。
3. REST：扩展 node create/update/delete、batch、import-fragment、node detail 和 compact 响应。
4. Agent 接口：扩展 MCP 工具 schema/payload；VS Code 类型兼容新字段。
5. 桌面前端：扩展 TypeScript 类型和文档归一化，维护新建、AI 新建、模板、复制粘贴及重挂路径的 order/binding ID。
6. 文档与发布：更新 API/平台文档，版本升至 1.12.0，完成验证、打包和阶段总结。

## 并行安排

- 数据模型与迁移完成后，REST/MCP 接线和前端兼容可并行推进。
- verifier 独立核对所有 parentId 变更旁路、顺序一致性与 binding 非法输入。
- 最终由主任务汇总全链路测试、版本和打包结果。

## 验收

- 旧 JSON 缺少 bindings/order 时可读取，同一 fixture 多次迁移得到相同 order。
- 坐标变化不改变已有 order；Go/前端 ChildrenOf、full/compact tree 返回相同顺序。
- JSON 往返不丢失 bindings/order。
- 非法 binding 类型、路径、重复 ID、错误 symbol/glob 组合被拒绝。
- create/update/move/delete、batch、import-fragment 和 MCP 均能写入并返回 bindings/order。
- 新建、插入、移动、级联/非级联删除后的 sibling order 连续且唯一。
- `go test ./...`
- `cd frontend && npm test`
- `cd frontend && npm run lint`
- `cd frontend && npm run build`
- `cd vscode-extension && npm run compile`
- 打包前检查端口，执行 `npm run build:desktop` 并校验 `CodeMind-1.12.0.exe`。

## 阶段边界

- `meta.version` 仍为 schema version 1；本阶段不拆分语义/布局文件。
- 不实现稳定区文件树、Git 状态高亮、仓库扫描、symbol 全仓索引或云端部署。
- 不实现自动冲突合并、CRDT、多人实时 UI 或 changeset 评审门。
