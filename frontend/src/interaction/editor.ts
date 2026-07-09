import type { MindMapApp } from '../app'
import { childrenOf, touchDocument } from '../document'
import { clamp, parsePixelValue } from '../utils'
import { estimateNodeWidth } from '../node-sizing'
import { MIN_NODE_HEIGHT, MIN_NODE_WIDTH } from '../node-render'
import { TOPIC_NODE_MAX_WIDTH } from '../node-sizing'
import { renderEdges } from '../render/canvas'
import { saveSnapshot, scheduleAutosave } from '../sync/api-sync'
import * as ops from '../state/ops'
import type { ActiveEditorPreviewState, EditorLaunchOptions } from '../app-types'

const AUTO_NODE_EDITOR_MAX_WIDTH = TOPIC_NODE_MAX_WIDTH

export function handleEditorKeyDown(app: MindMapApp, event: KeyboardEvent): void {
  const target = event.target
  if (
    !(
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    )
  ) {
    return
  }

  if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && target.dataset.nodeEditor) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      commitNodeEditor(app, target.dataset.nodeEditor, target.value)
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      clearNodeEditorState(app)
      app.render()
    }
    return
  }

  if (target instanceof HTMLInputElement && target.dataset.relationLabel) {
    if (event.key === 'Enter') {
      event.preventDefault()
      ops.commitRelationLabel(app, target.dataset.relationLabel, target.value)
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      app.render()
    }
    return
  }

  if (target instanceof HTMLInputElement && target.dataset.settingField && event.key === 'Enter') {
    event.preventDefault()
    target.blur()
    return
  }

  if (target instanceof HTMLInputElement && target.dataset.graphSearch && event.key === 'Enter') {
    event.preventDefault()
    if (app.state.graph.selectedNodeId) {
      app.focusNodeFromGraph(app.state.graph.selectedNodeId)
    }
    return
  }

  if (target instanceof HTMLInputElement && target.dataset.snapshotName !== undefined && event.key === 'Enter') {
    event.preventDefault()
    saveSnapshot(app, 'manual')
  }
}

export function nodeEditor(app: MindMapApp, nodeId = app.state.editingNodeId): HTMLTextAreaElement | null {
  if (!nodeId) {
    return null
  }

  return app.rootEl.querySelector<HTMLTextAreaElement>(`[data-node-editor="${nodeId}"]`)
}

export function captureActiveNodeEditorDraft(app: MindMapApp): {
  nodeId: string
  value: string
  selectionStart: number
  selectionEnd: number
  anchorLeft: number | null
  preview: ActiveEditorPreviewState | null
} | null {
  const nodeId = app.state.editingNodeId
  const editor = nodeEditor(app, nodeId)
  if (!nodeId || !editor) {
    return null
  }

  return {
    nodeId,
    value: editor.value,
    selectionStart: editor.selectionStart ?? editor.value.length,
    selectionEnd: editor.selectionEnd ?? editor.value.length,
    anchorLeft: app.activeEditorAnchorLeft,
    preview: app.activeEditorPreview,
  }
}

export function restoreActiveNodeEditorDraft(
  app: MindMapApp,
  draft: {
    nodeId: string
    value: string
    selectionStart: number
    selectionEnd: number
    anchorLeft: number | null
    preview: ActiveEditorPreviewState | null
  } | null,
): void {
  if (!draft || !app.findNode(draft.nodeId)) {
    return
  }

  app.state.editingNodeId = draft.nodeId
  app.activeEditorAnchorLeft = draft.anchorLeft
  app.activeEditorPreview = draft.preview
  app.pendingEditorOptions = {
    value: draft.value,
    selectionStart: draft.selectionStart,
    selectionEnd: draft.selectionEnd,
  }
}

export function syncNodeEditorPreview(app: MindMapApp, editor: HTMLTextAreaElement): void {
  const node = app.findNode(editor.dataset.nodeEditor ?? '')
  if (!node) {
    return
  }

  const computed = window.getComputedStyle(editor)
  const minWidth = Math.max(MIN_NODE_WIDTH, parsePixelValue(computed.minWidth))
  const maxWidth = Math.max(minWidth, parsePixelValue(computed.maxWidth) || AUTO_NODE_EDITOR_MAX_WIDTH)
  const minHeight = Math.max(MIN_NODE_HEIGHT, parsePixelValue(computed.minHeight))
  let previewWidth: number
  const previewAnchorLeft: number | null = app.activeEditorAnchorLeft

  if (node.width) {
    // Fixed-width node: use the user-set width
    previewWidth = Math.max(node.width, MIN_NODE_WIDTH)
    editor.style.width = `${previewWidth}px`
    editor.style.maxWidth = 'none'
  } else {
    // Auto-width node: width can only grow (never shrink) during editing.
    // This prevents left-right jumping while still allowing expansion for long text.
    const horizontalPadding = parsePixelValue(computed.paddingLeft) + parsePixelValue(computed.paddingRight) + 2
    const longestLineWidth = editor.value
      .split(/\r?\n/)
      .reduce(
        (maxWidthSoFar, line) => Math.max(maxWidthSoFar, measureNodeEditorLineWidth(app, line || ' ', computed.font)),
        0,
      )
    const contentWidth = clamp(Math.ceil(longestLineWidth + horizontalPadding), minWidth, maxWidth)

    if (app.activeEditorLockedWidth !== null) {
      // Only allow width to grow, never shrink
      previewWidth = Math.max(app.activeEditorLockedWidth, contentWidth)
    } else {
      previewWidth = contentWidth
    }
    app.activeEditorLockedWidth = previewWidth

    editor.style.width = `${previewWidth}px`
    editor.style.maxWidth = `${maxWidth}px`
  }

  editor.style.height = 'auto'
  let previewHeight: number
  if (node.height) {
    previewHeight = Math.max(node.height, minHeight)
    editor.style.height = `${previewHeight}px`
  } else {
    previewHeight = Math.max(editor.scrollHeight, minHeight)
    editor.style.height = `${previewHeight}px`
  }

  if (!node.width && previewAnchorLeft !== null) {
    app.activeEditorPreview = {
      nodeId: node.id,
      anchorLeft: previewAnchorLeft,
      width: previewWidth,
      height: previewHeight,
    }
    const article = app.rootEl.querySelector<HTMLElement>(`[data-node-id="${node.id}"]`)
    if (article) {
      article.classList.add('is-editing-auto-width')
      article.style.left = `${previewAnchorLeft + app.workspaceBounds.originX}px`
      article.style.top = `${node.position.y + app.workspaceBounds.originY}px`
    }
    if (app.refs?.edgeLayer) {
      app.refs.edgeLayer.innerHTML = renderEdges(app)
    }
    return
  }

  if (app.activeEditorPreview?.nodeId === node.id) {
    app.activeEditorPreview = null
    if (app.refs?.edgeLayer) {
      app.refs.edgeLayer.innerHTML = renderEdges(app)
    }
  }
}

export function measureNodeEditorLineWidth(app: MindMapApp, text: string, font: string): number {
  if (!app.nodeEditorMeasureCanvas) {
    app.nodeEditorMeasureCanvas = document.createElement('canvas')
  }

  const context = app.nodeEditorMeasureCanvas.getContext('2d')
  if (!context) {
    return Math.max(text.length, 1) * 8.6
  }

  context.font = font || '16px sans-serif'
  return context.measureText(text || ' ').width
}

export function focusEditorIfNeeded(app: MindMapApp): void {
  if (!app.state.editingNodeId || app.overlayBlocksCanvas()) {
    return
  }

  const editor = nodeEditor(app, app.state.editingNodeId)
  if (!editor) {
    return
  }

  const pendingOptions = app.pendingEditorOptions
  app.pendingEditorOptions = null
  queueMicrotask(() => {
    if (pendingOptions?.value !== undefined && pendingOptions.value !== null) {
      editor.value = pendingOptions.value
    }
    syncNodeEditorPreview(app, editor)
    restoreEditorSelection(app, editor, pendingOptions)
    window.setTimeout(() => {
      syncNodeEditorPreview(app, editor)
      restoreEditorSelection(app, editor, pendingOptions)
    }, 0)
  })
}

export function restoreEditorSelection(
  app: MindMapApp,
  editor: HTMLInputElement | HTMLTextAreaElement,
  options: EditorLaunchOptions | null | undefined,
  attempt = 0,
): void {
  if (!editor.isConnected || app.state.editingNodeId !== editor.dataset.nodeEditor) {
    return
  }

  try {
    editor.focus({ preventScroll: true })
  } catch {
    editor.focus()
  }

  if (typeof options?.selectionStart === 'number') {
    const start = clamp(Math.round(options.selectionStart), 0, editor.value.length)
    const end = clamp(Math.round(options.selectionEnd ?? options.selectionStart), start, editor.value.length)
    editor.classList.toggle('is-all-selected', start === 0 && end === editor.value.length)
    editor.setSelectionRange(start, end)
  } else {
    const selectionMode = options?.selection ?? 'all'
    editor.classList.toggle('is-all-selected', selectionMode === 'all')
    if (selectionMode === 'end') {
      const cursor = editor.value.length
      editor.setSelectionRange(cursor, cursor)
    } else {
      editor.select()
      editor.setSelectionRange(0, editor.value.length)
    }
  }

  if (editorSelectionSettled(app, editor, options) || attempt >= 4) {
    return
  }

  window.requestAnimationFrame(() => {
    restoreEditorSelection(app, editor, options, attempt + 1)
  })
}

export function editorSelectionSettled(
  _app: MindMapApp,
  editor: HTMLInputElement | HTMLTextAreaElement,
  options: EditorLaunchOptions | null | undefined,
): boolean {
  if (document.activeElement !== editor) {
    return false
  }

  const selectionStart = editor.selectionStart ?? -1
  const selectionEnd = editor.selectionEnd ?? -1
  if (typeof options?.selectionStart === 'number') {
    const expectedStart = clamp(Math.round(options.selectionStart), 0, editor.value.length)
    const expectedEnd = clamp(
      Math.round(options.selectionEnd ?? options.selectionStart),
      expectedStart,
      editor.value.length,
    )
    return selectionStart === expectedStart && selectionEnd === expectedEnd
  }

  const selectionMode = options?.selection ?? 'all'
  if (selectionMode === 'end') {
    const cursor = editor.value.length
    return selectionStart === cursor && selectionEnd === cursor
  }

  return selectionStart === 0 && selectionEnd === editor.value.length
}

export function startEditingSelected(app: MindMapApp, options: EditorLaunchOptions = {}): void {
  const selectedNode = app.selectedNode()
  if (!selectedNode) {
    return
  }

  app.setSelection([selectedNode.id], selectedNode.id)
  openNodeEditor(app, selectedNode.id, options)
}

export function openNodeEditor(app: MindMapApp, nodeId: string, options: EditorLaunchOptions = {}): void {
  app.editingOriginalTitle = app.findNode(nodeId)?.title ?? null
  app.state.editingNodeId = nodeId
  app.activeEditorAnchorLeft = resolveNodeEditorAnchorLeft(app, nodeId)
  app.activeEditorPreview = resolveNodeEditorPreviewState(app, nodeId)
  app.pendingEditorOptions = options
  app.render()
}

export function resolveNodeEditorAnchorLeft(app: MindMapApp, nodeId: string): number | null {
  const node = app.findNode(nodeId)
  if (!node || node.width) {
    return null
  }

  const element = app.rootEl.querySelector<HTMLElement>(
    `[data-node-id="${nodeId}"] .node-shell, [data-node-id="${nodeId}"] .node-editor`,
  )
  if (!element) {
    return node.position.x - estimateNodeWidth(node, childrenOf(app.state.document, node.id).length) / 2
  }

  const measuredWidth = element.getBoundingClientRect().width / app.viewport.scale
  return node.position.x - measuredWidth / 2
}

export function resolveNodeEditorPreviewState(app: MindMapApp, nodeId: string): ActiveEditorPreviewState | null {
  const node = app.findNode(nodeId)
  const anchorLeft = app.activeEditorAnchorLeft
  if (!node || node.width || anchorLeft === null) {
    return null
  }

  const element = app.rootEl.querySelector<HTMLElement>(
    `[data-node-id="${nodeId}"] .node-shell, [data-node-id="${nodeId}"] .node-editor`,
  )
  if (!element) {
    return null
  }

  const rect = element.getBoundingClientRect()
  return {
    nodeId,
    anchorLeft,
    width: Math.max(rect.width / app.viewport.scale, MIN_NODE_WIDTH),
    height: Math.max(rect.height / app.viewport.scale, MIN_NODE_HEIGHT),
  }
}

export function clearNodeEditorState(app: MindMapApp): void {
  app.state.editingNodeId = null
  app.pendingEditorOptions = null
  app.activeEditorAnchorLeft = null
  app.activeEditorPreview = null
  app.activeEditorLockedWidth = null
  app.editingOriginalTitle = null
}

export function cancelNodeEditor(app: MindMapApp): void {
  const nodeId = app.state.editingNodeId
  if (!nodeId) {
    return
  }
  const node = app.findNode(nodeId)
  if (node && app.editingOriginalTitle !== null) {
    node.title = app.editingOriginalTitle
  }
  clearNodeEditorState(app)
  app.render()
}

export function commitNodeEditor(
  app: MindMapApp,
  nodeId: string,
  rawTitle: string,
  options: {
    allowInactive?: boolean
    preserveSelection?: boolean
    renderAfter?: boolean
  } = {},
): void {
  if (!options.allowInactive && app.state.editingNodeId !== nodeId) {
    return
  }

  const title = rawTitle.trim() || app.t('node.untitled')
  const existingNode = app.findNode(nodeId)
  const preservedAnchorLeft = app.activeEditorAnchorLeft
  if (!existingNode) {
    clearNodeEditorState(app)
    if (options.renderAfter !== false) {
      app.render()
    }
    return
  }

  clearNodeEditorState(app)
  if (existingNode.title === title) {
    if (options.renderAfter !== false) {
      app.render()
    }
    return
  }

  ops.captureHistory(app)
  app.updateNode(nodeId, (node) => {
    node.title = title
    if (!node.width && preservedAnchorLeft !== null) {
      const nextWidth = estimateNodeWidth({ ...node, title }, childrenOf(app.state.document, node.id).length)
      node.position = {
        ...node.position,
        x: Math.round(preservedAnchorLeft + nextWidth / 2),
      }
    }
  })
  if (!options.preserveSelection) {
    ops.applySelectionState(app, [nodeId], nodeId)
  }
  touchDocument(app.state.document)
  app.setStatus('status.nodeTitleUpdated')
  if (options.renderAfter !== false) {
    app.render()
  }
  scheduleAutosave(app, 'status.titleSaveScheduled')
}

export function finishActiveNodeEditing(app: MindMapApp, renderAfter = false): void {
  const nodeId = app.state.editingNodeId
  if (!nodeId) {
    return
  }

  const editor = nodeEditor(app, nodeId)
  const fallbackTitle = app.findNode(nodeId)?.title ?? ''
  commitNodeEditor(app, nodeId, editor?.value ?? fallbackTitle, {
    allowInactive: true,
    preserveSelection: true,
    renderAfter,
  })
}
