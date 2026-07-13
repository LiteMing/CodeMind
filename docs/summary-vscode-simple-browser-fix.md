# VS Code Web 视图兼容修复总结

日期：2026-07-14 ｜ 分支：feat/workspace-dogfood-foundation ｜ 扩展版本：0.2.1

## 完成内容

- 删除自建 iframe Webview，`Open Web App` 改用已验证可用的 VS Code Simple Browser。
- 保留 `vscodeApiKey` 查询参数；Simple Browser 命令失败时自动退到系统浏览器。
- 后端启动完成后显示“Code Mind backend started”，并自动刷新 Mindmaps 侧栏。
- 停止和重启完成后同样刷新侧栏，停止失败会显示明确错误。
- Getting Started 与扩展 README 已更新为当前配置和打开方式。

## 原因

原自建 Webview 在当前 VS Code 环境中触发内部 Service Worker 注册错误。后端进程、health、API 和普通浏览器均正常，且用户确认 Simple Browser 可以加载同一前端，因此改用内置浏览器是更稳定的集成方式。

## 验证

- VS Code TypeScript 编译通过。
- 显式 ESLint 静态规则通过。
- `codemind-vscode-0.2.1.vsix` 打包通过。
