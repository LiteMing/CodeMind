# 需求文档：思维导图 AI 协作策划工具

## 简介

将现有 Code Mind 思维导图应用转型为项目 AI 协作策划工具。核心思路：Code Mind 提供开放的节点级 REST API，让第三方工具（IDE 插件、CLI、AI Agent）通过 JSON 片段来操作脑图数据。软件本身保持轻量，专注可视化与交互，作为"被调用方"提供数据读写能力。

本次 MVP 聚焦于 API 层的基础建设（节点 CRUD + 认证 + JSON 片段补全），为后续的协作节点系统、事件触发、架构变更追踪等功能奠定基础。

## 术语表

- **Code_Mind**: 本项目的思维导图桌面应用（Wails v2 + TypeScript 前端）
- **JSON_Fragment**: 第三方提交的部分节点 JSON 数据，后端自动补全 id、position、timestamps 后合并到目标地图
- **API_Consumer**: 通过 REST API 与 Code_Mind 交互的第三方工具（IDE 插件、CLI、AI Agent 等）

## 需求

### 需求 1：节点级 CRUD API

**用户故事：** 作为第三方工具（IDE 插件、CLI、AI Agent），我希望通过轻量的 REST API 对单个节点进行增删改查，以便无需传输整个文档即可操作脑图。

#### 验收标准

1. THE Code_Mind SHALL expose `GET /api/maps/{mapId}/nodes` that returns all nodes of the specified map, each including id, parentId, title, note, kind, priority, color, position, createdAt, and updatedAt
2. THE Code_Mind SHALL expose `GET /api/maps/{mapId}/nodes/{nodeId}` that returns the specified node together with all ancestor nodes up to the root and all direct child nodes
3. THE Code_Mind SHALL expose `POST /api/maps/{mapId}/nodes` that creates a new node, requiring at minimum parentId and title, optionally accepting note, kind, priority, and color; the backend SHALL auto-generate id, position (placed below the last sibling of the specified parent), createdAt, and updatedAt
4. THE Code_Mind SHALL expose `PATCH /api/maps/{mapId}/nodes/{nodeId}` that allows partial update of any node field (title, note, priority, color, collapsed), applying only the fields present in the request body
5. THE Code_Mind SHALL expose `DELETE /api/maps/{mapId}/nodes/{nodeId}` that removes the specified node; the API SHALL accept a query parameter `cascade=true` (default) to delete all descendants, or `cascade=false` to re-parent children to the deleted node's parent
6. THE Code_Mind SHALL expose `GET /api/maps/{mapId}/tree` that returns all nodes as a nested JSON tree structure preserving the parent-child hierarchy
7. THE Code_Mind SHALL expose `POST /api/maps/{mapId}/batch` that accepts an array of operations (each with action: "create" | "update" | "delete" and corresponding payload), executing them atomically — either all succeed or none are applied
8. WHEN a node is created via API without specifying position, THE Code_Mind SHALL auto-calculate position based on the parent node's existing children positions, placing the new node below the last sibling with the standard vertical gap
9. IF any API request references a non-existent map or node, THEN THE Code_Mind SHALL return HTTP 404 with a JSON body containing an error field describing which resource was not found
10. IF a create or update request contains an invalid kind value or is missing a required field, THEN THE Code_Mind SHALL return HTTP 400 with a JSON body describing the validation failure
11. THE Code_Mind SHALL NOT allow deletion of the root node; IF a delete request targets the root node, THEN THE Code_Mind SHALL return HTTP 400 with an error indicating the root node cannot be deleted

### 需求 2：API Key 认证

**用户故事：** 作为 Code Mind 用户，我希望 API 访问受到认证保护，以防止未授权的第三方修改我的脑图数据。

#### 验收标准

1. THE Code_Mind SHALL support configuring an API key in application settings (settings panel and preferences JSON file), stored as a string field `collabApiKey`
2. WHEN `collabApiKey` is configured (non-empty), THE Code_Mind SHALL require all `/api/maps/` endpoints (except `GET /api/health`) to include an `X-API-Key` request header whose value matches the configured key
3. IF the API key is not configured (empty string), THEN THE Code_Mind SHALL allow all requests without authentication (backward compatible with current behavior)
4. IF a request is missing the `X-API-Key` header or provides an invalid key when authentication is enabled, THEN THE Code_Mind SHALL return HTTP 401 with a JSON body containing an error field indicating authentication failure
5. THE Code_Mind SHALL expose `GET /api/maps/{mapId}/version` that returns the map's current lastEditedAt timestamp and document node count, allowing third-party tools to detect whether the map has changed since their last read
6. THE Code_Mind SHALL support generating a new random API key (32-character hex string) from the settings panel with a single click, replacing any previously configured key

### 需求 3：JSON 片段输入与自动补全

**用户故事：** 作为第三方工具，我希望只提交部分节点 JSON（不需要完整 Document 结构），后端自动补全缺失字段并合并到目标位置，以便最小化集成复杂度。

#### 验收标准

1. WHEN a `POST /api/maps/{mapId}/nodes` request omits the `id` field, THE Code_Mind SHALL auto-generate a unique node ID using the existing NewID("node") pattern
2. WHEN a `POST /api/maps/{mapId}/nodes` request omits `kind`, THE Code_Mind SHALL default to "topic"
3. WHEN a `POST /api/maps/{mapId}/nodes` request omits `position`, THE Code_Mind SHALL calculate position automatically based on the parent's existing children (placing the new node below the last child with the standard vertical gap of 96px, at the standard horizontal offset of 280px from the parent)
4. WHEN a `POST /api/maps/{mapId}/nodes` request omits `createdAt` or `updatedAt`, THE Code_Mind SHALL set them to the current UTC time
5. THE Code_Mind SHALL expose `POST /api/maps/{mapId}/import-fragment` that accepts a JSON array of partial node objects (each requiring only `title`, optionally including `parentId`, `note`, `priority`, `color`), auto-completes all missing fields, and inserts them as a subtree under the specified parent (defaulting to root if parentId is omitted or empty)
6. WHEN `import-fragment` receives nodes with nested `children` arrays, THE Code_Mind SHALL recursively create the subtree preserving the parent-child relationships described in the fragment
7. THE Code_Mind SHALL return the complete created nodes (with all auto-generated fields) in the response body of both `POST /nodes` and `POST /import-fragment`, so the caller can reference them for subsequent operations
8. IF a fragment references a parentId that does not exist in the map, THEN THE Code_Mind SHALL return HTTP 400 with an error describing the invalid parent reference
