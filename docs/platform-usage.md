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
        "CODEMIND_API_KEY": ""
      }
    }
  }
}
```

如果桌面端设置了 API Key，把同一个值填入 `CODEMIND_API_KEY`。

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

五个写工具都要求 `expectedRevision`。Agent 应先通过 `list_maps`、`get_tree` 或 `get_node`
取得当前 revision，再执行写入；成功响应会同时返回新的 revision。陈旧 revision 会得到冲突错误，
必须重新读取后再决定如何合并，不能盲目重试覆盖。

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
