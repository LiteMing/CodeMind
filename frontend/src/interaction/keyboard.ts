import type { MindMapApp } from '../app'
import { runNodeGestureAction } from './commands'
import { visibleNodeIds } from '../document'
import { directionalCrossDelta, directionalPrimaryDelta, isTypingTarget, nodeCenter } from '../utils'
import { renderWorkspace } from '../render/shell'
import { saveDocument } from '../sync/api-sync'
import * as editor from '../interaction/editor'
import * as ops from '../state/ops'
import type { MindNode } from '../types'

export function handleGlobalKeyDown(app: MindMapApp, event: KeyboardEvent): void {
  if (event.key === 'Escape' && app.state.guideOverlay.shortcutOverlayVisible) {
    event.preventDefault()
    app.hideShortcutOverlay()
    return
  }

  if (event.key === 'Escape' && app.state.settingsOpen) {
    event.preventDefault()
    app.closeSettings()
    return
  }

  if (event.key === 'Escape' && app.state.editingNodeId) {
    event.preventDefault()
    editor.cancelNodeEditor(app)
    return
  }

  const activeTypingTarget = isTypingTarget(document.activeElement)
  if (
    app.state.view !== 'map' ||
    app.onboardingOpen() ||
    app.state.settingsOpen ||
    isTypingTarget(event.target) ||
    activeTypingTarget
  ) {
    return
  }

  if ((event.ctrlKey || event.metaKey) && event.key === '/') {
    event.preventDefault()
    if (app.state.guideOverlay.shortcutOverlayVisible) {
      app.hideShortcutOverlay()
    } else {
      app.showShortcutOverlay()
    }
    return
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    flashToolbarButton(app, event)
    void saveDocument(app, 'status.saved')
    return
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
    event.preventDefault()
    flashToolbarButton(app, event)
    ops.undo(app)
    return
  }

  if (
    (event.ctrlKey || event.metaKey) &&
    ((event.key.toLowerCase() === 'y' && !event.shiftKey) || (event.key.toLowerCase() === 'z' && event.shiftKey))
  ) {
    event.preventDefault()
    flashToolbarButton(app, event)
    ops.redo(app)
    return
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
    event.preventDefault()
    flashToolbarButton(app, event)
    ops.autoLayout(app)
    return
  }

  if ((event.ctrlKey || event.metaKey) && (event.key === '=' || event.key === '+')) {
    event.preventDefault()
    app.zoomBy(1.25)
    return
  }

  if ((event.ctrlKey || event.metaKey) && event.key === '-') {
    event.preventDefault()
    app.zoomBy(0.8)
    return
  }

  if ((event.ctrlKey || event.metaKey) && event.key === '0') {
    event.preventDefault()
    app.zoomReset()
    return
  }

  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'c') {
    event.preventDefault()
    ops.copySelectedSubtree(app)
    return
  }

  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'x') {
    event.preventDefault()
    ops.cutSelectedSubtree(app)
    return
  }

  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'v') {
    event.preventDefault()
    ops.pasteCopiedSubtree(app)
    return
  }

  if (event.key === 'Escape' && app.state.regionDraw) {
    event.preventDefault()
    app.state.regionDraw = null
    app.refs?.scroll?.classList.remove('is-region-drawing')
    app.render()
    return
  }

  if (event.key === 'Escape' && app.state.regionResize) {
    event.preventDefault()
    // Restore original dimensions
    const rs = app.state.regionResize
    const region = app.state.document.regions?.find((r) => r.id === rs.regionId)
    if (region) {
      region.width = rs.startWidth
      region.height = rs.startHeight
      region.position = { x: rs.startCenterX, y: rs.startCenterY }
    }
    app.state.regionResize = null
    renderWorkspace(app)
    return
  }

  if (event.key === 'Escape' && app.state.connectorDrag) {
    event.preventDefault()
    app.state.connectorDrag = null
    renderWorkspace(app)
    return
  }

  if (event.key === 'Escape' && app.state.midpointDrag) {
    event.preventDefault()
    app.clearMidpointDragLongPress(app.state.midpointDrag)
    app.state.midpointDrag = null
    renderWorkspace(app)
    return
  }

  if (event.key === 'Escape' && app.state.selectedRelationId) {
    event.preventDefault()
    app.state.selectedRelationId = null
    renderWorkspace(app)
    return
  }

  if (event.key === 'Escape' && app.state.connectSourceNodeId) {
    event.preventDefault()
    app.state.connectSourceNodeId = null
    app.setStatus('status.relationModeCancelled')
    app.render()
    return
  }

  const selectedNode = app.selectedNode()
  if (!selectedNode) {
    return
  }

  if (event.key === 'Tab') {
    event.preventDefault()
    ops.createChildNode(app, selectedNode.id)
    return
  }

  if (event.key === 'Enter') {
    event.preventDefault()
    ops.createSiblingNode(app, selectedNode.id)
    return
  }

  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    ops.deleteSelectedNode(app)
    return
  }

  if (event.key === 'F2') {
    event.preventDefault()
    editor.startEditingSelected(app)
    return
  }

  if (event.key.startsWith('Arrow')) {
    event.preventDefault()
    if (event.shiftKey) {
      extendSelectionByArrow(app, event.key)
    } else {
      moveSelectionByArrow(app, event.key)
    }
    return
  }

  if (event.key === ' ') {
    event.preventDefault()
    void runNodeGestureAction(app, app.state.preferences.interaction.spaceAction, selectedNode.id)
    return
  }
}

export function moveSelectionByArrow(
  app: MindMapApp,
  key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | string,
): void {
  const currentNode = app.selectedNode()
  if (!currentNode) {
    return
  }

  const nextNode = findDirectionalNode(app, currentNode, key)
  if (!nextNode || nextNode.id === currentNode.id) {
    return
  }

  app.setSelection([nextNode.id], nextNode.id)
  app.render()
}

export function extendSelectionByArrow(
  app: MindMapApp,
  key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | string,
): void {
  const currentNode = app.selectedNode()
  if (!currentNode) {
    return
  }

  const nextNode = findDirectionalNode(app, currentNode, key)
  if (!nextNode || nextNode.id === currentNode.id) {
    return
  }

  const nextIds = [...app.selectedNodeIds()]
  if (!nextIds.includes(nextNode.id)) {
    nextIds.push(nextNode.id)
  }
  app.setSelection(nextIds, nextNode.id)
  app.render()
}

export function findDirectionalNode(app: MindMapApp, currentNode: MindNode, direction: string): MindNode | null {
  const visibleIds = visibleNodeIds(app.state.document)
  const currentCenter = nodeCenter(currentNode)
  let bestNode: MindNode | null = null
  let bestScore = Number.POSITIVE_INFINITY

  for (const candidate of app.state.document.nodes) {
    if (candidate.id === currentNode.id || !visibleIds.has(candidate.id)) {
      continue
    }

    const candidateCenter = nodeCenter(candidate)
    const deltaX = candidateCenter.x - currentCenter.x
    const deltaY = candidateCenter.y - currentCenter.y
    const primaryDelta = directionalPrimaryDelta(direction, deltaX, deltaY)
    if (primaryDelta <= 0) {
      continue
    }

    const crossDelta = directionalCrossDelta(direction, deltaX, deltaY)
    const score = primaryDelta + Math.abs(crossDelta) * 0.45 + Math.hypot(deltaX, deltaY) * 0.12
    if (score < bestScore) {
      bestScore = score
      bestNode = candidate
    }
  }

  return bestNode
}

export function flashToolbarButton(app: MindMapApp, event: KeyboardEvent): void {
  if (!app.refs) return
  const ctrl = event.ctrlKey || event.metaKey
  const shift = event.shiftKey
  const key = event.key.toLowerCase()
  const combo = ctrl && shift ? `ctrl+shift+${key}` : ctrl ? `ctrl+${key}` : key

  const refName = app.shortcutButtonMap[combo]
  if (!refName) return

  const button = app.refs[refName] as HTMLElement | undefined
  if (!button) return

  button.classList.remove('shortcut-flash')
  // Force reflow to restart animation if triggered rapidly
  void button.offsetWidth
  button.classList.add('shortcut-flash')
  setTimeout(() => {
    button.classList.remove('shortcut-flash')
  }, 200)
}
