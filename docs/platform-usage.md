# Code Mind 平台功能使用指南

## 1. 进入 MCP 化

### 前置条件

- 先启动 Code Mind 桌面应用。
- 确认本地 REST API 可访问：`http://127.0.0.1:34117/api/health`。
- MCP 与桌面应用是同一个可执行文件：`codemind.exe mcp` 即 stdio MCP server，无需单独构建。开发时也可用 `go run . mcp`。

### MCP Client 配置

在支持 MCP 的 IDE 或 Agent 中添加 stdio server：

```json
{
  "mcpServers": {
    "codemind": {
      "command": "C:\\path\\to\\codemind.exe",
      "args": ["mcp"],
      "env": {
        "CODEMIND_API_URL": "http://127.0.0.1:34117",
        "CODEMIND_ACCESS_TOKEN": ""
      }
    }
  }
}
```

## VS Code 工作区模式

VS Code 扩展可独立管理 headless 后端，不要求桌面 GUI 常驻：

- `codeMind.backendExecutable`：CodeMind EXE 路径，支持 `${workspaceFolder}`；为空时尝试工作区 `build/bin` 与 `PATH`。
- `codeMind.dataDir`：可设为 `${workspaceFolder}/.codemind/runtime`，仅保存本地 runtime、token hash 和设置，必须加入 `.gitignore`。
- `Code Mind: Start/Stop/Restart Local Backend`：管理由当前 VS Code 窗口启动的后端；外部后端只连接，不冒充可停止。
- `Code Mind: Bind Mindmap to Workspace`：生成不含密钥的 `.codemind/project.json`、`semantic.json` 和 `layout.json`。
- `Code Mind: Create Workspace Snapshot`：将人工里程碑保存到 `.codemind/snapshots/`。自动/AI 快照仍在客户端 localStorage，不写入仓库。

工作区物化文件用于 Git 审查和 Agent 上下文，不是直接写回脑图的入口。修改脑图仍须通过 MCP/REST revision 契约。

Agent 应使用服务端签发且 `actorKind=agent` 的协作 token，填入 `CODEMIND_ACCESS_TOKEN`；MCP 会发送
`Authorization: Bearer ...`，服务端以 token ID/actorKind/displayName 生成不可伪造的 actor。`CODEMIND_API_KEY`
仍可作为 owner 兼容入口，但会统一归因到 `local-owner/human`，不适合作为 Agent 身份凭据。

### MCP 暴露工具

- `list_maps`
- `get_tree`
- `get_node`
- `create_node`
- `update_node`
- `delete_node`
- `batch_operations`
- `import_fragment`

读取类工具会自动附加 `compact=true`，更适合 AI Agent 消费。

五个写工具都要求 `expectedRevision`、`partition` 和 `idempotencyKey`。`partition` 当前可声明
`requirements | development | stable`，其中 `stable` 暂时只读；Agent 应写入 `development`。
`idempotencyKey` 在同一个 actor/map 内标识一次逻辑写入：相同 key 和相同请求会重放首次成功结果且不再次增加 revision，
相同 key 用于不同请求会返回 `idempotency_key_reused`。进程内重放记录有界且带 TTL，服务重启后不保证保留。

Agent 应先通过 `list_maps`、`get_tree` 或 `get_node` 取得当前 revision，再执行写入；成功响应会同时返回新的 revision。
陈旧 revision 的 MCP tool result 会设置 `isError=true`，且 `content[0].text` 是稳定 JSON，包含
`revision_conflict`、`expectedRevision` 和 `actualRevision`。调用方必须重新读取后决定如何合并，不能盲目覆盖。

节点读写契约同时包含：

- `order`：有父级节点的 1-based 同级语义顺序。create 省略时追加；update 可与 `parentId` 一起完成移动和插入。
- `bindings`：代码绑定数组，每项包含全图唯一的 `id`、`type`、仓库相对 `path`，以及可选 `symbol`、`glob`、`contentHash`。
- binding type 为 `file | directory | glob | symbol | asset`；`symbol`/`glob` 类型必须提供同名专属字段。
- 路径使用 `/`，不得使用绝对路径、Windows 盘符、UNC 或 `..`。update 传入 `bindings` 时会替换整组，传 `[]` 可清空。
- `batch_operations` 的 create/update payload 与单节点工具使用相同字段；`import_fragment` 的每个节点也可携带 order/bindings。

## 2. 在 VS Code 插件中调用

### 安装/开发运行

进入插件目录：

```powershell
cd vscode-extension
npm install
npm run compile
```

在 VS Code 中用 Extension Development Host 启动该扩展。

### 配置

VS Code 设置项：

```json
{
  "codeMind.apiUrl": "http://127.0.0.1:34117",
  "codeMind.apiKey": ""
}
```

### 使用入口

- 打开左侧 Activity Bar 的 **Code Mind**。
- 点击 **Mindmaps** 树视图。
- 使用树视图标题栏刷新按钮。
- 右键节点可执行：
  - Create Node
  - Rename Node
  - Delete Node
  - Open Note
- 命令面板可执行：`Code Mind: Getting Started` 查看快速说明。

## 3. 分享给互联网网页协作

### 桌面端快速入口

打开任意脑图后，点击顶部工具栏的 **平台** 按钮：

1. 系统会自动生成并保存 owner API Key（如尚未配置）。
2. 系统会自动创建 `viewer` 分享 Token，默认有效期 7 天。
3. 系统会把本地调试网页、本机 WebSocket 地址与公网 WSS 地址模板复制到剪贴板。

本地调试网页格式：

```text
http://127.0.0.1:34117/share/{mapId}?token={secret}
```

打开该网页会显示 WebSocket 连接状态和消息日志，适合调试 Token、权限和协作服务是否正常。

注意：`ws://` / `wss://` 是 WebSocket 客户端连接地址，不是普通网页地址，不能直接粘贴到浏览器地址栏打开。若要像 GitMind 一样点击网页链接直接协作，需要后续提供 `/share/{mapId}` 这类网页协作页，由该页面在内部连接 WebSocket。

### 当前已具备的后端能力

- Token API：`POST /api/tokens`
- WebSocket 协作服务：`ws://127.0.0.1:34118/ws`
- 支持 `viewer/editor/owner` 权限。
- 支持按 `mapId` 房间隔离。

### 创建分享 Token

```powershell
curl -X POST http://127.0.0.1:34117/api/tokens `
  -H "Content-Type: application/json" `
  -d "{\"mapId\":\"MAP_ID\",\"accessLevel\":\"viewer\",\"displayName\":\"Guest\",\"expiresIn\":\"24h\"}"
```

返回里的 `secret` 是分享连接使用的 token。

### 局域网/公网访问方式

本机地址只能本机访问：

```text
http://127.0.0.1:34117
ws://127.0.0.1:34118/ws
```

要给互联网用户访问，需要做端口映射或反向代理：

```text
https://your-domain.example -> 127.0.0.1:34117
wss://your-domain.example/ws -> 127.0.0.1:34118/ws
```

协作 WebSocket 调用格式：

```text
wss://your-domain.example/ws?mapId=MAP_ID&token=TOKEN_SECRET
```

### 当前限制

完整网页投影页面仍在后续任务中；目前后端协作通道已经可用，但还需要继续实现 `/view/{mapId}` 前端页面、只读模式、分享弹窗和公网部署指引。

## 4. 将脑图语义纳入 Git

Phase C 提供显式 CLI，把本地运行时脑图拆为稳定语义文件和本地布局 companion：

- `semantic.json`：保存节点层级与 `order`、标题、备注、优先级、颜色、代码 `bindings`、关系语义、区域标签。它不包含主题、坐标、尺寸、折叠、路由、时间戳或 revision，适合提交、diff 和评审。
- `layout.json`：保存主题、节点位置/尺寸/折叠、关系路由、区域几何、时间戳和 runtime meta。它用于恢复个人画布状态，建议加入 `.gitignore`。
- map title 由 root node title 派生；两个文件用相同 `mapId` 关联。

推荐目录：

```text
project-map/
  semantic.json
  layout.json
```

```gitignore
project-map/layout.json
```

### 导出

```powershell
codemind format export `
  --input .\data\map.json `
  --out-dir .\project-map
```

导出固定写入 `semantic.json` 和 `layout.json`。再次导出时，如果任一输出已存在，命令默认失败；确认要替换时显式添加 `--force`。输入文件不会被修改，也不能同时作为输出文件。

### strict 与 reconcile 导入

默认 strict 适合完整还原和校验：

```powershell
codemind format import `
  --semantic .\project-map\semantic.json `
  --layout .\project-map\layout.json `
  --output .\data\restored-map.json
```

strict 要求两个文件的 `mapId` 相同，node、relation、region 的 ID 集合也完全一致。布局缺失、多出旧实体或来自其他脑图时会拒绝导入。

切换 Git 分支后，`semantic.json` 可能新增或删除实体，而本地 `layout.json` 仍是旧版本。此时使用 reconcile：

```powershell
codemind format import `
  --semantic .\project-map\semantic.json `
  --layout .\project-map\layout.json `
  --output .\data\branch-map.json `
  --reconcile
```

reconcile 会按 ID 保留仍有效的布局、忽略 layout 中的孤立项，并给 semantic 新增实体生成确定性默认布局。完全不需要旧布局时可省略 `--layout`，命令会自动进入 reconcile：

```powershell
codemind format import `
  --semantic .\project-map\semantic.json `
  --output .\data\semantic-only-map.json
```

导入同样默认拒绝覆盖；只有明确替换已有输出时使用 `--force`。日常建议导入到新文件，先在 Code Mind 中检查，再决定是否替换工作副本。

### 当前阶段边界

本阶段建立的是 Git 可评审的文件契约与手动 CLI 工作流。Code Mind 的主存储仍是本地运行时 JSON；`semantic.json` 尚未成为 FileStore 的直接存储，也没有 REST/MCP 格式端点、桌面导出 UI、Git 状态展示、自动提交、三方合并、云端数据库或云端脑图部署。云端 Git 稳定区和多人开发分支可以在此契约之上继续实现，但不是 Phase C 已交付能力。
