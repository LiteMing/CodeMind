import type {
  AIGenerateResponse,
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

const API_BASE = resolveApiBase()

export const api = {
  async listMaps(): Promise<MindMapSummary[]> {
    const response = await fetch(`${API_BASE}/maps`)
    if (!response.ok) {
      throw new Error(await readError(response))
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
      throw new Error(await readError(response))
    }

    return normalizeDocument(await readJSON<MindMapDocument>(response, '/api/maps'))
  },

  async loadMap(mapId: string): Promise<MindMapDocument> {
    const response = await fetch(`${API_BASE}/maps/${encodeURIComponent(mapId)}`)
    if (!response.ok) {
      throw new Error(await readError(response))
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
      throw new Error(await readError(response))
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
      throw new Error(await readError(response))
    }

    return normalizeDocument(await readJSON<MindMapDocument>(response, `/api/maps/${encodeURIComponent(mapId)}`))
  },

  async deleteMap(mapId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/maps/${encodeURIComponent(mapId)}`, {
      method: 'DELETE',
    })

    if (!response.ok) {
      throw new Error(await readError(response))
    }
  },

  async exportMarkdown(document: MindMapDocument): Promise<string> {
    const response = await fetch(`${API_BASE}/export/markdown`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(document),
    })

    if (!response.ok) {
      throw new Error(await readError(response))
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
      throw new Error(await readError(response))
    }

    return normalizeDocument(await readJSON<MindMapDocument>(response, '/api/import'))
  },

  async suggestRelations(document: MindMapDocument, settings: AISettings, instructions: string): Promise<AIRelationResponse> {
    const response = await fetch(`${API_BASE}/ai/relations`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        document,
        settings,
        instructions,
      }),
    })

    if (!response.ok) {
      throw new Error(await readError(response))
    }

    return await readJSON<AIRelationResponse>(response, '/api/ai/relations')
  },

  async generateKnowledgeMap(input: {
    topic: string
    template: AITemplateId
    instructions: string
    settings: AISettings
  }): Promise<AIGenerateResponse> {
    const response = await fetch(`${API_BASE}/ai/generate`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(input),
    })

    if (!response.ok) {
      throw new Error(await readError(response))
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
      throw new Error(await readError(response))
    }

    return await readJSON<AITestResponse>(response, '/api/ai/test')
  },
}

function normalizeDocument(document: MindMapDocument): MindMapDocument {
  return {
    ...document,
    nodes: (document.nodes ?? []).map((node) => ({
      ...node,
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

  return '/api'
}

async function readError(response: Response): Promise<string> {
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
  const payload = await response.text()

  if (contentType.includes('application/json')) {
    try {
      const parsed = JSON.parse(payload) as { error?: string }
      if (parsed.error) {
        return parsed.error
      }
    } catch {
      // Ignore malformed error payloads and fall back to generic messaging below.
    }
  }

  if (payload.trim().startsWith('<')) {
    return `${response.status} ${response.statusText}: API 返回了 HTML 页面。请确认 Go 服务已启动在 http://localhost:7979，并重启 Vite 开发服务器。`
  }

  return payload.trim() || `${response.status} ${response.statusText}`
}

async function readJSON<T>(response: Response, endpoint: string): Promise<T> {
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
  const payload = await response.text()

  if (!contentType.includes('application/json')) {
    const suffix = payload.trim().startsWith('<') ? ' 当前收到的是 HTML 页面。' : ''
    throw new Error(`${endpoint} 返回了非 JSON 内容。请确认 Go 服务已启动在 http://localhost:7979，并重启 Vite 开发服务器。${suffix}`)
  }

  try {
    return JSON.parse(payload) as T
  } catch {
    throw new Error(`${endpoint} 返回了无法解析的 JSON。`)
  }
}
