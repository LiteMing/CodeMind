# Implementation Plan: Edge Cutting (切除功能)

## Overview

实现切除功能，允许用户通过右键拖动在画布上产生切除线，实时检测与节点/连线的相交，松开时原子性执行删除操作。实现分为：纯几何计算模块 → 类型扩展 → 交互集成 → 渲染 → 执行逻辑 → 历史支持。

## Tasks

- [ ] 1. 创建几何计算模块 cutting-geometry.ts
  - [ ] 1.1 实现线段相交与 AABB 检测函数
    - 创建 `frontend/src/cutting-geometry.ts`
    - 实现 `segmentsIntersect(p1, p2, p3, p4)` — 两线段相交检测
    - 实现 `segmentIntersectsAABB(a, b, rectCenter, rectWidth, rectHeight)` — 线段与矩形相交
    - 使用参数化裁剪算法（Liang-Barsky 或等价方法）
    - _Requirements: 3.1_

  - [ ]* 1.2 Property test: AABB intersection correctness
    - **Property 1: Line-segment vs AABB intersection correctness**
    - 使用 fast-check 生成随机线段和随机矩形，验证 segmentIntersectsAABB 返回值与暴力采样一致
    - **Validates: Requirements 3.1**

  - [ ] 1.3 实现线段与折线相交检测
    - 实现 `segmentIntersectsPolyline(a, b, polyline)` — 线段与折线任意段相交
    - _Requirements: 4.1, 4.2_

  - [ ]* 1.4 Property test: Polyline intersection correctness
    - **Property 2: Line-segment vs polyline intersection correctness**
    - 使用 fast-check 生成随机线段和随机折线，验证 segmentIntersectsPolyline 等价于逐段调用 segmentsIntersect
    - **Validates: Requirements 4.1, 4.2**

  - [ ] 1.5 实现 Bézier 采样与 path 解析
    - 实现 `sampleCubicBezier(p0, cp1, cp2, p3, segments)` — 将三次 Bézier 曲线采样为折线
    - 实现 `parseCubicBezierFromPath(d)` — 解析 SVG path d 属性中的 M...C... 为控制点
    - _Requirements: 4.5_

  - [ ]* 1.6 Property test: Bézier sampling fidelity
    - **Property 3: Bézier sampling fidelity**
    - 使用 fast-check 生成随机控制点，验证采样点均在 Bézier 曲线上（浮点容差内），首尾点精确匹配
    - **Validates: Requirements 4.5**

- [ ] 2. 扩展类型系统与状态定义
  - [ ] 2.1 扩展 CanvasDragAction 类型并添加 CuttingState 接口
    - 在 `frontend/src/types.ts` 中将 `CanvasDragAction` 扩展为 `'none' | 'pan-canvas' | 'marquee-select' | 'cutting'`
    - 在 `frontend/src/app-types.ts`（或相应类型文件）中添加 `CuttingState` 接口定义
    - 在 AppState 中添加 `cutting: CuttingState | null` 字段
    - _Requirements: 1.1, 1.2_

  - [ ] 2.2 更新设置默认值
    - 将 `canvasRightDragAction` 默认值改为 `'cutting'`
    - 确保设置面板中用户仍可切换回 `'pan-canvas'` 或 `'marquee-select'`
    - _Requirements: 1.1_

- [ ] 3. Checkpoint - 确保类型编译通过
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. 实现切除模式交互逻辑
  - [ ] 4.1 实现进入切除模式 (startCuttingMode)
    - 在 `handlePointerDown` 中，当 `canvasRightDragAction === 'cutting'` 且点击在空白区域时，初始化 CuttingState
    - 记录 pointerId、起点坐标（转换为 canvas 坐标）
    - 设置 crosshair 光标
    - 抑制 contextmenu 事件
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ] 4.2 实现切除线更新与相交检测 (updateCuttingLine)
    - 在 `handlePointerMove` 中，当 cutting state active 时更新 currentPoint
    - 遍历所有可见节点，调用 `segmentIntersectsAABB` 检测节点相交
    - 遍历所有可见 hierarchy edges 和 relation edges，解析 path → 采样 → 调用 `segmentIntersectsPolyline`
    - 更新 warningNodeIds、warningHierarchyEdgeKeys、warningRelationIds
    - 排除 root 节点和折叠隐藏的后代节点
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ] 4.3 实现取消切除 (cancelCutting)
    - 监听 pointerleave / pointercancel 事件
    - 清空 CuttingState，恢复光标，不执行任何修改
    - _Requirements: 9.5_

- [ ] 5. 实现切除执行逻辑
  - [ ] 5.1 实现 executeCutting 方法
    - 在 `handlePointerUp` 中，当 cutting state active 时触发
    - 如果 Warning List 为空，直接退出切除模式，不推送历史
    - 如果切除线长度为 0（起点 === 终点），直接退出
    - 执行前捕获 originalParentIds 快照
    - Phase 1: 删除 Warning List 中的所有 Relation Edges
    - Phase 2: 断开 Warning List 中的所有 Hierarchy Edges（child.kind = 'floating', child.parentId = undefined）
    - Phase 3: 删除 Warning List 中的所有 Nodes（跳过 root），子节点使用 originalParentIds 提升
    - 推送单个历史快照（执行前状态）
    - 清空 CuttingState，恢复光标，触发重新渲染
    - _Requirements: 6.1, 6.2, 6.3, 7.1, 7.2, 8.1, 8.2, 8.3, 8.4, 8.5, 9.1, 9.2, 9.3, 9.4, 10.1, 10.3, 11.2, 11.3_

  - [ ]* 5.2 Property test: Hierarchy edge severing preserves invariants
    - **Property 4: Hierarchy edge severing preserves invariants**
    - 使用 fast-check 生成随机文档树，切除 hierarchy edge 后验证 child 变 floating、位置不变、其他节点不变
    - **Validates: Requirements 6.1, 6.2, 6.3**

  - [ ]* 5.3 Property test: Relation edge deletion preserves node invariants
    - **Property 5: Relation edge deletion preserves node invariants**
    - 使用 fast-check 生成随机文档和关系线，删除后验证节点属性不变
    - **Validates: Requirements 7.1, 7.2**

  - [ ]* 5.4 Property test: Node deletion with child promotion
    - **Property 6: Node deletion with child promotion**
    - 使用 fast-check 生成随机文档树，删除节点后验证子节点提升逻辑正确、位置不变、使用 originalParentIds
    - **Validates: Requirements 8.1, 8.2, 8.3, 11.3**

- [ ] 6. Checkpoint - 确保核心逻辑测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. 实现切除线渲染与高亮
  - [ ] 7.1 实现切除线 SVG 渲染 (renderCuttingLine)
    - 在 `renderEdges()` 末尾追加切除线 SVG `<line>` 元素
    - 使用红色虚线样式（stroke-dasharray），与普通边区分
    - 坐标从 CuttingState 的 startPoint/currentPoint 获取
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 7.2 实现 Warning 高亮样式
    - 为 Warning List 中的节点添加红色边框 CSS 类（如 `cutting-warning`）
    - 为 Warning List 中的 hierarchy/relation edges 添加红色 stroke 样式
    - 对象移出 Warning List 时立即恢复正常样式
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [ ] 8. 撤销/重做集成与历史验证
  - [ ] 8.1 验证历史快照集成
    - 确认 executeCutting 在执行前调用现有的 snapshot 机制（historyPast.push）
    - 确认 undo 操作能完整恢复切除前状态
    - 确认单次切除操作只产生一个历史条目
    - _Requirements: 10.1, 10.2, 10.3_

  - [ ]* 8.2 Property test: Cut-then-undo round trip
    - **Property 7: Cut-then-undo round trip**
    - 使用 fast-check 生成随机文档和随机切除目标，执行切除后 undo，验证文档恢复到原始状态
    - **Validates: Requirements 10.1, 10.2**

  - [ ]* 8.3 Property test: Atomic history — single snapshot per stroke
    - **Property 8: Atomic history — single snapshot per stroke**
    - 使用 fast-check 生成随机多目标切除，验证 history stack 只增长 1
    - **Validates: Requirements 10.1, 10.3**

- [ ] 9. Final checkpoint - 全部测试通过
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- 几何模块 (cutting-geometry.ts) 为纯函数，便于独立测试
- 交互逻辑集成到现有 app.ts 的 pointer event handlers 中
- 渲染集成到现有 renderEdges() 方法中

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.2"] },
    { "id": 2, "tasks": ["1.4", "1.5"] },
    { "id": 3, "tasks": ["1.6", "4.1"] },
    { "id": 4, "tasks": ["4.2", "4.3"] },
    { "id": 5, "tasks": ["5.1", "7.1"] },
    { "id": 6, "tasks": ["5.2", "5.3", "5.4", "7.2"] },
    { "id": 7, "tasks": ["8.1"] },
    { "id": 8, "tasks": ["8.2", "8.3"] }
  ]
}
```
