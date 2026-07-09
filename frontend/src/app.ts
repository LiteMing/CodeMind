import { api } from './api'
import * as commands from './interaction/commands'
import * as pointer from './interaction/pointer'
import * as keyboard from './interaction/keyboard'
import * as editor from './interaction/editor'
import * as ops from './state/ops'
import { renderHeader, renderWorkspace } from './render/shell'
import { renderGraphOverlay, drawGraphScene, updateGraphSummaryPanel } from './render/graph'
import { renderOverlay, renderOnboarding, renderToasts, renderCanvasGuide, updateCanvasGuide } from './render/overlay'
import { refreshMaps, scheduleAutosave } from './sync/api-sync'
import { persistGeneratedDocument } from './ai/actions'
import { MAX_ZOOM, MIN_ZOOM, PRIORITY_VALUES } from './app-types'
import { renderHome } from './render/home'
import { renderEdges } from './render/canvas'
import { renderSettings } from './render/settings'
import { renderInspector } from './render/inspector'
import { renderShortcutOverlay } from './render/shortcut-overlay'
import { renderAIWorkspace } from './render/ai-panel'
import { UxEngine, MinimapRenderer } from './ux-engine'
import type { MinimapNodeData } from './ux-engine'
import type {
  ActiveEditorPreviewState,
  ActorKind,
  ActorPresence,
  AIDebugAction,
  AppState,
  CopiedSubtree,
  DragState,
  EditorLaunchOptions,
  FixedMenuId,
  GraphDragState,
  HistorySnapshot,
  MidpointDragState,
  PanState,
  PendingImportMode,
  ShellRefs,
  ToastItem,
} from './app-types'
import { NODE_COLOR_VALUES, normalizeNodeColor, resolveNodeColorPalette } from './color-palette'
import {
  autoLayoutHierarchy,
  childrenOf,
  createDefaultDocument,
  findNode,
  findRoot,
  touchDocument,
  visibleNodeIds,
} from './document'
import { type NodeRenderMetrics, resolveRelationEdgeEndpoints, getRelationDefaultMidpoint } from './edge-geometry'
import { type GraphHitNode } from './graph-frame'
import { type TranslationKey, themeLabel, translate } from './i18n'
import { nodeVisibleTitle, MIN_NODE_WIDTH, MIN_NODE_HEIGHT } from './node-render'
import { estimateNodeHeight, estimateNodeWidth } from './node-sizing'
import { loadPreferences, savePreferences } from './preferences'
import { listLocalSnapshots, type LocalSnapshotSummary } from './snapshots'
import { promptTemplateCopy, createTemplateDocument } from './templates'
import type {
  AppPreferences,
  AITemplateId,
  ArrowDirection,
  CanvasDragAction,
  GestureAction,
  EdgeStyle,
  Locale,
  MindMapSummary,
  MindNode,
  NodeColor,
  Position,
  RegionBox,
  RelationEdge,
  Theme,
} from './types'
import {
  clamp,
  cloneDocument,
  getErrorMessage,
  getWorkspaceBounds,
  parsePixelValue,
  rectanglesOverlapCoords,
  requiredElement,
  type WorkspaceBounds,
  WORKSPACE_MIN_WIDTH,
  WORKSPACE_MIN_HEIGHT,
} from './utils'

const HISTORY_LIMIT = 120
const GRAPH_DEFAULT_ZOOM = 1.16
const GRAPH_MIN_ZOOM = 0.68
const GRAPH_MAX_ZOOM = 1.92
const NODE_GESTURE_MULTI_CLICK_DELAY_MS = 240
const IMPORT_FILE_ACCEPT =
  '.md,.markdown,.txt,.json,.csv,.tsv,.html,.htm,.xml,.opml,.mermaid,.mmd,.yaml,.yml,.toml,.ini,.cfg,.log,.rst,text/plain,text/markdown,application/json,text/csv,text/html,application/xml,text/xml'

export async function createApp(rootEl: HTMLElement): Promise<void> {
  const app = new MindMapApp(rootEl)
  await app.mount()
}

export class MindMapApp {
  readonly rootEl: HTMLElement
  autosaveHandle: number | null = null
  refs: ShellRefs | null = null
  pan: PanState | null = null
  graphDrag: GraphDragState | null = null
  didInitializeViewport = false
  viewport = { x: 0, y: 0, scale: 1 }
  historyPast: HistorySnapshot[] = []
  historyFuture: HistorySnapshot[] = []
  private liveCanvasHandle: number | null = null
  private liveNodeIds = new Set<string>()
  private liveNodeDimensionIds = new Set<string>()
  private graphAnimationHandle: number | null = null
  graphHitNodes: GraphHitNode[] = []
  // Node ids whose creation animation is still in flight (read by renderNodes)
  creatingNodeIds = new Set<string>()
  // Node id → stagger delay(ms) for the expand animation in flight (read by
  // renderNodes/renderEdges so the classes are present from the first paint)
  expandingNodeIds = new Map<string, number>()
  // Node id → stagger delay(ms) for the collapse animation in flight — same
  // state-driven contract as expandingNodeIds so intervening renders keep the
  // animation classes instead of wiping them (innerHTML rebuild)
  collapsingNodeIds = new Map<string, number>()
  // Toggled node id → in-flight collapse/expand finisher. toggleNodeCollapse
  // settles (clearTimeout + run) the previous animation before starting the
  // next one, so rapid re-toggles never double-fire deferred state flips.
  collapseToggleAnimations = new Map<string, { timer: number; settle: () => void }>()
  // Minimal actor presence (总计划 §2 actor 一等模型): actorId → who/kind and
  // which nodes they are currently writing. Ephemeral by design — lives only
  // here, never enters the document, snapshots or git. Today's only writer is
  // the built-in AI actor; multi-user presence (P3 SSE) adds map entries, not
  // new mechanisms.
  actorPresence = new Map<string, ActorPresence>()
  // Nodes the last finished AI action created/modified (node-ai-changed
  // highlight) — state-driven like creatingNodeIds so full re-renders keep it.
  aiChangedNodeIds = new Set<string>()
  private aiChangeClearHandle: number | null = null
  copiedSubtree: CopiedSubtree | null = null
  suppressContextMenuOnce = false
  suppressClickOnce = false
  private pendingNodeGestureHandle: number | null = null
  pendingNodeGestureNodeId: string | null = null
  longPressHandle: number | null = null
  longPressState: {
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
  pendingEditorOptions: EditorLaunchOptions | null = null
  activeEditorAnchorLeft: number | null = null
  activeEditorPreview: ActiveEditorPreviewState | null = null
  activeEditorLockedWidth: number | null = null
  editingOriginalTitle: string | null = null
  nodeEditorMeasureCanvas: HTMLCanvasElement | null = null
  pendingImportMode: PendingImportMode = 'auto'
  workspaceBounds: WorkspaceBounds = {
    minX: 0,
    minY: 0,
    width: WORKSPACE_MIN_WIDTH,
    height: WORKSPACE_MIN_HEIGHT,
    originX: 0,
    originY: 0,
  }
  collabApiKey = ''
  pollHandle: number | null = null
  lastKnownEditTime: string = ''
  lastFrontendSaveTime: string = ''
  inspectorDrag: { x: number; y: number; width: number; dragged: boolean } = {
    x: 0,
    y: 0,
    width: 340,
    dragged: false,
  }
  inspectorDragActive: {
    pointerId: number
    startX: number
    startY: number
    startLeft: number
    startTop: number
  } | null = null
  inspectorResizeActive: {
    pointerId: number
    startX: number
    startWidth: number
    rightEdge: number
  } | null = null
  private toastContainer: HTMLElement | null = null
  toastTimers: Map<string, number> = new Map()
  private toastIdCounter = 0
  /** Tracks which Inspector sections are collapsed (default: all collapsed) */
  inspectorSectionsCollapsed: Set<string> = new Set(['relations', 'snapshots', 'advanced'])
  state: AppState
  uxEngine: UxEngine
  private minimapRenderer: MinimapRenderer | null = null
  private minimapDragging = false

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
      regionResize: null,
      connectorDrag: null,
      parentConnectorDrag: null,
      midpointDrag: null,
      cutting: null,
      dirty: false,

      // UX Polish additions
      contextToolbar: {
        visible: false,
        nodeId: null,
        position: { x: 0, y: 0 },
        element: null,
      },
      toastQueue: [],
      guideOverlay: {
        canvasGuideVisible: false,
        canvasGuideDismissed: false,
        shortcutOverlayVisible: false,
      },
      panelAnimating: new Set<string>(),
    }

    this.applyLocale()
    this.applyTheme()
    this.bindEvents()

    this.uxEngine = new UxEngine((viewport) => {
      this.viewport.x = viewport.x
      this.viewport.y = viewport.y
      this.viewport.scale = viewport.scale
      this.applyCanvasMetrics()
      this.updateCanvasViewportView()
    })
  }

  async mount(): Promise<void> {
    const hasURLApiKey = this.loadApiKeyFromURL()
    if (!hasURLApiKey) {
      await this.loadCollabApiKey()
    }

    try {
      await refreshMaps(this, 'status.mapListLoaded')
    } catch (error) {
      this.setStatus('status.mapListFailed', { reason: getErrorMessage(error) })
    }

    this.render()
  }

  private loadApiKeyFromURL(): boolean {
    const apiKey = new URLSearchParams(window.location.search).get('vscodeApiKey')?.trim()
    if (!apiKey) {
      return false
    }
    this.collabApiKey = apiKey
    api.setOwnerApiKey(apiKey)
    document.cookie = `codemind_api_key=${encodeURIComponent(apiKey)}; Path=/; SameSite=Lax`
    window.history.replaceState({}, document.title, window.location.pathname + window.location.hash)
    return true
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
    window.addEventListener('pointerleave', this.handlePointerLeave)
    window.addEventListener('keydown', this.handleGlobalKeyDown)
    window.addEventListener('resize', this.handleWindowResize)
  }

  private readonly handleWindowResize = (): void => {
    this.syncFloatingLayout()
  }

  private readonly handlePointerLeave = (_event: PointerEvent): void => pointer.handlePointerLeave(this, _event)

  private readonly handleClick = (event: MouseEvent): void => commands.handleClick(this, event)

  private readonly handleContextMenu = (event: MouseEvent): void => commands.handleContextMenu(this, event)

  private readonly handleDoubleClick = (event: MouseEvent): void => commands.handleDoubleClick(this, event)

  private readonly handlePointerDown = (event: PointerEvent): void => pointer.handlePointerDown(this, event)

  private readonly handlePointerMove = (event: PointerEvent): void => pointer.handlePointerMove(this, event)

  resolveSnappedDragDelta(dragState: DragState, deltaX: number, deltaY: number): { deltaX: number; deltaY: number } {
    const draggedNodeIDs = new Set(dragState.nodeIds)
    return {
      deltaX: pointer.resolveDragAxisSnap(this, dragState, deltaX, 'x', draggedNodeIDs),
      deltaY: pointer.resolveDragAxisSnap(this, dragState, deltaY, 'y', draggedNodeIDs),
    }
  }

  private readonly handlePointerUp = (event: PointerEvent): void => pointer.handlePointerUp(this, event)

  private readonly handleWheel = (event: WheelEvent): void => pointer.handleWheel(this, event)

  readonly shortcutButtonMap: Record<string, keyof ShellRefs> = {
    'ctrl+s': 'saveButton',
    'ctrl+z': 'undoButton',
    'ctrl+y': 'redoButton',
    'ctrl+shift+z': 'redoButton',
    'ctrl+l': 'layoutButton',
    'ctrl+c': 'exportButton',
    'ctrl+v': 'importButton',
  }

  /** Flash the corresponding toolbar button for a keyboard shortcut (200ms highlight) */
  private readonly handleGlobalKeyDown = (event: KeyboardEvent): void => keyboard.handleGlobalKeyDown(this, event)

  private readonly handleEditorKeyDown = (event: KeyboardEvent): void => editor.handleEditorKeyDown(this, event)

  scheduleNodeGestureAction(nodeId: string, clientX: number, clientY: number): void {
    this.cancelPendingNodeGesture()
    this.pendingNodeGestureNodeId = nodeId
    this.pendingNodeGestureHandle = window.setTimeout(() => {
      const nextNodeId = this.pendingNodeGestureNodeId
      this.cancelPendingNodeGesture()
      if (!nextNodeId) {
        return
      }
      void commands.runNodeGestureAction(this, this.state.preferences.interaction.doubleClickAction, nextNodeId, {
        clientX,
        clientY,
      })
    }, NODE_GESTURE_MULTI_CLICK_DELAY_MS)
  }

  cancelPendingNodeGesture(): void {
    if (this.pendingNodeGestureHandle !== null) {
      window.clearTimeout(this.pendingNodeGestureHandle)
      this.pendingNodeGestureHandle = null
    }
    this.pendingNodeGestureNodeId = null
  }

  clearDropTargetHighlights(): void {
    const highlighted = this.rootEl.querySelectorAll<HTMLElement>('.drop-target-highlight')
    for (const el of highlighted) {
      el.classList.remove('drop-target-highlight')
    }
  }

  clearAlignmentGuides(): void {
    const guides = this.rootEl.querySelectorAll<HTMLElement>('[data-alignment-guide]')
    for (const el of guides) {
      el.remove()
    }
  }

  longPressActionForButton(button: number): GestureAction {
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

  canvasDragActionForButton(button: number): CanvasDragAction {
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

  startCuttingMode(pointerId: number, clientX: number, clientY: number): void {
    const canvasPoint = this.clientToCanvasPosition(clientX, clientY)
    this.state.cutting = {
      pointerId,
      startPoint: canvasPoint,
      currentPoint: canvasPoint,
      warningNodeIds: new Set(),
      warningHierarchyEdgeKeys: new Set(),
      warningRelationIds: new Set(),
    }
    this.refs?.scroll?.classList.add('is-cutting')
  }

  cancelCutting(): void {
    if (!this.state.cutting) {
      return
    }
    this.state.cutting = null
    this.refs?.scroll?.classList.remove('is-cutting')
    renderWorkspace(this)
  }

  clearNodeLongPress(): void {
    if (this.longPressHandle !== null) {
      window.clearTimeout(this.longPressHandle)
      this.longPressHandle = null
    }
    this.longPressState = null
  }

  nodeClientCenter(nodeId: string): { x: number; y: number } {
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

  private readonly handleFocusOut = (event: FocusEvent): void => commands.handleFocusOut(this, event)

  private readonly handleInput = (event: Event): void => commands.handleInput(this, event)

  private readonly handleChange = (event: Event): void => commands.handleChange(this, event)

  render(): void {
    this.flushLiveNodeUpdate()
    this.applyLocale()
    this.applyTheme()

    if (this.state.view === 'home') {
      renderHome(this)
      return
    }

    this.ensureShell()
    renderHeader(this)
    renderWorkspace(this)
    this.syncPresenceIndicator()
    renderInspector(this)
    this.syncInspectorNoteInputs()
    renderOverlay(this)
    renderSettings(this)
    renderAIWorkspace(this)
    renderGraphOverlay(this)
    renderOnboarding(this)
    updateCanvasGuide(this)
    renderCanvasGuide(this)
    this.initializeViewportIfNeeded()
    this.syncFloatingLayout()
    pointer.syncInspectorDrag(this)
    editor.focusEditorIfNeeded(this)
    this.updateContextToolbar()
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
                    <span class="save-indicator" data-save-indicator></span>
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
                  <button type="button" class="action-button" data-command="platform-help">平台</button>
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
            <div class="presence-indicator" data-presence-indicator hidden>
              <span class="presence-indicator-dot" aria-hidden="true"></span>
              <span data-presence-indicator-text></span>
            </div>
          </section>

          <aside class="inspector" data-inspector></aside>
          <div class="overlay-layer" data-overlay-layer></div>
          <div class="zoom-controls" data-zoom-controls>
            <button type="button" class="zoom-button" data-command="zoom-out" title="">−</button>
            <span class="zoom-level" data-zoom-level></span>
            <button type="button" class="zoom-button" data-command="zoom-in" title="">+</button>
            <button type="button" class="zoom-button" data-command="zoom-reset" title=""></button>
            <button type="button" class="zoom-button" data-command="zoom-fit" title=""></button>
          </div>
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
      saveIndicator: requiredElement(this.rootEl, '[data-save-indicator]'),
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
      zoomControls: requiredElement(this.rootEl, '[data-zoom-controls]'),
      zoomLevel: requiredElement(this.rootEl, '[data-zoom-level]'),
      aiLayer: requiredElement(this.rootEl, '[data-ai-layer]'),
      graphLayer: requiredElement(this.rootEl, '[data-graph-layer]'),
      presenceIndicator: requiredElement(this.rootEl, '[data-presence-indicator]'),
      presenceIndicatorText: requiredElement(this.rootEl, '[data-presence-indicator-text]'),
    }

    // Attach inspector drag/resize event listeners (stable element, only bound once)
    this.refs.inspector.addEventListener('pointerdown', this.handleInspectorPointerDown)
    this.refs.inspector.addEventListener('pointermove', this.handleInspectorPointerMove)
    this.refs.inspector.addEventListener('pointerup', this.handleInspectorPointerUp)
    this.refs.inspector.addEventListener('pointercancel', this.handleInspectorPointerUp)

    // Initialize minimap
    this.initMinimap()
  }

  toggleFixedMenu(menuId: FixedMenuId): void {
    if (this.state.preferences.appearance.chromeLayout !== 'fixed') {
      return
    }
    this.state.fixedMenu = this.state.fixedMenu === menuId ? '' : menuId
    renderHeader(this)
  }

  canSuggestSiblings(nodeId?: string): boolean {
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
    if (!this.inspectorDrag.dragged) {
      this.refs.inspector.style.top = `${nextTop}px`
    }
  }

  private readonly handleInspectorPointerDown = (event: PointerEvent): void =>
    pointer.handleInspectorPointerDown(this, event)

  private readonly handleInspectorPointerMove = (event: PointerEvent): void =>
    pointer.handleInspectorPointerMove(this, event)

  private readonly handleInspectorPointerUp = (event: PointerEvent): void =>
    pointer.handleInspectorPointerUp(this, event)

  syncContextMenuPosition(): void {
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

  resolveNodeRenderMetrics(node: MindNode, childCount: number): NodeRenderMetrics {
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

  currentSnapshotList(): LocalSnapshotSummary[] {
    if (!this.state.currentMapId) {
      return []
    }

    return listLocalSnapshots(this.state.currentMapId)
  }

  /** Renders snapshot section content without the wrapping <section> card (for collapsible Inspector sections) */
  private syncInspectorNoteInputs(): void {
    if (!this.refs) {
      return
    }

    for (const noteInput of this.refs.inspector.querySelectorAll<HTMLTextAreaElement>('[data-node-note]')) {
      this.syncInspectorNoteInputHeight(noteInput)
    }
  }

  syncInspectorNoteInputHeight(input: HTMLTextAreaElement): void {
    const computed = window.getComputedStyle(input)
    const minHeight = Math.max(124, parsePixelValue(computed.minHeight))
    const maxHeight = Math.max(minHeight, parsePixelValue(computed.maxHeight) || 320)

    input.style.height = 'auto'
    const nextHeight = clamp(input.scrollHeight, minHeight, maxHeight)
    input.style.height = `${nextHeight}px`
    input.style.overflowY = input.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }

  selectedNode(): MindNode | undefined {
    if (!this.state.selectedNodeId) {
      return undefined
    }

    return this.findNode(this.state.selectedNodeId)
  }

  selectedNodeIds(): string[] {
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

  setSelection(nodeIds: string[], primaryNodeId: string | null = nodeIds[nodeIds.length - 1] ?? null): void {
    editor.finishActiveNodeEditing(this)
    ops.applySelectionState(this, nodeIds, primaryNodeId)
    this.state.selectedRegionId = null
    editor.clearNodeEditorState(this)
  }

  selectRegion(regionId: string): void {
    editor.finishActiveNodeEditing(this)
    ops.applySelectionState(this, [], null)
    this.state.selectedRelationId = null
    this.state.selectedRegionId = regionId
    editor.clearNodeEditorState(this)
  }

  clearSelection(): void {
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

  selectNode(nodeId: string): void {
    if (this.state.connectSourceNodeId && this.state.connectSourceNodeId !== nodeId) {
      ops.createRelation(this, this.state.connectSourceNodeId, nodeId)
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

  applyNodeCreateAnimation(nodeId: string): void {
    // State-driven: renderNodes outputs .node-creating for ids in this set, so
    // the class survives the full innerHTML rebuilds that happen when nodes
    // are created in rapid succession. Must be called before render().
    this.creatingNodeIds.add(nodeId)
    window.setTimeout(() => {
      this.creatingNodeIds.delete(nodeId)
      this.rootEl.querySelector(`[data-node-id="${nodeId}"]`)?.classList.remove('node-creating')
    }, 320)
  }

  /** Upserts an actor's ephemeral presence. Callers render() afterwards so
   * renderNodes paints node-presence-<kind> on the focused nodes. */
  setActorPresence(actorId: string, kind: ActorKind, label: string, focusNodeIds: string[]): void {
    this.actorPresence.set(actorId, { kind, label, focusNodeIds: new Set(focusNodeIds) })
  }

  clearActorPresence(actorId: string): void {
    this.actorPresence.delete(actorId)
  }

  /** Convenience for the built-in AI actor: presence for the nodes an
   * in-flight AI request is about to write. Cleared in the action's finally. */
  beginAIWriting(nodeIds: string[]): void {
    this.setActorPresence('ai', 'agent', 'AI', nodeIds)
  }

  endAIWriting(): void {
    this.clearActorPresence('ai')
  }

  /** The presence kind touching a node, if any (read by renderNodes). Agents
   * win over humans when both hold the same node — the writer is the one the
   * reviewer needs to see. */
  presenceKindForNode(nodeId: string): ActorKind | null {
    let kind: ActorKind | null = null
    for (const presence of this.actorPresence.values()) {
      if (!presence.focusNodeIds.has(nodeId)) {
        continue
      }
      if (presence.kind === 'agent') {
        return 'agent'
      }
      kind = presence.kind
    }
    return kind
  }

  /** Canvas-corner "AI is writing…" chip, derived from agent presence (not
   * from state.ai.busy — busy is the request lifecycle, presence is the
   * display layer). Stable shell element toggled on every render path. */
  private syncPresenceIndicator(): void {
    if (!this.refs) {
      return
    }
    const writingAgents = [...this.actorPresence.values()].filter((presence) => presence.kind === 'agent')
    this.refs.presenceIndicator.hidden = writingAgents.length === 0
    this.refs.presenceIndicatorText.textContent = this.t('ai.pendingBadge')
  }

  /** Highlights what the AI just created/modified and pans the camera to the
   * first change. The highlight fades after a few seconds or on the next
   * canvas interaction — "AI 做完了但不知道改了哪" 的直接解法. */
  markAIChangedNodes(nodeIds: string[], centerNodeId = nodeIds[0] ?? null): void {
    if (this.aiChangeClearHandle !== null) {
      window.clearTimeout(this.aiChangeClearHandle)
      this.aiChangeClearHandle = null
    }
    this.clearAIChangeHighlights()
    for (const nodeId of nodeIds) {
      this.aiChangedNodeIds.add(nodeId)
    }
    if (this.aiChangedNodeIds.size === 0) {
      return
    }

    // Callers render() right after; center once the new layout is in the DOM.
    if (centerNodeId) {
      queueMicrotask(() => {
        this.centerViewportOnNode(centerNodeId)
      })
    }
    this.aiChangeClearHandle = window.setTimeout(() => {
      this.aiChangeClearHandle = null
      this.clearAIChangeHighlights()
    }, 8000)
  }

  /** Strips the AI change highlight without a full re-render (same DOM-surgery
   * pattern as applyNodeCreateAnimation's timeout). */
  clearAIChangeHighlights(): void {
    if (this.aiChangedNodeIds.size === 0) {
      return
    }
    this.aiChangedNodeIds.clear()
    this.rootEl.querySelectorAll('.node-ai-changed').forEach((element) => element.classList.remove('node-ai-changed'))
  }

  cycleSelectedNodePriority(): void {
    const node = this.selectedNode()
    if (!node) {
      return
    }

    const currentIndex = PRIORITY_VALUES.indexOf(node.priority || '')
    const nextIndex = (currentIndex + 1) % PRIORITY_VALUES.length
    ops.setPriority(this, PRIORITY_VALUES[nextIndex])
  }

  cycleSelectedNodeColor(): void {
    const node = this.selectedNode()
    if (!node) {
      return
    }

    const currentIndex = NODE_COLOR_VALUES.indexOf(normalizeNodeColor(node.color))
    const nextIndex = (currentIndex + 1) % NODE_COLOR_VALUES.length
    ops.setNodeColor(this, NODE_COLOR_VALUES[nextIndex])
  }

  updateNode(nodeId: string, updater: (node: MindNode) => void): void {
    const node = this.findNode(nodeId)
    if (!node) {
      return
    }

    updater(node)
    node.updatedAt = new Date().toISOString()
  }

  toggleSelectedCollapse(): void {
    const selectedNode = this.selectedNode()
    if (!selectedNode) {
      return
    }

    ops.toggleNodeCollapse(this, selectedNode.id)
  }

  relayoutHierarchyAfterInsert(insertedNode: MindNode): void {
    if (!insertedNode.parentId) {
      return
    }

    autoLayoutHierarchy(
      this.state.document,
      this.state.preferences.appearance.layoutMode,
      this.state.preferences.appearance.childGapX,
    )
  }

  deleteRegion(regionId: string): void {
    if (!this.state.document.regions) return
    ops.captureHistory(this)
    this.state.document.regions = this.state.document.regions.filter((r) => r.id !== regionId)
    touchDocument(this.state.document)
    this.setStatus('status.regionDeleted')
    this.render()
    scheduleAutosave(this, 'status.deletionSaveScheduled')
  }

  setRegionColor(regionId: string, color: NodeColor): void {
    if (!this.state.document.regions) return
    const region = this.state.document.regions.find((r) => r.id === regionId)
    if (!region) return
    ops.captureHistory(this)
    region.color = color || 'blue'
    region.updatedAt = new Date().toISOString()
    touchDocument(this.state.document)
    this.render()
    scheduleAutosave(this, 'status.colorSaveScheduled')
  }

  nodeOverlapsRegion(node: MindNode, region: RegionBox): boolean {
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

  nodesInRegion(region: RegionBox): MindNode[] {
    return this.state.document.nodes.filter((node) => this.nodeOverlapsRegion(node, region))
  }

  applyLiveRegionDrag(_region: RegionBox, _movedNodeIds: string[]): void {
    renderWorkspace(this)
  }

  setRelationArrowDirection(relationId: string, direction: ArrowDirection): void {
    const relation = this.state.document.relations.find((r) => r.id === relationId)
    if (!relation) return
    ops.captureHistory(this)
    relation.arrowDirection = direction
    relation.updatedAt = new Date().toISOString()
    touchDocument(this.state.document)
    this.setStatus('status.arrowDirectionChanged')
    this.render()
    scheduleAutosave(this, 'status.relationSaveScheduled')
  }

  // ---- Connection branching ----

  branchConnectionAtMidpoint(relationId: string): void {
    const relation = this.state.document.relations.find((r) => r.id === relationId)
    if (!relation) return
    this.state.selectedRelationId = relationId
    this.setStatus('status.connectionBranchMode')
    renderWorkspace(this)
  }

  clearMidpointDragLongPress(dragState: MidpointDragState | null): void {
    if (!dragState || dragState.longPressHandle === null) {
      return
    }
    window.clearTimeout(dragState.longPressHandle)
    dragState.longPressHandle = null
  }

  relationIncludesTarget(relation: RelationEdge, targetNodeId: string): boolean {
    if (relation.sourceId === targetNodeId || relation.targetId === targetNodeId) {
      return true
    }
    return (relation.branches ?? []).some((branch) => branch.targetId === targetNodeId)
  }

  moveRelationMidpoint(relation: RelationEdge, midpoint: Position): void {
    ops.captureHistory(this)
    relation.midpointOffset = midpoint
    relation.updatedAt = new Date().toISOString()
    touchDocument(this.state.document)
    renderWorkspace(this)
    scheduleAutosave(this, 'status.relationSaveScheduled')
  }

  resolveRelationMidpointPosition(relationId: string): Position | null {
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

  resolveRelationMidpointForEdge(
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

  clientToCanvas(clientX: number, clientY: number): Position | null {
    if (!this.refs) return null
    const scrollRect = this.refs.scroll.getBoundingClientRect()
    const scrollLeft = this.refs.scroll.scrollLeft
    const scrollTop = this.refs.scroll.scrollTop
    const canvasX = (clientX - scrollRect.left + scrollLeft - this.viewport.x) / this.viewport.scale
    const canvasY = (clientY - scrollRect.top + scrollTop - this.viewport.y) / this.viewport.scale
    return { x: canvasX, y: canvasY }
  }

  toggleTheme(): void {
    this.setTheme(this.state.document.theme === 'dark' ? 'light' : 'dark')
  }

  setTheme(theme: Theme): void {
    if (this.state.document.theme === theme) {
      return
    }

    ops.captureHistory(this)
    this.state.document.theme = theme
    touchDocument(this.state.document)
    this.applyTheme()
    this.setStatus('status.themeSwitched', { theme: themeLabel(this.state.preferences.locale, theme) })
    this.render()
    scheduleAutosave(this, 'status.themeSaveScheduled')
  }

  startRelationMode(): void {
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

  resolveSnapshotTitle(mode: 'manual' | 'auto', documentTitle = this.state.document.title): string {
    const draft = mode === 'manual' ? this.state.snapshotDraftName.trim() : ''
    if (draft) {
      return draft
    }

    const normalizedTitle = documentTitle.trim() || this.t('node.untitled')
    return mode === 'manual'
      ? this.t('snapshot.defaultManualName', { title: normalizedTitle })
      : this.t('snapshot.defaultAutoName', { title: normalizedTitle })
  }

  openGraphOverlay(): void {
    this.state.graph.open = true
    this.state.graph.selectedNodeId = this.state.graph.selectedNodeId ?? this.state.selectedNodeId
    this.state.ai.open = false
    this.setStatus('status.graphOpened')
    this.render()
  }

  closeGraphOverlay(): void {
    if (!this.state.graph.open) {
      return
    }

    this.state.graph.open = false
    this.stopGraphAnimation()
    this.setStatus('status.graphClosed')
    this.render()
  }

  toggleGraphAutoRotate(): void {
    this.state.graph.autoRotate = !this.state.graph.autoRotate
    this.syncGraphAnimation()
    this.setStatus(this.state.graph.autoRotate ? 'status.graphAutoRotateOn' : 'status.graphAutoRotateOff')
    this.render()
  }

  resetGraphView(): void {
    this.state.graph.rotation = 0.72
    this.state.graph.tilt = 0.18
    this.state.graph.zoom = GRAPH_DEFAULT_ZOOM
    drawGraphScene(this)
    this.setStatus('status.graphViewReset')
    renderHeader(this)
  }

  nudgeGraphZoom(direction: -1 | 1): void {
    const factor = direction > 0 ? 1.14 : 1 / 1.14
    this.setGraphZoom(this.state.graph.zoom * factor)
  }

  setGraphZoom(nextZoom: number): void {
    const clampedZoom = Math.round(clamp(nextZoom, GRAPH_MIN_ZOOM, GRAPH_MAX_ZOOM) * 100) / 100
    if (Math.abs(clampedZoom - this.state.graph.zoom) < 0.001) {
      return
    }

    this.state.graph.zoom = clampedZoom
    drawGraphScene(this)
  }

  storeCapturedRawRequest(action: AIDebugAction, rawRequest: string): void {
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

  async createTemplateMap(templateId: AITemplateId): Promise<void> {
    const templateDocument = createTemplateDocument(templateId, this.state.preferences.locale)
    await persistGeneratedDocument(this, templateDocument)
    this.state.ai.lastSummary = promptTemplateCopy(templateId, this.state.preferences.locale)
    this.state.ai.open = false
    this.setStatus('status.templateMapCreated', { title: templateDocument.title })
    this.render()
  }

  focusNodeFromGraph(nodeId: string): void {
    this.state.graph.selectedNodeId = nodeId
    this.state.graph.open = false
    this.stopGraphAnimation()
    this.setSelection([nodeId], nodeId)
    this.render()
    queueMicrotask(() => {
      this.centerViewportOnNode(nodeId)
    })
  }

  centerViewportOnNode(nodeId: string): void {
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

  collabApiKeyMasked(): string {
    if (!this.collabApiKey) {
      return this.t('settings.collabApiKeyEmpty')
    }
    const last4 = this.collabApiKey.slice(-4)
    return '•'.repeat(this.collabApiKey.length - 4) + last4
  }

  generateCollabApiKey(): void {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    this.collabApiKey = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    this.setStatus('settings.collabApiKeyGenerated')
    renderSettings(this)
  }

  async copyCollabApiKey(): Promise<void> {
    if (!this.collabApiKey) {
      return
    }
    try {
      await navigator.clipboard.writeText(this.collabApiKey)
      this.setStatus('settings.collabApiKeyCopied')
    } catch {
      // Clipboard API may fail in some environments; silently ignore.
    }
  }

  clearCollabApiKey(): void {
    this.collabApiKey = ''
    this.setStatus('settings.collabApiKeyCleared')
    renderSettings(this)
  }

  private async loadCollabApiKey(): Promise<void> {
    try {
      const settings = await api.getSettings()
      this.collabApiKey = settings.collabApiKey ?? ''
      api.setOwnerApiKey(this.collabApiKey)
    } catch {
      // If backend is unavailable, keep the key empty.
    }
  }

  showAPIToast(message: string): void {
    // Remove existing toast if any
    const existing = document.querySelector('.api-toast')
    if (existing) {
      existing.remove()
    }

    const toast = document.createElement('div')
    toast.className = 'api-toast'
    toast.textContent = message
    document.body.appendChild(toast)

    window.setTimeout(() => {
      toast.remove()
    }, 3000)
  }

  // === Toast Queue Manager ===

  ensureToastContainer(): HTMLElement {
    if (this.toastContainer && document.body.contains(this.toastContainer)) {
      return this.toastContainer
    }
    const container = document.createElement('div')
    container.className = 'toast-container'
    document.body.appendChild(container)
    this.toastContainer = container
    return container
  }

  showToast(message: string): void {
    const id = `toast-${++this.toastIdCounter}-${Date.now()}`
    const item: ToastItem = {
      id,
      message,
      createdAt: Date.now(),
      element: null,
    }

    this.state.toastQueue.push(item)
    renderToasts(this)
  }

  dismissToast(id: string): void {
    const item = this.state.toastQueue.find((t) => t.id === id)
    if (!item || !item.element) return

    // Clear auto-dismiss timer
    const timer = this.toastTimers.get(id)
    if (timer != null) {
      window.clearTimeout(timer)
      this.toastTimers.delete(id)
    }

    // Add leaving animation class
    item.element.classList.remove('toast-entering')
    item.element.classList.add('toast-leaving')

    // Remove after fade-out animation (200ms)
    const el = item.element
    const onAnimEnd = (): void => {
      el.remove()
      this.state.toastQueue = this.state.toastQueue.filter((t) => t.id !== id)
      renderToasts(this)
    }
    el.addEventListener('animationend', onAnimEnd, { once: true })
    // Safety timeout in case animationend doesn't fire
    window.setTimeout(onAnimEnd, 250)
  }

  setLocale(locale: Locale, announce: boolean): void {
    this.updatePreferences((preferences) => {
      preferences.locale = locale
    })
    this.applyLocale()
    if (announce) {
      this.setStatus('status.languageUpdated')
    }
    this.render()
  }

  toggleSettings(): void {
    if (this.state.settingsOpen) {
      this.closeSettings()
    } else {
      this.openSettings()
    }
  }

  private openSettings(): void {
    if (this.state.panelAnimating.has('settings')) {
      return
    }
    this.state.settingsOpen = true
    this.setStatus('status.settingsOpened')
    this.render()
    this.animatePanelIn('settings', this.refs?.settingsLayer?.querySelector('.settings-drawer') as HTMLElement | null)
  }

  toggleTopPanel(): void {
    this.state.topPanelCollapsed = !this.state.topPanelCollapsed
    this.setStatus(this.state.topPanelCollapsed ? 'status.topPanelClosed' : 'status.topPanelOpened')
    this.render()
  }

  toggleInspector(): void {
    if (this.state.panelAnimating.has('inspector')) {
      return
    }
    if (this.state.inspectorCollapsed) {
      this.state.inspectorCollapsed = false
      this.setStatus('status.panelOpened')
      this.render()
      this.animatePanelIn('inspector', this.refs?.inspector ?? null)
    } else {
      this.animatePanelOut('inspector', this.refs?.inspector ?? null, () => {
        this.state.inspectorCollapsed = true
        this.setStatus('status.panelClosed')
        this.render()
      })
    }
  }

  /** Toggle an Inspector section between collapsed and expanded */
  toggleInspectorSection(sectionId: string): void {
    if (!sectionId) return
    if (this.inspectorSectionsCollapsed.has(sectionId)) {
      this.inspectorSectionsCollapsed.delete(sectionId)
    } else {
      this.inspectorSectionsCollapsed.add(sectionId)
    }
    renderInspector(this)
  }

  /** Node note badge click: select the node, pop the Inspector note card open
   * and put the caret at the end of the note input. */
  openNodeNoteEditor(nodeId: string, attempt = 0): void {
    if (!this.findNode(nodeId)) {
      return
    }

    if (this.state.panelAnimating.has('inspector')) {
      // Panel open/close animation in flight (≤300ms incl. safety timeout).
      // Acting now would either race the close (focus lands, then the panel
      // unmounts) or double-animate. Retry until it settles, then take the
      // normal path below — the click never silently dies.
      if (attempt < 8) {
        window.setTimeout(() => this.openNodeNoteEditor(nodeId, attempt + 1), 60)
      }
      return
    }

    this.state.selectedRelationId = null
    this.setSelection([nodeId], nodeId)
    this.inspectorSectionsCollapsed.delete('node')
    const opening = this.state.inspectorCollapsed
    if (opening) {
      this.state.inspectorCollapsed = false
    }
    this.render()
    if (opening) {
      this.animatePanelIn('inspector', this.refs?.inspector ?? null)
    }

    requestAnimationFrame(() => {
      const input = this.refs?.inspector.querySelector<HTMLTextAreaElement>('[data-node-note]')
      if (!input || input.dataset.nodeNote !== nodeId) {
        return
      }
      input.focus()
      const caret = input.value.length
      input.setSelectionRange(caret, caret)
      input.scrollIntoView({ block: 'nearest' })
    })
  }

  closeSettings(): void {
    if (!this.state.settingsOpen) {
      return
    }
    if (this.state.panelAnimating.has('settings')) {
      return
    }

    const drawer = this.refs?.settingsLayer?.querySelector('.settings-drawer') as HTMLElement | null
    this.animatePanelOut('settings', drawer, () => {
      this.state.settingsOpen = false
      this.setStatus('status.settingsClosed')
      this.render()
    })
  }

  animatePanelIn(panelId: string, element: HTMLElement | null): void {
    if (!element) {
      return
    }
    this.state.panelAnimating.add(panelId)
    element.classList.add('panel-entering')

    const onEnd = (): void => {
      element.removeEventListener('animationend', onEnd)
      element.classList.remove('panel-entering')
      this.state.panelAnimating.delete(panelId)
    }
    element.addEventListener('animationend', onEnd, { once: true })

    // Safety timeout in case animationend doesn't fire (e.g., reduced motion, tab hidden)
    const safetyTimeout = 300
    window.setTimeout(() => {
      if (this.state.panelAnimating.has(panelId)) {
        onEnd()
      }
    }, safetyTimeout)
  }

  animatePanelOut(panelId: string, element: HTMLElement | null, onComplete: () => void): void {
    if (!element) {
      onComplete()
      return
    }
    this.state.panelAnimating.add(panelId)
    element.classList.add('panel-leaving')

    const onEnd = (): void => {
      element.removeEventListener('animationend', onEnd)
      element.classList.remove('panel-leaving')
      this.state.panelAnimating.delete(panelId)
      onComplete()
    }
    element.addEventListener('animationend', onEnd, { once: true })

    // Safety timeout in case animationend doesn't fire
    const safetyTimeout = 250
    window.setTimeout(() => {
      if (this.state.panelAnimating.has(panelId)) {
        onEnd()
      }
    }, safetyTimeout)
  }

  completeOnboarding(): void {
    this.updatePreferences((preferences) => {
      preferences.onboardingCompleted = true
    })
    this.render()
  }

  // === Guide Overlay ===

  dismissCanvasGuide(): void {
    // Always latch the session flag first: callers may run after a render
    // that already flipped canvasGuideVisible off (first child exists), and
    // without the latch the guide would reappear once all children are
    // deleted again.
    this.state.guideOverlay.canvasGuideDismissed = true
    if (!this.state.guideOverlay.canvasGuideVisible) {
      return
    }
    // Fade out over 300ms, then hide
    const guideEl = this.refs?.scroll?.querySelector('.canvas-guide') as HTMLElement | null
    if (guideEl) {
      guideEl.classList.add('is-fading')
      window.setTimeout(() => {
        this.state.guideOverlay.canvasGuideVisible = false
        renderCanvasGuide(this)
      }, 300)
    } else {
      this.state.guideOverlay.canvasGuideVisible = false
    }
  }

  showShortcutOverlay(): void {
    if (this.state.guideOverlay.shortcutOverlayVisible) {
      return
    }
    this.state.guideOverlay.shortcutOverlayVisible = true
    renderShortcutOverlay(this)
  }

  hideShortcutOverlay(): void {
    if (!this.state.guideOverlay.shortcutOverlayVisible) {
      return
    }
    const overlay = document.querySelector('.shortcut-overlay') as HTMLElement | null
    if (overlay) {
      overlay.classList.add('is-fading')
      window.setTimeout(() => {
        this.state.guideOverlay.shortcutOverlayVisible = false
        overlay.remove()
      }, 200)
    } else {
      this.state.guideOverlay.shortcutOverlayVisible = false
    }
  }

  updatePreferences(updater: (preferences: AppPreferences) => void): void {
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

    this.didInitializeViewport = true

    const root = findRoot(this.state.document)
    const { scroll } = this.refs

    // Compute viewport synchronously to avoid race condition with user zoom input.
    // Previously this was deferred to queueMicrotask, causing UxEngine to hold stale
    // viewport {0,0,1} if the user zoomed before the microtask fired.
    const bounds = getWorkspaceBounds(this.state.document)
    const rootPosition = this.toWorkspacePosition(root.position, bounds)
    this.viewport.scale = 1
    this.viewport.x = scroll.clientWidth / 2 - rootPosition.x * this.viewport.scale
    this.viewport.y = scroll.clientHeight / 2 - rootPosition.y * this.viewport.scale
    this.uxEngine.syncViewport(this.viewport)
    this.applyCanvasMetrics(bounds, false)
    this.updateCanvasViewportView()
  }

  findNode(nodeId: string): MindNode | undefined {
    return findNode(this.state.document, nodeId)
  }

  findMapSummary(mapId: string): MindMapSummary | undefined {
    return this.state.maps.find((item) => item.id === mapId)
  }

  applyCanvasMetrics(
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

    // Zoomed out, the 28px node shadow blur is imperceptible but dominates
    // paint cost once every node is on screen (UX-08: 300 nodes @40% ran at
    // ~15fps). Swap to a cheap shadow below 70% zoom.
    this.refs.scroll.classList.toggle('zoom-far', this.viewport.scale < 0.7)
  }

  canUndo(): boolean {
    return this.historyPast.length > 0
  }

  canRedo(): boolean {
    return this.historyFuture.length > 0
  }

  createHistorySnapshot(): HistorySnapshot {
    return {
      document: cloneDocument(this.state.document),
      selectedNodeId: this.state.selectedNodeId,
      selectedNodeIds: [...this.selectedNodeIds()],
      connectSourceNodeId: this.state.connectSourceNodeId,
    }
  }

  pushHistorySnapshot(snapshot: HistorySnapshot): void {
    this.historyPast.push(snapshot)
    if (this.historyPast.length > HISTORY_LIMIT) {
      this.historyPast.shift()
    }
    this.historyFuture = []
  }

  scheduleLiveNodeUpdate(nodeId: string, includeDimensions = false): void {
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

  flushLiveNodeUpdate(): void {
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
      renderWorkspace(this)
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

    this.refs.edgeLayer.innerHTML = renderEdges(this)
  }

  setStatus(key: TranslationKey, values?: Record<string, string | number>): void {
    this.state.status = { key, values }
  }

  setCanvasPanning(active: boolean): void {
    this.refs?.scroll.classList.toggle('is-panning', active)
  }

  updateZoomControlTitles(): void {
    if (!this.refs) {
      return
    }
    const zc = this.refs.zoomControls
    const btn = (cmd: string) => zc.querySelector<HTMLButtonElement>(`[data-command="${cmd}"]`)
    const zoomOut = btn('zoom-out')
    const zoomIn = btn('zoom-in')
    const zoomReset = btn('zoom-reset')
    const zoomFit = btn('zoom-fit')
    if (zoomOut) zoomOut.title = this.t('zoom.out')
    if (zoomIn) zoomIn.title = this.t('zoom.in')
    if (zoomReset) {
      zoomReset.title = this.t('zoom.reset')
      zoomReset.textContent = this.t('zoom.reset')
    }
    if (zoomFit) {
      zoomFit.title = this.t('zoom.fit')
      zoomFit.textContent = this.t('zoom.fit')
    }
  }

  zoomBy(factor: number): void {
    if (!this.refs) {
      return
    }
    const scroll = this.refs.scroll
    const rect = scroll.getBoundingClientRect()
    const centerX = rect.width / 2
    const centerY = rect.height / 2
    const targetScale = clamp(this.viewport.scale * factor, MIN_ZOOM, MAX_ZOOM)

    this.uxEngine.animateZoom(this.viewport.scale, targetScale, centerX, centerY, this.viewport.x, this.viewport.y)
  }

  zoomReset(): void {
    if (!this.refs) {
      return
    }
    const scroll = this.refs.scroll
    const rect = scroll.getBoundingClientRect()
    const centerX = rect.width / 2
    const centerY = rect.height / 2

    this.uxEngine.animateZoom(this.viewport.scale, 1, centerX, centerY, this.viewport.x, this.viewport.y)
  }

  zoomFit(): void {
    if (!this.refs) {
      return
    }
    const scroll = this.refs.scroll
    const rect = scroll.getBoundingClientRect()
    const nodes = this.state.document.nodes
    const regions = this.state.document.regions ?? []

    // Compute current viewport state
    const current: import('./ux-engine').ViewportState = {
      x: this.viewport.x,
      y: this.viewport.y,
      scale: this.viewport.scale,
    }

    if (nodes.length === 0 && regions.length === 0) {
      const target: import('./ux-engine').ViewportState = {
        x: (rect.width - this.workspaceBounds.width) / 2,
        y: (rect.height - this.workspaceBounds.height) / 2,
        scale: 1,
      }
      this.uxEngine.animateFitToView(current, target)
      return
    }

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const node of nodes) {
      const childCount = childrenOf(this.state.document, node.id).length
      const width = node.width ?? estimateNodeWidth(node, childCount)
      const height = node.height ?? estimateNodeHeight(node, childCount, width)
      minX = Math.min(minX, node.position.x - width / 2)
      minY = Math.min(minY, node.position.y - height / 2)
      maxX = Math.max(maxX, node.position.x + width / 2)
      maxY = Math.max(maxY, node.position.y + height / 2)
    }
    for (const region of regions) {
      minX = Math.min(minX, region.position.x - region.width / 2)
      minY = Math.min(minY, region.position.y - region.height / 2)
      maxX = Math.max(maxX, region.position.x + region.width / 2)
      maxY = Math.max(maxY, region.position.y + region.height / 2)
    }
    const contentWidth = Math.max(1, maxX - minX)
    const contentHeight = Math.max(1, maxY - minY)

    const margin = 80
    const availableWidth = Math.max(1, rect.width - margin * 2)
    const availableHeight = Math.max(1, rect.height - margin * 2)
    const fitScale = clamp(Math.min(availableWidth / contentWidth, availableHeight / contentHeight), MIN_ZOOM, MAX_ZOOM)

    const layerCenterX = (minX + maxX) / 2 + this.workspaceBounds.originX
    const layerCenterY = (minY + maxY) / 2 + this.workspaceBounds.originY

    const target: import('./ux-engine').ViewportState = {
      x: rect.width / 2 - layerCenterX * fitScale,
      y: rect.height / 2 - layerCenterY * fitScale,
      scale: fitScale,
    }
    this.uxEngine.animateFitToView(current, target)
  }

  clientToCanvasPosition(clientX: number, clientY: number): Position {
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

  toWorkspacePosition(position: Position, bounds = this.workspaceBounds): Position {
    return {
      x: position.x + bounds.originX,
      y: position.y + bounds.originY,
    }
  }

  updateCanvasViewportView(): void {
    if (!this.refs) {
      return
    }

    this.refs.canvas.style.transform = `translate(${Math.round(this.viewport.x)}px, ${Math.round(this.viewport.y)}px)`
    this.refs.zoomLevel.textContent = `${Math.round(this.viewport.scale * 100)}%`
    this.updateMinimap()
    this.updateContextToolbar()
  }

  syncGraphAnimation(): void {
    if (!this.state.graph.open || !this.state.graph.autoRotate) {
      this.stopGraphAnimation()
      drawGraphScene(this)
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
      drawGraphScene(this)
      this.graphAnimationHandle = window.requestAnimationFrame(animate)
    }

    this.graphAnimationHandle = window.requestAnimationFrame(animate)
  }

  stopGraphAnimation(): void {
    if (this.graphAnimationHandle !== null) {
      window.cancelAnimationFrame(this.graphAnimationHandle)
      this.graphAnimationHandle = null
    }
    this.graphHitNodes = []
  }

  selectGraphNodeAtPoint(clientX: number, clientY: number): string | null {
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
    updateGraphSummaryPanel(this)
    drawGraphScene(this)
    return matched.id
  }

  findGraphMatches(query: string): MindNode[] {
    const normalized = query.trim().toLowerCase()
    if (!normalized) {
      return this.state.document.nodes.slice(0, 8)
    }

    return this.state.document.nodes.filter((node) => node.title.toLowerCase().includes(normalized))
  }

  t(key: TranslationKey, values?: Record<string, string | number>): string {
    return translate(this.state.preferences.locale, key, values)
  }

  onboardingOpen(): boolean {
    return !this.state.preferences.onboardingCompleted
  }

  overlayBlocksCanvas(): boolean {
    return this.onboardingOpen() || this.state.settingsOpen || this.state.ai.open || this.state.graph.open
  }

  private initMinimap(): void {
    if (this.minimapRenderer) return
    if (!this.refs) return

    try {
      const container = this.refs.scroll.parentElement ?? document.body
      this.minimapRenderer = new MinimapRenderer(container, 180, 120)
      this.bindMinimapNavigation()
    } catch {
      // Minimap canvas creation failed — degrade gracefully
      this.minimapRenderer = null
    }
  }

  private updateMinimap(): void {
    if (!this.minimapRenderer || !this.refs) return

    const nodes = this.state.document.nodes
    const visibleIds = visibleNodeIds(this.state.document)
    const minimapNodes: MinimapNodeData[] = []

    for (const node of nodes) {
      // Only show visible nodes in minimap (exclude collapsed/hidden descendants)
      if (!visibleIds.has(node.id)) {
        continue
      }

      const childCount = childrenOf(this.state.document, node.id).length
      const w = node.width ?? estimateNodeWidth(node, childCount)
      const h = node.height ?? estimateNodeHeight(node, childCount, w)
      // Node position is center-based, convert to top-left for minimap
      const x = node.position.x - w / 2
      const y = node.position.y - h / 2

      // Resolve node color for minimap rendering
      let color = 'rgba(100, 160, 255, 0.8)'
      if (node.color) {
        const palette = resolveNodeColorPalette(node.color)
        if (palette) {
          color = `rgb(${palette.surfaceRgb})`
        }
      } else if (node.kind === 'root') {
        color = 'rgba(129, 140, 248, 0.9)'
      }

      minimapNodes.push({ x, y, width: w, height: h, color })
    }

    this.minimapRenderer.setNodes(minimapNodes)

    // Update viewport data
    const scroll = this.refs.scroll
    const rect = scroll.getBoundingClientRect()
    this.minimapRenderer.setViewport({
      x: this.viewport.x,
      y: this.viewport.y,
      scale: this.viewport.scale,
      screenWidth: rect.width,
      screenHeight: rect.height,
      originX: this.workspaceBounds.originX,
      originY: this.workspaceBounds.originY,
    })
  }

  destroyMinimap(): void {
    if (this.minimapRenderer) {
      this.minimapRenderer.destroy()
      this.minimapRenderer = null
    }
  }

  private bindMinimapNavigation(): void {
    if (!this.minimapRenderer) return
    const canvas = this.minimapRenderer.getCanvas()

    const panToMinimapPosition = (event: MouseEvent): void => {
      if (!this.minimapRenderer || !this.refs) return
      const rect = canvas.getBoundingClientRect()
      const mx = event.clientX - rect.left
      const my = event.clientY - rect.top

      const worldPos = this.minimapRenderer.minimapToWorld(mx, my)
      if (!worldPos) return

      // Convert world position to workspace position (add originX/originY offset)
      const workspaceX = worldPos.worldX + this.workspaceBounds.originX
      const workspaceY = worldPos.worldY + this.workspaceBounds.originY

      // Center viewport on the computed workspace position
      const scroll = this.refs.scroll
      this.viewport.x = scroll.clientWidth / 2 - workspaceX * this.viewport.scale
      this.viewport.y = scroll.clientHeight / 2 - workspaceY * this.viewport.scale
      this.uxEngine.syncViewport(this.viewport)
      this.updateCanvasViewportView()
    }

    const handleMouseDown = (event: MouseEvent): void => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      this.minimapDragging = true
      this.minimapRenderer?.beginNavigation()
      panToMinimapPosition(event)
    }

    const handleMouseMove = (event: MouseEvent): void => {
      if (!this.minimapDragging) return
      event.preventDefault()
      panToMinimapPosition(event)
    }

    const handleMouseUp = (event: MouseEvent): void => {
      if (!this.minimapDragging) return
      event.preventDefault()
      this.minimapDragging = false
      this.minimapRenderer?.endNavigation()
    }

    canvas.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  // === Context Toolbar ===

  private createContextToolbar(): HTMLElement {
    const toolbar = document.createElement('div')
    toolbar.className = 'context-toolbar context-toolbar-hidden'
    toolbar.setAttribute('data-context-toolbar', '')
    toolbar.style.transition = 'left 100ms ease-out, top 100ms ease-out'

    // Color selection button
    const colorBtn = document.createElement('button')
    colorBtn.type = 'button'
    colorBtn.className = 'context-toolbar-btn'
    colorBtn.setAttribute('data-command', 'cycle-node-color')
    colorBtn.setAttribute('aria-label', 'Color')
    colorBtn.title = this.t('inspector.color')
    colorBtn.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="3" fill="currentColor"/></svg>'
    toolbar.appendChild(colorBtn)

    // Priority toggle button
    const priorityBtn = document.createElement('button')
    priorityBtn.type = 'button'
    priorityBtn.className = 'context-toolbar-btn'
    priorityBtn.setAttribute('data-command', 'cycle-priority')
    priorityBtn.setAttribute('aria-label', 'Priority')
    priorityBtn.title = this.t('context.priorityP0')
    priorityBtn.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 2v12M3 2l9 4-9 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    toolbar.appendChild(priorityBtn)

    // Delete button
    const deleteBtn = document.createElement('button')
    deleteBtn.type = 'button'
    deleteBtn.className = 'context-toolbar-btn context-toolbar-btn--danger'
    deleteBtn.setAttribute('data-command', 'delete-selected')
    deleteBtn.setAttribute('aria-label', 'Delete')
    deleteBtn.title = this.t('action.delete')
    deleteBtn.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5.333 4V2.667a1.333 1.333 0 011.334-1.334h2.666a1.333 1.333 0 011.334 1.334V4M12.667 4v9.333a1.333 1.333 0 01-1.334 1.334H4.667a1.333 1.333 0 01-1.334-1.334V4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    toolbar.appendChild(deleteBtn)

    // AI action button
    const aiBtn = document.createElement('button')
    aiBtn.type = 'button'
    aiBtn.className = 'context-toolbar-btn'
    aiBtn.setAttribute('data-command', 'open-ai-wheel')
    aiBtn.setAttribute('aria-label', 'AI')
    aiBtn.title = 'AI'
    aiBtn.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.414 1.414M11.536 11.536l1.414 1.414M3.05 12.95l1.414-1.414M11.536 4.464l1.414-1.414" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="8" r="2.5" stroke="currentColor" stroke-width="1.5"/></svg>'
    toolbar.appendChild(aiBtn)

    return toolbar
  }

  private updateContextToolbar(): void {
    const scroll = this.refs?.scroll
    if (!scroll) {
      return
    }

    const selectedNode = this.selectedNode()
    const singleSelected = this.state.selectedNodeIds.length === 1

    // Hide toolbar when no single node is selected, or when editing, or when overlays are open
    if (!selectedNode || !singleSelected || this.state.editingNodeId || this.overlayBlocksCanvas()) {
      this.hideContextToolbar()
      return
    }

    // Create toolbar element if it doesn't exist
    if (!this.state.contextToolbar.element) {
      const toolbar = this.createContextToolbar()
      scroll.appendChild(toolbar)
      this.state.contextToolbar.element = toolbar
    }

    const toolbar = this.state.contextToolbar.element
    const nodeId = selectedNode.id

    // Calculate node screen position
    const childCount = childrenOf(this.state.document, nodeId).length
    const nodeWidth = selectedNode.width ?? estimateNodeWidth(selectedNode, childCount)
    const nodeHeight = selectedNode.height ?? estimateNodeHeight(selectedNode, childCount, nodeWidth)

    // Node top-left in workspace coordinates (node position is center)
    const nodeTopWorldX = selectedNode.position.x - nodeWidth / 2
    const nodeTopWorldY = selectedNode.position.y - nodeHeight / 2

    // Convert to screen coordinates within the scroll container
    const screenNodeTopX = (nodeTopWorldX + this.workspaceBounds.originX) * this.viewport.scale + this.viewport.x
    const screenNodeTopY = (nodeTopWorldY + this.workspaceBounds.originY) * this.viewport.scale + this.viewport.y
    const screenNodeWidth = nodeWidth * this.viewport.scale

    // Toolbar dimensions (approximate, will be refined after first render)
    const toolbarHeight = 32
    const toolbarGap = 8
    const toolbarWidth = toolbar.offsetWidth || 140

    // Position toolbar above the node: toolbar.bottom <= node.top.
    // Clamp within the scroll container so it never pokes off-screen; if
    // there is no room above, place it below the node instead.
    let toolbarTop = screenNodeTopY - toolbarHeight - toolbarGap
    if (toolbarTop < 4) {
      toolbarTop = screenNodeTopY + nodeHeight * this.viewport.scale + toolbarGap
    }
    toolbarTop = Math.min(toolbarTop, scroll.clientHeight - toolbarHeight - 4)
    const halfWidth = toolbarWidth / 2
    const toolbarLeft = Math.min(
      Math.max(screenNodeTopX + screenNodeWidth / 2, halfWidth + 4),
      Math.max(scroll.clientWidth - halfWidth - 4, halfWidth + 4),
    )

    // Update position
    this.state.contextToolbar.position = { x: toolbarLeft, y: toolbarTop }
    this.state.contextToolbar.nodeId = nodeId

    // Apply position (centered horizontally above node)
    toolbar.style.left = `${Math.round(toolbarLeft)}px`
    toolbar.style.top = `${Math.round(toolbarTop)}px`
    toolbar.style.transform = 'translateX(-50%)'

    // Show toolbar
    if (!this.state.contextToolbar.visible) {
      this.state.contextToolbar.visible = true
      toolbar.classList.remove('context-toolbar-hidden')
      // Re-trigger enter animation
      toolbar.style.animation = 'none'
      // Force reflow
      void toolbar.offsetHeight
      toolbar.style.animation = ''
    }
  }

  private hideContextToolbar(): void {
    const toolbar = this.state.contextToolbar.element
    if (!toolbar || !this.state.contextToolbar.visible) {
      return
    }

    this.state.contextToolbar.visible = false
    this.state.contextToolbar.nodeId = null
    toolbar.classList.add('context-toolbar-hidden')
  }

  destroyContextToolbar(): void {
    const toolbar = this.state.contextToolbar.element
    if (toolbar) {
      toolbar.remove()
      this.state.contextToolbar.element = null
      this.state.contextToolbar.visible = false
      this.state.contextToolbar.nodeId = null
    }
  }

  applyTheme(): void {
    const theme = this.state.view === 'home' ? 'dark' : this.state.document.theme
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
  }

  private applyLocale(): void {
    document.documentElement.lang = this.state.preferences.locale
  }
}
