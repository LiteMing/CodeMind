# 2026-03-30 折叠布局与打包修复计划

## 目标

- 修复上一轮审查确认的 3 个问题：
  - Windows manifest 被模板文件错误回写
  - Windows 版本号存在双份来源
  - 新增节点位置计算忽略 badge 高度
- 新增节点右侧快速折叠按钮
- 折叠/展开时自动整理层级布局，让折叠分支不再持续占位，展开后恢复
- 新建节点遇到下方紧邻节点时，优先把下方节点及其父分支整体下推，而不是让新节点跨越下方阶段
- 按 `AGENTS.md` 规则更新版本号并在可打包时执行打包

## 方案

### 1. 打包链路

- 停止用模板 `build/windows/wails.exe.manifest` 直接回写 EXE manifest。
- 保留 Wails 生成的 manifest，仅补丁 icon 和 version info。
- 让桌面打包使用 `wails.json` 作为版本与产品信息的单一来源，打包时生成 resolved Windows version info。

### 2. 折叠与布局

- 在节点右侧增加独立的小圆点折叠按钮，仅在存在子节点时显示。
- 将折叠/展开交互复用现有 collapse 状态与 history/autosave 链路。
- 自动布局时仅按可见分支计算 branch weight，使折叠分支收拢；展开后重新布局恢复。

### 3. 新增节点排布

- 修正 `nextStackedY` 的高度估算，计入节点实际 badge 宽高。
- 为“新增子节点/兄弟节点”补充一个下推策略：
  - 若目标位置下方有紧邻节点，则沿祖先链向下移动受影响节点/父分支；
  - 新节点保持在目标父节点附近插入，不跨越下方已有阶段。

## 验证

- `go test ./...`
- `npm run build:web`
- `npm run build:desktop`
- 对桌面包二进制做只读检查，确认不再包含未展开的 manifest 模板占位符
