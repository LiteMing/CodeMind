import type { MindMapApp } from '../app'
import { api } from '../api'
import { autoLayoutHierarchy, findRoot, touchDocument } from '../document'
import { getErrorMessage } from '../utils'
import { normalizeNodeColor } from '../color-palette'
import {
  DEFAULT_LM_STUDIO_URL,
  normalizeAIMaxTokens,
  normalizeAITimeoutSeconds,
  normalizeCanvasDragAction,
  normalizeChildGapX,
  normalizeChromeLayout,
  normalizeEdgeStyle,
  normalizeGestureAction,
  normalizeLayoutMode,
  normalizeTopPanelPosition,
} from '../preferences'
import { normalizeAITemplateId } from '../templates'
import {
  applyAINodeNotes,
  applyAINodeNotesForTargets,
  applyAIQuickAssist,
  applyAIRelations,
  applyAIRelationsForFocus,
  applyAISuggestNodes,
  closeAIWheel,
  closeAIWorkspace,
  expandAIMap,
  generateAIMap,
  importFileWithAI,
  openAIWheel,
  openAIWorkspace,
  resetAIConnectionFeedback,
  testAIConnection,
  toggleAIDebug,
  toggleAIRawMode,
} from '../ai/actions'
import {
  createMap,
  deleteMap,
  exportMarkdown,
  goHome,
  openMap,
  renameMap,
  saveCollabApiKey,
  saveDocument,
  saveSnapshot,
  scheduleAutosave,
} from '../sync/api-sync'
import { renderHeader } from '../render/shell'
import { renderOverlay } from '../render/overlay'
import { drawGraphScene, updateGraphSummaryPanel } from '../render/graph'
import * as editor from './editor'
import * as pointer from './pointer'
import * as ops from '../state/ops'
import type { ArrowDirection, GestureAction, Locale, NodeColor, Priority } from '../types'
import type { FixedMenuId, PendingImportMode } from '../app-types'

export async function runCommand(app: MindMapApp, rawCommand: string): Promise<void> {
  const colonIdx = rawCommand.indexOf(':')
  const command = colonIdx === -1 ? rawCommand : rawCommand.slice(0, colonIdx)
  const argument = colonIdx === -1 ? '' : rawCommand.slice(colonIdx + 1)

  try {
    switch (command) {
      case 'create-map':
        await createMap(app)
        return
      case 'open-map':
        if (argument) {
          await openMap(app, argument)
        }
        return
      case 'go-home':
        await goHome(app)
        return
      case 'rename-map':
        await renameMap(app, argument || app.state.currentMapId || app.state.document.id)
        return
      case 'delete-map':
        await deleteMap(app, argument || app.state.currentMapId || app.state.document.id)
        return
      case 'toggle-top-panel':
        app.toggleTopPanel()
        return
      case 'toggle-inspector':
        app.toggleInspector()
        return
      case 'toggle-inspector-section':
        app.toggleInspectorSection(argument)
        return
      case 'toggle-settings':
        app.toggleSettings()
        return
      case 'platform-help':
        await showPlatformHelp(app)
        return
      case 'open-ai-workspace':
        openAIWorkspace(app)
        return
      case 'close-ai-workspace':
        closeAIWorkspace(app)
        return
      case 'toggle-ai-debug':
        toggleAIDebug(app)
        return
      case 'toggle-ai-raw-mode':
        toggleAIRawMode(app)
        return
      case 'open-graph-overlay':
        app.openGraphOverlay()
        return
      case 'close-graph-overlay':
        app.closeGraphOverlay()
        return
      case 'toggle-graph-autorotate':
        app.toggleGraphAutoRotate()
        return
      case 'reset-graph-view':
        app.resetGraphView()
        return
      case 'graph-zoom-in':
        app.nudgeGraphZoom(1)
        return
      case 'graph-zoom-out':
        app.nudgeGraphZoom(-1)
        return
      case 'close-settings':
        app.closeSettings()
        return
      case 'show-shortcut-overlay':
        app.showShortcutOverlay()
        return
      case 'complete-onboarding':
        app.completeOnboarding()
        return
      case 'theme-toggle':
        app.toggleTheme()
        return
      case 'undo':
        ops.undo(app)
        return
      case 'redo':
        ops.redo(app)
        return
      case 'save':
        await saveDocument(app, 'status.saved')
        return
      case 'save-snapshot':
        saveSnapshot(app, 'manual')
        return
      case 'restore-snapshot':
        if (argument) {
          ops.restoreSnapshot(app, argument)
        }
        return
      case 'auto-layout':
        ops.autoLayout(app)
        return
      case 'tidy-subtree':
        if (argument) {
          ops.tidySubtreeCommand(app, argument)
        }
        return
      case 'zoom-in':
        app.zoomBy(1.25)
        return
      case 'zoom-out':
        app.zoomBy(0.8)
        return
      case 'zoom-reset':
        app.zoomReset()
        return
      case 'zoom-fit':
        app.zoomFit()
        return
      case 'export-markdown':
        await exportMarkdown(app)
        return
      case 'import-file':
        app.pendingImportMode = 'auto'
        app.refs?.importInput.click()
        return
      case 'new-floating':
        ops.createFloatingNode(app, app.selectedNode()?.id ?? 'root')
        return
      case 'connect-selected':
        app.startRelationMode()
        return
      case 'ai-connect-relations':
        await applyAIRelations(app)
        return
      case 'ai-complete-node-notes':
        await applyAINodeNotes(app)
        return
      case 'ai-complete-node-notes-as-children':
        await applyAINodeNotes(app, 'children')
        return
      case 'ai-generate-map':
        await generateAIMap(app)
        return
      case 'ai-expand-map':
        await expandAIMap(app)
        return
      case 'ai-import-file':
        app.pendingImportMode = 'ai'
        app.refs?.importInput.click()
        return
      case 'ai-suggest-children':
        await applyAISuggestNodes(app, app.selectedNode()?.id ?? '', 'children')
        return
      case 'ai-suggest-siblings':
        await applyAISuggestNodes(app, app.selectedNode()?.id ?? '', 'siblings')
        return
      case 'ai-wheel-children': {
        const targetNodeId = app.state.aiWheel.nodeId ?? app.selectedNode()?.id ?? ''
        closeAIWheel(app)
        await applyAISuggestNodes(app, targetNodeId, 'children')
        return
      }
      case 'ai-wheel-notes': {
        const targetNodeId = app.state.aiWheel.nodeId ?? app.selectedNode()?.id ?? ''
        closeAIWheel(app)
        await applyAINodeNotesForTargets(app, [targetNodeId], 'replace')
        return
      }
      case 'ai-wheel-relations': {
        const targetNodeId = app.state.aiWheel.nodeId ?? app.selectedNode()?.id ?? ''
        closeAIWheel(app)
        await applyAIRelationsForFocus(app, [targetNodeId])
        return
      }
      case 'ai-wheel-siblings': {
        const targetNodeId = app.state.aiWheel.nodeId ?? app.selectedNode()?.id ?? ''
        closeAIWheel(app)
        await applyAISuggestNodes(app, targetNodeId, 'siblings')
        return
      }
      case 'close-ai-wheel':
        closeAIWheel(app)
        renderOverlay(app)
        return
      case 'create-template-map':
        await app.createTemplateMap(normalizeAITemplateId(argument))
        return
      case 'toggle-fixed-menu':
        app.toggleFixedMenu((argument as FixedMenuId) || '')
        return
      case 'focus-graph-selected':
        if (app.state.graph.selectedNodeId) {
          app.focusNodeFromGraph(app.state.graph.selectedNodeId)
        }
        return
      case 'test-ai-connection':
        await testAIConnection(app)
        return
      case 'collab-generate-key':
        app.generateCollabApiKey()
        return
      case 'collab-copy-key':
        await app.copyCollabApiKey()
        return
      case 'collab-clear-key':
        app.clearCollabApiKey()
        return
      case 'collab-save-key':
        await saveCollabApiKey(app)
        return
      case 'new-child':
        ops.createChildNode(app, app.selectedNode()?.id ?? 'root')
        return
      case 'new-sibling':
        ops.createSiblingNode(app, app.selectedNode()?.id ?? 'root')
        return
      case 'rename-selected':
        editor.startEditingSelected(app)
        return
      case 'set-priority':
        ops.setPriority(app, (argument.toUpperCase() as Priority) || '')
        return
      case 'toggle-collapse':
        app.toggleSelectedCollapse()
        return
      case 'toggle-node-collapse':
        if (argument) {
          ops.toggleNodeCollapse(app, argument)
        }
        return
      case 'delete-selected':
        ops.deleteSelectedNode(app)
        return
      case 'cycle-priority':
        app.cycleSelectedNodePriority()
        return
      case 'cycle-node-color':
        app.cycleSelectedNodeColor()
        return
      case 'open-ai-wheel': {
        const targetId = app.state.selectedNodeId
        if (targetId) {
          const center = app.nodeClientCenter(targetId)
          openAIWheel(app, targetId, center.x, center.y)
          renderOverlay(app)
        }
        return
      }
      case 'focus-node':
        if (argument) {
          app.selectNode(argument)
        }
        return
      case 'open-node-note':
        if (argument) {
          app.openNodeNoteEditor(argument)
        }
        return
      case 'delete-relation':
        if (argument) {
          ops.removeRelation(app, argument)
        }
        return
      case 'create-region':
        pointer.startRegionDraw(app)
        return
      case 'delete-region':
        if (argument) {
          app.deleteRegion(argument)
        }
        return
      case 'set-region-color': {
        const [color, regionId] = argument.split(':')
        if (regionId) {
          app.setRegionColor(regionId, normalizeNodeColor(color))
        }
        return
      }
      case 'set-arrow': {
        const parts = argument.split(':')
        const direction = parts[0] as ArrowDirection
        const relationId = parts.slice(1).join(':')
        if (relationId) {
          app.setRelationArrowDirection(relationId, direction)
        }
        return
      }
      case 'branch-connection': {
        if (argument) {
          app.branchConnectionAtMidpoint(argument)
        }
        return
      }
      default:
        break
    }
  } catch (error) {
    app.setStatus('status.mapListFailed', { reason: getErrorMessage(error) })
    app.render()
  }
}

export function handleClick(app: MindMapApp, event: MouseEvent): void {
  // Element, not HTMLElement: clicks on inline SVG icons (context toolbar
  // buttons) surface an SVGElement target and must still reach the
  // data-command dispatch below.
  const rawTarget = event.target
  if (!(rawTarget instanceof Element)) {
    return
  }
  const target = rawTarget as HTMLElement

  if (app.suppressClickOnce) {
    app.suppressClickOnce = false
    return
  }

  const nodeButton = target.closest<HTMLElement>('[data-node-button]')
  const keepPendingGesture = nodeButton?.dataset.nodeButton === app.pendingNodeGestureNodeId && event.detail >= 2
  if (!keepPendingGesture) {
    app.cancelPendingNodeGesture()
  }

  const closedContextMenu = Boolean(app.state.contextMenu) && !target.closest('[data-context-menu]')
  const closedFixedMenu = app.state.fixedMenu !== '' && !target.closest('[data-fixed-menu-shell]')
  const closedAIWheel = app.state.aiWheel.open && !target.closest('[data-ai-wheel]')
  if (closedContextMenu) {
    app.state.contextMenu = null
  }
  if (closedFixedMenu) {
    app.state.fixedMenu = ''
  }
  if (closedAIWheel) {
    closeAIWheel(app)
  }

  const settingsScrim = target.closest<HTMLElement>('[data-settings-scrim]')
  if (settingsScrim && target === settingsScrim) {
    app.closeSettings()
    return
  }

  const aiScrim = target.closest<HTMLElement>('[data-ai-scrim]')
  if (aiScrim && target === aiScrim) {
    closeAIWorkspace(app)
    return
  }

  const graphScrim = target.closest<HTMLElement>('[data-graph-scrim]')
  if (graphScrim && target === graphScrim) {
    app.closeGraphOverlay()
    return
  }

  const localeOption = target.closest<HTMLElement>('[data-locale-option]')?.dataset.localeOption as Locale | undefined
  if (localeOption) {
    app.setLocale(localeOption, false)
    return
  }

  const command = target.closest<HTMLElement>('[data-command]')?.dataset.command
  const clickedNodeEditor = target.closest<HTMLTextAreaElement>('[data-node-editor]')
  const clickedWorkspace = target.closest<HTMLElement>('[data-workspace-scroll]')
  const clickedRegion = target.closest<HTMLElement>('[data-region-id]')
  if (command) {
    if (!command.startsWith('toggle-fixed-menu')) {
      app.state.fixedMenu = ''
    }
    if (app.state.editingNodeId && !clickedNodeEditor) {
      editor.finishActiveNodeEditing(app)
    }
    app.state.contextMenu = null
    void runCommand(app, command)
    return
  }

  const priority = target.closest<HTMLElement>('[data-priority]')?.dataset.priority as Priority | undefined
  if (priority !== undefined) {
    if (app.state.editingNodeId && !clickedNodeEditor) {
      editor.finishActiveNodeEditing(app)
    }
    ops.setPriority(app, priority)
    return
  }

  const nodeColor = target.closest<HTMLElement>('[data-node-color]')?.dataset.nodeColor as NodeColor | undefined
  if (nodeColor !== undefined) {
    if (app.state.editingNodeId && !clickedNodeEditor) {
      editor.finishActiveNodeEditing(app)
    }
    ops.setNodeColor(app, normalizeNodeColor(nodeColor))
    return
  }

  if (target.closest('[data-graph-canvas]')) {
    app.selectGraphNodeAtPoint(event.clientX, event.clientY)
    return
  }

  const graphResultNodeId = target.closest<HTMLElement>('[data-graph-node-result]')?.dataset.graphNodeResult
  if (graphResultNodeId) {
    app.state.graph.selectedNodeId = graphResultNodeId
    updateGraphSummaryPanel(app)
    drawGraphScene(app)
    return
  }

  if (app.overlayBlocksCanvas()) {
    return
  }

  if (clickedNodeEditor) {
    return
  }

  if (app.state.editingNodeId) {
    editor.finishActiveNodeEditing(app)
  }

  if (nodeButton?.dataset.nodeButton) {
    const nodeId = nodeButton.dataset.nodeButton
    if (app.state.connectSourceNodeId && app.state.connectSourceNodeId !== nodeId) {
      ops.createRelation(app, app.state.connectSourceNodeId, nodeId)
      return
    }

    if (!event.shiftKey && !event.ctrlKey && !event.metaKey && event.detail >= 3) {
      event.preventDefault()
      app.cancelPendingNodeGesture()
      app.setSelection([nodeId], nodeId)
      void runNodeGestureAction(app, app.state.preferences.interaction.tripleClickAction, nodeId, {
        clientX: event.clientX,
        clientY: event.clientY,
      })
      return
    }

    if (!event.shiftKey && !event.ctrlKey && !event.metaKey && event.detail === 2) {
      event.preventDefault()
      app.setSelection([nodeId], nodeId)
      app.scheduleNodeGestureAction(nodeId, event.clientX, event.clientY)
      return
    }

    if (event.shiftKey) {
      ops.selectNodeSubtree(app, nodeId)
      return
    }

    if (event.ctrlKey || event.metaKey) {
      ops.toggleNodeSelection(app, nodeId)
      return
    }

    app.selectNode(nodeId)
    return
  }

  if (clickedRegion?.dataset.regionId) {
    app.selectRegion(clickedRegion.dataset.regionId)
    app.render()
    return
  }

  if (closedContextMenu || closedFixedMenu || closedAIWheel) {
    renderOverlay(app)
    renderHeader(app)
  }

  if (clickedWorkspace) {
    app.clearSelection()
  }
}

export function handleContextMenu(app: MindMapApp, event: MouseEvent): void {
  if (app.state.view !== 'map' || app.overlayBlocksCanvas()) {
    return
  }

  event.preventDefault()
  if (app.suppressContextMenuOnce) {
    app.suppressContextMenuOnce = false
    return
  }

  const target = event.target
  const element = target instanceof HTMLElement ? target : null
  const svgElement = target instanceof SVGElement ? target : null

  // Check for right-click on relation edge hit area
  const relationClick = svgElement?.closest<SVGElement>('[data-relation-click]')
  if (relationClick) {
    const relationId = relationClick.getAttribute('data-relation-click')
    if (relationId) {
      app.state.selectedRelationId = relationId
      app.state.selectedRegionId = null
      ops.applySelectionState(app, [], null)
      app.state.contextMenu = {
        clientX: event.clientX,
        clientY: event.clientY,
        nodeId: null,
        relationId,
      }
      app.render()
      return
    }
  }

  // Check for right-click on region box
  const regionEl = element?.closest<HTMLElement>('[data-region-id]')
  if (regionEl) {
    const regionId = regionEl.dataset.regionId
    if (regionId) {
      app.selectRegion(regionId)
      app.state.contextMenu = {
        clientX: event.clientX,
        clientY: event.clientY,
        nodeId: null,
        regionId,
      }
      app.render()
      return
    }
  }

  const nodeId = element?.closest<HTMLElement>('[data-node-button]')?.dataset.nodeButton ?? null
  if (nodeId && !app.state.selectedNodeIds.includes(nodeId)) {
    app.setSelection([nodeId], nodeId)
  }

  app.state.contextMenu = {
    clientX: event.clientX,
    clientY: event.clientY,
    nodeId,
  }
  app.render()
}

export function handleDoubleClick(app: MindMapApp, event: MouseEvent): void {
  const target = event.target
  if (target instanceof HTMLElement && target.closest('[data-graph-canvas]')) {
    const nodeId = app.selectGraphNodeAtPoint(event.clientX, event.clientY)
    if (nodeId) {
      app.focusNodeFromGraph(nodeId)
    }
    return
  }

  if (app.overlayBlocksCanvas()) {
    return
  }

  if (!(target instanceof HTMLElement)) {
    return
  }

  const nodeButton = target.closest<HTMLElement>('[data-node-button]')
  if (!nodeButton?.dataset.nodeButton) {
    return
  }

  event.preventDefault()
}

export function handleInput(app: MindMapApp, event: Event): void {
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
    target.classList.remove('is-all-selected')
    if (target instanceof HTMLTextAreaElement) {
      editor.syncNodeEditorPreview(app, target)
    }
    return
  }

  if (target instanceof HTMLTextAreaElement && target.dataset.nodeNote) {
    app.syncInspectorNoteInputHeight(target)
    return
  }

  const aiField = target.dataset.aiField
  if (aiField) {
    switch (aiField) {
      case 'topic':
        app.state.ai.topic = target.value
        break
      case 'template':
        app.state.ai.template = normalizeAITemplateId(target.value)
        break
      case 'generationInstructions':
        app.state.ai.generationInstructions = target.value
        break
      case 'importInstructions':
        app.state.ai.importInstructions = target.value
        break
      case 'noteInstructions':
        app.state.ai.noteInstructions = target.value
        break
      case 'relationInstructions':
        app.state.ai.relationInstructions = target.value
        break
      case 'generateRawRequest':
        app.state.ai.generateRawRequest = target.value
        break
      case 'importRawRequest':
        app.state.ai.importRawRequest = target.value
        break
      case 'noteRawRequest':
        app.state.ai.noteRawRequest = target.value
        break
      case 'relationRawRequest':
        app.state.ai.relationRawRequest = target.value
        break
      default:
        break
    }
    return
  }

  if (target.dataset.graphSearch !== undefined) {
    app.state.graph.search = target.value
    const matchedNode = app.findGraphMatches(target.value)[0]
    if (matchedNode) {
      app.state.graph.selectedNodeId = matchedNode.id
    }
    updateGraphSummaryPanel(app)
    drawGraphScene(app)
    return
  }

  if (target instanceof HTMLInputElement && target.dataset.snapshotName !== undefined) {
    app.state.snapshotDraftName = target.value
  }
}

export function handleChange(app: MindMapApp, event: Event): void {
  const target = event.target
  if (
    !(
      target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement
    )
  ) {
    return
  }

  if (target instanceof HTMLInputElement && target.dataset.importInput) {
    const file = target.files?.[0]
    if (!file) {
      return
    }

    void importFile(app, file, app.pendingImportMode)
    app.pendingImportMode = 'auto'
    target.value = ''
    return
  }

  const field = target.dataset.settingField
  if (field) {
    commitSettingField(app, field, target.value)
    return
  }

  if (target instanceof HTMLTextAreaElement && target.dataset.nodeNote) {
    ops.commitNodeNote(app, target.dataset.nodeNote, target.value)
    return
  }

  if (target.dataset.aiField === 'template') {
    app.state.ai.template = normalizeAITemplateId(target.value)
  }
}

export function handleFocusOut(app: MindMapApp, event: FocusEvent): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
    return
  }

  if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && target.dataset.nodeEditor) {
    const nodeId = target.dataset.nodeEditor
    queueMicrotask(() => {
      const currentEditor = editor.nodeEditor(app, nodeId)
      if (app.state.editingNodeId === nodeId && currentEditor && currentEditor !== target) {
        return
      }
      editor.commitNodeEditor(app, nodeId, target.value)
    })
    return
  }

  if (target instanceof HTMLInputElement && target.dataset.relationLabel) {
    ops.commitRelationLabel(app, target.dataset.relationLabel, target.value)
    return
  }

  if (target instanceof HTMLTextAreaElement && target.dataset.nodeNote) {
    ops.commitNodeNote(app, target.dataset.nodeNote, target.value)
  }
}

export function commitSettingField(app: MindMapApp, field: string, value: string): void {
  switch (field) {
    case 'locale':
      app.setLocale(value === 'zh-CN' ? 'zh-CN' : 'en', true)
      return
    case 'theme':
      app.setTheme(value === 'light' ? 'light' : 'dark')
      return
    case 'appearance.edgeStyle':
      app.updatePreferences((preferences) => {
        preferences.appearance.edgeStyle = normalizeEdgeStyle(value)
      })
      app.setStatus('status.appearanceUpdated')
      app.render()
      return
    case 'appearance.layoutMode': {
      const nextLayoutMode = normalizeLayoutMode(value)
      const layoutModeChanged = app.state.preferences.appearance.layoutMode !== nextLayoutMode
      app.updatePreferences((preferences) => {
        preferences.appearance.layoutMode = nextLayoutMode
      })
      if (layoutModeChanged && app.state.view === 'map') {
        const movedNodes = autoLayoutHierarchy(
          app.state.document,
          app.state.preferences.appearance.layoutMode,
          app.state.preferences.appearance.childGapX,
        )
        touchDocument(app.state.document)
        app.setStatus('status.layoutUpdated', { count: movedNodes })
        app.render()
        scheduleAutosave(app, 'status.layoutSaveScheduled')
        return
      }
      app.setStatus('status.appearanceUpdated')
      app.render()
      return
    }
    case 'appearance.childGapX': {
      const nextChildGapX = normalizeChildGapX(value)
      const childGapChanged = app.state.preferences.appearance.childGapX !== nextChildGapX
      app.updatePreferences((preferences) => {
        preferences.appearance.childGapX = nextChildGapX
      })
      if (childGapChanged && app.state.view === 'map') {
        const movedNodes = autoLayoutHierarchy(
          app.state.document,
          app.state.preferences.appearance.layoutMode,
          app.state.preferences.appearance.childGapX,
        )
        touchDocument(app.state.document)
        app.setStatus('status.layoutUpdated', { count: movedNodes })
        app.render()
        scheduleAutosave(app, 'status.layoutSaveScheduled')
        return
      }
      app.setStatus('status.appearanceUpdated')
      app.render()
      return
    }
    case 'appearance.chromeLayout':
      app.updatePreferences((preferences) => {
        preferences.appearance.chromeLayout = normalizeChromeLayout(value)
      })
      if (value !== 'fixed') {
        app.state.fixedMenu = ''
      }
      app.setStatus('status.appearanceUpdated')
      app.render()
      return
    case 'appearance.topPanelPosition':
      app.updatePreferences((preferences) => {
        preferences.appearance.topPanelPosition = normalizeTopPanelPosition(value)
      })
      app.setStatus('status.appearanceUpdated')
      app.render()
      return
    case 'interaction.dragSubtreeWithParent':
      app.updatePreferences((preferences) => {
        preferences.interaction.dragSubtreeWithParent = value === 'true'
      })
      app.setStatus('status.interactionUpdated')
      app.render()
      return
    case 'interaction.dragSnap':
      app.updatePreferences((preferences) => {
        preferences.interaction.dragSnap = value === 'true'
      })
      app.setStatus('status.interactionUpdated')
      app.render()
      return
    case 'interaction.autoLayoutOnCollapse':
      app.updatePreferences((preferences) => {
        preferences.interaction.autoLayoutOnCollapse = value === 'true'
      })
      app.setStatus('status.interactionUpdated')
      app.render()
      return
    case 'interaction.autoSnapshots':
      app.updatePreferences((preferences) => {
        preferences.interaction.autoSnapshots = value === 'true'
      })
      app.setStatus('status.interactionUpdated')
      app.render()
      return
    case 'interaction.aiQuickChildren':
      app.updatePreferences((preferences) => {
        preferences.interaction.aiQuickChildren = value === 'true'
      })
      app.setStatus('status.interactionUpdated')
      app.render()
      return
    case 'interaction.aiQuickSiblings':
      app.updatePreferences((preferences) => {
        preferences.interaction.aiQuickSiblings = value === 'true'
      })
      app.setStatus('status.interactionUpdated')
      app.render()
      return
    case 'interaction.aiQuickNotes':
      app.updatePreferences((preferences) => {
        preferences.interaction.aiQuickNotes = value === 'true'
      })
      app.setStatus('status.interactionUpdated')
      app.render()
      return
    case 'interaction.aiQuickRelations':
      app.updatePreferences((preferences) => {
        preferences.interaction.aiQuickRelations = value === 'true'
      })
      app.setStatus('status.interactionUpdated')
      app.render()
      return
    case 'interaction.doubleClickAction':
      app.updatePreferences((preferences) => {
        preferences.interaction.doubleClickAction = normalizeGestureAction(
          value,
          preferences.interaction.doubleClickAction,
        )
      })
      app.setStatus('status.interactionUpdated')
      app.render()
      return
    case 'interaction.tripleClickAction':
      app.updatePreferences((preferences) => {
        preferences.interaction.tripleClickAction = normalizeGestureAction(
          value,
          preferences.interaction.tripleClickAction,
        )
      })
      app.setStatus('status.interactionUpdated')
      app.render()
      return
    case 'interaction.longPressAction':
      app.updatePreferences((preferences) => {
        preferences.interaction.longPressAction = normalizeGestureAction(value, preferences.interaction.longPressAction)
        preferences.interaction.rightLongPressAction = preferences.interaction.longPressAction
      })
      app.setStatus('status.interactionUpdated')
      app.render()
      return
    case 'interaction.leftLongPressAction':
      app.updatePreferences((preferences) => {
        preferences.interaction.leftLongPressAction = normalizeGestureAction(
          value,
          preferences.interaction.leftLongPressAction,
        )
      })
      app.setStatus('status.interactionUpdated')
      app.render()
      return
    case 'interaction.middleLongPressAction':
      app.updatePreferences((preferences) => {
        preferences.interaction.middleLongPressAction = normalizeGestureAction(
          value,
          preferences.interaction.middleLongPressAction,
        )
      })
      app.setStatus('status.interactionUpdated')
      app.render()
      return
    case 'interaction.rightLongPressAction':
      app.updatePreferences((preferences) => {
        preferences.interaction.rightLongPressAction = normalizeGestureAction(
          value,
          preferences.interaction.rightLongPressAction,
        )
        preferences.interaction.longPressAction = preferences.interaction.rightLongPressAction
      })
      app.setStatus('status.interactionUpdated')
      app.render()
      return
    case 'interaction.canvasLeftDragAction':
      app.updatePreferences((preferences) => {
        preferences.interaction.canvasLeftDragAction = normalizeCanvasDragAction(
          value,
          preferences.interaction.canvasLeftDragAction,
        )
      })
      app.setStatus('status.interactionUpdated')
      app.render()
      return
    case 'interaction.canvasMiddleDragAction':
      app.updatePreferences((preferences) => {
        preferences.interaction.canvasMiddleDragAction = normalizeCanvasDragAction(
          value,
          preferences.interaction.canvasMiddleDragAction,
        )
      })
      app.setStatus('status.interactionUpdated')
      app.render()
      return
    case 'interaction.canvasRightDragAction':
      app.updatePreferences((preferences) => {
        preferences.interaction.canvasRightDragAction = normalizeCanvasDragAction(
          value,
          preferences.interaction.canvasRightDragAction,
        )
      })
      app.setStatus('status.interactionUpdated')
      app.render()
      return
    case 'interaction.spaceAction':
      app.updatePreferences((preferences) => {
        preferences.interaction.spaceAction = normalizeGestureAction(value, preferences.interaction.spaceAction)
      })
      app.setStatus('status.interactionUpdated')
      app.render()
      return
    case 'ai.provider':
      app.updatePreferences((preferences) => {
        preferences.ai.provider = value === 'openai-compatible' ? 'openai-compatible' : 'lmstudio'
      })
      resetAIConnectionFeedback(app)
      app.setStatus('status.aiSettingsSaved')
      app.render()
      return
    case 'ai.baseUrl':
      app.updatePreferences((preferences) => {
        preferences.ai.baseUrl = value.trim() || DEFAULT_LM_STUDIO_URL
      })
      resetAIConnectionFeedback(app)
      app.setStatus('status.aiSettingsSaved')
      app.render()
      return
    case 'ai.apiKey':
      app.updatePreferences((preferences) => {
        preferences.ai.apiKey = value.trim()
      })
      resetAIConnectionFeedback(app)
      app.setStatus('status.aiSettingsSaved')
      app.render()
      return
    case 'ai.model':
      app.updatePreferences((preferences) => {
        preferences.ai.model = value.trim()
      })
      resetAIConnectionFeedback(app)
      app.setStatus('status.aiSettingsSaved')
      app.render()
      return
    case 'ai.maxTokens':
      app.updatePreferences((preferences) => {
        preferences.ai.maxTokens = normalizeAIMaxTokens(value)
      })
      app.setStatus('status.aiSettingsSaved')
      app.render()
      return
    case 'ai.timeoutSeconds':
      app.updatePreferences((preferences) => {
        preferences.ai.timeoutSeconds = normalizeAITimeoutSeconds(value)
      })
      resetAIConnectionFeedback(app)
      app.setStatus('status.aiSettingsSaved')
      app.render()
      return
    default:
      break
  }
}

export async function importFile(app: MindMapApp, file: File, mode: PendingImportMode = 'auto'): Promise<void> {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  const isRuleFormat = ['md', 'markdown', 'txt'].includes(extension)

  if (mode === 'ai' || (!isRuleFormat && mode === 'auto')) {
    await importFileWithAI(app, file)
    return
  }

  const format = extension === 'md' || extension === 'markdown' ? 'markdown' : 'text'

  try {
    const content = await file.text()
    const importedDocument = await api.importDocument(content, format)
    if (app.state.currentMapId) {
      importedDocument.id = app.state.currentMapId
    }
    ops.captureHistory(app)
    app.state.document = importedDocument
    app.setSelection([findRoot(importedDocument).id], findRoot(importedDocument).id)
    app.state.connectSourceNodeId = null
    app.viewport.scale = 1
    app.didInitializeViewport = false
    app.setStatus('status.imported', { filename: file.name })
    app.applyTheme()
    app.render()
    await saveDocument(app, 'status.importedSaved')
  } catch (error) {
    app.setStatus('status.importFailed', { reason: getErrorMessage(error) })
    app.render()
  }
}

export async function showPlatformHelp(app: MindMapApp): Promise<void> {
  const mapId = app.state.currentMapId || app.state.document.id
  if (!app.collabApiKey) {
    app.generateCollabApiKey()
    await saveCollabApiKey(app)
  }
  const token = await api.createShareToken({
    mapId,
    accessLevel: 'viewer',
    displayName: 'Web Viewer',
    expiresIn: '168h',
    ownerApiKey: app.collabApiKey,
  })
  const encodedMapId = encodeURIComponent(mapId)
  const encodedSecret = encodeURIComponent(token.secret)
  const wsURL = `ws://127.0.0.1:34118/ws?mapId=${encodedMapId}&token=${encodedSecret}`
  const localDebugURL = `http://127.0.0.1:34117/share/${encodedMapId}?token=${encodedSecret}`
  const wssURL = `wss://your-domain.example/ws?mapId=${encodedMapId}&token=${encodedSecret}`
  const shareBlock = [
    '已一键开启 viewer 分享，有效期 7 天。',
    `当前 mapId：${mapId}`,
    `Token ID：${token.id}`,
    `本地调试网页：${localDebugURL}`,
    `WebSocket 客户端地址：${wsURL}`,
    `公网反代后地址：${wssURL}`,
    '注意：WebSocket 地址不是普通网页地址，不能直接粘到浏览器地址栏打开；需要由网页协作客户端或反向代理后的协作页面连接。',
  ].join('\n')

  const content = [
    'Code Mind 平台功能入口',
    '',
    '1. MCP 化',
    '构建：go build -o codemind-mcp.exe ./cmd/mcp',
    '配置：CODEMIND_API_URL=http://127.0.0.1:34117',
    app.collabApiKey
      ? '配置：CODEMIND_API_KEY=当前设置页中的协作 API Key'
      : '配置：如启用 API Key，请到设置页生成并复制。',
    '',
    '2. VS Code 插件调用',
    '打开 VS Code 左侧 Code Mind 面板，配置 codeMind.apiUrl 与 codeMind.apiKey。',
    '命令面板运行：Code Mind: Getting Started',
    '',
    '3. 网页协作/互联网分享',
    shareBlock,
    '公网分享建议将 HTTPS 代理到 34117，将 WSS /ws 代理到 34118。',
    '',
    '完整说明见 docs/platform-usage.md',
  ].join('\n')

  try {
    await navigator.clipboard.writeText(content)
    app.showToast(app.t('toast.platformHelpCopied'))
  } catch {
    window.alert(content)
  }
}

export async function runNodeGestureAction(
  app: MindMapApp,
  action: GestureAction,
  nodeId: string,
  origin?: { clientX?: number; clientY?: number; pointerId?: number },
): Promise<void> {
  const node = app.findNode(nodeId)
  if (!node) {
    return
  }

  app.setSelection([nodeId], nodeId)

  switch (action) {
    case 'rename':
      editor.openNodeEditor(app, nodeId, { selection: 'all' })
      return
    case 'edit-tail':
      editor.openNodeEditor(app, nodeId, { selection: 'end' })
      return
    case 'pan-canvas':
      if (
        typeof origin?.pointerId === 'number' &&
        typeof origin.clientX === 'number' &&
        typeof origin.clientY === 'number'
      ) {
        pointer.startCanvasPan(app, origin.pointerId, origin.clientX, origin.clientY)
      }
      return
    case 'ai-quick':
      await applyAIQuickAssist(app, nodeId)
      return
    case 'ai-suggest-children':
      await applyAISuggestNodes(app, nodeId, 'children')
      return
    case 'ai-suggest-siblings':
      await applyAISuggestNodes(app, nodeId, 'siblings')
      return
    case 'ai-wheel':
      openAIWheel(app, nodeId, origin?.clientX, origin?.clientY)
      return
    case 'new-child':
      ops.createChildNode(app, nodeId)
      return
    case 'new-sibling':
      ops.createSiblingNode(app, nodeId)
      return
    case 'new-floating':
      ops.createFloatingNode(app, nodeId)
      return
    case 'toggle-collapse':
      ops.toggleNodeCollapse(app, nodeId)
      return
    case 'none':
    default:
      return
  }
}
