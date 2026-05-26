# Code Mind 平台功能使用指南

## 1. 进入 MCP 化

### 前置条件

- 先启动 Code Mind 桌面应用。
- 确认本地 REST API 可访问：`http://127.0.0.1:34117/api/health`。
- MCP 可执行文件来自项目的 `cmd/mcp`，构建命令：

```powershell
go build -o codemind-mcp.exe ./cmd/mcp
```

### MCP Client 配置

在支持 MCP 的 IDE 或 Agent 中添加 stdio server：

```json
{
  "mcpServers": {
    "codemind": {
      "command": "C:\\path\\to\\codemind-mcp.exe",
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
