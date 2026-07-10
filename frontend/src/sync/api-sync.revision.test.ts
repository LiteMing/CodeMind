/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import { createDefaultDocument } from '../document'
import type { MindMapApp } from '../app'

const { conflict } = vi.hoisted(() => ({
  conflict: Object.assign(new Error('revision conflict'), {
    status: 412,
    expectedRevision: 1,
    actualRevision: 2,
  }),
}))

vi.mock('../api', () => ({
  api: {
    saveMap: vi.fn(async () => {
      throw conflict
    }),
  },
  isRevisionConflictError: (error: unknown) => error === conflict,
}))

describe('saveDocument revision conflict', () => {
  it('keeps the local document dirty and reports the server revision', async () => {
    const { saveDocument } = await import('./api-sync')
    const document = createDefaultDocument()
    const setStatus = vi.fn()
    const app = {
      rootEl: documentRoot(),
      state: {
        document,
        currentMapId: document.id,
        editingNodeId: null,
        dirty: false,
      },
      setStatus,
      applyTheme: vi.fn(),
      render: vi.fn(),
    } as unknown as MindMapApp

    await saveDocument(app, 'status.saved')

    expect(app.state.document).toBe(document)
    expect(app.state.dirty).toBe(true)
    expect(setStatus).toHaveBeenCalledWith('status.saveConflict', { revision: 2 })
  })
})

function documentRoot(): HTMLElement {
  const root = window.document.createElement('div')
  window.document.body.appendChild(root)
  return root
}
