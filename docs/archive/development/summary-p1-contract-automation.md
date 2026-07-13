# P1 双契约自动验收脚本总结

日期：2026-07-12 ｜ 分支：feat/p1-agent-contract

## 完成内容

- 新增 `scripts/test-p1-contract.ps1`，直接运行版本化 CodeMind EXE，而不是只包装单元测试。
- 使用随机临时端口和 `CODE_MIND_DATA_DIR` 临时目录，不连接、不修改现有脑图。
- 自动覆盖 B1-B9：命令 header、412、stable、幂等重放、key 冲突、DELETE query 指纹和失败不缓存。
- 自动覆盖 C1-C6：agent/viewer token、map scope、scoped list 限制、actor 幂等隔离和身份字段不可自声明。
- 通过真实 `codemind.exe mcp` stdio framing 覆盖 D1/D2/D3/D5/D6。
- 通过真实 `codemind.exe format` 覆盖 E1-E5、默认覆盖保护；通过注入测试覆盖双文件原子回滚。
- 自动验证 serve/mcp/format 三种非 GUI 模式的协议行为和退出码。
- `-IncludeRegression` 可追加 Go 全量测试、前端 Vitest 和 VS Code TypeScript 编译。
- 默认输出逐项 PASS/FAIL/SKIP，并将 JSON 报告写入忽略目录 `build/reports/`。
- 脚本要求 PowerShell 7；E6b 在 Go 可用时验证当前源码的原子回滚，缺少 Go 时单项记为 SKIP。
- `-Executable` 可指定 EXE，`-KeepArtifacts` 可主动保留临时现场；任一测试失败时也会自动保留。
- 新增 `npm run test:p1-contract` 入口。

## 验证结果

- 默认运行：30 PASS、0 FAIL、5 SKIP。
- 带 `-IncludeRegression`：33 PASS、0 FAIL、4 SKIP。
- 自动创建的服务进程均正常终止，临时数据默认清理。
- JSON 报告正常生成，失败时脚本退出码为非零并自动保留服务日志及临时数据现场。

## 人工边界

- A 组 UI 冲突恢复和使用体感。
- D4/D7 外部 Agent 的自愈重试与 key 礼仪。
- F1 GUI 启动、F5 同目录多进程风险，以及 console/window 可见性。
- G 组 AI、快照侧栏、拖拽、动画和剪贴板视觉交互。

## A 组发现整理

- 同图重新加载会重置镜头，建议后续保留中心点和缩放。
- 当前桌面端使用整图 revision/CAS，不同节点的并发编辑也会冲突；后续需要 operation/rebase/changeset 同步。
- 快照按浏览器/WebView 的 localStorage 分开保存，每图最多 14 条并保护最近 4 条手动快照；当前缺少删除、清空、筛选和独立滚动管理。

## 版本

本次只增加测试工具和文档，不改变产品运行时，不提升 `1.14.0` 版本，也不重新打包桌面应用。
