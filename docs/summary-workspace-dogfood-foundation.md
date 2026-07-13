# 工作区狗粮基础设施总结

日期：2026-07-13 ｜ 分支：feat/workspace-dogfood-foundation ｜ 桌面版本：1.15.0 ｜ VS Code 扩展：0.2.0

## 完成内容

### 保守三方 rebase

- 前端保存最后一次服务端基线，在整图 PUT 收到 412 后读取远端版本并执行 base/local/remote 三方比较。
- 自动合并不同节点、同节点不同字段及不同父节点下的追加节点，最多自动重试一次。
- 删除、移动、order、关系、区域、同字段冲突和二次 412 继续进入原人工冲突态，本地草稿保持不变。
- 自动合并成功后显示“已自动合并服务端的非冲突更改并保存”。

### VS Code 后端生命周期

- 新增 `codeMind.backendExecutable`，支持 `${workspaceFolder}`、工作区 `build/bin` 自动发现和 PATH 查找，并兼容旧 `backendCommand`。
- 增加启动、停止、重启、日志入口和状态栏；区分本窗口托管后端与外部已连接后端。
- 重复启动会等待同一进程健康，重启会等待旧进程退出，启动失败和超时会清理进程引用。
- 网络错误提供直接启动后端的动作，`Open Web App` 会先确保后端可用。

### 工作区绑定、物化与快照

- 新增只读 `GET /api/maps/{mapId}/project-files`，复用 Go canonical formatter 返回精确 semantic/layout 内容。
- VS Code 可原子生成 `.codemind/project.json`、`semantic.json`、`layout.json`；project.json 严格只含 schemaVersion/mapId。
- 支持重新物化、重新绑定确认及 `.codemind/runtime/` 的 `.gitignore` 保护。
- 支持人工命名里程碑快照，写入 `.codemind/snapshots/{time}-r{revision}-{name}/`，包含无密钥 metadata、semantic 和 layout。
- 自动/AI 快照仍保存在客户端 localStorage，避免高频内容污染 Git。
- Agent 协议已增加 `.codemind/project.json` 发现规则；物化文件只作上下文和审查，不允许绕过 MCP/REST 直接回写。

## 验证

- Go：`go test ./...` 通过。
- 前端：17 个测试文件，249 通过、2 跳过；TypeScript 与 Vite 生产构建通过。
- rebase 专项：22/22 通过。
- VS Code：TypeScript 编译和显式 ESLint 规则通过。
- P1 契约：`CodeMind-1.15.0.exe` 为 33 PASS、0 FAIL、4 个分组 SKIP。
- 黑盒端点：打包 EXE 启动临时 serve 后，创建脑图并成功读取 canonical project files。
- 打包：`build/bin/CodeMind-1.15.0.exe` 与 `dist/codemind-vscode-0.2.0.vsix`。

## 当前边界

- rebase 是保守自动合并，不处理节点移动、删除、同父 order、关系或区域冲突。
- VS Code 只能停止和重启由当前窗口启动的后端，外部桌面或 serve 实例只连接。
- 工作区物化暂时是显式命令，不会监听 Git 或自动回写脑图；完整 stable 区仍是后续阶段。
- 工作区 runtime 可能包含 token hash 和协作设置，必须保持在 `.gitignore` 中。
