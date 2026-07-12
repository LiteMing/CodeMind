import type { MindMapApp } from '../app'
import { captureActiveNodeEditorDraft, restoreActiveNodeEditorDraft } from '../interaction/editor'
import { resetHistory } from '../state/ops'
import { api, isRevisionConflictError } from '../api'
import { findRoot, normalizeDocumentSemantics, tidySubtree, touchDocument } from '../document'
import { cloneDocument, downloadTextFile, getErrorMessage, slugify } from '../utils'
import { listLocalSnapshots, saveLocalSnapshot } from '../snapshots'
import type { TranslationKey } from '../i18n'
import type { MindMapDocument } from '../types'

const AUTO_SNAPSHOT_MIN_INTERVAL_MS = 2 * 60 * 1000

export async function saveDocument(
  app: MindMapApp,
  statusKey: TranslationKey,
  values?: Record<string, string | number>,
): Promise<void> {
  if (app.state.revisionConflict) {
    showRevisionConflictStatus(app)
    app.render()
    return
  }
  if (app.saveInFlight) {
    return
  }

  clearAutosave(app)
  const mapId = app.state.currentMapId
  if (!mapId || app.state.document.id !== mapId) {
    return
  }
  const sessionId = app.documentSessionId
  const changeEpoch = app.localChangeEpoch
  const documentToSave = cloneDocument(app.state.document)
  const editorDraft = captureActiveNodeEditorDraft(app)
  app.saveInFlight = true
  try {
    const savedDocument = await api.saveMap(documentToSave)
    if (!isCurrentDocumentSession(app, mapId, sessionId)) {
      return
    }

    const changedDuringSave = app.localChangeEpoch !== changeEpoch
    const editorDraftToRestore = captureActiveNodeEditorDraft(app) ?? editorDraft
    if (changedDuringSave) {
      app.state.document.meta.revision = savedDocument.meta.revision
      app.state.dirty = true
      app.saveQueued = true
    } else {
      app.state.document = savedDocument
      app.state.currentMapId = savedDocument.id
      app.state.dirty = false
      app.state.revisionConflict = null
    }
    app.lastFrontendSaveTime = savedDocument.meta.lastEditedAt || new Date().toISOString()
    app.lastKnownEditTime = app.lastFrontendSaveTime
    try {
      await refreshMaps(app)
    } catch {
      // The document is already committed; a stale map list must not turn a
      // successful save into a retry that increments revision again.
    }
    if (!isCurrentDocumentSession(app, mapId, sessionId)) {
      return
    }
    try {
      maybeSaveAutoSnapshot(app, savedDocument)
    } catch {
      // Local snapshots are optional and must not change save semantics.
    }
    if (!changedDuringSave) {
      app.setStatus(statusKey, values)
    }
    restoreActiveNodeEditorDraft(app, editorDraftToRestore)
  } catch (error) {
    if (isCurrentDocumentSession(app, mapId, sessionId)) {
      app.state.dirty = true
      if (isRevisionConflictError(error)) {
        app.state.revisionConflict = {
          mapId,
          expectedRevision: documentToSave.meta.revision,
          actualRevision: normalizeConflictRevision(error.actualRevision),
        }
        app.saveQueued = false
        showRevisionConflictStatus(app)
      } else {
        app.setStatus('status.saveFailed', { reason: getErrorMessage(error) })
      }
      restoreActiveNodeEditorDraft(app, captureActiveNodeEditorDraft(app) ?? editorDraft)
    }
  } finally {
    app.saveInFlight = false
    if (app.saveQueued && app.state.dirty && !app.state.revisionConflict) {
      const sameSession = isCurrentDocumentSession(app, mapId, sessionId)
      app.saveQueued = false
      void saveDocument(app, sameSession ? statusKey : 'status.saved', sameSession ? values : undefined)
    }
  }

  app.applyTheme()
  app.render()
}

export async function reloadServerVersion(app: MindMapApp): Promise<void> {
  const conflict = app.state.revisionConflict
  const mapId = app.state.currentMapId
  if (!conflict || !mapId || conflict.mapId !== mapId || app.conflictResolutionInFlight) {
    return
  }
  if (!window.confirm(app.t('dialog.reloadServerVersion'))) {
    return
  }

  clearAutosave(app)
  const sessionId = app.documentSessionId
  const changeEpoch = app.localChangeEpoch
  app.conflictResolutionInFlight = true
  app.render()
  try {
    const serverDocument = await api.loadMap(mapId)
    if (
      !isCurrentDocumentSession(app, mapId, sessionId) ||
      app.state.revisionConflict !== conflict ||
      app.localChangeEpoch !== changeEpoch
    ) {
      app.setStatus('status.conflictResolutionChanged')
      return
    }
    openLoadedDocument(app, serverDocument, 'status.conflictReloaded')
  } catch (error) {
    if (isCurrentDocumentSession(app, mapId, sessionId)) {
      app.setStatus('status.saveFailed', { reason: getErrorMessage(error) })
    }
  } finally {
    app.conflictResolutionInFlight = false
    app.render()
  }
}

export async function overwriteServerVersion(app: MindMapApp): Promise<void> {
  const conflict = app.state.revisionConflict
  const mapId = app.state.currentMapId
  if (!conflict || !mapId || conflict.mapId !== mapId || app.conflictResolutionInFlight) {
    return
  }
  if (!window.confirm(app.t('dialog.overwriteServerVersion'))) {
    return
  }

  clearAutosave(app)
  const sessionId = app.documentSessionId
  const changeEpoch = app.localChangeEpoch
  const localDraft = cloneDocument(app.state.document)
  app.conflictResolutionInFlight = true
  app.render()
  try {
    const serverDocument = await api.loadMap(mapId)
    if (
      !isCurrentDocumentSession(app, mapId, sessionId) ||
      app.state.revisionConflict !== conflict ||
      app.localChangeEpoch !== changeEpoch
    ) {
      app.setStatus('status.conflictResolutionChanged')
      return
    }

    localDraft.meta.revision = serverDocument.meta.revision
    const savedDocument = await api.saveMap(localDraft)
    if (!isCurrentDocumentSession(app, mapId, sessionId) || app.state.revisionConflict !== conflict) {
      return
    }

    app.state.revisionConflict = null
    app.lastFrontendSaveTime = savedDocument.meta.lastEditedAt || new Date().toISOString()
    app.lastKnownEditTime = app.lastFrontendSaveTime
    if (app.localChangeEpoch === changeEpoch) {
      app.state.document = savedDocument
      app.state.dirty = false
      app.setStatus('status.conflictOverwritten')
    } else {
      app.state.document.meta.revision = savedDocument.meta.revision
      app.state.dirty = true
      app.saveQueued = true
    }
    try {
      await refreshMaps(app)
    } catch {
      // The overwrite has already committed successfully.
    }
    try {
      maybeSaveAutoSnapshot(app, savedDocument)
    } catch {
      // Local snapshots are optional and must not change conflict recovery.
    }
  } catch (error) {
    if (isCurrentDocumentSession(app, mapId, sessionId)) {
      app.state.dirty = true
      if (isRevisionConflictError(error)) {
        app.state.revisionConflict = {
          mapId,
          expectedRevision: localDraft.meta.revision,
          actualRevision: normalizeConflictRevision(error.actualRevision),
        }
        showRevisionConflictStatus(app)
      } else {
        app.setStatus('status.saveFailed', { reason: getErrorMessage(error) })
      }
    }
  } finally {
    app.conflictResolutionInFlight = false
    if (
      app.saveQueued &&
      app.state.dirty &&
      !app.state.revisionConflict &&
      isCurrentDocumentSession(app, mapId, sessionId)
    ) {
      app.saveQueued = false
      scheduleAutosave(app, 'status.saved')
    }
    app.applyTheme()
    app.render()
  }
}

export function saveSnapshot(app: MindMapApp, mode: 'manual' | 'auto'): void {
  const mapId = app.state.currentMapId
  if (!mapId) {
    return
  }

  saveLocalSnapshot({
    mapId,
    title: app.resolveSnapshotTitle(mode),
    mapTitle: app.state.document.title,
    mode,
    document: app.state.document,
  })

  if (mode === 'manual') {
    app.state.snapshotDraftName = ''
    app.setStatus('status.snapshotSaved')
    app.render()
  }
}

export function maybeSaveAutoSnapshot(app: MindMapApp, document: MindMapDocument): void {
  if (!app.state.preferences.interaction.autoSnapshots) {
    return
  }

  const mapId = document.id || app.state.currentMapId
  if (!mapId) {
    return
  }

  const latestAutoSnapshot = listLocalSnapshots(mapId).find((snapshot) => snapshot.mode === 'auto')
  if (latestAutoSnapshot && Date.now() - Date.parse(latestAutoSnapshot.createdAt) < AUTO_SNAPSHOT_MIN_INTERVAL_MS) {
    return
  }

  saveLocalSnapshot({
    mapId,
    title: app.resolveSnapshotTitle('auto', document.title),
    mapTitle: document.title,
    mode: 'auto',
    document,
  })
}

export async function exportMarkdown(app: MindMapApp): Promise<void> {
  try {
    const markdown = await api.exportMarkdown(app.state.document)
    downloadTextFile(`${slugify(app.state.document.title || 'code-mind')}.md`, markdown)
    app.setStatus('status.exported')
  } catch (error) {
    app.setStatus('status.exportFailed', { reason: getErrorMessage(error) })
  }

  app.render()
}

export async function refreshMaps(app: MindMapApp, statusKey?: TranslationKey): Promise<void> {
  const maps = await api.listMaps()
  app.state.maps = maps
  if (statusKey) {
    app.setStatus(statusKey)
  }
}

export async function createMap(app: MindMapApp): Promise<void> {
  const title = window.prompt(app.t('dialog.newMapTitle'), app.t('node.untitled')) ?? ''
  const doc = await api.createMap(title)
  await refreshMaps(app)
  openLoadedDocument(app, doc, 'status.mapCreated')
  app.render()
}

export async function openMap(app: MindMapApp, mapId: string): Promise<void> {
  const doc = await api.loadMap(mapId)
  openLoadedDocument(app, doc, 'status.loaded')
  app.render()
}

export async function goHome(app: MindMapApp): Promise<void> {
  await refreshMaps(app, 'status.mapListLoaded')
  stopPolling(app)
  clearAutosave(app)
  app.documentSessionId += 1
  app.localChangeEpoch = 0
  app.saveQueued = false
  app.state.view = 'home'
  app.state.currentMapId = null
  app.state.dirty = false
  app.state.revisionConflict = null
  app.state.snapshotDraftName = ''
  app.state.ai.open = false
  app.state.graph.open = false
  app.stopGraphAnimation()
  app.destroyMinimap()
  app.uxEngine.destroy()
  app.refs = null
  resetHistory(app)
  app.render()
}

export async function renameMap(app: MindMapApp, mapId: string): Promise<void> {
  const currentTitle =
    app.state.currentMapId === mapId ? app.state.document.title : (app.findMapSummary(mapId)?.title ?? '')
  const nextTitle = window.prompt(app.t('dialog.renameMap'), currentTitle)
  if (nextTitle === null) {
    return
  }

  const revision = resolveMapRevision(app, mapId)
  if (revision === null) {
    app.setStatus('status.saveFailed', { reason: 'missing document revision' })
    app.render()
    return
  }
  try {
    const doc = await api.renameMap(mapId, nextTitle, revision)
    await refreshMaps(app)
    if (app.state.currentMapId === mapId) {
      app.state.document = doc
      resetHistory(app)
    }
    app.setStatus('status.mapRenamed')
  } catch (error) {
    setMapMutationErrorStatus(app, error)
  }
  app.render()
}

export async function deleteMap(app: MindMapApp, mapId: string): Promise<void> {
  if (!window.confirm(app.t('dialog.deleteMap'))) {
    return
  }

  const revision = resolveMapRevision(app, mapId)
  if (revision === null) {
    app.setStatus('status.saveFailed', { reason: 'missing document revision' })
    app.render()
    return
  }
  try {
    await api.deleteMap(mapId, revision)
    await refreshMaps(app)

    if (app.state.currentMapId === mapId || app.state.view === 'home') {
      clearAutosave(app)
      app.documentSessionId += 1
      app.localChangeEpoch = 0
      app.saveQueued = false
      app.state.view = 'home'
      app.state.currentMapId = null
      app.state.dirty = false
      app.state.revisionConflict = null
      app.refs = null
      resetHistory(app)
    }

    app.setStatus('status.mapDeleted')
  } catch (error) {
    setMapMutationErrorStatus(app, error)
  }
  app.render()
}

function resolveMapRevision(app: MindMapApp, mapId: string): number | null {
  if (app.state.currentMapId === mapId) {
    return app.state.document.meta.revision
  }
  return app.findMapSummary(mapId)?.revision ?? null
}

function setMapMutationErrorStatus(app: MindMapApp, error: unknown): void {
  if (isRevisionConflictError(error)) {
    app.setStatus('status.saveConflict', { revision: error.actualRevision ?? '?' })
    return
  }
  app.setStatus('status.saveFailed', { reason: getErrorMessage(error) })
}

export function openLoadedDocument(app: MindMapApp, document: MindMapDocument, statusKey: TranslationKey): void {
  clearAutosave(app)
  const normalizedDocument = normalizeDocumentSemantics(document)
  app.documentSessionId += 1
  app.localChangeEpoch = 0
  app.saveQueued = false
  app.state.document = normalizedDocument
  app.state.currentMapId = normalizedDocument.id
  app.state.snapshotDraftName = ''
  app.state.view = 'map'
  app.state.dirty = false
  app.state.revisionConflict = null
  app.state.ai.open = false
  app.state.graph.open = false
  app.stopGraphAnimation()
  app.setSelection([findRoot(normalizedDocument).id], findRoot(normalizedDocument).id)
  app.state.connectSourceNodeId = null
  app.state.resize = null
  app.state.regionResize = null
  app.didInitializeViewport = false
  app.refs = null
  resetHistory(app)
  app.setStatus(statusKey)
  startPolling(app)
}

export async function saveCollabApiKey(app: MindMapApp): Promise<void> {
  try {
    api.setOwnerApiKey(app.collabApiKey)
    await api.saveSettings({ collabApiKey: app.collabApiKey })
    app.setStatus('settings.collabApiKeySaved')
  } catch (error) {
    app.setStatus('settings.collabApiKeySaveFailed', { reason: getErrorMessage(error) })
  }
  app.render()
}

export function startPolling(app: MindMapApp): void {
  stopPolling(app)
  if (!app.state.currentMapId) {
    return
  }
  app.lastKnownEditTime = app.state.document.meta.lastEditedAt || new Date().toISOString()
  app.lastFrontendSaveTime = app.lastKnownEditTime
  app.pollHandle = window.setInterval(() => {
    void pollForAPIChanges(app)
  }, 2000)
}

export function stopPolling(app: MindMapApp): void {
  if (app.pollHandle !== null) {
    window.clearInterval(app.pollHandle)
    app.pollHandle = null
  }
}

export async function pollForAPIChanges(app: MindMapApp): Promise<void> {
  const mapId = app.state.currentMapId
  if (
    !mapId ||
    app.state.view !== 'map' ||
    app.state.dirty ||
    app.state.revisionConflict ||
    app.saveInFlight ||
    app.conflictResolutionInFlight
  ) {
    return
  }
  const sessionId = app.documentSessionId
  const changeEpoch = app.localChangeEpoch

  try {
    const result = await api.pollMap(mapId, app.lastKnownEditTime)
    if (!canApplyPollResult(app, mapId, sessionId, changeEpoch)) {
      return
    }
    if (!result.modifiedViaAPI) {
      return
    }

    // Check if the modification is newer than our last frontend save to avoid loops
    const modifiedAt = new Date(result.lastEditedAt).getTime()
    const lastSave = new Date(app.lastFrontendSaveTime).getTime()
    if (modifiedAt <= lastSave) {
      return
    }

    // Store current node IDs before reload
    const previousNodeIds = new Set(app.state.document.nodes.map((n) => n.id))

    // Reload the document from the server
    const doc = await api.loadMap(mapId)
    if (!canApplyPollResult(app, mapId, sessionId, changeEpoch)) {
      return
    }

    // Find newly added nodes
    const newNodeIds = new Set<string>()
    for (const node of doc.nodes) {
      if (!previousNodeIds.has(node.id)) {
        newNodeIds.add(node.id)
      }
    }

    // Update the document
    app.state.document = doc
    app.state.currentMapId = doc.id
    app.lastKnownEditTime = doc.meta.lastEditedAt || new Date().toISOString()
    app.lastFrontendSaveTime = app.lastKnownEditTime

    // Auto-tidy subtrees that received new children
    if (newNodeIds.size > 0) {
      const parentIdsToTidy = new Set<string>()
      for (const node of doc.nodes) {
        if (newNodeIds.has(node.id) && node.parentId) {
          parentIdsToTidy.add(node.parentId)
        }
      }
      for (const parentId of parentIdsToTidy) {
        tidySubtree(doc, parentId, app.state.preferences.appearance.childGapX)
      }
      if (parentIdsToTidy.size > 0) {
        touchDocument(app.state.document)
      }
    }

    // Show toast notification
    app.showAPIToast(app.t('toast.remoteUpdatedMap'))

    // Re-render
    app.render()

    // Apply animation classes to new nodes after render
    if (newNodeIds.size > 0) {
      requestAnimationFrame(() => {
        for (const nodeId of newNodeIds) {
          const el = app.rootEl.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`)
          if (el) {
            el.classList.add('node-api-new')
            el.addEventListener(
              'animationend',
              () => {
                el.classList.remove('node-api-new')
              },
              { once: true },
            )
          }
        }
      })
    }
  } catch {
    // Silently ignore polling errors to avoid spamming the user
  }
}

export function scheduleAutosave(
  app: MindMapApp,
  statusKey: TranslationKey,
  values?: Record<string, string | number>,
): void {
  if (app.autosaveHandle !== null) {
    window.clearTimeout(app.autosaveHandle)
    app.autosaveHandle = null
  }

  app.localChangeEpoch += 1
  app.state.dirty = true

  if (app.state.revisionConflict) {
    showRevisionConflictStatus(app)
    return
  }
  if (app.saveInFlight) {
    app.saveQueued = true
    return
  }

  app.autosaveHandle = window.setTimeout(() => {
    app.autosaveHandle = null
    void saveDocument(app, statusKey, values)
  }, 700)
}

function clearAutosave(app: MindMapApp): void {
  if (app.autosaveHandle !== null) {
    window.clearTimeout(app.autosaveHandle)
    app.autosaveHandle = null
  }
}

function isCurrentDocumentSession(app: MindMapApp, mapId: string, sessionId: number): boolean {
  return app.documentSessionId === sessionId && app.state.currentMapId === mapId && app.state.document.id === mapId
}

function canApplyPollResult(app: MindMapApp, mapId: string, sessionId: number, changeEpoch: number): boolean {
  return (
    isCurrentDocumentSession(app, mapId, sessionId) &&
    app.localChangeEpoch === changeEpoch &&
    !app.state.dirty &&
    !app.state.revisionConflict &&
    !app.saveInFlight &&
    !app.conflictResolutionInFlight
  )
}

function normalizeConflictRevision(revision: number | undefined): number | null {
  return Number.isSafeInteger(revision) && (revision ?? 0) > 0 ? (revision ?? null) : null
}

function showRevisionConflictStatus(app: MindMapApp): void {
  app.setStatus('status.saveConflict', {
    revision: app.state.revisionConflict?.actualRevision ?? '?',
  })
}
