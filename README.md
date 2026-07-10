# Code Mind

本地优先的思维导图编辑器，兼具 AI 协作策划能力。通过开放的节点级 REST API，让 AI Agent、IDE 插件、CLI 工具直接读写脑图数据，实现"用户在脑图提需求 → AI 读取上下文 → AI 规划写入 → AI 开发总结回写"的完整闭环。

## 核心特性

### 思维导图编辑
- 键盘优先的节点编辑（Tab 创建子节点、Enter 创建同级）
- 节点拖拽、关系线、区域框、优先级标记、颜色标签
- 分支折叠/展开、自动布局、3D 图谱预览
- 亮色/暗色主题、中英双语

### AI 集成
- AI 生成脑图 / 扩展节点 / 补全笔记 / 建议关系线
- 支持 LM Studio 或任何 OpenAI 兼容 API
- 内置模板（概念图、项目规划、人物关系）

### 协作 API（v1.6 新增）
- **节点级 CRUD**：GET/POST/PATCH/DELETE 单节点，无需传输整个文档
- **树结构端点**：GET /tree 返回嵌套 JSON，AI 一次调用理解项目全貌
- **批量操作**：POST /batch 原子性执行多个增删改
- **JSON 片段导入**：POST /import-fragment 递归创建子树
- **API Key 认证**：设置面板一键生成，X-API-Key header 保护
- **Compact 模式**：?compact=true 省略 43% 冗余字段，节省 AI token
- **实时刷新**：API 写入后前端 2 秒内自动检测并刷新，新节点有淡入动画
- **乐观并发**：真实 document revision + ETag/If-Match，陈旧写入返回 412，不再静默覆盖
- **Agent 命令信封**：服务端派生 actor，节点写入声明 partition/idempotency key；成功重试不重复增加 revision
- **代码语义锚点**：节点可绑定仓库文件、目录、glob、symbol 或 asset，并以稳定 ID 持久化
- **稳定同级顺序**：节点使用显式 order，树结构不再因画布拖动或坐标变化而重排

### 数据存储
- 本地 JSON 文件，零云依赖
- 数据目录基于 exe 位置，任意目录启动均可
- 多地图管理、快照备份
- 可导出为适合 Git diff 的 `semantic.json`，并将画布状态分离到本地 `layout.json`

---

## 与类似产品对比

| 维度 | Code Mind | Miro | Tana | Heptabase | Xmind |
|------|-----------|------|------|-----------|-------|
| 本地优先 | ✅ | ❌ 云端 | ❌ 云端 | ❌ 云端 | ✅ |
| 节点级 API | ✅ | ❌ 画板级 | ✅ | ❌ | ❌ |
| AI Agent 可写入 | ✅ | ✅ MCP | ✅ | ✅ MCP | ❌ |
| Token 优化 | ✅ compact | ❌ | ❌ | ❌ | ❌ |
| 实时反馈 | ✅ 轮询+动画 | ✅ WS | ❌ | ❌ | ❌ |
| 免费 | ✅ | ❌ | ❌ | ❌ | 部分 |
| 面向开发者 | ✅ | ❌ | ❌ | ❌ | ❌ |

---

## Structure

- `main.go` / `serve.go`: 单一二进制入口（无参数=桌面 GUI；`serve`=headless HTTP server，端口 7979；`mcp`=stdio MCP 适配器）
- `internal/mindmap`: 文档模型、导入导出
- `internal/store`: 本地 JSON 持久化 + Settings 存储
- `internal/server`: REST API（含协作 API、AI 代理、认证中间件）
- `internal/mcp`: stdio MCP 适配器（HTTP API 的薄视图）
- `frontend`: Vite + TypeScript 客户端
- `build`: 打包输出 + API-GUIDE.md（面向 AI Agent 的使用指南）
- `docs`: 开发计划与总结

## Current Features

- 键盘优先编辑：Tab 子节点、Enter 同级、F2 重命名、Space 编辑
- 首次运行语言选择（中/英）
- 设置面板：语言、主题、AI 配置、协作 API Key
- AI 语义关系建议、节点笔记补全、知识图谱生成
- AI 连接测试（LM Studio / OpenAI 兼容）
- 优先级标记 P0-P3、节点颜色
- 分支折叠/展开、节点拖拽
- 手动关系线（可编辑标签）
- 自动层级布局
- 3D 浮动图谱（搜索、拖拽旋转、跳转）
- 本地 JSON 持久化
- Markdown 导出、Markdown/TXT 导入
- **协作 API**：节点级 CRUD、批量操作、片段导入、compact 模式、代码绑定与显式同级顺序
- **实时刷新**：API 写入后前端自动检测并刷新
- Wails 桌面打包

## Shortcuts

- `Tab`: add child node
- `Enter`: add sibling node
- `Delete`: delete selected node subtree
- `Space`: enter editing with cursor at the end
- `F2`: rename selected node
- `Arrow keys`: move selection by direction
- `Shift + Arrow keys`: extend selection
- `Ctrl/Cmd + C`: copy current primary subtree
- `Ctrl/Cmd + V`: paste subtree under current primary node
- `Ctrl/Cmd + L`: tidy hierarchy layout
- `Ctrl/Cmd + S`: save

Detailed shortcut notes live in `docs/keyboard-shortcuts.md`.

## Run

Root dev mode:

```powershell
npm install
npm run dev
```

`npm run dev` 会同时启动 Vite 和本地 Go API。AI 测试不会直接访问 LM Studio，而是先访问本地 `/api/*`，再由 Go 后端转发到你配置的 LM Studio 地址。

Backend only:

```powershell
go run . serve
```

Git 语义格式导出与导入：

```powershell
# 从现有运行时脑图导出双文件
go run . format export --input .\data\map.json --out-dir .\project-map

# 默认 strict：semantic/layout 的 mapId 和实体 ID 集合必须完全一致
go run . format import --semantic .\project-map\semantic.json --layout .\project-map\layout.json --output .\restored-map.json

# Git 切换分支后允许布局滞后，或只从 semantic.json 重建默认布局
go run . format import --semantic .\project-map\semantic.json --layout .\project-map\layout.json --output .\reconciled-map.json --reconcile
go run . format import --semantic .\project-map\semantic.json --output .\semantic-only-map.json
```

`semantic.json` 保存节点层级、标题、备注、顺序、代码绑定、关系语义和区域标签，采用确定性排序，建议提交到 Git。`layout.json` 保存主题、位置、尺寸、折叠、关系路由、时间戳和 revision，建议作为本地 companion 写入 `.gitignore`。命令默认拒绝覆盖已有输出；确认替换时显式添加 `--force`，输入文件始终不会被原地修改。

本阶段只提供运行时单文件与 Git 双文件之间的显式 CLI 转换；主存储仍是本地运行时 JSON，尚未接入 REST/MCP、桌面导出 UI、Git 状态展示、自动提交、三方合并或云端部署。

Production frontend build:

```powershell
npm run build
```

After building the frontend, the Go server serves `frontend/dist`.

## Desktop

Wails desktop dev:

```powershell
$w = Join-Path (go env GOPATH) 'bin\wails.exe'
& $w dev
```

Wails desktop build:

```powershell
$w = Join-Path (go env GOPATH) 'bin\wails.exe'
& $w build -nopackage
```

Current desktop output:

- `build/bin/CodeMind.exe`

## Verify

Backend tests:

```powershell
go test ./...
```

Frontend build:

```powershell
cd frontend
npm run build
```
