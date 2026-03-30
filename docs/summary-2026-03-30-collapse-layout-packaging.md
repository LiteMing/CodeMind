# 2026-03-30 折叠布局与打包修复总结

## 完成内容

- 修复了 Windows 桌面打包的两个资源问题：
  - 不再把未渲染的 manifest 模板直接写入 EXE
  - 版本资源改为以 `wails.json` 为单一来源生成，避免版本号双份维护
- 修复了新增节点位置计算忽略 badge 高度的问题。
- 为节点右侧增加了快速折叠按钮，存在子节点时显示为小圆点按钮。
- 折叠/展开后会重新整理层级布局，折叠分支不再继续占位，展开后可恢复布局展开状态。
- 新增子节点/同级节点后，会自动重新整理层级布局，避免新节点被直接插到下方阶段之后。
- 版本号已从 `1.0.0` 更新为 `1.1.0`。
- 已重新打包桌面端产物：`build/bin/CodeMind-1.1.0.exe`

## 关键实现

- `scripts/package-desktop.ps1`
  - 根据 `wails.json` 动态生成 Windows version info
  - 根据 manifest 模板生成已渲染的临时 manifest 再补丁进 EXE
- `scripts/patch_windows_resources/main.go`
  - 使用渲染后的 manifest 与动态 version info 回写资源
- `scripts/check_windows_resources/main.go`
  - 除图标外，增加了 manifest 占位符校验
- `frontend/src/document.ts`
  - 折叠节点的 branch weight 改为只按可见分支计算
  - 新增位置计算改为按实际 badge 尺寸估算节点高度
- `frontend/src/app.ts`
  - 新增快速折叠按钮命令
  - 新建层级节点后自动触发层级重排
- `frontend/src/style.css`
  - 增加节点右侧折叠圆点按钮样式

## 验证结果

- `go test ./...`：通过
- `npm run build:web`：通过
- `npm run build:desktop`：通过
- 产物检查：
  - `CodeMind-1.1.0.exe` 的 `ProductVersion = 1.1.0`
  - EXE 中已存在 `com.wails.code-mind` manifest，且不再包含模板占位符

## 说明

- 工作区里原本就存在用户未提交改动：`AGENTS.md`、`data/default-map.json`、`docs/open-issues.md` 等，本轮未覆盖也未回退。
- 当前自动重排主要针对层级节点新增与分支折叠/展开；自由节点布局逻辑未改动。
