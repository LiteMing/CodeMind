# 实现计划：思维导图 AI 协作策划工具

## 概述

基于现有 Go HTTP Server + FileStore 架构，以最小侵入方式新增节点级 REST API、API Key 认证中间件、以及 JSON 片段导入功能。实现顺序：后端基础设施 → 节点 CRUD → 批量操作 → 片段导入 → 前端设置面板。

## 任务

- [x] 1. 后端基础设施：Settings 存储与 API Key 认证
  - [x] 1.1 实现 Settings 存储模块
    - 创建 `internal/store/settings.go`，定义 `Settings` 结构体（含 `CollabAPIKey string`）
    - 实现 `LoadSettings(dir string) (Settings, error)` 和 `SaveSettings(dir string, s Settings) error`
    - 存储路径为 `data/settings.json`，不存在时返回零值 Settings
    - _需求: 2.1_

  - [x] 1.2 实现 API Key 认证中间件
    - 创建 `internal/server/auth.go`，定义 `APIKeyProvider` 接口和 `apiKeyMiddleware` 函数
    - 当 `GetCollabAPIKey()` 返回非空字符串时，校验请求头 `X-API-Key`
    - 对 `/api/health` 路径放行，不做认证
    - 认证失败返回 HTTP 401，JSON body 含 error 字段
    - _需求: 2.2, 2.3, 2.4_

  - [ ]* 1.3 编写 API Key 认证属性测试
    - **Property 7: API Key 认证的正确性**
    - **验证: 需求 2.2, 2.3, 2.4**
    - 在 `internal/server/auth_test.go` 中使用 rapid 库实现
    - 生成随机 API key 和请求头值，验证放行/拒绝逻辑

  - [x] 1.4 扩展 Server 结构体并注册路由
    - 在 `Server` 结构体中新增 `collabAPIKey string` 字段和 `settings` 相关方法
    - 实现 `GetCollabAPIKey() string` 方法
    - 在 `registerAPI()` 中注册新路由前缀，将 `apiKeyMiddleware` 加入中间件链
    - 新增 `/api/settings` 端点（GET/PUT）用于前端读写配置
    - _需求: 2.1, 2.6_

- [x] 2. 节点 CRUD 处理器
  - [x] 2.1 实现位置自动计算函数
    - 创建 `internal/server/position.go`，实现 `calculateChildPosition` 函数
    - 无子节点时 Y = 父节点 Y，X = 父节点 X + 280px
    - 有子节点时 Y = 最大子节点 Y + 96px，X = 父节点 X + 280px
    - _需求: 1.8, 3.3_

  - [ ]* 2.2 编写位置计算属性测试
    - **Property 2: 位置自动计算的单调性**
    - **验证: 需求 1.8, 3.3**
    - 在 `internal/server/position_test.go` 中使用 rapid 库实现
    - 生成随机父节点和子节点集合，验证新位置计算正确

  - [x] 2.3 实现 GET /api/maps/{mapId}/nodes 处理器
    - 创建 `internal/server/node_handlers.go`，实现 `handleNodes` 方法
    - GET 方法：加载文档，返回所有节点数组
    - 不存在的 mapId 返回 HTTP 404
    - _需求: 1.1, 1.9_

  - [x] 2.4 实现 POST /api/maps/{mapId}/nodes 处理器
    - 在 `handleNodes` 中处理 POST 方法
    - 校验必填字段 parentId 和 title，缺失返回 HTTP 400
    - 校验 kind 值有效性，无效返回 HTTP 400
    - 自动补全 id（NewID("node")）、kind（默认 "topic"）、position、createdAt、updatedAt
    - 验证 parentId 存在于文档中，不存在返回 HTTP 404
    - 保存文档并返回完整创建的节点
    - _需求: 1.3, 1.8, 1.9, 1.10, 3.1, 3.2, 3.3, 3.4, 3.7_

  - [ ]* 2.5 编写节点创建自动补全属性测试
    - **Property 1: 节点创建自动补全的完整性**
    - **验证: 需求 1.3, 3.1, 3.2, 3.4**
    - 在 `internal/server/node_handlers_test.go` 中使用 rapid 库实现
    - 生成随机有效创建请求，验证返回节点字段完整性

  - [ ]* 2.6 编写输入验证拒绝属性测试
    - **Property 10: 输入验证的拒绝正确性**
    - **验证: 需求 1.10, 1.11**
    - 生成包含无效 kind 或缺少必填字段的请求，验证返回 400 且文档不变

  - [x] 2.7 实现 GET /api/maps/{mapId}/nodes/{nodeId} 处理器
    - 创建 `handleNodeByID` 方法，处理 GET 请求
    - 返回指定节点 + 祖先链（到 root）+ 直接子节点
    - 不存在的 nodeId 返回 HTTP 404
    - _需求: 1.2, 1.9_

  - [x] 2.8 实现 PATCH /api/maps/{mapId}/nodes/{nodeId} 处理器
    - 在 `handleNodeByID` 中处理 PATCH 方法
    - 使用 `map[string]interface{}` 解析请求体，仅更新存在的字段
    - 可更新字段：title、note、priority、color、collapsed
    - 更新 updatedAt 为当前 UTC 时间
    - 不修改 id、parentId、kind、position、createdAt
    - _需求: 1.4_

  - [ ]* 2.9 编写部分更新字段隔离属性测试
    - **Property 3: 部分更新的字段隔离性**
    - **验证: 需求 1.4**
    - 生成随机节点和随机字段子集，验证 PATCH 后仅指定字段变化

  - [x] 2.10 实现 DELETE /api/maps/{mapId}/nodes/{nodeId} 处理器
    - 在 `handleNodeByID` 中处理 DELETE 方法
    - 解析 `cascade` 查询参数（默认 true）
    - cascade=true：删除节点及所有后代
    - cascade=false：将子节点重新挂载到被删除节点的父节点
    - 禁止删除根节点，返回 HTTP 400
    - _需求: 1.5, 1.11_

  - [ ]* 2.11 编写级联删除属性测试
    - **Property 4: 级联删除的完整性**
    - **验证: 需求 1.5**
    - 生成随机树结构，验证 cascade=true/false 两种模式的正确性

- [x] 3. 检查点 - 确保节点 CRUD 测试通过
  - 确保所有测试通过，如有问题请询问用户。

- [ ] 4. 树结构与版本端点
  - [x] 4.1 实现 GET /api/maps/{mapId}/tree 处理器
    - 创建 `handleNodeTree` 方法
    - 将扁平节点数组转换为嵌套 TreeNode 结构
    - 以 root 节点为树根，递归构建 children
    - _需求: 1.6_

  - [ ]* 4.2 编写树结构完整性属性测试
    - **Property 6: 树结构端点的完整性**
    - **验证: 需求 1.6**
    - 生成随机文档，验证树中每个节点恰好出现一次且父子关系正确

  - [x] 4.3 实现 GET /api/maps/{mapId}/version 处理器
    - 创建 `handleMapVersion` 方法
    - 返回 `lastEditedAt` 和 `nodeCount`
    - _需求: 2.5_

  - [ ]* 4.4 编写版本端点一致性属性测试
    - **Property 9: 版本端点的一致性**
    - **验证: 需求 2.5**
    - 生成随机文档，验证返回值与文档实际数据一致

- [ ] 5. 批量操作
  - [x] 5.1 实现 POST /api/maps/{mapId}/batch 处理器
    - 创建 `internal/server/batch.go`，实现 `handleNodeBatch` 方法
    - 解析 `BatchRequest`，包含 operations 数组
    - 在内存副本上依次执行所有操作（create/update/delete）
    - 任何操作失败则丢弃副本，返回错误（原子性）
    - 全部成功后一次性写入磁盘
    - _需求: 1.7_

  - [ ]* 5.2 编写批量操作原子性属性测试
    - **Property 5: 批量操作的原子性**
    - **验证: 需求 1.7**
    - 在 `internal/server/batch_test.go` 中使用 rapid 库实现
    - 生成包含有效和无效操作的批量请求，验证失败时文档不变

- [ ] 6. JSON 片段导入
  - [x] 6.1 实现 POST /api/maps/{mapId}/import-fragment 处理器
    - 创建 `internal/server/fragment.go`，实现 `handleImportFragment` 方法
    - 解析 `ImportFragmentRequest`，包含 nodes 数组（FragmentNode 结构）
    - parentId 为空时默认挂载到 root 节点
    - 验证 parentId 存在，不存在返回 HTTP 400
    - 自动补全 id、kind、position、timestamps
    - 递归处理 children 数组，保持父子关系
    - 返回所有创建的完整节点
    - _需求: 3.5, 3.6, 3.7, 3.8_

  - [ ]* 6.2 编写片段导入树结构保持属性测试
    - **Property 8: 片段导入的树结构保持**
    - **验证: 需求 3.5, 3.6, 3.7**
    - 在 `internal/server/fragment_test.go` 中使用 rapid 库实现
    - 生成随机嵌套 FragmentNode 树，验证导入后节点数量和父子关系正确

- [x] 7. 检查点 - 确保批量操作和片段导入测试通过
  - 确保所有测试通过，如有问题请询问用户。

- [x] 8. 前端设置面板集成
  - [x] 8.1 实现前端 Settings API 客户端
    - 在 `frontend/src/` 中创建 API 调用模块，封装 `/api/settings` 的 GET/PUT 请求
    - 包含 `collabApiKey` 字段的读取和保存
    - _需求: 2.1_

  - [x] 8.2 实现前端设置面板 UI
    - 在现有设置面板中新增 "协作 API" 区域
    - 显示当前 API Key（部分遮蔽）
    - 提供"生成新 Key"按钮（生成 32 字符 hex 字符串）
    - 提供"复制"和"清除"按钮
    - 保存时调用 PUT /api/settings 同步到后端
    - _需求: 2.1, 2.6_

  - [ ]* 8.3 编写前端设置面板单元测试
    - 测试 API key 生成逻辑（32 字符 hex）
    - 测试空 key 和非空 key 的 UI 状态切换
    - _需求: 2.1, 2.6_

- [x] 9. 最终检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请询问用户。

## 备注

- 标记 `*` 的子任务为可选任务，可跳过以加速 MVP 交付
- 每个任务引用具体需求条款以确保可追溯性
- 检查点确保增量验证，避免问题累积
- 属性测试使用 [rapid](https://github.com/flyingmutant/rapid) 库验证通用正确性属性
- 单元测试验证具体边界案例和错误条件
- 所有后端代码使用 Go 语言，前端使用 TypeScript

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "1.4", "2.2"] },
    { "id": 2, "tasks": ["1.3", "2.3", "2.4"] },
    { "id": 3, "tasks": ["2.5", "2.6", "2.7", "2.8"] },
    { "id": 4, "tasks": ["2.9", "2.10"] },
    { "id": 5, "tasks": ["2.11", "4.1", "4.3"] },
    { "id": 6, "tasks": ["4.2", "4.4", "5.1"] },
    { "id": 7, "tasks": ["5.2", "6.1"] },
    { "id": 8, "tasks": ["6.2"] },
    { "id": 9, "tasks": ["8.1"] },
    { "id": 10, "tasks": ["8.2"] },
    { "id": 11, "tasks": ["8.3"] }
  ]
}
```
