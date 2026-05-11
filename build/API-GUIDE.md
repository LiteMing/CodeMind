# Code Mind 协作 API 使用指南（面向 AI Agent）

## 概述

Code Mind 是一个本地优先的思维导图桌面应用，提供节点级 REST API 供第三方工具（AI Agent、IDE 插件、CLI）读写脑图数据。

**API 地址**：`http://127.0.0.1:34117/api`（桌面模式）

**数据存储**：`{exe所在目录}/data/maps/` 下的 JSON 文件，每个文件是一个独立的脑图文档。

---

## 认证

如果用户在设置中配置了 API Key，所有 `/api/maps/` 请求需要带上 header：

```
X-API-Key: {配置的key}
```

未配置 key 时无需认证。

---

## 核心概念

- **Map**：一个脑图文档，包含多个节点
- **Node**：脑图中的一个节点，有 id、parentId（父节点）、title、note、kind、priority、color、position
- **Root Node**：每个 map 有且仅有一个根节点（kind="root"），不可删除
- **Position**：节点在画布上的坐标 {x, y}，创建时可省略（自动计算）

---

## API 端点

### 列出所有地图

```
GET /api/maps
```

返回：`[{id, title, lastEditedAt, lastOpenedAt}, ...]`

### 获取地图所有节点（扁平数组）

```
GET /api/maps/{mapId}/nodes
```

### 获取地图树结构（嵌套 JSON，推荐 AI 用于理解上下文）

```
GET /api/maps/{mapId}/tree
```

返回嵌套结构：
```json
{
  "id": "root",
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
```

返回：
```json
{
  "node": {...},
  "ancestors": [...],  // 从直接父节点到 root
  "children": [...]    // 直接子节点
}
```

### 创建节点

```
POST /api/maps/{mapId}/nodes
Content-Type: application/json

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
```

- `cascade=true`（默认）：删除节点及所有后代
- `cascade=false`：仅删除该节点，子节点自动挂到上级
- 根节点不可删除

### 批量操作（原子性）

```
POST /api/maps/{mapId}/batch
Content-Type: application/json

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

返回：`{"lastEditedAt": "2026-...", "nodeCount": 15}`

写入前先读取，写入后对比，可检测是否有其他客户端同时修改。

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

---

## 配置管理

```
GET /api/settings          # 读取当前配置
PUT /api/settings          # 保存配置
Content-Type: application/json
{"collabApiKey": "your-32-char-hex-key"}
```
