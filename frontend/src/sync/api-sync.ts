import type { MindMapApp } from '../app'
import { captureActiveNodeEditorDraft, restoreActiveNodeEditorDraft } from '../interaction/editor'
import { resetHistory } from '../state/ops'
import { api } from '../api'
import { findRoot, tidySubtree, touchDocument } from '../document'
import { downloadTextFile, getErrorMessage, slugify } from '../utils'
import { listLocalSnapshots, saveLocalSnapshot } from '../snapshots'
import type { TranslationKey } from '../i18n'
import type { MindMapDocument } from '../types'

const AUTO_SNAPSHOT_MIN_INTERVAL_MS = 2 * 60 * 1000

export async function saveDocument(
  app: MindMapApp,
  statusKey: TranslationKey,
  values?: Record<string, string | number>,
): Promise<void> {
  const editorDraft = captureActiveNodeEditorDraft(app)
  try {
    const savedDocument = await api.saveMap(app.state.document)
    app.state.document = savedDocument
    app.state.currentMapId = savedDocument.id
    app.state.dirty = false
    app.lastFrontendSaveTime = savedDocument.meta.lastEditedAt || new Date().toISOString()
    app.lastKnownEditTime = app.lastFrontendSaveTime
    await refreshMaps(app)
    maybeSaveAutoSnapshot(app, savedDocument)
    app.setStatus(statusKey, values)
    restoreActiveNodeEditorDraft(app, editorDraft)
  } catch (error) {
    app.setStatus('status.saveFailed', { reason: getErrorMessage(error) })
    restoreActiveNodeEditorDraft(app, editorDraft)
  }

  app.applyTheme()
  app.render()
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
  app.state.view = 'home'
  app.state.currentMapId = null
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

  const doc = await api.renameMap(mapId, nextTitle)
  await refreshMaps(app)
  if (app.state.currentMapId === mapId) {
    app.state.document = doc
    resetHistory(app)
  }
  app.setStatus('status.mapRenamed')
  app.render()
}

export async function deleteMap(app: MindMapApp, mapId: string): Promise<void> {
  if (!window.confirm(app.t('dialog.deleteMap'))) {
    return
  }

  await api.deleteMap(mapId)
  await refreshMaps(app)

  if (app.state.currentMapId === mapId || app.state.view === 'home') {
    app.state.view = 'home'
    app.state.currentMapId = null
    app.refs = null
    resetHistory(app)
  }

  app.setStatus('status.mapDeleted')
  app.render()
}

export function openLoadedDocument(app: MindMapApp, document: MindMapDocument, statusKey: TranslationKey): void {
  app.state.document = document
  app.state.currentMapId = document.id
  app.state.snapshotDraftName = ''
  app.state.view = 'map'
  app.state.ai.open = false
  app.state.graph.open = false
  app.stopGraphAnimation()
  app.setSelection([findRoot(document).id], findRoot(document).id)
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
  if (!mapId || app.state.view !== 'map') {
    return
  }

  try {
    const result = await api.pollMap(mapId, app.lastKnownEditTime)
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
    app.showAPIToast(app.t('toast.aiUpdatedMap'))

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
  }

  app.state.dirty = true

  app.autosaveHandle = window.setTimeout(() => {
    void saveDocument(app, statusKey, values)
  }, 700)
}
