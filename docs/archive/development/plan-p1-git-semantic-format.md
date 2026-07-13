# P1 Phase C：Git 语义格式开发计划

日期：2026-07-10 ｜ 分支：feat/p1-git-semantic-format ｜ 目标版本：1.13.0 ｜ 上位计划：docs/archive/development/plan-p1-map-agent-contract.md

## 目标

- 定义 `ProjectMapSemanticDocument` 与 `ProjectMapLayoutDocument`，实现与运行时 `MindMapDocument` 的双向转换。
- 生成字节级确定的 `semantic.json`，使纯布局、时间戳和 revision 变化不污染 Git diff。
- 使用 `layout.json` 保存布局和本地运行状态，支持旧单文件文档的严格还原与跨 Git 版本布局 reconcile。
- 提供 `codemind format export/import` CLI，显式读写路径、默认拒绝覆盖，绝不原地修改旧文件。
- 使用 golden fixtures 验证字段归属、稳定排序、换行格式、严格回滚和 reconcile。

## 文件契约

### semantic.json

- `format = codemind.project-map.semantic`，`schemaVersion = 1`，并包含 `mapId`。
- 节点包含 id、parentId、kind、order、title、note、priority、color、bindings。
- 关系包含 id、sourceId、targetId、label、arrowDirection、branches。
- 区域只包含 id、label、color；区域几何进入 layout。
- 不包含 runtime schema/revision、任何时间戳、theme、position/size/collapsed 或关系 routing。
- map title 由 root node title 唯一派生，不在顶层重复保存。

### layout.json

- `format = codemind.project-map.layout`，`schemaVersion = 1`，mapId 必须与 semantic 一致。
- 保存 theme、节点位置/尺寸/折叠、关系 midpoint/waypoints、区域几何。
- 保存节点/关系/区域时间戳及 runtime meta，以保证双文件可以还原旧单文件状态。
- layout 是本地 companion，不属于 Git 语义文件；文档明确建议忽略提交。

## 稳定序列化

- Go struct 固定 key 顺序，2 空格缩进、UTF-8、LF、文件末尾单换行、关闭 HTML escaping。
- nodes 为 root 优先、其余按 ID；relations/regions 按 ID；bindings 按 binding ID；branches 按 targetId。
- 空集合统一输出 `[]`；空 arrowDirection 规范为 `none`。
- 转换器先深拷贝并验证，不得修改调用方 document。
- 不重写用户正文、Unicode 或正文换行。

## Merge 模式

- strict：semantic/layout 的 mapId 与 node/relation/region ID 集合必须完全匹配，用于 golden 和旧文件回滚。
- reconcile：按 ID 套用仍存在的布局，忽略 layout orphan；新增实体使用确定性默认布局和注入时钟。
- semantic-only import 使用 reconcile，可生成可打开的默认布局。
- 不使用 semantic hash 硬绑定 layout，允许 Git 切分支后本地 layout 滞后。

## CLI

- `codemind format export --input <runtime.json> --out-dir <dir> [--force]`
- 输出 `<dir>/semantic.json` 与 `<dir>/layout.json`。
- `codemind format import --semantic <semantic.json> [--layout <layout.json>] --output <runtime.json> [--reconcile] [--force]`
- 默认拒绝覆盖；所有输出先预检再原子落盘；输入文件永不修改。

## 任务拆分

1. 契约类型：新增 semantic/layout struct、format/schema 常量和 validation。
2. 转换器：runtime split、strict/reconcile merge、默认布局和无副作用深拷贝。
3. 稳定序列化：canonical sort、marshal/parse、空数组与 LF 约束。
4. CLI：format 子命令、参数校验、覆盖保护、原子输出和帮助文案。
5. Golden：完整 fixture、旧 fixture、字节稳定、布局隔离、shuffle、strict/reconcile 与错误契约测试。
6. 文档与发布：README/API guide/平台文档、版本 1.13.0、全量验证与打包。

## 并行安排

- 共享格式类型由主任务单点维护。
- 类型确定后，CLI/文档与 golden/verifier 可并行推进。
- verifier 独立检查 semantic 是否意外包含 layout/revision/timestamps，以及导出是否修改原文档。

## 验收

- runtime -> semantic/layout -> strict runtime 保留所有运行时内容，仅允许数组规范排序和空值规范化。
- 随机打乱 runtime 数组、bindings 和 branches 后，semantic bytes 完全一致。
- 仅修改 theme、布局、routing、时间戳或 revision，semantic bytes 完全一致。
- 修改任一语义字段，semantic bytes 发生变化。
- reconcile 正确处理新增/删除 ID，semantic-only import 生成确定性默认布局。
- unsupported format/schema、mapId mismatch、duplicate ID 和 strict 集合不一致均被拒绝。
- CLI 默认不覆盖，`--force` 可显式覆盖，输入文件哈希不变。
- `go test ./...`
- `cd frontend && npm test && npm run lint && npm run build`
- `cd vscode-extension && npm run compile`
- 打包前检查端口，执行 `npm run build:desktop` 并校验 `CodeMind-1.13.0.exe`。

## 非目标

- 不把 FileStore 主存储迁移为双文件，不在首次读取时改写旧文件。
- 不接入 REST/MCP/前端导出 UI，不实现稳定区文件树、Git status/diff 高亮或自动提交。
- 不做三方 merge、CRDT、rename-follow、repo 扫描或云端数据库。
