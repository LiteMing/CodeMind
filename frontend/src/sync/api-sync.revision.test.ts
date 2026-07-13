/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultDocument } from '../document'
import type { MindMapApp } from '../app'
import type { MindMapDocument } from '../types'
import { cloneDocument } from '../utils'

const mocks = vi.hoisted(() => ({
  saveMap: vi.fn(),
  loadMap: vi.fn(),
  listMaps: vi.fn(async () => []),
  pollMap: vi.fn(),
}))

vi.mock('../api', () => ({
  api: mocks,
  isRevisionConflictError: (error: unknown) =>
    typeof error === 'object' && error !== null && 'status' in error && error.status === 412,
}))

describe('revision conflict recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.listMaps.mockResolvedValue([])
    window.confirm = vi.fn(() => true)
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('keeps the exact local draft dirty and latches the server revision after 412', async () => {
    const { saveDocument } = await import('./api-sync')
    const document = createDocument('Local draft', 1)
    const app = createAppStub(document)
    mocks.saveMap.mockRejectedValueOnce(revisionConflict(1, 2))

    await saveDocument(app, 'status.saved')

    expect(app.state.document).toBe(document)
    expect(app.state.document.title).toBe('Local draft')
    expect(app.state.dirty).toBe(true)
    expect(app.state.revisionConflict).toEqual({ mapId: document.id, expectedRevision: 1, actualRevision: 2 })
    expect(app.setStatus).toHaveBeenCalledWith('status.saveConflict', { revision: 2 })
  })

  it('does not issue repeated autosaves while a conflict is latched', async () => {
    const { saveDocument, scheduleAutosave } = await import('./api-sync')
    const document = createDocument('Local draft', 1)
    const app = createAppStub(document)
    mocks.saveMap.mockRejectedValueOnce(revisionConflict(1, 2))

    await saveDocument(app, 'status.saved')
    app.state.document.title = 'Edited again'
    scheduleAutosave(app, 'status.saved')
    await vi.advanceTimersByTimeAsync(1000)

    expect(mocks.saveMap).toHaveBeenCalledTimes(1)
    expect(app.state.document.title).toBe('Edited again')
    expect(app.state.dirty).toBe(true)
  })

  it('rebases disjoint local and remote changes after a 412 and retries once', async () => {
    const { saveDocument } = await import('./api-sync')
    const base = createDocument('Base', 1)
    const local = cloneDocument(base)
    local.nodes[0].note = 'Local note'
    const remote = cloneDocument(base)
    remote.title = 'Remote title'
    remote.meta.revision = 2
    const app = createAppStub(local)
    app.lastSyncedDocument = cloneDocument(base)
    app.state.dirty = true
    mocks.saveMap
      .mockRejectedValueOnce(revisionConflict(1, 2))
      .mockImplementationOnce(async (submitted: MindMapDocument) => ({
        ...submitted,
        meta: { ...submitted.meta, revision: 3 },
      }))
    mocks.loadMap.mockResolvedValueOnce(remote)

    await saveDocument(app, 'status.saved')

    expect(mocks.saveMap).toHaveBeenCalledTimes(2)
    const rebased = mocks.saveMap.mock.calls[1][0] as MindMapDocument
    expect(rebased.title).toBe('Remote title')
    expect(rebased.nodes[0].note).toBe('Local note')
    expect(rebased.meta.revision).toBe(2)
    expect(app.state.document.title).toBe('Remote title')
    expect(app.state.document.nodes[0].note).toBe('Local note')
    expect(app.state.document.meta.revision).toBe(3)
    expect(app.lastSyncedDocument?.meta.revision).toBe(3)
    expect(app.state.dirty).toBe(false)
    expect(app.state.revisionConflict).toBeNull()
    expect(app.setStatus).toHaveBeenCalledWith('status.rebasedSaved', undefined)
  })

  it('keeps the local draft conflicted when both sides changed the same field', async () => {
    const { saveDocument } = await import('./api-sync')
    const base = createDocument('Base', 1)
    const local = cloneDocument(base)
    local.nodes[0].title = 'Local title'
    const remote = cloneDocument(base)
    remote.nodes[0].title = 'Remote title'
    remote.meta.revision = 2
    const app = createAppStub(local)
    app.lastSyncedDocument = cloneDocument(base)
    app.state.dirty = true
    mocks.saveMap.mockRejectedValueOnce(revisionConflict(1, 2))
    mocks.loadMap.mockResolvedValueOnce(remote)

    await saveDocument(app, 'status.saved')

    expect(mocks.saveMap).toHaveBeenCalledTimes(1)
    expect(app.state.document).toBe(local)
    expect(app.state.document.nodes[0].title).toBe('Local title')
    expect(app.state.document.meta.revision).toBe(1)
    expect(app.state.dirty).toBe(true)
    expect(app.state.revisionConflict).toEqual({ mapId: local.id, expectedRevision: 1, actualRevision: 2 })
  })

  it('does not retry more than once when the rebased save also conflicts', async () => {
    const { saveDocument } = await import('./api-sync')
    const base = createDocument('Base', 1)
    const local = cloneDocument(base)
    local.nodes[0].note = 'Local note'
    const remote = cloneDocument(base)
    remote.title = 'Remote title'
    remote.meta.revision = 2
    const app = createAppStub(local)
    app.lastSyncedDocument = cloneDocument(base)
    app.state.dirty = true
    mocks.saveMap.mockRejectedValueOnce(revisionConflict(1, 2)).mockRejectedValueOnce(revisionConflict(2, 3))
    mocks.loadMap.mockResolvedValueOnce(remote)

    await saveDocument(app, 'status.saved')

    expect(mocks.saveMap).toHaveBeenCalledTimes(2)
    expect(mocks.loadMap).toHaveBeenCalledTimes(1)
    expect(app.state.document).toBe(local)
    expect(app.state.document.nodes[0].note).toBe('Local note')
    expect(app.state.document.meta.revision).toBe(1)
    expect(app.state.revisionConflict).toEqual({ mapId: local.id, expectedRevision: 2, actualRevision: 3 })
  })

  it('reloads the server document and clears dirty, conflict, timer, and history', async () => {
    const { reloadServerVersion } = await import('./api-sync')
    const local = createDocument('Local draft', 1)
    const remote = createDocument('Remote version', 4)
    const app = createAppStub(local)
    app.state.dirty = true
    app.state.revisionConflict = { mapId: local.id, expectedRevision: 1, actualRevision: 4 }
    app.autosaveHandle = window.setTimeout(() => {}, 500)
    app.historyPast = [{} as never]
    app.historyFuture = [{} as never]
    mocks.loadMap.mockResolvedValueOnce(remote)

    await reloadServerVersion(app)

    expect(app.state.document.title).toBe('Remote version')
    expect(app.state.document.meta.revision).toBe(4)
    expect(app.state.dirty).toBe(false)
    expect(app.state.revisionConflict).toBeNull()
    expect(app.autosaveHandle).toBeNull()
    expect(app.historyPast).toEqual([])
    expect(app.historyFuture).toEqual([])
    expect(app.setStatus).toHaveBeenCalledWith('status.conflictReloaded')
  })

  it('overwrites with a cloned local draft using the latest server revision', async () => {
    const { overwriteServerVersion } = await import('./api-sync')
    const local = createDocument('Local draft', 1)
    local.nodes[0].note = 'Keep this local note'
    const remote = createDocument('Remote version', 5)
    const saved = createDocument('Local draft', 6)
    saved.nodes[0].note = 'Keep this local note'
    const app = createAppStub(local)
    app.state.dirty = true
    app.state.revisionConflict = { mapId: local.id, expectedRevision: 1, actualRevision: 5 }
    mocks.loadMap.mockResolvedValueOnce(remote)
    mocks.saveMap.mockResolvedValueOnce(saved)

    await overwriteServerVersion(app)

    const submitted = mocks.saveMap.mock.calls[0][0] as MindMapDocument
    expect(submitted).not.toBe(local)
    expect(submitted.meta.revision).toBe(5)
    expect(submitted.title).toBe('Local draft')
    expect(submitted.nodes[0].note).toBe('Keep this local note')
    expect(local.meta.revision).toBe(1)
    expect(app.state.document.meta.revision).toBe(6)
    expect(app.state.dirty).toBe(false)
    expect(app.state.revisionConflict).toBeNull()
  })

  it('keeps the live local draft untouched when overwrite races into another 412', async () => {
    const { overwriteServerVersion } = await import('./api-sync')
    const local = createDocument('Local draft', 1)
    const app = createAppStub(local)
    app.state.dirty = true
    app.state.revisionConflict = { mapId: local.id, expectedRevision: 1, actualRevision: 5 }
    mocks.loadMap.mockResolvedValueOnce(createDocument('Remote version', 5))
    mocks.saveMap.mockRejectedValueOnce(revisionConflict(5, 6))

    await overwriteServerVersion(app)

    expect(app.state.document).toBe(local)
    expect(app.state.document.title).toBe('Local draft')
    expect(app.state.document.meta.revision).toBe(1)
    expect(app.state.dirty).toBe(true)
    expect(app.state.revisionConflict).toEqual({ mapId: local.id, expectedRevision: 5, actualRevision: 6 })
  })

  it('does not let polling replace a dirty or conflicted draft', async () => {
    const { pollForAPIChanges } = await import('./api-sync')
    const app = createAppStub(createDocument('Local draft', 1))
    app.state.dirty = true

    await pollForAPIChanges(app)
    app.state.dirty = false
    app.state.revisionConflict = { mapId: app.state.document.id, expectedRevision: 1, actualRevision: 2 }
    await pollForAPIChanges(app)

    expect(mocks.pollMap).not.toHaveBeenCalled()
    expect(mocks.loadMap).not.toHaveBeenCalled()
    expect(app.state.document.title).toBe('Local draft')
  })

  it('labels a polled server change as a remote update instead of an AI update', async () => {
    const { pollForAPIChanges } = await import('./api-sync')
    const app = createAppStub(createDocument('Local version', 1))
    app.lastKnownEditTime = '2026-07-12T00:00:00.000Z'
    app.lastFrontendSaveTime = '2026-07-12T00:00:00.000Z'
    mocks.pollMap.mockResolvedValueOnce({
      modifiedViaAPI: true,
      lastEditedAt: '2026-07-12T00:00:01.000Z',
    })
    mocks.loadMap.mockResolvedValueOnce(createDocument('Remote version', 2))

    await pollForAPIChanges(app)

    expect(app.showAPIToast).toHaveBeenCalledWith('toast.remoteUpdatedMap')
    expect(app.showAPIToast).not.toHaveBeenCalledWith('toast.aiUpdatedMap')
  })

  it('ignores a reload response when the local draft changes while awaiting it', async () => {
    const { reloadServerVersion, scheduleAutosave } = await import('./api-sync')
    const local = createDocument('Local draft', 1)
    const app = createAppStub(local)
    app.state.dirty = true
    app.state.revisionConflict = { mapId: local.id, expectedRevision: 1, actualRevision: 2 }
    let resolveLoad!: (document: MindMapDocument) => void
    mocks.loadMap.mockReturnValueOnce(
      new Promise<MindMapDocument>((resolve) => {
        resolveLoad = resolve
      }),
    )

    const reload = reloadServerVersion(app)
    app.state.document.title = 'Edited during reload'
    scheduleAutosave(app, 'status.saved')
    resolveLoad(createDocument('Remote version', 2))
    await reload

    expect(app.state.document).toBe(local)
    expect(app.state.document.title).toBe('Edited during reload')
    expect(app.state.revisionConflict).not.toBeNull()
    expect(app.setStatus).toHaveBeenCalledWith('status.conflictResolutionChanged')
  })

  it('preserves edits made during a slow save and follows with one queued save', async () => {
    const { saveDocument, scheduleAutosave } = await import('./api-sync')
    const local = createDocument('Initial draft', 1)
    const app = createAppStub(local)
    app.state.dirty = true
    let resolveFirst!: (document: MindMapDocument) => void
    mocks.saveMap
      .mockReturnValueOnce(
        new Promise<MindMapDocument>((resolve) => {
          resolveFirst = resolve
        }),
      )
      .mockImplementationOnce(async (submitted: MindMapDocument) => ({
        ...submitted,
        meta: { ...submitted.meta, revision: 3 },
      }))

    const firstSave = saveDocument(app, 'status.saved')
    app.state.document.title = 'Edited during save'
    app.state.document.nodes[0].title = 'Edited during save'
    scheduleAutosave(app, 'status.saved')
    resolveFirst(createDocument('Initial draft', 2))
    await firstSave
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.saveMap).toHaveBeenCalledTimes(2)
    const queuedDraft = mocks.saveMap.mock.calls[1][0] as MindMapDocument
    expect(queuedDraft.title).toBe('Edited during save')
    expect(queuedDraft.meta.revision).toBe(2)
    expect(app.state.document.title).toBe('Edited during save')
    expect(app.state.document.meta.revision).toBe(3)
    expect(app.state.dirty).toBe(false)
  })

  it('queues edits from a newly opened map while an older map save is still in flight', async () => {
    const { saveDocument, scheduleAutosave } = await import('./api-sync')
    const firstMap = createDocument('First map', 1)
    const app = createAppStub(firstMap)
    app.state.dirty = true
    let resolveFirst!: (document: MindMapDocument) => void
    mocks.saveMap
      .mockReturnValueOnce(
        new Promise<MindMapDocument>((resolve) => {
          resolveFirst = resolve
        }),
      )
      .mockImplementationOnce(async (submitted: MindMapDocument) => ({
        ...submitted,
        meta: { ...submitted.meta, revision: 2 },
      }))

    const oldSave = saveDocument(app, 'status.saved')
    const secondMap = createDocument('Second map', 1)
    secondMap.id = 'map-second'
    app.documentSessionId += 1
    app.localChangeEpoch = 0
    app.saveQueued = false
    app.state.document = secondMap
    app.state.currentMapId = secondMap.id
    app.state.dirty = false
    secondMap.title = 'Second map edited'
    scheduleAutosave(app, 'status.saved')
    resolveFirst(createDocument('First map', 2))
    await oldSave
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.saveMap).toHaveBeenCalledTimes(2)
    const queuedDraft = mocks.saveMap.mock.calls[1][0] as MindMapDocument
    expect(queuedDraft.id).toBe('map-second')
    expect(queuedDraft.title).toBe('Second map edited')
    expect(app.state.document.id).toBe('map-second')
    expect(app.state.dirty).toBe(false)
  })
})

function createDocument(title: string, revision: number): MindMapDocument {
  const document = createDefaultDocument()
  document.id = 'map-conflict'
  document.title = title
  document.nodes[0].title = title
  document.meta.revision = revision
  return document
}

function revisionConflict(expectedRevision: number, actualRevision: number): Error {
  return Object.assign(new Error('revision conflict'), {
    status: 412,
    expectedRevision,
    actualRevision,
  })
}

function createAppStub(document: MindMapDocument): MindMapApp {
  const rootEl = window.document.createElement('div')
  window.document.body.appendChild(rootEl)
  return {
    rootEl,
    autosaveHandle: null,
    pollHandle: null,
    localChangeEpoch: 0,
    documentSessionId: 1,
    saveInFlight: false,
    saveQueued: false,
    conflictResolutionInFlight: false,
    historyPast: [],
    historyFuture: [],
    refs: null,
    didInitializeViewport: false,
    lastKnownEditTime: document.meta.lastEditedAt,
    lastFrontendSaveTime: document.meta.lastEditedAt,
    lastSyncedDocument: null,
    state: {
      document,
      currentMapId: document.id,
      view: 'map',
      editingNodeId: null,
      dirty: false,
      revisionConflict: null,
      snapshotDraftName: '',
      ai: { open: false },
      graph: { open: false },
      connectSourceNodeId: null,
      resize: null,
      regionResize: null,
      preferences: {
        interaction: { autoSnapshots: false },
        appearance: { childGapX: 280 },
      },
    },
    t: vi.fn((key: string) => key),
    setStatus: vi.fn(),
    setSelection: vi.fn(),
    stopGraphAnimation: vi.fn(),
    showAPIToast: vi.fn(),
    applyTheme: vi.fn(),
    render: vi.fn(),
  } as unknown as MindMapApp
}
