# 开发计划：折叠/展开快速切换闪烁修复 + 节点注释标记

日期：2026-07-09

## 目标

1. 修复快速连续切换折叠/展开时节点渲染闪烁。
2. 有注释的节点在标题与分支徽标之间显示黄色注释标记，点击标记自动弹开注释卡片（Inspector 当前节点区）并聚焦注释输入框。

## 问题一：快速切换闪烁的根因

上一轮（328da1e）把"展开"改成了状态驱动（`expandingNodeIds` 在 render 前填充），但"折叠"仍是**事后 DOM 标记**，且两侧的收尾 timer 都没有取消机制。快速切换时存在三层竞态：

1. **折叠是延迟提交的**：折叠先播动画，`setTimeout(maxDelay+350ms)` 后才真正 `toggleCollapse` + render。
   窗口期内再次点击时 `node.collapsed` 仍是 false → 又排一次折叠 → 两个 timer 都会 fire，各翻转一次状态。
   净效果是"折叠后瞬间无动画地弹回"，还多写了一条历史记录。
2. **窗口期内任何 render 都会抹掉动画类**：`node-collapsing` 是 rAF + classList 加的，而每次
   `render()` 都是 `nodeLayer.innerHTML` 全量重建 → 子节点瞬间跳回全亮，等 timer fire 又瞬间消失。
3. **展开的清理 timer 不感知新动画**：它会无条件删 `expandingNodeIds`、移除元素上的
   `node-expanding`/内联 `animation-delay`，并全局清掉所有 `.edge-expanding`。若此时同一子树已在播
   折叠动画（或另一子树在展开），类被中途移除 → 动画重启/跳变。

## 方案一

- `MindMapApp` 新增：
  - `collapsingNodeIds = Map<nodeId, delay>`（与 `expandingNodeIds` 对称，折叠改为状态驱动渲染）；
  - `collapseToggleAnimations = Map<toggledNodeId, { timer, settle() }>`（每个节点在飞的折叠/展开收尾器）。
- `renderNodes`/`renderEdges` 首帧直接输出 `node-collapsing`/`edge-collapsing` 类与内联延迟；
  同一节点同时在两张表里时折叠优先。中途 render 不再丢动画类。
- `.edge-collapsing` 从 transition 改为 keyframes 动画（`both`），首帧带类渲染也能正常淡出。
- `toggleNodeCollapse` 入口先 **settle**：若该节点有在飞动画，`clearTimeout` 并同步执行其收尾
  （折叠→立即提交状态翻转；展开→立即清理动画类），保证每次点击恰好一次翻转、无 timer 双发。
- 展开清理只清本子树的边类，且跳过已进入 `collapsingNodeIds` 的节点。
- 折叠收尾时若节点已不存在（删除/切图），只清表并 render，不再误报状态。

## 问题二：注释标记

- `renderNodes`：`normalizeNodeNote(node.note)` 非空时，在标题与分支徽标之间输出
  `<span class="node-note-badge" data-command="open-node-note:<id>" data-node-note-badge=...>`（气泡图标，
  黄色 `--p2` 配色），`title` 显示注释摘要。
- `node-sizing.resolveAccessoryWidth` 计入注释标记固定宽度（22px + 间距），避免标题被挤压。
- 新命令 `open-node-note:<id>`（commands.ts）→ `app.openNodeNoteEditor(id)`：
  选中节点 → 展开 Inspector（若折叠则复用 `animatePanelIn`）→ 展开"当前节点"分区 → render →
  聚焦注释 textarea 并把光标移到末尾。
- i18n 新增标记的 aria/title 文案（en/zh）。

## 任务拆分

| 子任务 | 文件 |
|---|---|
| 状态驱动折叠 + settle 竞态治理 | app.ts、state/ops.ts、render/canvas.ts、animations.css |
| 注释标记渲染与尺寸 | render/canvas.ts、node-sizing.ts、style.css |
| 点击弹开注释卡片 | interaction/commands.ts、app.ts、i18n.ts |
| 回归测试 | app.smoke.test.ts（快速切换、注释标记端到端）、node-sizing.test.ts |
| 版本与文档 | wails.json 1.9.5 → 1.9.6、summary 文档 |

## 验证

- `npm test`（vitest）：新增快速切换冒烟用例（fake timers 精确到窗口期）+ 注释标记端到端用例。
- `npm run build`（tsc + vite）。
- `go test ./...` 保持通过（本次不动后端）。
