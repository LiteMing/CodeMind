# Implementation Plan: UX 动效与交互体验改进

## Overview

本计划将 Code Mind 的 UX 动效系统分为基础设施搭建、CSS 动画层、JS 动画引擎、交互组件四个阶段实现。每个阶段的任务增量构建，确保无孤立代码。实现语言为 TypeScript + CSS，测试使用 Vitest + fast-check。

## Tasks

- [x] 1. 基础设施与核心接口
  - [x] 1.1 创建 animations.css 文件并配置 CSS 自定义属性
    - 创建 `frontend/src/animations.css`
    - 定义 `--ease-out`, `--ease-in-out`, `--duration-fast`, `--duration-normal`, `--duration-slow`, `--stagger-base` 等 CSS 自定义属性
    - 添加 `@media (prefers-reduced-motion: reduce)` 全局降级规则
    - 在 `style.css` 中通过 `@import` 引入 `animations.css`
    - _Requirements: 1.1, 1.2, 3.1, 6.1_

  - [x] 1.2 创建 ux-engine.ts 核心模块与接口定义
    - 创建 `frontend/src/ux-engine.ts`
    - 实现 `ViewportState`, `InertiaState`, `ZoomAnimState`, `FitViewAnimState` 接口
    - 实现 `UxEngine` 类骨架（constructor, destroy）
    - 实现 `easeOutCubic(t)` 纯函数
    - 实现 `ViewportUpdateCallback` 类型
    - _Requirements: 6.1, 7.1, 8.1_

  - [x] 1.3 扩展 app-types.ts 添加 UX 状态接口
    - 添加 `ContextToolbarState`, `ToastItem`, `ToastManagerState`, `GuideOverlayState` 接口
    - 添加 `MinimapConfig`, `MinimapState` 接口
    - 扩展 `AppState` 接口添加 UX 相关字段
    - _Requirements: 9.1, 12.1, 15.4, 17.1_

  - [x] 1.4 安装 fast-check 测试依赖
    - 在 `frontend/` 目录执行 `npm install -D fast-check`
    - 验证 vitest 配置兼容 fast-check
    - _Requirements: (测试基础设施)_

- [x] 2. CSS 动画层（Layer 1: Pure CSS）
  - [x] 2.1 实现面板 slide-in/out 动画
    - 在 `animations.css` 中定义 `@keyframes panel-slide-in` 和 `@keyframes panel-slide-out`
    - 添加 `.panel-entering`, `.panel-leaving` CSS class 规则
    - 包含 opacity fade 并发过渡
    - 在 `app.ts` 面板打开/关闭逻辑中添加 class toggle 和 animationend 监听
    - 实现动画互斥锁（`panelAnimating` Set）
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ]* 2.2 编写面板动画互斥属性测试
    - **Property 1: Panel animation mutual exclusion**
    - **Validates: Requirements 1.3**

  - [x] 2.3 实现节点创建/删除动画
    - 定义 `@keyframes node-create`（scale 0.85→1.0 + opacity 0→1）
    - 定义 `@keyframes node-delete`（scale 1.0→0.8 + opacity 1→0）
    - 添加 `.node-creating`, `.node-deleting` CSS class
    - 在 `app.ts` 节点创建逻辑中添加动画 class
    - 在 `app.ts` 节点删除逻辑中延迟 DOM 移除直到动画完成
    - _Requirements: 2.1, 2.3, 3.1_

  - [ ]* 2.4 编写节点删除 DOM 保留属性测试
    - **Property 2: Node deletion DOM retention during animation**
    - **Validates: Requirements 3.1**

  - [x] 2.5 实现拖拽视觉反馈 CSS
    - 定义 `.node-dragging` class（增强 box-shadow + scale 1.02）
    - 定义 `.drop-target-highlight` class（accent border）
    - 定义 `.alignment-guide` 样式（1px dashed, accent 50% opacity）
    - 在 `app.ts` 拖拽逻辑中添加 class toggle
    - _Requirements: 5.1, 5.3, 5.5_

  - [x] 2.6 实现连线交互与编辑态过渡 CSS
    - 定义 edge hover transition（stroke-width 1.5x, opacity 1.0, 150ms）
    - 定义 `@keyframes edge-grow`（stroke-dashoffset 动画）
    - 定义 `.node-editing` class（border highlight + scale 1.01）
    - 定义节点编辑态 width/height transition
    - _Requirements: 10.1, 10.2, 10.3, 11.1, 11.2, 11.3_

  - [x] 2.7 实现 Toast 与保存反馈 CSS
    - 定义 `@keyframes toast-enter`（slide-up + fade-in）
    - 定义 `@keyframes toast-exit`（fade-out）
    - 定义 `@keyframes save-pulse`（脉冲动画 400ms）
    - 定义 `@keyframes save-shake`（抖动动画 300ms）
    - 定义 toast 容器布局（bottom-center, 垂直堆叠, 8px spacing）
    - _Requirements: 14.1, 14.2, 15.2, 15.3_

  - [x] 2.8 实现 Inspector 折叠/展开与 Context Toolbar CSS
    - 定义 Inspector section `max-height` transition（200ms）
    - 定义 `.section-collapsed` / `.section-expanded` class
    - 定义 `.context-toolbar` 样式（浮动定位, fade-in + slide-up 150ms）
    - 定义 `.context-toolbar-hidden` 退出动画
    - _Requirements: 17.1, 17.4, 18.2, 18.3_

- [x] 3. Checkpoint - CSS 层验证
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. JS 动画引擎（Layer 3: Pure JS rAF）
  - [x] 4.1 实现 UxEngine 缩放插值逻辑
    - 实现 `animateZoom(currentScale, targetScale, centerX, centerY, viewportX, viewportY)`
    - 实现缩放中心点不变量（world-space coordinate preservation）
    - 实现 `cancelZoom()` 清理
    - 实现 retarget 逻辑（从当前插值值重新开始）
    - 添加 `prefers-reduced-motion` 检测，跳过插值直接设置目标值
    - _Requirements: 6.1, 6.2, 6.3_

  - [ ]* 4.2 编写缩放插值正确性属性测试
    - **Property 6: Zoom interpolation correctness**
    - **Validates: Requirements 6.1**

  - [ ]* 4.3 编写缩放中心点不变量属性测试
    - **Property 7: Zoom center point invariant**
    - **Validates: Requirements 6.2**

  - [ ]* 4.4 编写缩放 retarget 连续性属性测试
    - **Property 8: Zoom retarget continuity**
    - **Validates: Requirements 6.3**

  - [x] 4.5 实现 UxEngine 惯性滚动逻辑
    - 实现 `startInertia(velocityX, velocityY, currentViewport)`
    - 实现指数衰减物理模型（velocity * friction^N）
    - 实现 `cancelInertia()` 清理
    - 实现速度阈值停止条件（< 0.5px/frame）
    - 添加 `document.hidden` 暂停支持
    - _Requirements: 7.1, 7.2, 7.3_

  - [ ]* 4.6 编写惯性物理模型属性测试
    - **Property 9: Inertia physics model**
    - **Validates: Requirements 7.1, 7.2**

  - [x] 4.7 实现 UxEngine Fit-to-View 动画
    - 实现 `animateFitToView(current, target)`
    - 实现目标视口计算（包含所有节点 + 60px padding）
    - 实现 ease-in-out 插值（300ms–500ms）
    - 实现 `cancelFitToView()` 清理
    - 处理空画布情况（回到默认视口）
    - _Requirements: 8.1, 8.2, 8.3_

  - [ ]* 4.8 编写 Fit-to-View 视口边界属性测试
    - **Property 10: Fit-to-view viewport bounds**
    - **Validates: Requirements 8.2**

- [x] 5. Checkpoint - JS 引擎验证
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. JS + CSS 联动层（Layer 2）
  - [x] 6.1 实现折叠/展开 stagger 动画
    - 在 `ux-engine.ts` 中实现 `computeStaggerDelays(nodeIds, baseDelay)`
    - 在 `app.ts` 折叠逻辑中调用 stagger 计算，为每个子节点设置 `animation-delay`
    - 实现展开时的反向 stagger（从父到叶）
    - 实现 edge 跟随插值（CSS transition on edge path）
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ]* 6.2 编写子树删除 stagger 排序属性测试
    - **Property 3: Subtree deletion stagger ordering**
    - **Validates: Requirements 3.2**

  - [x] 6.3 实现对齐辅助线检测与渲染
    - 在 `ux-engine.ts` 中实现 `detectAlignment(draggedPos, draggedSize, otherNodes)`
    - 实现 5px 阈值检测（center 和 edge 对齐）
    - 在 `app.ts` 拖拽 mousemove 中调用检测并渲染 guide DOM 元素
    - 实现 drop target 40px 距离高亮
    - _Requirements: 5.2, 5.3_

  - [ ]* 6.4 编写对齐检测阈值属性测试
    - **Property 4: Alignment guide detection threshold**
    - **Validates: Requirements 5.2**

  - [ ]* 6.5 编写 Drop target 距离阈值属性测试
    - **Property 5: Drop target highlight distance threshold**
    - **Validates: Requirements 5.3**

  - [x] 6.6 实现快捷键高亮闪烁
    - 在 `app.ts` 快捷键处理中，触发对应 toolbar 按钮的 `.shortcut-flash` class
    - 实现 200ms 后自动移除 class
    - 建立 shortcut → button 映射表
    - _Requirements: 16.1, 16.2_

  - [ ]* 6.7 编写快捷键-工具栏高亮映射属性测试
    - **Property 15: Shortcut-to-toolbar highlight mapping**
    - **Validates: Requirements 16.1**

- [x] 7. Checkpoint - 联动层验证
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. 交互组件：Minimap
  - [x] 8.1 实现 Minimap Canvas 渲染
    - 在 `ux-engine.ts` 中添加 Minimap 渲染逻辑
    - 创建 180×120 Canvas 元素，定位在右下角
    - 实现节点简化矩形绘制（遍历所有节点，映射到 minimap 坐标）
    - 实现视口矩形绘制（半透明覆盖层）
    - 实现 throttle 渲染（活跃 60fps，空闲 10fps）
    - 实现 hover opacity 过渡（0.4 → 0.85）
    - _Requirements: 9.1, 9.2, 9.4, 9.5_

  - [ ]* 8.2 编写 Minimap 视口矩形比例属性测试
    - **Property 11: Minimap viewport rectangle proportionality**
    - **Validates: Requirements 9.2**

  - [x] 8.3 实现 Minimap 点击/拖拽导航
    - 实现 click 事件：坐标映射到 world position，触发 canvas pan
    - 实现 drag 事件：持续拖拽更新视口位置
    - 实现坐标转换公式：`worldX = (mx / minimapWidth) * canvasWidth`
    - _Requirements: 9.3_

  - [ ]* 8.4 编写 Minimap 点击坐标映射属性测试
    - **Property 12: Minimap click-to-pan coordinate mapping**
    - **Validates: Requirements 9.3**

- [x] 9. 交互组件：Context Toolbar
  - [x] 9.1 实现 Context Toolbar 定位与显示逻辑
    - 在 `app.ts` 中创建 toolbar DOM 元素
    - 实现定位算法：toolbar 底部不超过节点顶部
    - 实现选中节点变化时的 100ms 重定位过渡
    - 实现无选中时的 fade-out 隐藏
    - 添加按钮：颜色选择、优先级切换、删除、AI 操作
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_

  - [ ]* 9.2 编写 Context Toolbar 非重叠定位属性测试
    - **Property 16: Context toolbar non-overlap positioning**
    - **Validates: Requirements 17.5**

- [x] 10. 交互组件：Toast 队列与 Guide Overlay
  - [x] 10.1 实现 Toast 队列管理器
    - 在 `app.ts` 中实现 toast 队列逻辑
    - 实现最多 3 条同时可见约束
    - 实现 2500ms 自动消失 + fade-out
    - 实现垂直堆叠布局（8px spacing）
    - 在删除、批量删除、粘贴操作后触发 toast
    - _Requirements: 15.1, 15.2, 15.3, 15.4_

  - [ ]* 10.2 编写 Toast 队列最大可见数属性测试
    - **Property 14: Toast queue maximum visibility**
    - **Validates: Requirements 15.4**

  - [ ]* 10.3 编写破坏性操作 Toast 触发属性测试
    - **Property 17: Toast on destructive operations**
    - **Validates: Requirements 15.1**

  - [x] 10.4 实现 Guide Overlay 组件
    - 实现空画布引导提示（仅 root 无子节点时显示）
    - 实现首次创建子节点后 300ms fade-out 并设置 session flag
    - 实现 Ctrl+/ 快捷键覆盖层（分类网格布局）
    - 实现 Escape/点击外部关闭（200ms fade-out）
    - 实现 i18n 本地化支持（中/英）
    - _Requirements: 12.1, 12.2, 12.3, 13.1, 13.2, 13.3, 13.4_

  - [ ]* 10.5 编写 Guide Overlay 可见性条件属性测试
    - **Property 13: Guide overlay visibility condition**
    - **Validates: Requirements 12.1**

- [x] 11. 集成与接线
  - [x] 11.1 将 UxEngine 集成到 MindMapApp
    - 在 `app.ts` 中实例化 `UxEngine`，传入 viewport update callback
    - 替换现有 zoom 逻辑为 `uxEngine.animateZoom()`
    - 替换现有 pan 结束逻辑为 `uxEngine.startInertia()`
    - 替换现有 fit-to-view 逻辑为 `uxEngine.animateFitToView()`
    - 确保 `destroy()` 在应用卸载时调用
    - _Requirements: 6.1, 6.2, 6.3, 7.1, 7.2, 7.3, 8.1_

  - [x] 11.2 实现 Inspector 默认折叠与节点删除 stagger 接线
    - 修改 Inspector 渲染逻辑，sections 默认 collapsed
    - 在节点删除流程中集成 stagger delay 计算
    - 在拖拽结束时集成 ease-out 归位动画
    - _Requirements: 3.2, 5.4, 18.1, 18.2, 18.3_

  - [ ]* 11.3 编写集成测试
    - 测试面板动画互斥在快速点击下的行为
    - 测试节点删除 DOM 保留时间
    - 测试 Guide overlay 在各种文档状态下的显示/隐藏
    - _Requirements: 1.3, 3.1, 12.1_

- [x] 12. Final checkpoint - 全部测试通过
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (17 properties total)
- Unit tests validate specific examples and edge cases
- 所有 CSS 动画仅使用 `transform` 和 `opacity` 以保持 GPU 合成层性能
- `prefers-reduced-motion` 在 CSS 层全局降级，JS 层通过 `matchMedia` 检测后跳过插值
- Minimap 使用独立 Canvas 2D，不影响主 DOM 树性能
- 用户提醒：受到C:\Users\qq237\Desktop\tem\code-mind\docs\project-graph项目启发而进行UX改进，不确定的部分可以参考对方的实现

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4"] },
    { "id": 1, "tasks": ["2.1", "2.3", "2.5", "2.6", "2.7", "2.8", "4.1"] },
    { "id": 2, "tasks": ["2.2", "2.4", "4.2", "4.3", "4.4", "4.5"] },
    { "id": 3, "tasks": ["4.6", "4.7", "6.1", "6.3", "6.6"] },
    { "id": 4, "tasks": ["4.8", "6.2", "6.4", "6.5", "6.7"] },
    { "id": 5, "tasks": ["8.1", "9.1", "10.1", "10.4"] },
    { "id": 6, "tasks": ["8.2", "8.3", "9.2", "10.2", "10.3", "10.5"] },
    { "id": 7, "tasks": ["8.4", "11.1"] },
    { "id": 8, "tasks": ["11.2", "11.3"] }
  ]
}
```
