import { api } from './api'
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
import { type TranslationKey, kindLabel, nodeColorLabel, themeLabel, translate } from './i18n'
import { DEFAULT_AI_MAX_TOKENS, DEFAULT_LM_STUDIO_URL, loadPreferences, normalizeAIMaxTokens, savePreferences } from './preferences'
import type {
  AIDebugInfo,
  AIDebugRequest,
  AppPreferences,
  AITemplateId,
  Locale,
  MindMapDocument,
  MindMapSummary,
  MindNode,
  NodeColor,
  Position,
  Priority,
  RelationEdge,
  Theme,
} from './types'

type AppView = 'home' | 'map'
type AIDebugAction = 'generate' | 'notes' | 'relations' | ''

interface DragState {
  nodeId: string
  nodeIds: string[]
  offsetX: number
  offsetY: number
  initialPositions: Record<string, Position>
  historyCaptured: boolean
}

interface PanState {
  pointerId: number
  startX: number
  startY: number
  startViewportX: number
  startViewportY: number
}

interface ResizeState {
  nodeId: string
  startX: number
  startY: number
  startWidth: number
  startHeight: number
  anchorLeft: number
  anchorTop: number
  historyCaptured: boolean
}

interface HistorySnapshot {
  document: MindMapDocument
  selectedNodeId: string | null
  selectedNodeIds: string[]
  connectSourceNodeId: string | null
}

interface ContextMenuState {
  clientX: number
  clientY: number
  nodeId: string | null
}

interface MarqueeState {
  pointerId: number
  button: number
  startClientX: number
  startClientY: number
  currentClientX: number
  currentClientY: number
  active: boolean
}

interface StatusDescriptor {
  key: TranslationKey
  values?: Record<string, string | number>
}

interface EditorLaunchOptions {
  value?: string | null
  selection?: 'all' | 'end'
}

interface GraphDragState {
  pointerId: number
  startX: number
  startY: number
  startRotation: number
  startTilt: number
}

interface AIWorkspaceState {
  open: boolean
  busy: boolean
  testing: boolean
  debugOpen: boolean
  rawMode: boolean
  template: AITemplateId
  topic: string
  generationInstructions: string
  noteInstructions: string
  relationInstructions: string
  generateRawRequest: string
  noteRawRequest: string
  relationRawRequest: string
  lastSummary: string
  lastModel: string
  lastDebugAction: AIDebugAction
  lastDebugInfo: AIDebugInfo | null
  lastDebugError: string
  connectionMessage: string
  connectionModel: string
  connectionOK: boolean | null
}

interface AINoteTargetState {
  mode: 'selection' | 'all'
  nodes: MindNode[]
}

interface GraphOverlayState {
  open: boolean
  search: string
  selectedNodeId: string | null
  autoRotate: boolean
  rotation: number
  tilt: number
  zoom: number
}

interface AppState {
  view: AppView
  maps: MindMapSummary[]
  document: MindMapDocument
  currentMapId: string | null
  selectedNodeId: string | null
  selectedNodeIds: string[]
  editingNodeId: string | null
  connectSourceNodeId: string | null
  drag: DragState | null
  resize: ResizeState | null
  contextMenu: ContextMenuState | null
  marquee: MarqueeState | null
  status: StatusDescriptor
  preferences: AppPreferences
  settingsOpen: boolean
  topPanelCollapsed: boolean
  inspectorCollapsed: boolean
  ai: AIWorkspaceState
  graph: GraphOverlayState
}

interface ShellRefs {
  topChrome: HTMLElement
  topPanel: HTMLElement
  eyebrow: HTMLParagraphElement
  title: HTMLHeadingElement
  status: HTMLParagraphElement
  homeButton: HTMLButtonElement
  topPanelButton: HTMLButtonElement
  renameMapButton: HTMLButtonElement
  deleteMapButton: HTMLButtonElement
  settingsButton: HTMLButtonElement
  panelButton: HTMLButtonElement
  themeButton: HTMLButtonElement
  undoButton: HTMLButtonElement
  redoButton: HTMLButtonElement
  saveButton: HTMLButtonElement
  layoutButton: HTMLButtonElement
  exportButton: HTMLButtonElement
  importButton: HTMLButtonElement
  topbarConnectButton: HTMLButtonElement
  aiButton: HTMLButtonElement
  graphButton: HTMLButtonElement
  importInput: HTMLInputElement
  scroll: HTMLElement
  canvas: HTMLElement
  edgeLayer: SVGSVGElement
  nodeLayer: HTMLElement
  inspector: HTMLElement
  settingsLayer: HTMLElement
  onboardingLayer: HTMLElement
  overlayLayer: HTMLElement
  aiLayer: HTMLElement
  graphLayer: HTMLElement
}

interface GraphHitNode {
  id: string
  x: number
  y: number
  radius: number
}

interface WorkspaceBounds {
  minX: number
  minY: number
  width: number
  height: number
  originX: number
  originY: number
}

interface CopiedSubtreeNode {
  id: string
  parentId?: string
  kind: MindNode['kind']
  title: string
  note?: string
  priority?: Priority
  color?: NodeColor
  collapsed?: boolean
  width?: number
  height?: number
  offset: Position
}

interface CopiedSubtree {
  rootId: string
  nodes: CopiedSubtreeNode[]
}

const WORKSPACE_MIN_WIDTH = 2400
const WORKSPACE_MIN_HEIGHT = 1600
const WORKSPACE_PADDING = 360
const MIN_ZOOM = 0.4
const MAX_ZOOM = 2.4
const ZOOM_SENSITIVITY = 0.0018
const MIN_NODE_WIDTH = 170
const MIN_NODE_HEIGHT = 52
const HISTORY_LIMIT = 120
const GRAPH_DEFAULT_ZOOM = 1.16
const GRAPH_MIN_ZOOM = 0.68
const GRAPH_MAX_ZOOM = 1.92
const GRAPH_ZOOM_SENSITIVITY = 0.0012
const PRIORITY_VALUES: Priority[] = ['', 'P0', 'P1', 'P2', 'P3']
const NODE_COLOR_VALUES: NodeColor[] = ['', 'slate', 'blue', 'teal', 'green', 'amber', 'rose', 'violet']
const AI_TEMPLATES: Array<{ id: AITemplateId }> = [
  { id: 'concept-graph' },
  { id: 'project-planning' },
  { id: 'character-network' },
]

type NodeColorChoice = Exclude<NodeColor, ''>

interface NodeColorPalette {
  accent: string
  accentRgb: [number, number, number]
  surfaceRgb: [number, number, number]
  plateRgb: [number, number, number]
  glowRgb: [number, number, number]
  text: string
  labelKey: TranslationKey
}

const NODE_COLOR_PALETTES: Record<NodeColorChoice, NodeColorPalette> = {
  slate: {
    accent: '#94a3b8',
    accentRgb: [148, 163, 184],
    surfaceRgb: [71, 85, 105],
    plateRgb: [51, 65, 85],
    glowRgb: [148, 163, 184],
    text: '#f8fafc',
    labelKey: 'color.slate',
  },
  blue: {
    accent: '#60a5fa',
    accentRgb: [96, 165, 250],
    surfaceRgb: [37, 99, 235],
    plateRgb: [29, 78, 216],
    glowRgb: [96, 165, 250],
    text: '#eff6ff',
    labelKey: 'color.blue',
  },
  teal: {
    accent: '#2dd4bf',
    accentRgb: [45, 212, 191],
    surfaceRgb: [13, 148, 136],
    plateRgb: [15, 118, 110],
    glowRgb: [45, 212, 191],
    text: '#ecfeff',
    labelKey: 'color.teal',
  },
  green: {
    accent: '#4ade80',
    accentRgb: [74, 222, 128],
    surfaceRgb: [22, 163, 74],
    plateRgb: [21, 128, 61],
    glowRgb: [74, 222, 128],
    text: '#f0fdf4',
    labelKey: 'color.green',
  },
  amber: {
    accent: '#f59e0b',
    accentRgb: [245, 158, 11],
    surfaceRgb: [217, 119, 6],
    plateRgb: [180, 83, 9],
    glowRgb: [245, 158, 11],
    text: '#fffbeb',
    labelKey: 'color.amber',
  },
  rose: {
    accent: '#fb7185',
    accentRgb: [251, 113, 133],
    surfaceRgb: [225, 29, 72],
    plateRgb: [190, 24, 93],
    glowRgb: [251, 113, 133],
    text: '#fff1f2',
    labelKey: 'color.rose',
  },
  violet: {
    accent: '#a78bfa',
    accentRgb: [167, 139, 250],
    surfaceRgb: [109, 40, 217],
    plateRgb: [91, 33, 182],
    glowRgb: [167, 139, 250],
    text: '#f5f3ff',
    labelKey: 'color.violet',
  },
}

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
  private pendingEditorOptions: EditorLaunchOptions | null = null
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
      selectedNodeId: 'root',
      selectedNodeIds: ['root'],
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
      inspectorCollapsed: true,
      ai: {
        open: false,
        busy: false,
        testing: false,
        debugOpen: false,
        rawMode: false,
        template: 'concept-graph',
        topic: '',
        generationInstructions: '',
        noteInstructions: '',
        relationInstructions: '',
        generateRawRequest: '',
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

    const closedContextMenu = Boolean(this.state.contextMenu) && !target.closest('[data-context-menu]')
    if (closedContextMenu) {
      this.state.contextMenu = null
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
    if (command) {
      this.state.contextMenu = null
      void this.runCommand(command)
      return
    }

    const priority = target.closest<HTMLElement>('[data-priority]')?.dataset.priority as Priority | undefined
    if (priority !== undefined) {
      this.setPriority(priority)
      return
    }

    const nodeColor = target.closest<HTMLElement>('[data-node-color]')?.dataset.nodeColor as NodeColor | undefined
    if (nodeColor !== undefined) {
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

    const nodeButton = target.closest<HTMLElement>('[data-node-button]')
    if (nodeButton?.dataset.nodeButton) {
      const nodeId = nodeButton.dataset.nodeButton
      if (this.state.connectSourceNodeId && this.state.connectSourceNodeId !== nodeId) {
        this.createRelation(this.state.connectSourceNodeId, nodeId)
        return
      }

      if (!event.shiftKey && !event.ctrlKey && !event.metaKey && event.detail >= 2) {
        event.preventDefault()
        this.setSelection([nodeId], nodeId)
        this.openNodeEditor(nodeId, { selection: 'all' })
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

    if (closedContextMenu) {
      this.renderOverlay()
      this.renderHeader()
    }

    const clickedWorkspace = target.closest<HTMLElement>('[data-workspace-scroll]')
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

    if (this.state.editingNodeId === nodeButton.dataset.nodeButton) {
      return
    }

    event.preventDefault()
    this.setSelection([nodeButton.dataset.nodeButton], nodeButton.dataset.nodeButton)
    this.openNodeEditor(nodeButton.dataset.nodeButton, { selection: 'all' })
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    const target = event.target
    if (target instanceof HTMLElement && this.state.graph.open) {
      const graphCanvas = target.closest<HTMLCanvasElement>('[data-graph-canvas]')
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

    if (!(target instanceof HTMLElement)) {
      return
    }

    if (event.button === 2) {
      const withinScroll = target.closest<HTMLElement>('[data-workspace-scroll]')
      if (!withinScroll) {
        return
      }

      this.state.contextMenu = null
      this.state.marquee = {
        pointerId: event.pointerId,
        button: event.button,
        startClientX: event.clientX,
        startClientY: event.clientY,
        currentClientX: event.clientX,
        currentClientY: event.clientY,
        active: false,
      }
      this.renderOverlay()
      return
    }

    if (event.button !== 0) {
      return
    }

    const resizeHandle = target.closest<HTMLElement>('[data-node-resizer]')
    const resizeNodeId = resizeHandle?.dataset.nodeResizer
    if (resizeNodeId) {
      const node = this.findNode(resizeNodeId)
      if (!node || node.kind === 'root') {
        return
      }

      const currentWidth = node.width ?? estimateNodeWidth(node)
      const currentHeight = node.height ?? estimateNodeHeight(node)

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

    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      return
    }

    const nodeButton = target.closest<HTMLElement>('[data-node-button]')
    const nodeId = nodeButton?.dataset.nodeButton
    if (!nodeId) {
      this.tryStartCanvasPan(event, target)
      return
    }

    if (!this.state.selectedNodeIds.includes(nodeId)) {
      this.setSelection([nodeId], nodeId)
    }

    const node = this.findNode(nodeId)
    const dragNodeIds = (this.state.selectedNodeIds.includes(nodeId) ? this.state.selectedNodeIds : [nodeId]).filter((candidateId) => {
      return this.findNode(candidateId)?.kind !== 'root'
    })

    if (event.detail >= 2) {
      return
    }

    if (!node || dragNodeIds.length === 0 || this.state.editingNodeId === nodeId || this.state.connectSourceNodeId !== null) {
      this.tryStartCanvasPan(event, target)
      return
    }

    const canvas = this.refs?.canvas
    if (!canvas) {
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

    if (this.state.marquee && event.pointerId === this.state.marquee.pointerId) {
      this.state.marquee.currentClientX = event.clientX
      this.state.marquee.currentClientY = event.clientY
      if (!this.state.marquee.active) {
        const deltaX = event.clientX - this.state.marquee.startClientX
        const deltaY = event.clientY - this.state.marquee.startClientY
        if (Math.hypot(deltaX, deltaY) > 8) {
          this.state.marquee.active = true
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
      (Math.abs(nextPosition.x - currentNode.position.x) > 0.5 || Math.abs(nextPosition.y - currentNode.position.y) > 0.5)
    ) {
      this.captureHistory()
      this.state.drag.historyCaptured = true
      this.renderHeader()
    }

    const anchorStart = this.state.drag.initialPositions[this.state.drag.nodeId]
    if (!anchorStart) {
      return
    }

    const deltaX = nextPosition.x - anchorStart.x
    const deltaY = nextPosition.y - anchorStart.y
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

    const activeTypingTarget = isTypingTarget(document.activeElement)
    if (this.state.view !== 'map' || this.onboardingOpen() || this.state.settingsOpen || isTypingTarget(event.target) || activeTypingTarget) {
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
      this.startEditingSelected({ selection: 'end' })
      return
    }
  }

  private readonly handleEditorKeyDown = (event: KeyboardEvent): void => {
    const target = event.target
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
      return
    }

    if (target instanceof HTMLInputElement && target.dataset.nodeEditor) {
      if (event.key === 'Enter') {
        event.preventDefault()
        this.commitNodeEditor(target.dataset.nodeEditor, target.value)
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        this.state.editingNodeId = null
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
    }
  }

  private readonly handleFocusOut = (event: FocusEvent): void => {
    const target = event.target
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      return
    }

    if (target instanceof HTMLInputElement && target.dataset.nodeEditor) {
      this.commitNodeEditor(target.dataset.nodeEditor, target.value)
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
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
      return
    }

    if (target instanceof HTMLInputElement && target.dataset.nodeEditor) {
      target.classList.remove('is-all-selected')
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
        case 'noteInstructions':
          this.state.ai.noteInstructions = target.value
          break
        case 'relationInstructions':
          this.state.ai.relationInstructions = target.value
          break
        case 'generateRawRequest':
          this.state.ai.generateRawRequest = target.value
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
    }
  }

  private readonly handleChange = (event: Event): void => {
    const target = event.target
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) {
      return
    }

    if (target instanceof HTMLInputElement && target.dataset.importInput) {
      const file = target.files?.[0]
      if (!file) {
        return
      }

      void this.importFile(file)
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
            <section class="panel-shell top-panel" data-top-panel>
              <div class="top-panel-header">
                <div class="project-copy top-panel-copy">
                  <p class="eyebrow" data-app-eyebrow></p>
                  <div class="top-panel-title-row">
                    <h1 data-app-title></h1>
                    <p class="status-pill" data-app-status></p>
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
                  <input type="file" accept=".md,.markdown,.txt,text/plain,text/markdown" data-role="import-input" data-import-input hidden />
                </section>
              </div>
            </section>
          </header>

          <section class="workspace-panel">
            <div class="workspace-scroll" data-workspace-scroll>
              <div class="workspace-canvas" data-workspace-canvas>
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
    this.refs.topPanel.classList.toggle('is-collapsed', this.state.topPanelCollapsed)
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
    this.refs.nodeLayer.innerHTML = this.renderNodes()
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

    this.refs.overlayLayer.classList.toggle('is-visible', Boolean(marqueeMarkup || contextMenuMarkup))
    this.refs.overlayLayer.innerHTML = `${marqueeMarkup}${contextMenuMarkup}`
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
    const estimatedWidth = 236
    const estimatedHeight = 320
    const left = clamp(this.state.contextMenu.clientX - stageRect.left, 12, Math.max(12, stageRect.width - estimatedWidth - 12))
    const top = clamp(this.state.contextMenu.clientY - stageRect.top, 12, Math.max(12, stageRect.height - estimatedHeight - 12))
    const selectedIds = this.selectedNodeIds()
    const selectedCount = selectedIds.length
    const primaryNode = this.selectedNode()
    const primaryChildren = primaryNode ? childrenOf(this.state.document, primaryNode.id).length : 0
    const canUseSingleNodeActions = selectedCount === 1 && Boolean(primaryNode)
    const canDelete = selectedIds.some((nodeId) => this.findNode(nodeId)?.kind !== 'root')
    const heading = selectedCount > 1
      ? this.t('context.selectionCount', { value: selectedCount })
      : escapeHtml(primaryNode?.title ?? this.t('context.canvas'))

    return `
      <section class="context-menu" data-context-menu style="left: ${Math.round(left)}px; top: ${Math.round(top)}px;">
        <p class="section-label">${this.t(this.state.contextMenu.nodeId ? 'context.node' : 'context.canvas')}</p>
        <h3 class="context-menu-title">${heading}</h3>
        <button type="button" class="chip-button context-menu-button" data-command="new-child" ${canUseSingleNodeActions ? '' : 'disabled'}>${this.t('action.newChild')}</button>
        <button type="button" class="chip-button context-menu-button" data-command="new-sibling" ${canUseSingleNodeActions ? '' : 'disabled'}>${this.t('action.newSibling')}</button>
        <button type="button" class="chip-button context-menu-button" data-command="rename-selected" ${canUseSingleNodeActions ? '' : 'disabled'}>${this.t('action.rename')}</button>
        <button type="button" class="chip-button context-menu-button" data-command="toggle-collapse" ${canUseSingleNodeActions && primaryChildren > 0 ? '' : 'disabled'}>
          ${primaryNode?.collapsed ? this.t('action.expand') : this.t('action.collapse')}
        </button>
        <button type="button" class="chip-button context-menu-button" data-command="connect-selected" ${canUseSingleNodeActions ? '' : 'disabled'}>${this.t('action.linkRelation')}</button>
        <div class="context-menu-divider"></div>
        <button type="button" class="chip-button context-menu-button" data-command="set-priority:P0">${this.t('context.priorityP0')}</button>
        <button type="button" class="chip-button context-menu-button" data-command="set-priority:P1">${this.t('context.priorityP1')}</button>
        <button type="button" class="chip-button context-menu-button" data-command="set-priority:">${this.t('context.clearPriority')}</button>
        <button type="button" class="chip-button danger context-menu-button" data-command="delete-selected" ${canDelete ? '' : 'disabled'}>${this.t('action.delete')}</button>
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
            <p class="section-label">${this.t('ai.notes')}</p>
            <p class="inspector-copy">${this.t(noteTargets.mode === 'selection' ? 'ai.notesSelectionHint' : 'ai.notesAllHint', {
              value: noteTargets.nodes.length,
            })}</p>
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

  private renderAIRawEditor(field: 'generateRawRequest' | 'noteRawRequest' | 'relationRawRequest', value: string): string {
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
              <button type="button" class="chip-button" data-command="toggle-graph-autorotate">${this.t('graph.autoRotate', {
                value: this.state.graph.autoRotate ? this.t('common.on') : this.t('common.off'),
              })}</button>
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
    const projectPosition = (position: Position) => this.toWorkspacePosition(position)
    const hierarchyEdges = this.state.document.nodes
      .filter((node) => Boolean(node.parentId) && visibleIds.has(node.id) && visibleIds.has(node.parentId ?? ''))
      .map((node) => {
        const parent = this.findNode(node.parentId ?? '')
        if (!parent) {
          return ''
        }
        return `<path class="edge edge-hierarchy" d="${buildHierarchyPath(projectPosition(parent.position), projectPosition(node.position))}" />`
      })
      .join('')

    const relationEdges = this.state.document.relations
      .map((edge) => {
        const source = this.findNode(edge.sourceId)
        const target = this.findNode(edge.targetId)
        if (!source || !target || !visibleIds.has(source.id) || !visibleIds.has(target.id)) {
          return ''
        }

        const projectedSource = projectPosition(source.position)
        const projectedTarget = projectPosition(target.position)
        const mid = getRelationMidpoint(projectedSource, projectedTarget)
        const label = edge.label
          ? `<text class="relation-label" x="${mid.x}" y="${mid.y - 10}">${escapeHtml(edge.label)}</text>`
          : ''

        return `<g>
          <path class="edge edge-relation" d="${buildRelationPath(projectedSource, projectedTarget)}" />
          ${label}
        </g>`
      })
      .join('')

    return hierarchyEdges + relationEdges
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
        const classes = [
          'node-card',
          `node-${node.kind}`,
          nodeColor ? 'has-color' : '',
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
        const branchBadge = childCount > 0
          ? `<span class="node-branch-badge">${node.collapsed ? `+${hiddenDescendantCount(this.state.document, node.id)}` : childCount}</span>`
          : ''

        const nodeDimensions = buildNodeDimensionStyle(node)
        const nodePresentationStyle = buildNodeColorStyle(nodeColor)

        const content = this.state.editingNodeId === node.id
          ? `<input class="node-editor" type="text" style="${nodeDimensions}" data-node-editor="${node.id}" value="${escapeAttribute(node.title)}" maxlength="120" />`
          : `<button type="button" class="node-shell" style="${nodeDimensions}" data-node-button="${node.id}">
               ${priorityBadge}
               <span class="node-title" data-node-title="${node.id}">${escapeHtml(nodeVisibleTitle(node))}</span>
               ${branchBadge}
             </button>`

        const resizeHandle = node.kind !== 'root'
          ? `<button type="button" class="node-resizer" data-node-resizer="${node.id}" aria-label="Resize node"></button>`
          : ''

        return `
          <article
            class="${classes}"
            data-node-id="${node.id}"
            style="left: ${node.position.x + originX}px; top: ${node.position.y + originY}px; ${nodePresentationStyle}"
          >
            ${content}
            ${resizeHandle}
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

  private focusEditorIfNeeded(): void {
    if (!this.state.editingNodeId || this.overlayBlocksCanvas()) {
      return
    }

    const editor = this.rootEl.querySelector<HTMLInputElement>(`[data-node-editor="${this.state.editingNodeId}"]`)
    if (!editor) {
      return
    }

    const pendingOptions = this.pendingEditorOptions
    this.pendingEditorOptions = null
    queueMicrotask(() => {
      if (pendingOptions?.value !== undefined && pendingOptions.value !== null) {
        editor.value = pendingOptions.value
      }
      this.restoreEditorSelection(editor, pendingOptions)
      window.setTimeout(() => {
        this.restoreEditorSelection(editor, pendingOptions)
      }, 0)
    })
  }

  private restoreEditorSelection(editor: HTMLInputElement, options: EditorLaunchOptions | null | undefined, attempt = 0): void {
    if (!editor.isConnected || this.state.editingNodeId !== editor.dataset.nodeEditor) {
      return
    }

    try {
      editor.focus({ preventScroll: true })
    } catch {
      editor.focus()
    }

    const selectionMode = options?.selection ?? 'all'
    editor.classList.toggle('is-all-selected', selectionMode === 'all')
    if (selectionMode === 'end') {
      const cursor = editor.value.length
      editor.setSelectionRange(cursor, cursor)
    } else {
      editor.select()
      editor.setSelectionRange(0, editor.value.length)
    }

    if (this.editorSelectionSettled(editor, selectionMode) || attempt >= 4) {
      return
    }

    window.requestAnimationFrame(() => {
      this.restoreEditorSelection(editor, options, attempt + 1)
    })
  }

  private editorSelectionSettled(editor: HTMLInputElement, selectionMode: NonNullable<EditorLaunchOptions['selection']> | 'all'): boolean {
    if (document.activeElement !== editor) {
      return false
    }

    const selectionStart = editor.selectionStart ?? -1
    const selectionEnd = editor.selectionEnd ?? -1
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

  private setSelection(nodeIds: string[], primaryNodeId: string | null = nodeIds[nodeIds.length - 1] ?? null): void {
    const normalizedIds = nodeIds.filter((nodeId, index) => {
      return nodeIds.indexOf(nodeId) === index && Boolean(this.findNode(nodeId))
    })
    const nextIds = normalizedIds
    const nextPrimary = primaryNodeId && nextIds.includes(primaryNodeId) ? primaryNodeId : nextIds[nextIds.length - 1] ?? null

    this.state.selectedNodeIds = nextIds
    this.state.selectedNodeId = nextPrimary
    this.state.editingNodeId = null
    this.pendingEditorOptions = null
  }

  private clearSelection(): void {
    if (this.state.selectedNodeIds.length === 0 && this.state.selectedNodeId === null) {
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

    const anchor = nextChildPosition(this.state.document, targetNode.id)
    const insertedNodes: MindNode[] = []

    for (const snapshot of this.copiedSubtree.nodes) {
      const nextId = createId('node')
      idMap.set(snapshot.id, nextId)
      const isClipboardRoot = snapshot.id === this.copiedSubtree.rootId
      const parentId = isClipboardRoot ? targetNode.id : snapshot.parentId ? idMap.get(snapshot.parentId) : targetNode.id
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
      position: nextChildPosition(this.state.document, parentId),
      title: this.t('node.newChild'),
      color: normalizeNodeColor(parent.color) || undefined,
    })

    this.state.document.nodes.push(newNode)
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
        position: nextSiblingPosition(this.state.document, node),
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

    const fallbackNodeId = primaryNode?.parentId && !removeIds.has(primaryNode.parentId) ? primaryNode.parentId : findRoot(this.state.document).id
    const relationCountBefore = this.state.document.relations.length
    const nodeCountBefore = this.state.document.nodes.length

    this.captureHistory()
    this.state.document.nodes = this.state.document.nodes.filter((node) => !removeIds.has(node.id))
    this.state.document.relations = this.state.document.relations.filter((relation) => !removeIds.has(relation.sourceId) && !removeIds.has(relation.targetId))

    const removedNodes = nodeCountBefore - this.state.document.nodes.length
    const removedRelations = relationCountBefore - this.state.document.relations.length
    if (removedNodes === 0) {
      return
    }

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
    this.state.editingNodeId = nodeId
    this.pendingEditorOptions = options
    this.render()
  }

  private commitNodeEditor(nodeId: string, rawTitle: string): void {
    if (this.state.editingNodeId !== nodeId) {
      return
    }

    const title = rawTitle.trim() || this.t('node.untitled')
    const existingNode = this.findNode(nodeId)
    if (!existingNode) {
      this.state.editingNodeId = null
      this.render()
      return
    }

    if (existingNode.title === title) {
      this.state.editingNodeId = null
      this.render()
      return
    }

    this.captureHistory()
    this.updateNode(nodeId, (node) => {
      node.title = title
    })
    this.state.editingNodeId = null
    this.setSelection([nodeId], nodeId)
    touchDocument(this.state.document)
    this.setStatus('status.nodeTitleUpdated')
    this.render()
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

    if (childrenOf(this.state.document, selectedNode.id).length === 0) {
      this.setStatus('status.noBranchToCollapse')
      this.render()
      return
    }

    this.captureHistory()
    const changed = toggleCollapse(this.state.document, selectedNode.id)
    if (!changed) {
      this.setStatus('status.noBranchToCollapse')
      this.render()
      return
    }

    touchDocument(this.state.document)
    this.setStatus(selectedNode.collapsed ? 'status.branchCollapsed' : 'status.branchExpanded')
    this.render()
    this.scheduleAutosave('status.layoutSaveScheduled')
  }

  private autoLayout(): void {
    const snapshot = this.createHistorySnapshot()
    const movedNodes = autoLayoutHierarchy(this.state.document)
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
        case 'auto-layout':
          this.autoLayout()
          return
        case 'export-markdown':
          await this.exportMarkdown()
          return
        case 'import-file':
          this.refs?.importInput.click()
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
        case 'create-template-map':
          await this.createTemplateMap(normalizeAITemplateId(argument))
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

    this.pushHistorySnapshot(snapshot)
    touchDocument(this.state.document)
    this.setStatus('status.relationRemoved')
    this.render()
    this.scheduleAutosave('status.relationRemovalSaveScheduled')
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
    try {
      const savedDocument = await api.saveMap(this.state.document)
      this.state.document = savedDocument
      this.state.currentMapId = savedDocument.id
      await this.refreshMaps()
      this.setStatus(statusKey, values)
    } catch (error) {
      this.setStatus('status.saveFailed', { reason: getErrorMessage(error) })
    }

    this.applyTheme()
    this.render()
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

  private async importFile(file: File): Promise<void> {
    const extension = file.name.split('.').pop()?.toLowerCase()
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
      this.state.editingNodeId = null
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
    this.state.ai.open = false
    this.state.graph.open = false
    this.stopGraphAnimation()
    this.refs = null
    this.resetHistory()
    this.render()
  }

  private async renameMap(mapId: string): Promise<void> {
    const currentTitle = this.state.currentMapId === mapId ? this.state.document.title : this.findMapSummary(mapId)?.title ?? ''
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
    if (this.state.ai.busy) {
      return
    }

    const targets = this.resolveAINoteTargets()
    if (targets.nodes.length === 0) {
      this.setStatus('status.aiNoNoteTargets')
      this.render()
      return
    }

    this.state.ai.busy = true
    this.setStatus('status.aiRunning')
    this.renderHeader()
    this.renderAIWorkspace()

    try {
      const result = await api.completeNodeNotes({
        document: this.state.document,
        settings: this.state.preferences.ai,
        targetNodeIds: targets.nodes.map((node) => node.id),
        instructions: this.state.ai.noteInstructions,
        debug: this.buildAIDebugRequest(this.state.ai.noteRawRequest),
      })
      this.state.ai.lastSummary = result.summary
      this.state.ai.lastModel = result.model
      this.captureAIDebug('notes', result.debug)

      const nextNotes = result.notes.filter((item) => Boolean(this.findNode(item.id)) && item.note.trim() !== '')
      if (nextNotes.length === 0) {
        this.setStatus('status.aiNoNotes')
        return
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
          return
        }

        this.captureHistory()
        const createdIds: string[] = []
        for (const { parent, normalizedNote } of preparedChildren) {
          parent.collapsed = false
          parent.updatedAt = new Date().toISOString()
          const childNode = createNode({
            parentId: parent.id,
            kind: 'topic',
            position: nextChildPosition(this.state.document, parent.id),
            title: deriveNoteChildTitle(parent, normalizedNote, this.state.preferences.locale),
            color: normalizeNodeColor(parent.color) || undefined,
          })
          childNode.note = normalizedNote
          this.state.document.nodes.push(childNode)
          createdIds.push(childNode.id)
          appliedCount += 1
        }

        this.setSelection(createdIds, createdIds[0] ?? null)
      } else {
        const changes = nextNotes.filter((item) => normalizeNodeNote(this.findNode(item.id)?.note) !== normalizeNodeNote(item.note))
        if (changes.length === 0) {
          this.setStatus('status.aiNoNotes')
          return
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
    } catch (error) {
      const reason = getErrorMessage(error)
      this.captureAIDebug('notes', getAIDebugInfo(error), reason)
      this.setStatus('status.aiFailed', { reason })
    } finally {
      this.state.ai.busy = false
      this.render()
    }
  }

  private async applyAIRelations(): Promise<void> {
    if (this.state.ai.busy) {
      return
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
        return
      }

      this.captureHistory()
      const now = new Date().toISOString()
      const existingPairs = new Set(this.state.document.relations.map((relation) => normalizedRelationPairKey(relation.sourceId, relation.targetId)))
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
        return
      }

      touchDocument(this.state.document)
      this.setStatus('status.aiRelationsApplied', { count: added })
      this.render()
      this.scheduleAutosave('status.relationSaveScheduled')
    } catch (error) {
      const reason = getErrorMessage(error)
      this.captureAIDebug('relations', getAIDebugInfo(error), reason)
      this.setStatus('status.aiFailed', { reason })
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
    const topic = this.state.ai.topic.trim() || this.state.document.title.trim() || findRoot(this.state.document).title.trim()
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
    this.state.view = 'map'
    this.state.ai.open = false
    this.state.graph.open = false
    this.stopGraphAnimation()
    this.setSelection([findRoot(document).id], findRoot(document).id)
    this.state.editingNodeId = null
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

  private tryStartCanvasPan(event: PointerEvent, target: HTMLElement): void {
    const scroll = this.refs?.scroll
    if (!scroll) {
      return
    }

    const withinScroll = target.closest<HTMLElement>('[data-workspace-scroll]')
    if (!withinScroll) {
      return
    }

    this.pan = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startViewportX: this.viewport.x,
      startViewportY: this.viewport.y,
    }
    event.preventDefault()
    this.setCanvasPanning(true)
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

  private commitSettingField(field: string, value: string): void {
    switch (field) {
      case 'locale':
        this.setLocale(value === 'zh-CN' ? 'zh-CN' : 'en', true)
        return
      case 'theme':
        this.setTheme(value === 'light' ? 'light' : 'dark')
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

  private applyCanvasMetrics(bounds = getWorkspaceBounds(this.state.document), preserveViewportPosition = this.didInitializeViewport): void {
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
    this.state.connectSourceNodeId = snapshot.connectSourceNodeId && findNode(this.state.document, snapshot.connectSourceNodeId)
      ? snapshot.connectSourceNodeId
      : null
    this.state.editingNodeId = null
    this.state.drag = null
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
    const originChanged = bounds.originX !== this.workspaceBounds.originX || bounds.originY !== this.workspaceBounds.originY
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
    const selectionRect = normalizeClientRect(marquee.startClientX, marquee.startClientY, marquee.currentClientX, marquee.currentClientY)
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

    const atmosphere = context.createRadialGradient(width / 2, height * 0.56, 0, width / 2, height * 0.56, Math.max(width, height) * 0.58)
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
      context.strokeStyle = edge.type === 'relation' ? `rgba(253, 186, 116, ${edge.opacity})` : `rgba(147, 197, 253, ${edge.opacity})`
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
      context.save()
      context.beginPath()
      context.fillStyle = nodePalette ? rgbaFromRgb(nodePalette.plateRgb, node.occlusionOpacity) : `rgba(9, 14, 24, ${node.occlusionOpacity})`
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

function buildHierarchyPath(source: Position, target: Position): string {
  const controlOffset = Math.max(48, Math.abs(target.x - source.x) * 0.36)
  const movingRight = target.x >= source.x
  const controlX1 = movingRight ? source.x + controlOffset : source.x - controlOffset
  const controlX2 = movingRight ? target.x - controlOffset : target.x + controlOffset
  return `M ${source.x} ${source.y} C ${controlX1} ${source.y}, ${controlX2} ${target.y}, ${target.x} ${target.y}`
}

function buildRelationPath(source: Position, target: Position): string {
  const midpoint = getRelationMidpoint(source, target)
  return `M ${source.x} ${source.y} Q ${midpoint.x} ${midpoint.y} ${target.x} ${target.y}`
}

function getRelationMidpoint(source: Position, target: Position): Position {
  return {
    x: (source.x + target.x) / 2,
    y: (source.y + target.y) / 2 - Math.max(60, Math.abs(target.x - source.x) * 0.08),
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function escapeAttribute(value: string): string {
  return escapeHtml(value)
}

function shorten(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`
}

function normalizeAITemplateId(value: string): AITemplateId {
  switch (value) {
    case 'project-planning':
      return 'project-planning'
    case 'character-network':
      return 'character-network'
    default:
      return 'concept-graph'
  }
}

function templateLabel(templateId: AITemplateId, locale: Locale): string {
  if (locale === 'zh-CN') {
    switch (templateId) {
      case 'project-planning':
        return '项目规划图谱'
      case 'character-network':
        return '人物关系图谱'
      default:
        return '概念知识图谱'
    }
  }

  switch (templateId) {
    case 'project-planning':
      return 'Project Planning Graph'
    case 'character-network':
      return 'Character Network'
    default:
      return 'Concept Graph'
  }
}

function promptTemplateCopy(templateId: AITemplateId, locale: Locale): string {
  if (locale === 'zh-CN') {
    switch (templateId) {
      case 'project-planning':
        return '模板提示词：围绕目标、范围、里程碑、风险、依赖、资源和成功指标，生成一个可直接用于执行沟通的项目脑图。'
      case 'character-network':
        return '模板提示词：围绕人物、阵营、动机、冲突、盟友、关键事件，生成一个便于阅读关系线的角色网络图。'
      default:
        return '模板提示词：围绕定义、核心概念、机制、应用、对比、风险和案例，生成一个高密度概念知识图谱。'
    }
  }

  switch (templateId) {
    case 'project-planning':
      return 'Template prompt: generate a project map around goals, scope, milestones, risks, dependencies, resources, and success metrics.'
    case 'character-network':
      return 'Template prompt: generate a character network around roles, factions, motivations, conflicts, alliances, and turning points.'
    default:
      return 'Template prompt: generate a concept graph around definition, components, mechanisms, applications, comparisons, risks, and examples.'
  }
}

function createTemplateDocument(templateId: AITemplateId, locale: Locale): MindMapDocument {
  const doc = createDefaultDocument()
  const root = findRoot(doc)
  const rootTitle =
    templateId === 'project-planning'
      ? locale === 'zh-CN'
        ? '项目规划模板'
        : 'Project Planning Template'
      : templateId === 'character-network'
        ? locale === 'zh-CN'
          ? '人物关系模板'
          : 'Character Network Template'
        : locale === 'zh-CN'
          ? '概念图谱模板'
          : 'Concept Graph Template'

  root.title = rootTitle
  doc.title = rootTitle

  const now = new Date().toISOString()
  const addNode = (title: string, x: number, y: number, parentId = 'root', priority: Priority = ''): string => {
    const node = createNode({
      title,
      position: { x, y },
      kind: parentId ? 'topic' : 'floating',
      parentId: parentId || undefined,
    })
    node.priority = priority
    node.createdAt = now
    node.updatedAt = now
    doc.nodes.push(node)
    return node.id
  }

  if (templateId === 'project-planning') {
    const goals = addNode(locale === 'zh-CN' ? '目标' : 'Goals', root.position.x + 280, root.position.y - 140, 'root', 'P1')
    const scope = addNode(locale === 'zh-CN' ? '范围' : 'Scope', root.position.x + 280, root.position.y - 20)
    const timeline = addNode(locale === 'zh-CN' ? '里程碑' : 'Milestones', root.position.x + 280, root.position.y + 120)
    const risks = addNode(locale === 'zh-CN' ? '风险' : 'Risks', root.position.x - 280, root.position.y - 90)
    const resources = addNode(locale === 'zh-CN' ? '资源' : 'Resources', root.position.x - 280, root.position.y + 70)
    const metrics = addNode(locale === 'zh-CN' ? '指标' : 'Metrics', root.position.x - 280, root.position.y + 190)
    addNode(locale === 'zh-CN' ? '验收标准' : 'Acceptance', root.position.x + 560, root.position.y - 140, goals)
    addNode(locale === 'zh-CN' ? '边界' : 'Boundaries', root.position.x + 560, root.position.y - 20, scope)
    addNode(locale === 'zh-CN' ? '关键日期' : 'Dates', root.position.x + 560, root.position.y + 120, timeline)
    addNode(locale === 'zh-CN' ? '依赖' : 'Dependencies', root.position.x - 560, root.position.y - 120, risks)
    addNode(locale === 'zh-CN' ? '预算' : 'Budget', root.position.x - 560, root.position.y + 30, resources)
    addNode(locale === 'zh-CN' ? '复盘' : 'Review', root.position.x - 560, root.position.y + 210, metrics)
    doc.relations.push(createTemplateRelation(scope, timeline, locale === 'zh-CN' ? '影响排期' : 'affects timeline'))
    doc.relations.push(createTemplateRelation(resources, risks, locale === 'zh-CN' ? '缓解' : 'mitigates'))
  } else if (templateId === 'character-network') {
    const roles = addNode(locale === 'zh-CN' ? '主要角色' : 'Main Roles', root.position.x + 280, root.position.y - 130)
    const factions = addNode(locale === 'zh-CN' ? '阵营' : 'Factions', root.position.x + 280, root.position.y + 20)
    const motives = addNode(locale === 'zh-CN' ? '动机' : 'Motivations', root.position.x - 280, root.position.y - 70)
    const conflicts = addNode(locale === 'zh-CN' ? '冲突' : 'Conflicts', root.position.x - 280, root.position.y + 120, 'root', 'P1')
    const hero = addNode(locale === 'zh-CN' ? '主角' : 'Protagonist', root.position.x + 560, root.position.y - 180, roles)
    const rival = addNode(locale === 'zh-CN' ? '对手' : 'Rival', root.position.x + 560, root.position.y - 70, roles)
    const guild = addNode(locale === 'zh-CN' ? '公会' : 'Guild', root.position.x + 560, root.position.y + 20, factions)
    const empire = addNode(locale === 'zh-CN' ? '帝国' : 'Empire', root.position.x + 560, root.position.y + 120, factions)
    const freedom = addNode(locale === 'zh-CN' ? '自由' : 'Freedom', root.position.x - 560, root.position.y - 90, motives)
    const revenge = addNode(locale === 'zh-CN' ? '复仇' : 'Revenge', root.position.x - 560, root.position.y + 10, motives)
    const betrayal = addNode(locale === 'zh-CN' ? '背叛' : 'Betrayal', root.position.x - 560, root.position.y + 120, conflicts)
    doc.relations.push(createTemplateRelation(hero, rival, locale === 'zh-CN' ? '宿敌' : 'rivals'))
    doc.relations.push(createTemplateRelation(guild, freedom, locale === 'zh-CN' ? '推动' : 'drives'))
    doc.relations.push(createTemplateRelation(empire, betrayal, locale === 'zh-CN' ? '诱发' : 'triggers'))
    doc.relations.push(createTemplateRelation(revenge, rival, locale === 'zh-CN' ? '针对' : 'targets'))
  } else {
    const definition = addNode(locale === 'zh-CN' ? '定义' : 'Definition', root.position.x + 280, root.position.y - 150, 'root', 'P1')
    const concepts = addNode(locale === 'zh-CN' ? '核心概念' : 'Core Concepts', root.position.x + 280, root.position.y - 10)
    const workflow = addNode(locale === 'zh-CN' ? '工作流' : 'Workflow', root.position.x + 280, root.position.y + 130)
    const applications = addNode(locale === 'zh-CN' ? '应用场景' : 'Use Cases', root.position.x - 280, root.position.y - 100)
    const tradeoffs = addNode(locale === 'zh-CN' ? '权衡' : 'Tradeoffs', root.position.x - 280, root.position.y + 40)
    const examples = addNode(locale === 'zh-CN' ? '案例' : 'Examples', root.position.x - 280, root.position.y + 180)
    const ontology = addNode(locale === 'zh-CN' ? '本体' : 'Ontology', root.position.x + 560, root.position.y - 60, concepts)
    const entities = addNode(locale === 'zh-CN' ? '实体与关系' : 'Entities & Edges', root.position.x + 560, root.position.y + 20, concepts)
    const pipeline = addNode(locale === 'zh-CN' ? '采集到推理' : 'Ingest to Reasoning', root.position.x + 560, root.position.y + 130, workflow)
    const recommendation = addNode(locale === 'zh-CN' ? '推荐系统' : 'Recommendation', root.position.x - 560, root.position.y - 120, applications)
    const quality = addNode(locale === 'zh-CN' ? '数据质量' : 'Data Quality', root.position.x - 560, root.position.y + 40, tradeoffs)
    const search = addNode(locale === 'zh-CN' ? '搜索增强' : 'Search Augment', root.position.x - 560, root.position.y + 180, examples)
    doc.relations.push(createTemplateRelation(ontology, quality, locale === 'zh-CN' ? '依赖一致性' : 'needs consistency'))
    doc.relations.push(createTemplateRelation(recommendation, entities, locale === 'zh-CN' ? '使用' : 'uses'))
    doc.relations.push(createTemplateRelation(search, pipeline, locale === 'zh-CN' ? '接入' : 'plugs into'))
    doc.relations.push(createTemplateRelation(definition, applications, locale === 'zh-CN' ? '落地到' : 'applies to'))
  }

  touchDocument(doc)
  return doc
}

function createTemplateRelation(sourceId: string, targetId: string, label: string): RelationEdge {
  const now = new Date().toISOString()
  return {
    id: createId('rel'),
    sourceId,
    targetId,
    label,
    createdAt: now,
    updatedAt: now,
  }
}

function normalizedRelationPairKey(left: string, right: string): string {
  return left < right ? `${left}::${right}` : `${right}::${left}`
}

function buildGraphFrame(
  document: MindMapDocument,
  width: number,
  height: number,
  rotation: number,
  tilt: number,
  graphZoom: number,
  searchQuery: string,
  selectedNodeId: string | null,
): {
  nodes: Array<{
    id: string
    x: number
    y: number
    radius: number
    label: string
    color: NodeColor
    opacity: number
    occlusionOpacity: number
    surfaceOpacity: number
    strokeOpacity: number
    textOpacity: number
    lineWidth: number
    fontSize: number
    glow: number
    selected: boolean
    highlighted: boolean
  }>
  edges: Array<{ x1: number; y1: number; x2: number; y2: number; opacity: number; lineWidth: number; type: 'hierarchy' | 'relation' }>
  hitNodes: GraphHitNode[]
} {
  const root = findRoot(document)
  const query = searchQuery.trim().toLowerCase()
  const centerX = width / 2
  const centerY = height / 2 + height * 0.04
  const cameraDistance = Math.max(880, Math.min(width, height) * 1.68)
  const minScale = 0.58
  const maxScale = 1.74
  const nodeById = new Map(document.nodes.map((node) => [node.id, node] as const))
  const childrenByParent = new Map<string, MindNode[]>()
  const siblingPlacement = new Map<string, { centeredIndex: number; count: number }>()
  let maxAbsOffsetX = 1
  let maxAbsOffsetY = 1

  for (const node of document.nodes) {
    maxAbsOffsetX = Math.max(maxAbsOffsetX, Math.abs(node.position.x - root.position.x))
    maxAbsOffsetY = Math.max(maxAbsOffsetY, Math.abs(node.position.y - root.position.y))
    if (!node.parentId) {
      continue
    }

    const siblings = childrenByParent.get(node.parentId) ?? []
    siblings.push(node)
    childrenByParent.set(node.parentId, siblings)
  }

  for (const siblings of childrenByParent.values()) {
    const orderedSiblings = [...siblings].sort((left, right) => {
      return left.position.y - right.position.y || left.position.x - right.position.x || left.title.localeCompare(right.title)
    })
    const midpoint = (orderedSiblings.length - 1) / 2
    orderedSiblings.forEach((sibling, index) => {
      siblingPlacement.set(sibling.id, {
        centeredIndex: index - midpoint,
        count: orderedSiblings.length,
      })
    })
  }

  const planeScale = clamp(
    Math.min((width * 0.34) / maxAbsOffsetX, (height * 0.28) / maxAbsOffsetY),
    0.12,
    0.72,
  ) * graphZoom
  const depthSpread = clamp(0.9 + (graphZoom - 1) * 0.38, 0.72, 1.34)
  const base3dById = new Map<string, { x: number; y: number; z: number }>()
  const projected = new Map<
    string,
    {
      id: string
      x: number
      y: number
      radius: number
      depth: number
      z: number
      scale: number
      color: NodeColor
      opacity: number
      occlusionOpacity: number
      surfaceOpacity: number
      strokeOpacity: number
      textOpacity: number
      lineWidth: number
      fontSize: number
      glow: number
      selected: boolean
      highlighted: boolean
      label: string
    }
  >()

  const nodesByDepth = [...document.nodes].sort((left, right) => {
    return (
      graphNodeDepth(document, left) - graphNodeDepth(document, right) ||
      left.position.y - right.position.y ||
      left.position.x - right.position.x ||
      left.title.localeCompare(right.title)
    )
  })

  nodesByDepth.forEach((node) => {
    const depth = graphNodeDepth(document, node)
    const relationCount = connectedRelations(document, node.id).length
    const siblingMeta = siblingPlacement.get(node.id)
    const siblingOffset = siblingMeta?.centeredIndex ?? 0
    let baseX = 0
    let baseY = 0
    let baseZ = 0

    if (node.id === root.id) {
      baseZ = -26 * depthSpread
    } else {
      const parent = node.parentId ? nodeById.get(node.parentId) : undefined
      if (parent) {
        const parentBase = base3dById.get(parent.id) ?? { x: 0, y: 0, z: 0 }
        const rawDx = (node.position.x - parent.position.x) * planeScale
        const rawDy = (node.position.y - parent.position.y) * planeScale
        const branchDistance = Math.hypot(rawDx, rawDy)
        const branchAngle = Math.atan2(rawDy || 0.001, rawDx || 1)
        const lateralSpacing = clamp(branchDistance * 0.16, 10, 26)
        const crossX = -Math.sin(branchAngle)
        const crossY = Math.cos(branchAngle)

        baseX = parentBase.x + rawDx + crossX * siblingOffset * lateralSpacing * 0.28
        baseY = parentBase.y + rawDy + crossY * siblingOffset * lateralSpacing * 0.22
        baseZ = parentBase.z + (clamp(branchDistance * 0.22 + depth * 3.5, 18, 52) + siblingOffset * 8 + relationCount * 4) * depthSpread
      } else {
        const rawDx = (node.position.x - root.position.x) * planeScale
        const rawDy = (node.position.y - root.position.y) * planeScale
        const radialDistance = Math.hypot(rawDx, rawDy)
        const branchAngle = Math.atan2(rawDy || 0.001, rawDx || 1)

        baseX = rawDx
        baseY = rawDy
        baseZ = (clamp(radialDistance * 0.18 + depth * 18, 12, 72) + Math.sin(branchAngle) * 8) * depthSpread
      }
    }

    base3dById.set(node.id, {
      x: baseX,
      y: baseY,
      z: baseZ,
    })

    const yawX = baseX * Math.cos(rotation) - baseZ * Math.sin(rotation)
    const yawZ = baseX * Math.sin(rotation) + baseZ * Math.cos(rotation)
    const pitchY = baseY * Math.cos(tilt) - yawZ * Math.sin(tilt)
    const pitchZ = baseY * Math.sin(tilt) + yawZ * Math.cos(tilt)
    const scale = clamp(cameraDistance / (cameraDistance + pitchZ), minScale, maxScale)
    const depthProgress = clamp((scale - minScale) / (maxScale - minScale), 0, 1)
    const x = centerX + yawX * scale
    const y = centerY + pitchY * scale - pitchZ * 0.08
    const radiusBase = clamp(11 + relationCount * 1.4 + (node.kind === 'root' ? 10 : 0), 11, 28)
    const radius = radiusBase * clamp(0.74 + depthProgress * 0.72, 0.74, 1.46)
    const selected = node.id === selectedNodeId
    const highlighted = selected || (query !== '' && node.title.toLowerCase().includes(query))
    const emphasisBoost = selected ? 0.2 : highlighted ? 0.1 : 0
    projected.set(node.id, {
      id: node.id,
      x,
      y,
      radius,
      depth,
      z: pitchZ,
      scale,
      color: normalizeNodeColor(node.color),
      opacity: clamp(0.2 + depthProgress * 0.78 + emphasisBoost, 0.2, 1),
      occlusionOpacity: clamp(0.9 + depthProgress * 0.08, 0.9, 0.98),
      surfaceOpacity: clamp(0.72 + depthProgress * 0.24 + emphasisBoost * 0.08, 0.72, 0.98),
      strokeOpacity: clamp(0.28 + depthProgress * 0.48 + emphasisBoost * 0.18, 0.28, 0.96),
      textOpacity: clamp(0.56 + depthProgress * 0.36 + emphasisBoost * 0.12, 0.56, 1),
      lineWidth: clamp(1 + depthProgress * 1.6 + (selected ? 0.45 : 0), 1, 3.05),
      fontSize: clamp((selected ? 15 : highlighted ? 13 : 12) + depthProgress * 3, 12, 18),
      glow: clamp(8 + depthProgress * 14 + (selected ? 8 : highlighted ? 4 : 0), 8, 30),
      selected,
      highlighted,
      label: shorten(node.title, selected ? 18 : highlighted ? 12 : 6),
    })
  })

  const edges: Array<{ x1: number; y1: number; x2: number; y2: number; opacity: number; lineWidth: number; type: 'hierarchy' | 'relation' }> = []
  for (const node of document.nodes) {
    if (!node.parentId) {
      continue
    }

    const source = projected.get(node.parentId)
    const target = projected.get(node.id)
    if (!source || !target) {
      continue
    }

    const trimmed = trimGraphEdge(source, target)
    edges.push({
      x1: trimmed.x1,
      y1: trimmed.y1,
      x2: trimmed.x2,
      y2: trimmed.y2,
      opacity: clamp((source.opacity + target.opacity) / 2 * 0.6, 0.1, 0.76),
      lineWidth: clamp((source.lineWidth + target.lineWidth) / 2 * 0.72, 0.9, 2.2),
      type: 'hierarchy',
    })
  }

  for (const relation of document.relations) {
    const source = projected.get(relation.sourceId)
    const target = projected.get(relation.targetId)
    if (!source || !target) {
      continue
    }

    const trimmed = trimGraphEdge(source, target)
    edges.push({
      x1: trimmed.x1,
      y1: trimmed.y1,
      x2: trimmed.x2,
      y2: trimmed.y2,
      opacity: clamp((source.opacity + target.opacity) / 2 * 0.7, 0.12, 0.88),
      lineWidth: clamp((source.lineWidth + target.lineWidth) / 2 * 0.9, 1, 2.6),
      type: 'relation',
    })
  }

  const nodes = [...projected.values()].sort((left, right) => right.z - left.z || left.depth - right.depth)
  return {
    nodes,
    edges,
    hitNodes: [...nodes].reverse().map((node) => ({
      id: node.id,
      x: node.x,
      y: node.y,
      radius: node.radius,
    })),
  }
}

function trimGraphEdge(
  source: { x: number; y: number; radius: number; lineWidth: number },
  target: { x: number; y: number; radius: number; lineWidth: number },
): { x1: number; y1: number; x2: number; y2: number } {
  const dx = target.x - source.x
  const dy = target.y - source.y
  const distance = Math.hypot(dx, dy)
  if (distance < 0.0001) {
    return {
      x1: source.x,
      y1: source.y,
      x2: target.x,
      y2: target.y,
    }
  }

  const unitX = dx / distance
  const unitY = dy / distance
  const sourcePadding = source.radius + Math.max(4.5, source.lineWidth * 1.5)
  const targetPadding = target.radius + Math.max(4.5, target.lineWidth * 1.5)
  const safeDistance = Math.max(distance - sourcePadding - targetPadding, 0)
  return {
    x1: source.x + unitX * sourcePadding,
    y1: source.y + unitY * sourcePadding,
    x2: source.x + unitX * (sourcePadding + safeDistance),
    y2: source.y + unitY * (sourcePadding + safeDistance),
  }
}

function traceRoundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const safeRadius = Math.min(radius, width / 2, height / 2)
  context.moveTo(x + safeRadius, y)
  context.lineTo(x + width - safeRadius, y)
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius)
  context.lineTo(x + width, y + height - safeRadius)
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height)
  context.lineTo(x + safeRadius, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius)
  context.lineTo(x, y + safeRadius)
  context.quadraticCurveTo(x, y, x + safeRadius, y)
}

function graphNodeDepth(document: MindMapDocument, node: MindNode): number {
  let depth = 0
  let current = node
  while (current.parentId) {
    const parent = findNode(document, current.parentId)
    if (!parent) {
      break
    }
    depth += 1
    current = parent
  }
  return depth
}

function buildNodeDimensionStyle(node: MindNode): string {
  const styles: string[] = []
  if (node.width) {
    styles.push(`width: ${Math.max(node.width, MIN_NODE_WIDTH)}px;`)
    styles.push('max-width: none;')
  }
  if (node.height) {
    styles.push(`height: ${Math.max(node.height, MIN_NODE_HEIGHT)}px;`)
  }
  return styles.join(' ')
}

function nodeVisibleTitle(node: MindNode): string {
  if (node.width || node.height) {
    return node.title
  }

  return shorten(node.title, node.kind === 'root' ? 60 : 72)
}

function buildNodeColorStyle(color: NodeColor): string {
  const palette = resolveNodeColorPalette(color)
  if (!palette) {
    return ''
  }

  return `--node-color: ${palette.accent}; --node-color-text-override: ${palette.text};`
}

function normalizeNodeColor(value: string | null | undefined): NodeColor {
  return NODE_COLOR_VALUES.includes(value as NodeColor) ? (value as NodeColor) : ''
}

function normalizeNodeNote(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.replace(/\r\n/g, '\n').trim()
  return normalized ? normalized : undefined
}

function deriveNoteChildTitle(parent: MindNode, note: string, locale: Locale): string {
  const normalized = note.replace(/\s+/g, ' ').trim()
  const firstChunk = normalized.split(/(?<=[。！？.!?])\s+|\n+/).find((item) => item.trim().length > 0) ?? normalized
  const maxLength = locale === 'zh-CN' ? 18 : 28
  const compact = shorten(firstChunk.trim(), maxLength)

  if (compact.length >= (locale === 'zh-CN' ? 6 : 10)) {
    return compact
  }

  return locale === 'zh-CN' ? `${parent.title} 注释` : `${parent.title} Note`
}

function resolveNodeColorPalette(color: NodeColor): NodeColorPalette | null {
  return color ? NODE_COLOR_PALETTES[color] : null
}

function rgbaFromRgb(rgb: [number, number, number], alpha: number): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${clamp(alpha, 0, 1)})`
}

function applyAlphaToHex(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex)
  return rgbaFromRgb(rgb ?? [241, 245, 249], alpha)
}

function hexToRgb(hex: string): [number, number, number] | null {
  const normalized = hex.trim().replace('#', '')
  const expanded = normalized.length === 3 ? normalized.split('').map((value) => `${value}${value}`).join('') : normalized
  if (expanded.length !== 6) {
    return null
  }

  const value = Number.parseInt(expanded, 16)
  if (Number.isNaN(value)) {
    return null
  }

  return [
    (value >> 16) & 0xff,
    (value >> 8) & 0xff,
    value & 0xff,
  ]
}

function formatRelativeTime(value: string, locale: Locale): string {
  const targetTime = Date.parse(value)
  if (Number.isNaN(targetTime)) {
    return value
  }

  const diffMinutes = Math.round((targetTime - Date.now()) / (60 * 1000))
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const absMinutes = Math.abs(diffMinutes)

  if (absMinutes < 60) {
    return formatter.format(diffMinutes, 'minute')
  }

  const diffHours = Math.round(diffMinutes / 60)
  if (Math.abs(diffHours) < 24) {
    return formatter.format(diffHours, 'hour')
  }

  const diffDays = Math.round(diffHours / 24)
  if (Math.abs(diffDays) < 30) {
    return formatter.format(diffDays, 'day')
  }

  const diffMonths = Math.round(diffDays / 30)
  if (Math.abs(diffMonths) < 12) {
    return formatter.format(diffMonths, 'month')
  }

  const diffYears = Math.round(diffDays / 365)
  return formatter.format(diffYears, 'year')
}

function clampMin(value: number, min: number): number {
  return Math.max(value, min)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function getWorkspaceBounds(document: MindMapDocument): WorkspaceBounds {
  let minX = 0
  let minY = 0
  let maxX = WORKSPACE_MIN_WIDTH
  let maxY = WORKSPACE_MIN_HEIGHT

  for (const node of document.nodes) {
    const nodeWidth = node.width ?? estimateNodeWidth(node)
    const nodeHeight = node.height ?? estimateNodeHeight(node)
    minX = Math.min(minX, node.position.x - nodeWidth / 2 - WORKSPACE_PADDING)
    minY = Math.min(minY, node.position.y - nodeHeight / 2 - WORKSPACE_PADDING)
    maxX = Math.max(maxX, node.position.x + nodeWidth / 2 + WORKSPACE_PADDING)
    maxY = Math.max(maxY, node.position.y + nodeHeight / 2 + WORKSPACE_PADDING)
  }

  const width = Math.max(WORKSPACE_MIN_WIDTH, Math.ceil(maxX - minX))
  const height = Math.max(WORKSPACE_MIN_HEIGHT, Math.ceil(maxY - minY))
  return {
    minX,
    minY,
    width,
    height,
    originX: -minX,
    originY: -minY,
  }
}

function estimateNodeWidth(node: MindNode): number {
  if (node.kind === 'root') {
    return 220
  }
  return 196
}

function estimateNodeHeight(node: MindNode): number {
  if (node.kind === 'root') {
    return 64
  }
  return MIN_NODE_HEIGHT
}

function nodeCenter(node: MindNode): Position {
  const width = node.width ?? estimateNodeWidth(node)
  const height = node.height ?? estimateNodeHeight(node)
  return {
    x: node.position.x + width / 2,
    y: node.position.y + height / 2,
  }
}

function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function slugify(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')

  return normalized || 'code-mind'
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
}

function directionalPrimaryDelta(direction: string, deltaX: number, deltaY: number): number {
  if (direction === 'ArrowUp') {
    return -deltaY
  }
  if (direction === 'ArrowDown') {
    return deltaY
  }
  if (direction === 'ArrowLeft') {
    return -deltaX
  }
  return deltaX
}

function directionalCrossDelta(direction: string, deltaX: number, deltaY: number): number {
  if (direction === 'ArrowUp' || direction === 'ArrowDown') {
    return deltaX
  }
  return deltaY
}

function getAIDebugInfo(error: unknown): AIDebugInfo | undefined {
  if (!error || typeof error !== 'object' || !('debug' in error)) {
    return undefined
  }

  const candidate = (error as { debug?: Partial<AIDebugInfo> }).debug
  if (!candidate) {
    return undefined
  }

  return {
    rawMode: Boolean(candidate.rawMode),
    upstreamRequest: typeof candidate.upstreamRequest === 'string' ? candidate.upstreamRequest : '',
    upstreamResponse: typeof candidate.upstreamResponse === 'string' ? candidate.upstreamResponse : '',
    assistantContent: typeof candidate.assistantContent === 'string' ? candidate.assistantContent : '',
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return 'Unknown error'
}

function cloneDocument(document: MindMapDocument): MindMapDocument {
  return JSON.parse(JSON.stringify(document)) as MindMapDocument
}

function normalizeClientRect(startX: number, startY: number, endX: number, endY: number): DOMRect {
  const left = Math.min(startX, endX)
  const top = Math.min(startY, endY)
  const width = Math.abs(endX - startX)
  const height = Math.abs(endY - startY)
  return new DOMRect(left, top, width, height)
}

function rectanglesIntersect(left: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>, right: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>): boolean {
  return left.left <= right.right && left.right >= right.left && left.top <= right.bottom && left.bottom >= right.top
}

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector)
  if (!element) {
    throw new Error(`Missing required element: ${selector}`)
  }
  return element
}
