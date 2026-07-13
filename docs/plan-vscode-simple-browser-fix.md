# VS Code Web 视图兼容修复计划

日期：2026-07-14 ｜ 分支：feat/workspace-dogfood-foundation ｜ 扩展版本：0.2.1

## 目标

- 使用已验证可用的 VS Code Simple Browser 打开 CodeMind 前端，避开自建 Webview 的 Service Worker 注册错误。
- 保留 `vscodeApiKey` 查询参数，确保启用 API key 的工作区仍可访问。
- 后端启动或重启完成后显示准确文案并刷新脑图侧栏。

## 验收

- 扩展 TypeScript 编译和静态检查通过。
- VSIX 0.2.1 打包通过。
- 人工执行 Start 后显示“已启动”，侧栏自动刷新；Open Web App 在 Simple Browser 中打开。
