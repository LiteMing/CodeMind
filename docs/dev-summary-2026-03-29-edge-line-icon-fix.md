# 2026-03-29 连线与桌面图标修复总结

## 完成情况

1. 节点尺寸估算抽离为共享模块，自动布局、边界计算、层级连线锚点统一使用同一套宽高规则。
2. 自动布局对中英文混排、长标题节点的宽度估算更接近真实渲染结果，同级节点的入口边缘对齐稳定下来，层级竖线不再出现明显错位。
3. Windows 打包改为构建后直接补丁 `exe` 资源，显式覆盖图标、清单和版本信息。
4. 桌面包校验改为资源级校验，直接对比 `exe` 内嵌的 `ico` 与源 `ico`，避免 Shell 图标缓存影响判断。
5. `CodeMind-1.0.0.exe` 的 `ProductVersion` / `FileVersion` 已写入 Windows 资源。

## 关键改动

- 新增共享节点尺寸模块：`frontend/src/node-sizing.ts`
- 前端布局与渲染改动：
  - `frontend/src/document.ts`
  - `frontend/src/app.ts`
- 新增 Windows 资源工具：
  - `scripts/patch_windows_resources/main.go`
  - `scripts/check_windows_resources/main.go`
- 更新打包脚本：
  - `scripts/package-desktop.ps1`

## 验证

1. `cd frontend && npm run build`
2. `go test ./...`
3. `npm run build:desktop`
4. 读取 `build/bin/CodeMind-1.0.0.exe` 的 `FileVersionInfo`
   - `ProductVersion = 1.0.0`
   - `FileVersion = 1.0.0.0`
5. 使用资源级工具校验 `exe` 里的 `RT_GROUP_ICON` 与 `build/windows/icon.ico` 一致

