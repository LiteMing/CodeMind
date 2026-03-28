# 2026-03-28 风格功能开发总结

## 本轮完成

### 1. 外观设置持久化

- 在 `AppPreferences` 中新增外观配置：
  - `edgeStyle`
  - `layoutMode`
  - `topPanelPosition`
- 补充默认值与本地存储兼容加载逻辑，旧配置会自动回退到默认风格。

### 2. 连线风格

- 默认保留曲线连线。
- 新增“方框直角连线”选项。
- 层级连线与关系连线都支持按当前设置切换。
- 关系连线标签位置在直角模式下改为跟随横向主线段。

### 3. 右侧单边布局

- 自动整理布局支持两种模式：
  - 左右平衡
  - 仅向右延展
- 根节点下新增子节点、同级节点、粘贴子树、AI 注释转子节点时，都会遵循当前布局模式。
- 在“仅向右延展”模式下，整理布局不会再把根节点子树分散到标题左右两边。

### 4. 顶部面板位置

- 新增顶部面板预设位置：
  - 左侧
  - 顶部居中
  - 右侧
- 本轮未实现自由拖拽，优先采用更稳定的预设定位方案。
- 右侧检查器的顶部避让逻辑保持可用。

## 修改文件

- `frontend/src/types.ts`
- `frontend/src/preferences.ts`
- `frontend/src/document.ts`
- `frontend/src/app.ts`
- `frontend/src/i18n.ts`
- `frontend/src/style.css`
- `docs/dev-plan-2026-03-28-style-options.md`

## 验证结果

已执行并通过：

1. `frontend`: `npm run build`
2. 仓库根目录：`go test ./...`
3. 仓库根目录：`npm run build`
4. 仓库根目录：`wails build`

## 打包产物

- `build/bin/CodeMind.exe`

## 备注

- 工作区中存在用户此前未提交的改动：`AGENTS.md`、`data/default-map.json`、`docs/open-issues.md` 等，本轮未覆盖。
