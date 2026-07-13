# 开发总结：折叠/展开快速切换闪烁修复 + 节点注释标记

日期：2026-07-09 ｜ 版本：1.9.6 ｜ 计划：docs/archive/development/plan-collapse-flicker-note-badge.md

## 完成内容

### 1. 折叠/展开快速切换闪烁（fix）

根因是三层竞态（详见计划文档）：折叠的状态翻转延迟提交且 timer 无取消机制（双发互相翻转）、
窗口期 render 全量重建 DOM 抹掉 rAF 加的动画类、展开清理 timer 无条件清全局边类。

修法（全部状态驱动 + settle）：

- `MindMapApp` 新增 `collapsingNodeIds`（与 `expandingNodeIds` 对称）和
  `collapseToggleAnimations`（节点 → 在飞收尾器 `{timer, settle}`）。
- 折叠改为 render 前填表，`renderNodes`/`renderEdges` 首帧输出 `node-collapsing`/
  `edge-collapsing` 类与内联 stagger 延迟；同节点两表并存时折叠优先。中途任何 render 不再丢动画。
- `toggleNodeCollapse` 入口先 settle 在飞动画（clearTimeout + 同步执行收尾），每次点击恰好
  一次状态翻转；折叠收尾对已删除节点只清表不误翻转。
- 展开清理只清本子树边类、跳过已被新折叠接管的节点；`.edge-collapsing` 改 keyframes（both 填充）。

### 2. 节点注释黄色标记（feat）

- 有注释的节点在标题与分支徽标之间渲染黄色气泡标记（`--p2` 琥珀色，SVG 图标，
  hover 提示注释摘要 120 字）。
- `node-sizing.resolveAccessoryWidth` 计入标记宽度（22px+间距），标题不被挤压；布局估宽同步。
- 点击标记 → 新命令 `open-node-note:<id>` → `app.openNodeNoteEditor`：选中节点、展开
  Inspector（折叠时复用 `animatePanelIn`）、展开"当前节点"分区、聚焦注释输入框并置光标于末尾。
- i18n：`node.noteBadge`（en/zh）。

## 验证

- vitest 212 通过（新增 5 个用例：3 个 node-sizing 宽度、快速切换 fake-timers 冒烟、
  注释标记端到端冒烟）；回归用例已验证在旧实现下确实失败（git stash 交叉验证）。
- `npm run build`（tsc + vite）、`npm run lint`、`go test ./...` 全部通过。

## 遗留与后续

- 复查意见已修（同批入 1.9.6 包）：①注释徽章加入 pointerdown 排除（与折叠按钮同款），
  按住徽章拖动不再拖走节点/吞掉点击；②Inspector 开合动画期间点徽章改为短暂重试
  （60ms×≤8 次），动画尘埃落定后走正常打开路径，focus 不再静默失败。
- 已知限制（记录在案，现阶段可接受）：折叠动画窗口内若发生无关全量 render，
  动画会从头重播——innerHTML 全量重建的固有代价，根治靠 P4 增量渲染/视口虚拟化。
- 注释标记点击在触屏上未单独验证（Pointer Events 全程接管，理论一致）。
- 本分支正题（AI 可回滚 + AI 协作可见性补丁）随后进行，见 docs/archive/development/plan-ai-rollback-visibility.md。
