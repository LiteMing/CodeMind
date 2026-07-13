# 工作区狗粮基础设施计划

日期：2026-07-13 ｜ 分支：feat/workspace-dogfood-foundation ｜ 目标版本：1.15.0

## 目标

- 让 VS Code 在不启动桌面 GUI 的情况下可靠启动、停止和观察 CodeMind 后端。
- 在整图 revision 冲突时，对明确不相交的修改执行保守三方 rebase，减少人机双写冲突。
- 将脑图的可共享语义状态物化到目标工作区，同时隔离运行时数据、token 和设置。

## 子任务

1. **前端三方 rebase**
   - 保存最后一次服务端基线文档。
   - 412 后读取远端版本，比较 base/local/remote。
   - 只自动合并无歧义的节点字段修改和不相交新增；删除、移动、order、关系及同字段冲突继续走人工处理。
   - 自动合并最多重试一次，失败时保留原本地草稿。
2. **VS Code 后端生命周期**
   - 支持配置可执行文件并自动发现 PATH/开发构建。
   - 工作区变量解析、启动/停止/重启、状态栏和日志入口。
   - 离线时提供可执行动作，不再只显示 Failed to fetch。
3. **工作区项目状态**
   - 定义 `.codemind/project.json`，保存 mapId、schemaVersion 和物化策略，不保存密钥。
   - 提供 VS Code 命令将当前脑图导出为 `.codemind/semantic.json` 与 `.codemind/layout.json`。
   - 提供人工里程碑快照命令，将 canonical 文件和无密钥元数据写入 `.codemind/snapshots/`。
   - 默认将 `.codemind/runtime/` 用作可选工作区后端目录，并提示加入 `.gitignore`；token/settings 不进入共享文件。

## 并行边界

- 前端 rebase 只修改 `frontend/src/sync`、前端状态类型和对应测试。
- 后端生命周期只修改 `vscode-extension/src/backend-manager.ts`、扩展命令/配置及测试或编译相关文件。
- 工作区状态优先修改 VS Code 新模块、命令和格式 CLI 调用，不改前端同步层。

## 验收

- 前端专项测试覆盖自动合并、同字段冲突、删除/移动/order 拒绝合并和二次冲突。
- VS Code 编译与 lint 通过，可从 IDE 启停后端并显示状态。
- 临时 Minecraft 风格工作区可生成无密钥的 `.codemind/project.json`、`semantic.json`、`layout.json`。
- Go 全量、前端全量、VS Code 编译、P1 契约脚本通过。
- 打包 `CodeMind-1.15.0.exe`，提交功能代码与总结文档。
