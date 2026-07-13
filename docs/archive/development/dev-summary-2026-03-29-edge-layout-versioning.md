# 2026-03-29 连线锚点、布局对齐与版本化打包总结

## 本次完成

### 1. 节点扩展不再带着背后连线漂移

- 层级连线从“节点中心到节点中心”改为“分支入口边缘到分支入口边缘”。
- 关系线也同步改成从节点边缘出发，而不是继续穿中心。
- 这样节点宽度变化时，背后的入线位置会稳定得多。

### 2. 自动布局进一步对齐

- 自动布局不再只按节点中心列排布。
- 右侧分支按左边缘对齐，左侧分支按靠近父节点的一侧对齐。
- 新建子节点和同级节点也复用了这套列对齐规则。

### 3. 版本化打包与图标校验

- 在 `wails.json` 中补充了应用元数据，并把当前版本记录为 `1.0.0`。
- 新增 `scripts/package-desktop.ps1` 和 `npm run build:desktop`。
- 该脚本会：
  - 读取 `info.productVersion`
  - 检查 `build/windows/icon.ico`
  - 执行 `wails build -nopackage`
  - 产出 `build/bin/CodeMind-1.0.0.exe`
  - 校验 exe 是否可提取关联图标

## 验证

1. `cd frontend && npm run build`
2. `go test ./...`
3. `npm run build:desktop`

## 当前版本

- `1.0.0`
- 版本化产物：`build/bin/CodeMind-1.0.0.exe`
