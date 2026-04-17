import type { TranslationKey } from './i18n'
import type {
  AIDebugInfo,
  AITemplateId,
  AppPreferences,
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

export interface ConnectorDragState {
  sourceNodeId: string
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
  connectorDrag: ConnectorDragState | null
  midpointDrag: MidpointDragState | null
}

export interface ShellRefs {
  topChrome: HTMLElement
  topPanel: HTMLElement
  fixedToolbar: HTMLElement
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
  regionLayer: HTMLElement
  nodeLayer: HTMLElement
  inspector: HTMLElement
  settingsLayer: HTMLElement
  onboardingLayer: HTMLElement
  overlayLayer: HTMLElement
  aiLayer: HTMLElement
  graphLayer: HTMLElement
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

export interface CopiedSubtree {
  rootId: string
  nodes: CopiedSubtreeNode[]
}
