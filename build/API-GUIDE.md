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

## 核心概念

- **Map**：一个脑图文档，包含多个节点
- **Node**：脑图中的一个节点，有 id、parentId（父节点）、title、note、kind、priority、color、position
- **Root Node**：每个 map 有且仅有一个根节点（kind="root"），不可删除
- **Position**：节点在画布上的坐标 {x, y}，创建时可省略（自动计算）

### 字段有效值

| 字段 | 有效值 | 默认值 |
|------|--------|--------|
| kind | `root`、`topic`、`floating` | `topic` |
| priority | `""`、`P0`、`P1`、`P2`、`P3` | `""` |
| color | `""`、`slate`、`blue`、`teal`、`green`、`amber`、`rose`、`violet` | `""` |

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
      "title": "模块A",
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
  "title": "新节点标题",     // 必填
  "note": "详细说明",        // 可选
  "kind": "topic",          // 可选，默认 "topic"
  "priority": "P1",         // 可选：""、"P0"、"P1"、"P2"、"P3"
  "color": "blue"           // 可选
}
```

后端自动补全：id、position、createdAt、updatedAt。返回完整节点。

### 修改节点（部分更新）

```
PATCH /api/maps/{mapId}/nodes/{nodeId}
Content-Type: application/json
If-Match: "rev-7"

{
  "title": "新标题",    // 只传要改的字段
  "note": "新备注"
}
```

可更新字段：title、note、priority、color、collapsed。其他字段不可通过 PATCH 修改。

### 删除节点

```
DELETE /api/maps/{mapId}/nodes/{nodeId}
DELETE /api/maps/{mapId}/nodes/{nodeId}?cascade=false
If-Match: "rev-7"
```

- `cascade=true`（默认）：删除节点及所有后代
- `cascade=false`：仅删除该节点，子节点自动挂到上级
- 根节点不可删除

### 批量操作（原子性）

```
POST /api/maps/{mapId}/batch
Content-Type: application/json
If-Match: "rev-7"

{
  "operations": [
    {"action": "create", "payload": {"parentId": "root", "title": "节点1"}},
    {"action": "update", "nodeId": "node-xxx", "payload": {"title": "改名"}},
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
      "children": [
        {"title": "子模块1"},
        {"title": "子模块2", "children": [{"title": "细节"}]}
      ]
    }
  ]
}
```

- `parentId` 省略时默认挂到 root 下
- 递归创建整棵子树，自动补全所有字段
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
