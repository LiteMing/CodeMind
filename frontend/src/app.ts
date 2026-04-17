import { api } from './api'
import type {
  ActiveEditorPreviewState,
  AIDebugAction,
  AINoteTargetState,
  AppState,
  CopiedSubtree,
  DragState,
  EditorLaunchOptions,
  FixedMenuId,
  GraphDragState,
  HistorySnapshot,
  MarqueeState,
  MidpointDragState,
  PanState,
  PendingImportMode,
  ShellRefs,
} from './app-types'
import {
  NODE_COLOR_PALETTES,
  NODE_COLOR_VALUES,
  normalizeNodeColor,
  resolveNodeColorPalette,
  buildNodeColorStyle,
  rgbaFromRgb,
  applyAlphaToHex,
} from './color-palette'
import {
  autoLayoutHierarchy,
  childrenOf,
  connectedRelations,
  createDefaultDocument,
  createId,
  createNode,
  deleteRelation,
  descendantIds,
  findNode,
  findRoot,
  hiddenDescendantCount,
  nextChildPosition,
  nextFloatingPosition,
  nextSiblingPosition,
  toggleCollapse,
  touchDocument,
  updateRelationLabel,
  visibleNodeIds,
} from './document'
import {
  type NodeRenderMetrics,
  buildHierarchyPath,
  resolveHierarchyEdgeEndpoints,
  resolveRelationEdgeEndpoints,
  resolveNodeAnchorToward,
  buildRelationSegmentPath,
  getRelationDefaultMidpoint,
} from './edge-geometry'
import { type GraphHitNode, buildGraphFrame, traceRoundedRectPath } from './graph-frame'
import { type TranslationKey, kindLabel, nodeColorLabel, themeLabel, translate } from './i18n'
import {
  buildNodeDimensionStyle,
  nodeVisibleTitle,
  normalizeNodeNote,
  deriveNoteChildTitle,
  MIN_NODE_WIDTH,
  MIN_NODE_HEIGHT,
} from './node-render'
import { estimateNodeHeight, estimateNodeWidth, TOPIC_NODE_MAX_WIDTH } from './node-sizing'
import {
  DEFAULT_AI_MAX_TOKENS,
  DEFAULT_AI_TIMEOUT_SECONDS,
  DEFAULT_CHILD_GAP_X,
  DEFAULT_LM_STUDIO_URL,
  loadPreferences,
  normalizeAIMaxTokens,
  normalizeAITimeoutSeconds,
  normalizeCanvasDragAction,
  normalizeChildGapX,
  normalizeChromeLayout,
  normalizeEdgeStyle,
  normalizeGestureAction,
  normalizeLayoutMode,
  normalizeTopPanelPosition,
  savePreferences,
} from './preferences'
import { listLocalSnapshots, loadLocalSnapshot, saveLocalSnapshot, type LocalSnapshotSummary } from './snapshots'
import {
  AI_TEMPLATES,
  normalizeAITemplateId,
  templateLabel,
  promptTemplateCopy,
  createTemplateDocument,
  normalizedRelationPairKey,
} from './templates'
import type {
  AIDebugInfo,
  AIDebugRequest,
  AppPreferences,
  AITemplateId,
  ArrowDirection,
  CanvasDragAction,
  GestureAction,
  EdgeStyle,
  Locale,
  MindMapDocument,
  MindMapSummary,
  MindNode,
  NodeColor,
  Position,
  Priority,
  RegionBox,
  RelationEdge,
  Theme,
} from './types'
import {
  clamp,
  clampMin,
  cloneDocument,
  directionalCrossDelta,
  directionalPrimaryDelta,
  downloadTextFile,
  escapeAttribute,
  escapeHtml,
  formatRelativeTime,
  getAIDebugInfo,
  getErrorMessage,
  getWorkspaceBounds,
  isTypingTarget,
  nodeCenter,
  normalizeClientRect,
  parsePixelValue,
  rectanglesIntersect,
  rectanglesOverlapCoords,
  requiredElement,
  shorten,
  slugify,
  type WorkspaceBounds,
  WORKSPACE_MIN_WIDTH,
  WORKSPACE_MIN_HEIGHT,
} from './utils'

const MIN_ZOOM = 0.4
const MAX_ZOOM = 2.4
const ZOOM_SENSITIVITY = 0.0018
const AUTO_NODE_EDITOR_MAX_WIDTH = TOPIC_NODE_MAX_WIDTH
const DRAG_SNAP_THRESHOLD = 18
const AUTO_SNAPSHOT_MIN_INTERVAL_MS = 2 * 60 * 1000
const HISTORY_LIMIT = 120
const GRAPH_DEFAULT_ZOOM = 1.16
const GRAPH_MIN_ZOOM = 0.68
const GRAPH_MAX_ZOOM = 1.92
const GRAPH_ZOOM_SENSITIVITY = 0.0012
const NODE_GESTURE_MULTI_CLICK_DELAY_MS = 240
const NODE_LONG_PRESS_DELAY_MS = 520
const NODE_LONG_PRESS_MOVE_THRESHOLD = 10
const RELATION_HANDLE_LONG_PRESS_DELAY_MS = 320
const RELATION_HANDLE_MOVE_THRESHOLD = 8
const IMPORT_FILE_ACCEPT =
  '.md,.markdown,.txt,.json,.csv,.tsv,.html,.htm,.xml,.opml,.mermaid,.mmd,.yaml,.yml,.toml,.ini,.cfg,.log,.rst,text/plain,text/markdown,application/json,text/csv,text/html,application/xml,text/xml'
const PRIORITY_VALUES: Priority[] = ['', 'P0', 'P1', 'P2', 'P3']

export async function createApp(rootEl: HTMLElement): Promise<void> {
  const app = new MindMapApp(rootEl)
  await app.mount()
}

class MindMapApp {
  private readonly rootEl: HTMLElement
  private autosaveHandle: number | null = null
  private refs: ShellRefs | null = null
  private pan: PanState | null = null
  private graphDrag: GraphDragState | null = null
  private didInitializeViewport = false
  private viewport = { x: 0, y: 0, scale: 1 }
  private historyPast: HistorySnapshot[] = []
  private historyFuture: HistorySnapshot[] = []
  private liveCanvasHandle: number | null = null
  private liveNodeIds = new Set<string>()
  private liveNodeDimensionIds = new Set<string>()
  private graphAnimationHandle: number | null = null
  private graphHitNodes: GraphHitNode[] = []
  private copiedSubtree: CopiedSubtree | null = null
  private suppressContextMenuOnce = false
  private suppressClickOnce = false
  private pendingNodeGestureHandle: number | null = null
  private pendingNodeGestureNodeId: string | null = null
  private longPressHandle: number | null = null
  private longPressState: {
    pointerId: number
    nodeId: string
    button: number
    startClientX: number
    startClientY: number
    clientX: number
    clientY: number
    dragNodeIds: string[]
    activated: boolean
  } | null = null
  private pendingEditorOptions: EditorLaunchOptions | null = null
  private activeEditorAnchorLeft: number | null = null
  private activeEditorPreview: ActiveEditorPreviewState | null = null
  private editingOriginalTitle: string | null = null
  private nodeEditorMeasureCanvas: HTMLCanvasElement | null = null
  private pendingImportMode: PendingImportMode = 'auto'
  private workspaceBounds: WorkspaceBounds = {
    minX: 0,
    minY: 0,
    width: WORKSPACE_MIN_WIDTH,
    height: WORKSPACE_MIN_HEIGHT,
    originX: 0,
    originY: 0,
  }
  private state: AppState

  constructor(rootEl: HTMLElement) {
    this.rootEl = rootEl
    this.state = {
      document: createDefaultDocument(),
      view: 'home',
      maps: [],
      currentMapId: null,
      snapshotDraftName: '',
      selectedNodeId: 'root',
      selectedNodeIds: ['root'],
      selectedRegionId: null,
      editingNodeId: null,
      connectSourceNodeId: null,
      drag: null,
      resize: null,
      contextMenu: null,
      marquee: null,
      status: { key: 'status.loading' },
      preferences: loadPreferences(),
      settingsOpen: false,
      topPanelCollapsed: false,
      fixedMenu: '',
      inspectorCollapsed: true,
      aiWheel: {
        open: false,
        nodeId: null,
        clientX: 0,
        clientY: 0,
      },
      ai: {
        open: false,
        busy: false,
        testing: false,
        debugOpen: false,
        rawMode: false,
        template: 'concept-graph',
        topic: '',
        generationInstructions: '',
        importInstructions: '',
        noteInstructions: '',
        relationInstructions: '',
        generateRawRequest: '',
        importRawRequest: '',
        noteRawRequest: '',
        relationRawRequest: '',
        lastSummary: '',
        lastModel: '',
        lastDebugAction: '',
        lastDebugInfo: null,
        lastDebugError: '',
        connectionMessage: '',
        connectionModel: '',
        connectionOK: null,
      },
      graph: {
        open: false,
        search: '',
        selectedNodeId: null,
        autoRotate: false,
        rotation: 0.72,
        tilt: 0.18,
        zoom: GRAPH_DEFAULT_ZOOM,
      },
      selectedRelationId: null,
      regionDraw: null,
      regionDrag: null,
      connectorDrag: null,
      midpointDrag: null,
    }

    this.applyLocale()
    this.applyTheme()
    this.bindEvents()
  }

  async mount(): Promise<void> {
    try {
      await this.refreshMaps('status.mapListLoaded')
    } catch (error) {
      this.setStatus('status.mapListFailed', { reason: getErrorMessage(error) })
    }

    this.render()
  }

  private bindEvents(): void {
    this.rootEl.addEventListener('click', this.handleClick)
    this.rootEl.addEventListener('contextmenu', this.handleContextMenu)
    this.rootEl.addEventListener('dblclick', this.handleDoubleClick)
    this.rootEl.addEventListener('pointerdown', this.handlePointerDown)
    this.rootEl.addEventListener('keydown', this.handleEditorKeyDown)
    this.rootEl.addEventListener('focusout', this.handleFocusOut, true)
    this.rootEl.addEventListener('input', this.handleInput)
    this.rootEl.addEventListener('change', this.handleChange)
    this.rootEl.addEventListener('wheel', this.handleWheel, { passive: false })
    window.addEventListener('pointermove', this.handlePointerMove)
    window.addEventListener('pointerup', this.handlePointerUp)
    window.addEventListener('pointercancel', this.handlePointerUp)
    window.addEventListener('keydown', this.handleGlobalKeyDown)
    window.addEventListener('resize', this.handleWindowResize)
  }

  private readonly handleWindowResize = (): void => {
    this.syncFloatingLayout()
  }

  private readonly handleClick = (event: MouseEvent): void => {
    const target = event.target
    if (!(target instanceof HTMLElement)) {
      return
    }

    if (this.suppressClickOnce) {
      this.suppressClickOnce = false
      return
    }

    const nodeButton = target.closest<HTMLElement>('[data-node-button]')
    const keepPendingGesture = nodeButton?.dataset.nodeButton === this.pendingNodeGestureNodeId && event.detail >= 2
    if (!keepPendingGesture) {
      this.cancelPendingNodeGesture()
    }

    const closedContextMenu = Boolean(this.state.contextMenu) && !target.closest('[data-context-menu]')
    const closedFixedMenu = this.state.fixedMenu !== '' && !target.closest('[data-fixed-menu-shell]')
    const closedAIWheel = this.state.aiWheel.open && !target.closest('[data-ai-wheel]')
    if (closedContextMenu) {
      this.state.contextMenu = null
    }
    if (closedFixedMenu) {
      this.state.fixedMenu = ''
    }
    if (closedAIWheel) {
      this.closeAIWheel()
    }

    const settingsScrim = target.closest<HTMLElement>('[data-settings-scrim]')
    if (settingsScrim && target === settingsScrim) {
      this.closeSettings()
      return
    }

    const aiScrim = target.closest<HTMLElement>('[data-ai-scrim]')
    if (aiScrim && target === aiScrim) {
      this.closeAIWorkspace()
      return
    }

    const graphScrim = target.closest<HTMLElement>('[data-graph-scrim]')
    if (graphScrim && target === graphScrim) {
      this.closeGraphOverlay()
      return
    }

    const localeOption = target.closest<HTMLElement>('[data-locale-option]')?.dataset.localeOption as Locale | undefined
    if (localeOption) {
      this.setLocale(localeOption, false)
      return
    }

    const command = target.closest<HTMLElement>('[data-command]')?.dataset.command
    const clickedNodeEditor = target.closest<HTMLTextAreaElement>('[data-node-editor]')
    const clickedWorkspace = target.closest<HTMLElement>('[data-workspace-scroll]')
    const clickedRegion = target.closest<HTMLElement>('[data-region-id]')
    if (command) {
      if (!command.startsWith('toggle-fixed-menu')) {
        this.state.fixedMenu = ''
      }
      if (this.state.editingNodeId && !clickedNodeEditor) {
        this.finishActiveNodeEditing()
      }
      this.state.contextMenu = null
      void this.runCommand(command)
      return
    }

    const priority = target.closest<HTMLElement>('[data-priority]')?.dataset.priority as Priority | undefined
    if (priority !== undefined) {
      if (this.state.editingNodeId && !clickedNodeEditor) {
        this.finishActiveNodeEditing()
      }
      this.setPriority(priority)
      return
    }

    const nodeColor = target.closest<HTMLElement>('[data-node-color]')?.dataset.nodeColor as NodeColor | undefined
    if (nodeColor !== undefined) {
      if (this.state.editingNodeId && !clickedNodeEditor) {
        this.finishActiveNodeEditing()
      }
      this.setNodeColor(normalizeNodeColor(nodeColor))
      return
    }

    if (target.closest('[data-graph-canvas]')) {
      this.selectGraphNodeAtPoint(event.clientX, event.clientY)
      return
    }

    const graphResultNodeId = target.closest<HTMLElement>('[data-graph-node-result]')?.dataset.graphNodeResult
    if (graphResultNodeId) {
      this.state.graph.selectedNodeId = graphResultNodeId
      this.updateGraphSummaryPanel()
      this.drawGraphScene()
      return
    }

    if (this.overlayBlocksCanvas()) {
      return
    }

    if (clickedNodeEditor) {
      return
    }

    if (this.state.editingNodeId) {
      this.finishActiveNodeEditing()
    }

    if (nodeButton?.dataset.nodeButton) {
      const nodeId = nodeButton.dataset.nodeButton
      if (this.state.connectSourceNodeId && this.state.connectSourceNodeId !== nodeId) {
        this.createRelation(this.state.connectSourceNodeId, nodeId)
        return
      }

      if (!event.shiftKey && !event.ctrlKey && !event.metaKey && event.detail >= 3) {
        event.preventDefault()
        this.cancelPendingNodeGesture()
        this.setSelection([nodeId], nodeId)
        void this.runNodeGestureAction(this.state.preferences.interaction.tripleClickAction, nodeId, {
          clientX: event.clientX,
          clientY: event.clientY,
        })
        return
      }

      if (!event.shiftKey && !event.ctrlKey && !event.metaKey && event.detail === 2) {
        event.preventDefault()
        this.setSelection([nodeId], nodeId)
        this.scheduleNodeGestureAction(nodeId, event.clientX, event.clientY)
        return
      }

      if (event.shiftKey) {
        this.selectNodeSubtree(nodeId)
        return
      }

      if (event.ctrlKey || event.metaKey) {
        this.toggleNodeSelection(nodeId)
        return
      }

      this.selectNode(nodeId)
      return
    }

    if (clickedRegion?.dataset.regionId) {
      this.selectRegion(clickedRegion.dataset.regionId)
      this.render()
      return
    }

    if (closedContextMenu || closedFixedMenu || closedAIWheel) {
      this.renderOverlay()
      this.renderHeader()
    }

    if (clickedWorkspace) {
      this.clearSelection()
    }
  }

  private readonly handleContextMenu = (event: MouseEvent): void => {
    if (this.state.view !== 'map' || this.overlayBlocksCanvas()) {
      return
    }

    event.preventDefault()
    if (this.suppressContextMenuOnce) {
      this.suppressContextMenuOnce = false
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
        this.state.selectedRelationId = relationId
        this.state.selectedRegionId = null
        this.applySelectionState([], null)
        this.state.contextMenu = {
          clientX: event.clientX,
          clientY: event.clientY,
          nodeId: null,
          relationId,
        }
        this.render()
        return
      }
    }

    // Check for right-click on region box
    const regionEl = element?.closest<HTMLElement>('[data-region-id]')
    if (regionEl) {
      const regionId = regionEl.dataset.regionId
      if (regionId) {
        this.selectRegion(regionId)
        this.state.contextMenu = {
          clientX: event.clientX,
          clientY: event.clientY,
          nodeId: null,
          regionId,
        }
        this.render()
        return
      }
    }

    const nodeId = element?.closest<HTMLElement>('[data-node-button]')?.dataset.nodeButton ?? null
    if (nodeId && !this.state.selectedNodeIds.includes(nodeId)) {
      this.setSelection([nodeId], nodeId)
    }

    this.state.contextMenu = {
      clientX: event.clientX,
      clientY: event.clientY,
      nodeId,
    }
    this.render()
  }

  private readonly handleDoubleClick = (event: MouseEvent): void => {
    const target = event.target
    if (target instanceof HTMLElement && target.closest('[data-graph-canvas]')) {
      const nodeId = this.selectGraphNodeAtPoint(event.clientX, event.clientY)
      if (nodeId) {
        this.focusNodeFromGraph(nodeId)
      }
      return
    }

    if (this.overlayBlocksCanvas()) {
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

  private readonly handlePointerDown = (event: PointerEvent): void => {
    const target = event.target
    const element = target instanceof Element ? target : null
    if (element && this.state.graph.open) {
      const graphCanvas = element.closest<HTMLCanvasElement>('[data-graph-canvas]')
      if (graphCanvas && event.button === 0) {
        this.graphDrag = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          startRotation: this.state.graph.rotation,
          startTilt: this.state.graph.tilt,
        }
        event.preventDefault()
        graphCanvas.setPointerCapture(event.pointerId)
        graphCanvas.classList.add('is-dragging')
        return
      }
    }

    if (this.state.view !== 'map' || this.overlayBlocksCanvas()) {
      return
    }

    if (!element) {
      return
    }

    if (element.closest('[data-node-editor]')) {
      return
    }

    // Handle connector dot long-press drag to create connection
    const connectorDot = element.closest<HTMLElement>('[data-node-connector]')
    if (connectorDot && event.button === 0) {
      const sourceNodeId = connectorDot.dataset.nodeConnector
      if (sourceNodeId) {
        this.state.connectorDrag = {
          sourceNodeId,
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
        const originMidpoint = this.resolveRelationMidpointPosition(relationId)
        if (!originMidpoint) {
          return
        }
        this.state.midpointDrag = {
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
              this.state.midpointDrag?.relationId !== relationId ||
              this.state.midpointDrag.pointerId !== event.pointerId
            ) {
              return
            }
            if (this.state.midpointDrag.mode !== 'pending') {
              return
            }
            this.state.midpointDrag.mode = 'branch'
            this.setStatus('status.connectionBranchMode')
            this.renderWorkspace()
          }, RELATION_HANDLE_LONG_PRESS_DELAY_MS),
        }
        this.state.selectedRelationId = relationId
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
        this.state.selectedRelationId = this.state.selectedRelationId === relationId ? null : relationId
        this.state.selectedNodeId = null
        this.state.selectedNodeIds = []
        this.state.selectedRegionId = null
        this.renderWorkspace()
        event.preventDefault()
        return
      }
    }

    // Handle region box drag
    const regionDragEl = element.closest<HTMLElement>('[data-region-drag]')
    if (regionDragEl && event.button === 0 && !this.state.regionDraw) {
      const regionId = regionDragEl.dataset.regionDrag
      const region = this.state.document.regions?.find((r) => r.id === regionId)
      if (region) {
        this.selectRegion(region.id)
        const docPos = this.clientToCanvasPosition(event.clientX, event.clientY)
        const nodesInRegion = this.nodesInRegion(region)
        const initialNodePositions: Record<string, Position> = {}
        for (const node of nodesInRegion) {
          initialNodePositions[node.id] = { ...node.position }
        }
        this.state.regionDrag = {
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
    if (this.state.regionDraw && this.state.regionDraw.pointerId === -1 && event.button === 0) {
      const docPos = this.clientToCanvasPosition(event.clientX, event.clientY)
      this.state.regionDraw.pointerId = event.pointerId
      this.state.regionDraw.startCanvasX = docPos.x
      this.state.regionDraw.startCanvasY = docPos.y
      this.state.regionDraw.currentCanvasX = docPos.x
      this.state.regionDraw.currentCanvasY = docPos.y
      this.setStatus('status.regionDrawing')
      event.preventDefault()
      return
    }

    const nodeButton = element.closest<HTMLElement>('[data-node-button]')
    const nodeId = nodeButton?.dataset.nodeButton
    const longPressAction = this.longPressActionForButton(event.button)
    const keepPendingGesture = nodeId === this.pendingNodeGestureNodeId && event.detail >= 2
    if (!keepPendingGesture) {
      this.cancelPendingNodeGesture()
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
      const node = this.findNode(resizeNodeId)
      if (!node || node.kind === 'root') {
        return
      }

      const childCount = childrenOf(this.state.document, node.id).length
      const currentWidth = node.width ?? estimateNodeWidth(node, childCount)
      const currentHeight = node.height ?? estimateNodeHeight(node, childCount, currentWidth)

      this.state.resize = {
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

    if (element.closest('[data-node-collapse-button]')) {
      event.preventDefault()
      return
    }

    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      return
    }

    if (!nodeId) {
      this.clearNodeLongPress()
      const withinScroll = element.closest<HTMLElement>('[data-workspace-scroll]')
      if (!withinScroll) {
        return
      }

      const canvasAction = this.canvasDragActionForButton(event.button)
      if (canvasAction === 'none') {
        return
      }

      this.startCanvasDragAction(canvasAction, event)
      event.preventDefault()
      return
    }

    if (!this.state.selectedNodeIds.includes(nodeId)) {
      this.setSelection([nodeId], nodeId)
    }

    const node = this.findNode(nodeId)
    const selectedDragIds = this.state.selectedNodeIds.includes(nodeId) ? this.state.selectedNodeIds : [nodeId]
    const dragNodeIds = this.resolveDragNodeIds(selectedDragIds)

    if (event.detail >= 2) {
      this.clearNodeLongPress()
      return
    }

    if (
      !node ||
      (event.button === 0 && dragNodeIds.length === 0) ||
      this.state.editingNodeId === nodeId ||
      this.state.connectSourceNodeId !== null
    ) {
      this.clearNodeLongPress()
      return
    }

    if (longPressAction !== 'none') {
      this.armNodeLongPress(nodeId, dragNodeIds, event)
      event.preventDefault()
      return
    }

    this.clearNodeLongPress()
    if (event.button === 0) {
      this.startNodeDrag(nodeId, dragNodeIds, event)
    }
  }

  private resolveDragNodeIds(baseNodeIds: string[]): string[] {
    const dragNodeIds: string[] = []
    const seen = new Set<string>()

    for (const baseNodeId of baseNodeIds) {
      const baseNode = this.findNode(baseNodeId)
      if (!baseNode || baseNode.kind === 'root' || seen.has(baseNodeId)) {
        continue
      }

      seen.add(baseNodeId)
      dragNodeIds.push(baseNodeId)

      if (!this.state.preferences.interaction.dragSubtreeWithParent) {
        continue
      }

      for (const descendantId of descendantIds(this.state.document, baseNodeId)) {
        const descendant = this.findNode(descendantId)
        if (!descendant || descendant.kind === 'root' || seen.has(descendantId)) {
          continue
        }

        seen.add(descendantId)
        dragNodeIds.push(descendantId)
      }
    }

    return dragNodeIds
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (this.graphDrag && event.pointerId === this.graphDrag.pointerId) {
      const deltaX = event.clientX - this.graphDrag.startX
      const deltaY = event.clientY - this.graphDrag.startY
      this.state.graph.rotation = this.graphDrag.startRotation + deltaX * 0.0085
      this.state.graph.tilt = clamp(this.graphDrag.startTilt + deltaY * 0.0055, -1.1, 1.1)
      this.drawGraphScene()
      event.preventDefault()
      return
    }

    if (this.state.view !== 'map') {
      return
    }

    // Connector dot drag
    if (this.state.connectorDrag && event.pointerId === this.state.connectorDrag.pointerId) {
      this.state.connectorDrag.currentClientX = event.clientX
      this.state.connectorDrag.currentClientY = event.clientY
      this.renderWorkspace()
      event.preventDefault()
      return
    }

    // Midpoint dot drag
    if (this.state.midpointDrag && event.pointerId === this.state.midpointDrag.pointerId) {
      this.state.midpointDrag.currentClientX = event.clientX
      this.state.midpointDrag.currentClientY = event.clientY
      const dragState = this.state.midpointDrag
      if (dragState.mode === 'pending') {
        const moved = Math.hypot(event.clientX - dragState.startClientX, event.clientY - dragState.startClientY)
        if (moved > RELATION_HANDLE_MOVE_THRESHOLD) {
          this.clearMidpointDragLongPress(dragState)
          dragState.mode = 'move'
        }
      }
      this.renderWorkspace()
      event.preventDefault()
      return
    }

    // Region draw mode
    if (
      this.state.regionDraw &&
      this.state.regionDraw.pointerId !== -1 &&
      event.pointerId === this.state.regionDraw.pointerId
    ) {
      const docPos = this.clientToCanvasPosition(event.clientX, event.clientY)
      this.state.regionDraw.currentCanvasX = docPos.x
      this.state.regionDraw.currentCanvasY = docPos.y
      this.renderRegionDrawPreview()
      event.preventDefault()
      return
    }

    // Region drag
    if (this.state.regionDrag) {
      const docPos = this.clientToCanvasPosition(event.clientX, event.clientY)
      const region = this.state.document.regions?.find((r) => r.id === this.state.regionDrag!.regionId)
      if (region) {
        const newRegionX = docPos.x - this.state.regionDrag.offsetX
        const newRegionY = docPos.y - this.state.regionDrag.offsetY
        if (
          !this.state.regionDrag.historyCaptured &&
          (Math.abs(newRegionX - region.position.x) > 0.5 || Math.abs(newRegionY - region.position.y) > 0.5)
        ) {
          this.captureHistory()
          this.state.regionDrag.historyCaptured = true
        }
        const dx = newRegionX - this.state.regionDrag.initialPosition.x
        const dy = newRegionY - this.state.regionDrag.initialPosition.y
        region.position = { x: newRegionX, y: newRegionY }
        // Move contained nodes
        const movedNodeIds: string[] = []
        for (const [nodeId, initialPos] of Object.entries(this.state.regionDrag.initialNodePositions)) {
          const node = this.findNode(nodeId)
          if (node) {
            node.position = {
              x: initialPos.x + dx,
              y: initialPos.y + dy,
            }
            movedNodeIds.push(nodeId)
          }
        }
        this.applyLiveRegionDrag(region, movedNodeIds)
      }
      event.preventDefault()
      return
    }

    if (this.longPressState && event.pointerId === this.longPressState.pointerId) {
      this.longPressState.clientX = event.clientX
      this.longPressState.clientY = event.clientY
      if (
        !this.longPressState.activated &&
        Math.hypot(event.clientX - this.longPressState.startClientX, event.clientY - this.longPressState.startClientY) >
          NODE_LONG_PRESS_MOVE_THRESHOLD
      ) {
        const { nodeId, dragNodeIds, button } = this.longPressState
        const action = this.longPressActionForButton(button)
        this.clearNodeLongPress()
        if (action === 'pan-canvas') {
          if (button === 2) {
            this.suppressContextMenuOnce = true
          }
          this.startCanvasPan(event.pointerId, event.clientX, event.clientY)
        } else if (button === 0 && dragNodeIds.length > 0) {
          this.startNodeDrag(nodeId, dragNodeIds, event)
        }
      }
    }

    if (this.state.marquee && event.pointerId === this.state.marquee.pointerId) {
      this.state.marquee.currentClientX = event.clientX
      this.state.marquee.currentClientY = event.clientY
      if (!this.state.marquee.active) {
        const deltaX = event.clientX - this.state.marquee.startClientX
        const deltaY = event.clientY - this.state.marquee.startClientY
        if (Math.hypot(deltaX, deltaY) > 8) {
          this.state.marquee.active = true
          this.suppressClickOnce = true
        }
      }
      this.renderOverlay()
      if (this.state.marquee.active) {
        event.preventDefault()
      }
      return
    }

    if (this.state.resize) {
      const resizeState = this.state.resize
      const deltaX = event.clientX - resizeState.startX
      const deltaY = event.clientY - resizeState.startY
      if (!resizeState.historyCaptured && (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1)) {
        this.captureHistory()
        resizeState.historyCaptured = true
        this.renderHeader()
      }

      const nextWidth = clampMin(resizeState.startWidth + deltaX / this.viewport.scale, MIN_NODE_WIDTH)
      const nextHeight = clampMin(resizeState.startHeight + deltaY / this.viewport.scale, MIN_NODE_HEIGHT)

      this.updateNode(resizeState.nodeId, (node) => {
        node.width = Math.round(nextWidth)
        node.height = Math.round(nextHeight)
        node.position = {
          x: Math.round(resizeState.anchorLeft + nextWidth / 2),
          y: Math.round(resizeState.anchorTop + nextHeight / 2),
        }
      })
      this.scheduleLiveNodeUpdate(resizeState.nodeId, true)
      return
    }

    if (this.pan) {
      this.handleCanvasPan(event)
      return
    }

    if (!this.state.drag) {
      return
    }

    const pointerPosition = this.clientToCanvasPosition(event.clientX, event.clientY)
    const nextPosition = {
      x: pointerPosition.x - this.state.drag.offsetX,
      y: pointerPosition.y - this.state.drag.offsetY,
    }
    const currentNode = this.findNode(this.state.drag.nodeId)

    if (
      currentNode &&
      !this.state.drag.historyCaptured &&
      (Math.abs(nextPosition.x - currentNode.position.x) > 0.5 ||
        Math.abs(nextPosition.y - currentNode.position.y) > 0.5)
    ) {
      this.captureHistory()
      this.state.drag.historyCaptured = true
      this.renderHeader()
    }

    const anchorStart = this.state.drag.initialPositions[this.state.drag.nodeId]
    if (!anchorStart) {
      return
    }

    const rawDeltaX = nextPosition.x - anchorStart.x
    const rawDeltaY = nextPosition.y - anchorStart.y
    const { deltaX, deltaY } = this.state.preferences.interaction.dragSnap
      ? this.resolveSnappedDragDelta(this.state.drag, rawDeltaX, rawDeltaY)
      : { deltaX: rawDeltaX, deltaY: rawDeltaY }
    for (const candidateId of this.state.drag.nodeIds) {
      const candidateStart = this.state.drag.initialPositions[candidateId]
      if (!candidateStart) {
        continue
      }

      this.updateNode(candidateId, (node) => {
        node.position = {
          x: candidateStart.x + deltaX,
          y: candidateStart.y + deltaY,
        }
      })
      this.scheduleLiveNodeUpdate(candidateId)
    }
  }

  private resolveSnappedDragDelta(
    dragState: DragState,
    deltaX: number,
    deltaY: number,
  ): { deltaX: number; deltaY: number } {
    const draggedNodeIDs = new Set(dragState.nodeIds)
    return {
      deltaX: this.resolveDragAxisSnap(dragState, deltaX, 'x', draggedNodeIDs),
      deltaY: this.resolveDragAxisSnap(dragState, deltaY, 'y', draggedNodeIDs),
    }
  }

  private resolveDragAxisSnap(
    dragState: DragState,
    delta: number,
    axis: 'x' | 'y',
    draggedNodeIDs: Set<string>,
  ): number {
    let bestOffset: number | null = null

    for (const nodeId of dragState.nodeIds) {
      const start = dragState.initialPositions[nodeId]
      const node = this.findNode(nodeId)
      if (!start || !node) {
        continue
      }

      const currentValue = (axis === 'x' ? start.x : start.y) + delta
      for (const target of this.dragSnapTargetsForNode(node, axis, draggedNodeIDs)) {
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

  private dragSnapTargetsForNode(node: MindNode, axis: 'x' | 'y', draggedNodeIDs: Set<string>): number[] {
    const targets: number[] = []

    if (axis === 'x' && node.parentId) {
      const parent = this.findNode(node.parentId)
      if (parent) {
        const direction = node.position.x < parent.position.x ? -1 : 1
        const branchGap = Math.max(180, Math.abs(node.position.x - parent.position.x))
        targets.push(parent.position.x + direction * branchGap)
      }

      for (const sibling of childrenOf(this.state.document, node.parentId)) {
        if (sibling.id !== node.id && !draggedNodeIDs.has(sibling.id)) {
          targets.push(sibling.position.x)
        }
      }
    }

    for (const candidate of this.state.document.nodes) {
      if (draggedNodeIDs.has(candidate.id)) {
        continue
      }
      targets.push(axis === 'x' ? candidate.position.x : candidate.position.y)
    }

    return targets
  }

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (this.graphDrag && event.pointerId === this.graphDrag.pointerId) {
      const canvas = this.rootEl.querySelector<HTMLCanvasElement>('[data-graph-canvas]')
      canvas?.classList.remove('is-dragging')
      try {
        canvas?.releasePointerCapture(event.pointerId)
      } catch {
        // Ignore pointer capture release errors when the canvas is already gone.
      }
      this.graphDrag = null
      return
    }

    if (this.state.view !== 'map') {
      return
    }

    // Connector drag finish
    if (this.state.connectorDrag && event.pointerId === this.state.connectorDrag.pointerId) {
      const sourceNodeId = this.state.connectorDrag.sourceNodeId
      // Find target node at pointer position
      const target = document.elementFromPoint(event.clientX, event.clientY)
      const targetEl = target instanceof HTMLElement ? target : null
      const targetConnector = targetEl?.closest<HTMLElement>('[data-node-connector]')
      const targetButton = targetEl?.closest<HTMLElement>('[data-node-button]')
      const targetNodeId = targetConnector?.dataset.nodeConnector ?? targetButton?.dataset.nodeButton
      this.state.connectorDrag = null
      if (targetNodeId && targetNodeId !== sourceNodeId) {
        this.createRelation(sourceNodeId, targetNodeId)
      } else {
        this.renderWorkspace()
      }
      return
    }

    // Midpoint drag finish
    if (this.state.midpointDrag && event.pointerId === this.state.midpointDrag.pointerId) {
      const dragState = this.state.midpointDrag
      const relation = this.state.document.relations.find((r) => r.id === dragState.relationId)
      this.clearMidpointDragLongPress(dragState)
      this.state.midpointDrag = null
      if (!relation) {
        this.renderWorkspace()
        return
      }

      if (dragState.mode === 'branch') {
        const target = document.elementFromPoint(event.clientX, event.clientY)
        const targetEl = target instanceof HTMLElement ? target : null
        const targetConnector = targetEl?.closest<HTMLElement>('[data-node-connector]')
        const targetButton = targetEl?.closest<HTMLElement>('[data-node-button]')
        const targetNodeId = targetConnector?.dataset.nodeConnector ?? targetButton?.dataset.nodeButton ?? null
        if (targetNodeId) {
          this.addBranchTargetToRelation(relation, targetNodeId)
        } else {
          this.renderWorkspace()
        }
        return
      }

      const moved = Math.hypot(event.clientX - dragState.startClientX, event.clientY - dragState.startClientY)
      if (dragState.mode === 'move' || moved > RELATION_HANDLE_MOVE_THRESHOLD) {
        this.moveRelationMidpoint(relation, this.clientToCanvasPosition(event.clientX, event.clientY))
      } else {
        this.renderWorkspace()
      }
      return
    }

    // Region draw finish
    if (
      this.state.regionDraw &&
      this.state.regionDraw.pointerId !== -1 &&
      event.pointerId === this.state.regionDraw.pointerId
    ) {
      const rd = this.state.regionDraw
      const x = Math.min(rd.startCanvasX, rd.currentCanvasX)
      const y = Math.min(rd.startCanvasY, rd.currentCanvasY)
      const w = Math.abs(rd.currentCanvasX - rd.startCanvasX)
      const h = Math.abs(rd.currentCanvasY - rd.startCanvasY)
      this.finishRegionDraw(x, y, w, h)
      return
    }

    // Region drag finish
    if (this.state.regionDrag) {
      const wasMoved = this.state.regionDrag.historyCaptured
      this.state.regionDrag = null
      if (wasMoved) {
        touchDocument(this.state.document)
        this.renderWorkspace()
        this.scheduleAutosave('status.layoutSaveScheduled')
      }
      return
    }

    if (this.longPressState && event.pointerId === this.longPressState.pointerId) {
      this.clearNodeLongPress()
    }

    if (this.state.marquee && event.pointerId === this.state.marquee.pointerId) {
      const marquee = this.state.marquee
      this.state.marquee = null
      if (marquee.active) {
        this.applyMarqueeSelection(marquee)
        this.suppressContextMenuOnce = true
      }
      this.renderOverlay()
      return
    }

    if (this.pan) {
      this.setCanvasPanning(false)
      this.pan = null
    }

    if (this.state.resize) {
      this.flushLiveNodeUpdate()
      const resized = this.state.resize.historyCaptured
      this.state.resize = null
      if (resized) {
        touchDocument(this.state.document)
        this.renderWorkspace()
        this.renderHeader()
        this.scheduleAutosave('status.layoutSaveScheduled')
      }
    }

    if (!this.state.drag) {
      return
    }

    this.flushLiveNodeUpdate()
    const moved = this.state.drag.historyCaptured
    this.state.drag = null
    if (moved) {
      touchDocument(this.state.document)
      this.renderWorkspace()
      this.renderHeader()
      this.scheduleAutosave('status.layoutSaveScheduled')
    }
  }

  private readonly handleWheel = (event: WheelEvent): void => {
    const target = event.target
    if (this.state.graph.open && target instanceof HTMLElement) {
      const graphCanvas = target.closest<HTMLCanvasElement>('[data-graph-canvas]')
      if (graphCanvas) {
        event.preventDefault()
        const zoomFactor = Math.exp(-event.deltaY * GRAPH_ZOOM_SENSITIVITY)
        this.setGraphZoom(this.state.graph.zoom * zoomFactor)
        return
      }
    }

    if (this.state.view !== 'map' || this.overlayBlocksCanvas()) {
      return
    }

    const scroll = this.refs?.scroll
    if (!(target instanceof HTMLElement) || !target.closest('[data-workspace-scroll]') || !scroll) {
      return
    }

    event.preventDefault()
    const rect = scroll.getBoundingClientRect()
    const pointerX = event.clientX - rect.left
    const pointerY = event.clientY - rect.top
    const worldX = (pointerX - this.viewport.x) / this.viewport.scale
    const worldY = (pointerY - this.viewport.y) / this.viewport.scale
    const zoomFactor = Math.exp(-event.deltaY * ZOOM_SENSITIVITY)
    const nextScale = clamp(this.viewport.scale * zoomFactor, MIN_ZOOM, MAX_ZOOM)

    this.viewport.x = pointerX - worldX * nextScale
    this.viewport.y = pointerY - worldY * nextScale
    this.viewport.scale = nextScale
    this.applyCanvasMetrics()
    this.updateCanvasViewportView()
    this.renderInspector()
  }

  private readonly handleGlobalKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.state.settingsOpen) {
      event.preventDefault()
      this.closeSettings()
      return
    }

    if (event.key === 'Escape' && this.state.editingNodeId) {
      event.preventDefault()
      this.cancelNodeEditor()
      return
    }

    const activeTypingTarget = isTypingTarget(document.activeElement)
    if (
      this.state.view !== 'map' ||
      this.onboardingOpen() ||
      this.state.settingsOpen ||
      isTypingTarget(event.target) ||
      activeTypingTarget
    ) {
      return
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      void this.saveDocument('status.saved')
      return
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
      event.preventDefault()
      this.undo()
      return
    }

    if (
      (event.ctrlKey || event.metaKey) &&
      ((event.key.toLowerCase() === 'y' && !event.shiftKey) || (event.key.toLowerCase() === 'z' && event.shiftKey))
    ) {
      event.preventDefault()
      this.redo()
      return
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
      event.preventDefault()
      this.autoLayout()
      return
    }

    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'c') {
      event.preventDefault()
      this.copySelectedSubtree()
      return
    }

    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'v') {
      event.preventDefault()
      this.pasteCopiedSubtree()
      return
    }

    if (event.key === 'Escape' && this.state.regionDraw) {
      event.preventDefault()
      this.state.regionDraw = null
      this.render()
      return
    }

    if (event.key === 'Escape' && this.state.connectorDrag) {
      event.preventDefault()
      this.state.connectorDrag = null
      this.renderWorkspace()
      return
    }

    if (event.key === 'Escape' && this.state.midpointDrag) {
      event.preventDefault()
      this.clearMidpointDragLongPress(this.state.midpointDrag)
      this.state.midpointDrag = null
      this.renderWorkspace()
      return
    }

    if (event.key === 'Escape' && this.state.selectedRelationId) {
      event.preventDefault()
      this.state.selectedRelationId = null
      this.renderWorkspace()
      return
    }

    if (event.key === 'Escape' && this.state.connectSourceNodeId) {
      event.preventDefault()
      this.state.connectSourceNodeId = null
      this.setStatus('status.relationModeCancelled')
      this.render()
      return
    }

    const selectedNode = this.selectedNode()
    if (!selectedNode) {
      return
    }

    if (event.key === 'Tab') {
      event.preventDefault()
      this.createChildNode(selectedNode.id)
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      this.createSiblingNode(selectedNode.id)
      return
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      this.deleteSelectedNode()
      return
    }

    if (event.key === 'F2') {
      event.preventDefault()
      this.startEditingSelected()
      return
    }

    if (event.key.startsWith('Arrow')) {
      event.preventDefault()
      if (event.shiftKey) {
        this.extendSelectionByArrow(event.key)
      } else {
        this.moveSelectionByArrow(event.key)
      }
      return
    }

    if (event.key === ' ') {
      event.preventDefault()
      void this.runNodeGestureAction(this.state.preferences.interaction.spaceAction, selectedNode.id)
      return
    }
  }

  private readonly handleEditorKeyDown = (event: KeyboardEvent): void => {
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
        this.commitNodeEditor(target.dataset.nodeEditor, target.value)
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        this.clearNodeEditorState()
        this.render()
      }
      return
    }

    if (target instanceof HTMLInputElement && target.dataset.relationLabel) {
      if (event.key === 'Enter') {
        event.preventDefault()
        this.commitRelationLabel(target.dataset.relationLabel, target.value)
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        this.render()
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
      if (this.state.graph.selectedNodeId) {
        this.focusNodeFromGraph(this.state.graph.selectedNodeId)
      }
      return
    }

    if (target instanceof HTMLInputElement && target.dataset.snapshotName !== undefined && event.key === 'Enter') {
      event.preventDefault()
      this.saveSnapshot('manual')
    }
  }

  private scheduleNodeGestureAction(nodeId: string, clientX: number, clientY: number): void {
    this.cancelPendingNodeGesture()
    this.pendingNodeGestureNodeId = nodeId
    this.pendingNodeGestureHandle = window.setTimeout(() => {
      const nextNodeId = this.pendingNodeGestureNodeId
      this.cancelPendingNodeGesture()
      if (!nextNodeId) {
        return
      }
      void this.runNodeGestureAction(this.state.preferences.interaction.doubleClickAction, nextNodeId, {
        clientX,
        clientY,
      })
    }, NODE_GESTURE_MULTI_CLICK_DELAY_MS)
  }

  private cancelPendingNodeGesture(): void {
    if (this.pendingNodeGestureHandle !== null) {
      window.clearTimeout(this.pendingNodeGestureHandle)
      this.pendingNodeGestureHandle = null
    }
    this.pendingNodeGestureNodeId = null
  }

  private startNodeDrag(nodeId: string, dragNodeIds: string[], event: PointerEvent): void {
    const node = this.findNode(nodeId)
    const canvas = this.refs?.canvas
    if (!node || !canvas) {
      return
    }

    const pointerPosition = this.clientToCanvasPosition(event.clientX, event.clientY)
    this.state.drag = {
      nodeId,
      nodeIds: dragNodeIds,
      offsetX: pointerPosition.x - node.position.x,
      offsetY: pointerPosition.y - node.position.y,
      initialPositions: Object.fromEntries(
        dragNodeIds
          .map((candidateId) => {
            const candidateNode = this.findNode(candidateId)
            if (!candidateNode) {
              return null
            }
            return [candidateId, { ...candidateNode.position }] as const
          })
          .filter((entry): entry is readonly [string, Position] => entry !== null),
      ),
      historyCaptured: false,
    }
  }

  private longPressActionForButton(button: number): GestureAction {
    switch (button) {
      case 0:
        return this.state.preferences.interaction.leftLongPressAction
      case 1:
        return this.state.preferences.interaction.middleLongPressAction
      case 2:
        return this.state.preferences.interaction.rightLongPressAction
      default:
        return 'none'
    }
  }

  private canvasDragActionForButton(button: number): CanvasDragAction {
    switch (button) {
      case 0:
        return this.state.preferences.interaction.canvasLeftDragAction
      case 1:
        return this.state.preferences.interaction.canvasMiddleDragAction
      case 2:
        return this.state.preferences.interaction.canvasRightDragAction
      default:
        return 'none'
    }
  }

  private startCanvasDragAction(action: CanvasDragAction, event: PointerEvent): void {
    if (event.button === 2) {
      this.suppressContextMenuOnce = true
    }

    switch (action) {
      case 'pan-canvas':
        this.suppressClickOnce = true
        this.startCanvasPan(event.pointerId, event.clientX, event.clientY)
        return
      case 'marquee-select':
        this.startMarqueeSelection(event.pointerId, event.button, event.clientX, event.clientY)
        return
      case 'none':
      default:
        return
    }
  }

  private startMarqueeSelection(
    pointerId: number,
    button: number,
    startClientX: number,
    startClientY: number,
    currentClientX = startClientX,
    currentClientY = startClientY,
  ): void {
    this.state.contextMenu = null
    this.state.marquee = {
      pointerId,
      button,
      startClientX,
      startClientY,
      currentClientX,
      currentClientY,
      active: Math.hypot(currentClientX - startClientX, currentClientY - startClientY) > 8,
    }
    this.renderOverlay()
  }

  private armNodeLongPress(nodeId: string, dragNodeIds: string[], event: PointerEvent): void {
    this.clearNodeLongPress()
    this.longPressState = {
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
    this.longPressHandle = window.setTimeout(() => {
      if (!this.longPressState || this.longPressState.nodeId !== nodeId) {
        return
      }
      const action = this.longPressActionForButton(this.longPressState.button)
      if (action === 'none') {
        this.clearNodeLongPress()
        return
      }
      this.longPressState.activated = true
      this.state.drag = null
      this.suppressClickOnce = true
      if (this.longPressState.button === 2) {
        this.suppressContextMenuOnce = true
      }
      void this.runNodeGestureAction(action, nodeId, {
        clientX: this.longPressState.clientX,
        clientY: this.longPressState.clientY,
        pointerId: this.longPressState.pointerId,
      })
    }, NODE_LONG_PRESS_DELAY_MS)
  }

  private clearNodeLongPress(): void {
    if (this.longPressHandle !== null) {
      window.clearTimeout(this.longPressHandle)
      this.longPressHandle = null
    }
    this.longPressState = null
  }

  private async runNodeGestureAction(
    action: GestureAction,
    nodeId: string,
    origin?: { clientX?: number; clientY?: number; pointerId?: number },
  ): Promise<void> {
    const node = this.findNode(nodeId)
    if (!node) {
      return
    }

    this.setSelection([nodeId], nodeId)

    switch (action) {
      case 'rename':
        this.openNodeEditor(nodeId, { selection: 'all' })
        return
      case 'edit-tail':
        this.openNodeEditor(nodeId, { selection: 'end' })
        return
      case 'pan-canvas':
        if (
          typeof origin?.pointerId === 'number' &&
          typeof origin.clientX === 'number' &&
          typeof origin.clientY === 'number'
        ) {
          this.startCanvasPan(origin.pointerId, origin.clientX, origin.clientY)
        }
        return
      case 'ai-quick':
        await this.applyAIQuickAssist(nodeId)
        return
      case 'ai-suggest-children':
        await this.applyAISuggestNodes(nodeId, 'children')
        return
      case 'ai-suggest-siblings':
        await this.applyAISuggestNodes(nodeId, 'siblings')
        return
      case 'ai-wheel':
        this.openAIWheel(nodeId, origin?.clientX, origin?.clientY)
        return
      case 'new-child':
        this.createChildNode(nodeId)
        return
      case 'new-sibling':
        this.createSiblingNode(nodeId)
        return
      case 'new-floating':
        this.createFloatingNode(nodeId)
        return
      case 'toggle-collapse':
        this.toggleNodeCollapse(nodeId)
        return
      case 'none':
      default:
        return
    }
  }

  private openAIWheel(nodeId: string, clientX?: number, clientY?: number): void {
    this.state.contextMenu = null
    this.state.fixedMenu = ''
    const fallback = this.nodeClientCenter(nodeId)
    this.state.aiWheel = {
      open: true,
      nodeId,
      clientX: Math.round(clientX ?? fallback.x),
      clientY: Math.round(clientY ?? fallback.y),
    }
    this.renderHeader()
    this.renderOverlay()
  }

  private closeAIWheel(): void {
    if (!this.state.aiWheel.open) {
      return
    }
    this.state.aiWheel = {
      open: false,
      nodeId: null,
      clientX: 0,
      clientY: 0,
    }
  }

  private nodeClientCenter(nodeId: string): { x: number; y: number } {
    const element = this.rootEl.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`)
    if (!element) {
      return { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    }
    const rect = element.getBoundingClientRect()
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    }
  }

  private readonly handleFocusOut = (event: FocusEvent): void => {
    const target = event.target
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      return
    }

    if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && target.dataset.nodeEditor) {
      const nodeId = target.dataset.nodeEditor
      queueMicrotask(() => {
        const currentEditor = this.nodeEditor(nodeId)
        if (this.state.editingNodeId === nodeId && currentEditor && currentEditor !== target) {
          return
        }
        this.commitNodeEditor(nodeId, target.value)
      })
      return
    }

    if (target instanceof HTMLInputElement && target.dataset.relationLabel) {
      this.commitRelationLabel(target.dataset.relationLabel, target.value)
      return
    }

    if (target instanceof HTMLTextAreaElement && target.dataset.nodeNote) {
      this.commitNodeNote(target.dataset.nodeNote, target.value)
    }
  }

  private readonly handleInput = (event: Event): void => {
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
        this.syncNodeEditorPreview(target)
      }
      return
    }

    if (target instanceof HTMLTextAreaElement && target.dataset.nodeNote) {
      this.syncInspectorNoteInputHeight(target)
      return
    }

    const aiField = target.dataset.aiField
    if (aiField) {
      switch (aiField) {
        case 'topic':
          this.state.ai.topic = target.value
          break
        case 'template':
          this.state.ai.template = normalizeAITemplateId(target.value)
          break
        case 'generationInstructions':
          this.state.ai.generationInstructions = target.value
          break
        case 'importInstructions':
          this.state.ai.importInstructions = target.value
          break
        case 'noteInstructions':
          this.state.ai.noteInstructions = target.value
          break
        case 'relationInstructions':
          this.state.ai.relationInstructions = target.value
          break
        case 'generateRawRequest':
          this.state.ai.generateRawRequest = target.value
          break
        case 'importRawRequest':
          this.state.ai.importRawRequest = target.value
          break
        case 'noteRawRequest':
          this.state.ai.noteRawRequest = target.value
          break
        case 'relationRawRequest':
          this.state.ai.relationRawRequest = target.value
          break
        default:
          break
      }
      return
    }

    if (target.dataset.graphSearch !== undefined) {
      this.state.graph.search = target.value
      const matchedNode = this.findGraphMatches(target.value)[0]
      if (matchedNode) {
        this.state.graph.selectedNodeId = matchedNode.id
      }
      this.updateGraphSummaryPanel()
      this.drawGraphScene()
      return
    }

    if (target instanceof HTMLInputElement && target.dataset.snapshotName !== undefined) {
      this.state.snapshotDraftName = target.value
    }
  }

  private readonly handleChange = (event: Event): void => {
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

      void this.importFile(file, this.pendingImportMode)
      this.pendingImportMode = 'auto'
      target.value = ''
      return
    }

    const field = target.dataset.settingField
    if (field) {
      this.commitSettingField(field, target.value)
      return
    }

    if (target instanceof HTMLTextAreaElement && target.dataset.nodeNote) {
      this.commitNodeNote(target.dataset.nodeNote, target.value)
      return
    }

    if (target.dataset.aiField === 'template') {
      this.state.ai.template = normalizeAITemplateId(target.value)
    }
  }

  private render(): void {
    this.flushLiveNodeUpdate()
    this.applyLocale()
    this.applyTheme()

    if (this.state.view === 'home') {
      this.renderHome()
      return
    }

    this.ensureShell()
    this.renderHeader()
    this.renderWorkspace()
    this.renderInspector()
    this.syncInspectorNoteInputs()
    this.renderOverlay()
    this.renderSettings()
    this.renderAIWorkspace()
    this.renderGraphOverlay()
    this.renderOnboarding()
    this.initializeViewportIfNeeded()
    this.syncFloatingLayout()
    this.focusEditorIfNeeded()
  }

  private renderHome(): void {
    this.refs = null
    this.rootEl.innerHTML = `
      <div class="home-shell">
        <header class="home-hero">
          <div>
            <p class="eyebrow">${this.t('app.eyebrow')}</p>
            <h1>${this.t('home.title')}</h1>
            <p class="home-copy">${this.t('home.subtitle')}</p>
            <p class="home-status">${this.t(this.state.status.key, this.state.status.values)}</p>
          </div>
          <button type="button" class="action-button primary-action" data-command="create-map">${this.t('home.create')}</button>
        </header>

        <section class="file-grid">
          ${
            this.state.maps.length === 0
              ? `<article class="file-card file-card-empty">
                   <p class="section-label">${this.t('home.title')}</p>
                   <h2>${this.t('home.empty')}</h2>
                   <button type="button" class="action-button" data-command="create-map">${this.t('home.create')}</button>
                 </article>`
              : this.state.maps
                  .map((summary) => {
                    return `
                      <article class="file-card">
                        <div class="file-card-top">
                          <div>
                            <p class="section-label">${summary.id}</p>
                            <h2>${escapeHtml(summary.title)}</h2>
                            <p class="file-meta">${this.t('home.lastEdited', {
                              value: formatRelativeTime(summary.lastEditedAt, this.state.preferences.locale),
                            })}</p>
                          </div>
                        </div>
                        <div class="file-card-actions">
                          <button type="button" class="chip-button" data-command="open-map:${summary.id}">${this.t('home.open')}</button>
                          <button type="button" class="chip-button" data-command="rename-map:${summary.id}">${this.t('home.rename')}</button>
                          <button type="button" class="chip-button danger" data-command="delete-map:${summary.id}">${this.t('home.delete')}</button>
                        </div>
                      </article>
                    `
                  })
                  .join('')
          }
        </section>

        <section class="template-strip">
          <div class="template-strip-copy">
            <p class="section-label">${this.t('ai.templateExamples')}</p>
            <h2>${this.t('ai.templateExamplesTitle')}</h2>
            <p class="inspector-copy">${this.t('ai.templateExamplesCopy')}</p>
          </div>
          <div class="template-grid">
            ${AI_TEMPLATES.map((template) => {
              return `
                <article class="template-card">
                  <p class="section-label">${templateLabel(template.id, this.state.preferences.locale)}</p>
                  <p class="inspector-copy">${escapeHtml(promptTemplateCopy(template.id, this.state.preferences.locale))}</p>
                  <button type="button" class="chip-button" data-command="create-template-map:${template.id}">${this.t('ai.templateAction')}</button>
                </article>
              `
            }).join('')}
          </div>
        </section>
      </div>
    `
  }

  private ensureShell(): void {
    if (this.refs) {
      return
    }

    this.rootEl.innerHTML = `
      <div class="app-shell">
        <div class="workspace-stage">
          <header class="top-chrome" data-top-chrome>
            <div class="fixed-toolbar" data-fixed-toolbar></div>
            <section class="panel-shell top-panel" data-top-panel>
              <div class="top-panel-header">
                <div class="project-copy top-panel-copy">
                  <p class="eyebrow" data-app-eyebrow></p>
                  <div class="top-panel-title-row">
                    <h1 data-app-title></h1>
                    <p class="status-pill" data-app-status aria-live="polite"></p>
                  </div>
                </div>
                <div class="top-panel-actions">
                  <button type="button" class="ghost-button" data-command="go-home">${this.t('toolbar.home')}</button>
                  <button type="button" class="ghost-button" data-role="top-panel-button" data-command="toggle-top-panel"></button>
                </div>
              </div>

              <div class="top-panel-body">
                <section class="toolbar-strip">
                  <button type="button" class="action-button" data-role="undo-button" data-command="undo"></button>
                  <button type="button" class="action-button" data-role="redo-button" data-command="redo"></button>
                  <button type="button" class="action-button" data-role="save-button" data-command="save"></button>
                  <button type="button" class="action-button" data-role="layout-button" data-command="auto-layout"></button>
                  <button type="button" class="action-button" data-role="connect-button" data-command="connect-selected"></button>
                  <button type="button" class="action-button" data-role="ai-button" data-command="open-ai-workspace"></button>
                  <button type="button" class="action-button" data-role="graph-button" data-command="open-graph-overlay"></button>
                  <button type="button" class="action-button" data-role="export-button" data-command="export-markdown"></button>
                </section>

                <section class="toolbar-strip toolbar-strip-secondary">
                  <button type="button" class="action-button" data-command="rename-map">${this.t('toolbar.renameMap')}</button>
                  <button type="button" class="action-button danger" data-command="delete-map">${this.t('toolbar.deleteMap')}</button>
                  <button type="button" class="action-button" data-role="panel-button" data-command="toggle-inspector"></button>
                  <button type="button" class="action-button" data-role="theme-button" data-command="theme-toggle"></button>
                  <button type="button" class="action-button" data-role="settings-button" data-command="toggle-settings"></button>
                  <button type="button" class="action-button" data-role="import-button" data-command="import-file"></button>
                  <input type="file" accept="${IMPORT_FILE_ACCEPT}" data-role="import-input" data-import-input hidden />
                </section>
              </div>
            </section>
          </header>

          <section class="workspace-panel">
            <div class="workspace-scroll" data-workspace-scroll>
              <div class="workspace-canvas" data-workspace-canvas>
                <div class="region-layer" data-region-layer></div>
                <svg class="edge-layer" viewBox="0 0 ${WORKSPACE_MIN_WIDTH} ${WORKSPACE_MIN_HEIGHT}" aria-hidden="true" data-edge-layer></svg>
                <div class="node-layer" data-node-layer></div>
              </div>
            </div>
          </section>

          <aside class="inspector" data-inspector></aside>
          <div class="overlay-layer" data-overlay-layer></div>
          <div data-ai-layer></div>
          <div data-graph-layer></div>
          <div data-settings-layer></div>
          <div data-onboarding-layer></div>
        </div>
      </div>
    `

    this.refs = {
      topChrome: requiredElement(this.rootEl, '[data-top-chrome]'),
      topPanel: requiredElement(this.rootEl, '[data-top-panel]'),
      fixedToolbar: requiredElement(this.rootEl, '[data-fixed-toolbar]'),
      eyebrow: requiredElement(this.rootEl, '[data-app-eyebrow]'),
      title: requiredElement(this.rootEl, '[data-app-title]'),
      status: requiredElement(this.rootEl, '[data-app-status]'),
      homeButton: requiredElement(this.rootEl, '[data-command="go-home"]'),
      topPanelButton: requiredElement(this.rootEl, '[data-role="top-panel-button"]'),
      renameMapButton: requiredElement(this.rootEl, '[data-command="rename-map"]'),
      deleteMapButton: requiredElement(this.rootEl, '[data-command="delete-map"]'),
      settingsButton: requiredElement(this.rootEl, '[data-role="settings-button"]'),
      panelButton: requiredElement(this.rootEl, '[data-role="panel-button"]'),
      themeButton: requiredElement(this.rootEl, '[data-role="theme-button"]'),
      undoButton: requiredElement(this.rootEl, '[data-role="undo-button"]'),
      redoButton: requiredElement(this.rootEl, '[data-role="redo-button"]'),
      saveButton: requiredElement(this.rootEl, '[data-role="save-button"]'),
      layoutButton: requiredElement(this.rootEl, '[data-role="layout-button"]'),
      exportButton: requiredElement(this.rootEl, '[data-role="export-button"]'),
      importButton: requiredElement(this.rootEl, '[data-role="import-button"]'),
      topbarConnectButton: requiredElement(this.rootEl, '[data-role="connect-button"]'),
      aiButton: requiredElement(this.rootEl, '[data-role="ai-button"]'),
      graphButton: requiredElement(this.rootEl, '[data-role="graph-button"]'),
      importInput: requiredElement(this.rootEl, '[data-role="import-input"]'),
      scroll: requiredElement(this.rootEl, '[data-workspace-scroll]'),
      canvas: requiredElement(this.rootEl, '[data-workspace-canvas]'),
      edgeLayer: requiredElement(this.rootEl, '[data-edge-layer]'),
      regionLayer: requiredElement(this.rootEl, '[data-region-layer]'),
      nodeLayer: requiredElement(this.rootEl, '[data-node-layer]'),
      inspector: requiredElement(this.rootEl, '[data-inspector]'),
      settingsLayer: requiredElement(this.rootEl, '[data-settings-layer]'),
      onboardingLayer: requiredElement(this.rootEl, '[data-onboarding-layer]'),
      overlayLayer: requiredElement(this.rootEl, '[data-overlay-layer]'),
      aiLayer: requiredElement(this.rootEl, '[data-ai-layer]'),
      graphLayer: requiredElement(this.rootEl, '[data-graph-layer]'),
    }
  }

  private renderHeader(): void {
    if (!this.refs) {
      return
    }

    const locale = this.state.preferences.locale
    const chromeLayout = this.state.preferences.appearance.chromeLayout
    this.refs.topChrome.dataset.panelPosition = this.state.preferences.appearance.topPanelPosition
    this.refs.topChrome.dataset.chromeLayout = chromeLayout
    this.refs.topPanel.classList.toggle('is-collapsed', this.state.topPanelCollapsed)
    this.refs.topPanel.classList.toggle('is-hidden', chromeLayout === 'fixed')
    this.refs.fixedToolbar.classList.toggle('is-visible', chromeLayout === 'fixed')
    this.refs.fixedToolbar.innerHTML = chromeLayout === 'fixed' ? this.renderFixedToolbar() : ''
    this.refs.eyebrow.textContent = this.t('app.eyebrow')
    this.refs.title.textContent = this.state.document.title
    this.refs.status.textContent = this.t(this.state.status.key, this.state.status.values)
    this.refs.homeButton.textContent = this.t('toolbar.home')
    this.refs.topPanelButton.textContent = this.t(this.state.topPanelCollapsed ? 'panel.top.show' : 'panel.top.hide')
    this.refs.renameMapButton.textContent = this.t('toolbar.renameMap')
    this.refs.deleteMapButton.textContent = this.t('toolbar.deleteMap')
    this.refs.undoButton.textContent = this.t('toolbar.undo')
    this.refs.redoButton.textContent = this.t('toolbar.redo')
    this.refs.saveButton.textContent = this.t('toolbar.save')
    this.refs.layoutButton.textContent = this.t('toolbar.autoLayout')
    this.refs.exportButton.textContent = this.t('toolbar.exportMarkdown')
    this.refs.importButton.textContent = this.t('toolbar.import')
    this.refs.aiButton.textContent = this.t('toolbar.ai')
    this.refs.graphButton.textContent = this.t('toolbar.graph3d')
    this.refs.settingsButton.textContent = this.t('toolbar.settings')
    this.refs.panelButton.textContent = this.t(this.state.inspectorCollapsed ? 'panel.side.show' : 'panel.side.hide')
    this.refs.themeButton.textContent = this.t('toolbar.theme', {
      theme: themeLabel(locale, this.state.document.theme),
    })
    this.refs.topbarConnectButton.textContent = this.t('toolbar.connect')
    this.refs.undoButton.disabled = !this.canUndo()
    this.refs.redoButton.disabled = !this.canRedo()
    this.refs.topbarConnectButton.classList.toggle('is-active', this.state.connectSourceNodeId !== null)
    this.refs.aiButton.classList.toggle('is-active', this.state.ai.open)
    this.refs.aiButton.disabled = this.state.ai.busy
    this.refs.graphButton.classList.toggle('is-active', this.state.graph.open)
    this.refs.settingsButton.classList.toggle('is-active', this.state.settingsOpen)
    this.refs.panelButton.classList.toggle('is-active', !this.state.inspectorCollapsed)
    this.refs.topPanelButton.setAttribute('aria-pressed', String(!this.state.topPanelCollapsed))
    document.title = `${this.state.document.title} - Code Mind`
  }

  private renderFixedToolbar(): string {
    const locale = this.state.preferences.locale
    const selectedNode = this.selectedNode()
    const hasSelection = Boolean(selectedNode)
    const childCount = selectedNode ? childrenOf(this.state.document, selectedNode.id).length : 0
    const canDeleteSelection = this.selectedNodeIds().some((nodeId) => this.findNode(nodeId)?.kind !== 'root')
    const aiBusy = this.state.ai.busy
    const labels =
      locale === 'zh-CN'
        ? {
            file: '文件',
            node: '节点',
            ai: 'AI',
            view: '视图',
          }
        : {
            file: 'File',
            node: 'Node',
            ai: 'AI',
            view: 'View',
          }

    const renderMenuItem = (command: string, label: string, disabled = false, tone: '' | 'danger' = ''): string => {
      return `
        <button type="button" class="fixed-menu-item ${tone}" data-command="${command}" ${disabled ? 'disabled' : ''}>
          ${escapeHtml(label)}
        </button>
      `
    }

    const renderMenu = (menuId: FixedMenuId, label: string, content: string): string => {
      const open = this.state.fixedMenu === menuId
      return `
        <div class="fixed-menu-group ${open ? 'is-open' : ''}">
          <button
            type="button"
            class="fixed-toolbar-tab ${open ? 'is-active' : ''}"
            data-command="toggle-fixed-menu:${menuId}"
            aria-expanded="${open ? 'true' : 'false'}"
          >
            ${escapeHtml(label)}
          </button>
          ${
            open
              ? `
                <div class="fixed-menu-popup">
                  ${content}
                </div>
              `
              : ''
          }
        </div>
      `
    }

    return `
      <div class="fixed-toolbar-shell" data-fixed-menu-shell>
        <div class="fixed-toolbar-main">
          <button type="button" class="chip-button fixed-toolbar-home" data-command="go-home">${this.t('toolbar.home')}</button>
          <div class="fixed-toolbar-copy">
            <p class="eyebrow">${this.t('app.eyebrow')}</p>
            <strong>${escapeHtml(this.state.document.title)}</strong>
          </div>
          <p class="fixed-toolbar-status" aria-live="polite">${escapeHtml(this.t(this.state.status.key, this.state.status.values))}</p>
        </div>

        <div class="fixed-toolbar-menus">
          ${renderMenu(
            'file',
            labels.file,
            [
              renderMenuItem('save', this.t('toolbar.save')),
              renderMenuItem('import-file', this.t('toolbar.import')),
              renderMenuItem('export-markdown', this.t('toolbar.exportMarkdown')),
              renderMenuItem('rename-map', this.t('toolbar.renameMap')),
              renderMenuItem('delete-map', this.t('toolbar.deleteMap'), false, 'danger'),
            ].join(''),
          )}
          ${renderMenu(
            'node',
            labels.node,
            [
              renderMenuItem('new-child', this.t('action.newChild'), !hasSelection),
              renderMenuItem('new-sibling', this.t('action.newSibling'), !hasSelection),
              renderMenuItem('new-floating', this.t('action.newFloating')),
              renderMenuItem(
                'toggle-collapse',
                selectedNode?.collapsed ? this.t('action.expand') : this.t('action.collapse'),
                !hasSelection || childCount === 0,
              ),
              renderMenuItem('connect-selected', this.t('action.linkRelation'), !hasSelection),
              renderMenuItem('delete-selected', this.t('action.delete'), !canDeleteSelection, 'danger'),
            ].join(''),
          )}
          ${renderMenu(
            'ai',
            labels.ai,
            [
              renderMenuItem('open-ai-workspace', this.t('toolbar.ai'), aiBusy),
              renderMenuItem('ai-suggest-children', this.t('ai.suggestChildrenAction'), aiBusy || !hasSelection),
              renderMenuItem(
                'ai-suggest-siblings',
                this.t('ai.suggestSiblingsAction'),
                aiBusy || !this.canSuggestSiblings(),
              ),
              renderMenuItem('ai-complete-node-notes', this.t('ai.notesAction'), aiBusy),
              renderMenuItem('ai-connect-relations', this.t('ai.connectAction'), aiBusy),
            ].join(''),
          )}
          ${renderMenu(
            'view',
            labels.view,
            [
              renderMenuItem('auto-layout', this.t('toolbar.autoLayout')),
              renderMenuItem(
                'toggle-inspector',
                this.t(this.state.inspectorCollapsed ? 'panel.side.show' : 'panel.side.hide'),
              ),
              renderMenuItem('open-graph-overlay', this.t('toolbar.graph3d')),
              renderMenuItem(
                'theme-toggle',
                this.t('toolbar.theme', { theme: themeLabel(locale, this.state.document.theme) }),
              ),
              renderMenuItem('toggle-settings', this.t('toolbar.settings')),
            ].join(''),
          )}
        </div>

        <div class="fixed-toolbar-quick">
          <button type="button" class="chip-button" data-command="undo" ${this.canUndo() ? '' : 'disabled'}>${this.t('toolbar.undo')}</button>
          <button type="button" class="chip-button" data-command="redo" ${this.canRedo() ? '' : 'disabled'}>${this.t('toolbar.redo')}</button>
          <button type="button" class="chip-button" data-command="save">${this.t('toolbar.save')}</button>
        </div>
      </div>
    `
  }

  private toggleFixedMenu(menuId: FixedMenuId): void {
    if (this.state.preferences.appearance.chromeLayout !== 'fixed') {
      return
    }
    this.state.fixedMenu = this.state.fixedMenu === menuId ? '' : menuId
    this.renderHeader()
  }

  private renderGestureActionOptions(selected: GestureAction): string {
    const gestureOptions =
      this.state.preferences.locale === 'zh-CN'
        ? [
            { value: 'none' as const, label: '无操作' },
            { value: 'rename' as const, label: '重命名节点' },
            { value: 'edit-tail' as const, label: '在标题末尾编辑' },
            { value: 'ai-quick' as const, label: 'AI 快捷请求' },
            { value: 'ai-suggest-children' as const, label: '建议子节点' },
            { value: 'ai-suggest-siblings' as const, label: '建议同级节点' },
            { value: 'ai-wheel' as const, label: 'AI 轮盘' },
            { value: 'new-child' as const, label: '新建子节点' },
            { value: 'new-sibling' as const, label: '新建同级节点' },
            { value: 'new-floating' as const, label: '新建自由节点' },
            { value: 'toggle-collapse' as const, label: '折叠 / 展开分支' },
          ]
        : [
            { value: 'none' as const, label: 'No action' },
            { value: 'rename' as const, label: 'Rename node' },
            { value: 'edit-tail' as const, label: 'Edit title tail' },
            { value: 'ai-quick' as const, label: 'AI quick assist' },
            { value: 'ai-suggest-children' as const, label: 'Suggest children' },
            { value: 'ai-suggest-siblings' as const, label: 'Suggest siblings' },
            { value: 'ai-wheel' as const, label: 'AI wheel' },
            { value: 'new-child' as const, label: 'New child' },
            { value: 'new-sibling' as const, label: 'New sibling' },
            { value: 'new-floating' as const, label: 'New floating node' },
            { value: 'toggle-collapse' as const, label: 'Toggle collapse' },
          ]

    return gestureOptions
      .map(
        (option) =>
          `<option value="${option.value}" ${selected === option.value ? 'selected' : ''}>${escapeHtml(option.label)}</option>`,
      )
      .join('')
  }

  private renderCanvasDragActionOptions(selected: CanvasDragAction): string {
    const options =
      this.state.preferences.locale === 'zh-CN'
        ? [
            { value: 'none' as const, label: '无操作' },
            { value: 'marquee-select' as const, label: '框选节点' },
            { value: 'pan-canvas' as const, label: '拖动画布' },
          ]
        : [
            { value: 'none' as const, label: 'No action' },
            { value: 'marquee-select' as const, label: 'Marquee select' },
            { value: 'pan-canvas' as const, label: 'Pan canvas' },
          ]

    return options
      .map(
        (option) =>
          `<option value="${option.value}" ${selected === option.value ? 'selected' : ''}>${escapeHtml(option.label)}</option>`,
      )
      .join('')
  }

  private canSuggestSiblings(nodeId?: string): boolean {
    const targetId = nodeId ?? this.selectedNode()?.id
    if (!targetId) {
      return false
    }
    const node = this.findNode(targetId)
    if (!node?.parentId) {
      return false
    }
    return Boolean(this.findNode(node.parentId))
  }

  private aiQuickKindLabel(kind: 'children' | 'siblings' | 'notes' | 'relations'): string {
    switch (kind) {
      case 'children':
        return this.t('ai.suggestChildrenAction')
      case 'siblings':
        return this.t('ai.suggestSiblingsAction')
      case 'notes':
        return this.t('ai.notesAction')
      case 'relations':
        return this.t('ai.connectAction')
      default:
        return kind
    }
  }

  private renderWorkspace(): void {
    if (!this.refs) {
      return
    }

    const bounds = getWorkspaceBounds(this.state.document)
    this.applyCanvasMetrics(bounds)
    this.refs.edgeLayer.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`)
    this.updateCanvasViewportView()
    this.refs.scroll.classList.toggle('is-marqueeing', Boolean(this.state.marquee))
    this.refs.edgeLayer.innerHTML = this.renderEdges()
    this.refs.regionLayer.innerHTML = this.renderRegions()
    this.refs.nodeLayer.innerHTML = this.renderNodes()
  }

  private renderRegionDrawPreview(): void {
    if (!this.refs || !this.state.regionDraw || this.state.regionDraw.pointerId === -1) {
      return
    }
    const rd = this.state.regionDraw
    const originX = this.workspaceBounds.originX
    const originY = this.workspaceBounds.originY
    const left = Math.min(rd.startCanvasX, rd.currentCanvasX) + originX
    const top = Math.min(rd.startCanvasY, rd.currentCanvasY) + originY
    const w = Math.abs(rd.currentCanvasX - rd.startCanvasX)
    const h = Math.abs(rd.currentCanvasY - rd.startCanvasY)
    const palette = resolveNodeColorPalette(rd.color)
    const borderColor = palette ? `rgba(${palette.accentRgb.join(',')}, 0.6)` : 'rgba(96,165,250,0.5)'
    const bgColor = palette ? `rgba(${palette.surfaceRgb.join(',')}, 0.15)` : 'rgba(96,165,250,0.1)'
    // Show preview overlay in the region layer
    this.refs.regionLayer.innerHTML =
      this.renderRegions() +
      `<div class="region-box region-draw-preview" style="
      left: ${left}px; top: ${top}px; width: ${w}px; height: ${h}px;
      background: ${bgColor}; border: 2px dashed ${borderColor};
    "></div>`
  }

  private renderInspector(): void {
    if (!this.refs) {
      return
    }

    const selectedNode = this.selectedNode()
    const selectedCount = this.selectedNodeIds().length
    const workspaceMetrics = `
      <span class="metric-chip">${this.t('dock.selected', { value: selectedCount })}</span>
      <span class="metric-chip">${this.t('dock.nodes', { value: this.state.document.nodes.length })}</span>
      <span class="metric-chip">${this.t('dock.relations', { value: this.state.document.relations.length })}</span>
      <span class="metric-chip">${Math.round(this.viewport.scale * 100)}%</span>
      <span class="metric-chip">${this.t('dock.theme', { value: themeLabel(this.state.preferences.locale, this.state.document.theme) })}</span>
    `

    this.refs.inspector.classList.toggle('is-collapsed', this.state.inspectorCollapsed)
    if (!selectedNode) {
      this.refs.inspector.innerHTML = this.state.inspectorCollapsed
        ? `
          <section class="inspector-card inspector-card-compact inspector-handle-card">
            <p class="section-label">${this.t('inspector.summary')}</p>
            <p class="inspector-handle-copy">${this.t('inspector.noneSelected')}</p>
            <button type="button" class="action-button inspector-toggle-button" data-command="toggle-inspector">${this.t('panel.side.show')}</button>
          </section>
        `
        : `
          <section class="inspector-card">
            <div class="inspector-header">
              <div>
                <p class="section-label">${this.t('inspector.selected')}</p>
                <h2>${this.t('inspector.noneSelected')}</h2>
              </div>
              <button type="button" class="ghost-button" data-command="toggle-inspector">${this.t('panel.side.hide')}</button>
            </div>
            <p class="inspector-copy">${this.t('inspector.emptySelectionCopy')}</p>
          </section>

          <section class="inspector-card">
            <p class="section-label">${this.t('panel.workspace')}</p>
            <div class="metric-row">
              ${workspaceMetrics}
            </div>
          </section>

          ${this.renderSnapshotSection()}
        `
      return
    }

    const relatedRelations = connectedRelations(this.state.document, selectedNode.id)
    const directChildren = childrenOf(this.state.document, selectedNode.id)
    const hiddenChildren = hiddenDescendantCount(this.state.document, selectedNode.id)
    const singleSelection = selectedCount === 1
    const canDeleteSelection = this.selectedNodeIds().some((nodeId) => this.findNode(nodeId)?.kind !== 'root')
    const relationModeText = this.state.connectSourceNodeId
      ? this.t('inspector.relationConnecting', {
          title: this.findNode(this.state.connectSourceNodeId)?.title ?? this.t('common.unknown'),
        })
      : this.t('inspector.relationIdle')
    const selectionTitle = singleSelection
      ? selectedNode.title
      : this.t('context.selectionCount', {
          value: selectedCount,
        })
    const selectedNote = normalizeNodeNote(selectedNode.note) ?? ''

    this.refs.inspector.innerHTML = this.state.inspectorCollapsed
      ? `
        <section class="inspector-card inspector-card-compact inspector-handle-card">
          <p class="section-label">${this.t('inspector.summary')}</p>
          <p class="inspector-handle-copy">${escapeHtml(shorten(selectionTitle, 24))}</p>
          <button type="button" class="action-button inspector-toggle-button" data-command="toggle-inspector">${this.t('panel.side.show')}</button>
        </section>
      `
      : `
        <section class="inspector-card">
          <div class="inspector-header">
            <div>
              <p class="section-label">${this.t('inspector.selected')}</p>
              <h2>${escapeHtml(selectionTitle)}</h2>
            </div>
            <button type="button" class="ghost-button" data-command="toggle-inspector">${this.t('panel.side.hide')}</button>
          </div>
          <div class="metric-row">
            <span class="metric-chip">${this.t('dock.selected', { value: selectedCount })}</span>
            <span class="metric-chip">${this.t('inspector.type', { value: kindLabel(this.state.preferences.locale, selectedNode.kind) })}</span>
            <span class="metric-chip">${this.t('inspector.children', { value: directChildren.length })}</span>
            <span class="metric-chip">${this.t('inspector.relationsCount', { value: relatedRelations.length })}</span>
            <span class="metric-chip">${this.t('inspector.hidden', { value: hiddenChildren })}</span>
          </div>
          <p class="inspector-copy">${this.t('inspector.position', {
            x: Math.round(selectedNode.position.x),
            y: Math.round(selectedNode.position.y),
          })}</p>
          <div class="inspector-note-group">
            <div class="inspector-note-header">
              <p class="section-label">${this.t('inspector.note')}</p>
              ${singleSelection && selectedNote ? `<span class="metric-chip">${this.t('inspector.noteSaved')}</span>` : ''}
            </div>
            <textarea class="settings-input inspector-note-input" data-node-note="${selectedNode.id}" placeholder="${escapeAttribute(
              singleSelection ? this.t('inspector.notePlaceholder') : this.t('inspector.noteDisabledPlaceholder'),
            )}" ${singleSelection ? '' : 'readonly'}>${escapeHtml(singleSelection ? selectedNote : '')}</textarea>
          </div>
          <div class="priority-row">
            ${PRIORITY_VALUES.map((priority) => this.renderPriorityButton(priority, selectedNode.priority ?? '')).join('')}
          </div>
          <div class="inspector-color-group">
            <p class="section-label">${this.t('inspector.color')}</p>
            <div class="color-row">
              ${NODE_COLOR_VALUES.map((color) => this.renderNodeColorButton(color, selectedNode.color ?? '')).join('')}
            </div>
          </div>
          <div class="action-grid">
            <button type="button" class="chip-button" data-command="new-child" ${singleSelection ? '' : 'disabled'}>${this.t('action.newChild')}</button>
            <button type="button" class="chip-button" data-command="new-sibling" ${singleSelection ? '' : 'disabled'}>${this.t('action.newSibling')}</button>
            <button type="button" class="chip-button" data-command="new-floating" ${singleSelection ? '' : 'disabled'}>${this.t('action.newFloating')}</button>
            <button type="button" class="chip-button" data-command="rename-selected" ${singleSelection ? '' : 'disabled'}>${this.t('action.rename')}</button>
            <button type="button" class="chip-button" data-command="toggle-collapse" ${singleSelection && directChildren.length > 0 ? '' : 'disabled'}>
              ${selectedNode.collapsed ? this.t('action.expand') : this.t('action.collapse')}
            </button>
            <button type="button" class="chip-button ${this.state.connectSourceNodeId ? 'is-active' : ''}" data-command="connect-selected" ${singleSelection ? '' : 'disabled'}>${this.t('action.linkRelation')}</button>
            <button type="button" class="chip-button danger" data-command="delete-selected" ${canDeleteSelection ? '' : 'disabled'}>${this.t('action.delete')}</button>
          </div>
        </section>

        <section class="inspector-card">
          <p class="section-label">${this.t('panel.workspace')}</p>
          <div class="metric-row">
            ${workspaceMetrics}
          </div>
        </section>

        ${this.renderSnapshotSection()}

        <section class="inspector-card">
          <p class="section-label">${this.t('inspector.relations')}</p>
          <p class="inspector-copy">${escapeHtml(relationModeText)}</p>
          ${this.renderRelationList(selectedNode.id)}
        </section>
      `
  }

  private syncFloatingLayout(): void {
    if (!this.refs) {
      return
    }

    if (window.innerWidth <= 980) {
      this.refs.inspector.style.top = ''
      return
    }

    const stageRect = this.refs.topChrome.parentElement?.getBoundingClientRect()
    const chromeRect = this.refs.topChrome.getBoundingClientRect()
    if (!stageRect || chromeRect.height === 0) {
      return
    }

    const nextTop = Math.round(chromeRect.bottom - stageRect.top + 12)
    this.refs.inspector.style.top = `${nextTop}px`
  }

  private renderOverlay(): void {
    if (!this.refs) {
      return
    }

    if (this.overlayBlocksCanvas()) {
      this.refs.overlayLayer.innerHTML = ''
      this.refs.overlayLayer.classList.remove('is-visible')
      return
    }

    const marqueeMarkup = this.state.marquee?.active ? this.renderMarqueeBox(this.state.marquee) : ''
    const contextMenuMarkup = this.state.contextMenu ? this.renderContextMenu() : ''
    const aiWheelMarkup = this.state.aiWheel.open ? this.renderAIWheel() : ''

    this.refs.overlayLayer.classList.toggle('is-visible', Boolean(marqueeMarkup || contextMenuMarkup || aiWheelMarkup))
    this.refs.overlayLayer.innerHTML = `${marqueeMarkup}${contextMenuMarkup}${aiWheelMarkup}`
    if (this.state.contextMenu) {
      this.syncContextMenuPosition()
    }
    if (this.state.aiWheel.open) {
      this.syncAIWheelPosition()
    }
  }

  private renderMarqueeBox(marquee: MarqueeState): string {
    const left = Math.min(marquee.startClientX, marquee.currentClientX)
    const top = Math.min(marquee.startClientY, marquee.currentClientY)
    const width = Math.abs(marquee.currentClientX - marquee.startClientX)
    const height = Math.abs(marquee.currentClientY - marquee.startClientY)
    const stageRect = this.refs?.overlayLayer.getBoundingClientRect()
    if (!stageRect) {
      return ''
    }

    return `
      <div
        class="marquee-box"
        style="left: ${Math.round(left - stageRect.left)}px; top: ${Math.round(top - stageRect.top)}px; width: ${Math.round(width)}px; height: ${Math.round(height)}px;"
      ></div>
    `
  }

  private renderContextMenu(): string {
    if (!this.refs || !this.state.contextMenu) {
      return ''
    }

    const stageRect = this.refs.overlayLayer.getBoundingClientRect()
    const left = Math.round(this.state.contextMenu.clientX - stageRect.left)
    const top = Math.round(this.state.contextMenu.clientY - stageRect.top)

    // Relation context menu
    if (this.state.contextMenu.relationId) {
      const relation = this.state.document.relations.find((r) => r.id === this.state.contextMenu!.relationId)
      const sourceNode = relation ? this.findNode(relation.sourceId) : null
      const targetNode = relation ? this.findNode(relation.targetId) : null
      const arrowDir = relation?.arrowDirection ?? 'none'
      const sourceLabel = sourceNode ? shorten(sourceNode.title, 12) : 'A'
      const targetLabel = targetNode ? shorten(targetNode.title, 12) : 'B'
      return `
        <section class="relation-wheel-shell" data-context-menu style="left: ${Math.round(left)}px; top: ${Math.round(top)}px;">
          <section class="relation-wheel" data-relation-wheel>
            <p class="section-label relation-wheel-label">${this.t('context.relation')}</p>
            <button type="button" class="relation-wheel-button relation-wheel-button-top ${arrowDir === 'both' ? 'is-active' : ''}" data-command="set-arrow:both:${this.state.contextMenu.relationId}">${this.t('action.arrowBoth')}</button>
            <button type="button" class="relation-wheel-button relation-wheel-button-left ${arrowDir === 'backward' ? 'is-active' : ''}" data-command="set-arrow:backward:${this.state.contextMenu.relationId}">${escapeHtml(sourceLabel)}</button>
            <button type="button" class="relation-wheel-button relation-wheel-button-right ${arrowDir === 'forward' ? 'is-active' : ''}" data-command="set-arrow:forward:${this.state.contextMenu.relationId}">${escapeHtml(targetLabel)}</button>
            <button type="button" class="relation-wheel-button relation-wheel-button-bottom ${arrowDir === 'none' ? 'is-active' : ''}" data-command="set-arrow:none:${this.state.contextMenu.relationId}">${this.t('action.arrowNone')}</button>
            <div class="relation-wheel-center">${this.state.preferences.locale === 'zh-CN' ? '箭头' : 'Arrow'}</div>
          </section>
          <div class="relation-wheel-actions">
            <button type="button" class="chip-button context-menu-button" data-command="branch-connection:${this.state.contextMenu.relationId}">${this.t('action.branchConnection')}</button>
            <button type="button" class="chip-button danger context-menu-button" data-command="delete-relation:${this.state.contextMenu.relationId}">${this.t('action.remove')}</button>
          </div>
        </section>
      `
    }

    // Region context menu
    if (this.state.contextMenu.regionId) {
      return `
        <section class="context-menu" data-context-menu style="left: ${Math.round(left)}px; top: ${Math.round(top)}px;">
          <p class="section-label">${this.t('context.regionActions')}</p>
          ${NODE_COLOR_VALUES.filter((c) => c !== '')
            .map((color) => {
              const palette = NODE_COLOR_PALETTES[color as Exclude<NodeColor, ''>]
              return `<button type="button" class="chip-button context-menu-button" data-command="set-region-color:${color}:${this.state.contextMenu!.regionId}" style="border-left: 4px solid ${palette.accent};">${this.t(palette.labelKey)}</button>`
            })
            .join('')}
          <div class="context-menu-divider"></div>
          <button type="button" class="chip-button danger context-menu-button" data-command="delete-region:${this.state.contextMenu.regionId}">${this.t('action.deleteRegion')}</button>
        </section>
      `
    }

    const selectedIds = this.selectedNodeIds()
    const selectedCount = selectedIds.length
    const primaryNode = this.selectedNode()
    const isCanvasMenu = this.state.contextMenu.nodeId === null
    const primaryChildren = !isCanvasMenu && primaryNode ? childrenOf(this.state.document, primaryNode.id).length : 0
    const canUseSingleNodeActions = !isCanvasMenu && selectedCount === 1 && Boolean(primaryNode)
    const canDelete = !isCanvasMenu && selectedIds.some((nodeId) => this.findNode(nodeId)?.kind !== 'root')
    const heading = isCanvasMenu
      ? this.t('context.canvas')
      : selectedCount > 1
        ? this.t('context.selectionCount', { value: selectedCount })
        : escapeHtml(primaryNode?.title ?? this.t('context.canvas'))

    return `
      <section class="context-menu" data-context-menu style="left: ${Math.round(left)}px; top: ${Math.round(top)}px;">
        <p class="section-label">${this.t(this.state.contextMenu.nodeId ? 'context.node' : 'context.canvas')}</p>
        <h3 class="context-menu-title">${heading}</h3>
        <button type="button" class="chip-button context-menu-button" data-command="new-child" ${canUseSingleNodeActions ? '' : 'disabled'}>${this.t('action.newChild')}</button>
        <button type="button" class="chip-button context-menu-button" data-command="new-sibling" ${canUseSingleNodeActions ? '' : 'disabled'}>${this.t('action.newSibling')}</button>
        <button type="button" class="chip-button context-menu-button" data-command="new-floating">${this.t('action.newFloating')}</button>
        <button type="button" class="chip-button context-menu-button" data-command="rename-selected" ${canUseSingleNodeActions ? '' : 'disabled'}>${this.t('action.rename')}</button>
        <button type="button" class="chip-button context-menu-button" data-command="toggle-collapse" ${canUseSingleNodeActions && primaryChildren > 0 ? '' : 'disabled'}>
          ${primaryNode?.collapsed ? this.t('action.expand') : this.t('action.collapse')}
        </button>
        <button type="button" class="chip-button context-menu-button" data-command="connect-selected" ${canUseSingleNodeActions ? '' : 'disabled'}>${this.t('action.linkRelation')}</button>
        <div class="context-menu-divider"></div>
        <button type="button" class="chip-button context-menu-button" data-command="create-region">${this.t('action.createRegion')}</button>
        <div class="context-menu-divider"></div>
        <button type="button" class="chip-button context-menu-button" data-command="set-priority:P0" ${canUseSingleNodeActions ? '' : 'disabled'}>${this.t('context.priorityP0')}</button>
        <button type="button" class="chip-button context-menu-button" data-command="set-priority:P1" ${canUseSingleNodeActions ? '' : 'disabled'}>${this.t('context.priorityP1')}</button>
        <button type="button" class="chip-button context-menu-button" data-command="set-priority:" ${canUseSingleNodeActions ? '' : 'disabled'}>${this.t('context.clearPriority')}</button>
        <button type="button" class="chip-button danger context-menu-button" data-command="delete-selected" ${canDelete ? '' : 'disabled'}>${this.t('action.delete')}</button>
      </section>
    `
  }

  private syncContextMenuPosition(): void {
    if (!this.refs || !this.state.contextMenu) {
      return
    }

    const menu = this.refs.overlayLayer.querySelector<HTMLElement>('[data-context-menu]')
    if (!menu) {
      return
    }

    const stageRect = this.refs.overlayLayer.getBoundingClientRect()
    const menuRect = menu.getBoundingClientRect()
    const left = clamp(
      this.state.contextMenu.clientX - stageRect.left,
      12,
      Math.max(12, stageRect.width - menuRect.width - 12),
    )
    const top = clamp(
      this.state.contextMenu.clientY - stageRect.top,
      12,
      Math.max(12, stageRect.height - menuRect.height - 12),
    )
    menu.style.left = `${Math.round(left)}px`
    menu.style.top = `${Math.round(top)}px`
  }

  private syncAIWheelPosition(): void {
    if (!this.refs || !this.state.aiWheel.open) {
      return
    }

    const wheel = this.refs.overlayLayer.querySelector<HTMLElement>('[data-ai-wheel]')
    if (!wheel) {
      return
    }

    const stageRect = this.refs.overlayLayer.getBoundingClientRect()
    const wheelRect = wheel.getBoundingClientRect()
    const halfWidth = wheelRect.width / 2
    const halfHeight = wheelRect.height / 2
    const left = clamp(
      this.state.aiWheel.clientX - stageRect.left,
      halfWidth + 12,
      Math.max(halfWidth + 12, stageRect.width - halfWidth - 12),
    )
    const top = clamp(
      this.state.aiWheel.clientY - stageRect.top,
      halfHeight + 12,
      Math.max(halfHeight + 12, stageRect.height - halfHeight - 12),
    )

    wheel.style.left = `${Math.round(left)}px`
    wheel.style.top = `${Math.round(top)}px`
  }

  private renderAIWheel(): string {
    if (!this.refs || !this.state.aiWheel.open || !this.state.aiWheel.nodeId) {
      return ''
    }

    const labels = {
      children: this.state.preferences.locale === 'zh-CN' ? '子节点' : 'Children',
      notes: this.state.preferences.locale === 'zh-CN' ? '注释' : 'Notes',
      relations: this.state.preferences.locale === 'zh-CN' ? '连线' : 'Relations',
      siblings: this.state.preferences.locale === 'zh-CN' ? '同级节点' : 'Siblings',
      close: this.state.preferences.locale === 'zh-CN' ? '关闭 AI 轮盘' : 'Close AI wheel',
    }

    return `
      <section class="ai-wheel" data-ai-wheel style="left: 0; top: 0;">
        <button type="button" class="ai-wheel-button ai-wheel-button-top" data-command="ai-wheel-children">${labels.children}</button>
        <button type="button" class="ai-wheel-button ai-wheel-button-left" data-command="ai-wheel-notes">${labels.notes}</button>
        <button type="button" class="ai-wheel-button ai-wheel-button-right" data-command="ai-wheel-relations">${labels.relations}</button>
        <button type="button" class="ai-wheel-button ai-wheel-button-bottom" data-command="ai-wheel-siblings">${labels.siblings}</button>
        <button type="button" class="ai-wheel-center" data-command="close-ai-wheel" aria-label="${labels.close}">AI</button>
      </section>
    `
  }

  private renderSettings(): void {
    if (!this.refs) {
      return
    }

    if (!this.state.settingsOpen) {
      this.refs.settingsLayer.innerHTML = ''
      this.refs.settingsLayer.className = ''
      return
    }

    const locale = this.state.preferences.locale
    const appearance = this.state.preferences.appearance
    this.refs.settingsLayer.className = 'settings-layer is-visible'
    this.refs.settingsLayer.innerHTML = `
      <div class="settings-scrim" data-settings-scrim>
        <section class="settings-drawer" role="dialog" aria-modal="true">
          <header class="settings-header">
            <div>
              <p class="section-label">${this.t('toolbar.settings')}</p>
              <h2>${this.t('settings.title')}</h2>
              <p class="inspector-copy">${this.t('settings.subtitle')}</p>
            </div>
            <button type="button" class="ghost-button" data-command="close-settings">${this.t('settings.close')}</button>
          </header>

          <section class="settings-card">
            <p class="section-label">${this.t('settings.appearance')}</p>
            <label class="field-row">
              <span>${this.t('settings.language')}</span>
              <select class="settings-select" data-setting-field="locale">
                <option value="zh-CN" ${locale === 'zh-CN' ? 'selected' : ''}>${this.t('settings.language.zh-CN')}</option>
                <option value="en" ${locale === 'en' ? 'selected' : ''}>${this.t('settings.language.en')}</option>
              </select>
            </label>
            <label class="field-row">
              <span>${this.t('settings.theme')}</span>
              <select class="settings-select" data-setting-field="theme">
                <option value="light" ${this.state.document.theme === 'light' ? 'selected' : ''}>${this.t('settings.theme.light')}</option>
                <option value="dark" ${this.state.document.theme === 'dark' ? 'selected' : ''}>${this.t('settings.theme.dark')}</option>
              </select>
            </label>
            <label class="field-row">
              <span>${this.t('settings.edgeStyle')}</span>
              <select class="settings-select" data-setting-field="appearance.edgeStyle">
                <option value="curve" ${appearance.edgeStyle === 'curve' ? 'selected' : ''}>${this.t('settings.edgeStyle.curve')}</option>
                <option value="orthogonal" ${appearance.edgeStyle === 'orthogonal' ? 'selected' : ''}>${this.t('settings.edgeStyle.orthogonal')}</option>
                <option value="hidden" ${appearance.edgeStyle === 'hidden' ? 'selected' : ''}>${this.t('settings.edgeStyle.hidden')}</option>
              </select>
            </label>
            <label class="field-row">
              <span>${this.t('settings.layoutMode')}</span>
              <select class="settings-select" data-setting-field="appearance.layoutMode">
                <option value="balanced" ${appearance.layoutMode === 'balanced' ? 'selected' : ''}>${this.t('settings.layoutMode.balanced')}</option>
                <option value="right" ${appearance.layoutMode === 'right' ? 'selected' : ''}>${this.t('settings.layoutMode.right')}</option>
              </select>
            </label>
            <label class="field-stack">
              <span>${this.t('settings.childGapX')}</span>
              <input
                class="settings-input"
                type="number"
                min="120"
                max="360"
                step="20"
                inputmode="numeric"
                data-setting-field="appearance.childGapX"
                value="${escapeAttribute(String(appearance.childGapX || DEFAULT_CHILD_GAP_X))}"
              />
            </label>
            <p class="inspector-copy">${this.t('settings.childGapXHint')}</p>
            <label class="field-row">
              <span>${this.t('settings.chromeLayout')}</span>
              <select class="settings-select" data-setting-field="appearance.chromeLayout">
                <option value="floating" ${appearance.chromeLayout === 'floating' ? 'selected' : ''}>${this.t('settings.chromeLayout.floating')}</option>
                <option value="fixed" ${appearance.chromeLayout === 'fixed' ? 'selected' : ''}>${this.t('settings.chromeLayout.fixed')}</option>
              </select>
            </label>
            <label class="field-row">
              <span>${this.t('settings.topPanelPosition')}</span>
              <select class="settings-select" data-setting-field="appearance.topPanelPosition">
                <option value="left" ${appearance.topPanelPosition === 'left' ? 'selected' : ''}>${this.t('settings.topPanelPosition.left')}</option>
                <option value="center" ${appearance.topPanelPosition === 'center' ? 'selected' : ''}>${this.t('settings.topPanelPosition.center')}</option>
                <option value="right" ${appearance.topPanelPosition === 'right' ? 'selected' : ''}>${this.t('settings.topPanelPosition.right')}</option>
              </select>
            </label>
          </section>

          <section class="settings-card">
            <p class="section-label">${this.t('settings.interaction')}</p>
            <label class="field-row">
              <span>${this.t('settings.dragSubtreeWithParent')}</span>
              <select class="settings-select" data-setting-field="interaction.dragSubtreeWithParent">
                <option value="true" ${this.state.preferences.interaction.dragSubtreeWithParent ? 'selected' : ''}>${this.t('common.on')}</option>
                <option value="false" ${this.state.preferences.interaction.dragSubtreeWithParent ? '' : 'selected'}>${this.t('common.off')}</option>
              </select>
            </label>
            <label class="field-row">
              <span>${this.t('settings.dragSnap')}</span>
              <select class="settings-select" data-setting-field="interaction.dragSnap">
                <option value="true" ${this.state.preferences.interaction.dragSnap ? 'selected' : ''}>${this.t('common.on')}</option>
                <option value="false" ${this.state.preferences.interaction.dragSnap ? '' : 'selected'}>${this.t('common.off')}</option>
              </select>
            </label>
            <label class="field-row">
              <span>${this.t('settings.autoLayoutOnCollapse')}</span>
              <select class="settings-select" data-setting-field="interaction.autoLayoutOnCollapse">
                <option value="true" ${this.state.preferences.interaction.autoLayoutOnCollapse ? 'selected' : ''}>${this.t('common.on')}</option>
                <option value="false" ${this.state.preferences.interaction.autoLayoutOnCollapse ? '' : 'selected'}>${this.t('common.off')}</option>
              </select>
            </label>
            <label class="field-row">
              <span>${this.t('settings.autoSnapshots')}</span>
              <select class="settings-select" data-setting-field="interaction.autoSnapshots">
                <option value="true" ${this.state.preferences.interaction.autoSnapshots ? 'selected' : ''}>${this.t('common.on')}</option>
                <option value="false" ${this.state.preferences.interaction.autoSnapshots ? '' : 'selected'}>${this.t('common.off')}</option>
              </select>
            </label>
            <div class="settings-subsection">
              <p class="section-label">${this.t('settings.aiQuickRequests')}</p>
              <label class="field-row">
                <span>${this.t('settings.aiQuickChildren')}</span>
                <select class="settings-select" data-setting-field="interaction.aiQuickChildren">
                  <option value="true" ${this.state.preferences.interaction.aiQuickChildren ? 'selected' : ''}>${this.t('common.on')}</option>
                  <option value="false" ${this.state.preferences.interaction.aiQuickChildren ? '' : 'selected'}>${this.t('common.off')}</option>
                </select>
              </label>
              <label class="field-row">
                <span>${this.t('settings.aiQuickSiblings')}</span>
                <select class="settings-select" data-setting-field="interaction.aiQuickSiblings">
                  <option value="true" ${this.state.preferences.interaction.aiQuickSiblings ? 'selected' : ''}>${this.t('common.on')}</option>
                  <option value="false" ${this.state.preferences.interaction.aiQuickSiblings ? '' : 'selected'}>${this.t('common.off')}</option>
                </select>
              </label>
              <label class="field-row">
                <span>${this.t('settings.aiQuickNotes')}</span>
                <select class="settings-select" data-setting-field="interaction.aiQuickNotes">
                  <option value="true" ${this.state.preferences.interaction.aiQuickNotes ? 'selected' : ''}>${this.t('common.on')}</option>
                  <option value="false" ${this.state.preferences.interaction.aiQuickNotes ? '' : 'selected'}>${this.t('common.off')}</option>
                </select>
              </label>
              <label class="field-row">
                <span>${this.t('settings.aiQuickRelations')}</span>
                <select class="settings-select" data-setting-field="interaction.aiQuickRelations">
                  <option value="true" ${this.state.preferences.interaction.aiQuickRelations ? 'selected' : ''}>${this.t('common.on')}</option>
                  <option value="false" ${this.state.preferences.interaction.aiQuickRelations ? '' : 'selected'}>${this.t('common.off')}</option>
                </select>
              </label>
            </div>
            <div class="settings-subsection">
              <p class="section-label">${this.t('settings.actionBindings')}</p>
              <label class="field-row">
                <span>${this.t('settings.doubleClickAction')}</span>
                <select class="settings-select" data-setting-field="interaction.doubleClickAction">
                  ${this.renderGestureActionOptions(this.state.preferences.interaction.doubleClickAction)}
                </select>
              </label>
              <label class="field-row">
                <span>${this.t('settings.tripleClickAction')}</span>
                <select class="settings-select" data-setting-field="interaction.tripleClickAction">
                  ${this.renderGestureActionOptions(this.state.preferences.interaction.tripleClickAction)}
                </select>
              </label>
              <label class="field-row">
                <span>${this.t('settings.leftLongPressAction')}</span>
                <select class="settings-select" data-setting-field="interaction.leftLongPressAction">
                  ${this.renderGestureActionOptions(this.state.preferences.interaction.leftLongPressAction)}
                </select>
              </label>
              <label class="field-row">
                <span>${this.t('settings.middleLongPressAction')}</span>
                <select class="settings-select" data-setting-field="interaction.middleLongPressAction">
                  ${this.renderGestureActionOptions(this.state.preferences.interaction.middleLongPressAction)}
                </select>
              </label>
              <label class="field-row">
                <span>${this.t('settings.rightLongPressAction')}</span>
                <select class="settings-select" data-setting-field="interaction.rightLongPressAction">
                  ${this.renderGestureActionOptions(this.state.preferences.interaction.rightLongPressAction)}
                </select>
              </label>
              <label class="field-row">
                <span>${this.t('settings.spaceAction')}</span>
                <select class="settings-select" data-setting-field="interaction.spaceAction">
                  ${this.renderGestureActionOptions(this.state.preferences.interaction.spaceAction)}
                </select>
              </label>
            </div>
            <div class="settings-subsection">
              <p class="section-label">${this.t('settings.operationBindings')}</p>
              <label class="field-row">
                <span>${this.t('settings.leftDragAction')}</span>
                <select class="settings-select" data-setting-field="interaction.canvasLeftDragAction">
                  ${this.renderCanvasDragActionOptions(this.state.preferences.interaction.canvasLeftDragAction)}
                </select>
              </label>
              <label class="field-row">
                <span>${this.t('settings.middleDragAction')}</span>
                <select class="settings-select" data-setting-field="interaction.canvasMiddleDragAction">
                  ${this.renderCanvasDragActionOptions(this.state.preferences.interaction.canvasMiddleDragAction)}
                </select>
              </label>
              <label class="field-row">
                <span>${this.t('settings.rightDragAction')}</span>
                <select class="settings-select" data-setting-field="interaction.canvasRightDragAction">
                  ${this.renderCanvasDragActionOptions(this.state.preferences.interaction.canvasRightDragAction)}
                </select>
              </label>
            </div>
          </section>

          <section class="settings-card">
            <p class="section-label">${this.t('settings.ai')}</p>
            <label class="field-row">
              <span>${this.t('settings.aiProvider')}</span>
              <select class="settings-select" data-setting-field="ai.provider">
                <option value="lmstudio" ${this.state.preferences.ai.provider === 'lmstudio' ? 'selected' : ''}>${this.t('settings.aiProvider.lmstudio')}</option>
                <option value="openai-compatible" ${this.state.preferences.ai.provider === 'openai-compatible' ? 'selected' : ''}>${this.t('settings.aiProvider.openaiCompatible')}</option>
              </select>
            </label>
            <label class="field-stack">
              <span>${this.t('settings.aiBaseUrl')}</span>
              <input class="settings-input" data-setting-field="ai.baseUrl" value="${escapeAttribute(this.state.preferences.ai.baseUrl)}" />
            </label>
            <label class="field-stack">
              <span>${this.t('settings.aiApiKey')}</span>
              <input
                class="settings-input"
                type="password"
                autocomplete="off"
                data-setting-field="ai.apiKey"
                value="${escapeAttribute(this.state.preferences.ai.apiKey)}"
                placeholder="${escapeAttribute(this.t('settings.aiApiKeyPlaceholder'))}"
              />
            </label>
            <label class="field-stack">
              <span>${this.t('settings.aiModel')}</span>
              <input
                class="settings-input"
                data-setting-field="ai.model"
                value="${escapeAttribute(this.state.preferences.ai.model)}"
                placeholder="${escapeAttribute(this.t('settings.aiModelPlaceholder'))}"
              />
            </label>
            <label class="field-stack">
              <span>${this.t('settings.aiMaxTokens')}</span>
              <input
                class="settings-input"
                type="number"
                min="256"
                max="32768"
                step="256"
                inputmode="numeric"
                data-setting-field="ai.maxTokens"
                value="${escapeAttribute(String(this.state.preferences.ai.maxTokens || DEFAULT_AI_MAX_TOKENS))}"
              />
            </label>
            <p class="inspector-copy">${this.t('settings.aiMaxTokensHint')}</p>
            <label class="field-stack">
              <span>${this.t('settings.aiTimeout')}</span>
              <input
                class="settings-input"
                type="number"
                min="1"
                max="600"
                step="1"
                inputmode="numeric"
                data-setting-field="ai.timeoutSeconds"
                value="${escapeAttribute(String(this.state.preferences.ai.timeoutSeconds || DEFAULT_AI_TIMEOUT_SECONDS))}"
              />
            </label>
            <p class="inspector-copy">${this.t('settings.aiTimeoutHint')}</p>
            <p class="inspector-copy">${this.t('settings.aiHint')}</p>
          </section>
        </section>
      </div>
    `
  }

  private renderAIWorkspace(): void {
    if (!this.refs) {
      return
    }

    if (!this.state.ai.open) {
      this.refs.aiLayer.innerHTML = ''
      this.refs.aiLayer.className = ''
      return
    }

    const examplePrompt = promptTemplateCopy(this.state.ai.template, this.state.preferences.locale)
    const aiStatusNotice = this.renderAIStatusNotice()
    const noteTargets = this.resolveAINoteTargets()
    const rawModeLabel = `${this.aiDebugText('rawMode')}: ${this.t(this.state.ai.rawMode ? 'common.on' : 'common.off')}`
    this.refs.aiLayer.className = 'ai-layer is-visible'
    this.refs.aiLayer.innerHTML = `
      <div class="ai-scrim" data-ai-scrim>
        <section class="ai-drawer" role="dialog" aria-modal="true">
          <header class="settings-header">
            <div>
              <p class="section-label">${this.t('toolbar.ai')}</p>
              <h2>${this.t('ai.title')}</h2>
              <p class="inspector-copy">${this.t('ai.subtitle')}</p>
            </div>
            <button type="button" class="ghost-button" data-command="close-ai-workspace">${this.t('settings.close')}</button>
          </header>

          ${aiStatusNotice}

          <section class="settings-card">
            <div class="ai-action-row ai-debug-toggle-row">
              <button type="button" class="chip-button ${this.state.ai.debugOpen ? 'is-active' : ''}" data-command="toggle-ai-debug">
                ${this.state.ai.debugOpen ? this.aiDebugText('hide') : this.aiDebugText('show')}
              </button>
              <button type="button" class="chip-button ${this.state.ai.rawMode ? 'is-active' : ''}" data-command="toggle-ai-raw-mode">
                ${rawModeLabel}
              </button>
            </div>
            <p class="inspector-copy">${this.aiDebugText('hint')}</p>
          </section>

          <section class="settings-card">
            <p class="section-label">${this.t('ai.generate')}</p>
            <label class="field-row">
              <span>${this.t('ai.template')}</span>
              <select class="settings-select" data-ai-field="template">
                ${AI_TEMPLATES.map((template) => {
                  return `<option value="${template.id}" ${this.state.ai.template === template.id ? 'selected' : ''}>${templateLabel(template.id, this.state.preferences.locale)}</option>`
                }).join('')}
              </select>
            </label>
            <label class="field-stack">
              <span>${this.t('ai.topic')}</span>
              <input
                class="settings-input"
                data-ai-field="topic"
                value="${escapeAttribute(this.state.ai.topic)}"
                placeholder="${escapeAttribute(this.t('ai.topicPlaceholder'))}"
              />
            </label>
            <label class="field-stack">
              <span>${this.t('ai.instructions')}</span>
              <textarea class="settings-input ai-textarea" data-ai-field="generationInstructions" placeholder="${escapeAttribute(this.t('ai.instructionsPlaceholder'))}">${escapeHtml(this.state.ai.generationInstructions)}</textarea>
            </label>
            <div class="ai-action-row">
              <button type="button" class="action-button primary-action" data-command="ai-generate-map" ${this.state.ai.busy ? 'disabled' : ''}>${this.t('ai.generateAction')}</button>
              <button type="button" class="chip-button" data-command="ai-expand-map" ${this.state.ai.busy ? 'disabled' : ''}>${this.t('ai.expandAction')}</button>
              <button type="button" class="chip-button" data-command="create-template-map:${this.state.ai.template}" ${this.state.ai.busy ? 'disabled' : ''}>${this.t('ai.templateAction')}</button>
            </div>
            ${this.renderAIRawEditor('generateRawRequest', this.state.ai.generateRawRequest)}
            <p class="inspector-copy">${escapeHtml(examplePrompt)}</p>
          </section>

          <section class="settings-card">
            <p class="section-label">${this.t('ai.import')}</p>
            <p class="inspector-copy">${this.t('ai.importHint')}</p>
            <label class="field-stack">
              <span>${this.t('ai.instructions')}</span>
              <textarea class="settings-input ai-textarea" data-ai-field="importInstructions" placeholder="${escapeAttribute(this.t('ai.importPlaceholder'))}">${escapeHtml(this.state.ai.importInstructions)}</textarea>
            </label>
            <div class="ai-action-row">
              <button type="button" class="action-button" data-command="ai-import-file" ${this.state.ai.busy ? 'disabled' : ''}>${this.t('ai.importAction')}</button>
            </div>
            ${this.renderAIRawEditor('importRawRequest', this.state.ai.importRawRequest)}
          </section>

          <section class="settings-card">
            <p class="section-label">${this.t('ai.notes')}</p>
            <p class="inspector-copy">${this.t(
              noteTargets.mode === 'selection' ? 'ai.notesSelectionHint' : 'ai.notesAllHint',
              {
                value: noteTargets.nodes.length,
              },
            )}</p>
            <label class="field-stack">
              <span>${this.t('ai.instructions')}</span>
              <textarea class="settings-input ai-textarea" data-ai-field="noteInstructions" placeholder="${escapeAttribute(this.t('ai.notesPlaceholder'))}">${escapeHtml(this.state.ai.noteInstructions)}</textarea>
            </label>
            <div class="ai-action-row">
              <button type="button" class="action-button" data-command="ai-complete-node-notes" ${this.state.ai.busy ? 'disabled' : ''}>${this.t('ai.notesAction')}</button>
              <button type="button" class="chip-button" data-command="ai-complete-node-notes-as-children" ${this.state.ai.busy ? 'disabled' : ''}>${this.aiNoteChildActionLabel()}</button>
            </div>
            ${this.renderAIRawEditor('noteRawRequest', this.state.ai.noteRawRequest)}
          </section>

          <section class="settings-card">
            <p class="section-label">${this.t('ai.suggestChildren')}</p>
            <p class="inspector-copy">${this.t(
              this.selectedNode() ? 'ai.suggestChildrenHint' : 'ai.suggestChildrenNoSelection',
              {
                title: this.selectedNode()?.title ?? '',
              },
            )}</p>
            <div class="ai-action-row">
              <button type="button" class="action-button" data-command="ai-suggest-children" ${this.state.ai.busy || !this.selectedNode() ? 'disabled' : ''}>${this.t('ai.suggestChildrenAction')}</button>
              <button type="button" class="chip-button" data-command="ai-suggest-siblings" ${this.state.ai.busy || !this.canSuggestSiblings() ? 'disabled' : ''}>${this.t('ai.suggestSiblingsAction')}</button>
            </div>
          </section>

          <section class="settings-card">
            <p class="section-label">${this.t('ai.connect')}</p>
            <p class="inspector-copy">${this.t('ai.connectHint', {
              nodes: this.state.document.nodes.length,
              relations: this.state.document.relations.length,
            })}</p>
            <label class="field-stack">
              <span>${this.t('ai.instructions')}</span>
              <textarea class="settings-input ai-textarea" data-ai-field="relationInstructions" placeholder="${escapeAttribute(this.t('ai.connectPlaceholder'))}">${escapeHtml(this.state.ai.relationInstructions)}</textarea>
            </label>
            <div class="ai-action-row">
              <button type="button" class="chip-button" data-command="test-ai-connection" ${this.state.ai.busy || this.state.ai.testing ? 'disabled' : ''}>${this.state.ai.testing ? `${this.t('ai.testConnection')}...` : this.t('ai.testConnection')}</button>
              <button type="button" class="action-button" data-command="ai-connect-relations" ${this.state.ai.busy ? 'disabled' : ''}>${this.t('ai.connectAction')}</button>
            </div>
            ${this.renderAIRawEditor('relationRawRequest', this.state.ai.relationRawRequest)}
            ${
              this.state.ai.connectionMessage
                ? `<p class="ai-connection-note ${this.state.ai.connectionOK === true ? 'is-ok' : this.state.ai.connectionOK === false ? 'is-error' : ''}">${
                    this.state.ai.connectionModel
                      ? `<strong>${escapeHtml(this.t('ai.connectionModel', { value: this.state.ai.connectionModel }))}</strong><br />`
                      : ''
                  }${escapeHtml(this.state.ai.connectionMessage)}</p>`
                : ''
            }
          </section>

          ${
            this.state.ai.lastSummary
              ? `
                <section class="settings-card">
                  <p class="section-label">${this.t('ai.lastResult')}</p>
                  <p class="inspector-copy"><strong>${escapeHtml(this.state.ai.lastModel || this.t('common.unknown'))}</strong>: ${escapeHtml(this.state.ai.lastSummary)}</p>
                </section>
              `
              : ''
          }

          ${this.renderAIDebugPanel()}
        </section>
      </div>
    `
  }

  private renderAIRawEditor(
    field: 'generateRawRequest' | 'importRawRequest' | 'noteRawRequest' | 'relationRawRequest',
    value: string,
  ): string {
    if (!this.state.ai.debugOpen && !this.state.ai.rawMode) {
      return ''
    }

    return `
      <label class="field-stack">
        <span>${this.aiDebugText('rawRequest')}</span>
        <textarea class="settings-input ai-textarea ai-raw-textarea" data-ai-field="${field}" spellcheck="false">${escapeHtml(value)}</textarea>
      </label>
    `
  }

  private renderAIDebugPanel(): string {
    if (!this.state.ai.debugOpen) {
      return ''
    }

    const debug = this.state.ai.lastDebugInfo
    const actionLabel = this.aiDebugActionLabel(this.state.ai.lastDebugAction)
    return `
      <section class="settings-card">
        <p class="section-label">${this.aiDebugText('title')}</p>
        ${
          actionLabel
            ? `<p class="inspector-copy">${escapeHtml(this.aiDebugText('lastAction', actionLabel))}</p>`
            : `<p class="inspector-copy">${this.aiDebugText('empty')}</p>`
        }
        ${
          this.state.ai.lastDebugError
            ? `<p class="ai-connection-note is-error"><strong>${escapeHtml(this.aiDebugText('lastError'))}</strong><br />${escapeHtml(this.state.ai.lastDebugError)}</p>`
            : ''
        }
        ${
          debug
            ? `
              <div class="ai-debug-grid">
                <section class="ai-debug-block">
                  <p class="section-label">${this.aiDebugText('rawRequest')}</p>
                  <pre class="ai-debug-pre">${escapeHtml(debug.upstreamRequest || '')}</pre>
                </section>
                <section class="ai-debug-block">
                  <p class="section-label">${this.aiDebugText('rawResponse')}</p>
                  <pre class="ai-debug-pre">${escapeHtml(debug.upstreamResponse || '')}</pre>
                </section>
                <section class="ai-debug-block">
                  <p class="section-label">${this.aiDebugText('assistantContent')}</p>
                  <pre class="ai-debug-pre">${escapeHtml(debug.assistantContent || '')}</pre>
                </section>
              </div>
            `
            : ''
        }
      </section>
    `
  }

  private aiDebugActionLabel(action: AIDebugAction): string {
    switch (action) {
      case 'generate':
        return this.t('ai.generate')
      case 'import':
        return this.t('ai.import')
      case 'notes':
        return this.t('ai.notes')
      case 'relations':
        return this.t('ai.connect')
      default:
        return ''
    }
  }

  private aiNoteChildActionLabel(): string {
    return this.state.preferences.locale === 'zh-CN' ? '生成注释并添加为下级节点' : 'Generate Notes as Child Nodes'
  }

  private aiDebugText(
    key:
      | 'title'
      | 'show'
      | 'hide'
      | 'hint'
      | 'empty'
      | 'lastAction'
      | 'lastError'
      | 'rawMode'
      | 'rawRequest'
      | 'rawResponse'
      | 'assistantContent',
    value = '',
  ): string {
    if (this.state.preferences.locale === 'zh-CN') {
      switch (key) {
        case 'title':
          return 'AI 调试'
        case 'show':
          return '显示调试'
        case 'hide':
          return '隐藏调试'
        case 'hint':
          return '开启 RAW 模式后，编辑区中的 JSON 会被直接发送到上游 AI 接口；关闭 RAW 模式时，这里会保留最近一次自动生成并捕获到的请求，方便复制和修改。'
        case 'empty':
          return '先执行一次 AI 操作，才能捕获上游请求和完整响应。'
        case 'lastAction':
          return `最近调试动作：${value}`
        case 'lastError':
          return '最近错误'
        case 'rawMode':
          return 'RAW 模式'
        case 'rawRequest':
          return 'RAW 请求'
        case 'rawResponse':
          return '原始响应'
        case 'assistantContent':
          return '助手内容'
        default:
          return ''
      }
    }

    switch (key) {
      case 'title':
        return 'AI Debug'
      case 'show':
        return 'Show Debug'
      case 'hide':
        return 'Hide Debug'
      case 'hint':
        return 'RAW mode sends the edited JSON directly to the upstream AI endpoint. When RAW mode is off, this area keeps the last captured request for reference.'
      case 'empty':
        return 'Run an AI action to capture the upstream request and full response.'
      case 'lastAction':
        return `Last action: ${value}`
      case 'lastError':
        return 'Last error'
      case 'rawMode':
        return 'RAW Mode'
      case 'rawRequest':
        return 'RAW Request'
      case 'rawResponse':
        return 'Raw Response'
      case 'assistantContent':
        return 'Assistant Content'
      default:
        return ''
    }
  }

  private renderAIStatusNotice(): string {
    const tone = this.aiStatusTone()
    if (!tone) {
      return ''
    }

    return `<p class="ai-status-note ${tone}">${escapeHtml(this.t(this.state.status.key, this.state.status.values))}</p>`
  }

  private aiStatusTone(): 'is-busy' | 'is-error' | 'is-ok' | 'is-info' | null {
    switch (this.state.status.key) {
      case 'status.aiRunning':
      case 'status.aiTestingConnection':
        return 'is-busy'
      case 'status.aiFailed':
      case 'status.aiConnectionFailed':
        return 'is-error'
      case 'status.aiRelationsApplied':
      case 'status.aiNotesApplied':
      case 'status.aiConnectionOK':
        return 'is-ok'
      case 'status.aiNoRelations':
      case 'status.aiNoNoteTargets':
      case 'status.aiNoNotes':
      case 'status.aiTopicRequired':
        return 'is-info'
      default:
        return null
    }
  }

  private renderGraphOverlay(): void {
    if (!this.refs) {
      return
    }

    if (!this.state.graph.open) {
      this.stopGraphAnimation()
      this.refs.graphLayer.innerHTML = ''
      this.refs.graphLayer.className = ''
      return
    }

    this.refs.graphLayer.className = 'graph-layer is-visible'
    this.refs.graphLayer.innerHTML = `
      <div class="graph-scrim" data-graph-scrim>
        <section class="graph-sheet" role="dialog" aria-modal="true">
          <header class="graph-header">
            <div>
              <p class="section-label">${this.t('toolbar.graph3d')}</p>
              <h2>${this.t('graph.title')}</h2>
              <p class="inspector-copy">${this.t('graph.subtitle')}</p>
            </div>
            <div class="ai-action-row">
              <button type="button" class="chip-button" data-command="toggle-graph-autorotate">${this.t(
                'graph.autoRotate',
                {
                  value: this.state.graph.autoRotate ? this.t('common.on') : this.t('common.off'),
                },
              )}</button>
              <button type="button" class="chip-button" data-command="reset-graph-view">${this.t('graph.resetView')}</button>
              <button type="button" class="chip-button" data-command="focus-graph-selected" ${this.state.graph.selectedNodeId ? '' : 'disabled'}>${this.t('graph.focusAction')}</button>
              <button type="button" class="ghost-button" data-command="close-graph-overlay">${this.t('settings.close')}</button>
            </div>
          </header>

          <div class="graph-toolbar">
            <input
              class="settings-input"
              data-graph-search
              value="${escapeAttribute(this.state.graph.search)}"
              placeholder="${escapeAttribute(this.t('graph.searchPlaceholder'))}"
            />
            <span class="metric-chip">${this.t('graph.dragHint')}</span>
            <span class="metric-chip">${this.t('graph.zoomHint')}</span>
            <button type="button" class="chip-button" data-command="graph-zoom-out">${this.t('graph.zoomOut')}</button>
            <span class="metric-chip" data-graph-zoom-value>${this.t('graph.zoomValue', { value: Math.round(this.state.graph.zoom * 100) })}</span>
            <button type="button" class="chip-button" data-command="graph-zoom-in">${this.t('graph.zoomIn')}</button>
            <span class="metric-chip">${this.t('dock.nodes', { value: this.state.document.nodes.length })}</span>
            <span class="metric-chip">${this.t('dock.relations', { value: this.state.document.relations.length })}</span>
          </div>

          <div class="graph-layout">
            <div class="graph-canvas-shell">
              <canvas class="graph-canvas" data-graph-canvas></canvas>
            </div>
            <aside class="graph-sidebar">
              <div class="graph-result-list" data-graph-result-list>${this.renderGraphResultsList()}</div>
              <div class="graph-summary" data-graph-summary>${this.renderGraphSummaryContent()}</div>
            </aside>
          </div>
        </section>
      </div>
    `

    this.syncGraphAnimation()
    this.drawGraphScene()
  }

  private renderOnboarding(): void {
    if (!this.refs) {
      return
    }

    if (!this.onboardingOpen()) {
      this.refs.onboardingLayer.innerHTML = ''
      this.refs.onboardingLayer.className = ''
      return
    }

    const locale = this.state.preferences.locale
    this.refs.onboardingLayer.className = 'onboarding-layer is-visible'
    this.refs.onboardingLayer.innerHTML = `
      <div class="onboarding-scrim">
        <section class="onboarding-dialog" role="dialog" aria-modal="true">
          <p class="section-label">${this.t('toolbar.settings')}</p>
          <h2>${this.t('onboarding.title')}</h2>
          <p class="inspector-copy">${this.t('onboarding.subtitle')}</p>
          <div class="locale-grid">
            ${this.renderLocaleOption('zh-CN', locale)}
            ${this.renderLocaleOption('en', locale)}
          </div>
          <button type="button" class="action-button primary-action" data-command="complete-onboarding">${this.t('onboarding.continue')}</button>
        </section>
      </div>
    `
  }

  private renderLocaleOption(option: Locale, activeLocale: Locale): string {
    const activeClass = option === activeLocale ? 'is-active' : ''
    return `
      <button type="button" class="locale-option ${activeClass}" data-locale-option="${option}">
        <strong>${escapeHtml(this.t(`onboarding.locale.${option}.title` as TranslationKey))}</strong>
        <span>${escapeHtml(this.t(`onboarding.locale.${option}.copy` as TranslationKey))}</span>
      </button>
    `
  }

  private renderEdges(): string {
    const visibleIds = visibleNodeIds(this.state.document)
    const edgeStyle = this.state.preferences.appearance.edgeStyle
    const drawEdgeStyle: EdgeStyle = edgeStyle === 'hidden' ? 'curve' : edgeStyle
    const projectPosition = (position: Position) => this.toWorkspacePosition(position)
    const childCountById = new Map(
      this.state.document.nodes.map((node) => [node.id, childrenOf(this.state.document, node.id).length]),
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
        : this.state.document.nodes
            .filter((node) => Boolean(node.parentId) && visibleIds.has(node.id) && visibleIds.has(node.parentId ?? ''))
            .map((node) => {
              const parent = this.findNode(node.parentId ?? '')
              if (!parent) {
                return ''
              }
              const edgePoints = resolveHierarchyEdgeEndpoints(
                this.resolveNodeRenderMetrics(parent, childCountById.get(parent.id) ?? 0),
                this.resolveNodeRenderMetrics(node, childCountById.get(node.id) ?? 0),
              )
              return `<path class="edge edge-hierarchy" d="${buildHierarchyPath(projectPosition(edgePoints.source), projectPosition(edgePoints.target), drawEdgeStyle)}" />`
            })
            .join('')

    // Relation edges - always shown (even when hierarchy is hidden), with optional arrows and branches
    const relationEdges = this.state.document.relations
      .map((edge) => {
        const source = this.findNode(edge.sourceId)
        const target = this.findNode(edge.targetId)
        if (!source || !target || !visibleIds.has(source.id) || !visibleIds.has(target.id)) {
          return ''
        }

        const sourceMetrics = this.resolveNodeRenderMetrics(source, childCountById.get(source.id) ?? 0)
        const targetMetrics = this.resolveNodeRenderMetrics(target, childCountById.get(target.id) ?? 0)
        const edgePoints = resolveRelationEdgeEndpoints(sourceMetrics, targetMetrics)
        const projectedSource = projectPosition(edgePoints.source)
        const projectedTarget = projectPosition(edgePoints.target)
        const midpointDoc = this.resolveRelationMidpointForEdge(edge, sourceMetrics, targetMetrics, drawEdgeStyle)
        const mid = projectPosition(midpointDoc)
        const label = edge.label
          ? `<text class="relation-label" x="${mid.x}" y="${mid.y - 10}">${escapeHtml(edge.label)}</text>`
          : ''

        const midpointDrag = this.state.midpointDrag?.relationId === edge.id ? this.state.midpointDrag : null
        const isSelected = this.state.selectedRelationId === edge.id
        const selectedClass = isSelected ? ' is-selected' : ''
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
              `<path class="edge edge-relation${selectedClass}" d="${buildRelationSegmentPath(projectedSource, mid, drawEdgeStyle)}"${markerStart} />`,
              `<path class="edge edge-relation${selectedClass}" d="${buildRelationSegmentPath(mid, projectedTarget, drawEdgeStyle)}"${markerEnd} />`,
            ]
          : [
              `<path class="edge edge-relation${selectedClass}" d="${buildRelationSegmentPath(projectedSource, projectedTarget, drawEdgeStyle)}"${markerStart}${markerEnd} />`,
            ]
        const hitSegments = usesMidpointHub
          ? [
              buildRelationSegmentPath(projectedSource, mid, drawEdgeStyle),
              buildRelationSegmentPath(mid, projectedTarget, drawEdgeStyle),
            ]
          : [buildRelationSegmentPath(projectedSource, projectedTarget, drawEdgeStyle)]
        const branchPaths: string[] = []

        for (const branch of edge.branches ?? []) {
          const branchNode = this.findNode(branch.targetId)
          if (!branchNode || !visibleIds.has(branchNode.id)) {
            continue
          }
          const branchMetrics = this.resolveNodeRenderMetrics(branchNode, childCountById.get(branchNode.id) ?? 0)
          const branchTarget = projectPosition(resolveNodeAnchorToward(branchMetrics, midpointDoc))
          const branchPath = buildRelationSegmentPath(mid, branchTarget, drawEdgeStyle)
          hitSegments.push(branchPath)
          branchPaths.push(
            `<path class="edge edge-relation edge-branch${selectedClass}" d="${branchPath}"${markerEnd} />`,
          )
        }

        let legacyWaypointLines = ''
        if (edge.waypoints && edge.waypoints.length > 0) {
          legacyWaypointLines = edge.waypoints
            .map((wp) => {
              const projectedWaypoint = projectPosition(wp)
              const path = buildRelationSegmentPath(mid, projectedWaypoint, drawEdgeStyle)
              hitSegments.push(path)
              return `<path class="edge edge-relation edge-branch${selectedClass}" d="${path}" />`
            })
            .join('')
        }

        const hitPath = `<path class="edge-hit-area${selectedClass}" data-relation-click="${edge.id}" d="${hitSegments.join(' ')}" />`

        // Midpoint dot for selected relation
        const midpointDot = isSelected
          ? `<circle class="edge-midpoint-dot" data-midpoint-dot="${edge.id}" cx="${mid.x}" cy="${mid.y}" r="6" />`
          : ''

        const branchPreview =
          midpointDrag?.mode === 'branch'
            ? (() => {
                const previewTarget = projectPosition(
                  this.clientToCanvasPosition(midpointDrag.currentClientX, midpointDrag.currentClientY),
                )
                const previewPath = buildRelationSegmentPath(mid, previewTarget, drawEdgeStyle)
                return `<path class="edge edge-connector-drag edge-branch-preview" d="${previewPath}" />`
              })()
            : ''

        return `<g>
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
    if (this.state.connectorDrag) {
      const sourceNode = this.findNode(this.state.connectorDrag.sourceNodeId)
      if (sourceNode) {
        const sourceMetrics = this.resolveNodeRenderMetrics(sourceNode, childCountById.get(sourceNode.id) ?? 0)
        const projSource = projectPosition({
          x: sourceMetrics.position.x + sourceMetrics.width / 2,
          y: sourceMetrics.position.y - sourceMetrics.height / 2,
        })
        const canvasPos = this.clientToCanvas(
          this.state.connectorDrag.currentClientX,
          this.state.connectorDrag.currentClientY,
        )
        if (canvasPos) {
          connectorLine = `<line class="edge edge-connector-drag" x1="${projSource.x}" y1="${projSource.y}" x2="${canvasPos.x}" y2="${canvasPos.y}" />`
        }
      }
    }

    return arrowDefs + hierarchyEdges + relationEdges + connectorLine
  }

  private resolveNodeRenderMetrics(node: MindNode, childCount: number): NodeRenderMetrics {
    const preview = this.activeEditorPreview
    if (preview && preview.nodeId === node.id) {
      return {
        position: {
          x: preview.anchorLeft + preview.width / 2,
          y: node.position.y,
        },
        width: preview.width,
        height: preview.height,
      }
    }

    const width = estimateNodeWidth(node, childCount)
    return {
      position: { ...node.position },
      width,
      height: estimateNodeHeight(node, childCount, width),
    }
  }

  private renderNodes(): string {
    const visibleIds = visibleNodeIds(this.state.document)
    const selectedIds = new Set(this.selectedNodeIds())
    const originX = this.workspaceBounds.originX
    const originY = this.workspaceBounds.originY

    return this.state.document.nodes
      .filter((node) => visibleIds.has(node.id))
      .map((node) => {
        const nodeColor = normalizeNodeColor(node.color)
        const isEditingNode = this.state.editingNodeId === node.id
        const preview = this.activeEditorPreview?.nodeId === node.id ? this.activeEditorPreview : null
        const autoWidthAnchorLeft = preview?.anchorLeft ?? this.activeEditorAnchorLeft
        const isAutoWidthEditingNode = isEditingNode && !node.width && autoWidthAnchorLeft !== null
        const classes = [
          'node-card',
          `node-${node.kind}`,
          nodeColor ? 'has-color' : '',
          isAutoWidthEditingNode ? 'is-editing-auto-width' : '',
          node.id === this.state.selectedNodeId ? 'is-selected' : '',
          selectedIds.has(node.id) && node.id !== this.state.selectedNodeId ? 'is-selected-secondary' : '',
          node.id === this.state.connectSourceNodeId ? 'is-connect-source' : '',
          node.collapsed ? 'is-collapsed' : '',
        ]
          .filter(Boolean)
          .join(' ')

        const priorityBadge = node.priority
          ? `<span class="priority-badge priority-${node.priority.toLowerCase()}">${node.priority}</span>`
          : ''

        const childCount = childrenOf(this.state.document, node.id).length
        const branchBadge =
          childCount > 0
            ? `<span class="node-branch-badge">${node.collapsed ? `+${hiddenDescendantCount(this.state.document, node.id)}` : childCount}</span>`
            : ''
        const collapseLabel = node.collapsed ? this.t('action.expand') : this.t('action.collapse')

        const nodeDimensions = buildNodeDimensionStyle(
          node,
          preview ? { width: preview.width, height: preview.height } : undefined,
        )
        const nodePresentationStyle = buildNodeColorStyle(nodeColor)
        const anchorX = isAutoWidthEditingNode ? (autoWidthAnchorLeft ?? node.position.x) : node.position.x
        const articleStyle = `left: ${anchorX + originX}px; top: ${node.position.y + originY}px; ${nodePresentationStyle}`

        const content = isEditingNode
          ? `<textarea class="node-editor" style="${nodeDimensions}" data-node-editor="${node.id}" rows="1" maxlength="120" spellcheck="false">${escapeHtml(
              node.title,
            )}</textarea>`
          : `<button type="button" class="node-shell" style="${nodeDimensions}" data-node-button="${node.id}">
               ${priorityBadge}
               <span class="node-title" data-node-title="${node.id}">${escapeHtml(nodeVisibleTitle(node))}</span>
               ${branchBadge}
             </button>`

        const resizeHandle =
          node.kind !== 'root'
            ? `<button type="button" class="node-resizer" data-node-resizer="${node.id}" aria-label="Resize node"></button>`
            : ''
        const collapseButton =
          childCount > 0
            ? `<button
               type="button"
               class="node-collapse-button"
               data-node-collapse-button="${node.id}"
               data-command="toggle-node-collapse:${node.id}"
               aria-label="${escapeAttribute(collapseLabel)}"
               title="${escapeAttribute(collapseLabel)}"
             ></button>`
            : ''

        const connectorDot = `<button type="button" class="node-connector-dot" data-node-connector="${node.id}" aria-label="Drag to connect"></button>`

        return `
          <article
            class="${classes}"
            data-node-id="${node.id}"
            style="${articleStyle}"
          >
            ${content}
            ${collapseButton}
            ${resizeHandle}
            ${connectorDot}
          </article>
        `
      })
      .join('')
  }

  private renderPriorityButton(priority: Priority, selectedPriority: Priority): string {
    const label = priority === '' ? this.t('priority.clear') : priority
    const active = selectedPriority === priority
    return `<button type="button" class="chip-button ${active ? 'is-active' : ''}" data-priority="${priority}">${label}</button>`
  }

  private renderNodeColorButton(color: NodeColor, selectedColor: NodeColor): string {
    const active = selectedColor === color
    if (color === '') {
      return `<button type="button" class="color-button color-button-clear ${active ? 'is-active' : ''}" data-node-color="" title="${escapeAttribute(this.t('color.clear'))}" aria-label="${escapeAttribute(this.t('color.clear'))}">${this.t('color.clear')}</button>`
    }

    const palette = NODE_COLOR_PALETTES[color]
    const label = this.t(palette.labelKey)
    return `
      <button
        type="button"
        class="color-button ${active ? 'is-active' : ''}"
        data-node-color="${color}"
        title="${escapeAttribute(label)}"
        aria-label="${escapeAttribute(label)}"
        style="--color-swatch: ${palette.accent};"
      >
        <span class="color-button-swatch"></span>
      </button>
    `
  }

  private renderRelationList(nodeId: string): string {
    const relations = connectedRelations(this.state.document, nodeId)
    if (relations.length === 0) {
      return `<p class="empty-state">${this.t('inspector.emptyRelations')}</p>`
    }

    return `
      <ul class="relation-list">
        ${relations
          .map((relation) => {
            const otherNodeId = relation.sourceId === nodeId ? relation.targetId : relation.sourceId
            const otherNode = this.findNode(otherNodeId)
            return `
              <li class="relation-item">
                <div class="relation-item-top">
                  <button type="button" class="text-button" data-command="focus-node:${otherNodeId}">
                    ${escapeHtml(otherNode?.title ?? this.t('common.unknownNode'))}
                  </button>
                  <button type="button" class="ghost-button danger" data-command="delete-relation:${relation.id}">${this.t('action.remove')}</button>
                </div>
                <input
                  class="relation-input"
                  data-relation-label="${relation.id}"
                  value="${escapeAttribute(relation.label ?? '')}"
                  placeholder="${escapeAttribute(this.t('inspector.relationPlaceholder'))}"
                />
              </li>
            `
          })
          .join('')}
      </ul>
    `
  }

  private currentSnapshotList(): LocalSnapshotSummary[] {
    if (!this.state.currentMapId) {
      return []
    }

    return listLocalSnapshots(this.state.currentMapId)
  }

  private renderSnapshotSection(): string {
    const snapshots = this.currentSnapshotList()
    const canSaveSnapshot = Boolean(this.state.currentMapId)
    return `
      <section class="inspector-card">
        <div class="inspector-header">
          <div>
            <p class="section-label">${this.t('snapshot.title')}</p>
            <h2>${this.t('snapshot.heading')}</h2>
          </div>
        </div>
        <p class="inspector-copy">${this.t('snapshot.copy')}</p>
        <div class="snapshot-save-row">
          <label class="snapshot-name-field">
            <span class="snapshot-name-label">${this.t('snapshot.nameLabel')}</span>
            <input
              class="settings-input snapshot-name-input"
              data-snapshot-name
              value="${escapeAttribute(this.state.snapshotDraftName)}"
              placeholder="${escapeAttribute(this.t('snapshot.namePlaceholder'))}"
              ${canSaveSnapshot ? '' : 'disabled'}
            />
          </label>
          <button type="button" class="chip-button" data-command="save-snapshot" ${canSaveSnapshot ? '' : 'disabled'}>${this.t('snapshot.save')}</button>
        </div>
        ${
          snapshots.length === 0
            ? `<p class="empty-state">${this.t('snapshot.empty')}</p>`
            : `
              <ul class="snapshot-list">
                ${snapshots
                  .map((snapshot) => {
                    const modeLabel =
                      snapshot.mode === 'manual' ? this.t('snapshot.modeManual') : this.t('snapshot.modeAuto')
                    const metaSuffix =
                      snapshot.mapTitle && snapshot.mapTitle !== snapshot.title
                        ? ` · ${escapeHtml(snapshot.mapTitle)}`
                        : ''
                    return `
                      <li class="snapshot-item">
                        <div class="snapshot-item-copy">
                          <p class="snapshot-item-title">${escapeHtml(snapshot.title)}</p>
                          <p class="snapshot-item-meta">${escapeHtml(modeLabel)} · ${escapeHtml(
                            formatRelativeTime(snapshot.createdAt, this.state.preferences.locale),
                          )} · ${escapeHtml(this.t('dock.nodes', { value: snapshot.nodeCount }))}${metaSuffix}</p>
                        </div>
                        <button type="button" class="ghost-button snapshot-restore-button" data-command="restore-snapshot:${snapshot.id}">${this.t('snapshot.restore')}</button>
                      </li>
                    `
                  })
                  .join('')}
              </ul>
            `
        }
      </section>
    `
  }

  private nodeEditor(nodeId = this.state.editingNodeId): HTMLTextAreaElement | null {
    if (!nodeId) {
      return null
    }

    return this.rootEl.querySelector<HTMLTextAreaElement>(`[data-node-editor="${nodeId}"]`)
  }

  private captureActiveNodeEditorDraft(): {
    nodeId: string
    value: string
    selectionStart: number
    selectionEnd: number
    anchorLeft: number | null
    preview: ActiveEditorPreviewState | null
  } | null {
    const nodeId = this.state.editingNodeId
    const editor = this.nodeEditor(nodeId)
    if (!nodeId || !editor) {
      return null
    }

    return {
      nodeId,
      value: editor.value,
      selectionStart: editor.selectionStart ?? editor.value.length,
      selectionEnd: editor.selectionEnd ?? editor.value.length,
      anchorLeft: this.activeEditorAnchorLeft,
      preview: this.activeEditorPreview,
    }
  }

  private restoreActiveNodeEditorDraft(
    draft: {
      nodeId: string
      value: string
      selectionStart: number
      selectionEnd: number
      anchorLeft: number | null
      preview: ActiveEditorPreviewState | null
    } | null,
  ): void {
    if (!draft || !this.findNode(draft.nodeId)) {
      return
    }

    this.state.editingNodeId = draft.nodeId
    this.activeEditorAnchorLeft = draft.anchorLeft
    this.activeEditorPreview = draft.preview
    this.pendingEditorOptions = {
      value: draft.value,
      selectionStart: draft.selectionStart,
      selectionEnd: draft.selectionEnd,
    }
  }

  private syncNodeEditorPreview(editor: HTMLTextAreaElement): void {
    const node = this.findNode(editor.dataset.nodeEditor ?? '')
    if (!node) {
      return
    }

    const computed = window.getComputedStyle(editor)
    const minWidth = Math.max(MIN_NODE_WIDTH, parsePixelValue(computed.minWidth))
    const maxWidth = Math.max(minWidth, parsePixelValue(computed.maxWidth) || AUTO_NODE_EDITOR_MAX_WIDTH)
    const minHeight = Math.max(MIN_NODE_HEIGHT, parsePixelValue(computed.minHeight))
    let previewWidth: number
    const previewAnchorLeft: number | null = this.activeEditorAnchorLeft

    if (node.width) {
      previewWidth = Math.max(node.width, MIN_NODE_WIDTH)
      editor.style.width = `${previewWidth}px`
      editor.style.maxWidth = 'none'
    } else {
      const horizontalPadding = parsePixelValue(computed.paddingLeft) + parsePixelValue(computed.paddingRight) + 2
      const longestLineWidth = editor.value
        .split(/\r?\n/)
        .reduce(
          (maxWidthSoFar, line) => Math.max(maxWidthSoFar, this.measureNodeEditorLineWidth(line || ' ', computed.font)),
          0,
        )
      previewWidth = clamp(Math.ceil(longestLineWidth + horizontalPadding), minWidth, maxWidth)
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
      this.activeEditorPreview = {
        nodeId: node.id,
        anchorLeft: previewAnchorLeft,
        width: previewWidth,
        height: previewHeight,
      }
      const article = this.rootEl.querySelector<HTMLElement>(`[data-node-id="${node.id}"]`)
      if (article) {
        article.classList.add('is-editing-auto-width')
        article.style.left = `${previewAnchorLeft + this.workspaceBounds.originX}px`
        article.style.top = `${node.position.y + this.workspaceBounds.originY}px`
      }
      if (this.refs?.edgeLayer) {
        this.refs.edgeLayer.innerHTML = this.renderEdges()
      }
      return
    }

    if (this.activeEditorPreview?.nodeId === node.id) {
      this.activeEditorPreview = null
      if (this.refs?.edgeLayer) {
        this.refs.edgeLayer.innerHTML = this.renderEdges()
      }
    }
  }

  private syncInspectorNoteInputs(): void {
    if (!this.refs) {
      return
    }

    for (const noteInput of this.refs.inspector.querySelectorAll<HTMLTextAreaElement>('[data-node-note]')) {
      this.syncInspectorNoteInputHeight(noteInput)
    }
  }

  private syncInspectorNoteInputHeight(input: HTMLTextAreaElement): void {
    const computed = window.getComputedStyle(input)
    const minHeight = Math.max(124, parsePixelValue(computed.minHeight))
    const maxHeight = Math.max(minHeight, parsePixelValue(computed.maxHeight) || 320)

    input.style.height = 'auto'
    const nextHeight = clamp(input.scrollHeight, minHeight, maxHeight)
    input.style.height = `${nextHeight}px`
    input.style.overflowY = input.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }

  private measureNodeEditorLineWidth(text: string, font: string): number {
    if (!this.nodeEditorMeasureCanvas) {
      this.nodeEditorMeasureCanvas = document.createElement('canvas')
    }

    const context = this.nodeEditorMeasureCanvas.getContext('2d')
    if (!context) {
      return Math.max(text.length, 1) * 8.6
    }

    context.font = font || '16px sans-serif'
    return context.measureText(text || ' ').width
  }

  private finishActiveNodeEditing(renderAfter = false): void {
    const nodeId = this.state.editingNodeId
    if (!nodeId) {
      return
    }

    const editor = this.nodeEditor(nodeId)
    const fallbackTitle = this.findNode(nodeId)?.title ?? ''
    this.commitNodeEditor(nodeId, editor?.value ?? fallbackTitle, {
      allowInactive: true,
      preserveSelection: true,
      renderAfter,
    })
  }

  private focusEditorIfNeeded(): void {
    if (!this.state.editingNodeId || this.overlayBlocksCanvas()) {
      return
    }

    const editor = this.nodeEditor(this.state.editingNodeId)
    if (!editor) {
      return
    }

    const pendingOptions = this.pendingEditorOptions
    this.pendingEditorOptions = null
    queueMicrotask(() => {
      if (pendingOptions?.value !== undefined && pendingOptions.value !== null) {
        editor.value = pendingOptions.value
      }
      this.syncNodeEditorPreview(editor)
      this.restoreEditorSelection(editor, pendingOptions)
      window.setTimeout(() => {
        this.syncNodeEditorPreview(editor)
        this.restoreEditorSelection(editor, pendingOptions)
      }, 0)
    })
  }

  private restoreEditorSelection(
    editor: HTMLInputElement | HTMLTextAreaElement,
    options: EditorLaunchOptions | null | undefined,
    attempt = 0,
  ): void {
    if (!editor.isConnected || this.state.editingNodeId !== editor.dataset.nodeEditor) {
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

    if (this.editorSelectionSettled(editor, options) || attempt >= 4) {
      return
    }

    window.requestAnimationFrame(() => {
      this.restoreEditorSelection(editor, options, attempt + 1)
    })
  }

  private editorSelectionSettled(
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

  private selectedNode(): MindNode | undefined {
    if (!this.state.selectedNodeId) {
      return undefined
    }

    return this.findNode(this.state.selectedNodeId)
  }

  private selectedNodeIds(): string[] {
    const seen = new Set<string>()
    const orderedIds: string[] = []
    for (const nodeId of this.state.selectedNodeIds) {
      if (seen.has(nodeId) || !this.findNode(nodeId)) {
        continue
      }
      seen.add(nodeId)
      orderedIds.push(nodeId)
    }

    return orderedIds
  }

  private applySelectionState(
    nodeIds: string[],
    primaryNodeId: string | null = nodeIds[nodeIds.length - 1] ?? null,
  ): void {
    const normalizedIds = nodeIds.filter((nodeId, index) => {
      return nodeIds.indexOf(nodeId) === index && Boolean(this.findNode(nodeId))
    })
    const nextIds = normalizedIds
    const nextPrimary =
      primaryNodeId && nextIds.includes(primaryNodeId) ? primaryNodeId : (nextIds[nextIds.length - 1] ?? null)

    this.state.selectedNodeIds = nextIds
    this.state.selectedNodeId = nextPrimary
  }

  private setSelection(nodeIds: string[], primaryNodeId: string | null = nodeIds[nodeIds.length - 1] ?? null): void {
    this.finishActiveNodeEditing()
    this.applySelectionState(nodeIds, primaryNodeId)
    this.state.selectedRegionId = null
    this.clearNodeEditorState()
  }

  private selectRegion(regionId: string): void {
    this.finishActiveNodeEditing()
    this.applySelectionState([], null)
    this.state.selectedRelationId = null
    this.state.selectedRegionId = regionId
    this.clearNodeEditorState()
  }

  private clearSelection(): void {
    const hadRelation = this.state.selectedRelationId !== null
    const hadRegion = this.state.selectedRegionId !== null
    this.state.selectedRelationId = null
    this.state.selectedRegionId = null
    if (this.state.selectedNodeIds.length === 0 && this.state.selectedNodeId === null && !hadRelation && !hadRegion) {
      return
    }

    this.setSelection([], null)
    this.render()
  }

  private moveSelectionByArrow(key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | string): void {
    const currentNode = this.selectedNode()
    if (!currentNode) {
      return
    }

    const nextNode = this.findDirectionalNode(currentNode, key)
    if (!nextNode || nextNode.id === currentNode.id) {
      return
    }

    this.setSelection([nextNode.id], nextNode.id)
    this.render()
  }

  private extendSelectionByArrow(key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | string): void {
    const currentNode = this.selectedNode()
    if (!currentNode) {
      return
    }

    const nextNode = this.findDirectionalNode(currentNode, key)
    if (!nextNode || nextNode.id === currentNode.id) {
      return
    }

    const nextIds = [...this.selectedNodeIds()]
    if (!nextIds.includes(nextNode.id)) {
      nextIds.push(nextNode.id)
    }
    this.setSelection(nextIds, nextNode.id)
    this.render()
  }

  private findDirectionalNode(currentNode: MindNode, direction: string): MindNode | null {
    const visibleIds = visibleNodeIds(this.state.document)
    const currentCenter = nodeCenter(currentNode)
    let bestNode: MindNode | null = null
    let bestScore = Number.POSITIVE_INFINITY

    for (const candidate of this.state.document.nodes) {
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

  private copySelectedSubtree(): void {
    const selectedNode = this.selectedNode()
    if (!selectedNode) {
      return
    }

    const subtreeIds = [selectedNode.id, ...descendantIds(this.state.document, selectedNode.id)]
    const nodes = subtreeIds
      .map((nodeId) => this.findNode(nodeId))
      .filter((node): node is MindNode => Boolean(node))
      .map((node) => {
        return {
          id: node.id,
          parentId: node.parentId,
          kind: node.kind,
          title: node.title,
          note: normalizeNodeNote(node.note),
          priority: node.priority,
          color: normalizeNodeColor(node.color) || undefined,
          collapsed: node.collapsed,
          width: node.width,
          height: node.height,
          offset: {
            x: node.position.x - selectedNode.position.x,
            y: node.position.y - selectedNode.position.y,
          },
        }
      })

    if (nodes.length === 0) {
      return
    }

    this.copiedSubtree = {
      rootId: selectedNode.id,
      nodes,
    }
    this.setStatus('status.subtreeCopied', { count: nodes.length })
    this.renderHeader()
  }

  private pasteCopiedSubtree(): void {
    if (!this.copiedSubtree) {
      this.setStatus('status.clipboardEmpty')
      this.render()
      return
    }

    const targetNode = this.selectedNode()
    if (!targetNode) {
      return
    }

    const rootSnapshot = this.copiedSubtree.nodes.find((node) => node.id === this.copiedSubtree?.rootId)
    if (!rootSnapshot) {
      this.setStatus('status.clipboardEmpty')
      this.render()
      return
    }

    const now = new Date().toISOString()
    const idMap = new Map<string, string>()
    const parent = this.findNode(targetNode.id)
    if (!parent) {
      return
    }

    this.captureHistory()
    parent.collapsed = false
    parent.updatedAt = now

    const anchor = nextChildPosition(
      this.state.document,
      targetNode.id,
      this.state.preferences.appearance.layoutMode,
      this.state.preferences.appearance.childGapX,
    )
    const insertedNodes: MindNode[] = []

    for (const snapshot of this.copiedSubtree.nodes) {
      const nextId = createId('node')
      idMap.set(snapshot.id, nextId)
      const isClipboardRoot = snapshot.id === this.copiedSubtree.rootId
      const parentId = isClipboardRoot
        ? targetNode.id
        : snapshot.parentId
          ? idMap.get(snapshot.parentId)
          : targetNode.id
      const nodeKind: MindNode['kind'] = isClipboardRoot ? 'topic' : snapshot.kind === 'root' ? 'topic' : snapshot.kind
      const position = {
        x: anchor.x + snapshot.offset.x,
        y: anchor.y + snapshot.offset.y,
      }
      insertedNodes.push({
        id: nextId,
        parentId,
        kind: nodeKind,
        title: snapshot.title,
        note: snapshot.note,
        priority: snapshot.priority,
        color: snapshot.color,
        collapsed: snapshot.collapsed,
        width: snapshot.width,
        height: snapshot.height,
        position,
        createdAt: now,
        updatedAt: now,
      })
    }

    this.state.document.nodes.push(...insertedNodes)
    const pastedRootId = idMap.get(this.copiedSubtree.rootId) ?? insertedNodes[0]?.id
    if (!pastedRootId) {
      return
    }

    this.setSelection([pastedRootId], pastedRootId)
    touchDocument(this.state.document)
    this.setStatus('status.subtreePasted', { count: insertedNodes.length })
    this.render()
    this.scheduleAutosave('status.layoutSaveScheduled')
  }

  private toggleNodeSelection(nodeId: string): void {
    if (this.state.connectSourceNodeId && this.state.connectSourceNodeId !== nodeId) {
      this.createRelation(this.state.connectSourceNodeId, nodeId)
      return
    }

    const currentIds = this.selectedNodeIds()
    if (currentIds.includes(nodeId)) {
      if (currentIds.length === 1) {
        this.setSelection([nodeId], nodeId)
      } else {
        const nextIds = currentIds.filter((candidateId) => candidateId !== nodeId)
        this.setSelection(nextIds, nextIds[nextIds.length - 1])
      }
    } else {
      this.setSelection([...currentIds, nodeId], nodeId)
    }

    this.render()
  }

  private selectNodeSubtree(nodeId: string): void {
    if (this.state.connectSourceNodeId && this.state.connectSourceNodeId !== nodeId) {
      this.createRelation(this.state.connectSourceNodeId, nodeId)
      return
    }

    const subtreeIds = [nodeId, ...descendantIds(this.state.document, nodeId)]
    this.setSelection(subtreeIds, nodeId)
    this.render()
  }

  private selectNode(nodeId: string): void {
    if (this.state.connectSourceNodeId && this.state.connectSourceNodeId !== nodeId) {
      this.createRelation(this.state.connectSourceNodeId, nodeId)
      return
    }

    if (this.state.connectSourceNodeId && this.state.connectSourceNodeId === nodeId) {
      this.state.connectSourceNodeId = null
      this.setStatus('status.relationModeCancelled')
    }

    this.state.selectedRelationId = null
    this.setSelection([nodeId], nodeId)
    this.render()
  }

  private createChildNode(parentId: string): void {
    const parent = this.findNode(parentId)
    if (!parent) {
      return
    }

    this.captureHistory()
    parent.collapsed = false
    parent.updatedAt = new Date().toISOString()
    const newNode = createNode({
      parentId,
      kind: 'topic',
      position: nextChildPosition(
        this.state.document,
        parentId,
        this.state.preferences.appearance.layoutMode,
        this.state.preferences.appearance.childGapX,
      ),
      title: this.t('node.newChild'),
      color: normalizeNodeColor(parent.color) || undefined,
    })

    this.state.document.nodes.push(newNode)
    this.relayoutHierarchyAfterInsert(newNode)
    this.setSelection([newNode.id], newNode.id)
    this.state.editingNodeId = newNode.id
    touchDocument(this.state.document)
    this.render()
    this.scheduleAutosave('status.childSaveScheduled')
  }

  private createSiblingNode(nodeId: string): void {
    const node = this.findNode(nodeId)
    if (!node) {
      return
    }

    this.captureHistory()
    let newNode: MindNode
    if (node.kind === 'root') {
      newNode = createNode({
        kind: 'floating',
        position: nextFloatingPosition(this.state.document),
        title: this.t('node.newFloating'),
        color: normalizeNodeColor(node.color) || undefined,
      })
    } else if (node.parentId) {
      newNode = createNode({
        parentId: node.parentId,
        kind: 'topic',
        position: nextSiblingPosition(
          this.state.document,
          node,
          this.state.preferences.appearance.layoutMode,
          this.state.preferences.appearance.childGapX,
        ),
        title: this.t('node.newSibling'),
        color: normalizeNodeColor(node.color) || undefined,
      })
    } else {
      newNode = createNode({
        kind: 'floating',
        position: nextFloatingPosition(this.state.document),
        title: this.t('node.newFloating'),
        color: normalizeNodeColor(node.color) || undefined,
      })
    }

    this.state.document.nodes.push(newNode)
    this.relayoutHierarchyAfterInsert(newNode)
    this.setSelection([newNode.id], newNode.id)
    this.state.editingNodeId = newNode.id
    touchDocument(this.state.document)
    this.render()
    this.scheduleAutosave('status.siblingSaveScheduled')
  }

  private createFloatingNode(nodeId: string): void {
    const node = this.findNode(nodeId)
    if (!node) {
      return
    }

    this.captureHistory()
    const newNode = createNode({
      kind: 'floating',
      position: nextFloatingPosition(this.state.document),
      title: this.t('node.newFloating'),
      color: normalizeNodeColor(node.color) || undefined,
    })

    this.state.document.nodes.push(newNode)
    this.setSelection([newNode.id], newNode.id)
    this.state.editingNodeId = newNode.id
    touchDocument(this.state.document)
    this.render()
    this.scheduleAutosave('status.siblingSaveScheduled')
  }

  private createRelation(sourceId: string, targetId: string): void {
    if (sourceId === targetId) {
      this.state.connectSourceNodeId = null
      this.setStatus('status.relationNeedsDifferentNodes')
      this.render()
      return
    }

    const exists = this.state.document.relations.some((edge) => {
      return (
        (edge.sourceId === sourceId && edge.targetId === targetId) ||
        (edge.sourceId === targetId && edge.targetId === sourceId)
      )
    })

    if (exists) {
      this.state.connectSourceNodeId = null
      this.setStatus('status.relationAlreadyExists')
      this.render()
      return
    }

    const relation: RelationEdge = {
      id: createId('rel'),
      sourceId,
      targetId,
      label: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    this.captureHistory()
    this.state.document.relations.push(relation)
    this.state.connectSourceNodeId = null
    this.setSelection([targetId], targetId)
    touchDocument(this.state.document)
    this.setStatus('status.relationCreated')
    this.render()
    this.scheduleAutosave('status.relationSaveScheduled')
  }

  private deleteSelectedNode(): void {
    const selectedIds = this.selectedNodeIds()
    const removableIds = selectedIds.filter((nodeId) => this.findNode(nodeId)?.kind !== 'root')
    if (removableIds.length === 0) {
      this.setStatus('status.rootCannotDelete')
      this.render()
      return
    }

    const primaryNode = this.selectedNode()
    const removeIds = new Set<string>()
    for (const nodeId of removableIds) {
      removeIds.add(nodeId)
      for (const descendantId of descendantIds(this.state.document, nodeId)) {
        removeIds.add(descendantId)
      }
    }

    const fallbackNodeId =
      primaryNode?.parentId && !removeIds.has(primaryNode.parentId)
        ? primaryNode.parentId
        : findRoot(this.state.document).id
    const relationCountBefore = this.state.document.relations.length
    const nodeCountBefore = this.state.document.nodes.length

    this.captureHistory()
    this.state.document.nodes = this.state.document.nodes.filter((node) => !removeIds.has(node.id))
    this.state.document.relations = this.state.document.relations
      .filter((relation) => !removeIds.has(relation.sourceId) && !removeIds.has(relation.targetId))
      .map((relation) => ({
        ...relation,
        branches: (relation.branches ?? []).filter((branch) => !removeIds.has(branch.targetId)),
      }))

    const removedNodes = nodeCountBefore - this.state.document.nodes.length
    const removedRelations = relationCountBefore - this.state.document.relations.length
    if (removedNodes === 0) {
      return
    }

    autoLayoutHierarchy(
      this.state.document,
      this.state.preferences.appearance.layoutMode,
      this.state.preferences.appearance.childGapX,
    )
    this.setSelection([fallbackNodeId], fallbackNodeId)
    this.state.editingNodeId = null
    this.state.connectSourceNodeId = null
    touchDocument(this.state.document)
    this.setStatus('status.deletedSummary', {
      nodes: removedNodes,
      relations: removedRelations,
    })
    this.render()
    this.scheduleAutosave('status.deletionSaveScheduled')
  }

  private setPriority(priority: Priority): void {
    const targetIds = this.selectedNodeIds().filter((nodeId) => Boolean(this.findNode(nodeId)))
    if (targetIds.length === 0) {
      return
    }

    const nextPriority = priority || undefined
    const targetNodes = targetIds
      .map((nodeId) => this.findNode(nodeId))
      .filter((node): node is MindNode => Boolean(node))

    if (targetNodes.every((node) => (node.priority ?? undefined) === nextPriority)) {
      return
    }

    this.captureHistory()
    for (const node of targetNodes) {
      this.updateNode(node.id, (draft) => {
        draft.priority = nextPriority
      })
    }
    touchDocument(this.state.document)
    this.setStatus(priority ? 'status.priorityApplied' : 'status.priorityCleared', priority ? { priority } : undefined)
    this.render()
    this.scheduleAutosave('status.prioritySaveScheduled')
  }

  private setNodeColor(color: NodeColor): void {
    const targetIds = this.selectedNodeIds().filter((nodeId) => Boolean(this.findNode(nodeId)))
    if (targetIds.length === 0) {
      return
    }

    const nextColor = normalizeNodeColor(color) || undefined
    const targetNodes = targetIds
      .map((nodeId) => this.findNode(nodeId))
      .filter((node): node is MindNode => Boolean(node))

    if (targetNodes.every((node) => (normalizeNodeColor(node.color) || undefined) === nextColor)) {
      return
    }

    this.captureHistory()
    for (const node of targetNodes) {
      this.updateNode(node.id, (draft) => {
        draft.color = nextColor
      })
    }
    touchDocument(this.state.document)
    this.setStatus(
      color ? 'status.colorApplied' : 'status.colorCleared',
      color ? { color: nodeColorLabel(this.state.preferences.locale, color) } : undefined,
    )
    this.render()
    this.scheduleAutosave('status.colorSaveScheduled')
  }

  private updateNode(nodeId: string, updater: (node: MindNode) => void): void {
    const node = this.findNode(nodeId)
    if (!node) {
      return
    }

    updater(node)
    node.updatedAt = new Date().toISOString()
  }

  private startEditingSelected(options: EditorLaunchOptions = {}): void {
    const selectedNode = this.selectedNode()
    if (!selectedNode) {
      return
    }

    this.setSelection([selectedNode.id], selectedNode.id)
    this.openNodeEditor(selectedNode.id, options)
  }

  private openNodeEditor(nodeId: string, options: EditorLaunchOptions = {}): void {
    this.editingOriginalTitle = this.findNode(nodeId)?.title ?? null
    this.state.editingNodeId = nodeId
    this.activeEditorAnchorLeft = this.resolveNodeEditorAnchorLeft(nodeId)
    this.activeEditorPreview = this.resolveNodeEditorPreviewState(nodeId)
    this.pendingEditorOptions = options
    this.render()
  }

  private resolveNodeEditorAnchorLeft(nodeId: string): number | null {
    const node = this.findNode(nodeId)
    if (!node || node.width) {
      return null
    }

    const element = this.rootEl.querySelector<HTMLElement>(
      `[data-node-id="${nodeId}"] .node-shell, [data-node-id="${nodeId}"] .node-editor`,
    )
    if (!element) {
      return node.position.x - estimateNodeWidth(node, childrenOf(this.state.document, node.id).length) / 2
    }

    const measuredWidth = element.getBoundingClientRect().width / this.viewport.scale
    return node.position.x - measuredWidth / 2
  }

  private resolveNodeEditorPreviewState(nodeId: string): ActiveEditorPreviewState | null {
    const node = this.findNode(nodeId)
    const anchorLeft = this.activeEditorAnchorLeft
    if (!node || node.width || anchorLeft === null) {
      return null
    }

    const element = this.rootEl.querySelector<HTMLElement>(
      `[data-node-id="${nodeId}"] .node-shell, [data-node-id="${nodeId}"] .node-editor`,
    )
    if (!element) {
      return null
    }

    const rect = element.getBoundingClientRect()
    return {
      nodeId,
      anchorLeft,
      width: Math.max(rect.width / this.viewport.scale, MIN_NODE_WIDTH),
      height: Math.max(rect.height / this.viewport.scale, MIN_NODE_HEIGHT),
    }
  }

  private clearNodeEditorState(): void {
    this.state.editingNodeId = null
    this.pendingEditorOptions = null
    this.activeEditorAnchorLeft = null
    this.activeEditorPreview = null
    this.editingOriginalTitle = null
  }

  private cancelNodeEditor(): void {
    const nodeId = this.state.editingNodeId
    if (!nodeId) {
      return
    }
    const node = this.findNode(nodeId)
    if (node && this.editingOriginalTitle !== null) {
      node.title = this.editingOriginalTitle
    }
    this.clearNodeEditorState()
    this.render()
  }

  private commitNodeEditor(
    nodeId: string,
    rawTitle: string,
    options: {
      allowInactive?: boolean
      preserveSelection?: boolean
      renderAfter?: boolean
    } = {},
  ): void {
    if (!options.allowInactive && this.state.editingNodeId !== nodeId) {
      return
    }

    const title = rawTitle.trim() || this.t('node.untitled')
    const existingNode = this.findNode(nodeId)
    const preservedAnchorLeft = this.activeEditorAnchorLeft
    if (!existingNode) {
      this.clearNodeEditorState()
      if (options.renderAfter !== false) {
        this.render()
      }
      return
    }

    this.clearNodeEditorState()
    if (existingNode.title === title) {
      if (options.renderAfter !== false) {
        this.render()
      }
      return
    }

    this.captureHistory()
    this.updateNode(nodeId, (node) => {
      node.title = title
      if (!node.width && preservedAnchorLeft !== null) {
        const nextWidth = estimateNodeWidth({ ...node, title }, childrenOf(this.state.document, node.id).length)
        node.position = {
          ...node.position,
          x: Math.round(preservedAnchorLeft + nextWidth / 2),
        }
      }
    })
    if (!options.preserveSelection) {
      this.applySelectionState([nodeId], nodeId)
    }
    touchDocument(this.state.document)
    this.setStatus('status.nodeTitleUpdated')
    if (options.renderAfter !== false) {
      this.render()
    }
    this.scheduleAutosave('status.titleSaveScheduled')
  }

  private commitNodeNote(nodeId: string, rawNote: string): void {
    const existingNode = this.findNode(nodeId)
    if (!existingNode) {
      return
    }

    const nextNote = normalizeNodeNote(rawNote)
    const currentNote = normalizeNodeNote(existingNode.note)
    if (currentNote === nextNote) {
      return
    }

    this.captureHistory()
    this.updateNode(nodeId, (node) => {
      node.note = nextNote
    })
    touchDocument(this.state.document)
    this.setStatus('status.noteUpdated')
    this.render()
    this.scheduleAutosave('status.noteSaveScheduled')
  }

  private commitRelationLabel(relationId: string, rawLabel: string): void {
    const relation = this.state.document.relations.find((item) => item.id === relationId)
    const nextLabel = rawLabel.trim()
    if (!relation || (relation.label ?? '') === nextLabel) {
      return
    }

    this.captureHistory()
    updateRelationLabel(this.state.document, relationId, rawLabel)
    touchDocument(this.state.document)
    this.setStatus('status.relationLabelUpdated')
    this.render()
    this.scheduleAutosave('status.labelSaveScheduled')
  }

  private toggleSelectedCollapse(): void {
    const selectedNode = this.selectedNode()
    if (!selectedNode) {
      return
    }

    this.toggleNodeCollapse(selectedNode.id)
  }

  private autoLayout(): void {
    const snapshot = this.createHistorySnapshot()
    const movedNodes = autoLayoutHierarchy(
      this.state.document,
      this.state.preferences.appearance.layoutMode,
      this.state.preferences.appearance.childGapX,
    )
    if (movedNodes === 0) {
      this.setStatus('status.layoutUpdated', { count: 0 })
      this.render()
      return
    }

    this.pushHistorySnapshot(snapshot)
    touchDocument(this.state.document)
    this.setStatus('status.layoutUpdated', { count: movedNodes })
    this.render()
    this.scheduleAutosave('status.layoutSaveScheduled')
  }

  private relayoutHierarchyAfterInsert(insertedNode: MindNode): void {
    if (!insertedNode.parentId) {
      return
    }

    autoLayoutHierarchy(
      this.state.document,
      this.state.preferences.appearance.layoutMode,
      this.state.preferences.appearance.childGapX,
    )
  }

  private toggleNodeCollapse(nodeId: string): void {
    const node = this.findNode(nodeId)
    if (!node) {
      return
    }

    if (childrenOf(this.state.document, nodeId).length === 0) {
      this.setStatus('status.noBranchToCollapse')
      this.render()
      return
    }

    const snapshot = this.createHistorySnapshot()
    this.setSelection([nodeId], nodeId)
    const changed = toggleCollapse(this.state.document, nodeId)
    if (!changed) {
      this.setStatus('status.noBranchToCollapse')
      this.render()
      return
    }

    if (this.state.preferences.interaction.autoLayoutOnCollapse) {
      autoLayoutHierarchy(
        this.state.document,
        this.state.preferences.appearance.layoutMode,
        this.state.preferences.appearance.childGapX,
      )
    }

    this.pushHistorySnapshot(snapshot)
    touchDocument(this.state.document)
    const toggledNode = this.findNode(nodeId)
    this.setStatus(toggledNode?.collapsed ? 'status.branchCollapsed' : 'status.branchExpanded')
    this.render()
    this.scheduleAutosave('status.layoutSaveScheduled')
  }

  private async runCommand(rawCommand: string): Promise<void> {
    const [command, argument = ''] = rawCommand.split(':')

    try {
      switch (command) {
        case 'create-map':
          await this.createMap()
          return
        case 'open-map':
          if (argument) {
            await this.openMap(argument)
          }
          return
        case 'go-home':
          await this.goHome()
          return
        case 'rename-map':
          await this.renameMap(argument || this.state.currentMapId || this.state.document.id)
          return
        case 'delete-map':
          await this.deleteMap(argument || this.state.currentMapId || this.state.document.id)
          return
        case 'toggle-top-panel':
          this.toggleTopPanel()
          return
        case 'toggle-inspector':
          this.toggleInspector()
          return
        case 'toggle-settings':
          this.toggleSettings()
          return
        case 'open-ai-workspace':
          this.openAIWorkspace()
          return
        case 'close-ai-workspace':
          this.closeAIWorkspace()
          return
        case 'toggle-ai-debug':
          this.toggleAIDebug()
          return
        case 'toggle-ai-raw-mode':
          this.toggleAIRawMode()
          return
        case 'open-graph-overlay':
          this.openGraphOverlay()
          return
        case 'close-graph-overlay':
          this.closeGraphOverlay()
          return
        case 'toggle-graph-autorotate':
          this.toggleGraphAutoRotate()
          return
        case 'reset-graph-view':
          this.resetGraphView()
          return
        case 'graph-zoom-in':
          this.nudgeGraphZoom(1)
          return
        case 'graph-zoom-out':
          this.nudgeGraphZoom(-1)
          return
        case 'close-settings':
          this.closeSettings()
          return
        case 'complete-onboarding':
          this.completeOnboarding()
          return
        case 'theme-toggle':
          this.toggleTheme()
          return
        case 'undo':
          this.undo()
          return
        case 'redo':
          this.redo()
          return
        case 'save':
          await this.saveDocument('status.saved')
          return
        case 'save-snapshot':
          this.saveSnapshot('manual')
          return
        case 'restore-snapshot':
          if (argument) {
            this.restoreSnapshot(argument)
          }
          return
        case 'auto-layout':
          this.autoLayout()
          return
        case 'export-markdown':
          await this.exportMarkdown()
          return
        case 'import-file':
          this.pendingImportMode = 'auto'
          this.refs?.importInput.click()
          return
        case 'new-floating':
          this.createFloatingNode(this.selectedNode()?.id ?? 'root')
          return
        case 'connect-selected':
          this.startRelationMode()
          return
        case 'ai-connect-relations':
          await this.applyAIRelations()
          return
        case 'ai-complete-node-notes':
          await this.applyAINodeNotes()
          return
        case 'ai-complete-node-notes-as-children':
          await this.applyAINodeNotes('children')
          return
        case 'ai-generate-map':
          await this.generateAIMap()
          return
        case 'ai-expand-map':
          await this.expandAIMap()
          return
        case 'ai-import-file':
          this.pendingImportMode = 'ai'
          this.refs?.importInput.click()
          return
        case 'ai-suggest-children':
          await this.applyAISuggestNodes(this.selectedNode()?.id ?? '', 'children')
          return
        case 'ai-suggest-siblings':
          await this.applyAISuggestNodes(this.selectedNode()?.id ?? '', 'siblings')
          return
        case 'ai-wheel-children': {
          const targetNodeId = this.state.aiWheel.nodeId ?? this.selectedNode()?.id ?? ''
          this.closeAIWheel()
          await this.applyAISuggestNodes(targetNodeId, 'children')
          return
        }
        case 'ai-wheel-notes': {
          const targetNodeId = this.state.aiWheel.nodeId ?? this.selectedNode()?.id ?? ''
          this.closeAIWheel()
          await this.applyAINodeNotesForTargets([targetNodeId], 'replace')
          return
        }
        case 'ai-wheel-relations': {
          const targetNodeId = this.state.aiWheel.nodeId ?? this.selectedNode()?.id ?? ''
          this.closeAIWheel()
          await this.applyAIRelationsForFocus([targetNodeId])
          return
        }
        case 'ai-wheel-siblings': {
          const targetNodeId = this.state.aiWheel.nodeId ?? this.selectedNode()?.id ?? ''
          this.closeAIWheel()
          await this.applyAISuggestNodes(targetNodeId, 'siblings')
          return
        }
        case 'close-ai-wheel':
          this.closeAIWheel()
          this.renderOverlay()
          return
        case 'create-template-map':
          await this.createTemplateMap(normalizeAITemplateId(argument))
          return
        case 'toggle-fixed-menu':
          this.toggleFixedMenu((argument as FixedMenuId) || '')
          return
        case 'focus-graph-selected':
          if (this.state.graph.selectedNodeId) {
            this.focusNodeFromGraph(this.state.graph.selectedNodeId)
          }
          return
        case 'test-ai-connection':
          await this.testAIConnection()
          return
        case 'new-child':
          this.createChildNode(this.selectedNode()?.id ?? 'root')
          return
        case 'new-sibling':
          this.createSiblingNode(this.selectedNode()?.id ?? 'root')
          return
        case 'rename-selected':
          this.startEditingSelected()
          return
        case 'set-priority':
          this.setPriority((argument.toUpperCase() as Priority) || '')
          return
        case 'toggle-collapse':
          this.toggleSelectedCollapse()
          return
        case 'toggle-node-collapse':
          if (argument) {
            this.toggleNodeCollapse(argument)
          }
          return
        case 'delete-selected':
          this.deleteSelectedNode()
          return
        case 'focus-node':
          if (argument) {
            this.selectNode(argument)
          }
          return
        case 'delete-relation':
          if (argument) {
            this.removeRelation(argument)
          }
          return
        case 'create-region':
          this.startRegionDraw()
          return
        case 'delete-region':
          if (argument) {
            this.deleteRegion(argument)
          }
          return
        case 'set-region-color': {
          const [color, regionId] = argument.split(':')
          if (regionId) {
            this.setRegionColor(regionId, normalizeNodeColor(color))
          }
          return
        }
        case 'set-arrow': {
          const parts = argument.split(':')
          const direction = parts[0] as ArrowDirection
          const relationId = parts.slice(1).join(':')
          if (relationId) {
            this.setRelationArrowDirection(relationId, direction)
          }
          return
        }
        case 'branch-connection': {
          if (argument) {
            this.branchConnectionAtMidpoint(argument)
          }
          return
        }
        default:
          break
      }
    } catch (error) {
      this.setStatus('status.mapListFailed', { reason: getErrorMessage(error) })
      this.render()
    }
  }

  private removeRelation(relationId: string): void {
    const snapshot = this.createHistorySnapshot()
    const removed = deleteRelation(this.state.document, relationId)
    if (!removed) {
      return
    }

    if (this.state.selectedRelationId === relationId) {
      this.state.selectedRelationId = null
    }
    this.pushHistorySnapshot(snapshot)
    touchDocument(this.state.document)
    this.setStatus('status.relationRemoved')
    this.render()
    this.scheduleAutosave('status.relationRemovalSaveScheduled')
  }

  // ---- Region Box methods ----

  private startRegionDraw(): void {
    this.state.contextMenu = null
    this.state.regionDraw = {
      pointerId: -1,
      startCanvasX: 0,
      startCanvasY: 0,
      currentCanvasX: 0,
      currentCanvasY: 0,
      color: 'blue',
    }
    this.setStatus('status.regionCreated')
    this.render()
  }

  private finishRegionDraw(x: number, y: number, w: number, h: number): void {
    if (w < 30 || h < 30) {
      this.state.regionDraw = null
      this.render()
      return
    }
    if (!this.state.document.regions) {
      this.state.document.regions = []
    }
    const now = new Date().toISOString()
    const region: RegionBox = {
      id: createId('region'),
      label: '',
      color: this.state.regionDraw?.color ?? 'blue',
      position: { x: x + w / 2, y: y + h / 2 },
      width: w,
      height: h,
      createdAt: now,
      updatedAt: now,
    }
    this.captureHistory()
    this.state.document.regions.push(region)
    this.state.regionDraw = null
    touchDocument(this.state.document)
    this.setStatus('status.regionCreated')
    this.render()
    this.scheduleAutosave('status.relationSaveScheduled')
  }

  private deleteRegion(regionId: string): void {
    if (!this.state.document.regions) return
    this.captureHistory()
    this.state.document.regions = this.state.document.regions.filter((r) => r.id !== regionId)
    touchDocument(this.state.document)
    this.setStatus('status.regionDeleted')
    this.render()
    this.scheduleAutosave('status.deletionSaveScheduled')
  }

  private setRegionColor(regionId: string, color: NodeColor): void {
    if (!this.state.document.regions) return
    const region = this.state.document.regions.find((r) => r.id === regionId)
    if (!region) return
    this.captureHistory()
    region.color = color || 'blue'
    region.updatedAt = new Date().toISOString()
    touchDocument(this.state.document)
    this.render()
    this.scheduleAutosave('status.colorSaveScheduled')
  }

  private nodeOverlapsRegion(node: MindNode, region: RegionBox): boolean {
    const childCount = childrenOf(this.state.document, node.id).length
    const metrics = this.resolveNodeRenderMetrics(node, childCount)
    const nodeLeft = metrics.position.x - metrics.width / 2
    const nodeRight = metrics.position.x + metrics.width / 2
    const nodeTop = metrics.position.y - metrics.height / 2
    const nodeBottom = metrics.position.y + metrics.height / 2
    const regionLeft = region.position.x - region.width / 2
    const regionRight = region.position.x + region.width / 2
    const regionTop = region.position.y - region.height / 2
    const regionBottom = region.position.y + region.height / 2

    return rectanglesOverlapCoords(
      nodeLeft,
      nodeTop,
      nodeRight,
      nodeBottom,
      regionLeft,
      regionTop,
      regionRight,
      regionBottom,
    )
  }

  private nodesInRegion(region: RegionBox): MindNode[] {
    return this.state.document.nodes.filter((node) => this.nodeOverlapsRegion(node, region))
  }

  private applyLiveRegionDrag(_region: RegionBox, _movedNodeIds: string[]): void {
    this.renderWorkspace()
  }

  private renderRegions(): string {
    if (!this.state.document.regions || this.state.document.regions.length === 0) {
      return ''
    }
    const originX = this.workspaceBounds.originX
    const originY = this.workspaceBounds.originY
    return this.state.document.regions
      .map((region) => {
        const palette = resolveNodeColorPalette(region.color)
        const accent = palette?.accent ?? '#60a5fa'
        const bgColor = palette ? `rgba(${palette.surfaceRgb.join(',')}, 0.12)` : 'rgba(96,165,250,0.08)'
        const borderColor = palette ? `rgba(${palette.accentRgb.join(',')}, 0.4)` : 'rgba(96,165,250,0.3)'
        const selectedClass = this.state.selectedRegionId === region.id ? ' is-selected' : ''
        const w = region.width
        const h = region.height
        const left = region.position.x - w / 2 + originX
        const top = region.position.y - h / 2 + originY
        return `<div class="region-box${selectedClass}" data-region-id="${region.id}" data-region-drag="${region.id}" style="
        left: ${left}px; top: ${top}px; width: ${w}px; height: ${h}px;
        background: ${bgColor}; border: 2px dashed ${borderColor};
        --region-accent: ${accent};
      ">
        <span class="region-label">${escapeHtml(region.label)}</span>
      </div>`
      })
      .join('')
  }

  // ---- Relation arrow direction ----

  private setRelationArrowDirection(relationId: string, direction: ArrowDirection): void {
    const relation = this.state.document.relations.find((r) => r.id === relationId)
    if (!relation) return
    this.captureHistory()
    relation.arrowDirection = direction
    relation.updatedAt = new Date().toISOString()
    touchDocument(this.state.document)
    this.setStatus('status.arrowDirectionChanged')
    this.render()
    this.scheduleAutosave('status.relationSaveScheduled')
  }

  // ---- Connection branching ----

  private branchConnectionAtMidpoint(relationId: string): void {
    const relation = this.state.document.relations.find((r) => r.id === relationId)
    if (!relation) return
    this.state.selectedRelationId = relationId
    this.setStatus('status.connectionBranchMode')
    this.renderWorkspace()
  }

  private clearMidpointDragLongPress(dragState: MidpointDragState | null): void {
    if (!dragState || dragState.longPressHandle === null) {
      return
    }
    window.clearTimeout(dragState.longPressHandle)
    dragState.longPressHandle = null
  }

  private relationIncludesTarget(relation: RelationEdge, targetNodeId: string): boolean {
    if (relation.sourceId === targetNodeId || relation.targetId === targetNodeId) {
      return true
    }
    return (relation.branches ?? []).some((branch) => branch.targetId === targetNodeId)
  }

  private moveRelationMidpoint(relation: RelationEdge, midpoint: Position): void {
    this.captureHistory()
    relation.midpointOffset = midpoint
    relation.updatedAt = new Date().toISOString()
    touchDocument(this.state.document)
    this.renderWorkspace()
    this.scheduleAutosave('status.relationSaveScheduled')
  }

  private addBranchTargetToRelation(relation: RelationEdge, targetNodeId: string): void {
    if (this.relationIncludesTarget(relation, targetNodeId)) {
      this.setStatus('status.relationAlreadyExists')
      this.renderWorkspace()
      return
    }

    if (!this.findNode(targetNodeId)) {
      this.renderWorkspace()
      return
    }

    this.captureHistory()
    if (!relation.branches) {
      relation.branches = []
    }
    relation.branches.push({
      targetId: targetNodeId,
    })
    relation.updatedAt = new Date().toISOString()
    touchDocument(this.state.document)
    this.setStatus('status.connectionBranched')
    this.renderWorkspace()
    this.scheduleAutosave('status.relationSaveScheduled')
  }

  private resolveRelationMidpointPosition(relationId: string): Position | null {
    const relation = this.state.document.relations.find((edge) => edge.id === relationId)
    if (!relation) {
      return null
    }

    const source = this.findNode(relation.sourceId)
    const target = this.findNode(relation.targetId)
    if (!source || !target) {
      return null
    }

    const edgeStyle =
      this.state.preferences.appearance.edgeStyle === 'hidden' ? 'curve' : this.state.preferences.appearance.edgeStyle
    const sourceMetrics = this.resolveNodeRenderMetrics(source, childrenOf(this.state.document, source.id).length)
    const targetMetrics = this.resolveNodeRenderMetrics(target, childrenOf(this.state.document, target.id).length)
    return this.resolveRelationMidpointForEdge(relation, sourceMetrics, targetMetrics, edgeStyle)
  }

  private resolveRelationMidpointForEdge(
    relation: RelationEdge,
    sourceMetrics: NodeRenderMetrics,
    targetMetrics: NodeRenderMetrics,
    edgeStyle: EdgeStyle,
  ): Position {
    const dragState = this.state.midpointDrag?.relationId === relation.id ? this.state.midpointDrag : null
    if (dragState?.mode === 'move') {
      return this.clientToCanvasPosition(dragState.currentClientX, dragState.currentClientY)
    }
    if (relation.midpointOffset) {
      return relation.midpointOffset
    }
    const endpoints = resolveRelationEdgeEndpoints(sourceMetrics, targetMetrics)
    return getRelationDefaultMidpoint(endpoints.source, endpoints.target, edgeStyle)
  }

  // ---- Helper: client coordinates to canvas coordinates ----

  private clientToCanvas(clientX: number, clientY: number): Position | null {
    if (!this.refs) return null
    const scrollRect = this.refs.scroll.getBoundingClientRect()
    const scrollLeft = this.refs.scroll.scrollLeft
    const scrollTop = this.refs.scroll.scrollTop
    const canvasX = (clientX - scrollRect.left + scrollLeft - this.viewport.x) / this.viewport.scale
    const canvasY = (clientY - scrollRect.top + scrollTop - this.viewport.y) / this.viewport.scale
    return { x: canvasX, y: canvasY }
  }

  private toggleTheme(): void {
    this.setTheme(this.state.document.theme === 'dark' ? 'light' : 'dark')
  }

  private setTheme(theme: Theme): void {
    if (this.state.document.theme === theme) {
      return
    }

    this.captureHistory()
    this.state.document.theme = theme
    touchDocument(this.state.document)
    this.applyTheme()
    this.setStatus('status.themeSwitched', { theme: themeLabel(this.state.preferences.locale, theme) })
    this.render()
    this.scheduleAutosave('status.themeSaveScheduled')
  }

  private startRelationMode(): void {
    const selectedNode = this.selectedNode()
    if (!selectedNode) {
      return
    }

    if (this.state.connectSourceNodeId === selectedNode.id) {
      this.state.connectSourceNodeId = null
      this.setStatus('status.relationModeCancelled')
      this.render()
      return
    }

    this.state.connectSourceNodeId = selectedNode.id
    this.setStatus('status.relationModeStarted', { title: selectedNode.title })
    this.render()
  }

  private async saveDocument(statusKey: TranslationKey, values?: Record<string, string | number>): Promise<void> {
    const editorDraft = this.captureActiveNodeEditorDraft()
    try {
      const savedDocument = await api.saveMap(this.state.document)
      this.state.document = savedDocument
      this.state.currentMapId = savedDocument.id
      await this.refreshMaps()
      this.maybeSaveAutoSnapshot(savedDocument)
      this.setStatus(statusKey, values)
      this.restoreActiveNodeEditorDraft(editorDraft)
    } catch (error) {
      this.setStatus('status.saveFailed', { reason: getErrorMessage(error) })
      this.restoreActiveNodeEditorDraft(editorDraft)
    }

    this.applyTheme()
    this.render()
  }

  private saveSnapshot(mode: 'manual' | 'auto'): void {
    const mapId = this.state.currentMapId
    if (!mapId) {
      return
    }

    saveLocalSnapshot({
      mapId,
      title: this.resolveSnapshotTitle(mode),
      mapTitle: this.state.document.title,
      mode,
      document: this.state.document,
    })

    if (mode === 'manual') {
      this.state.snapshotDraftName = ''
      this.setStatus('status.snapshotSaved')
      this.render()
    }
  }

  private maybeSaveAutoSnapshot(document: MindMapDocument): void {
    if (!this.state.preferences.interaction.autoSnapshots) {
      return
    }

    const mapId = document.id || this.state.currentMapId
    if (!mapId) {
      return
    }

    const latestAutoSnapshot = listLocalSnapshots(mapId).find((snapshot) => snapshot.mode === 'auto')
    if (latestAutoSnapshot && Date.now() - Date.parse(latestAutoSnapshot.createdAt) < AUTO_SNAPSHOT_MIN_INTERVAL_MS) {
      return
    }

    saveLocalSnapshot({
      mapId,
      title: this.resolveSnapshotTitle('auto', document.title),
      mapTitle: document.title,
      mode: 'auto',
      document,
    })
  }

  private resolveSnapshotTitle(mode: 'manual' | 'auto', documentTitle = this.state.document.title): string {
    const draft = mode === 'manual' ? this.state.snapshotDraftName.trim() : ''
    if (draft) {
      return draft
    }

    const normalizedTitle = documentTitle.trim() || this.t('node.untitled')
    return mode === 'manual'
      ? this.t('snapshot.defaultManualName', { title: normalizedTitle })
      : this.t('snapshot.defaultAutoName', { title: normalizedTitle })
  }

  private restoreSnapshot(snapshotId: string): void {
    const mapId = this.state.currentMapId
    if (!mapId) {
      return
    }

    const restoredDocument = loadLocalSnapshot(mapId, snapshotId)
    if (!restoredDocument) {
      this.setStatus('status.snapshotRestoreFailed')
      this.render()
      return
    }

    this.captureHistory()
    restoredDocument.id = mapId
    this.state.document = restoredDocument
    this.state.snapshotDraftName = ''
    this.setSelection([findRoot(restoredDocument).id], findRoot(restoredDocument).id)
    this.state.connectSourceNodeId = null
    touchDocument(this.state.document)
    this.applyTheme()
    this.setStatus('status.snapshotRestored')
    this.render()
    this.scheduleAutosave('status.saved')
  }

  private async exportMarkdown(): Promise<void> {
    try {
      const markdown = await api.exportMarkdown(this.state.document)
      downloadTextFile(`${slugify(this.state.document.title || 'code-mind')}.md`, markdown)
      this.setStatus('status.exported')
    } catch (error) {
      this.setStatus('status.exportFailed', { reason: getErrorMessage(error) })
    }

    this.render()
  }

  private async importFile(file: File, mode: PendingImportMode = 'auto'): Promise<void> {
    const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
    const isRuleFormat = ['md', 'markdown', 'txt'].includes(extension)

    if (mode === 'ai' || (!isRuleFormat && mode === 'auto')) {
      await this.importFileWithAI(file)
      return
    }

    const format = extension === 'md' || extension === 'markdown' ? 'markdown' : 'text'

    try {
      const content = await file.text()
      const importedDocument = await api.importDocument(content, format)
      if (this.state.currentMapId) {
        importedDocument.id = this.state.currentMapId
      }
      this.captureHistory()
      this.state.document = importedDocument
      this.setSelection([findRoot(importedDocument).id], findRoot(importedDocument).id)
      this.state.connectSourceNodeId = null
      this.viewport.scale = 1
      this.didInitializeViewport = false
      this.setStatus('status.imported', { filename: file.name })
      this.applyTheme()
      this.render()
      await this.saveDocument('status.importedSaved')
    } catch (error) {
      this.setStatus('status.importFailed', { reason: getErrorMessage(error) })
      this.render()
    }
  }

  private async importFileWithAI(file: File): Promise<void> {
    if (this.state.ai.busy) {
      return
    }

    this.state.ai.busy = true
    this.setStatus('status.aiRunning')
    this.render()

    try {
      const content = await file.text()
      const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
      const result = await api.importDocumentWithAI({
        fileName: file.name,
        format: extension,
        content,
        instructions: this.state.ai.importInstructions,
        settings: this.state.preferences.ai,
        debug: this.buildAIDebugRequest(this.state.ai.importRawRequest),
      })

      this.state.ai.lastSummary = result.summary
      this.state.ai.lastModel = result.model
      this.captureAIDebug('import', result.debug)
      await this.persistGeneratedDocument(result.document)
      this.state.ai.open = false
      this.setStatus('status.aiImported', { filename: file.name, count: result.document.nodes.length })
    } catch (error) {
      const reason = getErrorMessage(error)
      this.captureAIDebug('import', getAIDebugInfo(error), reason)
      this.setStatus('status.aiFailed', { reason })
    } finally {
      this.state.ai.busy = false
      this.render()
    }
  }

  private async refreshMaps(statusKey?: TranslationKey): Promise<void> {
    const maps = await api.listMaps()
    this.state.maps = maps
    if (statusKey) {
      this.setStatus(statusKey)
    }
  }

  private async createMap(): Promise<void> {
    const title = window.prompt(this.t('dialog.newMapTitle'), this.t('node.untitled')) ?? ''
    const doc = await api.createMap(title)
    await this.refreshMaps()
    this.openLoadedDocument(doc, 'status.mapCreated')
    this.render()
  }

  private async openMap(mapId: string): Promise<void> {
    const doc = await api.loadMap(mapId)
    this.openLoadedDocument(doc, 'status.loaded')
    this.render()
  }

  private async goHome(): Promise<void> {
    await this.refreshMaps('status.mapListLoaded')
    this.state.view = 'home'
    this.state.currentMapId = null
    this.state.snapshotDraftName = ''
    this.state.ai.open = false
    this.state.graph.open = false
    this.stopGraphAnimation()
    this.refs = null
    this.resetHistory()
    this.render()
  }

  private async renameMap(mapId: string): Promise<void> {
    const currentTitle =
      this.state.currentMapId === mapId ? this.state.document.title : (this.findMapSummary(mapId)?.title ?? '')
    const nextTitle = window.prompt(this.t('dialog.renameMap'), currentTitle)
    if (nextTitle === null) {
      return
    }

    const doc = await api.renameMap(mapId, nextTitle)
    await this.refreshMaps()
    if (this.state.currentMapId === mapId) {
      this.state.document = doc
      this.resetHistory()
    }
    this.setStatus('status.mapRenamed')
    this.render()
  }

  private async deleteMap(mapId: string): Promise<void> {
    if (!window.confirm(this.t('dialog.deleteMap'))) {
      return
    }

    await api.deleteMap(mapId)
    await this.refreshMaps()

    if (this.state.currentMapId === mapId || this.state.view === 'home') {
      this.state.view = 'home'
      this.state.currentMapId = null
      this.refs = null
      this.resetHistory()
    }

    this.setStatus('status.mapDeleted')
    this.render()
  }

  private openAIWorkspace(): void {
    this.state.ai.open = true
    this.state.graph.open = false
    this.stopGraphAnimation()
    this.setStatus('status.aiPanelOpened')
    this.render()
  }

  private closeAIWorkspace(): void {
    if (!this.state.ai.open) {
      return
    }

    this.state.ai.open = false
    this.setStatus('status.aiPanelClosed')
    this.render()
  }

  private toggleAIDebug(): void {
    this.state.ai.debugOpen = !this.state.ai.debugOpen
    this.render()
  }

  private toggleAIRawMode(): void {
    this.state.ai.rawMode = !this.state.ai.rawMode
    if (this.state.ai.rawMode) {
      this.state.ai.debugOpen = true
    }
    this.render()
  }

  private openGraphOverlay(): void {
    this.state.graph.open = true
    this.state.graph.selectedNodeId = this.state.graph.selectedNodeId ?? this.state.selectedNodeId
    this.state.ai.open = false
    this.setStatus('status.graphOpened')
    this.render()
  }

  private closeGraphOverlay(): void {
    if (!this.state.graph.open) {
      return
    }

    this.state.graph.open = false
    this.stopGraphAnimation()
    this.setStatus('status.graphClosed')
    this.render()
  }

  private toggleGraphAutoRotate(): void {
    this.state.graph.autoRotate = !this.state.graph.autoRotate
    this.syncGraphAnimation()
    this.setStatus(this.state.graph.autoRotate ? 'status.graphAutoRotateOn' : 'status.graphAutoRotateOff')
    this.render()
  }

  private resetGraphView(): void {
    this.state.graph.rotation = 0.72
    this.state.graph.tilt = 0.18
    this.state.graph.zoom = GRAPH_DEFAULT_ZOOM
    this.drawGraphScene()
    this.setStatus('status.graphViewReset')
    this.renderHeader()
  }

  private nudgeGraphZoom(direction: -1 | 1): void {
    const factor = direction > 0 ? 1.14 : 1 / 1.14
    this.setGraphZoom(this.state.graph.zoom * factor)
  }

  private setGraphZoom(nextZoom: number): void {
    const clampedZoom = Math.round(clamp(nextZoom, GRAPH_MIN_ZOOM, GRAPH_MAX_ZOOM) * 100) / 100
    if (Math.abs(clampedZoom - this.state.graph.zoom) < 0.001) {
      return
    }

    this.state.graph.zoom = clampedZoom
    this.drawGraphScene()
  }

  private async testAIConnection(): Promise<void> {
    if (this.state.ai.busy || this.state.ai.testing) {
      return
    }

    this.state.ai.testing = true
    this.state.ai.connectionMessage = ''
    this.state.ai.connectionModel = ''
    this.state.ai.connectionOK = null
    this.setStatus('status.aiTestingConnection')
    this.render()

    try {
      const result = await api.testAIConnection(this.state.preferences.ai)
      this.state.ai.connectionOK = result.ok
      this.state.ai.connectionModel = result.model
      this.state.ai.connectionMessage = result.message
      this.setStatus('status.aiConnectionOK', { model: result.model || this.t('common.unknown') })
    } catch (error) {
      const reason = getErrorMessage(error)
      this.state.ai.connectionOK = false
      this.state.ai.connectionModel = ''
      this.state.ai.connectionMessage = reason
      this.setStatus('status.aiConnectionFailed', { reason })
    } finally {
      this.state.ai.testing = false
      this.render()
    }
  }

  private resolveAINoteTargets(): AINoteTargetState {
    const selectedNodes = this.selectedNodeIds()
      .map((nodeId) => this.findNode(nodeId))
      .filter((node): node is MindNode => Boolean(node))
    const selectedNonRootNodes = selectedNodes.filter((node) => node.kind !== 'root')
    if (selectedNonRootNodes.length > 0) {
      return { mode: 'selection', nodes: selectedNonRootNodes }
    }

    const nonRootNodes = this.state.document.nodes.filter((node) => node.kind !== 'root')
    if (nonRootNodes.length > 0) {
      return { mode: 'all', nodes: nonRootNodes }
    }

    const root = findRoot(this.state.document)
    return root.id ? { mode: 'all', nodes: [root] } : { mode: 'all', nodes: [] }
  }

  private buildAIDebugRequest(rawRequest: string): AIDebugRequest {
    return {
      rawMode: this.state.ai.rawMode,
      rawRequest: this.state.ai.rawMode ? rawRequest : '',
    }
  }

  private captureAIDebug(action: AIDebugAction, debug?: AIDebugInfo, errorMessage = ''): void {
    this.state.ai.lastDebugAction = action
    this.state.ai.lastDebugInfo = debug ?? null
    this.state.ai.lastDebugError = errorMessage

    if (errorMessage && debug) {
      this.state.ai.debugOpen = true
    }
    if (!debug) {
      return
    }

    const request = debug.upstreamRequest.trim()
    if (request) {
      this.storeCapturedRawRequest(action, debug.upstreamRequest)
    }
  }

  private storeCapturedRawRequest(action: AIDebugAction, rawRequest: string): void {
    switch (action) {
      case 'generate':
        this.state.ai.generateRawRequest = rawRequest
        break
      case 'import':
        this.state.ai.importRawRequest = rawRequest
        break
      case 'notes':
        this.state.ai.noteRawRequest = rawRequest
        break
      case 'relations':
        this.state.ai.relationRawRequest = rawRequest
        break
      default:
        break
    }
  }

  private async applyAINodeNotes(mode: 'replace' | 'children' = 'replace'): Promise<void> {
    const targets = this.resolveAINoteTargets()
    if (targets.nodes.length === 0) {
      this.setStatus('status.aiNoNoteTargets')
      this.render()
      return
    }

    await this.applyAINodeNotesForTargets(
      targets.nodes.map((node) => node.id),
      mode,
    )
  }

  private async applyAINodeNotesForTargets(
    targetNodeIds: string[],
    mode: 'replace' | 'children' = 'replace',
  ): Promise<number> {
    if (this.state.ai.busy) {
      return 0
    }

    this.state.ai.busy = true
    this.setStatus('status.aiRunning')
    this.renderHeader()
    this.renderAIWorkspace()

    try {
      const result = await api.completeNodeNotes({
        document: this.state.document,
        settings: this.state.preferences.ai,
        targetNodeIds,
        instructions: this.state.ai.noteInstructions,
        debug: this.buildAIDebugRequest(this.state.ai.noteRawRequest),
      })
      this.state.ai.lastSummary = result.summary
      this.state.ai.lastModel = result.model
      this.captureAIDebug('notes', result.debug)

      const nextNotes = result.notes.filter((item) => Boolean(this.findNode(item.id)) && item.note.trim() !== '')
      if (nextNotes.length === 0) {
        this.setStatus('status.aiNoNotes')
        return 0
      }

      let appliedCount = 0

      if (mode === 'children') {
        const preparedChildren = nextNotes
          .map((item) => {
            const parent = this.findNode(item.id)
            const normalizedNote = normalizeNodeNote(item.note)
            if (!parent || !normalizedNote) {
              return null
            }

            return { parent, normalizedNote }
          })
          .filter((item): item is { parent: MindNode; normalizedNote: string } => Boolean(item))

        if (preparedChildren.length === 0) {
          this.setStatus('status.aiNoNotes')
          return 0
        }

        this.captureHistory()
        const createdIds: string[] = []
        for (const { parent, normalizedNote } of preparedChildren) {
          parent.collapsed = false
          parent.updatedAt = new Date().toISOString()
          const childNode = createNode({
            parentId: parent.id,
            kind: 'topic',
            position: nextChildPosition(
              this.state.document,
              parent.id,
              this.state.preferences.appearance.layoutMode,
              this.state.preferences.appearance.childGapX,
            ),
            title: deriveNoteChildTitle(parent, normalizedNote, this.state.preferences.locale),
            color: normalizeNodeColor(parent.color) || undefined,
          })
          childNode.note = normalizedNote
          this.state.document.nodes.push(childNode)
          createdIds.push(childNode.id)
          appliedCount += 1
        }

        autoLayoutHierarchy(
          this.state.document,
          this.state.preferences.appearance.layoutMode,
          this.state.preferences.appearance.childGapX,
        )
        this.setSelection(createdIds, createdIds[0] ?? null)
      } else {
        const changes = nextNotes.filter(
          (item) => normalizeNodeNote(this.findNode(item.id)?.note) !== normalizeNodeNote(item.note),
        )
        if (changes.length === 0) {
          this.setStatus('status.aiNoNotes')
          return 0
        }

        this.captureHistory()
        for (const item of changes) {
          this.updateNode(item.id, (draft) => {
            draft.note = normalizeNodeNote(item.note)
          })
        }
        appliedCount = changes.length
      }

      touchDocument(this.state.document)
      this.setStatus('status.aiNotesApplied', { count: appliedCount })
      this.render()
      this.scheduleAutosave(mode === 'children' ? 'status.childSaveScheduled' : 'status.noteSaveScheduled')
      return appliedCount
    } catch (error) {
      const reason = getErrorMessage(error)
      this.captureAIDebug('notes', getAIDebugInfo(error), reason)
      this.setStatus('status.aiFailed', { reason })
      return 0
    } finally {
      this.state.ai.busy = false
      this.render()
    }
  }

  private async applyAIRelations(): Promise<void> {
    await this.applyAIRelationsForFocus()
  }

  private async applyAIRelationsForFocus(focusNodeIds?: string[]): Promise<number> {
    if (this.state.ai.busy) {
      return 0
    }

    this.state.ai.busy = true
    this.setStatus('status.aiRunning')
    this.renderHeader()
    this.renderAIWorkspace()

    try {
      const result = await api.suggestRelations(
        this.state.document,
        this.state.preferences.ai,
        this.state.ai.relationInstructions,
        focusNodeIds,
        this.buildAIDebugRequest(this.state.ai.relationRawRequest),
      )
      this.state.ai.lastSummary = result.summary
      this.state.ai.lastModel = result.model
      this.captureAIDebug('relations', result.debug)

      const nextRelations = result.relations.filter((relation) => {
        return Boolean(this.findNode(relation.sourceId) && this.findNode(relation.targetId))
      })
      if (nextRelations.length === 0) {
        this.setStatus('status.aiNoRelations')
        return 0
      }

      this.captureHistory()
      const now = new Date().toISOString()
      const existingPairs = new Set(
        this.state.document.relations.map((relation) =>
          normalizedRelationPairKey(relation.sourceId, relation.targetId),
        ),
      )
      let added = 0
      for (const relation of nextRelations) {
        const key = normalizedRelationPairKey(relation.sourceId, relation.targetId)
        if (existingPairs.has(key)) {
          continue
        }
        existingPairs.add(key)
        this.state.document.relations.push({
          id: createId('rel'),
          sourceId: relation.sourceId,
          targetId: relation.targetId,
          label: relation.label,
          createdAt: now,
          updatedAt: now,
        })
        added += 1
      }

      if (added === 0) {
        this.setStatus('status.aiNoRelations')
        return 0
      }

      touchDocument(this.state.document)
      this.setStatus('status.aiRelationsApplied', { count: added })
      this.render()
      this.scheduleAutosave('status.relationSaveScheduled')
      return added
    } catch (error) {
      const reason = getErrorMessage(error)
      this.captureAIDebug('relations', getAIDebugInfo(error), reason)
      this.setStatus('status.aiFailed', { reason })
      return 0
    } finally {
      this.state.ai.busy = false
      this.render()
    }
  }

  private async generateAIMap(): Promise<void> {
    const topic = this.state.ai.topic.trim()
    if (!topic) {
      this.setStatus('status.aiTopicRequired')
      this.render()
      return
    }
    if (this.state.ai.busy) {
      return
    }

    this.state.ai.busy = true
    this.setStatus('status.aiRunning')
    this.render()

    try {
      const result = await api.generateKnowledgeMap({
        topic,
        template: this.state.ai.template,
        instructions: this.state.ai.generationInstructions,
        settings: this.state.preferences.ai,
        mode: 'new',
        debug: this.buildAIDebugRequest(this.state.ai.generateRawRequest),
      })

      this.state.ai.lastSummary = result.summary
      this.state.ai.lastModel = result.model
      this.captureAIDebug('generate', result.debug)
      await this.persistGeneratedDocument(result.document)
      this.state.ai.open = false
      this.setStatus('status.aiMapGenerated', { count: result.document.nodes.length })
    } catch (error) {
      const reason = getErrorMessage(error)
      this.captureAIDebug('generate', getAIDebugInfo(error), reason)
      this.setStatus('status.aiFailed', { reason })
    } finally {
      this.state.ai.busy = false
      this.render()
    }
  }

  private async expandAIMap(): Promise<void> {
    const previousNodeCount = this.state.document.nodes.length
    const topic =
      this.state.ai.topic.trim() || this.state.document.title.trim() || findRoot(this.state.document).title.trim()
    if (!topic) {
      this.setStatus('status.aiTopicRequired')
      this.render()
      return
    }
    if (this.state.ai.busy) {
      return
    }

    this.state.ai.busy = true
    this.setStatus('status.aiRunning')
    this.render()

    try {
      const result = await api.generateKnowledgeMap({
        topic,
        template: this.state.ai.template,
        instructions: this.state.ai.generationInstructions,
        settings: this.state.preferences.ai,
        mode: 'expand',
        document: this.state.document,
        debug: this.buildAIDebugRequest(this.state.ai.generateRawRequest),
      })

      this.state.ai.lastSummary = result.summary
      this.state.ai.lastModel = result.model
      this.captureAIDebug('generate', result.debug)
      await this.persistExpandedDocument(result.document)
      this.state.ai.open = false
      this.setStatus('status.aiMapExpanded', { count: Math.max(result.document.nodes.length - previousNodeCount, 0) })
    } catch (error) {
      const reason = getErrorMessage(error)
      this.captureAIDebug('generate', getAIDebugInfo(error), reason)
      this.setStatus('status.aiFailed', { reason })
    } finally {
      this.state.ai.busy = false
      this.render()
    }
  }

  private async applyAISuggestNodes(targetNodeId: string, mode: 'children' | 'siblings' = 'children'): Promise<number> {
    const selectedNode = this.findNode(targetNodeId)
    if (!selectedNode) {
      this.setStatus('status.aiNoSelection')
      this.render()
      return 0
    }
    if (mode === 'siblings' && !this.canSuggestSiblings(selectedNode.id)) {
      this.setStatus('status.aiNoSiblingTarget')
      this.render()
      return 0
    }
    if (this.state.ai.busy) {
      return 0
    }

    this.state.ai.busy = true
    this.setStatus('status.aiRunning')
    this.renderHeader()

    try {
      const result = await api.suggestChildren({
        document: this.state.document,
        settings: this.state.preferences.ai,
        targetNodeId: selectedNode.id,
        mode,
        instructions: this.state.ai.noteInstructions,
        debug: this.buildAIDebugRequest(this.state.ai.noteRawRequest),
      })
      this.state.ai.lastSummary = result.summary
      this.state.ai.lastModel = result.model
      this.captureAIDebug('notes', result.debug)

      const suggestions = result.suggestions.filter((item) => item.title.trim() !== '')
      if (suggestions.length === 0) {
        this.setStatus('status.aiNoSuggestions')
        return 0
      }

      this.captureHistory()
      const createdIds: string[] = []
      const parentId = mode === 'siblings' ? (selectedNode.parentId ?? '') : selectedNode.id
      const parentNode = this.findNode(parentId)
      if (parentNode) {
        parentNode.collapsed = false
        parentNode.updatedAt = new Date().toISOString()
      }
      selectedNode.collapsed = false
      selectedNode.updatedAt = new Date().toISOString()
      for (const suggestion of suggestions) {
        const childNode = createNode({
          parentId,
          kind: 'topic',
          position:
            mode === 'siblings'
              ? nextSiblingPosition(
                  this.state.document,
                  selectedNode,
                  this.state.preferences.appearance.layoutMode,
                  this.state.preferences.appearance.childGapX,
                )
              : nextChildPosition(
                  this.state.document,
                  selectedNode.id,
                  this.state.preferences.appearance.layoutMode,
                  this.state.preferences.appearance.childGapX,
                ),
          title: suggestion.title,
          color: normalizeNodeColor((parentNode ?? selectedNode).color) || undefined,
        })
        childNode.note = suggestion.note
        this.state.document.nodes.push(childNode)
        createdIds.push(childNode.id)
      }

      autoLayoutHierarchy(
        this.state.document,
        this.state.preferences.appearance.layoutMode,
        this.state.preferences.appearance.childGapX,
      )
      this.setSelection(createdIds, createdIds[0] ?? null)
      touchDocument(this.state.document)
      this.setStatus('status.aiSuggestionsApplied', { count: createdIds.length })
      this.render()
      this.scheduleAutosave('status.childSaveScheduled')
      return createdIds.length
    } catch (error) {
      const reason = getErrorMessage(error)
      this.captureAIDebug('notes', getAIDebugInfo(error), reason)
      this.setStatus('status.aiFailed', { reason })
      return 0
    } finally {
      this.state.ai.busy = false
      this.render()
    }
  }

  private async applyAIQuickAssist(nodeId: string): Promise<void> {
    const selectedNode = this.findNode(nodeId)
    if (!selectedNode) {
      this.setStatus('status.aiNoSelection')
      this.render()
      return
    }
    if (this.state.ai.busy) {
      return
    }

    const quickConfig = this.state.preferences.interaction
    if (
      !quickConfig.aiQuickChildren &&
      !quickConfig.aiQuickSiblings &&
      !quickConfig.aiQuickNotes &&
      !quickConfig.aiQuickRelations
    ) {
      this.setStatus('status.aiQuickDisabled')
      this.render()
      return
    }

    const applied: Array<{ kind: 'children' | 'siblings' | 'notes' | 'relations'; count: number }> = []
    if (quickConfig.aiQuickChildren) {
      const count = await this.applyAISuggestNodes(nodeId, 'children')
      applied.push({ kind: 'children', count })
      if (this.state.status.key === 'status.aiFailed') {
        return
      }
    }
    if (quickConfig.aiQuickSiblings && this.canSuggestSiblings(nodeId)) {
      const count = await this.applyAISuggestNodes(nodeId, 'siblings')
      applied.push({ kind: 'siblings', count })
      if (this.state.status.key === 'status.aiFailed') {
        return
      }
    }
    if (quickConfig.aiQuickNotes) {
      const count = await this.applyAINodeNotesForTargets([nodeId], 'replace')
      applied.push({ kind: 'notes', count })
      if (this.state.status.key === 'status.aiFailed') {
        return
      }
    }
    if (quickConfig.aiQuickRelations) {
      const count = await this.applyAIRelationsForFocus([nodeId])
      applied.push({ kind: 'relations', count })
      if (this.state.status.key === 'status.aiFailed') {
        return
      }
    }

    const summary = applied.filter((item) => item.count > 0)
    if (summary.length === 0) {
      this.setStatus('status.aiQuickNoChanges')
      this.render()
      return
    }

    this.setStatus('status.aiQuickApplied', {
      summary: summary.map((item) => `${this.aiQuickKindLabel(item.kind)} ${item.count}`).join(' / '),
    })
    this.render()
  }

  private async createTemplateMap(templateId: AITemplateId): Promise<void> {
    const templateDocument = createTemplateDocument(templateId, this.state.preferences.locale)
    await this.persistGeneratedDocument(templateDocument)
    this.state.ai.lastSummary = promptTemplateCopy(templateId, this.state.preferences.locale)
    this.state.ai.open = false
    this.setStatus('status.templateMapCreated', { title: templateDocument.title })
    this.render()
  }

  private async persistGeneratedDocument(document: MindMapDocument): Promise<void> {
    const created = await api.createMap(document.title)
    const nextDocument: MindMapDocument = {
      ...document,
      id: created.id,
      meta: created.meta,
    }
    const saved = await api.saveMap(nextDocument)
    await this.refreshMaps()
    this.openLoadedDocument(saved, 'status.loaded')
  }

  private async persistExpandedDocument(document: MindMapDocument): Promise<void> {
    const baseDocument = this.state.document
    const nextDocument: MindMapDocument = {
      ...document,
      id: baseDocument.id,
      meta: baseDocument.meta,
    }
    const saved = await api.saveMap(nextDocument)
    await this.refreshMaps()
    this.openLoadedDocument(saved, 'status.loaded')
  }

  private openLoadedDocument(document: MindMapDocument, statusKey: TranslationKey): void {
    this.state.document = document
    this.state.currentMapId = document.id
    this.state.snapshotDraftName = ''
    this.state.view = 'map'
    this.state.ai.open = false
    this.state.graph.open = false
    this.stopGraphAnimation()
    this.setSelection([findRoot(document).id], findRoot(document).id)
    this.state.connectSourceNodeId = null
    this.state.resize = null
    this.viewport.scale = 1
    this.didInitializeViewport = false
    this.refs = null
    this.resetHistory()
    this.setStatus(statusKey)
  }

  private focusNodeFromGraph(nodeId: string): void {
    this.state.graph.selectedNodeId = nodeId
    this.state.graph.open = false
    this.stopGraphAnimation()
    this.setSelection([nodeId], nodeId)
    this.render()
    queueMicrotask(() => {
      this.centerViewportOnNode(nodeId)
    })
  }

  private centerViewportOnNode(nodeId: string): void {
    const node = this.findNode(nodeId)
    const scroll = this.refs?.scroll
    if (!node || !scroll) {
      return
    }

    const center = this.toWorkspacePosition(node.position)
    this.viewport.x = scroll.clientWidth / 2 - center.x * this.viewport.scale
    this.viewport.y = scroll.clientHeight / 2 - center.y * this.viewport.scale
    this.updateCanvasViewportView()
  }

  private handleCanvasPan(event: PointerEvent): void {
    if (!this.pan || event.pointerId !== this.pan.pointerId) {
      return
    }

    const deltaX = event.clientX - this.pan.startX
    const deltaY = event.clientY - this.pan.startY
    event.preventDefault()
    this.viewport.x = this.pan.startViewportX + deltaX
    this.viewport.y = this.pan.startViewportY + deltaY
    this.updateCanvasViewportView()
  }

  private startCanvasPan(pointerId: number, clientX: number, clientY: number): void {
    this.pan = {
      pointerId,
      startX: clientX,
      startY: clientY,
      startViewportX: this.viewport.x,
      startViewportY: this.viewport.y,
    }
    this.setCanvasPanning(true)
  }

  private commitSettingField(field: string, value: string): void {
    switch (field) {
      case 'locale':
        this.setLocale(value === 'zh-CN' ? 'zh-CN' : 'en', true)
        return
      case 'theme':
        this.setTheme(value === 'light' ? 'light' : 'dark')
        return
      case 'appearance.edgeStyle':
        this.updatePreferences((preferences) => {
          preferences.appearance.edgeStyle = normalizeEdgeStyle(value)
        })
        this.setStatus('status.appearanceUpdated')
        this.render()
        return
      case 'appearance.layoutMode': {
        const nextLayoutMode = normalizeLayoutMode(value)
        const layoutModeChanged = this.state.preferences.appearance.layoutMode !== nextLayoutMode
        this.updatePreferences((preferences) => {
          preferences.appearance.layoutMode = nextLayoutMode
        })
        if (layoutModeChanged && this.state.view === 'map') {
          const movedNodes = autoLayoutHierarchy(
            this.state.document,
            this.state.preferences.appearance.layoutMode,
            this.state.preferences.appearance.childGapX,
          )
          touchDocument(this.state.document)
          this.setStatus('status.layoutUpdated', { count: movedNodes })
          this.render()
          this.scheduleAutosave('status.layoutSaveScheduled')
          return
        }
        this.setStatus('status.appearanceUpdated')
        this.render()
        return
      }
      case 'appearance.childGapX': {
        const nextChildGapX = normalizeChildGapX(value)
        const childGapChanged = this.state.preferences.appearance.childGapX !== nextChildGapX
        this.updatePreferences((preferences) => {
          preferences.appearance.childGapX = nextChildGapX
        })
        if (childGapChanged && this.state.view === 'map') {
          const movedNodes = autoLayoutHierarchy(
            this.state.document,
            this.state.preferences.appearance.layoutMode,
            this.state.preferences.appearance.childGapX,
          )
          touchDocument(this.state.document)
          this.setStatus('status.layoutUpdated', { count: movedNodes })
          this.render()
          this.scheduleAutosave('status.layoutSaveScheduled')
          return
        }
        this.setStatus('status.appearanceUpdated')
        this.render()
        return
      }
      case 'appearance.chromeLayout':
        this.updatePreferences((preferences) => {
          preferences.appearance.chromeLayout = normalizeChromeLayout(value)
        })
        if (value !== 'fixed') {
          this.state.fixedMenu = ''
        }
        this.setStatus('status.appearanceUpdated')
        this.render()
        return
      case 'appearance.topPanelPosition':
        this.updatePreferences((preferences) => {
          preferences.appearance.topPanelPosition = normalizeTopPanelPosition(value)
        })
        this.setStatus('status.appearanceUpdated')
        this.render()
        return
      case 'interaction.dragSubtreeWithParent':
        this.updatePreferences((preferences) => {
          preferences.interaction.dragSubtreeWithParent = value === 'true'
        })
        this.setStatus('status.interactionUpdated')
        this.render()
        return
      case 'interaction.dragSnap':
        this.updatePreferences((preferences) => {
          preferences.interaction.dragSnap = value === 'true'
        })
        this.setStatus('status.interactionUpdated')
        this.render()
        return
      case 'interaction.autoLayoutOnCollapse':
        this.updatePreferences((preferences) => {
          preferences.interaction.autoLayoutOnCollapse = value === 'true'
        })
        this.setStatus('status.interactionUpdated')
        this.render()
        return
      case 'interaction.autoSnapshots':
        this.updatePreferences((preferences) => {
          preferences.interaction.autoSnapshots = value === 'true'
        })
        this.setStatus('status.interactionUpdated')
        this.render()
        return
      case 'interaction.aiQuickChildren':
        this.updatePreferences((preferences) => {
          preferences.interaction.aiQuickChildren = value === 'true'
        })
        this.setStatus('status.interactionUpdated')
        this.render()
        return
      case 'interaction.aiQuickSiblings':
        this.updatePreferences((preferences) => {
          preferences.interaction.aiQuickSiblings = value === 'true'
        })
        this.setStatus('status.interactionUpdated')
        this.render()
        return
      case 'interaction.aiQuickNotes':
        this.updatePreferences((preferences) => {
          preferences.interaction.aiQuickNotes = value === 'true'
        })
        this.setStatus('status.interactionUpdated')
        this.render()
        return
      case 'interaction.aiQuickRelations':
        this.updatePreferences((preferences) => {
          preferences.interaction.aiQuickRelations = value === 'true'
        })
        this.setStatus('status.interactionUpdated')
        this.render()
        return
      case 'interaction.doubleClickAction':
        this.updatePreferences((preferences) => {
          preferences.interaction.doubleClickAction = normalizeGestureAction(
            value,
            preferences.interaction.doubleClickAction,
          )
        })
        this.setStatus('status.interactionUpdated')
        this.render()
        return
      case 'interaction.tripleClickAction':
        this.updatePreferences((preferences) => {
          preferences.interaction.tripleClickAction = normalizeGestureAction(
            value,
            preferences.interaction.tripleClickAction,
          )
        })
        this.setStatus('status.interactionUpdated')
        this.render()
        return
      case 'interaction.longPressAction':
        this.updatePreferences((preferences) => {
          preferences.interaction.longPressAction = normalizeGestureAction(
            value,
            preferences.interaction.longPressAction,
          )
          preferences.interaction.rightLongPressAction = preferences.interaction.longPressAction
        })
        this.setStatus('status.interactionUpdated')
        this.render()
        return
      case 'interaction.leftLongPressAction':
        this.updatePreferences((preferences) => {
          preferences.interaction.leftLongPressAction = normalizeGestureAction(
            value,
            preferences.interaction.leftLongPressAction,
          )
        })
        this.setStatus('status.interactionUpdated')
        this.render()
        return
      case 'interaction.middleLongPressAction':
        this.updatePreferences((preferences) => {
          preferences.interaction.middleLongPressAction = normalizeGestureAction(
            value,
            preferences.interaction.middleLongPressAction,
          )
        })
        this.setStatus('status.interactionUpdated')
        this.render()
        return
      case 'interaction.rightLongPressAction':
        this.updatePreferences((preferences) => {
          preferences.interaction.rightLongPressAction = normalizeGestureAction(
            value,
            preferences.interaction.rightLongPressAction,
          )
          preferences.interaction.longPressAction = preferences.interaction.rightLongPressAction
        })
        this.setStatus('status.interactionUpdated')
        this.render()
        return
      case 'interaction.canvasLeftDragAction':
        this.updatePreferences((preferences) => {
          preferences.interaction.canvasLeftDragAction = normalizeCanvasDragAction(
            value,
            preferences.interaction.canvasLeftDragAction,
          )
        })
        this.setStatus('status.interactionUpdated')
        this.render()
        return
      case 'interaction.canvasMiddleDragAction':
        this.updatePreferences((preferences) => {
          preferences.interaction.canvasMiddleDragAction = normalizeCanvasDragAction(
            value,
            preferences.interaction.canvasMiddleDragAction,
          )
        })
        this.setStatus('status.interactionUpdated')
        this.render()
        return
      case 'interaction.canvasRightDragAction':
        this.updatePreferences((preferences) => {
          preferences.interaction.canvasRightDragAction = normalizeCanvasDragAction(
            value,
            preferences.interaction.canvasRightDragAction,
          )
        })
        this.setStatus('status.interactionUpdated')
        this.render()
        return
      case 'interaction.spaceAction':
        this.updatePreferences((preferences) => {
          preferences.interaction.spaceAction = normalizeGestureAction(value, preferences.interaction.spaceAction)
        })
        this.setStatus('status.interactionUpdated')
        this.render()
        return
      case 'ai.provider':
        this.updatePreferences((preferences) => {
          preferences.ai.provider = value === 'openai-compatible' ? 'openai-compatible' : 'lmstudio'
        })
        this.resetAIConnectionFeedback()
        this.setStatus('status.aiSettingsSaved')
        this.render()
        return
      case 'ai.baseUrl':
        this.updatePreferences((preferences) => {
          preferences.ai.baseUrl = value.trim() || DEFAULT_LM_STUDIO_URL
        })
        this.resetAIConnectionFeedback()
        this.setStatus('status.aiSettingsSaved')
        this.render()
        return
      case 'ai.apiKey':
        this.updatePreferences((preferences) => {
          preferences.ai.apiKey = value.trim()
        })
        this.resetAIConnectionFeedback()
        this.setStatus('status.aiSettingsSaved')
        this.render()
        return
      case 'ai.model':
        this.updatePreferences((preferences) => {
          preferences.ai.model = value.trim()
        })
        this.resetAIConnectionFeedback()
        this.setStatus('status.aiSettingsSaved')
        this.render()
        return
      case 'ai.maxTokens':
        this.updatePreferences((preferences) => {
          preferences.ai.maxTokens = normalizeAIMaxTokens(value)
        })
        this.setStatus('status.aiSettingsSaved')
        this.render()
        return
      case 'ai.timeoutSeconds':
        this.updatePreferences((preferences) => {
          preferences.ai.timeoutSeconds = normalizeAITimeoutSeconds(value)
        })
        this.resetAIConnectionFeedback()
        this.setStatus('status.aiSettingsSaved')
        this.render()
        return
      default:
        break
    }
  }

  private setLocale(locale: Locale, announce: boolean): void {
    this.updatePreferences((preferences) => {
      preferences.locale = locale
    })
    this.applyLocale()
    if (announce) {
      this.setStatus('status.languageUpdated')
    }
    this.render()
  }

  private toggleSettings(): void {
    this.state.settingsOpen = !this.state.settingsOpen
    this.setStatus(this.state.settingsOpen ? 'status.settingsOpened' : 'status.settingsClosed')
    this.render()
  }

  private toggleTopPanel(): void {
    this.state.topPanelCollapsed = !this.state.topPanelCollapsed
    this.setStatus(this.state.topPanelCollapsed ? 'status.topPanelClosed' : 'status.topPanelOpened')
    this.render()
  }

  private resetAIConnectionFeedback(): void {
    this.state.ai.testing = false
    this.state.ai.connectionOK = null
    this.state.ai.connectionMessage = ''
    this.state.ai.connectionModel = ''
  }

  private toggleInspector(): void {
    this.state.inspectorCollapsed = !this.state.inspectorCollapsed
    this.setStatus(this.state.inspectorCollapsed ? 'status.panelClosed' : 'status.panelOpened')
    this.render()
  }

  private closeSettings(): void {
    if (!this.state.settingsOpen) {
      return
    }

    this.state.settingsOpen = false
    this.setStatus('status.settingsClosed')
    this.render()
  }

  private completeOnboarding(): void {
    this.updatePreferences((preferences) => {
      preferences.onboardingCompleted = true
    })
    this.render()
  }

  private updatePreferences(updater: (preferences: AppPreferences) => void): void {
    const nextPreferences: AppPreferences = {
      ...this.state.preferences,
      appearance: {
        ...this.state.preferences.appearance,
      },
      interaction: {
        ...this.state.preferences.interaction,
      },
      ai: {
        ...this.state.preferences.ai,
      },
    }
    updater(nextPreferences)
    this.state.preferences = nextPreferences
    savePreferences(nextPreferences)
    this.applyLocale()
  }

  private initializeViewportIfNeeded(): void {
    if (this.didInitializeViewport || !this.refs) {
      return
    }

    const root = findRoot(this.state.document)
    const { scroll } = this.refs
    queueMicrotask(() => {
      const bounds = getWorkspaceBounds(this.state.document)
      const rootPosition = this.toWorkspacePosition(root.position, bounds)
      this.viewport.scale = 1
      this.viewport.x = scroll.clientWidth / 2 - rootPosition.x * this.viewport.scale
      this.viewport.y = scroll.clientHeight / 2 - rootPosition.y * this.viewport.scale
      this.applyCanvasMetrics(bounds, false)
      this.updateCanvasViewportView()
    })
    this.didInitializeViewport = true
  }

  private findNode(nodeId: string): MindNode | undefined {
    return findNode(this.state.document, nodeId)
  }

  private findMapSummary(mapId: string): MindMapSummary | undefined {
    return this.state.maps.find((item) => item.id === mapId)
  }

  private applyCanvasMetrics(
    bounds = getWorkspaceBounds(this.state.document),
    preserveViewportPosition = this.didInitializeViewport,
  ): void {
    if (!this.refs) {
      return
    }

    if (preserveViewportPosition) {
      const deltaOriginX = bounds.originX - this.workspaceBounds.originX
      const deltaOriginY = bounds.originY - this.workspaceBounds.originY
      if (deltaOriginX !== 0 || deltaOriginY !== 0) {
        this.viewport.x -= deltaOriginX * this.viewport.scale
        this.viewport.y -= deltaOriginY * this.viewport.scale
      }
    }

    this.workspaceBounds = bounds
    const scaledWidth = Math.max(1, Math.ceil(bounds.width * this.viewport.scale))
    const scaledHeight = Math.max(1, Math.ceil(bounds.height * this.viewport.scale))

    this.refs.canvas.style.width = `${scaledWidth}px`
    this.refs.canvas.style.height = `${scaledHeight}px`
    this.refs.nodeLayer.style.width = `${bounds.width}px`
    this.refs.nodeLayer.style.height = `${bounds.height}px`
    this.refs.nodeLayer.style.setProperty('zoom', String(this.viewport.scale))
    this.refs.regionLayer.style.width = `${bounds.width}px`
    this.refs.regionLayer.style.height = `${bounds.height}px`
    this.refs.regionLayer.style.setProperty('zoom', String(this.viewport.scale))
    this.refs.edgeLayer.style.width = `${scaledWidth}px`
    this.refs.edgeLayer.style.height = `${scaledHeight}px`
  }

  private canUndo(): boolean {
    return this.historyPast.length > 0
  }

  private canRedo(): boolean {
    return this.historyFuture.length > 0
  }

  private createHistorySnapshot(): HistorySnapshot {
    return {
      document: cloneDocument(this.state.document),
      selectedNodeId: this.state.selectedNodeId,
      selectedNodeIds: [...this.selectedNodeIds()],
      connectSourceNodeId: this.state.connectSourceNodeId,
    }
  }

  private pushHistorySnapshot(snapshot: HistorySnapshot): void {
    this.historyPast.push(snapshot)
    if (this.historyPast.length > HISTORY_LIMIT) {
      this.historyPast.shift()
    }
    this.historyFuture = []
  }

  private captureHistory(): void {
    this.pushHistorySnapshot(this.createHistorySnapshot())
  }

  private resetHistory(): void {
    this.historyPast = []
    this.historyFuture = []
  }

  private applyHistorySnapshot(snapshot: HistorySnapshot): void {
    this.state.document = cloneDocument(snapshot.document)
    this.setSelection(snapshot.selectedNodeIds, snapshot.selectedNodeId)
    this.state.connectSourceNodeId =
      snapshot.connectSourceNodeId && findNode(this.state.document, snapshot.connectSourceNodeId)
        ? snapshot.connectSourceNodeId
        : null
    this.clearNodeLongPress()
    this.clearNodeEditorState()
    this.state.drag = null
    this.pan = null
    this.state.resize = null
    this.state.contextMenu = null
    this.state.marquee = null
    this.applyTheme()
  }

  private undo(): void {
    if (!this.canUndo()) {
      return
    }

    const snapshot = this.historyPast.pop()
    if (!snapshot) {
      return
    }

    this.historyFuture.push(this.createHistorySnapshot())
    this.applyHistorySnapshot(snapshot)
    this.setStatus('status.undoApplied')
    this.render()
    this.scheduleAutosave('status.saved')
  }

  private redo(): void {
    if (!this.canRedo()) {
      return
    }

    const snapshot = this.historyFuture.pop()
    if (!snapshot) {
      return
    }

    this.historyPast.push(this.createHistorySnapshot())
    this.applyHistorySnapshot(snapshot)
    this.setStatus('status.redoApplied')
    this.render()
    this.scheduleAutosave('status.saved')
  }

  private scheduleLiveNodeUpdate(nodeId: string, includeDimensions = false): void {
    this.liveNodeIds.add(nodeId)
    if (includeDimensions) {
      this.liveNodeDimensionIds.add(nodeId)
    }

    if (this.liveCanvasHandle !== null) {
      return
    }

    this.liveCanvasHandle = window.requestAnimationFrame(() => {
      this.liveCanvasHandle = null
      const nextNodeIds = [...this.liveNodeIds]
      const nextDimensionIds = new Set(this.liveNodeDimensionIds)
      this.liveNodeIds.clear()
      this.liveNodeDimensionIds.clear()
      if (nextNodeIds.length > 0) {
        this.applyLiveNodeUpdate(nextNodeIds, nextDimensionIds)
      }
    })
  }

  private flushLiveNodeUpdate(): void {
    if (this.liveCanvasHandle === null) {
      return
    }

    window.cancelAnimationFrame(this.liveCanvasHandle)
    this.liveCanvasHandle = null
    const nextNodeIds = [...this.liveNodeIds]
    const nextDimensionIds = new Set(this.liveNodeDimensionIds)
    this.liveNodeIds.clear()
    this.liveNodeDimensionIds.clear()

    if (nextNodeIds.length > 0) {
      this.applyLiveNodeUpdate(nextNodeIds, nextDimensionIds)
    }
  }

  private applyLiveNodeUpdate(nodeIds: string[], includeDimensionIds: Set<string>): void {
    if (!this.refs) {
      return
    }

    const bounds = getWorkspaceBounds(this.state.document)
    const originChanged =
      bounds.originX !== this.workspaceBounds.originX || bounds.originY !== this.workspaceBounds.originY
    if (originChanged) {
      this.renderWorkspace()
      return
    }

    this.applyCanvasMetrics(bounds)
    this.updateCanvasViewportView()
    this.refs.edgeLayer.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`)

    for (const nodeId of nodeIds) {
      const node = this.findNode(nodeId)
      const element = this.rootEl.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`)
      if (node && element) {
        const workspacePosition = this.toWorkspacePosition(node.position, bounds)
        element.style.left = `${workspacePosition.x}px`
        element.style.top = `${workspacePosition.y}px`
        if (includeDimensionIds.has(nodeId)) {
          const sizingTarget = element.querySelector<HTMLElement>('.node-shell, .node-editor')
          const titleTarget = element.querySelector<HTMLElement>('[data-node-title]')
          if (sizingTarget) {
            sizingTarget.style.width = node.width ? `${Math.max(node.width, MIN_NODE_WIDTH)}px` : ''
            sizingTarget.style.height = node.height ? `${Math.max(node.height, MIN_NODE_HEIGHT)}px` : ''
            sizingTarget.style.maxWidth = node.width ? 'none' : ''
          }
          if (titleTarget) {
            titleTarget.textContent = nodeVisibleTitle(node)
          }
        }
      }
    }

    this.refs.edgeLayer.innerHTML = this.renderEdges()
  }

  private applyMarqueeSelection(marquee: MarqueeState): void {
    const selectionRect = normalizeClientRect(
      marquee.startClientX,
      marquee.startClientY,
      marquee.currentClientX,
      marquee.currentClientY,
    )
    const matchedIds = this.state.document.nodes
      .map((node) => {
        const element = this.rootEl.querySelector<HTMLElement>(`[data-node-id="${node.id}"]`)
        if (!element) {
          return null
        }

        return rectanglesIntersect(selectionRect, element.getBoundingClientRect()) ? node.id : null
      })
      .filter((nodeId): nodeId is string => Boolean(nodeId))

    if (matchedIds.length === 0) {
      this.render()
      return
    }

    this.setSelection(matchedIds, matchedIds[matchedIds.length - 1])
    this.render()
  }

  private scheduleAutosave(statusKey: TranslationKey, values?: Record<string, string | number>): void {
    if (this.autosaveHandle !== null) {
      window.clearTimeout(this.autosaveHandle)
    }

    this.autosaveHandle = window.setTimeout(() => {
      void this.saveDocument(statusKey, values)
    }, 700)
  }

  private setStatus(key: TranslationKey, values?: Record<string, string | number>): void {
    this.state.status = { key, values }
  }

  private setCanvasPanning(active: boolean): void {
    this.refs?.scroll.classList.toggle('is-panning', active)
  }

  private clientToCanvasPosition(clientX: number, clientY: number): Position {
    const scroll = this.refs?.scroll
    if (!scroll) {
      return { x: clientX, y: clientY }
    }

    const rect = scroll.getBoundingClientRect()
    return {
      x: (clientX - rect.left - this.viewport.x) / this.viewport.scale - this.workspaceBounds.originX,
      y: (clientY - rect.top - this.viewport.y) / this.viewport.scale - this.workspaceBounds.originY,
    }
  }

  private toWorkspacePosition(position: Position, bounds = this.workspaceBounds): Position {
    return {
      x: position.x + bounds.originX,
      y: position.y + bounds.originY,
    }
  }

  private updateCanvasViewportView(): void {
    if (!this.refs) {
      return
    }

    this.refs.canvas.style.transform = `translate(${Math.round(this.viewport.x)}px, ${Math.round(this.viewport.y)}px)`
  }

  private renderGraphResultsList(): string {
    const matches = this.findGraphMatches(this.state.graph.search).slice(0, 8)
    if (matches.length === 0) {
      return `<p class="empty-state">${this.t('graph.emptySearch')}</p>`
    }

    return matches
      .map((node) => {
        const active = node.id === this.state.graph.selectedNodeId
        return `<button type="button" class="graph-result-item ${active ? 'is-active' : ''}" data-graph-node-result="${node.id}">${escapeHtml(shorten(node.title, 36))}</button>`
      })
      .join('')
  }

  private renderGraphSummaryContent(): string {
    const selectedNode = this.findNode(this.state.graph.selectedNodeId ?? '')
    if (!selectedNode) {
      return `
        <p class="section-label">${this.t('graph.selection')}</p>
        <h3>${this.t('common.unknownNode')}</h3>
        <p class="inspector-copy">${this.t('graph.selectionHint')}</p>
      `
    }

    const relatedRelations = connectedRelations(this.state.document, selectedNode.id)
    const descendants = descendantIds(this.state.document, selectedNode.id)
    return `
      <p class="section-label">${this.t('graph.selection')}</p>
      <h3>${escapeHtml(selectedNode.title)}</h3>
      <div class="metric-row">
        <span class="metric-chip">${kindLabel(this.state.preferences.locale, selectedNode.kind)}</span>
        <span class="metric-chip">${this.t('inspector.children', { value: childrenOf(this.state.document, selectedNode.id).length })}</span>
        <span class="metric-chip">${this.t('inspector.relationsCount', { value: relatedRelations.length })}</span>
      </div>
      <p class="inspector-copy">${this.t('graph.summaryCopy', { value: descendants.length })}</p>
      <p class="inspector-copy">${this.t('graph.doubleClickHint')}</p>
    `
  }

  private updateGraphSummaryPanel(): void {
    const summary = this.rootEl.querySelector<HTMLElement>('[data-graph-summary]')
    if (summary) {
      summary.innerHTML = this.renderGraphSummaryContent()
    }

    const resultList = this.rootEl.querySelector<HTMLElement>('[data-graph-result-list]')
    if (resultList) {
      resultList.innerHTML = this.renderGraphResultsList()
    }
  }

  private syncGraphAnimation(): void {
    if (!this.state.graph.open || !this.state.graph.autoRotate) {
      this.stopGraphAnimation()
      this.drawGraphScene()
      return
    }

    if (this.graphAnimationHandle !== null) {
      return
    }

    const animate = () => {
      if (!this.state.graph.open || !this.state.graph.autoRotate) {
        this.graphAnimationHandle = null
        return
      }

      this.state.graph.rotation = (this.state.graph.rotation + 0.006) % (Math.PI * 2)
      this.drawGraphScene()
      this.graphAnimationHandle = window.requestAnimationFrame(animate)
    }

    this.graphAnimationHandle = window.requestAnimationFrame(animate)
  }

  private stopGraphAnimation(): void {
    if (this.graphAnimationHandle !== null) {
      window.cancelAnimationFrame(this.graphAnimationHandle)
      this.graphAnimationHandle = null
    }
    this.graphHitNodes = []
  }

  private drawGraphScene(): void {
    if (!this.state.graph.open) {
      return
    }

    this.updateGraphZoomIndicator()
    const canvas = this.rootEl.querySelector<HTMLCanvasElement>('[data-graph-canvas]')
    if (!canvas) {
      return
    }

    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    const width = Math.max(canvas.clientWidth, 320)
    const height = Math.max(canvas.clientHeight, 240)
    const dpr = Math.max(window.devicePixelRatio || 1, 1)
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.clearRect(0, 0, width, height)

    const frame = buildGraphFrame(
      this.state.document,
      width,
      height,
      this.state.graph.rotation,
      this.state.graph.tilt,
      this.state.graph.zoom,
      this.state.graph.search,
      this.state.graph.selectedNodeId,
    )
    this.graphHitNodes = frame.hitNodes

    const background = context.createLinearGradient(0, 0, width, height)
    background.addColorStop(0, 'rgba(15, 23, 42, 0.96)')
    background.addColorStop(1, 'rgba(12, 18, 32, 0.96)')
    context.fillStyle = background
    context.fillRect(0, 0, width, height)

    const atmosphere = context.createRadialGradient(
      width / 2,
      height * 0.56,
      0,
      width / 2,
      height * 0.56,
      Math.max(width, height) * 0.58,
    )
    atmosphere.addColorStop(0, 'rgba(99, 102, 241, 0.12)')
    atmosphere.addColorStop(0.52, 'rgba(56, 189, 248, 0.05)')
    atmosphere.addColorStop(1, 'rgba(15, 23, 42, 0)')
    context.fillStyle = atmosphere
    context.fillRect(0, 0, width, height)

    context.strokeStyle = 'rgba(148, 163, 184, 0.08)'
    for (let index = 0; index < width; index += 48) {
      context.beginPath()
      context.moveTo(index, 0)
      context.lineTo(index, height)
      context.stroke()
    }
    for (let index = 0; index < height; index += 48) {
      context.beginPath()
      context.moveTo(0, index)
      context.lineTo(width, index)
      context.stroke()
    }

    context.lineCap = 'round'
    context.lineJoin = 'round'
    for (const edge of frame.edges) {
      context.beginPath()
      context.strokeStyle =
        edge.type === 'relation' ? `rgba(253, 186, 116, ${edge.opacity})` : `rgba(147, 197, 253, ${edge.opacity})`
      context.lineWidth = edge.lineWidth
      context.moveTo(edge.x1, edge.y1)
      context.lineTo(edge.x2, edge.y2)
      context.stroke()
    }

    context.textAlign = 'center'
    context.textBaseline = 'middle'
    for (const node of frame.nodes) {
      const nodePalette = resolveNodeColorPalette(node.color)
      const occlusionRadius = node.radius + Math.max(3.2, node.lineWidth * 1.25)

      // Draw region ring if node is inside a region
      const regions = this.state.document.regions ?? []
      for (const region of regions) {
        const docNode = this.findNode(node.id)
        if (!docNode) continue
        if (this.nodeOverlapsRegion(docNode, region)) {
          const regionPalette = resolveNodeColorPalette(region.color)
          if (regionPalette) {
            context.save()
            context.beginPath()
            context.strokeStyle = rgbaFromRgb(regionPalette.accentRgb, 0.55)
            context.lineWidth = Math.max(2.5, node.lineWidth * 1.1)
            context.arc(node.x, node.y, occlusionRadius + 4, 0, Math.PI * 2)
            context.stroke()
            context.restore()
          }
          break
        }
      }

      context.save()
      context.beginPath()
      context.fillStyle = nodePalette
        ? rgbaFromRgb(nodePalette.plateRgb, node.occlusionOpacity)
        : `rgba(9, 14, 24, ${node.occlusionOpacity})`
      context.arc(node.x, node.y, occlusionRadius, 0, Math.PI * 2)
      context.fill()
      context.restore()

      context.save()
      context.beginPath()
      context.shadowColor = node.selected
        ? 'rgba(129, 140, 248, 0.48)'
        : node.highlighted
          ? 'rgba(96, 165, 250, 0.34)'
          : nodePalette
            ? rgbaFromRgb(nodePalette.glowRgb, Math.min(0.34, node.opacity * 0.3))
            : `rgba(56, 189, 248, ${Math.min(0.22, node.opacity * 0.22)})`
      context.shadowBlur = node.glow
      context.fillStyle = node.selected
        ? 'rgba(129, 140, 248, 0.95)'
        : node.highlighted
          ? 'rgba(96, 165, 250, 0.92)'
          : nodePalette
            ? rgbaFromRgb(nodePalette.surfaceRgb, node.surfaceOpacity)
            : `rgba(30, 41, 59, ${node.surfaceOpacity})`
      context.strokeStyle = node.selected
        ? 'rgba(199, 210, 254, 0.95)'
        : nodePalette
          ? rgbaFromRgb(nodePalette.accentRgb, Math.max(0.42, node.strokeOpacity))
          : `rgba(148, 163, 184, ${node.strokeOpacity})`
      context.lineWidth = node.lineWidth
      context.arc(node.x, node.y, node.radius, 0, Math.PI * 2)
      context.fill()
      context.stroke()
      context.restore()

      context.font = `${node.fontSize}px "Segoe UI", sans-serif`
      const labelWidth = context.measureText(node.label).width
      const labelPlateWidth = Math.max(node.radius * 1.8, labelWidth + 24)
      const labelPlateHeight = Math.max(node.radius * 0.96, node.fontSize + 12)
      context.save()
      context.beginPath()
      traceRoundedRectPath(
        context,
        node.x - labelPlateWidth / 2,
        node.y - labelPlateHeight / 2,
        labelPlateWidth,
        labelPlateHeight,
        Math.min(labelPlateHeight / 2, 14),
      )
      context.fillStyle = node.selected
        ? 'rgba(79, 70, 229, 0.92)'
        : node.highlighted
          ? 'rgba(37, 99, 235, 0.86)'
          : nodePalette
            ? rgbaFromRgb(nodePalette.plateRgb, Math.max(0.9, node.surfaceOpacity))
            : `rgba(15, 23, 42, ${Math.max(0.84, node.surfaceOpacity)})`
      context.strokeStyle = node.selected
        ? 'rgba(199, 210, 254, 0.94)'
        : nodePalette
          ? rgbaFromRgb(nodePalette.accentRgb, Math.max(0.52, node.strokeOpacity * 0.88))
          : `rgba(148, 163, 184, ${Math.max(0.42, node.strokeOpacity * 0.84)})`
      context.lineWidth = Math.max(1, node.lineWidth * 0.88)
      context.fill()
      context.stroke()
      context.restore()

      context.fillStyle = nodePalette
        ? applyAlphaToHex(nodePalette.text, node.textOpacity)
        : `rgba(241, 245, 249, ${node.textOpacity})`
      context.fillText(node.label, node.x, node.y)
    }
  }

  private selectGraphNodeAtPoint(clientX: number, clientY: number): string | null {
    const canvas = this.rootEl.querySelector<HTMLCanvasElement>('[data-graph-canvas]')
    if (!canvas) {
      return null
    }

    const rect = canvas.getBoundingClientRect()
    const localX = clientX - rect.left
    const localY = clientY - rect.top
    let matched: GraphHitNode | null = null
    for (const hitNode of this.graphHitNodes) {
      const distance = Math.hypot(localX - hitNode.x, localY - hitNode.y)
      if (distance <= hitNode.radius + 6) {
        matched = hitNode
        break
      }
    }

    if (!matched) {
      return null
    }

    this.state.graph.selectedNodeId = matched.id
    this.updateGraphSummaryPanel()
    this.drawGraphScene()
    return matched.id
  }

  private findGraphMatches(query: string): MindNode[] {
    const normalized = query.trim().toLowerCase()
    if (!normalized) {
      return this.state.document.nodes.slice(0, 8)
    }

    return this.state.document.nodes.filter((node) => node.title.toLowerCase().includes(normalized))
  }

  private t(key: TranslationKey, values?: Record<string, string | number>): string {
    return translate(this.state.preferences.locale, key, values)
  }

  private onboardingOpen(): boolean {
    return !this.state.preferences.onboardingCompleted
  }

  private overlayBlocksCanvas(): boolean {
    return this.onboardingOpen() || this.state.settingsOpen || this.state.ai.open || this.state.graph.open
  }

  private updateGraphZoomIndicator(): void {
    const indicator = this.rootEl.querySelector<HTMLElement>('[data-graph-zoom-value]')
    if (indicator) {
      indicator.textContent = this.t('graph.zoomValue', { value: Math.round(this.state.graph.zoom * 100) })
    }
  }

  private applyTheme(): void {
    const theme = this.state.view === 'home' ? 'dark' : this.state.document.theme
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
  }

  private applyLocale(): void {
    document.documentElement.lang = this.state.preferences.locale
  }
}
