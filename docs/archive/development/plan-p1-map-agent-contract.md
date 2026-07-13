# P1 脑图文件与 Agent 双契约开发计划

日期：2026-07-10 ｜ 分支：feat/p1-map-agent-contract ｜ 基线：main@768f1bf

## 目标

- 定稿可演进、可迁移、适合 Git diff/merge 的脑图语义契约。
- 将语义层、布局层和仓库派生层明确分离，为稳定区程序化物化提供可靠边界。
- 为节点增加文件/目录/glob/符号/素材绑定原语，并预留 Git rename-follow 重绑能力。
- 建立真实 document revision 与 `If-Match` 乐观并发，统一桌面端、HTTP API 和 MCP 写入语义。
- 定稿 actor/分区/changeset 所需的最小 Agent 写入信封，但本分支不实现 CRDT 或多人实时 UI。

## 当前问题

- `meta.version` 在 `PrepareForSave` 中固定写回 `1`，实际是隐含 schema version，不能承担并发 revision。
- 节点没有代码绑定字段，稳定区、Git diff 高亮和路径批注都没有稳定锚点。
- 标题、注释、关系与坐标、折叠、尺寸混存在同一 JSON 中，布局噪音会污染 Git diff。
- HTTP/MCP 写路径没有 `If-Match`，现有 Load -> 修改 -> Save 也不是原子事务，并发写可能静默覆盖。
- 当前 JSON 使用数组自然顺序和坐标共同表达视觉顺序；拆分布局前必须补明确的语义 sibling order。

## 契约决策

### 1. 版本字段

- 保留 `meta.version` 作为 schema version，兼容现有文档，当前值仍为 `1`。
- 新增单调递增的 `meta.revision`，只在持久写成功时递增；只读打开不得变化。
- HTTP 读取返回 `ETag: "rev-{revision}"`，写入使用 `If-Match`。
- revision 比较与写盘必须在 FileStore 同一把锁内完成，禁止在 handler 中先读后比再单独保存。

### 2. 节点代码绑定

- `bindings[]` 为节点语义字段，每项包含稳定 ID、类型、仓库相对路径及可选 symbol/glob/contentHash。
- 绑定类型首批限定为 `file | directory | glob | symbol | asset`。
- 路径统一使用 `/`、禁止绝对路径和 `..` 越界；symbol 只作为按需下钻锚点，不做全仓库符号化。
- Git rename-follow 后续通过旧路径 + contentHash 辅助重绑，本分支先定字段和验证规则。

### 3. 三层分离

- 语义层：节点身份、父子关系、显式 sibling order、标题、注释、优先级、颜色、绑定、关系和批注，进入 Git。
- 布局层：节点位置/尺寸/折叠、关系 waypoint/midpoint、区域几何和视口偏好，可本地或服务端保存，不进入语义 diff。
- 派生层：由 repo/commit 生成的稳定区文件树和 Git 状态，只缓存、只读、不可手编、永不提交。
- 运行时 `MindMapDocument` 暂维持兼容；新增显式转换器和稳定序列化格式，迁移完成前不直接破坏旧 API payload。

### 4. Agent 写入信封

- 写操作统一携带 actor 身份（由 token 解析）、目标分区、幂等 key、expected revision。
- 服务端而非调用方决定 `author`、`pending` 和 changeset 归组，外置 Agent 不能自行声明权威身份。
- 本分支只定类型、校验和 HTTP/MCP 参数；accept/reject UI、changeset 聚合和分区权限执行另行实现。

## 实施阶段

### 阶段 A：Revision 与原子保存

- 为 Go/TypeScript 文档元数据增加 `revision`，兼容缺失字段的旧文件迁移。
- FileStore 增加原子条件更新接口和 revision conflict 错误。
- GET/PUT 及节点 create/update/delete、batch、import-fragment 接入 ETag/If-Match。
- 桌面端保存携带当前 revision；409/412 冲突必须保留本地草稿并提示，不得静默覆盖。
- MCP 写工具暴露 expected revision，并把冲突作为结构化错误返回。

### 阶段 B：代码绑定与 sibling order

- 增加跨 Go/TypeScript 的 binding 类型、路径规范化和验证。
- 为层级节点补显式 sibling order，提供旧文档从坐标稳定推导 order 的迁移。
- 扩展 node CRUD、batch、compact tree 和 MCP 参数/响应。
- 补 JSON 往返、非法路径、重复 binding ID、symbol 约束和旧文档迁移测试。

### 阶段 C：Git 语义格式

- 定义 `ProjectMapSemanticDocument` 与 `ProjectMapLayoutDocument`，实现 runtime 双向转换。
- 语义序列化固定 key/数组顺序，时间戳和纯布局变化不进入语义输出。
- 增加 CLI/内部 API 进行 semantic export/import，并提供 golden files 验证确定性。
- 对旧单文件文档提供无损迁移和回滚路径，不在首次读取时破坏原文件。

### 阶段 D：Agent 契约骨架

- 定义 actor、partition、idempotency key、expected revision 和 changeset metadata 类型。
- HTTP 与 MCP 使用同一服务层命令，不在 MCP 适配器复制业务规则。
- 增加权限/幂等/冲突的契约测试；服务端盖章的 pending/author 留待后续评审门实现。

## 独立工作流拆分

- 数据模型：revision、binding、order、语义/布局转换器。
- 存储与并发：FileStore 原子更新、迁移、确定性序列化。
- API/MCP：ETag/If-Match、结构化冲突、统一命令信封。
- 前端兼容：revision 传递、冲突提示、旧文档加载。
- 验证：Go 单测、Vitest 往返测试、golden files、API 集成测试。

各工作流先通过类型和测试夹具对齐，再并行修改；共享 schema 文件由数据模型工作流单点维护。

## 非目标

- 不在本分支实现 repo 文件树扫描、Git status/diff 高亮或稳定区 UI。
- 不实现 CRDT、OpLog、多人 Presence、连续光标或 Web Projection。
- 不实现完整 RBAC、changeset accept/reject UI 或云端数据库迁移。
- 不把派生文件树作为普通节点写入 Git。

## 验证与提交门槛

- `go test ./...`
- `cd frontend && npm test`
- `cd frontend && npm run lint`
- `cd frontend && npm run build`
- 旧版 fixture 可读取并迁移；新格式 JSON 往返无损。
- 同一语义文档重复导出字节完全一致。
- 两个相同 expected revision 的并发写最多一个成功，另一个返回明确冲突。
- 所有 HTTP/MCP 写路径均有 revision 契约测试，禁止遗漏旁路。

## 后续分支

本分支完成并合入后，从 main 创建 `feat/git-stable-zone`，实现 repo/commit 派生层、懒展开、Git 变更高亮和只读稳定区域。

## 执行状态（2026-07-10）

- 阶段 A：已完成，revision/ETag/If-Match 与原子条件写入落地。
- 阶段 B：已完成，代码绑定与显式 sibling order 落地。
- 阶段 C：已完成，确定性 Git semantic/layout 格式与 CLI 落地。
- 阶段 D：已完成，actor/partition/idempotency/changeset 类型骨架、MCP 结构化冲突和前端冲突恢复落地。
- P1 脑图文件与 Agent 双契约至此收口；稳定区物化和 changeset 评审门进入后续分支。
