export type Theme = 'light' | 'dark'
export type Locale = 'zh-CN' | 'en'
export type AIProvider = 'lmstudio' | 'openai-compatible'
export type AITemplateId = 'concept-graph' | 'project-planning' | 'character-network'
export type EdgeStyle = 'curve' | 'orthogonal'
export type LayoutMode = 'balanced' | 'right'
export type TopPanelPosition = 'left' | 'center' | 'right'

export type NodeKind = 'root' | 'topic' | 'floating'

export type Priority = '' | 'P0' | 'P1' | 'P2' | 'P3'
export type NodeColor = '' | 'slate' | 'blue' | 'teal' | 'green' | 'amber' | 'rose' | 'violet'

export interface Position {
  x: number
  y: number
}

export interface MindNode {
  id: string
  parentId?: string
  kind: NodeKind
  title: string
  note?: string
  priority?: Priority
  color?: NodeColor
  collapsed?: boolean
  width?: number
  height?: number
  position: Position
  createdAt: string
  updatedAt: string
}

export interface RelationEdge {
  id: string
  sourceId: string
  targetId: string
  label?: string
  createdAt: string
  updatedAt: string
}

export interface MindMapMeta {
  version: number
  lastEditedAt: string
  lastOpenedAt: string
}

export interface MindMapDocument {
  id: string
  title: string
  theme: Theme
  nodes: MindNode[]
  relations: RelationEdge[]
  meta: MindMapMeta
}

export interface MindMapSummary {
  id: string
  title: string
  lastEditedAt: string
  lastOpenedAt: string
}

export interface AISettings {
  provider: AIProvider
  baseUrl: string
  model: string
  apiKey: string
  maxTokens: number
  timeoutSeconds: number
}

export interface AppearanceSettings {
  edgeStyle: EdgeStyle
  layoutMode: LayoutMode
  topPanelPosition: TopPanelPosition
}

export interface InteractionSettings {
  dragSubtreeWithParent: boolean
  dragSnap: boolean
  autoLayoutOnCollapse: boolean
  autoSnapshots: boolean
}

export interface AIDebugRequest {
  rawMode: boolean
  rawRequest: string
}

export interface AIDebugInfo {
  rawMode: boolean
  upstreamRequest: string
  upstreamResponse: string
  assistantContent: string
}

export interface AIRelationSuggestion {
  sourceId: string
  targetId: string
  label: string
  reason: string
  confidence: number
}

export interface AIRelationResponse {
  relations: AIRelationSuggestion[]
  summary: string
  model: string
  debug?: AIDebugInfo
}

export interface AINodeNoteSuggestion {
  id: string
  note: string
}

export interface AINodeNotesResponse {
  notes: AINodeNoteSuggestion[]
  summary: string
  model: string
  debug?: AIDebugInfo
}

export interface AIGenerateResponse {
  document: MindMapDocument
  summary: string
  prompt: string
  template: AITemplateId
  mode?: 'new' | 'expand'
  model: string
  debug?: AIDebugInfo
}

export interface AITestResponse {
  ok: boolean
  model: string
  message: string
}

export interface AppPreferences {
  locale: Locale
  onboardingCompleted: boolean
  appearance: AppearanceSettings
  interaction: InteractionSettings
  ai: AISettings
}
