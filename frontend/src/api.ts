import type {
  AIDebugInfo,
  AIDebugRequest,
  AIGenerateResponse,
  AIImportResponse,
  AINodeNotesResponse,
  AIRelationResponse,
  AISuggestChildrenResponse,
  AITestResponse,
  AITemplateId,
  AISettings,
  CollabSettings,
  MindMapDocument,
  MindMapSummary,
  ShareAccessLevel,
  ShareToken,
} from './types'
import { normalizeDocumentSemantics } from './document'

const JSON_HEADERS = {
  'Content-Type': 'application/json',
}

const DESKTOP_API_BASE = 'http://127.0.0.1:34117/api'
const API_BASE = resolveApiBase()
const DEV_BACKEND_HINT =
  '当前 AI 请求会先访问本地 Go API，再由 Go API 转发到模型服务。开发模式请在项目根目录运行 `npm run dev`，或至少同时运行 `go run ./cmd/server` 和 `cd frontend && npm run dev`。'

let ownerApiKey = ''

function authHeaders(): Record<string, string> {
  return ownerApiKey ? { 'X-API-Key': ownerApiKey } : {}
}

function jsonHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    ...JSON_HEADERS,
    ...authHeaders(),
    ...(extra ?? {}),
  }
}

function revisionHeaders(revision: number): Record<string, string> {
  const normalized = Math.trunc(revision)
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw new Error('A positive document revision is required before saving.')
  }
  return { 'If-Match': `"rev-${normalized}"` }
}

export const api = {
  setOwnerApiKey(apiKey: string): void {
    ownerApiKey = apiKey.trim()
  },

  async listMaps(): Promise<MindMapSummary[]> {
    const response = await fetch(`${API_BASE}/maps`, {
      headers: authHeaders(),
    })
    if (!response.ok) {
      throw await createAPIError(response)
    }

    const payload = await readJSON<MindMapSummary[]>(response, '/api/maps')
    return (payload ?? []).map((summary) => ({
      ...summary,
      revision: normalizeRevision(summary.revision),
    }))
  },

  async createMap(title = ''): Promise<MindMapDocument> {
    const response = await fetch(`${API_BASE}/maps`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ title }),
    })

    if (!response.ok) {
      throw await createAPIError(response)
    }

    return normalizeDocument(await readJSON<MindMapDocument>(response, '/api/maps'))
  },

  async loadMap(mapId: string): Promise<MindMapDocument> {
    const response = await fetch(`${API_BASE}/maps/${encodeURIComponent(mapId)}`, {
      headers: authHeaders(),
    })
    if (!response.ok) {
      throw await createAPIError(response)
    }

    return normalizeDocument(await readJSON<MindMapDocument>(response, `/api/maps/${encodeURIComponent(mapId)}`))
  },

  async saveMap(document: MindMapDocument): Promise<MindMapDocument> {
    const response = await fetch(`${API_BASE}/maps/${encodeURIComponent(document.id)}`, {
      method: 'PUT',
      headers: jsonHeaders(revisionHeaders(document.meta.revision)),
      body: JSON.stringify(document),
    })

    if (!response.ok) {
      throw await createAPIError(response)
    }

    return normalizeDocument(await readJSON<MindMapDocument>(response, `/api/maps/${encodeURIComponent(document.id)}`))
  },

  async renameMap(mapId: string, title: string, expectedRevision: number): Promise<MindMapDocument> {
    const response = await fetch(`${API_BASE}/maps/${encodeURIComponent(mapId)}`, {
      method: 'PATCH',
      headers: jsonHeaders(revisionHeaders(expectedRevision)),
      body: JSON.stringify({ title }),
    })

    if (!response.ok) {
      throw await createAPIError(response)
    }

    return normalizeDocument(await readJSON<MindMapDocument>(response, `/api/maps/${encodeURIComponent(mapId)}`))
  },

  async deleteMap(mapId: string, expectedRevision: number): Promise<void> {
    const response = await fetch(`${API_BASE}/maps/${encodeURIComponent(mapId)}`, {
      method: 'DELETE',
      headers: {
        ...authHeaders(),
        ...revisionHeaders(expectedRevision),
      },
    })

    if (!response.ok) {
      throw await createAPIError(response)
    }
  },

  async exportMarkdown(document: MindMapDocument): Promise<string> {
    const response = await fetch(`${API_BASE}/export/markdown`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(document),
    })

    if (!response.ok) {
      throw await createAPIError(response)
    }

    const payload = await readJSON<{ content: string }>(response, '/api/export/markdown')
    return payload.content
  },

  async importDocument(content: string, format: 'markdown' | 'text'): Promise<MindMapDocument> {
    const response = await fetch(`${API_BASE}/import`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ content, format }),
    })

    if (!response.ok) {
      throw await createAPIError(response)
    }

    return normalizeDocument(await readJSON<MindMapDocument>(response, '/api/import'))
  },

  async importDocumentWithAI(input: {
    fileName: string
    format: string
    content: string
    instructions: string
    settings: AISettings
    debug?: AIDebugRequest
  }): Promise<AIImportResponse> {
    const response = await fetch(`${API_BASE}/ai/import`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(input),
    })

    if (!response.ok) {
      throw await createAPIError(response)
    }

    const payload = await readJSON<AIImportResponse>(response, '/api/ai/import')
    return {
      ...payload,
      document: normalizeDocument(payload.document),
    }
  },

  async suggestRelations(
    document: MindMapDocument,
    settings: AISettings,
    instructions: string,
    focusNodeIds?: string[],
    debug?: AIDebugRequest,
  ): Promise<AIRelationResponse> {
    const response = await fetch(`${API_BASE}/ai/relations`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        document,
        settings,
        instructions,
        focusNodeIds,
        debug,
      }),
    })

    if (!response.ok) {
      throw await createAPIError(response)
    }

    return await readJSON<AIRelationResponse>(response, '/api/ai/relations')
  },

  async completeNodeNotes(input: {
    document: MindMapDocument
    settings: AISettings
    targetNodeIds: string[]
    instructions: string
    debug?: AIDebugRequest
  }): Promise<AINodeNotesResponse> {
    const response = await fetch(`${API_BASE}/ai/node-notes`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(input),
    })

    if (!response.ok) {
      throw await createAPIError(response)
    }

    return await readJSON<AINodeNotesResponse>(response, '/api/ai/node-notes')
  },

  async generateKnowledgeMap(input: {
    topic: string
    template: AITemplateId
    instructions: string
    settings: AISettings
    mode?: 'new' | 'expand'
    document?: MindMapDocument
    debug?: AIDebugRequest
  }): Promise<AIGenerateResponse> {
    const response = await fetch(`${API_BASE}/ai/generate`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(input),
    })

    if (!response.ok) {
      throw await createAPIError(response)
    }

    const payload = await readJSON<AIGenerateResponse>(response, '/api/ai/generate')
    return {
      ...payload,
      document: normalizeDocument(payload.document),
    }
  },

  async suggestChildren(input: {
    document: MindMapDocument
    settings: AISettings
    targetNodeId: string
    mode?: 'children' | 'siblings'
    instructions: string
    debug?: AIDebugRequest
  }): Promise<AISuggestChildrenResponse> {
    const response = await fetch(`${API_BASE}/ai/suggest-children`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(input),
    })

    if (!response.ok) {
      throw await createAPIError(response)
    }

    return await readJSON<AISuggestChildrenResponse>(response, '/api/ai/suggest-children')
  },

  async testAIConnection(settings: AISettings): Promise<AITestResponse> {
    const response = await fetch(`${API_BASE}/ai/test`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ settings }),
    })

    if (!response.ok) {
      throw await createAPIError(response)
    }

    return await readJSON<AITestResponse>(response, '/api/ai/test')
  },

  async getSettings(): Promise<CollabSettings> {
    const response = await fetch(`${API_BASE}/settings`, {
      credentials: 'include',
      headers: authHeaders(),
    })
    if (!response.ok) {
      throw await createAPIError(response)
    }

    return await readJSON<CollabSettings>(response, '/api/settings')
  },

  async pollMap(
    mapId: string,
    since: string,
  ): Promise<{ revision: number; lastEditedAt: string; nodeCount: number; modifiedViaAPI: boolean }> {
    const response = await fetch(
      `${API_BASE}/maps/${encodeURIComponent(mapId)}/poll?since=${encodeURIComponent(since)}`,
      {
        headers: authHeaders(),
      },
    )
    if (!response.ok) {
      throw await createAPIError(response)
    }

    return await readJSON<{ revision: number; lastEditedAt: string; nodeCount: number; modifiedViaAPI: boolean }>(
      response,
      `/api/maps/${encodeURIComponent(mapId)}/poll`,
    )
  },

  async saveSettings(settings: CollabSettings): Promise<CollabSettings> {
    const response = await fetch(`${API_BASE}/settings`, {
      method: 'PUT',
      credentials: 'include',
      headers: jsonHeaders(),
      body: JSON.stringify(settings),
    })

    if (!response.ok) {
      throw await createAPIError(response)
    }

    return await readJSON<CollabSettings>(response, '/api/settings')
  },

  async createShareToken(input: {
    mapId: string
    accessLevel: ShareAccessLevel
    displayName: string
    expiresIn?: string
    ownerApiKey?: string
  }): Promise<ShareToken> {
    const headers = input.ownerApiKey ? jsonHeaders({ 'X-API-Key': input.ownerApiKey }) : jsonHeaders()
    const response = await fetch(`${API_BASE}/tokens`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        mapId: input.mapId,
        accessLevel: input.accessLevel,
        displayName: input.displayName,
        expiresIn: input.expiresIn,
      }),
    })

    if (!response.ok) {
      throw await createAPIError(response)
    }

    return await readJSON<ShareToken>(response, '/api/tokens')
  },
}

class APIError extends Error {
  debug?: AIDebugInfo
  status: number
  expectedRevision?: number
  actualRevision?: number

  constructor(
    message: string,
    status: number,
    debug?: AIDebugInfo,
    revisions?: { expectedRevision?: number; actualRevision?: number },
  ) {
    super(message)
    this.name = 'APIError'
    this.status = status
    this.debug = debug
    this.expectedRevision = revisions?.expectedRevision
    this.actualRevision = revisions?.actualRevision
  }
}

export function isRevisionConflictError(error: unknown): error is APIError {
  return error instanceof APIError && error.status === 412
}

function normalizeDocument(document: MindMapDocument): MindMapDocument {
  return normalizeDocumentSemantics({
    ...document,
    meta: {
      ...document.meta,
      version: document.meta?.version || 1,
      revision: normalizeRevision(document.meta?.revision),
    },
    nodes: (document.nodes ?? []).map((node) => ({
      ...node,
      note: node.note?.trim() ? node.note : undefined,
      width: node.width || undefined,
      height: node.height || undefined,
    })),
    relations: (document.relations ?? []).map((relation) => ({
      ...relation,
      branches: (relation.branches ?? []).filter((branch) => branch?.targetId),
      waypoints: (relation.waypoints ?? []).filter(
        (waypoint) => Number.isFinite(waypoint?.x) && Number.isFinite(waypoint?.y),
      ),
    })),
    regions: document.regions ?? [],
  })
}

function normalizeRevision(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 1
}

function resolveApiBase(): string {
  const configuredBase = import.meta.env.VITE_CODE_MIND_API_BASE?.trim()
  if (configuredBase) {
    return `${configuredBase.replace(/\/+$/, '')}/api`
  }

  if (isWailsDesktopRuntime()) {
    return DESKTOP_API_BASE
  }

  return '/api'
}

function isWailsDesktopRuntime(): boolean {
  const globalWithRuntime = globalThis as typeof globalThis & {
    runtime?: unknown
  }

  return typeof globalWithRuntime.runtime === 'object' && globalWithRuntime.runtime !== null
}

function normalizeDebugInfo(value: unknown): AIDebugInfo | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const candidate = value as Partial<AIDebugInfo>
  return {
    rawMode: Boolean(candidate.rawMode),
    upstreamRequest: typeof candidate.upstreamRequest === 'string' ? candidate.upstreamRequest : '',
    upstreamResponse: typeof candidate.upstreamResponse === 'string' ? candidate.upstreamResponse : '',
    assistantContent: typeof candidate.assistantContent === 'string' ? candidate.assistantContent : '',
  }
}

async function createAPIError(response: Response): Promise<APIError> {
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
  const payload = await response.text()
  let debug: AIDebugInfo | undefined

  if (contentType.includes('application/json')) {
    try {
      const parsed = JSON.parse(payload) as {
        error?: string
        debug?: unknown
        expectedRevision?: unknown
        actualRevision?: unknown
      }
      debug = normalizeDebugInfo(parsed.debug)
      if (parsed.error) {
        return new APIError(parsed.error, response.status, debug, {
          expectedRevision: normalizeOptionalRevision(parsed.expectedRevision),
          actualRevision: normalizeOptionalRevision(parsed.actualRevision),
        })
      }
    } catch {
      // Ignore malformed error payloads and fall back to generic messaging below.
    }
  }

  if (payload.trim().startsWith('<')) {
    return new APIError(
      `${response.status} ${response.statusText}: API 返回了 HTML 页面，通常表示你当前只启动了前端，或者 \`http://localhost:7979\` 的 Go API 没有正常运行。${DEV_BACKEND_HINT}`,
      response.status,
      debug,
    )
  }

  return new APIError(payload.trim() || `${response.status} ${response.statusText}`, response.status, debug)
}

function normalizeOptionalRevision(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

async function readJSON<T>(response: Response, endpoint: string): Promise<T> {
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
  const payload = await response.text()

  if (!contentType.includes('application/json')) {
    const suffix = payload.trim().startsWith('<') ? ' 当前收到的是 HTML 页面。' : ''
    throw new Error(`${endpoint} 返回了非 JSON 内容。${DEV_BACKEND_HINT}${suffix}`)
  }

  try {
    return JSON.parse(payload) as T
  } catch {
    throw new Error(`${endpoint} 返回了无法解析的 JSON。`)
  }
}
