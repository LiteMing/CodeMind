# P1 双契约自动验收脚本计划

日期：2026-07-12 ｜ 分支：feat/p1-agent-contract ｜ 基线：6aa5c0a

## 目标

- 将人工清单 B/C/D/E/F 中可确定判定的项目收敛为一次性自动验收。
- 使用临时端口和临时数据目录运行真实 `CodeMind.exe`，不读写用户现有脑图。
- 输出逐项 PASS/FAIL/SKIP 和机器可读 JSON 报告，失败时保留足够诊断信息。

## 自动覆盖

- B：命令 header、revision 冲突、stable 拒写、幂等重放、key 冲突、query 指纹和失败不缓存。
- C：agent/viewer token、map scope、list 限制、actor 幂等隔离和身份字段不可自声明。
- D：真实 stdio MCP schema、正常写入、结构化 412、stable 错误和重复工具调用重放。
- E：format 确定性、语义/布局分离、往返、非法输入和默认覆盖保护。
- F：serve、mcp、format 三种非 GUI 模式。
- 可选回归：Go、前端和 VS Code 自动化套件。

## 保留人工

- A 组 UI 冲突体感与用户已记录的问题。
- D4/D7 外部 Agent 是否遵循重试和 key 礼仪。
- F1 GUI 启动体感、F5 同目录多进程风险。
- G 组需要视觉、拖拽、快照侧栏或 AI 服务的项目。

## 技术方案

- 新增 `scripts/test-p1-contract.ps1`，默认选择 `build/bin` 下最新的版本化 EXE，也允许 `-Executable` 显式指定。
- 脚本启动临时 headless server，通过 `System.Net.Http.HttpClient` 保留非 2xx 响应以做精确断言。
- MCP 子进程使用 Content-Length framing 批量发送 JSON-RPC 请求，关闭 stdin 后解析全部响应。
- format 测试使用临时 runtime 副本和独立输出目录，按字节比较 semantic/layout。
- 要求 PowerShell 7；E6b 在 Go 可用时执行源码注入回滚测试，缺少 Go 时记为 SKIP。
- `finally` 中终止脚本启动的进程；成功时默认删除临时目录，`-KeepArtifacts` 或任一测试失败时保留现场。

## 验收

- 默认命令可在当前 Windows/PowerShell 环境完整通过。
- 任一断言失败时进程退出码非零，报告标明测试 ID、期望和实际结果。
- 不改变现有用户清单中的 A 组勾选和问题记录。
- 更新 npm 入口、人工清单说明和总结文档后提交。
