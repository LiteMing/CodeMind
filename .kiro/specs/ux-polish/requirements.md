# Requirements Document

## Introduction

本文档定义 Code Mind 桌面应用的 UX 动效与交互体验改进需求。当前应用功能完整但动效几乎为零（仅 2 个 @keyframes 动画），目标是通过 CSS 动画、JS 插值和微交互反馈，让界面从"好看但不活"变为"好看且流畅"。

技术约束：
- 前端为 DOM 渲染（非 Canvas），基于 Vite + TypeScript
- 桌面端通过 Wails 打包，无需考虑移动端
- 所有动画时长应控制在 150ms–400ms 之间，避免拖慢操作节奏

## Glossary

- **Animation_Engine**: 负责管理和执行所有 CSS/JS 动画的前端模块
- **Canvas_Viewport**: 画布视口控制器，管理缩放、平移、惯性滚动等画布级交互
- **Node_Card**: 思维导图中的单个节点 DOM 元素及其视觉表现
- **Edge_Renderer**: 负责渲染和管理节点间连线（SVG path）的模块
- **Drag_Controller**: 管理节点拖拽行为的控制器，包括视觉反馈和对齐辅助
- **Panel_Manager**: 管理侧边面板（设置、AI、Inspector）打开/关闭行为的模块
- **Feedback_System**: 负责操作确认反馈（toast、脉冲动画、视觉闪烁）的系统
- **Guide_Overlay**: 空状态引导和快捷键提示覆盖层组件
- **Minimap**: 右下角小地图组件，显示全局节点分布和当前视口位置
- **Context_Toolbar**: 选中节点时在节点附近显示的浮动工具条

## Requirements

### Requirement 1: 面板打开/关闭动画

**User Story:** As a user, I want panels to slide in and out smoothly, so that the interface feels polished rather than jarring.

#### Acceptance Criteria

1. WHEN a side panel (settings, AI, or Inspector) is opened, THE Panel_Manager SHALL animate the panel from off-screen to its final position using a slide-in transition lasting between 200ms and 300ms.
2. WHEN a side panel is closed, THE Panel_Manager SHALL animate the panel from its current position to off-screen using a slide-out transition lasting between 150ms and 250ms.
3. WHILE a panel animation is in progress, THE Panel_Manager SHALL prevent additional open/close triggers on the same panel until the current animation completes.
4. THE Panel_Manager SHALL apply an opacity fade (0 to 1 for open, 1 to 0 for close) concurrently with the slide transition.

### Requirement 2: 节点创建动画

**User Story:** As a user, I want newly created nodes to appear with a smooth animation, so that I can visually track where new content is added.

#### Acceptance Criteria

1. WHEN a node is created via keyboard shortcut (Tab or Enter), THE Node_Card SHALL appear with a combined scale-up (from 0.85 to 1.0) and fade-in (opacity 0 to 1) animation lasting between 200ms and 300ms.
2. WHEN a node is created via API (external agent), THE Node_Card SHALL use the existing `nodeAppear` animation.
3. THE Animation_Engine SHALL use an ease-out timing function for node creation animations.

### Requirement 3: 节点删除动画

**User Story:** As a user, I want deleted nodes to disappear with a shrink-and-fade animation, so that I can confirm which nodes were removed.

#### Acceptance Criteria

1. WHEN a node is deleted, THE Node_Card SHALL play a scale-down (from 1.0 to 0.8) and fade-out (opacity 1 to 0) animation lasting between 150ms and 250ms before DOM removal.
2. WHEN multiple nodes are deleted simultaneously (subtree deletion), THE Animation_Engine SHALL stagger the removal animations by 30ms–50ms per node in depth-first order.
3. IF a node deletion animation is interrupted by an undo operation, THEN THE Animation_Engine SHALL cancel the animation and restore the node to full opacity and scale immediately.

### Requirement 4: 折叠/展开动画

**User Story:** As a user, I want branch collapse and expand to animate smoothly, so that I can track the structural change visually.

#### Acceptance Criteria

1. WHEN a branch is collapsed, THE Node_Card children SHALL animate with a combined fade-out (opacity 1 to 0) and vertical slide (translate toward parent) lasting between 200ms and 350ms.
2. WHEN a branch is expanded, THE Node_Card children SHALL animate with a combined fade-in (opacity 0 to 1) and vertical slide (from parent position to final position) lasting between 200ms and 350ms.
3. WHILE a collapse/expand animation is in progress, THE Edge_Renderer SHALL smoothly interpolate the connecting edges to follow the animating child nodes.

### Requirement 5: 拖拽视觉增强

**User Story:** As a user, I want enhanced visual feedback during drag operations, so that I can precisely position nodes and understand drop targets.

#### Acceptance Criteria

1. WHEN a node drag operation begins, THE Drag_Controller SHALL increase the dragged node's box-shadow depth and apply a subtle scale-up (1.02x) within 100ms.
2. WHILE a node is being dragged, THE Drag_Controller SHALL display alignment guide lines (horizontal and vertical) when the dragged node's center aligns within 5px of another node's center or edge.
3. WHILE a node is being dragged within 40px of a potential parent node, THE Drag_Controller SHALL highlight the target node's border with the accent color.
4. WHEN a node drag operation ends, THE Drag_Controller SHALL animate the node to its final position with an ease-out transition lasting between 100ms and 200ms.
5. THE Drag_Controller SHALL render alignment guide lines as 1px dashed lines using the accent color at 50% opacity.

### Requirement 6: 缩放平滑插值

**User Story:** As a user, I want canvas zoom to interpolate smoothly, so that the zoom experience feels natural rather than stepped.

#### Acceptance Criteria

1. WHEN a zoom operation is triggered (scroll wheel or shortcut), THE Canvas_Viewport SHALL interpolate from the current scale to the target scale using an ease-out-cubic timing function over 150ms–200ms.
2. THE Canvas_Viewport SHALL maintain the zoom center point (mouse cursor position for scroll, viewport center for shortcuts) throughout the interpolation.
3. WHILE a zoom interpolation is in progress and a new zoom input is received, THE Canvas_Viewport SHALL retarget the animation to the new target scale without restarting from the beginning.

### Requirement 7: 惯性滚动

**User Story:** As a user, I want canvas panning to have inertia, so that navigation feels fluid and natural.

#### Acceptance Criteria

1. WHEN a canvas pan gesture ends with velocity greater than 50px/s, THE Canvas_Viewport SHALL continue panning with decelerating velocity (friction coefficient between 0.92 and 0.96 per frame).
2. WHEN inertial panning velocity drops below 0.5px/frame, THE Canvas_Viewport SHALL stop the inertia animation.
3. WHEN the user initiates a new pan gesture during inertial scrolling, THE Canvas_Viewport SHALL immediately cancel the inertia and respond to the new gesture.

### Requirement 8: Fit-to-View 动画

**User Story:** As a user, I want the fit-to-view action to animate smoothly to the target viewport, so that I maintain spatial context during the transition.

#### Acceptance Criteria

1. WHEN the fit-to-view action is triggered, THE Canvas_Viewport SHALL animate both position and scale from the current viewport to the computed target viewport over 300ms–500ms using an ease-in-out timing function.
2. THE Canvas_Viewport SHALL compute the target viewport to include all visible nodes with 60px padding on each side.
3. IF no nodes exist on the canvas, THEN THE Canvas_Viewport SHALL animate to the default viewport (center, scale 1.0).

### Requirement 9: Minimap

**User Story:** As a user, I want a minimap showing the full graph and my current viewport position, so that I can navigate large maps efficiently.

#### Acceptance Criteria

1. THE Minimap SHALL render a simplified representation of all nodes as small rectangles in the bottom-right corner of the canvas area.
2. THE Minimap SHALL display the current viewport as a semi-transparent rectangle overlay proportional to the visible area.
3. WHEN the user clicks or drags within the Minimap, THE Canvas_Viewport SHALL pan to the corresponding position on the canvas.
4. THE Minimap SHALL have a fixed size of 180px × 120px and an opacity of 0.85, fading to 0.4 opacity when not hovered.
5. WHEN the canvas content changes (node added, moved, or deleted), THE Minimap SHALL update its representation within 100ms.

### Requirement 10: 节点编辑态过渡

**User Story:** As a user, I want entering and exiting edit mode on a node to have a smooth transition, so that the mode change is visually clear.

#### Acceptance Criteria

1. WHEN a node enters edit mode (double-click or F2/Space), THE Node_Card SHALL apply a subtle border highlight animation and a scale-up to 1.01x over 150ms.
2. WHEN a node exits edit mode, THE Node_Card SHALL animate back to its default border and scale over 150ms.
3. WHILE a node is in edit mode and its content causes a size change, THE Node_Card SHALL animate the width/height transition over 100ms–200ms.

### Requirement 11: 连线交互增强

**User Story:** As a user, I want edge hover and creation to have smooth visual transitions, so that connection interactions feel responsive.

#### Acceptance Criteria

1. WHEN the cursor hovers over an edge, THE Edge_Renderer SHALL transition the edge stroke-width from its default to 1.5x and opacity to 1.0 over 150ms.
2. WHEN the cursor leaves an edge, THE Edge_Renderer SHALL transition back to default stroke-width and opacity over 150ms.
3. WHEN a new edge is created, THE Edge_Renderer SHALL animate the edge path using a stroke-dashoffset "grow" animation from source to target over 250ms–350ms.

### Requirement 12: 空画布引导提示

**User Story:** As a user opening an empty canvas, I want to see guidance on how to get started, so that I can begin working without consulting documentation.

#### Acceptance Criteria

1. WHEN the canvas contains only the root node and no children, THE Guide_Overlay SHALL display a semi-transparent centered hint with key actions (e.g., "按 Tab 创建子节点").
2. WHEN the user creates the first child node, THE Guide_Overlay SHALL fade out over 300ms and not reappear for the current session.
3. THE Guide_Overlay SHALL be localized according to the current language setting (Chinese or English).

### Requirement 13: 快捷键覆盖层

**User Story:** As a user, I want to view all available shortcuts in an overlay, so that I can discover and learn keyboard shortcuts without leaving the editor.

#### Acceptance Criteria

1. WHEN the user presses Ctrl+/ (or Cmd+/ on macOS), THE Guide_Overlay SHALL display a full-screen semi-transparent overlay listing all available keyboard shortcuts grouped by category.
2. WHEN the user presses Escape or clicks outside the overlay, THE Guide_Overlay SHALL dismiss the overlay with a fade-out animation over 200ms.
3. THE Guide_Overlay SHALL display shortcuts in a grid layout with key combination on the left and description on the right.
4. THE Guide_Overlay SHALL be localized according to the current language setting.

### Requirement 14: 保存反馈动画

**User Story:** As a user, I want visual confirmation when a save operation completes, so that I know my work is persisted.

#### Acceptance Criteria

1. WHEN a save operation completes successfully, THE Feedback_System SHALL display a brief pulse animation on the save indicator lasting 400ms.
2. IF a save operation fails, THEN THE Feedback_System SHALL display the save indicator in an error color (red) with a shake animation lasting 300ms.

### Requirement 15: 操作确认 Toast

**User Story:** As a user, I want lightweight toast notifications for destructive or batch operations, so that I receive confirmation of what just happened.

#### Acceptance Criteria

1. WHEN a destructive operation completes (delete, batch delete, paste), THE Feedback_System SHALL display a toast notification at the bottom-center of the viewport.
2. THE Feedback_System SHALL animate the toast with a slide-up and fade-in entrance over 200ms.
3. THE Feedback_System SHALL auto-dismiss the toast after 2500ms with a fade-out animation over 200ms.
4. WHILE multiple toasts are queued, THE Feedback_System SHALL stack them vertically with 8px spacing, displaying a maximum of 3 toasts simultaneously.

### Requirement 16: 按键视觉反馈

**User Story:** As a user, I want toolbar buttons to briefly highlight when their corresponding shortcut is pressed, so that I can associate shortcuts with their actions.

#### Acceptance Criteria

1. WHEN a keyboard shortcut is activated, THE Feedback_System SHALL apply a brief highlight animation (background flash) to the corresponding toolbar button lasting 200ms.
2. THE Feedback_System SHALL use the accent color at 30% opacity for the highlight flash.

### Requirement 17: 节点上下文浮动工具条

**User Story:** As a user, I want a floating toolbar near selected nodes for quick actions, so that I can perform common operations without opening the Inspector panel.

#### Acceptance Criteria

1. WHEN a single node is selected, THE Context_Toolbar SHALL appear above the selected node with a fade-in and slight upward slide animation over 150ms.
2. THE Context_Toolbar SHALL provide buttons for: color selection, priority toggle, delete, and AI actions.
3. WHEN the node selection changes, THE Context_Toolbar SHALL reposition to the newly selected node with a 100ms transition.
4. WHEN no node is selected, THE Context_Toolbar SHALL fade out over 100ms.
5. THE Context_Toolbar SHALL not overlap with the selected node's content area.

### Requirement 18: Inspector 默认折叠

**User Story:** As a user, I want the Inspector panel to show only essential information by default, so that the canvas area is maximized and visual clutter is reduced.

#### Acceptance Criteria

1. THE Panel_Manager SHALL render the Inspector panel with sections (relations, snapshots, advanced properties) collapsed by default, showing only the node title and priority.
2. WHEN a user clicks a section header in the Inspector, THE Panel_Manager SHALL expand that section with a smooth height transition over 200ms.
3. WHEN a user clicks an expanded section header, THE Panel_Manager SHALL collapse that section with a smooth height transition over 200ms.
