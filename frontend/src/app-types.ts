import type { TranslationKey } from './i18n'
import type {
  AIDebugInfo,
  AITemplateId,
  AppPreferences,
  ArrowDirection,
  MindMapDocument,
  MindMapSummary,
  MindNode,
  NodeColor,
  Position,
  Priority,
} from './types'

export type AppView = 'home' | 'map'
export type AIDebugAction = 'generate' | 'notes' | 'relations' | 'import' | ''
export type PendingImportMode = 'auto' | 'ai'
export type FixedMenuId = 'file' | 'node' | 'ai' | 'view' | ''

export interface DragState {
  nodeId: string
  nodeIds: string[]
  offsetX: number
  offsetY: number
  initialPositions: Record<string, Position>
  historyCaptured: boolean
}

export interface PanState {
  pointerId: number
  startX: number
  startY: number
  startViewportX: number
  startViewportY: number
  /** Last pointer position for velocity tracking */
  lastClientX: number
  lastClientY: number
  /** Timestamp of last pointer move for velocity calculation */
  lastMoveTime: number
  /** Computed velocity at end of pan (px/frame at ~60fps) */
  velocityX: number
  velocityY: number
}

export interface ResizeState {
  nodeId: string
  startX: number
  startY: number
  startWidth: number
  startHeight: number
  anchorLeft: number
  anchorTop: number
  historyCaptured: boolean
}

export interface HistorySnapshot {
  document: MindMapDocument
  selectedNodeId: string | null
  selectedNodeIds: string[]
  connectSourceNodeId: string | null
}

export interface ContextMenuState {
  clientX: number
  clientY: number
  nodeId: string | null
  /** When right-clicking a relation edge */
  relationId?: string | null
  /** When right-clicking a region box */
  regionId?: string | null
}

export interface RegionDrawState {
  pointerId: number
  startCanvasX: number
  startCanvasY: number
  currentCanvasX: number
  currentCanvasY: number
  color: NodeColor
}

export interface RegionDragState {
  regionId: string
  offsetX: number
  offsetY: number
  initialPosition: Position
  initialNodePositions: Record<string, Position>
  historyCaptured: boolean
}

export type RegionResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export interface RegionResizeState {
  regionId: string
  handle: RegionResizeHandle
  startX: number
  startY: number
  startCenterX: number
  startCenterY: number
  startWidth: number
  startHeight: number
  historyCaptured: boolean
}

export interface ConnectorDragState {
  sourceNodeId: string
  pointerId: number
  currentClientX: number
  currentClientY: number
}

export interface ParentConnectorDragState {
  childNodeId: string
  pointerId: number
  currentClientX: number
  currentClientY: number
}

export interface MidpointDragState {
  relationId: string
  pointerId: number
  mode: 'pending' | 'move' | 'branch'
  startClientX: number
  startClientY: number
  currentClientX: number
  currentClientY: number
  originMidpoint: Position
  historyCaptured: boolean
  longPressHandle: number | null
}

export interface MarqueeState {
  pointerId: number
  button: number
  startClientX: number
  startClientY: number
  currentClientX: number
  currentClientY: number
  active: boolean
}

export interface ActiveEditorPreviewState {
  nodeId: string
  anchorLeft: number
  width: number
  height: number
}

export interface StatusDescriptor {
  key: TranslationKey
  values?: Record<string, string | number>
}

export interface EditorLaunchOptions {
  value?: string | null
  selection?: 'all' | 'end'
  selectionStart?: number
  selectionEnd?: number
}

export interface GraphDragState {
  pointerId: number
  startX: number
  startY: number
  startRotation: number
  startTilt: number
}

export interface AIWorkspaceState {
  open: boolean
  busy: boolean
  testing: boolean
  debugOpen: boolean
  rawMode: boolean
  template: AITemplateId
  topic: string
  generationInstructions: string
  importInstructions: string
  noteInstructions: string
  relationInstructions: string
  generateRawRequest: string
  importRawRequest: string
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

export interface AINoteTargetState {
  mode: 'selection' | 'all'
  nodes: MindNode[]
}

export interface GraphOverlayState {
  open: boolean
  search: string
  selectedNodeId: string | null
  autoRotate: boolean
  rotation: number
  tilt: number
  zoom: number
}

export interface AIWheelState {
  open: boolean
  nodeId: string | null
  clientX: number
  clientY: number
}

export interface AppState {
  view: AppView
  maps: MindMapSummary[]
  document: MindMapDocument
  currentMapId: string | null
  snapshotDraftName: string
  selectedNodeId: string | null
  selectedNodeIds: string[]
  selectedRegionId: string | null
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
  fixedMenu: FixedMenuId
  inspectorCollapsed: boolean
  aiWheel: AIWheelState
  ai: AIWorkspaceState
  graph: GraphOverlayState
  selectedRelationId: string | null
  regionDraw: RegionDrawState | null
  regionDrag: RegionDragState | null
  regionResize: RegionResizeState | null
  connectorDrag: ConnectorDragState | null
  parentConnectorDrag: ParentConnectorDragState | null
  midpointDrag: MidpointDragState | null
  cutting: CuttingState | null
  dirty: boolean

  // UX Polish additions
  contextToolbar: ContextToolbarState
  toastQueue: ToastItem[]
  guideOverlay: GuideOverlayState
  panelAnimating: Set<string> // panel IDs currently animating
}

export interface ShellRefs {
  topChrome: HTMLElement
  topPanel: HTMLElement
  fixedToolbar: HTMLElement
  eyebrow: HTMLParagraphElement
  title: HTMLHeadingElement
  saveIndicator: HTMLElement
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
  regionLayer: HTMLElement
  nodeLayer: HTMLElement
  inspector: HTMLElement
  settingsLayer: HTMLElement
  onboardingLayer: HTMLElement
  overlayLayer: HTMLElement
  zoomControls: HTMLElement
  zoomLevel: HTMLElement
  aiLayer: HTMLElement
  graphLayer: HTMLElement
}

// === UX Polish: Context Toolbar ===

export interface ContextToolbarState {
  visible: boolean
  nodeId: string | null
  position: Position // 计算后的屏幕坐标
  element: HTMLElement | null
}

// === UX Polish: Toast Queue ===

export interface ToastItem {
  id: string
  message: string
  createdAt: number
  element: HTMLElement | null
}

export interface ToastManagerState {
  queue: ToastItem[]
  maxVisible: number // 3
  autoDismissMs: number // 2500
  spacing: number // 8px
}

// === UX Polish: Guide Overlay ===

export interface GuideOverlayState {
  canvasGuideVisible: boolean
  canvasGuideDismissed: boolean // session-level flag
  shortcutOverlayVisible: boolean
}

// === UX Polish: Minimap ===

export interface MinimapConfig {
  width: number // 180
  height: number // 120
  opacity: number // 0.85
  hoverOpacity: number // 0.85
  idleOpacity: number // 0.4
}

export interface MinimapState {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  visible: boolean
  hovered: boolean
  dragging: boolean
}

// === Edge Cutting ===

export interface CuttingState {
  /** Pointer ID for tracking */
  pointerId: number
  /** Cutting line start point in canvas coordinates */
  startPoint: Position
  /** Cutting line current endpoint in canvas coordinates */
  currentPoint: Position
  /** Node IDs currently intersected by cutting line */
  warningNodeIds: Set<string>
  /** Hierarchy edge keys (parentId-childId) currently intersected */
  warningHierarchyEdgeKeys: Set<string>
  /** Relation edge IDs currently intersected */
  warningRelationIds: Set<string>
}

export interface CopiedSubtreeNode {
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

/** Relation captured with a copied subtree; endpoints refer to the ORIGINAL
 * node ids and are remapped through the paste idMap on insertion. */
export interface CopiedRelation {
  sourceId: string
  targetId: string
  label?: string
  arrowDirection?: ArrowDirection
  branchTargetIds?: string[]
}

export interface CopiedSubtree {
  rootId: string
  nodes: CopiedSubtreeNode[]
  relations?: CopiedRelation[]
}

export const PRIORITY_VALUES: Priority[] = ['', 'P0', 'P1', 'P2', 'P3']

export const MIN_ZOOM = 0.4
export const MAX_ZOOM = 2.4
