import type { MindMapApp } from '../app'
import { renderOverlay } from '../render/overlay'
import { renderHeader } from '../render/shell'
import { openLoadedDocument, refreshMaps, scheduleAutosave } from '../sync/api-sync'
import { api } from '../api'
import {
  autoLayoutHierarchy,
  createId,
  createNode,
  findRoot,
  nextChildPosition,
  nextSiblingPosition,
  touchDocument,
} from '../document'
import { clamp, getAIDebugInfo, getErrorMessage } from '../utils'
import { normalizeNodeColor } from '../color-palette'
import { deriveNoteChildTitle, normalizeNodeNote } from '../node-render'
import { normalizedRelationPairKey } from '../templates'
import { renderAIWorkspace } from '../render/ai-panel'
import type { AIDebugAction, AINoteTargetState } from '../app-types'
import type { AIDebugInfo, AIDebugRequest, MindMapDocument, MindNode } from '../types'

export function openAIWheel(app: MindMapApp, nodeId: string, clientX?: number, clientY?: number): void {
  app.state.contextMenu = null
  app.state.fixedMenu = ''
  const fallback = app.nodeClientCenter(nodeId)
  app.state.aiWheel = {
    open: true,
    nodeId,
    clientX: Math.round(clientX ?? fallback.x),
    clientY: Math.round(clientY ?? fallback.y),
  }
  renderHeader(app)
  renderOverlay(app)
}

export function closeAIWheel(app: MindMapApp): void {
  if (!app.state.aiWheel.open) {
    return
  }
  app.state.aiWheel = {
    open: false,
    nodeId: null,
    clientX: 0,
    clientY: 0,
  }
}

export function aiQuickKindLabel(app: MindMapApp, kind: 'children' | 'siblings' | 'notes' | 'relations'): string {
  switch (kind) {
    case 'children':
      return app.t('ai.suggestChildrenAction')
    case 'siblings':
      return app.t('ai.suggestSiblingsAction')
    case 'notes':
      return app.t('ai.notesAction')
    case 'relations':
      return app.t('ai.connectAction')
    default:
      return kind
  }
}

export function syncAIWheelPosition(app: MindMapApp): void {
  if (!app.refs || !app.state.aiWheel.open) {
    return
  }

  const wheel = app.refs.overlayLayer.querySelector<HTMLElement>('[data-ai-wheel]')
  if (!wheel) {
    return
  }

  const stageRect = app.refs.overlayLayer.getBoundingClientRect()
  const wheelRect = wheel.getBoundingClientRect()
  const halfWidth = wheelRect.width / 2
  const halfHeight = wheelRect.height / 2
  const left = clamp(
    app.state.aiWheel.clientX - stageRect.left,
    halfWidth + 12,
    Math.max(halfWidth + 12, stageRect.width - halfWidth - 12),
  )
  const top = clamp(
    app.state.aiWheel.clientY - stageRect.top,
    halfHeight + 12,
    Math.max(halfHeight + 12, stageRect.height - halfHeight - 12),
  )

  wheel.style.left = `${Math.round(left)}px`
  wheel.style.top = `${Math.round(top)}px`
}

export function aiDebugActionLabel(app: MindMapApp, action: AIDebugAction): string {
  switch (action) {
    case 'generate':
      return app.t('ai.generate')
    case 'import':
      return app.t('ai.import')
    case 'notes':
      return app.t('ai.notes')
    case 'relations':
      return app.t('ai.connect')
    default:
      return ''
  }
}

export function aiNoteChildActionLabel(app: MindMapApp): string {
  return app.state.preferences.locale === 'zh-CN' ? '生成注释并添加为下级节点' : 'Generate Notes as Child Nodes'
}

export function aiStatusTone(app: MindMapApp): 'is-busy' | 'is-error' | 'is-ok' | 'is-info' | null {
  switch (app.state.status.key) {
    case 'status.aiRunning':
    case 'status.aiTestingConnection':
      return 'is-busy'
    case 'status.aiFailed':
    case 'status.aiConnectionFailed':
      return 'is-error'
    case 'status.aiRelationsApplied':
    case 'status.aiNotesApplied':
    case 'status.aiConnectionOK':
      return 'is-ok'
    case 'status.aiNoRelations':
    case 'status.aiNoNoteTargets':
    case 'status.aiNoNotes':
    case 'status.aiTopicRequired':
      return 'is-info'
    default:
      return null
  }
}

export async function importFileWithAI(app: MindMapApp, file: File): Promise<void> {
  if (app.state.ai.busy) {
    return
  }

  app.state.ai.busy = true
  app.setStatus('status.aiRunning')
  app.render()

  try {
    const content = await file.text()
    const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
    const result = await api.importDocumentWithAI({
      fileName: file.name,
      format: extension,
      content,
      instructions: app.state.ai.importInstructions,
      settings: app.state.preferences.ai,
      debug: buildAIDebugRequest(app, app.state.ai.importRawRequest),
    })

    app.state.ai.lastSummary = result.summary
    app.state.ai.lastModel = result.model
    captureAIDebug(app, 'import', result.debug)
    await persistGeneratedDocument(app, result.document)
    app.state.ai.open = false
    app.setStatus('status.aiImported', { filename: file.name, count: result.document.nodes.length })
  } catch (error) {
    const reason = getErrorMessage(error)
    captureAIDebug(app, 'import', getAIDebugInfo(error), reason)
    app.setStatus('status.aiFailed', { reason })
  } finally {
    app.state.ai.busy = false
    app.render()
  }
}

export function openAIWorkspace(app: MindMapApp): void {
  if (app.state.panelAnimating.has('ai')) {
    return
  }
  app.state.ai.open = true
  app.state.graph.open = false
  app.stopGraphAnimation()
  app.setStatus('status.aiPanelOpened')
  app.render()
  app.animatePanelIn('ai', app.refs?.aiLayer?.querySelector('.ai-drawer') as HTMLElement | null)
}

export function closeAIWorkspace(app: MindMapApp): void {
  if (!app.state.ai.open) {
    return
  }
  if (app.state.panelAnimating.has('ai')) {
    return
  }

  const drawer = app.refs?.aiLayer?.querySelector('.ai-drawer') as HTMLElement | null
  app.animatePanelOut('ai', drawer, () => {
    app.state.ai.open = false
    app.setStatus('status.aiPanelClosed')
    app.render()
  })
}

export function toggleAIDebug(app: MindMapApp): void {
  app.state.ai.debugOpen = !app.state.ai.debugOpen
  app.render()
}

export function toggleAIRawMode(app: MindMapApp): void {
  app.state.ai.rawMode = !app.state.ai.rawMode
  if (app.state.ai.rawMode) {
    app.state.ai.debugOpen = true
  }
  app.render()
}

export async function testAIConnection(app: MindMapApp): Promise<void> {
  if (app.state.ai.busy || app.state.ai.testing) {
    return
  }

  app.state.ai.testing = true
  app.state.ai.connectionMessage = ''
  app.state.ai.connectionModel = ''
  app.state.ai.connectionOK = null
  app.setStatus('status.aiTestingConnection')
  app.render()

  try {
    const result = await api.testAIConnection(app.state.preferences.ai)
    app.state.ai.connectionOK = result.ok
    app.state.ai.connectionModel = result.model
    app.state.ai.connectionMessage = result.message
    app.setStatus('status.aiConnectionOK', { model: result.model || app.t('common.unknown') })
  } catch (error) {
    const reason = getErrorMessage(error)
    app.state.ai.connectionOK = false
    app.state.ai.connectionModel = ''
    app.state.ai.connectionMessage = reason
    app.setStatus('status.aiConnectionFailed', { reason })
  } finally {
    app.state.ai.testing = false
    app.render()
  }
}

export function resolveAINoteTargets(app: MindMapApp): AINoteTargetState {
  const selectedNodes = app
    .selectedNodeIds()
    .map((nodeId) => app.findNode(nodeId))
    .filter((node): node is MindNode => Boolean(node))
  const selectedNonRootNodes = selectedNodes.filter((node) => node.kind !== 'root')
  if (selectedNonRootNodes.length > 0) {
    return { mode: 'selection', nodes: selectedNonRootNodes }
  }

  const nonRootNodes = app.state.document.nodes.filter((node) => node.kind !== 'root')
  if (nonRootNodes.length > 0) {
    return { mode: 'all', nodes: nonRootNodes }
  }

  const root = findRoot(app.state.document)
  return root.id ? { mode: 'all', nodes: [root] } : { mode: 'all', nodes: [] }
}

export function buildAIDebugRequest(app: MindMapApp, rawRequest: string): AIDebugRequest {
  return {
    rawMode: app.state.ai.rawMode,
    rawRequest: app.state.ai.rawMode ? rawRequest : '',
  }
}

export function captureAIDebug(app: MindMapApp, action: AIDebugAction, debug?: AIDebugInfo, errorMessage = ''): void {
  app.state.ai.lastDebugAction = action
  app.state.ai.lastDebugInfo = debug ?? null
  app.state.ai.lastDebugError = errorMessage

  if (errorMessage && debug) {
    app.state.ai.debugOpen = true
  }
  if (!debug) {
    return
  }

  const request = debug.upstreamRequest.trim()
  if (request) {
    app.storeCapturedRawRequest(action, debug.upstreamRequest)
  }
}

export async function applyAINodeNotes(app: MindMapApp, mode: 'replace' | 'children' = 'replace'): Promise<void> {
  const targets = resolveAINoteTargets(app)
  if (targets.nodes.length === 0) {
    app.setStatus('status.aiNoNoteTargets')
    app.render()
    return
  }

  await applyAINodeNotesForTargets(
    app,
    targets.nodes.map((node) => node.id),
    mode,
  )
}

export async function applyAINodeNotesForTargets(
  app: MindMapApp,
  targetNodeIds: string[],
  mode: 'replace' | 'children' = 'replace',
): Promise<number> {
  if (app.state.ai.busy) {
    return 0
  }

  app.state.ai.busy = true
  app.setStatus('status.aiRunning')
  renderHeader(app)
  renderAIWorkspace(app)

  try {
    const result = await api.completeNodeNotes({
      document: app.state.document,
      settings: app.state.preferences.ai,
      targetNodeIds,
      instructions: app.state.ai.noteInstructions,
      debug: buildAIDebugRequest(app, app.state.ai.noteRawRequest),
    })
    app.state.ai.lastSummary = result.summary
    app.state.ai.lastModel = result.model
    captureAIDebug(app, 'notes', result.debug)

    const nextNotes = result.notes.filter((item) => Boolean(app.findNode(item.id)) && item.note.trim() !== '')
    if (nextNotes.length === 0) {
      app.setStatus('status.aiNoNotes')
      return 0
    }

    let appliedCount = 0

    if (mode === 'children') {
      const preparedChildren = nextNotes
        .map((item) => {
          const parent = app.findNode(item.id)
          const normalizedNote = normalizeNodeNote(item.note)
          if (!parent || !normalizedNote) {
            return null
          }

          return { parent, normalizedNote }
        })
        .filter((item): item is { parent: MindNode; normalizedNote: string } => Boolean(item))

      if (preparedChildren.length === 0) {
        app.setStatus('status.aiNoNotes')
        return 0
      }

      app.captureHistory()
      const createdIds: string[] = []
      for (const { parent, normalizedNote } of preparedChildren) {
        parent.collapsed = false
        parent.updatedAt = new Date().toISOString()
        const childNode = createNode({
          parentId: parent.id,
          kind: 'topic',
          position: nextChildPosition(
            app.state.document,
            parent.id,
            app.state.preferences.appearance.layoutMode,
            app.state.preferences.appearance.childGapX,
          ),
          title: deriveNoteChildTitle(parent, normalizedNote, app.state.preferences.locale),
          color: normalizeNodeColor(parent.color) || undefined,
        })
        childNode.note = normalizedNote
        app.state.document.nodes.push(childNode)
        createdIds.push(childNode.id)
        appliedCount += 1
      }

      autoLayoutHierarchy(
        app.state.document,
        app.state.preferences.appearance.layoutMode,
        app.state.preferences.appearance.childGapX,
      )
      app.setSelection(createdIds, createdIds[0] ?? null)
    } else {
      const changes = nextNotes.filter(
        (item) => normalizeNodeNote(app.findNode(item.id)?.note) !== normalizeNodeNote(item.note),
      )
      if (changes.length === 0) {
        app.setStatus('status.aiNoNotes')
        return 0
      }

      app.captureHistory()
      for (const item of changes) {
        app.updateNode(item.id, (draft) => {
          draft.note = normalizeNodeNote(item.note)
        })
      }
      appliedCount = changes.length
    }

    touchDocument(app.state.document)
    app.setStatus('status.aiNotesApplied', { count: appliedCount })
    app.render()
    scheduleAutosave(app, mode === 'children' ? 'status.childSaveScheduled' : 'status.noteSaveScheduled')
    return appliedCount
  } catch (error) {
    const reason = getErrorMessage(error)
    captureAIDebug(app, 'notes', getAIDebugInfo(error), reason)
    app.setStatus('status.aiFailed', { reason })
    return 0
  } finally {
    app.state.ai.busy = false
    app.render()
  }
}

export async function applyAIRelations(app: MindMapApp): Promise<void> {
  await applyAIRelationsForFocus(app)
}

export async function applyAIRelationsForFocus(app: MindMapApp, focusNodeIds?: string[]): Promise<number> {
  if (app.state.ai.busy) {
    return 0
  }

  app.state.ai.busy = true
  app.setStatus('status.aiRunning')
  renderHeader(app)
  renderAIWorkspace(app)

  try {
    const result = await api.suggestRelations(
      app.state.document,
      app.state.preferences.ai,
      app.state.ai.relationInstructions,
      focusNodeIds,
      buildAIDebugRequest(app, app.state.ai.relationRawRequest),
    )
    app.state.ai.lastSummary = result.summary
    app.state.ai.lastModel = result.model
    captureAIDebug(app, 'relations', result.debug)

    const nextRelations = result.relations.filter((relation) => {
      return Boolean(app.findNode(relation.sourceId) && app.findNode(relation.targetId))
    })
    if (nextRelations.length === 0) {
      app.setStatus('status.aiNoRelations')
      return 0
    }

    app.captureHistory()
    const now = new Date().toISOString()
    const existingPairs = new Set(
      app.state.document.relations.map((relation) => normalizedRelationPairKey(relation.sourceId, relation.targetId)),
    )
    let added = 0
    for (const relation of nextRelations) {
      const key = normalizedRelationPairKey(relation.sourceId, relation.targetId)
      if (existingPairs.has(key)) {
        continue
      }
      existingPairs.add(key)
      app.state.document.relations.push({
        id: createId('rel'),
        sourceId: relation.sourceId,
        targetId: relation.targetId,
        label: relation.label,
        createdAt: now,
        updatedAt: now,
      })
      added += 1
    }

    if (added === 0) {
      app.setStatus('status.aiNoRelations')
      return 0
    }

    touchDocument(app.state.document)
    app.setStatus('status.aiRelationsApplied', { count: added })
    app.render()
    scheduleAutosave(app, 'status.relationSaveScheduled')
    return added
  } catch (error) {
    const reason = getErrorMessage(error)
    captureAIDebug(app, 'relations', getAIDebugInfo(error), reason)
    app.setStatus('status.aiFailed', { reason })
    return 0
  } finally {
    app.state.ai.busy = false
    app.render()
  }
}

export async function generateAIMap(app: MindMapApp): Promise<void> {
  const topic = app.state.ai.topic.trim()
  if (!topic) {
    app.setStatus('status.aiTopicRequired')
    app.render()
    return
  }
  if (app.state.ai.busy) {
    return
  }

  app.state.ai.busy = true
  app.setStatus('status.aiRunning')
  app.render()

  try {
    const result = await api.generateKnowledgeMap({
      topic,
      template: app.state.ai.template,
      instructions: app.state.ai.generationInstructions,
      settings: app.state.preferences.ai,
      mode: 'new',
      debug: buildAIDebugRequest(app, app.state.ai.generateRawRequest),
    })

    app.state.ai.lastSummary = result.summary
    app.state.ai.lastModel = result.model
    captureAIDebug(app, 'generate', result.debug)
    await persistGeneratedDocument(app, result.document)
    app.state.ai.open = false
    app.setStatus('status.aiMapGenerated', { count: result.document.nodes.length })
  } catch (error) {
    const reason = getErrorMessage(error)
    captureAIDebug(app, 'generate', getAIDebugInfo(error), reason)
    app.setStatus('status.aiFailed', { reason })
  } finally {
    app.state.ai.busy = false
    app.render()
  }
}

export async function expandAIMap(app: MindMapApp): Promise<void> {
  const previousNodeCount = app.state.document.nodes.length
  const topic =
    app.state.ai.topic.trim() || app.state.document.title.trim() || findRoot(app.state.document).title.trim()
  if (!topic) {
    app.setStatus('status.aiTopicRequired')
    app.render()
    return
  }
  if (app.state.ai.busy) {
    return
  }

  app.state.ai.busy = true
  app.setStatus('status.aiRunning')
  app.render()

  try {
    const result = await api.generateKnowledgeMap({
      topic,
      template: app.state.ai.template,
      instructions: app.state.ai.generationInstructions,
      settings: app.state.preferences.ai,
      mode: 'expand',
      document: app.state.document,
      debug: buildAIDebugRequest(app, app.state.ai.generateRawRequest),
    })

    app.state.ai.lastSummary = result.summary
    app.state.ai.lastModel = result.model
    captureAIDebug(app, 'generate', result.debug)
    await persistExpandedDocument(app, result.document)
    app.state.ai.open = false
    app.setStatus('status.aiMapExpanded', { count: Math.max(result.document.nodes.length - previousNodeCount, 0) })
  } catch (error) {
    const reason = getErrorMessage(error)
    captureAIDebug(app, 'generate', getAIDebugInfo(error), reason)
    app.setStatus('status.aiFailed', { reason })
  } finally {
    app.state.ai.busy = false
    app.render()
  }
}

export async function applyAISuggestNodes(
  app: MindMapApp,
  targetNodeId: string,
  mode: 'children' | 'siblings' = 'children',
): Promise<number> {
  const selectedNode = app.findNode(targetNodeId)
  if (!selectedNode) {
    app.setStatus('status.aiNoSelection')
    app.render()
    return 0
  }
  if (mode === 'siblings' && !app.canSuggestSiblings(selectedNode.id)) {
    app.setStatus('status.aiNoSiblingTarget')
    app.render()
    return 0
  }
  if (app.state.ai.busy) {
    return 0
  }

  app.state.ai.busy = true
  app.setStatus('status.aiRunning')
  renderHeader(app)

  try {
    const result = await api.suggestChildren({
      document: app.state.document,
      settings: app.state.preferences.ai,
      targetNodeId: selectedNode.id,
      mode,
      instructions: app.state.ai.noteInstructions,
      debug: buildAIDebugRequest(app, app.state.ai.noteRawRequest),
    })
    app.state.ai.lastSummary = result.summary
    app.state.ai.lastModel = result.model
    captureAIDebug(app, 'notes', result.debug)

    const suggestions = result.suggestions.filter((item) => item.title.trim() !== '')
    if (suggestions.length === 0) {
      app.setStatus('status.aiNoSuggestions')
      return 0
    }

    app.captureHistory()
    const createdIds: string[] = []
    const parentId = mode === 'siblings' ? (selectedNode.parentId ?? '') : selectedNode.id
    const parentNode = app.findNode(parentId)
    if (parentNode) {
      parentNode.collapsed = false
      parentNode.updatedAt = new Date().toISOString()
    }
    selectedNode.collapsed = false
    selectedNode.updatedAt = new Date().toISOString()
    for (const suggestion of suggestions) {
      const childNode = createNode({
        parentId,
        kind: 'topic',
        position:
          mode === 'siblings'
            ? nextSiblingPosition(
                app.state.document,
                selectedNode,
                app.state.preferences.appearance.layoutMode,
                app.state.preferences.appearance.childGapX,
              )
            : nextChildPosition(
                app.state.document,
                selectedNode.id,
                app.state.preferences.appearance.layoutMode,
                app.state.preferences.appearance.childGapX,
              ),
        title: suggestion.title,
        color: normalizeNodeColor((parentNode ?? selectedNode).color) || undefined,
      })
      childNode.note = suggestion.note
      app.state.document.nodes.push(childNode)
      createdIds.push(childNode.id)
    }

    autoLayoutHierarchy(
      app.state.document,
      app.state.preferences.appearance.layoutMode,
      app.state.preferences.appearance.childGapX,
    )
    app.setSelection(createdIds, createdIds[0] ?? null)
    touchDocument(app.state.document)
    app.setStatus('status.aiSuggestionsApplied', { count: createdIds.length })
    app.render()
    scheduleAutosave(app, 'status.childSaveScheduled')
    return createdIds.length
  } catch (error) {
    const reason = getErrorMessage(error)
    captureAIDebug(app, 'notes', getAIDebugInfo(error), reason)
    app.setStatus('status.aiFailed', { reason })
    return 0
  } finally {
    app.state.ai.busy = false
    app.render()
  }
}

export async function applyAIQuickAssist(app: MindMapApp, nodeId: string): Promise<void> {
  const selectedNode = app.findNode(nodeId)
  if (!selectedNode) {
    app.setStatus('status.aiNoSelection')
    app.render()
    return
  }
  if (app.state.ai.busy) {
    return
  }

  const quickConfig = app.state.preferences.interaction
  if (
    !quickConfig.aiQuickChildren &&
    !quickConfig.aiQuickSiblings &&
    !quickConfig.aiQuickNotes &&
    !quickConfig.aiQuickRelations
  ) {
    app.setStatus('status.aiQuickDisabled')
    app.render()
    return
  }

  const applied: Array<{ kind: 'children' | 'siblings' | 'notes' | 'relations'; count: number }> = []
  if (quickConfig.aiQuickChildren) {
    const count = await applyAISuggestNodes(app, nodeId, 'children')
    applied.push({ kind: 'children', count })
    if (app.state.status.key === 'status.aiFailed') {
      return
    }
  }
  if (quickConfig.aiQuickSiblings && app.canSuggestSiblings(nodeId)) {
    const count = await applyAISuggestNodes(app, nodeId, 'siblings')
    applied.push({ kind: 'siblings', count })
    if (app.state.status.key === 'status.aiFailed') {
      return
    }
  }
  if (quickConfig.aiQuickNotes) {
    const count = await applyAINodeNotesForTargets(app, [nodeId], 'replace')
    applied.push({ kind: 'notes', count })
    if (app.state.status.key === 'status.aiFailed') {
      return
    }
  }
  if (quickConfig.aiQuickRelations) {
    const count = await applyAIRelationsForFocus(app, [nodeId])
    applied.push({ kind: 'relations', count })
    if (app.state.status.key === 'status.aiFailed') {
      return
    }
  }

  const summary = applied.filter((item) => item.count > 0)
  if (summary.length === 0) {
    app.setStatus('status.aiQuickNoChanges')
    app.render()
    return
  }

  app.setStatus('status.aiQuickApplied', {
    summary: summary.map((item) => `${aiQuickKindLabel(app, item.kind)} ${item.count}`).join(' / '),
  })
  app.render()
}

export function resetAIConnectionFeedback(app: MindMapApp): void {
  app.state.ai.testing = false
  app.state.ai.connectionOK = null
  app.state.ai.connectionMessage = ''
  app.state.ai.connectionModel = ''
}

export async function persistGeneratedDocument(app: MindMapApp, document: MindMapDocument): Promise<void> {
  const created = await api.createMap(document.title)
  const nextDocument: MindMapDocument = {
    ...document,
    id: created.id,
    meta: created.meta,
  }
  const saved = await api.saveMap(nextDocument)
  await refreshMaps(app)
  openLoadedDocument(app, saved, 'status.loaded')
}

export async function persistExpandedDocument(app: MindMapApp, document: MindMapDocument): Promise<void> {
  const baseDocument = app.state.document
  const nextDocument: MindMapDocument = {
    ...document,
    id: baseDocument.id,
    meta: baseDocument.meta,
  }
  const saved = await api.saveMap(nextDocument)
  await refreshMaps(app)
  openLoadedDocument(app, saved, 'status.loaded')
}
