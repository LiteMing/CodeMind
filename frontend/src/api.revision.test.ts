import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, isRevisionConflictError } from './api'
import { createDefaultDocument } from './document'

describe('API revision contract', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('sends If-Match when saving and accepts the incremented revision', async () => {
    const document = createDefaultDocument()
    document.id = 'revision-map'
    document.meta.revision = 7
    const persisted = {
      ...document,
      meta: { ...document.meta, revision: 8 },
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(persisted), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ETag: '"rev-8"' },
      }),
    )

    const saved = await api.saveMap(document)

    const request = fetchMock.mock.calls[0]
    expect(request[1]?.headers).toMatchObject({ 'If-Match': '"rev-7"' })
    expect(saved.meta.revision).toBe(8)
  })

  it('returns a typed revision conflict with the server revision', async () => {
    const document = createDefaultDocument()
    document.id = 'revision-map'
    document.meta.revision = 7
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'revision conflict',
          expectedRevision: 7,
          actualRevision: 8,
        }),
        {
          status: 412,
          headers: { 'Content-Type': 'application/json', ETag: '"rev-8"' },
        },
      ),
    )

    const error = await api.saveMap(document).catch((caught: unknown) => caught)

    expect(isRevisionConflictError(error)).toBe(true)
    if (!isRevisionConflictError(error)) {
      throw new Error('expected revision conflict')
    }
    expect(error.expectedRevision).toBe(7)
    expect(error.actualRevision).toBe(8)
  })

  it('normalizes legacy documents without revision to revision one', async () => {
    const document = createDefaultDocument()
    const legacy = {
      ...document,
      meta: {
        version: 1,
        lastEditedAt: document.meta.lastEditedAt,
        lastOpenedAt: document.meta.lastOpenedAt,
      },
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(legacy), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const loaded = await api.loadMap(document.id)

    expect(loaded.meta.revision).toBe(1)
  })
})
