import type { MindMapDocument } from './types'

const JSON_HEADERS = {
  'Content-Type': 'application/json',
}
const API_BASE = resolveApiBase()

export const api = {
  async loadMap(): Promise<MindMapDocument> {
    const response = await fetch(`${API_BASE}/maps/default`)
    if (!response.ok) {
      throw new Error(await readError(response))
    }
    return normalizeDocument((await response.json()) as MindMapDocument)
  },

  async saveMap(document: MindMapDocument): Promise<MindMapDocument> {
    const response = await fetch(`${API_BASE}/maps/default`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify(document),
    })

    if (!response.ok) {
      throw new Error(await readError(response))
    }

    return normalizeDocument((await response.json()) as MindMapDocument)
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

    const payload = (await response.json()) as { content: string }
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

    return normalizeDocument((await response.json()) as MindMapDocument)
  },
}

function normalizeDocument(document: MindMapDocument): MindMapDocument {
  return {
    ...document,
    nodes: document.nodes ?? [],
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
  try {
    const payload = (await response.json()) as { error?: string }
    return payload.error ?? `${response.status} ${response.statusText}`
  } catch {
    return `${response.status} ${response.statusText}`
  }
}
