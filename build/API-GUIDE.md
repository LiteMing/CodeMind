# Code Mind 协作 API 使用指南（面向 AI Agent）

## 概述

Code Mind 是一个本地优先的思维导图桌面应用，提供节点级 REST API 供第三方工具（AI Agent、IDE 插件、CLI）读写脑图数据。

**API 地址**：`http://127.0.0.1:34117/api`（桌面模式）

**数据存储**：应用数据目录的 `maps/` 下保存 JSON 文件；Windows 桌面端默认位于 `%APPDATA%\CodeMind\data\maps\`。

---

## 认证

如果用户在设置中配置了 API Key，所有 `/api/maps/` 请求需要带上 header：

```
X-API-Key: {配置的key}
```

未配置 key 时无需认证。

---

## Revision 与乐观并发

每张脑图都有单调递增的 `revision`。读取接口会在 JSON 中返回 revision，并设置：

```http
ETag: "rev-7"
```

除新建脑图外，所有地图写入必须携带当前 revision：

```http
If-Match: "rev-7"
```

- 写入成功后 revision 加一，响应 ETag 变为 `"rev-8"`。
- 缺少 `If-Match` 返回 `428 Precondition Required`。
- revision 已过期返回 `412 Precondition Failed`，并提供 `expectedRevision`、`actualRevision`。
- 收到 412 后应重新读取脑图并人工合并，不要自动覆盖服务端或丢弃本地内容。

---

## Git 语义格式

`codemind format` 可以把现有运行时脑图拆成两个职责明确的文件。这是离线 CLI 文件转换，不是 REST API 端点。

### 字段归属

| 文件 | 字段 | Git 建议 |
|------|------|----------|
| `semantic.json` | `mapId`；节点的 `id/parentId/kind/order/title/note/priority/color/bindings`；关系的端点、标签、箭头方向和 branches；区域的 `id/label/color` | 建议提交。内容采用稳定排序和固定 JSON 格式，布局、时间戳与 revision 变化不会污染语义 diff |
| `layout.json` | theme；节点位置、尺寸、折叠和时间戳；关系 midpoint、waypoints 和时间戳；区域几何和时间戳；runtime schema、revision、打开/编辑时间 | 建议作为本地 companion，不提交并加入 `.gitignore` |

顶层 map title 由 root node 的 title 派生，不会在 `semantic.json` 重复保存。两个文件都带 `format`、`schemaVersion` 和 `mapId`；导入时会校验格式版本与 ID。

推荐仓库结构：

```text
project-map/
  semantic.json    # 提交到 Git
  layout.json      # 本地保留
```

```gitignore
project-map/layout.json
```

### CLI 导出与导入

```powershell
# 导出：固定生成 semantic.json 和 layout.json
codemind format export `
  --input .\data\map.json `
  --out-dir .\project-map

# strict 导入：默认要求 semantic/layout 的 mapId 以及 node/relation/region ID 集合完全一致
codemind format import `
  --semantic .\project-map\semantic.json `
  --layout .\project-map\layout.json `
  --output .\data\restored-map.json

# reconcile：按 ID 复用仍存在的布局，忽略 layout 中的孤立项，并为新增实体生成默认布局
codemind format import `
  --semantic .\project-map\semantic.json `
  --layout .\project-map\layout.json `
  --output .\data\branch-map.json `
  --reconcile

# 不提供 layout 时自动使用 reconcile，生成可打开的默认布局
codemind format import `
  --semantic .\project-map\semantic.json `
  --output .\data\semantic-only-map.json
```

所有输出默认拒绝覆盖已有文件，避免误伤本地脑图或 companion。只有用户确认替换时才添加 `--force`；CLI 不允许输出覆盖输入，并先写入同目录临时文件再落盘。

### Git 工作流建议

1. 从运行时脑图导出到仓库目录。
2. 提交并评审 `semantic.json`，不把纯画布移动混入语义变更。
3. 切换 Git 分支后，用当前 `semantic.json` 和本地 `layout.json` 执行 `--reconcile`；若不需要旧布局，可省略 `--layout`。
4. 导入到一个新的运行时文件，检查无误后再由用户决定如何使用，不要依靠 `--force` 自动覆盖工作副本。

本阶段不改变 FileStore 主存储，不提供 REST/MCP 格式端点、桌面导出按钮、Git status/diff 高亮、自动 commit、三方 merge、CRDT、仓库扫描或云端托管。

---

## 核心概念

- **Map**：一个脑图文档，包含多个节点
- **Node**：脑图中的一个节点，有 id、parentId（父节点）、order（同级语义顺序）、bindings（代码绑定）、title、note、kind、priority、color、position
- **Root Node**：每个 map 有且仅有一个根节点（kind="root"），不可删除
- **Position**：节点在画布上的坐标 {x, y}，创建时可省略（自动计算）
- **Binding**：节点到仓库文件、目录、glob、symbol 或 asset 的稳定语义锚点

### 字段有效值

| 字段 | 有效值 | 默认值 |
|------|--------|--------|
| kind | `root`、`topic`、`floating` | `topic` |
| priority | `""`、`P0`、`P1`、`P2`、`P3` | `""` |
| color | `""`、`slate`、`blue`、`teal`、`green`、`amber`、`rose`、`violet` | `""` |
| binding.type | `file`、`directory`、`glob`、`symbol`、`asset` | 无 |

### Order 与代码绑定

- 有父级的节点使用从 `1` 开始、同一父级内连续且唯一的 `order`；root 和无父级 floating 节点为 `0`。
- 创建时省略 `order` 会追加到同级末尾；指定 order 会插入该位置并顺移后续节点。
- PATCH 可用 `parentId` 与 `order` 移动节点；旧父级和新父级的 order 都会自动压紧。
- 画布坐标只负责布局，拖动节点不会改变 order；树、compact 响应和 Agent 应以 order 为准。
- `bindings` 每项必须包含全图唯一的 `id`、`type` 和仓库相对 `path`。路径统一为 `/`，拒绝绝对路径、盘符、UNC 和 `..`。
- `symbol` 类型必须提供 `symbol`，`glob` 类型必须提供 `glob`；其他类型不得携带这两个专属字段。
- 可选 `contentHash` 仅作为未来 rename-follow 的锚点，本阶段不会扫描仓库或自动跟踪重命名。

### 实时刷新行为

当 AI 通过 API 修改脑图后，前端会在 2 秒内自动检测变更并刷新画布：
- 新增节点有淡入+缩放动画
- 顶部显示"🤖 AI 已更新脑图"toast 提示
- 用户无需手动刷新或重新打开文件

---

## API 端点

### 列出所有地图

```
GET /api/maps
```

返回：`[{id, title, revision, lastEditedAt, lastOpenedAt}, ...]`

### 获取地图所有节点（扁平数组）

```
GET /api/maps/{mapId}/nodes
GET /api/maps/{mapId}/nodes?compact=true   ← 省略 position/timestamps
```

### 获取地图树结构（嵌套 JSON，推荐 AI 用于理解上下文）

```
GET /api/maps/{mapId}/tree
GET /api/maps/{mapId}/tree?compact=true   ← 推荐，省略 position/timestamps，节省 ~43% token
```

返回嵌套结构：
```json
{
  "id": "root",
  "revision": 7,
  "title": "项目名",
  "kind": "root",
  "children": [
    {
      "id": "node-xxx",
      "order": 1,
      "title": "模块A",
      "bindings": [
        {"id": "binding-module-a", "type": "directory", "path": "internal/module-a"}
      ],
      "children": [...]
    }
  ]
}
```

### 获取单个节点详情（含祖先链和子节点）

```
GET /api/maps/{mapId}/nodes/{nodeId}
GET /api/maps/{mapId}/nodes/{nodeId}?compact=true   ← 省略 position/timestamps
```

返回：
```json
{
  "revision": 7,
  "node": {...},
  "ancestors": [...],  // 从直接父节点到 root
  "children": [...]    // 直接子节点
}
```

### 创建节点

```
POST /api/maps/{mapId}/nodes
Content-Type: application/json
If-Match: "rev-7"

{
  "parentId": "root",       // 必填：挂载到哪个父节点下
  "order": 2,                // 可选：1-based 同级插入位置；省略则追加
  "title": "新节点标题",     // 必填
  "note": "详细说明",        // 可选
  "kind": "topic",          // 可选，默认 "topic"
  "priority": "P1",         // 可选：""、"P0"、"P1"、"P2"、"P3"
  "color": "blue",          // 可选
  "bindings": [              // 可选：仓库语义绑定
    {
      "id": "binding-auth-handler",
      "type": "symbol",
      "path": "internal/auth/handler.go",
      "symbol": "LoginHandler"
    }
  ]
}
```

后端自动补全：id、未指定的 order、position、createdAt、updatedAt。返回完整节点。

### 修改节点（部分更新）

```
PATCH /api/maps/{mapId}/nodes/{nodeId}
Content-Type: application/json
If-Match: "rev-7"

{
  "parentId": "node-platform", // 可选：移动到新父节点
  "order": 1,                    // 可选：在目标同级中的位置
  "title": "新标题",             // 只传要改的字段
  "note": "新备注",
  "bindings": []                 // 传 [] 清空；非空数组整组替换
}
```

可更新字段：parentId、order、title、note、priority、color、bindings、collapsed。`bindings` 是整组替换语义，不是增量合并。

### 删除节点

```
DELETE /api/maps/{mapId}/nodes/{nodeId}
DELETE /api/maps/{mapId}/nodes/{nodeId}?cascade=false
If-Match: "rev-7"
```

- `cascade=true`（默认）：删除节点及所有后代
- `cascade=false`：仅删除该节点，子节点自动挂到上级并替换其原顺序位置
- 删除后同级 order 自动压紧为连续整数
- 根节点不可删除

### 批量操作（原子性）

```
POST /api/maps/{mapId}/batch
Content-Type: application/json
If-Match: "rev-7"

{
  "operations": [
    {"action": "create", "payload": {"parentId": "root", "order": 1, "title": "节点1", "bindings": []}},
    {"action": "update", "nodeId": "node-xxx", "payload": {"parentId": "node-yyy", "order": 2, "title": "改名"}},
    {"action": "delete", "nodeId": "node-yyy", "payload": {"cascade": true}}
  ]
}
```

全部成功才保存，任何一个失败则全部回滚。

### 导入 JSON 片段（支持嵌套子树）

```
POST /api/maps/{mapId}/import-fragment
Content-Type: application/json
If-Match: "rev-7"

{
  "nodes": [
    {
      "title": "模块A",
      "note": "说明",
      "order": 1,
      "bindings": [
        {"id": "binding-module-a", "type": "directory", "path": "internal/module-a"}
      ],
      "children": [
        {"title": "子模块1", "order": 1},
        {"title": "子模块2", "order": 2, "children": [{"title": "细节"}]}
      ]
    }
  ]
}
```

- `parentId` 省略时默认挂到 root 下
- 每个 fragment 节点均可携带 `order` 和 `bindings`
- 递归创建整棵子树，自动补全未指定字段并维护连续 order
- 返回所有创建的节点（扁平数组）

### 版本检测（冲突检查）

```
GET /api/maps/{mapId}/version
```

返回：`{"revision": 7, "lastEditedAt": "2026-...", "nodeCount": 15}`

写入时把该 revision 放入 `If-Match`；服务端会原子比较并拒绝陈旧写入。

### 变更轮询（前端实时刷新用）

```
GET /api/maps/{mapId}/poll?since=2026-05-11T12:00:00Z
```

返回：
```json
{
  "revision": 7,
  "lastEditedAt": "2026-05-11T12:52:02Z",
  "nodeCount": 32,
  "modifiedViaAPI": true
}
```

- `since` 参数为 ISO 时间戳，表示"自从这个时间之后是否有 API 写入"
- `modifiedViaAPI` 为 true 表示有外部 API 修改（非前端自身保存）
- 前端每 2 秒调用一次，检测到变更后自动重新加载文档

---

## 典型 AI 工作流

### 1. 读取项目上下文

```
GET /api/maps/{mapId}/tree
```

将返回的 JSON 树作为 system prompt 的一部分，让 AI 理解项目结构。

### 2. AI 开发完成后写入总结

```
POST /api/maps/{mapId}/nodes
If-Match: "rev-7"
{
  "parentId": "对应模块的nodeId",
  "title": "2026-05-11: 完成用户认证模块",
  "note": "## 变更内容\n- 新增 JWT 中间件\n- 添加登录/注册接口\n..."
}
```

### 3. 批量创建任务拆解

```
POST /api/maps/{mapId}/import-fragment
{
  "nodes": [
    {
      "title": "用户系统",
      "parentId": "需求模块的nodeId",
      "children": [
        {"title": "登录接口"},
        {"title": "注册接口"},
        {"title": "权限校验"}
      ]
    }
  ]
}
```

---

## 错误处理

所有错误返回 JSON：
```json
{"error": "描述性错误信息"}
```

| 状态码 | 含义 |
|--------|------|
| 400 | 请求参数错误（缺字段、无效值、parentId 不存在） |
| 401 | API Key 认证失败 |
| 404 | Map 或 Node 不存在 |
| 405 | HTTP 方法不允许 |
| 412 | revision 冲突，写入被拒绝 |
| 428 | 缺少 If-Match |

---

## 配置管理

```
GET /api/settings          # 读取当前配置
PUT /api/settings          # 保存配置
Content-Type: application/json
{"collabApiKey": "your-32-char-hex-key"}
```

---

## 跨脑图操作

AI Agent 可以在一次会话中操作多个脑图，只需使用不同的 `mapId`：

```bash
# 读取架构图
GET /api/maps/map-architecture-001/tree

# 读取策划图
GET /api/maps/map-planning-001/tree

# 在策划图中创建任务
POST /api/maps/map-planning-001/nodes
{"parentId": "root", "title": "新任务"}

# 在架构图中标记变更
PATCH /api/maps/map-architecture-001/nodes/node-xxx
{"note": "- [2026-05-11: 新增用户模块](link:map-planning-001/node-task-id)"}
```

### 跨图链接约定

在 note 字段中使用格式 `[link:mapId/nodeId]` 表示跨图引用：
```
- [2026-05-11: 完成登录功能](link:map-planning-001/node-summary-123)
```

---

## 注意事项

1. **前端保存后 API 立即可读**：用户在 UI 中 Ctrl+S 保存后，API 调用能立即获取最新数据
2. **API 写入后前端自动刷新**：无需通知用户手动刷新
3. **根节点不可删除**：每个 map 必须有且仅有一个 root 节点
4. **position 自动计算**：创建节点时无需指定坐标，后端会自动放置在合适位置
5. **批量操作原子性**：batch 中任何一个操作失败，整个请求回滚，文档不变
6. **推荐使用 compact 模式**：AI 读取时加 `?compact=true`，省略 position/createdAt/updatedAt 和默认 kind，节省约 43% 响应体积
