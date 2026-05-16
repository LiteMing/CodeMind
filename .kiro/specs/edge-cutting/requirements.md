# Requirements Document

## Introduction

切除功能（Edge Cutting）允许用户通过在画布空白处长按右键并拖动来产生一条切除线，实时检测与节点/连线的相交，松开右键时执行删除操作。切除连线时子节点变为自由节点（floating），切除节点时子节点向上提升一级。该功能参考 Project Graph 的 ControllerCutting 实现，适配 Code Mind 的节点类型（root/topic/floating）和连线类型（hierarchy edges/relation edges）。

## Glossary

- **Cutting_Mode**: 用户在画布空白处长按右键后进入的交互模式，拖动鼠标产生切除线
- **Cutting_Line**: 从鼠标按下起点到当前鼠标位置的直线段，用于检测与画布对象的相交
- **Canvas**: 思维导图的主画布区域，包含节点层（DOM）和连线层（SVG）
- **Node**: 思维导图中的节点元素，类型包括 root、topic、floating
- **Hierarchy_Edge**: 父子关系连线，由节点的 parentId 关系隐式定义，渲染为 SVG path
- **Relation_Edge**: 手动创建的关系连线，存储在 document.relations 数组中
- **Floating_Node**: kind 为 floating 的自由节点，无父子层级关系
- **Bounding_Box**: 节点的矩形碰撞区域，由节点 position、width、height 确定
- **Warning_List**: 切除线当前覆盖的对象集合，用于实时高亮显示即将被切除的目标
- **History**: 操作历史记录栈，支持撤销/重做

## Requirements

### Requirement 1: 进入切除模式

**User Story:** As a user, I want to enter cutting mode by long-pressing the right mouse button on an empty canvas area, so that I can start a cutting operation without accidentally triggering it on nodes or edges.

#### Acceptance Criteria

1. WHEN the user presses the right mouse button on an empty area of the Canvas (not on a Node, not on a Relation_Edge, not on a region box), THE Cutting_Mode SHALL activate and record the press position as the Cutting_Line start point
2. WHEN the user presses the right mouse button on a Node or a Relation_Edge or a region box, THE Cutting_Mode SHALL NOT activate
3. WHILE Cutting_Mode is active, THE Canvas SHALL display a crosshair cursor to indicate the cutting state
4. WHILE Cutting_Mode is active, THE Canvas SHALL suppress the default browser context menu on right-click release

### Requirement 2: 切除线渲染与更新

**User Story:** As a user, I want to see a visible cutting line from the start point to my current mouse position while dragging, so that I can aim precisely at the objects I want to cut.

#### Acceptance Criteria

1. WHILE Cutting_Mode is active, THE Canvas SHALL render the Cutting_Line as a visible straight line from the start point to the current mouse position
2. WHEN the mouse moves during Cutting_Mode, THE Cutting_Line endpoint SHALL update to the current mouse position in real time
3. THE Cutting_Line SHALL render in the SVG edge layer with a distinct visual style (dashed red line) to differentiate it from normal edges

### Requirement 3: 线段与节点相交检测

**User Story:** As a user, I want the system to detect when my cutting line crosses over nodes, so that I can see which nodes will be affected before releasing.

#### Acceptance Criteria

1. WHILE Cutting_Mode is active, THE Cutting_Mode SHALL detect intersection between the Cutting_Line and each visible Node Bounding_Box using line-segment vs. axis-aligned rectangle intersection testing
2. WHEN the Cutting_Line intersects a Node Bounding_Box, THE Cutting_Mode SHALL add that Node to the Warning_List
3. WHEN the Cutting_Line no longer intersects a previously warned Node Bounding_Box, THE Cutting_Mode SHALL remove that Node from the Warning_List
4. THE Cutting_Mode SHALL exclude collapsed (hidden) descendant nodes from intersection detection
5. THE Cutting_Mode SHALL exclude the root Node from intersection detection (root Node is not cuttable)

### Requirement 4: 线段与连线相交检测

**User Story:** As a user, I want the system to detect when my cutting line crosses over edges, so that I can see which connections will be severed before releasing.

#### Acceptance Criteria

1. WHILE Cutting_Mode is active, THE Cutting_Mode SHALL detect intersection between the Cutting_Line and each visible Hierarchy_Edge path
2. WHILE Cutting_Mode is active, THE Cutting_Mode SHALL detect intersection between the Cutting_Line and each visible Relation_Edge path
3. WHEN the Cutting_Line intersects an edge path, THE Cutting_Mode SHALL add that edge to the Warning_List
4. WHEN the Cutting_Line no longer intersects a previously warned edge path, THE Cutting_Mode SHALL remove that edge from the Warning_List
5. THE Cutting_Mode SHALL approximate SVG cubic Bézier curve paths as a series of line segments (polyline sampling) for intersection detection

### Requirement 5: 实时高亮警告

**User Story:** As a user, I want to see visual feedback on which objects will be cut before I release the mouse, so that I can confirm my intention or adjust the cutting line.

#### Acceptance Criteria

1. WHILE a Node is in the Warning_List, THE Canvas SHALL render that Node with a red border highlight to indicate pending deletion
2. WHILE a Hierarchy_Edge is in the Warning_List, THE Canvas SHALL render that edge path in red color to indicate pending severance
3. WHILE a Relation_Edge is in the Warning_List, THE Canvas SHALL render that edge path in red color to indicate pending severance
4. WHEN an object is removed from the Warning_List, THE Canvas SHALL restore that object to its normal visual style immediately

### Requirement 6: 切除 Hierarchy Edge 操作

**User Story:** As a user, I want to sever a parent-child connection by cutting through it, so that the child node becomes a free-floating node while keeping its position.

#### Acceptance Criteria

1. WHEN the user releases the right mouse button and a Hierarchy_Edge is in the Warning_List, THE Cutting_Mode SHALL remove the parent-child relationship by changing the child Node kind to floating and clearing its parentId
2. WHEN a Hierarchy_Edge is cut, THE child Node SHALL retain its current position and dimensions without any change
3. WHEN a Hierarchy_Edge is cut, THE parent Node and its remaining children SHALL remain unchanged in position and structure

### Requirement 7: 切除 Relation Edge 操作

**User Story:** As a user, I want to delete a relation line by cutting through it, so that I can quickly remove manual connections without opening a context menu.

#### Acceptance Criteria

1. WHEN the user releases the right mouse button and a Relation_Edge is in the Warning_List, THE Cutting_Mode SHALL delete that Relation_Edge from the document relations array
2. WHEN a Relation_Edge is cut, THE source Node and target Node of that relation SHALL remain unchanged in kind, position, and all other properties

### Requirement 8: 切除节点操作

**User Story:** As a user, I want to delete a node by cutting through it, so that its children are automatically promoted to the deleted node's parent rather than being orphaned.

#### Acceptance Criteria

1. WHEN the user releases the right mouse button and a topic Node is in the Warning_List, THE Cutting_Mode SHALL delete that Node from the document
2. WHEN a topic Node is cut, THE Cutting_Mode SHALL reassign each direct child of the deleted Node to the deleted Node's parentId (promote children one level up)
3. WHEN a topic Node is cut, THE promoted children SHALL retain their current positions and dimensions
4. WHEN a floating Node is in the Warning_List and is cut, THE Cutting_Mode SHALL delete that floating Node from the document (floating nodes have no children to promote)
5. IF a Node in the Warning_List is the root Node, THEN THE Cutting_Mode SHALL skip deletion of that Node and leave it unchanged

### Requirement 9: 切除操作完成与退出

**User Story:** As a user, I want the cutting operation to execute cleanly when I release the mouse button and return to normal mode, so that I can continue editing.

#### Acceptance Criteria

1. WHEN the user releases the right mouse button during Cutting_Mode, THE Cutting_Mode SHALL execute all pending cut operations (edges and nodes in the Warning_List) atomically
2. WHEN the cutting operation completes, THE Cutting_Mode SHALL deactivate and restore the default cursor
3. WHEN the cutting operation completes, THE Cutting_Line SHALL be removed from the Canvas
4. WHEN the cutting operation completes with at least one object cut, THE Cutting_Mode SHALL clear the Warning_List and re-render the Canvas to reflect the updated document state
5. IF the mouse leaves the browser window during Cutting_Mode, THEN THE Cutting_Mode SHALL cancel the operation, clear the Warning_List, and deactivate without executing any cuts

### Requirement 10: 撤销支持

**User Story:** As a user, I want to undo a cutting operation, so that I can recover accidentally severed connections or deleted nodes.

#### Acceptance Criteria

1. WHEN a cutting operation executes with at least one object affected, THE Cutting_Mode SHALL push a History snapshot of the document state before the cut to the undo stack
2. WHEN the user triggers undo after a cutting operation, THE History SHALL restore the document to the state before the cut, including all deleted nodes, edges, and their original properties
3. THE cutting operation History snapshot SHALL be a single atomic entry regardless of how many objects were cut in one stroke

### Requirement 11: 多对象同时切除

**User Story:** As a user, I want a single cutting stroke to sever multiple edges and delete multiple nodes at once, so that I can perform bulk operations efficiently.

#### Acceptance Criteria

1. WHEN the Cutting_Line intersects multiple edges and nodes simultaneously, THE Warning_List SHALL contain all intersected objects
2. WHEN the user releases the right mouse button, THE Cutting_Mode SHALL process all objects in the Warning_List: first delete Relation_Edges, then sever Hierarchy_Edges, then delete Nodes
3. THE Cutting_Mode SHALL process node deletions in a safe order: if a parent and child are both in the Warning_List, the child promotion logic SHALL use the original parentId values captured before any deletions in the current stroke
