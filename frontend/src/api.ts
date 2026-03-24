import type {
  AIDebugInfo,
  AIDebugRequest,
  AIGenerateResponse,
  AINodeNotesResponse,
  AIRelationResponse,
  AITestResponse,
  AITemplateId,
  AISettings,
  MindMapDocument,
  MindMapSummary,
} from './types'

const JSON_HEADERS = {
  'Content-Type': 'application/json',
}

const DESKTOP_API_BASE = 'http://127.0.0.1:34117/api'
const API_BASE = resolveApiBase()
const DEV_BACKEND_HINT =
  '当前 AI 请求会先访问本地 Go API，再由 Go API 转发到模型服务。开发模式请在项目根目录运行 `npm run dev`，或至少同时运行 `go run ./cmd/server` 和 `cd frontend && npm run dev`。'

export const api = {
  async listMaps(): Promise<MindMapSummary[]> {
    const response = await fetch(`${API_BASE}/maps`)
    if (!response.ok) {
      throw await createAPIError(response)
    }

    const payload = await readJSON<MindMapSummary[]>(response, '/api/maps')
    return payload ?? []
  },

  async createMap(title = ''): Promise<MindMapDocument> {
    const response = await fetch(`${API_BASE}/maps`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ title }),
    })

    if (!response.ok) {
      throw await createAPIError(response)
    }

    return normalizeDocument(await readJSON<MindMapDocument>(response, '/api/maps'))
  },

  async loadMap(mapId: string): Promise<MindMapDocument> {
    const response = await fetch(`${API_BASE}/maps/${encodeURIComponent(mapId)}`)
    if (!response.ok) {
      throw await createAPIError(response)
    }

    return normalizeDocument(await readJSON<MindMapDocument>(response, `/api/maps/${encodeURIComponent(mapId)}`))
  },

  async saveMap(document: MindMapDocument): Promise<MindMapDocument> {
    const response = await fetch(`${API_BASE}/maps/${encodeURIComponent(document.id)}`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify(document),
    })

    if (!response.ok) {
      throw await createAPIError(response)
    }

    return normalizeDocument(await readJSON<MindMapDocument>(response, `/api/maps/${encodeURIComponent(document.id)}`))
  },

  async renameMap(mapId: string, title: string): Promise<MindMapDocument> {
    const response = await fetch(`${API_BASE}/maps/${encodeURIComponent(mapId)}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ title }),
    })

    if (!response.ok) {
      throw await createAPIError(response)
    }

    return normalizeDocument(await readJSON<MindMapDocument>(response, `/api/maps/${encodeURIComponent(mapId)}`))
  },

  async deleteMap(mapId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/maps/${encodeURIComponent(mapId)}`, {
      method: 'DELETE',
    })

    if (!response.ok) {
      throw await createAPIError(response)
    }
  },

  async exportMarkdown(document: MindMapDocument): Promise<string> {
    const response = await fetch(`${API_BASE}/export/markdown`, {
      method: 'POST',
      headers: JSON_HEADERS,
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
      headers: JSON_HEADERS,
      body: JSON.stringify({ content, format }),
    })

    if (!response.ok) {
      throw await createAPIError(response)
    }

    return normalizeDocument(await readJSON<MindMapDocument>(response, '/api/import'))
  },

  async suggestRelations(
    document: MindMapDocument,
    settings: AISettings,
    instructions: string,
    debug?: AIDebugRequest,
  ): Promise<AIRelationResponse> {
    const response = await fetch(`${API_BASE}/ai/relations`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        document,
        settings,
        instructions,
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
      headers: JSON_HEADERS,
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
    debug?: AIDebugRequest
  }): Promise<AIGenerateResponse> {
    const response = await fetch(`${API_BASE}/ai/generate`, {
      method: 'POST',
      headers: JSON_HEADERS,
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

  async testAIConnection(settings: AISettings): Promise<AITestResponse> {
    const response = await fetch(`${API_BASE}/ai/test`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ settings }),
    })

    if (!response.ok) {
      throw await createAPIError(response)
    }

    return await readJSON<AITestResponse>(response, '/api/ai/test')
  },
}

class APIError extends Error {
  debug?: AIDebugInfo

  constructor(message: string, debug?: AIDebugInfo) {
    super(message)
    this.name = 'APIError'
    this.debug = debug
  }
}

function normalizeDocument(document: MindMapDocument): MindMapDocument {
  return {
    ...document,
    nodes: (document.nodes ?? []).map((node) => ({
      ...node,
      note: node.note?.trim() ? node.note : undefined,
      width: node.width || undefined,
      height: node.height || undefined,
    })),
    relations: document.relations ?? [],
  }
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
      const parsed = JSON.parse(payload) as { error?: string; debug?: unknown }
      debug = normalizeDebugInfo(parsed.debug)
      if (parsed.error) {
        return new APIError(parsed.error, debug)
      }
    } catch {
      // Ignore malformed error payloads and fall back to generic messaging below.
    }
  }

  if (payload.trim().startsWith('<')) {
    return new APIError(
      `${response.status} ${response.statusText}: API 返回了 HTML 页面，通常表示你当前只启动了前端，或者 \`http://localhost:7979\` 的 Go API 没有正常运行。${DEV_BACKEND_HINT}`,
      debug,
    )
  }

  return new APIError(payload.trim() || `${response.status} ${response.statusText}`, debug)
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
