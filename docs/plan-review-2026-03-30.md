# 2026-03-30 审查计划

## 目标

- 审查上次正式审查文档 `docs/review-2026-03-28.md` 之后的提交与当前 `main` 分支实现。
- 识别功能回归、打包链路风险、缺失测试覆盖。
- 将结论写入新的审查文档和本轮总结文档。

## 范围

- 提交范围：`c5eef28` 至 `3471cf5`
- 重点模块：
  - `frontend/src/app.ts`
  - `frontend/src/document.ts`
  - `frontend/src/node-sizing.ts`
  - `frontend/src/snapshots.ts`
  - `scripts/package-desktop.ps1`
  - `scripts/patch_windows_resources/main.go`
  - `build/windows/info.json`
  - `build/windows/wails.exe.manifest`
- 工作区现状：
  - 当前存在用户未提交变更：`AGENTS.md`、`data/default-map.json`、`docs/open-issues.md`
  - 当前存在未跟踪构建产物：`build/bin/*`、`build/windows/*.png`

## 执行步骤

1. 阅读上次审查文档，确认新的审查起点。
2. 检查上述提交的 diff 和当前实现，定位潜在回归点。
3. 运行现有验证：`go test ./...`、`npm run build:web`。
4. 对已生成的桌面包做只读检查，确认资源补丁结果是否符合预期。
5. 输出审查结论与后续建议。
