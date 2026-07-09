import type { MindMapApp } from '../app'
import { runNodeGestureAction } from './commands'
import { childrenOf, createId, descendantIds, findRoot, touchDocument, visibleNodeIds } from '../document'
import { clamp, clampMin, normalizeClientRect, rectanglesIntersect } from '../utils'
import { estimateNodeHeight, estimateNodeWidth } from '../node-sizing'
import { MIN_NODE_HEIGHT, MIN_NODE_WIDTH } from '../node-render'
import {
  parseCubicBezierFromPath,
  parsePolylineFromPath,
  sampleCubicBezier,
  segmentIntersectsAABB,
  segmentIntersectsPolyline,
} from '../cutting-geometry'
import { resolveRelationEdgeEndpoints, buildRelationSegmentPath } from '../edge-geometry'
import { renderHeader, renderWorkspace } from '../render/shell'
import { renderOverlay, renderRegionDrawPreview } from '../render/overlay'
import { drawGraphScene } from '../render/graph'
import { scheduleAutosave } from '../sync/api-sync'
import * as ops from '../state/ops'
import type { NodeBounds } from '../ux-engine'
import type { CanvasDragAction, EdgeStyle, MindNode, Position, RegionBox } from '../types'
import type { DragState, MarqueeState } from '../app-types'
import { MAX_ZOOM, MIN_ZOOM } from '../app-types'

const DRAG_SNAP_THRESHOLD = 18
const GRAPH_ZOOM_SENSITIVITY = 0.0012
const NODE_LONG_PRESS_DELAY_MS = 520
const NODE_LONG_PRESS_MOVE_THRESHOLD = 10
const RELATION_HANDLE_LONG_PRESS_DELAY_MS = 320
const RELATION_HANDLE_MOVE_THRESHOLD = 8
const ZOOM_SENSITIVITY = 0.0018

export function handlePointerDown(app: MindMapApp, event: PointerEvent): void {
  const target = event.target
  const element = target instanceof Element ? target : null
  if (element && app.state.graph.open) {
    const graphCanvas = element.closest<HTMLCanvasElement>('[data-graph-canvas]')
    if (graphCanvas && event.button === 0) {
      app.graphDrag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startRotation: app.state.graph.rotation,
        startTilt: app.state.graph.tilt,
      }
      event.preventDefault()
      graphCanvas.setPointerCapture(event.pointerId)
      graphCanvas.classList.add('is-dragging')
      return
    }
  }

  if (app.state.view !== 'map' || app.overlayBlocksCanvas()) {
    return
  }

  if (!element) {
    return
  }

  if (element.closest('[data-node-editor]')) {
    return
  }

  // Context toolbar clicks must not start a canvas pan (which would set
  // suppressClickOnce and swallow the button's click event).
  if (element.closest('[data-context-toolbar]')) {
    return
  }

  // Handle connector dot long-press drag to create connection
  const connectorDot = element.closest<HTMLElement>('[data-node-connector]')
  if (connectorDot && event.button === 0) {
    const sourceNodeId = connectorDot.dataset.nodeConnector
    if (sourceNodeId) {
      app.state.connectorDrag = {
        sourceNodeId,
        pointerId: event.pointerId,
        currentClientX: event.clientX,
        currentClientY: event.clientY,
      }
      event.preventDefault()
      return
    }
  }

  // Handle parent connector dot drag (floating node → set parent)
  const parentConnectorDot = element.closest<HTMLElement>('[data-node-parent-connector]')
  if (parentConnectorDot && event.button === 0) {
    const childNodeId = parentConnectorDot.dataset.nodeParentConnector
    if (childNodeId) {
      app.state.parentConnectorDrag = {
        childNodeId,
        pointerId: event.pointerId,
        currentClientX: event.clientX,
        currentClientY: event.clientY,
      }
      event.preventDefault()
      return
    }
  }

  // Handle midpoint dot drag
  const midpointDot = (target instanceof SVGElement ? target : null)?.closest<SVGElement>('[data-midpoint-dot]')
  if (midpointDot && event.button === 0) {
    const relationId = midpointDot.getAttribute('data-midpoint-dot')
    if (relationId) {
      const originMidpoint = app.resolveRelationMidpointPosition(relationId)
      if (!originMidpoint) {
        return
      }
      app.state.midpointDrag = {
        relationId,
        pointerId: event.pointerId,
        mode: 'pending',
        startClientX: event.clientX,
        startClientY: event.clientY,
        currentClientX: event.clientX,
        currentClientY: event.clientY,
        originMidpoint,
        historyCaptured: false,
        longPressHandle: window.setTimeout(() => {
          if (
            app.state.midpointDrag?.relationId !== relationId ||
            app.state.midpointDrag.pointerId !== event.pointerId
          ) {
            return
          }
          if (app.state.midpointDrag.mode !== 'pending') {
            return
          }
          app.state.midpointDrag.mode = 'branch'
          app.setStatus('status.connectionBranchMode')
          renderWorkspace(app)
        }, RELATION_HANDLE_LONG_PRESS_DELAY_MS),
      }
      app.state.selectedRelationId = relationId
      event.preventDefault()
      return
    }
  }

  // Handle click on relation edge to select it
  const svgTarget = target instanceof SVGElement ? target : null
  const relationHit = svgTarget?.closest<SVGElement>('[data-relation-click]')
  if (relationHit && event.button === 0) {
    const relationId = relationHit.getAttribute('data-relation-click')
    if (relationId) {
      app.state.selectedRelationId = app.state.selectedRelationId === relationId ? null : relationId
      app.state.selectedNodeId = null
      app.state.selectedNodeIds = []
      app.state.selectedRegionId = null
      renderWorkspace(app)
      event.preventDefault()
      return
    }
  }

  // Handle region box resize
  const regionResizerEl = element.closest<HTMLElement>('[data-region-resizer]')
  if (regionResizerEl && event.button === 0) {
    const handle = regionResizerEl.dataset.regionResizer as import('../app-types').RegionResizeHandle
    const regionId = regionResizerEl.dataset.regionResizerId
    const region = regionId ? app.state.document.regions?.find((r) => r.id === regionId) : null
    if (region && handle) {
      app.selectRegion(region.id)
      app.state.regionResize = {
        regionId: region.id,
        handle,
        startX: event.clientX,
        startY: event.clientY,
        startCenterX: region.position.x,
        startCenterY: region.position.y,
        startWidth: region.width,
        startHeight: region.height,
        historyCaptured: false,
      }
      event.preventDefault()
      return
    }
  }

  // Handle region box drag
  const regionDragEl = element.closest<HTMLElement>('[data-region-drag]')
  if (regionDragEl && event.button === 0 && !app.state.regionDraw) {
    const regionId = regionDragEl.dataset.regionDrag
    const region = app.state.document.regions?.find((r) => r.id === regionId)
    if (region) {
      app.selectRegion(region.id)
      const docPos = app.clientToCanvasPosition(event.clientX, event.clientY)
      const nodesInRegion = app.nodesInRegion(region)
      const initialNodePositions: Record<string, Position> = {}
      for (const node of nodesInRegion) {
        initialNodePositions[node.id] = { ...node.position }
      }
      app.state.regionDrag = {
        regionId: region.id,
        offsetX: docPos.x - region.position.x,
        offsetY: docPos.y - region.position.y,
        initialPosition: { ...region.position },
        initialNodePositions,
        historyCaptured: false,
      }
      event.preventDefault()
      return
    }
  }

  // Handle region draw mode - left click starts drawing
  if (app.state.regionDraw && app.state.regionDraw.pointerId === -1 && event.button === 0) {
    const docPos = app.clientToCanvasPosition(event.clientX, event.clientY)
    app.state.regionDraw.pointerId = event.pointerId
    app.state.regionDraw.startCanvasX = docPos.x
    app.state.regionDraw.startCanvasY = docPos.y
    app.state.regionDraw.currentCanvasX = docPos.x
    app.state.regionDraw.currentCanvasY = docPos.y
    app.setStatus('status.regionDrawing')
    event.preventDefault()
    return
  }

  const nodeButton = element.closest<HTMLElement>('[data-node-button]')
  const nodeId = nodeButton?.dataset.nodeButton
  const longPressAction = app.longPressActionForButton(event.button)
  const keepPendingGesture = nodeId === app.pendingNodeGestureNodeId && event.detail >= 2
  if (!keepPendingGesture) {
    app.cancelPendingNodeGesture()
  }

  // Any canvas interaction dismisses the "what the AI just changed" highlight
  // (its other exit is the fade timer).
  if (element.closest('[data-workspace-scroll]')) {
    app.clearAIChangeHighlights()
  }

  if (event.button !== 0 && event.button !== 1 && event.button !== 2) {
    return
  }

  const resizeHandle = element.closest<HTMLElement>('[data-node-resizer]')
  const resizeNodeId = resizeHandle?.dataset.nodeResizer
  if (resizeNodeId) {
    if (event.button !== 0) {
      return
    }
    const node = app.findNode(resizeNodeId)
    if (!node || node.kind === 'root') {
      return
    }

    const childCount = childrenOf(app.state.document, node.id).length
    const currentWidth = node.width ?? estimateNodeWidth(node, childCount)
    const currentHeight = node.height ?? estimateNodeHeight(node, childCount, currentWidth)

    app.state.resize = {
      nodeId: resizeNodeId,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: currentWidth,
      startHeight: currentHeight,
      anchorLeft: node.position.x - currentWidth / 2,
      anchorTop: node.position.y - currentHeight / 2,
      historyCaptured: false,
    }
    event.preventDefault()
    return
  }

  if (element.closest('[data-node-collapse-button]') || element.closest('[data-node-note-badge]')) {
    event.preventDefault()
    return
  }

  if (event.shiftKey || event.ctrlKey || event.metaKey) {
    return
  }

  if (!nodeId) {
    app.clearNodeLongPress()
    const withinScroll = element.closest<HTMLElement>('[data-workspace-scroll]')
    if (!withinScroll) {
      return
    }

    const canvasAction = app.canvasDragActionForButton(event.button)
    if (canvasAction === 'none') {
      return
    }

    startCanvasDragAction(app, canvasAction, event)
    event.preventDefault()
    return
  }

  if (!app.state.selectedNodeIds.includes(nodeId)) {
    app.setSelection([nodeId], nodeId)
  }

  const node = app.findNode(nodeId)
  const selectedDragIds = app.state.selectedNodeIds.includes(nodeId) ? app.state.selectedNodeIds : [nodeId]
  const dragNodeIds = resolveDragNodeIds(app, selectedDragIds)

  if (event.detail >= 2) {
    app.clearNodeLongPress()
    return
  }

  if (
    !node ||
    (event.button === 0 && dragNodeIds.length === 0) ||
    app.state.editingNodeId === nodeId ||
    app.state.connectSourceNodeId !== null
  ) {
    app.clearNodeLongPress()
    return
  }

  if (longPressAction !== 'none') {
    armNodeLongPress(app, nodeId, dragNodeIds, event)
    event.preventDefault()
    return
  }

  app.clearNodeLongPress()
  if (event.button === 0) {
    startNodeDrag(app, nodeId, dragNodeIds, event)
  }
}

export function handlePointerMove(app: MindMapApp, event: PointerEvent): void {
  if (app.graphDrag && event.pointerId === app.graphDrag.pointerId) {
    const deltaX = event.clientX - app.graphDrag.startX
    const deltaY = event.clientY - app.graphDrag.startY
    app.state.graph.rotation = app.graphDrag.startRotation + deltaX * 0.0085
    app.state.graph.tilt = clamp(app.graphDrag.startTilt + deltaY * 0.0055, -1.1, 1.1)
    drawGraphScene(app)
    event.preventDefault()
    return
  }

  if (app.state.view !== 'map') {
    return
  }

  // Connector dot drag
  if (app.state.connectorDrag && event.pointerId === app.state.connectorDrag.pointerId) {
    app.state.connectorDrag.currentClientX = event.clientX
    app.state.connectorDrag.currentClientY = event.clientY
    renderWorkspace(app)
    event.preventDefault()
    return
  }

  // Parent connector dot drag
  if (app.state.parentConnectorDrag && event.pointerId === app.state.parentConnectorDrag.pointerId) {
    app.state.parentConnectorDrag.currentClientX = event.clientX
    app.state.parentConnectorDrag.currentClientY = event.clientY
    renderWorkspace(app)
    event.preventDefault()
    return
  }

  // Midpoint dot drag
  if (app.state.midpointDrag && event.pointerId === app.state.midpointDrag.pointerId) {
    app.state.midpointDrag.currentClientX = event.clientX
    app.state.midpointDrag.currentClientY = event.clientY
    const dragState = app.state.midpointDrag
    if (dragState.mode === 'pending') {
      const moved = Math.hypot(event.clientX - dragState.startClientX, event.clientY - dragState.startClientY)
      if (moved > RELATION_HANDLE_MOVE_THRESHOLD) {
        app.clearMidpointDragLongPress(dragState)
        dragState.mode = 'move'
      }
    }
    renderWorkspace(app)
    event.preventDefault()
    return
  }

  // Region draw mode
  if (
    app.state.regionDraw &&
    app.state.regionDraw.pointerId !== -1 &&
    event.pointerId === app.state.regionDraw.pointerId
  ) {
    const docPos = app.clientToCanvasPosition(event.clientX, event.clientY)
    app.state.regionDraw.currentCanvasX = docPos.x
    app.state.regionDraw.currentCanvasY = docPos.y
    renderRegionDrawPreview(app)
    event.preventDefault()
    return
  }

  // Region resize
  if (app.state.regionResize) {
    const rs = app.state.regionResize
    const scale = app.viewport.scale
    const dx = (event.clientX - rs.startX) / scale
    const dy = (event.clientY - rs.startY) / scale
    if (!rs.historyCaptured && (Math.abs(dx) > 1 || Math.abs(dy) > 1)) {
      ops.captureHistory(app)
      rs.historyCaptured = true
    }
    const MIN_REGION = 30
    const h = rs.handle
    let newW = rs.startWidth
    let newH = rs.startHeight
    let newCx = rs.startCenterX
    let newCy = rs.startCenterY
    // horizontal
    if (h === 'w' || h === 'nw' || h === 'sw') {
      newW = Math.max(MIN_REGION, rs.startWidth - dx)
      newCx = rs.startCenterX + (rs.startWidth - newW) / 2
    } else if (h === 'e' || h === 'ne' || h === 'se') {
      newW = Math.max(MIN_REGION, rs.startWidth + dx)
      newCx = rs.startCenterX + (newW - rs.startWidth) / 2
    }
    // vertical
    if (h === 'n' || h === 'nw' || h === 'ne') {
      newH = Math.max(MIN_REGION, rs.startHeight - dy)
      newCy = rs.startCenterY + (rs.startHeight - newH) / 2
    } else if (h === 's' || h === 'sw' || h === 'se') {
      newH = Math.max(MIN_REGION, rs.startHeight + dy)
      newCy = rs.startCenterY + (newH - rs.startHeight) / 2
    }
    const region = app.state.document.regions?.find((r) => r.id === rs.regionId)
    if (region) {
      region.width = Math.round(newW)
      region.height = Math.round(newH)
      region.position = { x: Math.round(newCx), y: Math.round(newCy) }
      region.updatedAt = new Date().toISOString()
      renderWorkspace(app)
    }
    event.preventDefault()
    return
  }

  // Region drag
  if (app.state.regionDrag) {
    const docPos = app.clientToCanvasPosition(event.clientX, event.clientY)
    const region = app.state.document.regions?.find((r) => r.id === app.state.regionDrag!.regionId)
    if (region) {
      const newRegionX = docPos.x - app.state.regionDrag.offsetX
      const newRegionY = docPos.y - app.state.regionDrag.offsetY
      if (
        !app.state.regionDrag.historyCaptured &&
        (Math.abs(newRegionX - region.position.x) > 0.5 || Math.abs(newRegionY - region.position.y) > 0.5)
      ) {
        ops.captureHistory(app)
        app.state.regionDrag.historyCaptured = true
      }
      const dx = newRegionX - app.state.regionDrag.initialPosition.x
      const dy = newRegionY - app.state.regionDrag.initialPosition.y
      region.position = { x: newRegionX, y: newRegionY }
      // Move contained nodes
      const movedNodeIds: string[] = []
      for (const [nodeId, initialPos] of Object.entries(app.state.regionDrag.initialNodePositions)) {
        const node = app.findNode(nodeId)
        if (node) {
          node.position = {
            x: initialPos.x + dx,
            y: initialPos.y + dy,
          }
          movedNodeIds.push(nodeId)
        }
      }
      app.applyLiveRegionDrag(region, movedNodeIds)
    }
    event.preventDefault()
    return
  }

  if (app.longPressState && event.pointerId === app.longPressState.pointerId) {
    app.longPressState.clientX = event.clientX
    app.longPressState.clientY = event.clientY
    if (
      !app.longPressState.activated &&
      Math.hypot(event.clientX - app.longPressState.startClientX, event.clientY - app.longPressState.startClientY) >
        NODE_LONG_PRESS_MOVE_THRESHOLD
    ) {
      const { nodeId, dragNodeIds, button } = app.longPressState
      const action = app.longPressActionForButton(button)
      app.clearNodeLongPress()
      if (action === 'pan-canvas') {
        if (button === 2) {
          app.suppressContextMenuOnce = true
        }
        startCanvasPan(app, event.pointerId, event.clientX, event.clientY)
      } else if (button === 0 && dragNodeIds.length > 0) {
        startNodeDrag(app, nodeId, dragNodeIds, event)
      }
    }
  }

  if (app.state.marquee && event.pointerId === app.state.marquee.pointerId) {
    app.state.marquee.currentClientX = event.clientX
    app.state.marquee.currentClientY = event.clientY
    if (!app.state.marquee.active) {
      const deltaX = event.clientX - app.state.marquee.startClientX
      const deltaY = event.clientY - app.state.marquee.startClientY
      if (Math.hypot(deltaX, deltaY) > 8) {
        app.state.marquee.active = true
        app.suppressClickOnce = true
      }
    }
    renderOverlay(app)
    if (app.state.marquee.active) {
      event.preventDefault()
    }
    return
  }

  // Cutting mode drag
  if (app.state.cutting && event.pointerId === app.state.cutting.pointerId) {
    updateCuttingLine(app, event.clientX, event.clientY)
    event.preventDefault()
    return
  }

  if (app.state.resize) {
    const resizeState = app.state.resize
    const deltaX = event.clientX - resizeState.startX
    const deltaY = event.clientY - resizeState.startY
    if (!resizeState.historyCaptured && (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1)) {
      ops.captureHistory(app)
      resizeState.historyCaptured = true
      renderHeader(app)
    }

    const nextWidth = clampMin(resizeState.startWidth + deltaX / app.viewport.scale, MIN_NODE_WIDTH)
    const nextHeight = clampMin(resizeState.startHeight + deltaY / app.viewport.scale, MIN_NODE_HEIGHT)

    app.updateNode(resizeState.nodeId, (node) => {
      node.width = Math.round(nextWidth)
      node.height = Math.round(nextHeight)
      node.position = {
        x: Math.round(resizeState.anchorLeft + nextWidth / 2),
        y: Math.round(resizeState.anchorTop + nextHeight / 2),
      }
    })
    app.scheduleLiveNodeUpdate(resizeState.nodeId, true)
    return
  }

  if (app.pan) {
    handleCanvasPan(app, event)
    return
  }

  if (!app.state.drag) {
    return
  }

  const pointerPosition = app.clientToCanvasPosition(event.clientX, event.clientY)
  const nextPosition = {
    x: pointerPosition.x - app.state.drag.offsetX,
    y: pointerPosition.y - app.state.drag.offsetY,
  }
  const currentNode = app.findNode(app.state.drag.nodeId)

  if (
    currentNode &&
    !app.state.drag.historyCaptured &&
    (Math.abs(nextPosition.x - currentNode.position.x) > 0.5 || Math.abs(nextPosition.y - currentNode.position.y) > 0.5)
  ) {
    ops.captureHistory(app)
    app.state.drag.historyCaptured = true
    renderHeader(app)
  }

  const anchorStart = app.state.drag.initialPositions[app.state.drag.nodeId]
  if (!anchorStart) {
    return
  }

  const rawDeltaX = nextPosition.x - anchorStart.x
  const rawDeltaY = nextPosition.y - anchorStart.y
  const { deltaX, deltaY } = app.state.preferences.interaction.dragSnap
    ? app.resolveSnappedDragDelta(app.state.drag, rawDeltaX, rawDeltaY)
    : { deltaX: rawDeltaX, deltaY: rawDeltaY }
  for (const candidateId of app.state.drag.nodeIds) {
    const candidateStart = app.state.drag.initialPositions[candidateId]
    if (!candidateStart) {
      continue
    }

    app.updateNode(candidateId, (node) => {
      node.position = {
        x: candidateStart.x + deltaX,
        y: candidateStart.y + deltaY,
      }
    })
    app.scheduleLiveNodeUpdate(candidateId)
  }

  // Update drop target highlights during drag
  updateDropTargetHighlights(app)

  // Update alignment guides during drag
  updateAlignmentGuides(app)
}

export function handlePointerUp(app: MindMapApp, event: PointerEvent): void {
  if (app.graphDrag && event.pointerId === app.graphDrag.pointerId) {
    const canvas = app.rootEl.querySelector<HTMLCanvasElement>('[data-graph-canvas]')
    canvas?.classList.remove('is-dragging')
    try {
      canvas?.releasePointerCapture(event.pointerId)
    } catch {
      // Ignore pointer capture release errors when the canvas is already gone.
    }
    app.graphDrag = null
    return
  }

  if (app.state.view !== 'map') {
    return
  }

  // Cancel cutting on pointercancel (not pointerup — executeCutting handles that)
  if (app.state.cutting && app.state.cutting.pointerId === event.pointerId && event.type === 'pointercancel') {
    app.cancelCutting()
    return
  }

  // Execute cutting on pointerup
  if (app.state.cutting && app.state.cutting.pointerId === event.pointerId && event.type === 'pointerup') {
    executeCutting(app)
    return
  }

  // Connector drag finish
  if (app.state.connectorDrag && event.pointerId === app.state.connectorDrag.pointerId) {
    const sourceNodeId = app.state.connectorDrag.sourceNodeId
    // Find target node at pointer position
    const target = document.elementFromPoint(event.clientX, event.clientY)
    const targetEl = target instanceof HTMLElement ? target : null
    const targetConnector = targetEl?.closest<HTMLElement>('[data-node-connector]')
    const targetButton = targetEl?.closest<HTMLElement>('[data-node-button]')
    const targetNodeId = targetConnector?.dataset.nodeConnector ?? targetButton?.dataset.nodeButton
    app.state.connectorDrag = null
    if (targetNodeId && targetNodeId !== sourceNodeId) {
      ops.createRelation(app, sourceNodeId, targetNodeId)
    } else {
      renderWorkspace(app)
    }
    return
  }

  // Parent connector drag finish (set parent for floating node)
  if (app.state.parentConnectorDrag && event.pointerId === app.state.parentConnectorDrag.pointerId) {
    const childNodeId = app.state.parentConnectorDrag.childNodeId
    const target = document.elementFromPoint(event.clientX, event.clientY)
    const targetEl = target instanceof HTMLElement ? target : null
    const targetConnector = targetEl?.closest<HTMLElement>('[data-node-connector]')
    const targetParentConnector = targetEl?.closest<HTMLElement>('[data-node-parent-connector]')
    const targetButton = targetEl?.closest<HTMLElement>('[data-node-button]')
    const targetNodeId =
      targetConnector?.dataset.nodeConnector ??
      targetButton?.dataset.nodeButton ??
      targetParentConnector?.dataset.nodeParentConnector
    app.state.parentConnectorDrag = null
    if (targetNodeId && targetNodeId !== childNodeId) {
      const childNode = app.findNode(childNodeId)
      if (childNode && childNode.kind === 'floating') {
        // Prevent circular reference: target must not be a descendant of the child node
        const childDescendants = descendantIds(app.state.document, childNodeId)
        if (childDescendants.includes(targetNodeId)) {
          app.setStatus('status.circularParentError')
          renderWorkspace(app)
          return
        }
        ops.captureHistory(app)
        childNode.kind = 'topic'
        childNode.parentId = targetNodeId
        touchDocument(app.state.document)
        app.setStatus('status.parentSet')
        scheduleAutosave(app, 'status.saved')
      }
    } else {
      renderWorkspace(app)
    }
    return
  }

  // Midpoint drag finish
  if (app.state.midpointDrag && event.pointerId === app.state.midpointDrag.pointerId) {
    const dragState = app.state.midpointDrag
    const relation = app.state.document.relations.find((r) => r.id === dragState.relationId)
    app.clearMidpointDragLongPress(dragState)
    app.state.midpointDrag = null
    if (!relation) {
      renderWorkspace(app)
      return
    }

    if (dragState.mode === 'branch') {
      const target = document.elementFromPoint(event.clientX, event.clientY)
      const targetEl = target instanceof HTMLElement ? target : null
      const targetConnector = targetEl?.closest<HTMLElement>('[data-node-connector]')
      const targetButton = targetEl?.closest<HTMLElement>('[data-node-button]')
      const targetNodeId = targetConnector?.dataset.nodeConnector ?? targetButton?.dataset.nodeButton ?? null
      if (targetNodeId) {
        ops.addBranchTargetToRelation(app, relation, targetNodeId)
      } else {
        renderWorkspace(app)
      }
      return
    }

    const moved = Math.hypot(event.clientX - dragState.startClientX, event.clientY - dragState.startClientY)
    if (dragState.mode === 'move' || moved > RELATION_HANDLE_MOVE_THRESHOLD) {
      app.moveRelationMidpoint(relation, app.clientToCanvasPosition(event.clientX, event.clientY))
    } else {
      renderWorkspace(app)
    }
    return
  }

  // Region draw finish
  if (
    app.state.regionDraw &&
    app.state.regionDraw.pointerId !== -1 &&
    event.pointerId === app.state.regionDraw.pointerId
  ) {
    const rd = app.state.regionDraw
    const x = Math.min(rd.startCanvasX, rd.currentCanvasX)
    const y = Math.min(rd.startCanvasY, rd.currentCanvasY)
    const w = Math.abs(rd.currentCanvasX - rd.startCanvasX)
    const h = Math.abs(rd.currentCanvasY - rd.startCanvasY)
    finishRegionDraw(app, x, y, w, h)
    return
  }

  // Region resize finish
  if (app.state.regionResize) {
    const wasResized = app.state.regionResize.historyCaptured
    app.state.regionResize = null
    if (wasResized) {
      touchDocument(app.state.document)
      renderWorkspace(app)
      scheduleAutosave(app, 'status.layoutSaveScheduled')
    }
    return
  }

  // Region drag finish
  if (app.state.regionDrag) {
    const wasMoved = app.state.regionDrag.historyCaptured
    app.state.regionDrag = null
    if (wasMoved) {
      touchDocument(app.state.document)
      renderWorkspace(app)
      scheduleAutosave(app, 'status.layoutSaveScheduled')
    }
    return
  }

  if (app.longPressState && event.pointerId === app.longPressState.pointerId) {
    app.clearNodeLongPress()
  }

  if (app.state.marquee && event.pointerId === app.state.marquee.pointerId) {
    const marquee = app.state.marquee
    app.state.marquee = null
    if (marquee.active) {
      applyMarqueeSelection(app, marquee)
      app.suppressContextMenuOnce = true
    }
    renderOverlay(app)
    return
  }

  if (app.pan) {
    // Start inertia if velocity is significant (> ~50px/s → ~0.83px/frame at 60fps)
    const speed = Math.hypot(app.pan.velocityX, app.pan.velocityY)
    if (speed > 0.83) {
      app.uxEngine.startInertia(app.pan.velocityX, app.pan.velocityY, {
        x: app.viewport.x,
        y: app.viewport.y,
        scale: app.viewport.scale,
      })
    }
    app.setCanvasPanning(false)
    app.pan = null
  }

  if (app.state.resize) {
    app.flushLiveNodeUpdate()
    const resized = app.state.resize.historyCaptured
    app.state.resize = null
    if (resized) {
      touchDocument(app.state.document)
      renderWorkspace(app)
      renderHeader(app)
      scheduleAutosave(app, 'status.layoutSaveScheduled')
    }
  }

  if (!app.state.drag) {
    return
  }

  app.flushLiveNodeUpdate()
  const moved = app.state.drag.historyCaptured

  // Remove dragging visual feedback classes and apply ease-out settle animation
  for (const dragId of app.state.drag.nodeIds) {
    const el = app.rootEl.querySelector<HTMLElement>(`[data-node-id="${dragId}"]`)
    if (el) {
      el.classList.remove('node-dragging')
      // Apply ease-out transition for smooth settle to final position
      el.style.transition = `transform 150ms var(--ease-out, cubic-bezier(0.33, 1, 0.68, 1))`
      // Remove the transition after it completes to avoid interfering with future interactions
      const cleanup = (): void => {
        el.style.transition = ''
      }
      el.addEventListener('transitionend', cleanup, { once: true })
      // Safety cleanup in case transitionend doesn't fire
      setTimeout(cleanup, 200)
    }
  }
  // Remove any drop target highlights
  app.clearDropTargetHighlights()
  // Remove alignment guides
  app.clearAlignmentGuides()

  app.state.drag = null
  if (moved) {
    touchDocument(app.state.document)
    renderWorkspace(app)
    renderHeader(app)
    scheduleAutosave(app, 'status.layoutSaveScheduled')
  }
}

export function handlePointerLeave(app: MindMapApp, _event: PointerEvent): void {
  if (app.state.cutting) {
    app.cancelCutting()
  }
}

export function handleWheel(app: MindMapApp, event: WheelEvent): void {
  const target = event.target
  if (app.state.graph.open && target instanceof HTMLElement) {
    const graphCanvas = target.closest<HTMLCanvasElement>('[data-graph-canvas]')
    if (graphCanvas) {
      event.preventDefault()
      const zoomFactor = Math.exp(-event.deltaY * GRAPH_ZOOM_SENSITIVITY)
      app.setGraphZoom(app.state.graph.zoom * zoomFactor)
      return
    }
  }

  if (app.state.view !== 'map' || app.overlayBlocksCanvas()) {
    return
  }

  const scroll = app.refs?.scroll
  if (!(target instanceof HTMLElement) || !target.closest('[data-workspace-scroll]') || !scroll) {
    return
  }

  event.preventDefault()

  const rect = scroll.getBoundingClientRect()
  const pointerX = event.clientX - rect.left
  const pointerY = event.clientY - rect.top
  const zoomFactor = Math.exp(-event.deltaY * ZOOM_SENSITIVITY)
  const targetScale = clamp(app.viewport.scale * zoomFactor, MIN_ZOOM, MAX_ZOOM)

  app.uxEngine.animateZoom(app.viewport.scale, targetScale, pointerX, pointerY, app.viewport.x, app.viewport.y)
}

/** Shortcut → toolbar button ref mapping (bijective: each shortcut maps to exactly one button) */

export function startNodeDrag(app: MindMapApp, nodeId: string, dragNodeIds: string[], event: PointerEvent): void {
  const node = app.findNode(nodeId)
  const canvas = app.refs?.canvas
  if (!node || !canvas) {
    return
  }

  const pointerPosition = app.clientToCanvasPosition(event.clientX, event.clientY)
  app.state.drag = {
    nodeId,
    nodeIds: dragNodeIds,
    offsetX: pointerPosition.x - node.position.x,
    offsetY: pointerPosition.y - node.position.y,
    initialPositions: Object.fromEntries(
      dragNodeIds
        .map((candidateId) => {
          const candidateNode = app.findNode(candidateId)
          if (!candidateNode) {
            return null
          }
          return [candidateId, { ...candidateNode.position }] as const
        })
        .filter((entry): entry is readonly [string, Position] => entry !== null),
    ),
    historyCaptured: false,
  }

  // Add dragging visual feedback class to all dragged nodes
  for (const dragId of dragNodeIds) {
    const el = app.rootEl.querySelector<HTMLElement>(`[data-node-id="${dragId}"]`)
    if (el) {
      el.classList.add('node-dragging')
    }
  }
}

export function resolveDragNodeIds(app: MindMapApp, baseNodeIds: string[]): string[] {
  const dragNodeIds: string[] = []
  const seen = new Set<string>()

  for (const baseNodeId of baseNodeIds) {
    const baseNode = app.findNode(baseNodeId)
    if (!baseNode || baseNode.kind === 'root' || seen.has(baseNodeId)) {
      continue
    }

    seen.add(baseNodeId)
    dragNodeIds.push(baseNodeId)

    if (!app.state.preferences.interaction.dragSubtreeWithParent) {
      continue
    }

    for (const descendantId of descendantIds(app.state.document, baseNodeId)) {
      const descendant = app.findNode(descendantId)
      if (!descendant || descendant.kind === 'root' || seen.has(descendantId)) {
        continue
      }

      seen.add(descendantId)
      dragNodeIds.push(descendantId)
    }
  }

  return dragNodeIds
}

export function resolveDragAxisSnap(
  app: MindMapApp,
  dragState: DragState,
  delta: number,
  axis: 'x' | 'y',
  draggedNodeIDs: Set<string>,
): number {
  let bestOffset: number | null = null

  for (const nodeId of dragState.nodeIds) {
    const start = dragState.initialPositions[nodeId]
    const node = app.findNode(nodeId)
    if (!start || !node) {
      continue
    }

    const currentValue = (axis === 'x' ? start.x : start.y) + delta
    for (const target of dragSnapTargetsForNode(app, node, axis, draggedNodeIDs)) {
      const offset = target - currentValue
      if (Math.abs(offset) > DRAG_SNAP_THRESHOLD) {
        continue
      }
      if (bestOffset === null || Math.abs(offset) < Math.abs(bestOffset)) {
        bestOffset = offset
      }
    }
  }

  return delta + (bestOffset ?? 0)
}

export function dragSnapTargetsForNode(
  app: MindMapApp,
  node: MindNode,
  axis: 'x' | 'y',
  draggedNodeIDs: Set<string>,
): number[] {
  const targets: number[] = []

  if (axis === 'x' && node.parentId) {
    const parent = app.findNode(node.parentId)
    if (parent) {
      const direction = node.position.x < parent.position.x ? -1 : 1
      const branchGap = Math.max(180, Math.abs(node.position.x - parent.position.x))
      targets.push(parent.position.x + direction * branchGap)
    }

    for (const sibling of childrenOf(app.state.document, node.parentId)) {
      if (sibling.id !== node.id && !draggedNodeIDs.has(sibling.id)) {
        targets.push(sibling.position.x)
      }
    }
  }

  for (const candidate of app.state.document.nodes) {
    if (draggedNodeIDs.has(candidate.id)) {
      continue
    }
    targets.push(axis === 'x' ? candidate.position.x : candidate.position.y)
  }

  return targets
}

export function updateAlignmentGuides(app: MindMapApp): void {
  // Remove existing guides first
  app.clearAlignmentGuides()

  if (!app.state.drag) {
    return
  }

  const draggedNode = app.findNode(app.state.drag.nodeId)
  if (!draggedNode) {
    return
  }

  const scroll = app.refs?.scroll
  if (!scroll) {
    return
  }

  // Compute dragged node bounds (position is center-based in this app)
  const draggedNodeIds = new Set(app.state.drag.nodeIds)
  const childCount = childrenOf(app.state.document, draggedNode.id).length
  const nodeWidth = draggedNode.width ?? estimateNodeWidth(draggedNode, childCount)
  const nodeHeight = draggedNode.height ?? estimateNodeHeight(draggedNode, childCount, nodeWidth)

  // Position in the app is center-based, so top-left = position - size/2
  const draggedPos = {
    x: draggedNode.position.x - nodeWidth / 2,
    y: draggedNode.position.y - nodeHeight / 2,
  }
  const draggedSize = { width: nodeWidth, height: nodeHeight }

  // Build other nodes bounds (excluding dragged nodes)
  const otherNodes: NodeBounds[] = []
  const visibleIds = visibleNodeIds(app.state.document)
  for (const nodeId of visibleIds) {
    if (draggedNodeIds.has(nodeId)) {
      continue
    }
    const node = app.findNode(nodeId)
    if (!node) {
      continue
    }
    const nChildCount = childrenOf(app.state.document, node.id).length
    const nWidth = node.width ?? estimateNodeWidth(node, nChildCount)
    const nHeight = node.height ?? estimateNodeHeight(node, nChildCount, nWidth)
    otherNodes.push({
      id: node.id,
      x: node.position.x - nWidth / 2,
      y: node.position.y - nHeight / 2,
      width: nWidth,
      height: nHeight,
    })
  }

  // Detect alignment
  const guides = app.uxEngine.detectAlignment(draggedPos, draggedSize, otherNodes)

  // Render guide DOM elements into the scroll container
  for (const guide of guides) {
    const el = document.createElement('div')
    el.classList.add('alignment-guide')
    if (guide.axis === 'x') {
      el.classList.add('alignment-guide--x')
      // Convert world X to screen position within the scroll container
      const screenX = (guide.position + app.workspaceBounds.originX) * app.viewport.scale + app.viewport.x
      el.style.left = `${screenX}px`
    } else {
      el.classList.add('alignment-guide--y')
      // Convert world Y to screen position within the scroll container
      const screenY = (guide.position + app.workspaceBounds.originY) * app.viewport.scale + app.viewport.y
      el.style.top = `${screenY}px`
    }
    el.setAttribute('data-alignment-guide', '')
    scroll.appendChild(el)
  }
}

export function updateDropTargetHighlights(app: MindMapApp): void {
  if (!app.state.drag) {
    return
  }

  const draggedNode = app.findNode(app.state.drag.nodeId)
  if (!draggedNode) {
    return
  }

  const draggedNodeIds = new Set(app.state.drag.nodeIds)
  const DROP_TARGET_DISTANCE = 40

  // Clear previous highlights
  app.clearDropTargetHighlights()

  // Check distance to all non-dragged nodes
  for (const node of app.state.document.nodes) {
    if (draggedNodeIds.has(node.id) || node.kind === 'root') {
      continue
    }

    const dx = draggedNode.position.x - node.position.x
    const dy = draggedNode.position.y - node.position.y
    const distance = Math.sqrt(dx * dx + dy * dy)

    if (distance <= DROP_TARGET_DISTANCE) {
      const el = app.rootEl.querySelector<HTMLElement>(`[data-node-id="${node.id}"]`)
      if (el) {
        el.classList.add('drop-target-highlight')
      }
    }
  }
}

export function handleCanvasPan(app: MindMapApp, event: PointerEvent): void {
  if (!app.pan || event.pointerId !== app.pan.pointerId) {
    return
  }

  const deltaX = event.clientX - app.pan.startX
  const deltaY = event.clientY - app.pan.startY
  event.preventDefault()
  app.viewport.x = app.pan.startViewportX + deltaX
  app.viewport.y = app.pan.startViewportY + deltaY
  app.uxEngine.syncViewport(app.viewport)
  app.updateCanvasViewportView()

  // Track velocity for inertia: compute instantaneous velocity in px/frame (~16.67ms)
  const now = performance.now()
  const dt = now - app.pan.lastMoveTime
  if (dt > 0) {
    const frameTime = 16.67 // ~60fps frame duration
    const moveDx = event.clientX - app.pan.lastClientX
    const moveDy = event.clientY - app.pan.lastClientY
    // Smooth velocity with exponential moving average
    const alpha = Math.min(1, dt / 100)
    app.pan.velocityX = app.pan.velocityX * (1 - alpha) + (moveDx / dt) * frameTime * alpha
    app.pan.velocityY = app.pan.velocityY * (1 - alpha) + (moveDy / dt) * frameTime * alpha
  }
  app.pan.lastClientX = event.clientX
  app.pan.lastClientY = event.clientY
  app.pan.lastMoveTime = now
}

export function startCanvasPan(app: MindMapApp, pointerId: number, clientX: number, clientY: number): void {
  // Cancel any ongoing inertia when a new pan gesture starts
  app.uxEngine.cancelInertia()

  app.pan = {
    pointerId,
    startX: clientX,
    startY: clientY,
    startViewportX: app.viewport.x,
    startViewportY: app.viewport.y,
    lastClientX: clientX,
    lastClientY: clientY,
    lastMoveTime: performance.now(),
    velocityX: 0,
    velocityY: 0,
  }
  app.setCanvasPanning(true)
}

export function startCanvasDragAction(app: MindMapApp, action: CanvasDragAction, event: PointerEvent): void {
  if (event.button === 2) {
    app.suppressContextMenuOnce = true
  }

  switch (action) {
    case 'pan-canvas':
      app.suppressClickOnce = true
      startCanvasPan(app, event.pointerId, event.clientX, event.clientY)
      return
    case 'marquee-select':
      startMarqueeSelection(app, event.pointerId, event.button, event.clientX, event.clientY)
      return
    case 'cutting':
      app.startCuttingMode(event.pointerId, event.clientX, event.clientY)
      return
    case 'none':
    default:
      return
  }
}

export function startMarqueeSelection(
  app: MindMapApp,
  pointerId: number,
  button: number,
  startClientX: number,
  startClientY: number,
  currentClientX = startClientX,
  currentClientY = startClientY,
): void {
  app.state.contextMenu = null
  app.state.marquee = {
    pointerId,
    button,
    startClientX,
    startClientY,
    currentClientX,
    currentClientY,
    active: Math.hypot(currentClientX - startClientX, currentClientY - startClientY) > 8,
  }
  renderOverlay(app)
}

export function applyMarqueeSelection(app: MindMapApp, marquee: MarqueeState): void {
  const selectionRect = normalizeClientRect(
    marquee.startClientX,
    marquee.startClientY,
    marquee.currentClientX,
    marquee.currentClientY,
  )
  const matchedIds = app.state.document.nodes
    .map((node) => {
      const element = app.rootEl.querySelector<HTMLElement>(`[data-node-id="${node.id}"]`)
      if (!element) {
        return null
      }

      return rectanglesIntersect(selectionRect, element.getBoundingClientRect()) ? node.id : null
    })
    .filter((nodeId): nodeId is string => Boolean(nodeId))

  if (matchedIds.length === 0) {
    app.render()
    return
  }

  app.setSelection(matchedIds, matchedIds[matchedIds.length - 1])
  app.render()
}

export function startRegionDraw(app: MindMapApp): void {
  app.state.contextMenu = null
  app.state.regionDraw = {
    pointerId: -1,
    startCanvasX: 0,
    startCanvasY: 0,
    currentCanvasX: 0,
    currentCanvasY: 0,
    color: 'blue',
  }
  app.refs?.scroll?.classList.add('is-region-drawing')
  app.setStatus('status.regionDrawHint')
  app.render()
}

export function finishRegionDraw(app: MindMapApp, x: number, y: number, w: number, h: number): void {
  if (w < 30 || h < 30) {
    app.state.regionDraw = null
    app.refs?.scroll?.classList.remove('is-region-drawing')
    app.render()
    return
  }
  if (!app.state.document.regions) {
    app.state.document.regions = []
  }
  const now = new Date().toISOString()
  const region: RegionBox = {
    id: createId('region'),
    label: '',
    color: app.state.regionDraw?.color ?? 'blue',
    position: { x: x + w / 2, y: y + h / 2 },
    width: w,
    height: h,
    createdAt: now,
    updatedAt: now,
  }
  ops.captureHistory(app)
  app.state.document.regions.push(region)
  app.state.regionDraw = null
  app.refs?.scroll?.classList.remove('is-region-drawing')
  touchDocument(app.state.document)
  app.setStatus('status.regionCreated')
  app.render()
  scheduleAutosave(app, 'status.relationSaveScheduled')
}

export function armNodeLongPress(app: MindMapApp, nodeId: string, dragNodeIds: string[], event: PointerEvent): void {
  app.clearNodeLongPress()
  app.longPressState = {
    pointerId: event.pointerId,
    nodeId,
    button: event.button,
    startClientX: event.clientX,
    startClientY: event.clientY,
    clientX: event.clientX,
    clientY: event.clientY,
    dragNodeIds,
    activated: false,
  }
  app.longPressHandle = window.setTimeout(() => {
    if (!app.longPressState || app.longPressState.nodeId !== nodeId) {
      return
    }
    const action = app.longPressActionForButton(app.longPressState.button)
    if (action === 'none') {
      app.clearNodeLongPress()
      return
    }
    app.longPressState.activated = true
    app.clearDropTargetHighlights()
    app.state.drag = null
    app.suppressClickOnce = true
    if (app.longPressState.button === 2) {
      app.suppressContextMenuOnce = true
    }
    void runNodeGestureAction(app, action, nodeId, {
      clientX: app.longPressState.clientX,
      clientY: app.longPressState.clientY,
      pointerId: app.longPressState.pointerId,
    })
  }, NODE_LONG_PRESS_DELAY_MS)
}

export function updateCuttingLine(app: MindMapApp, clientX: number, clientY: number): void {
  const cutting = app.state.cutting
  if (!cutting) {
    return
  }

  // Convert client coordinates to canvas coordinates and update current point
  const canvasPoint = app.clientToCanvasPosition(clientX, clientY)
  cutting.currentPoint = canvasPoint

  const startPoint = cutting.startPoint
  const endPoint = cutting.currentPoint

  // Convert cutting line to workspace coordinates for comparison with SVG paths
  // SVG paths are rendered in workspace coords (canvas coords + originX/originY offset)
  const wsStart = app.toWorkspacePosition(startPoint)
  const wsEnd = app.toWorkspacePosition(endPoint)

  // Clear warning sets for rebuild
  cutting.warningNodeIds.clear()
  cutting.warningHierarchyEdgeKeys.clear()
  cutting.warningRelationIds.clear()

  // Get visible node IDs (excludes collapsed hidden descendants)
  const visibleIds = visibleNodeIds(app.state.document)
  const root = findRoot(app.state.document)

  // --- Node intersection detection ---
  for (const node of app.state.document.nodes) {
    // Skip non-visible nodes
    if (!visibleIds.has(node.id)) {
      continue
    }
    // Skip root node (not cuttable)
    if (root && node.id === root.id) {
      continue
    }

    const childCount = childrenOf(app.state.document, node.id).length
    const metrics = app.resolveNodeRenderMetrics(node, childCount)
    const rectCenter = metrics.position
    const rectWidth = metrics.width
    const rectHeight = metrics.height

    if (segmentIntersectsAABB(startPoint, endPoint, rectCenter, rectWidth, rectHeight)) {
      cutting.warningNodeIds.add(node.id)
    }
  }

  // --- Hierarchy edge intersection detection ---
  if (app.refs?.edgeLayer) {
    const hierarchyPaths = app.refs.edgeLayer.querySelectorAll<SVGPathElement>('.edge-hierarchy')
    for (const pathEl of hierarchyPaths) {
      const sourceId = pathEl.getAttribute('data-source-id')
      const targetId = pathEl.getAttribute('data-target-id')
      if (!sourceId || !targetId) {
        continue
      }

      const d = pathEl.getAttribute('d')
      if (!d) {
        continue
      }

      // Try parsing as cubic Bézier (M...C... format)
      const bezier = parseCubicBezierFromPath(d)
      if (bezier) {
        const polyline = sampleCubicBezier(bezier.start, bezier.cp1, bezier.cp2, bezier.end, 16)
        if (segmentIntersectsPolyline(wsStart, wsEnd, polyline)) {
          cutting.warningHierarchyEdgeKeys.add(`${sourceId}::${targetId}`)
        }
      } else {
        // Fallback: parse as polyline (M...L...L... orthogonal format)
        const polyline = parsePolylineFromPath(d)
        if (polyline.length >= 2 && segmentIntersectsPolyline(wsStart, wsEnd, polyline)) {
          cutting.warningHierarchyEdgeKeys.add(`${sourceId}::${targetId}`)
        }
      }
    }
  }

  // --- Relation edge intersection detection ---
  // Compute intersection directly from document data (not DOM) to avoid parsing issues
  const edgeStyle = app.state.preferences.appearance.edgeStyle
  const drawEdgeStyle: EdgeStyle = edgeStyle === 'hidden' ? 'curve' : edgeStyle
  const childCountById = new Map(
    app.state.document.nodes.map((n) => [n.id, childrenOf(app.state.document, n.id).length]),
  )

  for (const relation of app.state.document.relations) {
    const source = app.findNode(relation.sourceId)
    const target = app.findNode(relation.targetId)
    if (!source || !target || !visibleIds.has(source.id) || !visibleIds.has(target.id)) {
      continue
    }

    const sourceMetrics = app.resolveNodeRenderMetrics(source, childCountById.get(source.id) ?? 0)
    const targetMetrics = app.resolveNodeRenderMetrics(target, childCountById.get(target.id) ?? 0)
    const edgePoints = resolveRelationEdgeEndpoints(sourceMetrics, targetMetrics)

    // Build the path string and parse it for intersection testing
    const pathD = buildRelationSegmentPath(
      app.toWorkspacePosition(edgePoints.source),
      app.toWorkspacePosition(edgePoints.target),
      drawEdgeStyle,
    )

    const bezier = parseCubicBezierFromPath(pathD)
    if (bezier) {
      const polyline = sampleCubicBezier(bezier.start, bezier.cp1, bezier.cp2, bezier.end, 16)
      if (segmentIntersectsPolyline(wsStart, wsEnd, polyline)) {
        cutting.warningRelationIds.add(relation.id)
        continue
      }
    } else {
      const polyline = parsePolylineFromPath(pathD)
      if (polyline.length >= 2 && segmentIntersectsPolyline(wsStart, wsEnd, polyline)) {
        cutting.warningRelationIds.add(relation.id)
        continue
      }
    }

    // Also check branch paths if the relation has midpoint/branches
    if (relation.midpointOffset || (relation.branches?.length ?? 0) > 0) {
      const midpointDoc = app.resolveRelationMidpointForEdge(relation, sourceMetrics, targetMetrics, drawEdgeStyle)
      const wsMid = app.toWorkspacePosition(midpointDoc)
      const wsSource = app.toWorkspacePosition(edgePoints.source)
      const wsTarget = app.toWorkspacePosition(edgePoints.target)

      // Check source-to-mid segment
      const pathSrcMid = buildRelationSegmentPath(wsSource, wsMid, drawEdgeStyle)
      const bezSrcMid = parseCubicBezierFromPath(pathSrcMid)
      if (bezSrcMid) {
        const poly = sampleCubicBezier(bezSrcMid.start, bezSrcMid.cp1, bezSrcMid.cp2, bezSrcMid.end, 16)
        if (segmentIntersectsPolyline(wsStart, wsEnd, poly)) {
          cutting.warningRelationIds.add(relation.id)
          continue
        }
      }

      // Check mid-to-target segment
      const pathMidTgt = buildRelationSegmentPath(wsMid, wsTarget, drawEdgeStyle)
      const bezMidTgt = parseCubicBezierFromPath(pathMidTgt)
      if (bezMidTgt) {
        const poly = sampleCubicBezier(bezMidTgt.start, bezMidTgt.cp1, bezMidTgt.cp2, bezMidTgt.end, 16)
        if (segmentIntersectsPolyline(wsStart, wsEnd, poly)) {
          cutting.warningRelationIds.add(relation.id)
          continue
        }
      }
    }
  }

  // Trigger re-render to show cutting line and warning highlights
  renderWorkspace(app)
}

export function executeCutting(app: MindMapApp): void {
  const cutting = app.state.cutting
  if (!cutting) {
    return
  }

  // If warning lists are all empty, just cancel without pushing history
  if (
    cutting.warningNodeIds.size === 0 &&
    cutting.warningHierarchyEdgeKeys.size === 0 &&
    cutting.warningRelationIds.size === 0
  ) {
    app.cancelCutting()
    return
  }

  // If cutting line has zero length (start === end), just cancel
  if (cutting.startPoint.x === cutting.currentPoint.x && cutting.startPoint.y === cutting.currentPoint.y) {
    app.cancelCutting()
    return
  }

  // Capture history snapshot BEFORE making any changes
  ops.captureHistory(app)

  // Capture originalParentIds snapshot before any mutations
  const originalParentIds = new Map<string, string | undefined>()
  for (const node of app.state.document.nodes) {
    originalParentIds.set(node.id, node.parentId)
  }

  const root = findRoot(app.state.document)

  // Phase 1: Delete all Relation Edges in the warning list
  if (cutting.warningRelationIds.size > 0) {
    app.state.document.relations = app.state.document.relations.filter(
      (relation) => !cutting.warningRelationIds.has(relation.id),
    )
  }

  // Phase 2: Sever all Hierarchy Edges in the warning list
  // Format of warningHierarchyEdgeKeys: "parentId::childId"
  for (const edgeKey of cutting.warningHierarchyEdgeKeys) {
    const separatorIndex = edgeKey.indexOf('::')
    if (separatorIndex === -1) continue
    const childId = edgeKey.substring(separatorIndex + 2)
    const childNode = app.state.document.nodes.find((n) => n.id === childId)
    if (childNode) {
      childNode.kind = 'floating'
      childNode.parentId = undefined
    }
  }

  // Phase 3: Delete all Nodes in the warning list (skip root)
  // First, promote children of nodes being deleted using originalParentIds
  const nodeIdsToDelete = new Set<string>()
  for (const nodeId of cutting.warningNodeIds) {
    // Skip root node
    if (root && nodeId === root.id) continue
    nodeIdsToDelete.add(nodeId)
  }

  // Promote children: reassign each child's parentId to the deleted node's original parentId
  for (const nodeId of nodeIdsToDelete) {
    const originalParentId = originalParentIds.get(nodeId)
    for (const node of app.state.document.nodes) {
      if (node.parentId === nodeId && !nodeIdsToDelete.has(node.id)) {
        node.parentId = originalParentId
        // If promoted to undefined (was a root-level child), make it floating
        if (!originalParentId) {
          node.kind = 'floating'
        }
      }
    }
  }

  // Remove the nodes
  if (nodeIdsToDelete.size > 0) {
    app.state.document.nodes = app.state.document.nodes.filter((node) => !nodeIdsToDelete.has(node.id))
    // Also clean up any relations that reference deleted nodes
    app.state.document.relations = app.state.document.relations
      .filter((relation) => !nodeIdsToDelete.has(relation.sourceId) && !nodeIdsToDelete.has(relation.targetId))
      .map((relation) => ({
        ...relation,
        branches: (relation.branches ?? []).filter((branch) => !nodeIdsToDelete.has(branch.targetId)),
      }))
  }

  // Mark document as modified
  touchDocument(app.state.document)

  // Clean up cutting state, restore cursor, and re-render
  app.cancelCutting()
  scheduleAutosave(app, 'status.saved')
}

export function handleInspectorPointerDown(app: MindMapApp, event: PointerEvent): void {
  if (!app.refs || window.innerWidth <= 980) {
    return
  }

  const target = event.target
  if (!(target instanceof HTMLElement)) {
    return
  }

  const inspector = app.refs.inspector

  // Resize handle
  if (target.closest('[data-inspector-resize]')) {
    event.preventDefault()
    event.stopPropagation()
    const rect = inspector.getBoundingClientRect()
    const stageRect = inspector.parentElement?.getBoundingClientRect()
    const currentWidth = rect.width
    const rightEdge = stageRect ? rect.right - stageRect.left : rect.right
    app.inspectorResizeActive = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: app.inspectorDrag.dragged ? app.inspectorDrag.width : currentWidth,
      rightEdge,
    }
    inspector.setPointerCapture(event.pointerId)
    return
  }

  // Drag via header or collapsed handle card
  const header = target.closest('.inspector-header') || target.closest('.inspector-handle-card')
  if (header && event.button === 0) {
    // Don't drag if clicking an interactive element inside the header
    // (buttons, and command-bearing labels like the collapsible section title)
    if (target.closest('button') || target.closest('[data-command]')) {
      return
    }
    event.preventDefault()
    event.stopPropagation()

    const rect = inspector.getBoundingClientRect()
    const stageRect = inspector.parentElement?.getBoundingClientRect()
    if (!stageRect) {
      return
    }

    const currentLeft = rect.left - stageRect.left
    const currentTop = rect.top - stageRect.top

    app.inspectorDragActive = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: app.inspectorDrag.dragged ? app.inspectorDrag.x : currentLeft,
      startTop: app.inspectorDrag.dragged ? app.inspectorDrag.y : currentTop,
    }
    inspector.setPointerCapture(event.pointerId)
  }
}

export function handleInspectorPointerMove(app: MindMapApp, event: PointerEvent): void {
  if (!app.refs) {
    return
  }

  const inspector = app.refs.inspector

  // Handle drag
  if (app.inspectorDragActive && event.pointerId === app.inspectorDragActive.pointerId) {
    const dx = event.clientX - app.inspectorDragActive.startX
    const dy = event.clientY - app.inspectorDragActive.startY
    app.inspectorDrag.x = app.inspectorDragActive.startLeft + dx
    app.inspectorDrag.y = app.inspectorDragActive.startTop + dy
    app.inspectorDrag.dragged = true

    if (!app.inspectorDrag.width || app.inspectorDrag.width < 240) {
      app.inspectorDrag.width = inspector.getBoundingClientRect().width
    }

    inspector.classList.add('is-dragged')
    inspector.style.left = `${app.inspectorDrag.x}px`
    inspector.style.top = `${app.inspectorDrag.y}px`
    inspector.style.right = 'auto'
    inspector.style.bottom = 'auto'
    inspector.style.width = `${app.inspectorDrag.width}px`
    return
  }

  // Handle resize
  if (app.inspectorResizeActive && event.pointerId === app.inspectorResizeActive.pointerId) {
    const dx = event.clientX - app.inspectorResizeActive.startX
    const newWidth = clamp(app.inspectorResizeActive.startWidth - dx, 240, 600)

    if (!app.inspectorDrag.dragged) {
      // Switch to dragged mode to allow explicit width
      const stageRect = inspector.parentElement?.getBoundingClientRect()
      if (stageRect) {
        const rect = inspector.getBoundingClientRect()
        app.inspectorDrag.y = rect.top - stageRect.top
        app.inspectorDrag.dragged = true
      }
    }

    // Right edge stays fixed, left edge moves
    app.inspectorDrag.width = newWidth
    app.inspectorDrag.x = app.inspectorResizeActive.rightEdge - newWidth

    syncInspectorDrag(app)
    return
  }
}

export function handleInspectorPointerUp(app: MindMapApp, event: PointerEvent): void {
  if (!app.refs) {
    return
  }

  if (app.inspectorDragActive && event.pointerId === app.inspectorDragActive.pointerId) {
    app.refs.inspector.releasePointerCapture(event.pointerId)
    app.inspectorDragActive = null
    return
  }

  if (app.inspectorResizeActive && event.pointerId === app.inspectorResizeActive.pointerId) {
    app.refs.inspector.releasePointerCapture(event.pointerId)
    app.inspectorResizeActive = null
    return
  }
}

export function syncInspectorDrag(app: MindMapApp): void {
  if (!app.refs) {
    return
  }

  const inspector = app.refs.inspector

  // On mobile, clear any drag state styles
  if (window.innerWidth <= 980) {
    inspector.classList.remove('is-dragged')
    inspector.style.left = ''
    inspector.style.right = ''
    inspector.style.bottom = ''
    inspector.style.width = ''
    return
  }

  // Ensure resize handle exists
  if (!inspector.querySelector('.inspector-resize-handle')) {
    const handle = document.createElement('div')
    handle.className = 'inspector-resize-handle'
    handle.dataset.inspectorResize = '1'
    inspector.insertBefore(handle, inspector.firstChild)
  }

  // Apply dragged state
  if (app.inspectorDrag.dragged) {
    inspector.classList.add('is-dragged')
    inspector.style.left = `${app.inspectorDrag.x}px`
    inspector.style.top = `${app.inspectorDrag.y}px`
    inspector.style.right = 'auto'
    inspector.style.bottom = 'auto'
    inspector.style.width = `${app.inspectorDrag.width}px`
  } else {
    inspector.classList.remove('is-dragged')
    inspector.style.left = ''
    inspector.style.right = ''
    inspector.style.bottom = ''
    inspector.style.width = ''
  }
}
