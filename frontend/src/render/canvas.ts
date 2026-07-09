import type { MindMapApp } from '../app'
import { childrenOf, hiddenDescendantCount, visibleNodeIds } from '../document'
import { buildNodeColorStyle, normalizeNodeColor } from '../color-palette'
import { buildNodeDimensionStyle, nodeVisibleTitle, normalizeNodeNote } from '../node-render'
import { escapeAttribute, escapeHtml, shorten } from '../utils'
import {
  buildHierarchyPath,
  buildRelationSegmentPath,
  resolveHierarchyEdgeEndpoints,
  resolveNodeAnchorToward,
  resolveRelationEdgeEndpoints,
} from '../edge-geometry'
import type { EdgeStyle, Position } from '../types'

export function renderNodes(app: MindMapApp): string {
  const visibleIds = visibleNodeIds(app.state.document)
  const selectedIds = new Set(app.selectedNodeIds())
  const originX = app.workspaceBounds.originX
  const originY = app.workspaceBounds.originY

  return app.state.document.nodes
    .filter((node) => visibleIds.has(node.id))
    .map((node) => {
      const nodeColor = normalizeNodeColor(node.color)
      const isEditingNode = app.state.editingNodeId === node.id
      const preview = app.activeEditorPreview?.nodeId === node.id ? app.activeEditorPreview : null
      const autoWidthAnchorLeft = preview?.anchorLeft ?? app.activeEditorAnchorLeft
      const isAutoWidthEditingNode = isEditingNode && !node.width && autoWidthAnchorLeft !== null
      // Collapse takes precedence when a node is (transiently) in both
      // lifecycle maps — it is about to disappear.
      const isCollapsingNode = app.collapsingNodeIds.has(node.id)
      const classes = [
        'node-card',
        `node-${node.kind}`,
        nodeColor ? 'has-color' : '',
        isAutoWidthEditingNode ? 'is-editing-auto-width' : '',
        node.id === app.state.selectedNodeId ? 'is-selected' : '',
        selectedIds.has(node.id) && node.id !== app.state.selectedNodeId ? 'is-selected-secondary' : '',
        node.id === app.state.connectSourceNodeId ? 'is-connect-source' : '',
        node.collapsed ? 'is-collapsed' : '',
        app.creatingNodeIds.has(node.id) ? 'node-creating' : '',
        isCollapsingNode ? 'node-collapsing' : '',
        !isCollapsingNode && app.expandingNodeIds.has(node.id) ? 'node-expanding' : '',
        app.state.cutting?.warningNodeIds.has(node.id) ? 'cutting-warning' : '',
      ]
        .filter(Boolean)
        .join(' ')

      const priorityBadge = node.priority
        ? `<span class="priority-badge priority-${node.priority.toLowerCase()}">${node.priority}</span>`
        : ''

      const note = normalizeNodeNote(node.note)
      const noteBadge = note
        ? `<span class="node-note-badge" data-command="open-node-note:${escapeAttribute(node.id)}" data-node-note-badge="${escapeAttribute(node.id)}" role="button" title="${escapeAttribute(shorten(note, 120))}" aria-label="${escapeAttribute(app.t('node.noteBadge'))}">
             <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 3h8a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H8.5l-3 2.6a.55.55 0 0 1-.91-.42V11H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /></svg>
           </span>`
        : ''

      const childCount = childrenOf(app.state.document, node.id).length
      const branchBadge =
        childCount > 0
          ? `<span class="node-branch-badge">${node.collapsed ? `+${hiddenDescendantCount(app.state.document, node.id)}` : childCount}</span>`
          : ''
      const collapseLabel = node.collapsed ? app.t('action.expand') : app.t('action.collapse')

      const nodeDimensions = buildNodeDimensionStyle(
        node,
        preview ? { width: preview.width, height: preview.height } : undefined,
      )
      const nodePresentationStyle = buildNodeColorStyle(nodeColor)
      const anchorX = isAutoWidthEditingNode ? (autoWidthAnchorLeft ?? node.position.x) : node.position.x
      const lifecycleDelay = app.collapsingNodeIds.get(node.id) ?? app.expandingNodeIds.get(node.id)
      const lifecycleDelayStyle = lifecycleDelay !== undefined ? ` animation-delay: ${lifecycleDelay}ms;` : ''
      const articleStyle = `left: ${anchorX + originX}px; top: ${node.position.y + originY}px;${lifecycleDelayStyle} ${nodePresentationStyle}`
      const nodeId = escapeAttribute(node.id)

      const content = isEditingNode
        ? `<textarea class="node-editor" style="${nodeDimensions}" data-node-editor="${nodeId}" rows="1" spellcheck="false">${escapeHtml(
            node.title,
          )}</textarea>`
        : `<button type="button" class="node-shell" style="${nodeDimensions}" data-node-button="${nodeId}">
             ${priorityBadge}
             <span class="node-title" data-node-title="${nodeId}">${escapeHtml(nodeVisibleTitle(node))}</span>
             ${noteBadge}
             ${branchBadge}
           </button>`

      const resizeHandle =
        node.kind !== 'root'
          ? `<button type="button" class="node-resizer" data-node-resizer="${nodeId}" aria-label="Resize node"></button>`
          : ''
      const collapseButton =
        childCount > 0
          ? `<button
             type="button"
             class="node-collapse-button"
             data-node-collapse-button="${nodeId}"
             data-command="toggle-node-collapse:${nodeId}"
             aria-label="${escapeAttribute(collapseLabel)}"
             title="${escapeAttribute(collapseLabel)}"
           ></button>`
          : ''

      const connectorDot = `<button type="button" class="node-connector-dot" data-node-connector="${nodeId}" aria-label="Drag to connect"></button>`

      const parentConnectorDot =
        node.kind === 'floating'
          ? `<button type="button" class="node-parent-connector-dot" data-node-parent-connector="${nodeId}" aria-label="Drag to set parent"></button>`
          : ''

      return `
        <article
          class="${classes}"
          data-node-id="${nodeId}"
          style="${articleStyle}"
        >
          ${content}
          ${collapseButton}
          ${resizeHandle}
          ${connectorDot}
          ${parentConnectorDot}
        </article>
      `
    })
    .join('')
}

export function renderEdges(app: MindMapApp): string {
  const visibleIds = visibleNodeIds(app.state.document)
  const edgeStyle = app.state.preferences.appearance.edgeStyle
  const drawEdgeStyle: EdgeStyle = edgeStyle === 'hidden' ? 'curve' : edgeStyle
  const projectPosition = (position: Position) => app.toWorkspacePosition(position)
  const childCountById = new Map(
    app.state.document.nodes.map((node) => [node.id, childrenOf(app.state.document, node.id).length]),
  )

  // Arrow marker definitions
  const arrowDefs = `<defs>
    <marker id="arrow-forward" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto" markerUnits="strokeWidth">
      <path d="M 0 0 L 10 4 L 0 8 z" fill="var(--relation)" />
    </marker>
    <marker id="arrow-backward" markerWidth="10" markerHeight="8" refX="1" refY="4" orient="auto" markerUnits="strokeWidth">
      <path d="M 10 0 L 0 4 L 10 8 z" fill="var(--relation)" />
    </marker>
  </defs>`

  // Hierarchy edges (hidden when edge style is hidden)
  const hierarchyEdges =
    edgeStyle === 'hidden'
      ? ''
      : app.state.document.nodes
          .filter((node) => Boolean(node.parentId) && visibleIds.has(node.id) && visibleIds.has(node.parentId ?? ''))
          .map((node) => {
            const parent = app.findNode(node.parentId ?? '')
            if (!parent) {
              return ''
            }
            const edgePoints = resolveHierarchyEdgeEndpoints(
              app.resolveNodeRenderMetrics(parent, childCountById.get(parent.id) ?? 0),
              app.resolveNodeRenderMetrics(node, childCountById.get(node.id) ?? 0),
            )
            const warningClass = app.state.cutting?.warningHierarchyEdgeKeys.has(`${parent.id}::${node.id}`)
              ? ' cutting-warning'
              : ''
            const isCollapsingEdge = app.collapsingNodeIds.has(node.id) || app.collapsingNodeIds.has(parent.id)
            const lifecycleClass = isCollapsingEdge
              ? ' edge-collapsing'
              : app.expandingNodeIds.has(node.id) || app.expandingNodeIds.has(parent.id)
                ? ' edge-expanding'
                : ''
            return `<path class="edge edge-hierarchy${warningClass}${lifecycleClass}" data-source-id="${escapeAttribute(parent.id)}" data-target-id="${escapeAttribute(node.id)}" d="${buildHierarchyPath(projectPosition(edgePoints.source), projectPosition(edgePoints.target), drawEdgeStyle)}" />`
          })
          .join('')

  // Relation edges - always shown (even when hierarchy is hidden), with optional arrows and branches
  const relationEdges = app.state.document.relations
    .map((edge) => {
      const source = app.findNode(edge.sourceId)
      const target = app.findNode(edge.targetId)
      if (!source || !target || !visibleIds.has(source.id) || !visibleIds.has(target.id)) {
        return ''
      }

      const sourceMetrics = app.resolveNodeRenderMetrics(source, childCountById.get(source.id) ?? 0)
      const targetMetrics = app.resolveNodeRenderMetrics(target, childCountById.get(target.id) ?? 0)
      const edgePoints = resolveRelationEdgeEndpoints(sourceMetrics, targetMetrics)
      const projectedSource = projectPosition(edgePoints.source)
      const projectedTarget = projectPosition(edgePoints.target)
      const midpointDoc = app.resolveRelationMidpointForEdge(edge, sourceMetrics, targetMetrics, drawEdgeStyle)
      const mid = projectPosition(midpointDoc)
      const label = edge.label
        ? `<text class="relation-label" x="${mid.x}" y="${mid.y - 10}">${escapeHtml(edge.label)}</text>`
        : ''

      const midpointDrag = app.state.midpointDrag?.relationId === edge.id ? app.state.midpointDrag : null
      const isSelected = app.state.selectedRelationId === edge.id
      const selectedClass = isSelected ? ' is-selected' : ''
      const warningRelClass = app.state.cutting?.warningRelationIds.has(edge.id) ? ' cutting-warning' : ''
      const edgeId = escapeAttribute(edge.id)
      const arrowDir = edge.arrowDirection ?? 'none'
      const markerStart = arrowDir === 'backward' || arrowDir === 'both' ? ' marker-start="url(#arrow-backward)"' : ''
      const markerEnd = arrowDir === 'forward' || arrowDir === 'both' ? ' marker-end="url(#arrow-forward)"' : ''
      const usesMidpointHub =
        Boolean(edge.midpointOffset) ||
        (edge.branches?.length ?? 0) > 0 ||
        (edge.waypoints?.length ?? 0) > 0 ||
        midpointDrag?.mode === 'move' ||
        midpointDrag?.mode === 'branch'
      const mainPaths = usesMidpointHub
        ? [
            `<path class="edge edge-relation${selectedClass}${warningRelClass}" d="${buildRelationSegmentPath(projectedSource, mid, drawEdgeStyle)}"${markerStart} />`,
            `<path class="edge edge-relation${selectedClass}${warningRelClass}" d="${buildRelationSegmentPath(mid, projectedTarget, drawEdgeStyle)}"${markerEnd} />`,
          ]
        : [
            `<path class="edge edge-relation${selectedClass}${warningRelClass}" d="${buildRelationSegmentPath(projectedSource, projectedTarget, drawEdgeStyle)}"${markerStart}${markerEnd} />`,
          ]
      const hitSegments = usesMidpointHub
        ? [
            buildRelationSegmentPath(projectedSource, mid, drawEdgeStyle),
            buildRelationSegmentPath(mid, projectedTarget, drawEdgeStyle),
          ]
        : [buildRelationSegmentPath(projectedSource, projectedTarget, drawEdgeStyle)]
      const branchPaths: string[] = []

      for (const branch of edge.branches ?? []) {
        const branchNode = app.findNode(branch.targetId)
        if (!branchNode || !visibleIds.has(branchNode.id)) {
          continue
        }
        const branchMetrics = app.resolveNodeRenderMetrics(branchNode, childCountById.get(branchNode.id) ?? 0)
        const branchTarget = projectPosition(resolveNodeAnchorToward(branchMetrics, midpointDoc))
        const branchPath = buildRelationSegmentPath(mid, branchTarget, drawEdgeStyle)
        hitSegments.push(branchPath)
        branchPaths.push(
          `<path class="edge edge-relation edge-branch${selectedClass}${warningRelClass}" d="${branchPath}"${markerEnd} />`,
        )
      }

      let legacyWaypointLines = ''
      if (edge.waypoints && edge.waypoints.length > 0) {
        legacyWaypointLines = edge.waypoints
          .map((wp) => {
            const projectedWaypoint = projectPosition(wp)
            const path = buildRelationSegmentPath(mid, projectedWaypoint, drawEdgeStyle)
            hitSegments.push(path)
            return `<path class="edge edge-relation edge-branch${selectedClass}${warningRelClass}" d="${path}" />`
          })
          .join('')
      }

      const hitPath = `<path class="edge-hit-area${selectedClass}" data-relation-click="${edgeId}" d="${hitSegments.join(' ')}" />`

      // Midpoint dot for selected relation
      const midpointDot = isSelected
        ? `<circle class="edge-midpoint-dot" data-midpoint-dot="${edgeId}" cx="${mid.x}" cy="${mid.y}" r="6" />`
        : ''

      const branchPreview =
        midpointDrag?.mode === 'branch'
          ? (() => {
              const previewTarget = projectPosition(
                app.clientToCanvasPosition(midpointDrag.currentClientX, midpointDrag.currentClientY),
              )
              const previewPath = buildRelationSegmentPath(mid, previewTarget, drawEdgeStyle)
              return `<path class="edge edge-connector-drag edge-branch-preview" d="${previewPath}" />`
            })()
          : ''

      const branchTargetIds = (edge.branches ?? []).map((b) => b.targetId).join(' ')
      return `<g data-relation-id="${edgeId}" data-source-id="${escapeAttribute(edge.sourceId)}" data-target-id="${escapeAttribute(edge.targetId)}" data-branch-targets="${escapeAttribute(branchTargetIds)}">
        ${hitPath}
        ${mainPaths.join('')}
        ${branchPaths.join('')}
        ${legacyWaypointLines}
        ${label}
        ${midpointDot}
        ${branchPreview}
      </g>`
    })
    .join('')

  // Live connector drag line
  let connectorLine = ''
  if (app.state.connectorDrag) {
    const sourceNode = app.findNode(app.state.connectorDrag.sourceNodeId)
    if (sourceNode) {
      const sourceMetrics = app.resolveNodeRenderMetrics(sourceNode, childCountById.get(sourceNode.id) ?? 0)
      const projSource = projectPosition({
        x: sourceMetrics.position.x + sourceMetrics.width / 2,
        y: sourceMetrics.position.y - sourceMetrics.height / 2,
      })
      const canvasPos = app.clientToCanvas(
        app.state.connectorDrag.currentClientX,
        app.state.connectorDrag.currentClientY,
      )
      if (canvasPos) {
        connectorLine = `<line class="edge edge-connector-drag" x1="${projSource.x}" y1="${projSource.y}" x2="${canvasPos.x}" y2="${canvasPos.y}" />`
      }
    }
  }

  // Parent connector drag line (from floating node left side to mouse)
  let parentConnectorLine = ''
  if (app.state.parentConnectorDrag) {
    const childNode = app.findNode(app.state.parentConnectorDrag.childNodeId)
    if (childNode) {
      const childMetrics = app.resolveNodeRenderMetrics(childNode, childCountById.get(childNode.id) ?? 0)
      const projSource = projectPosition({
        x: childMetrics.position.x - childMetrics.width / 2,
        y: childMetrics.position.y,
      })
      const canvasPos = app.clientToCanvas(
        app.state.parentConnectorDrag.currentClientX,
        app.state.parentConnectorDrag.currentClientY,
      )
      if (canvasPos) {
        parentConnectorLine = `<line class="edge edge-connector-drag" x1="${projSource.x}" y1="${projSource.y}" x2="${canvasPos.x}" y2="${canvasPos.y}" />`
      }
    }
  }

  // Cutting line (red dashed line from start to current mouse position)
  let cuttingLine = ''
  if (app.state.cutting) {
    const start = projectPosition(app.state.cutting.startPoint)
    const end = projectPosition(app.state.cutting.currentPoint)
    cuttingLine = `<line class="cutting-line" x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" />`
  }

  return arrowDefs + hierarchyEdges + relationEdges + connectorLine + parentConnectorLine + cuttingLine
}
