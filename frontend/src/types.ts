export type Theme = 'light' | 'dark'
export type Locale = 'zh-CN' | 'en'
export type AIProvider = 'lmstudio' | 'openai-compatible'

export type NodeKind = 'root' | 'topic' | 'floating'

export type Priority = '' | 'P0' | 'P1' | 'P2' | 'P3'

export interface Position {
  x: number
  y: number
}

export interface MindNode {
  id: string
  parentId?: string
  kind: NodeKind
  title: string
  priority?: Priority
  collapsed?: boolean
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

export interface AISettings {
  provider: AIProvider
  baseUrl: string
  model: string
}

export interface AppPreferences {
  locale: Locale
  onboardingCompleted: boolean
  ai: AISettings
}
