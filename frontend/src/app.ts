import { api } from './api'
import {
  autoLayoutHierarchy,
  childrenOf,
  connectedRelations,
  createDefaultDocument,
  createId,
  createNode,
  deleteRelation,
  descendantIds,
  findNode,
  findRoot,
  hiddenDescendantCount,
  nextChildPosition,
  nextFloatingPosition,
  nextSiblingPosition,
  toggleCollapse,
  touchDocument,
  updateRelationLabel,
  visibleNodeIds,
} from './document'
import { type TranslationKey, kindLabel, themeLabel, translate } from './i18n'
import { DEFAULT_LM_STUDIO_URL, loadPreferences, savePreferences } from './preferences'
import type {
  AppPreferences,
  Locale,
  MindMapDocument,
  MindMapSummary,
  MindNode,
  Position,
  Priority,
  RelationEdge,
  Theme,
} from './types'

type AppView = 'home' | 'map'

interface DragState {
  nodeId: string
  nodeIds: string[]
  offsetX: number
  offsetY: number
  initialPositions: Record<string, Position>
  historyCaptured: boolean
}

interface PanState {
  pointerId: number
  startX: number
  startY: number
  startViewportX: number
  startViewportY: number
}

interface ResizeState {
  nodeId: string
  startX: number
  startY: number
  startWidth: number
  startHeight: number
  historyCaptured: boolean
}

interface HistorySnapshot {
  document: MindMapDocument
  selectedNodeId: string
  selectedNodeIds: string[]
  connectSourceNodeId: string | null
}

interface ContextMenuState {
  clientX: number
  clientY: number
  nodeId: string | null
}

interface MarqueeState {
  pointerId: number
  button: number
  startClientX: number
  startClientY: number
  currentClientX: number
  currentClientY: number
  active: boolean
}

interface StatusDescriptor {
  key: TranslationKey
  values?: Record<string, string | number>
}

interface AppState {
  view: AppView
  maps: MindMapSummary[]
  document: MindMapDocument
  currentMapId: string | null
  selectedNodeId: string
  selectedNodeIds: string[]
  editingNodeId: string | null
  connectSourceNodeId: string | null
  drag: DragState | null
  resize: ResizeState | null
  contextMenu: ContextMenuState | null
  marquee: MarqueeState | null
  status: StatusDescriptor
  preferences: AppPreferences
  settingsOpen: boolean
  inspectorCollapsed: boolean
}

interface ShellRefs {
  eyebrow: HTMLParagraphElement
  title: HTMLHeadingElement
  status: HTMLParagraphElement
  homeButton: HTMLButtonElement
  renameMapButton: HTMLButtonElement
  deleteMapButton: HTMLButtonElement
  settingsButton: HTMLButtonElement
  panelButton: HTMLButtonElement
  themeButton: HTMLButtonElement
  undoButton: HTMLButtonElement
  redoButton: HTMLButtonElement
  saveButton: HTMLButtonElement
  layoutButton: HTMLButtonElement
  exportButton: HTMLButtonElement
  importButton: HTMLButtonElement
  topbarConnectButton: HTMLButtonElement
  importInput: HTMLInputElement
  scroll: HTMLElement
  canvas: HTMLElement
  edgeLayer: SVGSVGElement
  nodeLayer: HTMLElement
  inspector: HTMLElement
  settingsLayer: HTMLElement
  onboardingLayer: HTMLElement
  dock: HTMLElement
  overlayLayer: HTMLElement
}

const WORKSPACE_MIN_WIDTH = 2400
const WORKSPACE_MIN_HEIGHT = 1600
const WORKSPACE_PADDING = 360
const MIN_ZOOM = 0.4
const MAX_ZOOM = 2.4
const ZOOM_SENSITIVITY = 0.0018
const MIN_NODE_WIDTH = 170
const MIN_NODE_HEIGHT = 52
const HISTORY_LIMIT = 120
const PRIORITY_VALUES: Priority[] = ['', 'P0', 'P1', 'P2', 'P3']

export async function createApp(rootEl: HTMLElement): Promise<void> {
  const app = new MindMapApp(rootEl)
  await app.mount()
}

class MindMapApp {
  private readonly rootEl: HTMLElement
  private autosaveHandle: number | null = null
  private refs: ShellRefs | null = null
  private pan: PanState | null = null
  private didInitializeViewport = false
  private viewport = { x: 0, y: 0, scale: 1 }
  private historyPast: HistorySnapshot[] = []
  private historyFuture: HistorySnapshot[] = []
  private liveCanvasHandle: number | null = null
  private liveNodeIds = new Set<string>()
  private liveNodeDimensionIds = new Set<string>()
  private suppressContextMenuOnce = false
  private state: AppState

  constructor(rootEl: HTMLElement) {
    this.rootEl = rootEl
    this.state = {
      document: createDefaultDocument(),
      view: 'home',
      maps: [],
      currentMapId: null,
      selectedNodeId: 'root',
      selectedNodeIds: ['root'],
      editingNodeId: null,
      connectSourceNodeId: null,
      drag: null,
      resize: null,
      contextMenu: null,
      marquee: null,
      status: { key: 'status.loading' },
      preferences: loadPreferences(),
      settingsOpen: false,
      inspectorCollapsed: true,
    }

    this.applyLocale()
    this.applyTheme()
    this.bindEvents()
  }

  async mount(): Promise<void> {
    try {
      await this.refreshMaps('status.mapListLoaded')
    } catch (error) {
      this.setStatus('status.mapListFailed', { reason: getErrorMessage(error) })
    }

    this.render()
  }

  private bindEvents(): void {
    this.rootEl.addEventListener('click', this.handleClick)
    this.rootEl.addEventListener('contextmenu', this.handleContextMenu)
    this.rootEl.addEventListener('dblclick', this.handleDoubleClick)
    this.rootEl.addEventListener('pointerdown', this.handlePointerDown)
    this.rootEl.addEventListener('keydown', this.handleEditorKeyDown)
    this.rootEl.addEventListener('focusout', this.handleFocusOut, true)
    this.rootEl.addEventListener('change', this.handleChange)
    this.rootEl.addEventListener('wheel', this.handleWheel, { passive: false })
    window.addEventListener('pointermove', this.handlePointerMove)
    window.addEventListener('pointerup', this.handlePointerUp)
    window.addEventListener('pointercancel', this.handlePointerUp)
    window.addEventListener('keydown', this.handleGlobalKeyDown)
  }

  private readonly handleClick = (event: MouseEvent): void => {
    const target = event.target
    if (!(target instanceof HTMLElement)) {
      return
    }

    const closedContextMenu = Boolean(this.state.contextMenu) && !target.closest('[data-context-menu]')
    if (closedContextMenu) {
      this.state.contextMenu = null
    }

    const settingsScrim = target.closest<HTMLElement>('[data-settings-scrim]')
    if (settingsScrim && target === settingsScrim) {
      this.closeSettings()
      return
    }

    const localeOption = target.closest<HTMLElement>('[data-locale-option]')?.dataset.localeOption as Locale | undefined
    if (localeOption) {
      this.setLocale(localeOption, false)
      return
    }

    const command = target.closest<HTMLElement>('[data-command]')?.dataset.command
    if (command) {
      this.state.contextMenu = null
      void this.runCommand(command)
      return
    }

    const priority = target.closest<HTMLElement>('[data-priority]')?.dataset.priority as Priority | undefined
    if (priority !== undefined) {
      this.setPriority(priority)
      return
    }

    if (this.overlayBlocksCanvas()) {
      return
    }

    const nodeButton = target.closest<HTMLElement>('[data-node-button]')
    if (nodeButton?.dataset.nodeButton) {
      const nodeId = nodeButton.dataset.nodeButton
      if (this.state.connectSourceNodeId && this.state.connectSourceNodeId !== nodeId) {
        this.createRelation(this.state.connectSourceNodeId, nodeId)
        return
      }

      if (event.shiftKey) {
        this.selectNodeSubtree(nodeId)
        return
      }

      if (event.ctrlKey || event.metaKey) {
        this.toggleNodeSelection(nodeId)
        return
      }

      this.selectNode(nodeId)
      return
    }

    if (closedContextMenu) {
      this.renderOverlay()
      this.renderHeader()
    }
  }

  private readonly handleContextMenu = (event: MouseEvent): void => {
    if (this.state.view !== 'map' || this.overlayBlocksCanvas()) {
      return
    }

    event.preventDefault()
    if (this.suppressContextMenuOnce) {
      this.suppressContextMenuOnce = false
      return
    }

    const target = event.target
    const element = target instanceof HTMLElement ? target : null
    const nodeId = element?.closest<HTMLElement>('[data-node-button]')?.dataset.nodeButton ?? null
    if (nodeId && !this.state.selectedNodeIds.includes(nodeId)) {
      this.setSelection([nodeId], nodeId)
    }

    this.state.contextMenu = {
      clientX: event.clientX,
      clientY: event.clientY,
      nodeId,
    }
    this.render()
  }

  private readonly handleDoubleClick = (event: MouseEvent): void => {
    if (this.overlayBlocksCanvas()) {
      return
    }

    const target = event.target
    if (!(target instanceof HTMLElement)) {
      return
    }

    const nodeButton = target.closest<HTMLElement>('[data-node-button]')
    if (!nodeButton?.dataset.nodeButton) {
      return
    }

    this.state.editingNodeId = nodeButton.dataset.nodeButton
    this.setSelection([nodeButton.dataset.nodeButton], nodeButton.dataset.nodeButton)
    this.render()
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (this.state.view !== 'map' || this.overlayBlocksCanvas()) {
      return
    }

    const target = event.target
    if (!(target instanceof HTMLElement)) {
      return
    }

    if (event.button === 2) {
      const withinScroll = target.closest<HTMLElement>('[data-workspace-scroll]')
      if (!withinScroll) {
        return
      }

      this.state.contextMenu = null
      this.state.marquee = {
        pointerId: event.pointerId,
        button: event.button,
        startClientX: event.clientX,
        startClientY: event.clientY,
        currentClientX: event.clientX,
        currentClientY: event.clientY,
        active: false,
      }
      this.renderOverlay()
      return
    }

    if (event.button !== 0) {
      return
    }

    const resizeHandle = target.closest<HTMLElement>('[data-node-resizer]')
    const resizeNodeId = resizeHandle?.dataset.nodeResizer
    if (resizeNodeId) {
      const node = this.findNode(resizeNodeId)
      if (!node || node.kind === 'root') {
        return
      }

      this.state.resize = {
        nodeId: resizeNodeId,
        startX: event.clientX,
        startY: event.clientY,
        startWidth: node.width ?? MIN_NODE_WIDTH,
        startHeight: node.height ?? MIN_NODE_HEIGHT,
        historyCaptured: false,
      }
      event.preventDefault()
      return
    }

    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      return
    }

    const nodeButton = target.closest<HTMLElement>('[data-node-button]')
    const nodeId = nodeButton?.dataset.nodeButton
    if (!nodeId) {
      this.tryStartCanvasPan(event, target)
      return
    }

    if (!this.state.selectedNodeIds.includes(nodeId)) {
      this.setSelection([nodeId], nodeId)
    }

    const node = this.findNode(nodeId)
    const dragNodeIds = (this.state.selectedNodeIds.includes(nodeId) ? this.state.selectedNodeIds : [nodeId]).filter((candidateId) => {
      return this.findNode(candidateId)?.kind !== 'root'
    })

    if (!node || dragNodeIds.length === 0 || this.state.editingNodeId === nodeId || this.state.connectSourceNodeId !== null) {
      this.tryStartCanvasPan(event, target)
      return
    }

    const canvas = this.refs?.canvas
    if (!canvas) {
      return
    }

    const pointerPosition = this.clientToCanvasPosition(event.clientX, event.clientY)
    this.state.drag = {
      nodeId,
      nodeIds: dragNodeIds,
      offsetX: pointerPosition.x - node.position.x,
      offsetY: pointerPosition.y - node.position.y,
      initialPositions: Object.fromEntries(
        dragNodeIds
          .map((candidateId) => {
            const candidateNode = this.findNode(candidateId)
            if (!candidateNode) {
              return null
            }
            return [candidateId, { ...candidateNode.position }] as const
          })
          .filter((entry): entry is readonly [string, Position] => entry !== null),
      ),
      historyCaptured: false,
    }
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (this.state.view !== 'map') {
      return
    }

    if (this.state.marquee && event.pointerId === this.state.marquee.pointerId) {
      this.state.marquee.currentClientX = event.clientX
      this.state.marquee.currentClientY = event.clientY
      if (!this.state.marquee.active) {
        const deltaX = event.clientX - this.state.marquee.startClientX
        const deltaY = event.clientY - this.state.marquee.startClientY
        if (Math.hypot(deltaX, deltaY) > 8) {
          this.state.marquee.active = true
        }
      }
      this.renderOverlay()
      if (this.state.marquee.active) {
        event.preventDefault()
      }
      return
    }

    if (this.state.resize) {
      const deltaX = event.clientX - this.state.resize.startX
      const deltaY = event.clientY - this.state.resize.startY
      if (!this.state.resize.historyCaptured && (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1)) {
        this.captureHistory()
        this.state.resize.historyCaptured = true
        this.renderHeader()
      }

      const nextWidth = clampMin(this.state.resize.startWidth + (event.clientX - this.state.resize.startX) / this.viewport.scale, MIN_NODE_WIDTH)
      const nextHeight = clampMin(this.state.resize.startHeight + (event.clientY - this.state.resize.startY) / this.viewport.scale, MIN_NODE_HEIGHT)

      this.updateNode(this.state.resize.nodeId, (node) => {
        node.width = Math.round(nextWidth)
        node.height = Math.round(nextHeight)
      })
      this.scheduleLiveNodeUpdate(this.state.resize.nodeId, true)
      return
    }

    if (this.pan) {
      this.handleCanvasPan(event)
      return
    }

    if (!this.state.drag) {
      return
    }

    const pointerPosition = this.clientToCanvasPosition(event.clientX, event.clientY)
    const nextPosition = {
      x: clampMin(pointerPosition.x - this.state.drag.offsetX, 120),
      y: clampMin(pointerPosition.y - this.state.drag.offsetY, 96),
    }
    const currentNode = this.findNode(this.state.drag.nodeId)

    if (
      currentNode &&
      !this.state.drag.historyCaptured &&
      (Math.abs(nextPosition.x - currentNode.position.x) > 0.5 || Math.abs(nextPosition.y - currentNode.position.y) > 0.5)
    ) {
      this.captureHistory()
      this.state.drag.historyCaptured = true
      this.renderHeader()
    }

    const anchorStart = this.state.drag.initialPositions[this.state.drag.nodeId]
    if (!anchorStart) {
      return
    }

    const deltaX = nextPosition.x - anchorStart.x
    const deltaY = nextPosition.y - anchorStart.y
    for (const candidateId of this.state.drag.nodeIds) {
      const candidateStart = this.state.drag.initialPositions[candidateId]
      if (!candidateStart) {
        continue
      }

      this.updateNode(candidateId, (node) => {
        node.position = {
          x: clampMin(candidateStart.x + deltaX, 120),
          y: clampMin(candidateStart.y + deltaY, 96),
        }
      })
      this.scheduleLiveNodeUpdate(candidateId)
    }
  }

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (this.state.view !== 'map') {
      return
    }

    if (this.state.marquee && event.pointerId === this.state.marquee.pointerId) {
      const marquee = this.state.marquee
      this.state.marquee = null
      if (marquee.active) {
        this.applyMarqueeSelection(marquee)
        this.suppressContextMenuOnce = true
      }
      this.renderOverlay()
      return
    }

    if (this.pan) {
      this.setCanvasPanning(false)
      this.pan = null
    }

    if (this.state.resize) {
      this.flushLiveNodeUpdate()
      const resized = this.state.resize.historyCaptured
      this.state.resize = null
      if (resized) {
        touchDocument(this.state.document)
        this.renderHeader()
        this.scheduleAutosave('status.layoutSaveScheduled')
      }
    }

    if (!this.state.drag) {
      return
    }

    this.flushLiveNodeUpdate()
    const moved = this.state.drag.historyCaptured
    this.state.drag = null
    if (moved) {
      touchDocument(this.state.document)
      this.renderHeader()
      this.scheduleAutosave('status.layoutSaveScheduled')
    }
  }

  private readonly handleWheel = (event: WheelEvent): void => {
    if (this.state.view !== 'map' || this.overlayBlocksCanvas()) {
      return
    }

    const target = event.target
    const scroll = this.refs?.scroll
    if (!(target instanceof HTMLElement) || !target.closest('[data-workspace-scroll]') || !scroll) {
      return
    }

    event.preventDefault()
    const rect = scroll.getBoundingClientRect()
    const pointerX = event.clientX - rect.left
    const pointerY = event.clientY - rect.top
    const worldX = (pointerX - this.viewport.x) / this.viewport.scale
    const worldY = (pointerY - this.viewport.y) / this.viewport.scale
    const zoomFactor = Math.exp(-event.deltaY * ZOOM_SENSITIVITY)
    const nextScale = clamp(this.viewport.scale * zoomFactor, MIN_ZOOM, MAX_ZOOM)

    this.viewport.x = pointerX - worldX * nextScale
    this.viewport.y = pointerY - worldY * nextScale
    this.viewport.scale = nextScale
    this.updateCanvasViewportView()
  }

  private readonly handleGlobalKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.state.settingsOpen) {
      event.preventDefault()
      this.closeSettings()
      return
    }

    if (this.state.view !== 'map' || this.onboardingOpen() || this.state.settingsOpen || isTypingTarget(event.target)) {
      return
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      void this.saveDocument('status.saved')
      return
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
      event.preventDefault()
      this.undo()
      return
    }

    if (
      (event.ctrlKey || event.metaKey) &&
      ((event.key.toLowerCase() === 'y' && !event.shiftKey) || (event.key.toLowerCase() === 'z' && event.shiftKey))
    ) {
      event.preventDefault()
      this.redo()
      return
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
      event.preventDefault()
      this.autoLayout()
      return
    }

    if (event.key === 'Escape' && this.state.connectSourceNodeId) {
      event.preventDefault()
      this.state.connectSourceNodeId = null
      this.setStatus('status.relationModeCancelled')
      this.render()
      return
    }

    const selectedNode = this.selectedNode()
    if (!selectedNode) {
      return
    }

    if (event.key === 'Tab') {
      event.preventDefault()
      this.createChildNode(selectedNode.id)
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      this.createSiblingNode(selectedNode.id)
      return
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      this.deleteSelectedNode()
      return
    }

    if (event.key === 'F2') {
      event.preventDefault()
      this.startEditingSelected()
      return
    }

    if (event.key === ' ') {
      event.preventDefault()
      this.toggleSelectedCollapse()
    }
  }

  private readonly handleEditorKeyDown = (event: KeyboardEvent): void => {
    const target = event.target
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
      return
    }

    if (target instanceof HTMLInputElement && target.dataset.nodeEditor) {
      if (event.key === 'Enter') {
        event.preventDefault()
        this.commitNodeEditor(target.dataset.nodeEditor, target.value)
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        this.state.editingNodeId = null
        this.render()
      }
      return
    }

    if (target instanceof HTMLInputElement && target.dataset.relationLabel) {
      if (event.key === 'Enter') {
        event.preventDefault()
        this.commitRelationLabel(target.dataset.relationLabel, target.value)
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        this.render()
      }
      return
    }

    if (target instanceof HTMLInputElement && target.dataset.settingField && event.key === 'Enter') {
      event.preventDefault()
      target.blur()
    }
  }

  private readonly handleFocusOut = (event: FocusEvent): void => {
    const target = event.target
    if (!(target instanceof HTMLInputElement)) {
      return
    }

    if (target.dataset.nodeEditor) {
      this.commitNodeEditor(target.dataset.nodeEditor, target.value)
      return
    }

    if (target.dataset.relationLabel) {
      this.commitRelationLabel(target.dataset.relationLabel, target.value)
    }
  }

  private readonly handleChange = (event: Event): void => {
    const target = event.target
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
      return
    }

    if (target instanceof HTMLInputElement && target.dataset.importInput) {
      const file = target.files?.[0]
      if (!file) {
        return
      }

      void this.importFile(file)
      target.value = ''
      return
    }

    const field = target.dataset.settingField
    if (field) {
      this.commitSettingField(field, target.value)
    }
  }

  private render(): void {
    this.flushLiveNodeUpdate()
    this.applyLocale()
    this.applyTheme()

    if (this.state.view === 'home') {
      this.renderHome()
      return
    }

    const selectedNode = this.selectedNode()
    if (!selectedNode) {
      return
    }

    this.ensureShell()
    this.renderHeader()
    this.renderWorkspace()
    this.renderInspector()
    this.renderDock()
    this.renderOverlay()
    this.renderSettings()
    this.renderOnboarding()
    this.initializeViewportIfNeeded()
    this.focusEditorIfNeeded()
  }

  private renderHome(): void {
    this.refs = null
    this.rootEl.innerHTML = `
      <div class="home-shell">
        <header class="home-hero">
          <div>
            <p class="eyebrow">${this.t('app.eyebrow')}</p>
            <h1>${this.t('home.title')}</h1>
            <p class="home-copy">${this.t('home.subtitle')}</p>
            <p class="home-status">${this.t(this.state.status.key, this.state.status.values)}</p>
          </div>
          <button type="button" class="action-button primary-action" data-command="create-map">${this.t('home.create')}</button>
        </header>

        <section class="file-grid">
          ${
            this.state.maps.length === 0
              ? `<article class="file-card file-card-empty">
                   <p class="section-label">${this.t('home.title')}</p>
                   <h2>${this.t('home.empty')}</h2>
                   <button type="button" class="action-button" data-command="create-map">${this.t('home.create')}</button>
                 </article>`
              : this.state.maps
                  .map((summary) => {
                    return `
                      <article class="file-card">
                        <div class="file-card-top">
                          <div>
                            <p class="section-label">${summary.id}</p>
                            <h2>${escapeHtml(summary.title)}</h2>
                            <p class="file-meta">${this.t('home.lastEdited', {
                              value: formatRelativeTime(summary.lastEditedAt, this.state.preferences.locale),
                            })}</p>
                          </div>
                        </div>
                        <div class="file-card-actions">
                          <button type="button" class="chip-button" data-command="open-map:${summary.id}">${this.t('home.open')}</button>
                          <button type="button" class="chip-button" data-command="rename-map:${summary.id}">${this.t('home.rename')}</button>
                          <button type="button" class="chip-button danger" data-command="delete-map:${summary.id}">${this.t('home.delete')}</button>
                        </div>
                      </article>
                    `
                  })
                  .join('')
          }
        </section>
      </div>
    `
  }

  private ensureShell(): void {
    if (this.refs) {
      return
    }

    this.rootEl.innerHTML = `
      <div class="app-shell">
        <div class="workspace-stage">
          <section class="floating-bar floating-bar-left project-bar">
            <div class="project-copy">
              <p class="eyebrow" data-app-eyebrow></p>
              <h1 data-app-title></h1>
            </div>
            <p class="status-pill" data-app-status></p>
            <button type="button" class="ghost-button" data-command="go-home">${this.t('toolbar.home')}</button>
          </section>

          <section class="floating-bar floating-bar-center toolbar-cluster">
            <button type="button" class="action-button" data-role="undo-button" data-command="undo"></button>
            <button type="button" class="action-button" data-role="redo-button" data-command="redo"></button>
            <button type="button" class="action-button" data-role="save-button" data-command="save"></button>
            <button type="button" class="action-button" data-role="layout-button" data-command="auto-layout"></button>
            <button type="button" class="action-button" data-role="connect-button" data-command="connect-selected"></button>
            <button type="button" class="action-button" data-role="export-button" data-command="export-markdown"></button>
          </section>

          <section class="floating-bar floating-bar-right toolbar-cluster">
            <button type="button" class="action-button" data-command="rename-map">${this.t('toolbar.renameMap')}</button>
            <button type="button" class="action-button danger" data-command="delete-map">${this.t('toolbar.deleteMap')}</button>
            <button type="button" class="action-button" data-role="panel-button" data-command="toggle-inspector"></button>
            <button type="button" class="action-button" data-role="theme-button" data-command="theme-toggle"></button>
            <button type="button" class="action-button" data-role="settings-button" data-command="toggle-settings"></button>
            <button type="button" class="action-button" data-role="import-button" data-command="import-file"></button>
            <input type="file" accept=".md,.markdown,.txt,text/plain,text/markdown" data-role="import-input" data-import-input hidden />
          </section>

          <section class="workspace-panel">
            <div class="workspace-scroll" data-workspace-scroll>
              <div class="workspace-canvas" data-workspace-canvas>
                <svg class="edge-layer" viewBox="0 0 ${WORKSPACE_MIN_WIDTH} ${WORKSPACE_MIN_HEIGHT}" aria-hidden="true" data-edge-layer></svg>
                <div class="node-layer" data-node-layer></div>
              </div>
            </div>
          </section>

          <aside class="inspector" data-inspector></aside>
          <section class="floating-bar floating-bar-bottom" data-dock></section>
          <div class="overlay-layer" data-overlay-layer></div>
          <div data-settings-layer></div>
          <div data-onboarding-layer></div>
        </div>
      </div>
    `

    this.refs = {
      eyebrow: requiredElement(this.rootEl, '[data-app-eyebrow]'),
      title: requiredElement(this.rootEl, '[data-app-title]'),
      status: requiredElement(this.rootEl, '[data-app-status]'),
      homeButton: requiredElement(this.rootEl, '[data-command="go-home"]'),
      renameMapButton: requiredElement(this.rootEl, '[data-command="rename-map"]'),
      deleteMapButton: requiredElement(this.rootEl, '[data-command="delete-map"]'),
      settingsButton: requiredElement(this.rootEl, '[data-role="settings-button"]'),
      panelButton: requiredElement(this.rootEl, '[data-role="panel-button"]'),
      themeButton: requiredElement(this.rootEl, '[data-role="theme-button"]'),
      undoButton: requiredElement(this.rootEl, '[data-role="undo-button"]'),
      redoButton: requiredElement(this.rootEl, '[data-role="redo-button"]'),
      saveButton: requiredElement(this.rootEl, '[data-role="save-button"]'),
      layoutButton: requiredElement(this.rootEl, '[data-role="layout-button"]'),
      exportButton: requiredElement(this.rootEl, '[data-role="export-button"]'),
      importButton: requiredElement(this.rootEl, '[data-role="import-button"]'),
      topbarConnectButton: requiredElement(this.rootEl, '[data-role="connect-button"]'),
      importInput: requiredElement(this.rootEl, '[data-role="import-input"]'),
      scroll: requiredElement(this.rootEl, '[data-workspace-scroll]'),
      canvas: requiredElement(this.rootEl, '[data-workspace-canvas]'),
      edgeLayer: requiredElement(this.rootEl, '[data-edge-layer]'),
      nodeLayer: requiredElement(this.rootEl, '[data-node-layer]'),
      inspector: requiredElement(this.rootEl, '[data-inspector]'),
      settingsLayer: requiredElement(this.rootEl, '[data-settings-layer]'),
      onboardingLayer: requiredElement(this.rootEl, '[data-onboarding-layer]'),
      dock: requiredElement(this.rootEl, '[data-dock]'),
      overlayLayer: requiredElement(this.rootEl, '[data-overlay-layer]'),
    }
  }

  private renderHeader(): void {
    if (!this.refs) {
      return
    }

    const locale = this.state.preferences.locale
    this.refs.eyebrow.textContent = this.t('app.eyebrow')
    this.refs.title.textContent = this.state.document.title
    this.refs.status.textContent = this.t(this.state.status.key, this.state.status.values)
    this.refs.homeButton.textContent = this.t('toolbar.home')
    this.refs.renameMapButton.textContent = this.t('toolbar.renameMap')
    this.refs.deleteMapButton.textContent = this.t('toolbar.deleteMap')
    this.refs.undoButton.textContent = this.t('toolbar.undo')
    this.refs.redoButton.textContent = this.t('toolbar.redo')
    this.refs.saveButton.textContent = this.t('toolbar.save')
    this.refs.layoutButton.textContent = this.t('toolbar.autoLayout')
    this.refs.exportButton.textContent = this.t('toolbar.exportMarkdown')
    this.refs.importButton.textContent = this.t('toolbar.import')
    this.refs.settingsButton.textContent = this.t('toolbar.settings')
    this.refs.panelButton.textContent = this.t('toolbar.panel')
    this.refs.themeButton.textContent = this.t('toolbar.theme', {
      theme: themeLabel(locale, this.state.document.theme),
    })
    this.refs.topbarConnectButton.textContent = this.t('toolbar.connect')
    this.refs.undoButton.disabled = !this.canUndo()
    this.refs.redoButton.disabled = !this.canRedo()
    this.refs.topbarConnectButton.classList.toggle('is-active', this.state.connectSourceNodeId !== null)
    this.refs.settingsButton.classList.toggle('is-active', this.state.settingsOpen)
    this.refs.panelButton.classList.toggle('is-active', !this.state.inspectorCollapsed)
    document.title = `${this.state.document.title} - Code Mind`
  }

  private renderWorkspace(): void {
    if (!this.refs) {
      return
    }

    const bounds = getWorkspaceBounds(this.state.document)
    this.refs.canvas.style.width = `${bounds.width}px`
    this.refs.canvas.style.height = `${bounds.height}px`
    this.refs.edgeLayer.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`)
    this.updateCanvasViewportView()
    this.refs.scroll.classList.toggle('is-marqueeing', Boolean(this.state.marquee))
    this.refs.edgeLayer.innerHTML = this.renderEdges()
    this.refs.nodeLayer.innerHTML = this.renderNodes()
  }

  private renderInspector(): void {
    const selectedNode = this.selectedNode()
    if (!selectedNode || !this.refs) {
      return
    }

    const relatedRelations = connectedRelations(this.state.document, selectedNode.id)
    const directChildren = childrenOf(this.state.document, selectedNode.id)
    const hiddenChildren = hiddenDescendantCount(this.state.document, selectedNode.id)
    const selectedCount = this.selectedNodeIds().length
    const singleSelection = selectedCount === 1
    const canDeleteSelection = this.selectedNodeIds().some((nodeId) => this.findNode(nodeId)?.kind !== 'root')
    const relationModeText = this.state.connectSourceNodeId
      ? this.t('inspector.relationConnecting', {
          title: this.findNode(this.state.connectSourceNodeId)?.title ?? this.t('common.unknown'),
        })
      : this.t('inspector.relationIdle')

    this.refs.inspector.classList.toggle('is-collapsed', this.state.inspectorCollapsed)
    this.refs.inspector.innerHTML = this.state.inspectorCollapsed
      ? `
        <section class="inspector-card inspector-card-compact">
          <p class="section-label">${this.t('inspector.summary')}</p>
          <h2>${escapeHtml(shorten(singleSelection ? selectedNode.title : this.t('context.selectionCount', { value: selectedCount }), 24))}</h2>
          <div class="metric-row">
            <span class="metric-chip">${this.t('dock.selected', { value: selectedCount })}</span>
            <span class="metric-chip">${this.t('inspector.children', { value: directChildren.length })}</span>
            <span class="metric-chip">${this.t('inspector.relationsCount', { value: relatedRelations.length })}</span>
          </div>
          <button type="button" class="action-button inspector-toggle-button" data-command="toggle-inspector">${this.t('inspector.open')}</button>
        </section>
      `
      : `
        <section class="inspector-card">
          <div class="inspector-header">
            <div>
              <p class="section-label">${this.t('inspector.selected')}</p>
              <h2>${escapeHtml(singleSelection ? selectedNode.title : this.t('context.selectionCount', { value: selectedCount }))}</h2>
            </div>
            <button type="button" class="ghost-button" data-command="toggle-inspector">${this.t('inspector.close')}</button>
          </div>
          <div class="metric-row">
            <span class="metric-chip">${this.t('dock.selected', { value: selectedCount })}</span>
            <span class="metric-chip">${this.t('inspector.type', { value: kindLabel(this.state.preferences.locale, selectedNode.kind) })}</span>
            <span class="metric-chip">${this.t('inspector.children', { value: directChildren.length })}</span>
            <span class="metric-chip">${this.t('inspector.relationsCount', { value: relatedRelations.length })}</span>
            <span class="metric-chip">${this.t('inspector.hidden', { value: hiddenChildren })}</span>
          </div>
          <p class="inspector-copy">${this.t('inspector.position', {
            x: Math.round(selectedNode.position.x),
            y: Math.round(selectedNode.position.y),
          })}</p>
          <div class="priority-row">
            ${PRIORITY_VALUES.map((priority) => this.renderPriorityButton(priority, selectedNode.priority ?? '')).join('')}
          </div>
          <div class="action-grid">
            <button type="button" class="chip-button" data-command="new-child" ${singleSelection ? '' : 'disabled'}>${this.t('action.newChild')}</button>
            <button type="button" class="chip-button" data-command="new-sibling" ${singleSelection ? '' : 'disabled'}>${this.t('action.newSibling')}</button>
            <button type="button" class="chip-button" data-command="rename-selected" ${singleSelection ? '' : 'disabled'}>${this.t('action.rename')}</button>
            <button type="button" class="chip-button" data-command="toggle-collapse" ${singleSelection && directChildren.length > 0 ? '' : 'disabled'}>
              ${selectedNode.collapsed ? this.t('action.expand') : this.t('action.collapse')}
            </button>
            <button type="button" class="chip-button ${this.state.connectSourceNodeId ? 'is-active' : ''}" data-command="connect-selected" ${singleSelection ? '' : 'disabled'}>${this.t('action.linkRelation')}</button>
            <button type="button" class="chip-button danger" data-command="delete-selected" ${canDeleteSelection ? '' : 'disabled'}>${this.t('action.delete')}</button>
          </div>
        </section>

        <section class="inspector-card">
          <p class="section-label">${this.t('inspector.relations')}</p>
          <p class="inspector-copy">${escapeHtml(relationModeText)}</p>
          ${this.renderRelationList(selectedNode.id)}
        </section>
      `
  }

  private renderDock(): void {
    if (!this.refs) {
      return
    }

    this.refs.dock.innerHTML = `
      <span class="dock-chip">${this.t('dock.selected', { value: this.selectedNodeIds().length })}</span>
      <span class="dock-chip">${this.t('dock.nodes', { value: this.state.document.nodes.length })}</span>
      <span class="dock-chip">${this.t('dock.relations', { value: this.state.document.relations.length })}</span>
      <span class="dock-chip">${Math.round(this.viewport.scale * 100)}%</span>
      <span class="dock-chip">${this.t('dock.theme', { value: themeLabel(this.state.preferences.locale, this.state.document.theme) })}</span>
    `
  }

  private renderOverlay(): void {
    if (!this.refs) {
      return
    }

    if (this.overlayBlocksCanvas()) {
      this.refs.overlayLayer.innerHTML = ''
      this.refs.overlayLayer.classList.remove('is-visible')
      return
    }

    const marqueeMarkup = this.state.marquee?.active ? this.renderMarqueeBox(this.state.marquee) : ''
    const contextMenuMarkup = this.state.contextMenu ? this.renderContextMenu() : ''

    this.refs.overlayLayer.classList.toggle('is-visible', Boolean(marqueeMarkup || contextMenuMarkup))
    this.refs.overlayLayer.innerHTML = `${marqueeMarkup}${contextMenuMarkup}`
  }

  private renderMarqueeBox(marquee: MarqueeState): string {
    const left = Math.min(marquee.startClientX, marquee.currentClientX)
    const top = Math.min(marquee.startClientY, marquee.currentClientY)
    const width = Math.abs(marquee.currentClientX - marquee.startClientX)
    const height = Math.abs(marquee.currentClientY - marquee.startClientY)
    const stageRect = this.refs?.overlayLayer.getBoundingClientRect()
    if (!stageRect) {
      return ''
    }

    return `
      <div
        class="marquee-box"
        style="left: ${Math.round(left - stageRect.left)}px; top: ${Math.round(top - stageRect.top)}px; width: ${Math.round(width)}px; height: ${Math.round(height)}px;"
      ></div>
    `
  }

  private renderContextMenu(): string {
    if (!this.refs || !this.state.contextMenu) {
      return ''
    }

    const stageRect = this.refs.overlayLayer.getBoundingClientRect()
    const estimatedWidth = 236
    const estimatedHeight = 320
    const left = clamp(this.state.contextMenu.clientX - stageRect.left, 12, Math.max(12, stageRect.width - estimatedWidth - 12))
    const top = clamp(this.state.contextMenu.clientY - stageRect.top, 12, Math.max(12, stageRect.height - estimatedHeight - 12))
    const selectedIds = this.selectedNodeIds()
    const selectedCount = selectedIds.length
    const primaryNode = this.selectedNode()
    const primaryChildren = primaryNode ? childrenOf(this.state.document, primaryNode.id).length : 0
    const canUseSingleNodeActions = selectedCount === 1 && Boolean(primaryNode)
    const canDelete = selectedIds.some((nodeId) => this.findNode(nodeId)?.kind !== 'root')
    const heading = selectedCount > 1
      ? this.t('context.selectionCount', { value: selectedCount })
      : escapeHtml(primaryNode?.title ?? this.t('context.canvas'))

    return `
      <section class="context-menu" data-context-menu style="left: ${Math.round(left)}px; top: ${Math.round(top)}px;">
        <p class="section-label">${this.t(this.state.contextMenu.nodeId ? 'context.node' : 'context.canvas')}</p>
        <h3 class="context-menu-title">${heading}</h3>
        <button type="button" class="chip-button context-menu-button" data-command="new-child" ${canUseSingleNodeActions ? '' : 'disabled'}>${this.t('action.newChild')}</button>
        <button type="button" class="chip-button context-menu-button" data-command="new-sibling" ${canUseSingleNodeActions ? '' : 'disabled'}>${this.t('action.newSibling')}</button>
        <button type="button" class="chip-button context-menu-button" data-command="rename-selected" ${canUseSingleNodeActions ? '' : 'disabled'}>${this.t('action.rename')}</button>
        <button type="button" class="chip-button context-menu-button" data-command="toggle-collapse" ${canUseSingleNodeActions && primaryChildren > 0 ? '' : 'disabled'}>
          ${primaryNode?.collapsed ? this.t('action.expand') : this.t('action.collapse')}
        </button>
        <button type="button" class="chip-button context-menu-button" data-command="connect-selected" ${canUseSingleNodeActions ? '' : 'disabled'}>${this.t('action.linkRelation')}</button>
        <div class="context-menu-divider"></div>
        <button type="button" class="chip-button context-menu-button" data-command="set-priority:P0">${this.t('context.priorityP0')}</button>
        <button type="button" class="chip-button context-menu-button" data-command="set-priority:P1">${this.t('context.priorityP1')}</button>
        <button type="button" class="chip-button context-menu-button" data-command="set-priority:">${this.t('context.clearPriority')}</button>
        <button type="button" class="chip-button danger context-menu-button" data-command="delete-selected" ${canDelete ? '' : 'disabled'}>${this.t('action.delete')}</button>
      </section>
    `
  }

  private renderSettings(): void {
    if (!this.refs) {
      return
    }

    if (!this.state.settingsOpen) {
      this.refs.settingsLayer.innerHTML = ''
      this.refs.settingsLayer.className = ''
      return
    }

    const locale = this.state.preferences.locale
    this.refs.settingsLayer.className = 'settings-layer is-visible'
    this.refs.settingsLayer.innerHTML = `
      <div class="settings-scrim" data-settings-scrim>
        <section class="settings-drawer" role="dialog" aria-modal="true">
          <header class="settings-header">
            <div>
              <p class="section-label">${this.t('toolbar.settings')}</p>
              <h2>${this.t('settings.title')}</h2>
              <p class="inspector-copy">${this.t('settings.subtitle')}</p>
            </div>
            <button type="button" class="ghost-button" data-command="close-settings">${this.t('settings.close')}</button>
          </header>

          <section class="settings-card">
            <p class="section-label">${this.t('settings.appearance')}</p>
            <label class="field-row">
              <span>${this.t('settings.language')}</span>
              <select class="settings-select" data-setting-field="locale">
                <option value="zh-CN" ${locale === 'zh-CN' ? 'selected' : ''}>${this.t('settings.language.zh-CN')}</option>
                <option value="en" ${locale === 'en' ? 'selected' : ''}>${this.t('settings.language.en')}</option>
              </select>
            </label>
            <label class="field-row">
              <span>${this.t('settings.theme')}</span>
              <select class="settings-select" data-setting-field="theme">
                <option value="light" ${this.state.document.theme === 'light' ? 'selected' : ''}>${this.t('settings.theme.light')}</option>
                <option value="dark" ${this.state.document.theme === 'dark' ? 'selected' : ''}>${this.t('settings.theme.dark')}</option>
              </select>
            </label>
          </section>

          <section class="settings-card">
            <p class="section-label">${this.t('settings.ai')}</p>
            <label class="field-row">
              <span>${this.t('settings.aiProvider')}</span>
              <select class="settings-select" data-setting-field="ai.provider">
                <option value="lmstudio" ${this.state.preferences.ai.provider === 'lmstudio' ? 'selected' : ''}>${this.t('settings.aiProvider.lmstudio')}</option>
                <option value="openai-compatible" ${this.state.preferences.ai.provider === 'openai-compatible' ? 'selected' : ''}>${this.t('settings.aiProvider.openaiCompatible')}</option>
              </select>
            </label>
            <label class="field-stack">
              <span>${this.t('settings.aiBaseUrl')}</span>
              <input class="settings-input" data-setting-field="ai.baseUrl" value="${escapeAttribute(this.state.preferences.ai.baseUrl)}" />
            </label>
            <label class="field-stack">
              <span>${this.t('settings.aiModel')}</span>
              <input
                class="settings-input"
                data-setting-field="ai.model"
                value="${escapeAttribute(this.state.preferences.ai.model)}"
                placeholder="${escapeAttribute(this.t('settings.aiModelPlaceholder'))}"
              />
            </label>
            <p class="inspector-copy">${this.t('settings.aiHint')}</p>
          </section>
        </section>
      </div>
    `
  }

  private renderOnboarding(): void {
    if (!this.refs) {
      return
    }

    if (!this.onboardingOpen()) {
      this.refs.onboardingLayer.innerHTML = ''
      this.refs.onboardingLayer.className = ''
      return
    }

    const locale = this.state.preferences.locale
    this.refs.onboardingLayer.className = 'onboarding-layer is-visible'
    this.refs.onboardingLayer.innerHTML = `
      <div class="onboarding-scrim">
        <section class="onboarding-dialog" role="dialog" aria-modal="true">
          <p class="section-label">${this.t('toolbar.settings')}</p>
          <h2>${this.t('onboarding.title')}</h2>
          <p class="inspector-copy">${this.t('onboarding.subtitle')}</p>
          <div class="locale-grid">
            ${this.renderLocaleOption('zh-CN', locale)}
            ${this.renderLocaleOption('en', locale)}
          </div>
          <button type="button" class="action-button primary-action" data-command="complete-onboarding">${this.t('onboarding.continue')}</button>
        </section>
      </div>
    `
  }

  private renderLocaleOption(option: Locale, activeLocale: Locale): string {
    const activeClass = option === activeLocale ? 'is-active' : ''
    return `
      <button type="button" class="locale-option ${activeClass}" data-locale-option="${option}">
        <strong>${escapeHtml(this.t(`onboarding.locale.${option}.title` as TranslationKey))}</strong>
        <span>${escapeHtml(this.t(`onboarding.locale.${option}.copy` as TranslationKey))}</span>
      </button>
    `
  }

  private renderEdges(): string {
    const visibleIds = visibleNodeIds(this.state.document)
    const hierarchyEdges = this.state.document.nodes
      .filter((node) => Boolean(node.parentId) && visibleIds.has(node.id) && visibleIds.has(node.parentId ?? ''))
      .map((node) => {
        const parent = this.findNode(node.parentId ?? '')
        if (!parent) {
          return ''
        }
        return `<path class="edge edge-hierarchy" d="${buildHierarchyPath(parent.position, node.position)}" />`
      })
      .join('')

    const relationEdges = this.state.document.relations
      .map((edge) => {
        const source = this.findNode(edge.sourceId)
        const target = this.findNode(edge.targetId)
        if (!source || !target || !visibleIds.has(source.id) || !visibleIds.has(target.id)) {
          return ''
        }

        const mid = getRelationMidpoint(source.position, target.position)
        const label = edge.label
          ? `<text class="relation-label" x="${mid.x}" y="${mid.y - 10}">${escapeHtml(edge.label)}</text>`
          : ''

        return `<g>
          <path class="edge edge-relation" d="${buildRelationPath(source.position, target.position)}" />
          ${label}
        </g>`
      })
      .join('')

    return hierarchyEdges + relationEdges
  }

  private renderNodes(): string {
    const visibleIds = visibleNodeIds(this.state.document)
    const selectedIds = new Set(this.selectedNodeIds())

    return this.state.document.nodes
      .filter((node) => visibleIds.has(node.id))
      .map((node) => {
        const classes = [
          'node-card',
          `node-${node.kind}`,
          node.id === this.state.selectedNodeId ? 'is-selected' : '',
          selectedIds.has(node.id) && node.id !== this.state.selectedNodeId ? 'is-selected-secondary' : '',
          node.id === this.state.connectSourceNodeId ? 'is-connect-source' : '',
          node.collapsed ? 'is-collapsed' : '',
        ]
          .filter(Boolean)
          .join(' ')

        const priorityBadge = node.priority
          ? `<span class="priority-badge priority-${node.priority.toLowerCase()}">${node.priority}</span>`
          : ''

        const childCount = childrenOf(this.state.document, node.id).length
        const branchBadge = childCount > 0
          ? `<span class="node-branch-badge">${node.collapsed ? `+${hiddenDescendantCount(this.state.document, node.id)}` : childCount}</span>`
          : ''

        const nodeDimensions = buildNodeDimensionStyle(node)

        const content = this.state.editingNodeId === node.id
          ? `<input class="node-editor" style="${nodeDimensions}" data-node-editor="${node.id}" value="${escapeAttribute(node.title)}" maxlength="120" />`
          : `<button type="button" class="node-shell" style="${nodeDimensions}" data-node-button="${node.id}">
               ${priorityBadge}
               <span class="node-title">${escapeHtml(shorten(node.title, node.kind === 'root' ? 60 : 72))}</span>
               ${branchBadge}
             </button>`

        const resizeHandle = node.kind !== 'root'
          ? `<button type="button" class="node-resizer" data-node-resizer="${node.id}" aria-label="Resize node"></button>`
          : ''

        return `
          <article
            class="${classes}"
            data-node-id="${node.id}"
            style="left: ${node.position.x}px; top: ${node.position.y}px;"
          >
            ${content}
            ${resizeHandle}
          </article>
        `
      })
      .join('')
  }

  private renderPriorityButton(priority: Priority, selectedPriority: Priority): string {
    const label = priority === '' ? this.t('priority.clear') : priority
    const active = selectedPriority === priority
    return `<button type="button" class="chip-button ${active ? 'is-active' : ''}" data-priority="${priority}">${label}</button>`
  }

  private renderRelationList(nodeId: string): string {
    const relations = connectedRelations(this.state.document, nodeId)
    if (relations.length === 0) {
      return `<p class="empty-state">${this.t('inspector.emptyRelations')}</p>`
    }

    return `
      <ul class="relation-list">
        ${relations
          .map((relation) => {
            const otherNodeId = relation.sourceId === nodeId ? relation.targetId : relation.sourceId
            const otherNode = this.findNode(otherNodeId)
            return `
              <li class="relation-item">
                <div class="relation-item-top">
                  <button type="button" class="text-button" data-command="focus-node:${otherNodeId}">
                    ${escapeHtml(otherNode?.title ?? this.t('common.unknownNode'))}
                  </button>
                  <button type="button" class="ghost-button danger" data-command="delete-relation:${relation.id}">${this.t('action.remove')}</button>
                </div>
                <input
                  class="relation-input"
                  data-relation-label="${relation.id}"
                  value="${escapeAttribute(relation.label ?? '')}"
                  placeholder="${escapeAttribute(this.t('inspector.relationPlaceholder'))}"
                />
              </li>
            `
          })
          .join('')}
      </ul>
    `
  }

  private focusEditorIfNeeded(): void {
    if (!this.state.editingNodeId || this.overlayBlocksCanvas()) {
      return
    }

    const editor = this.rootEl.querySelector<HTMLInputElement>(`[data-node-editor="${this.state.editingNodeId}"]`)
    if (!editor) {
      return
    }

    queueMicrotask(() => {
      editor.focus()
      editor.select()
    })
  }

  private selectedNode(): MindNode | undefined {
    return this.findNode(this.state.selectedNodeId) ?? findRoot(this.state.document)
  }

  private selectedNodeIds(): string[] {
    const seen = new Set<string>()
    const orderedIds: string[] = []
    for (const nodeId of this.state.selectedNodeIds) {
      if (seen.has(nodeId) || !this.findNode(nodeId)) {
        continue
      }
      seen.add(nodeId)
      orderedIds.push(nodeId)
    }

    if (orderedIds.length === 0) {
      const rootId = findRoot(this.state.document).id
      return [rootId]
    }

    return orderedIds
  }

  private setSelection(nodeIds: string[], primaryNodeId = nodeIds[nodeIds.length - 1] ?? 'root'): void {
    const normalizedIds = nodeIds.filter((nodeId, index) => {
      return nodeIds.indexOf(nodeId) === index && Boolean(this.findNode(nodeId))
    })
    const fallbackId = findRoot(this.state.document).id
    const nextIds = normalizedIds.length > 0 ? normalizedIds : [fallbackId]
    const nextPrimary = nextIds.includes(primaryNodeId) ? primaryNodeId : nextIds[nextIds.length - 1]

    this.state.selectedNodeIds = nextIds
    this.state.selectedNodeId = nextPrimary
    this.state.editingNodeId = null
  }

  private toggleNodeSelection(nodeId: string): void {
    if (this.state.connectSourceNodeId && this.state.connectSourceNodeId !== nodeId) {
      this.createRelation(this.state.connectSourceNodeId, nodeId)
      return
    }

    const currentIds = this.selectedNodeIds()
    if (currentIds.includes(nodeId)) {
      if (currentIds.length === 1) {
        this.setSelection([nodeId], nodeId)
      } else {
        const nextIds = currentIds.filter((candidateId) => candidateId !== nodeId)
        this.setSelection(nextIds, nextIds[nextIds.length - 1])
      }
    } else {
      this.setSelection([...currentIds, nodeId], nodeId)
    }

    this.render()
  }

  private selectNodeSubtree(nodeId: string): void {
    if (this.state.connectSourceNodeId && this.state.connectSourceNodeId !== nodeId) {
      this.createRelation(this.state.connectSourceNodeId, nodeId)
      return
    }

    const subtreeIds = [nodeId, ...descendantIds(this.state.document, nodeId)]
    this.setSelection(subtreeIds, nodeId)
    this.render()
  }

  private selectNode(nodeId: string): void {
    if (this.state.connectSourceNodeId && this.state.connectSourceNodeId !== nodeId) {
      this.createRelation(this.state.connectSourceNodeId, nodeId)
      return
    }

    if (this.state.connectSourceNodeId && this.state.connectSourceNodeId === nodeId) {
      this.state.connectSourceNodeId = null
      this.setStatus('status.relationModeCancelled')
    }

    this.setSelection([nodeId], nodeId)
    this.render()
  }

  private createChildNode(parentId: string): void {
    const parent = this.findNode(parentId)
    if (!parent) {
      return
    }

    this.captureHistory()
    parent.collapsed = false
    parent.updatedAt = new Date().toISOString()
    const newNode = createNode({
      parentId,
      kind: 'topic',
      position: nextChildPosition(this.state.document, parentId),
      title: this.t('node.newChild'),
    })

    this.state.document.nodes.push(newNode)
    this.setSelection([newNode.id], newNode.id)
    this.state.editingNodeId = newNode.id
    touchDocument(this.state.document)
    this.render()
    this.scheduleAutosave('status.childSaveScheduled')
  }

  private createSiblingNode(nodeId: string): void {
    const node = this.findNode(nodeId)
    if (!node) {
      return
    }

    this.captureHistory()
    let newNode: MindNode
    if (node.kind === 'root') {
      newNode = createNode({
        kind: 'floating',
        position: nextFloatingPosition(this.state.document),
        title: this.t('node.newFloating'),
      })
    } else if (node.parentId) {
      newNode = createNode({
        parentId: node.parentId,
        kind: 'topic',
        position: nextSiblingPosition(this.state.document, node),
        title: this.t('node.newSibling'),
      })
    } else {
      newNode = createNode({
        kind: 'floating',
        position: nextFloatingPosition(this.state.document),
        title: this.t('node.newFloating'),
      })
    }

    this.state.document.nodes.push(newNode)
    this.setSelection([newNode.id], newNode.id)
    this.state.editingNodeId = newNode.id
    touchDocument(this.state.document)
    this.render()
    this.scheduleAutosave('status.siblingSaveScheduled')
  }

  private createRelation(sourceId: string, targetId: string): void {
    if (sourceId === targetId) {
      this.state.connectSourceNodeId = null
      this.setStatus('status.relationNeedsDifferentNodes')
      this.render()
      return
    }

    const exists = this.state.document.relations.some((edge) => {
      return (
        (edge.sourceId === sourceId && edge.targetId === targetId) ||
        (edge.sourceId === targetId && edge.targetId === sourceId)
      )
    })

    if (exists) {
      this.state.connectSourceNodeId = null
      this.setStatus('status.relationAlreadyExists')
      this.render()
      return
    }

    const relation: RelationEdge = {
      id: createId('rel'),
      sourceId,
      targetId,
      label: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    this.captureHistory()
    this.state.document.relations.push(relation)
    this.state.connectSourceNodeId = null
    this.setSelection([targetId], targetId)
    touchDocument(this.state.document)
    this.setStatus('status.relationCreated')
    this.render()
    this.scheduleAutosave('status.relationSaveScheduled')
  }

  private deleteSelectedNode(): void {
    const selectedIds = this.selectedNodeIds()
    const removableIds = selectedIds.filter((nodeId) => this.findNode(nodeId)?.kind !== 'root')
    if (removableIds.length === 0) {
      this.setStatus('status.rootCannotDelete')
      this.render()
      return
    }

    const primaryNode = this.selectedNode()
    const removeIds = new Set<string>()
    for (const nodeId of removableIds) {
      removeIds.add(nodeId)
      for (const descendantId of descendantIds(this.state.document, nodeId)) {
        removeIds.add(descendantId)
      }
    }

    const fallbackNodeId = primaryNode?.parentId && !removeIds.has(primaryNode.parentId) ? primaryNode.parentId : findRoot(this.state.document).id
    const relationCountBefore = this.state.document.relations.length
    const nodeCountBefore = this.state.document.nodes.length

    this.captureHistory()
    this.state.document.nodes = this.state.document.nodes.filter((node) => !removeIds.has(node.id))
    this.state.document.relations = this.state.document.relations.filter((relation) => !removeIds.has(relation.sourceId) && !removeIds.has(relation.targetId))

    const removedNodes = nodeCountBefore - this.state.document.nodes.length
    const removedRelations = relationCountBefore - this.state.document.relations.length
    if (removedNodes === 0) {
      return
    }

    this.setSelection([fallbackNodeId], fallbackNodeId)
    this.state.editingNodeId = null
    this.state.connectSourceNodeId = null
    touchDocument(this.state.document)
    this.setStatus('status.deletedSummary', {
      nodes: removedNodes,
      relations: removedRelations,
    })
    this.render()
    this.scheduleAutosave('status.deletionSaveScheduled')
  }

  private setPriority(priority: Priority): void {
    const targetIds = this.selectedNodeIds().filter((nodeId) => Boolean(this.findNode(nodeId)))
    if (targetIds.length === 0) {
      return
    }

    const nextPriority = priority || undefined
    const targetNodes = targetIds
      .map((nodeId) => this.findNode(nodeId))
      .filter((node): node is MindNode => Boolean(node))

    if (targetNodes.every((node) => (node.priority ?? undefined) === nextPriority)) {
      return
    }

    this.captureHistory()
    for (const node of targetNodes) {
      this.updateNode(node.id, (draft) => {
        draft.priority = nextPriority
      })
    }
    touchDocument(this.state.document)
    this.setStatus(priority ? 'status.priorityApplied' : 'status.priorityCleared', priority ? { priority } : undefined)
    this.render()
    this.scheduleAutosave('status.prioritySaveScheduled')
  }

  private updateNode(nodeId: string, updater: (node: MindNode) => void): void {
    const node = this.findNode(nodeId)
    if (!node) {
      return
    }

    updater(node)
    node.updatedAt = new Date().toISOString()
  }

  private startEditingSelected(): void {
    const selectedNode = this.selectedNode()
    if (!selectedNode) {
      return
    }

    this.state.editingNodeId = selectedNode.id
    this.render()
  }

  private commitNodeEditor(nodeId: string, rawTitle: string): void {
    if (this.state.editingNodeId !== nodeId) {
      return
    }

    const title = rawTitle.trim() || this.t('node.untitled')
    const existingNode = this.findNode(nodeId)
    if (!existingNode) {
      this.state.editingNodeId = null
      this.render()
      return
    }

    if (existingNode.title === title) {
      this.state.editingNodeId = null
      this.render()
      return
    }

    this.captureHistory()
    this.updateNode(nodeId, (node) => {
      node.title = title
    })
    this.state.editingNodeId = null
    this.setSelection([nodeId], nodeId)
    touchDocument(this.state.document)
    this.setStatus('status.nodeTitleUpdated')
    this.render()
    this.scheduleAutosave('status.titleSaveScheduled')
  }

  private commitRelationLabel(relationId: string, rawLabel: string): void {
    const relation = this.state.document.relations.find((item) => item.id === relationId)
    const nextLabel = rawLabel.trim()
    if (!relation || (relation.label ?? '') === nextLabel) {
      return
    }

    this.captureHistory()
    updateRelationLabel(this.state.document, relationId, rawLabel)
    touchDocument(this.state.document)
    this.setStatus('status.relationLabelUpdated')
    this.render()
    this.scheduleAutosave('status.labelSaveScheduled')
  }

  private toggleSelectedCollapse(): void {
    const selectedNode = this.selectedNode()
    if (!selectedNode) {
      return
    }

    if (childrenOf(this.state.document, selectedNode.id).length === 0) {
      this.setStatus('status.noBranchToCollapse')
      this.render()
      return
    }

    this.captureHistory()
    const changed = toggleCollapse(this.state.document, selectedNode.id)
    if (!changed) {
      this.setStatus('status.noBranchToCollapse')
      this.render()
      return
    }

    touchDocument(this.state.document)
    this.setStatus(selectedNode.collapsed ? 'status.branchCollapsed' : 'status.branchExpanded')
    this.render()
    this.scheduleAutosave('status.layoutSaveScheduled')
  }

  private autoLayout(): void {
    const snapshot = this.createHistorySnapshot()
    const movedNodes = autoLayoutHierarchy(this.state.document)
    if (movedNodes === 0) {
      this.setStatus('status.layoutUpdated', { count: 0 })
      this.render()
      return
    }

    this.pushHistorySnapshot(snapshot)
    touchDocument(this.state.document)
    this.setStatus('status.layoutUpdated', { count: movedNodes })
    this.render()
    this.scheduleAutosave('status.layoutSaveScheduled')
  }

  private async runCommand(rawCommand: string): Promise<void> {
    const [command, argument = ''] = rawCommand.split(':')

    try {
      switch (command) {
        case 'create-map':
          await this.createMap()
          return
        case 'open-map':
          if (argument) {
            await this.openMap(argument)
          }
          return
        case 'go-home':
          await this.goHome()
          return
        case 'rename-map':
          await this.renameMap(argument || this.state.currentMapId || this.state.document.id)
          return
        case 'delete-map':
          await this.deleteMap(argument || this.state.currentMapId || this.state.document.id)
          return
        case 'toggle-inspector':
          this.toggleInspector()
          return
        case 'toggle-settings':
          this.toggleSettings()
          return
        case 'close-settings':
          this.closeSettings()
          return
        case 'complete-onboarding':
          this.completeOnboarding()
          return
        case 'theme-toggle':
          this.toggleTheme()
          return
        case 'undo':
          this.undo()
          return
        case 'redo':
          this.redo()
          return
        case 'save':
          await this.saveDocument('status.saved')
          return
        case 'auto-layout':
          this.autoLayout()
          return
        case 'export-markdown':
          await this.exportMarkdown()
          return
        case 'import-file':
          this.refs?.importInput.click()
          return
        case 'connect-selected':
          this.startRelationMode()
          return
        case 'new-child':
          this.createChildNode(this.selectedNode()?.id ?? 'root')
          return
        case 'new-sibling':
          this.createSiblingNode(this.selectedNode()?.id ?? 'root')
          return
        case 'rename-selected':
          this.startEditingSelected()
          return
        case 'set-priority':
          this.setPriority((argument.toUpperCase() as Priority) || '')
          return
        case 'toggle-collapse':
          this.toggleSelectedCollapse()
          return
        case 'delete-selected':
          this.deleteSelectedNode()
          return
        case 'focus-node':
          if (argument) {
            this.selectNode(argument)
          }
          return
        case 'delete-relation':
          if (argument) {
            this.removeRelation(argument)
          }
          return
        default:
          break
      }
    } catch (error) {
      this.setStatus('status.mapListFailed', { reason: getErrorMessage(error) })
      this.render()
    }
  }

  private removeRelation(relationId: string): void {
    const snapshot = this.createHistorySnapshot()
    const removed = deleteRelation(this.state.document, relationId)
    if (!removed) {
      return
    }

    this.pushHistorySnapshot(snapshot)
    touchDocument(this.state.document)
    this.setStatus('status.relationRemoved')
    this.render()
    this.scheduleAutosave('status.relationRemovalSaveScheduled')
  }

  private toggleTheme(): void {
    this.setTheme(this.state.document.theme === 'dark' ? 'light' : 'dark')
  }

  private setTheme(theme: Theme): void {
    if (this.state.document.theme === theme) {
      return
    }

    this.captureHistory()
    this.state.document.theme = theme
    touchDocument(this.state.document)
    this.applyTheme()
    this.setStatus('status.themeSwitched', { theme: themeLabel(this.state.preferences.locale, theme) })
    this.render()
    this.scheduleAutosave('status.themeSaveScheduled')
  }

  private startRelationMode(): void {
    const selectedNode = this.selectedNode()
    if (!selectedNode) {
      return
    }

    if (this.state.connectSourceNodeId === selectedNode.id) {
      this.state.connectSourceNodeId = null
      this.setStatus('status.relationModeCancelled')
      this.render()
      return
    }

    this.state.connectSourceNodeId = selectedNode.id
    this.setStatus('status.relationModeStarted', { title: selectedNode.title })
    this.render()
  }

  private async saveDocument(statusKey: TranslationKey, values?: Record<string, string | number>): Promise<void> {
    try {
      const savedDocument = await api.saveMap(this.state.document)
      this.state.document = savedDocument
      this.state.currentMapId = savedDocument.id
      await this.refreshMaps()
      this.setStatus(statusKey, values)
    } catch (error) {
      this.setStatus('status.saveFailed', { reason: getErrorMessage(error) })
    }

    this.applyTheme()
    this.render()
  }

  private async exportMarkdown(): Promise<void> {
    try {
      const markdown = await api.exportMarkdown(this.state.document)
      downloadTextFile(`${slugify(this.state.document.title || 'code-mind')}.md`, markdown)
      this.setStatus('status.exported')
    } catch (error) {
      this.setStatus('status.exportFailed', { reason: getErrorMessage(error) })
    }

    this.render()
  }

  private async importFile(file: File): Promise<void> {
    const extension = file.name.split('.').pop()?.toLowerCase()
    const format = extension === 'md' || extension === 'markdown' ? 'markdown' : 'text'

    try {
      const content = await file.text()
      const importedDocument = await api.importDocument(content, format)
      if (this.state.currentMapId) {
        importedDocument.id = this.state.currentMapId
      }
      this.captureHistory()
      this.state.document = importedDocument
      this.setSelection([findRoot(importedDocument).id], findRoot(importedDocument).id)
      this.state.editingNodeId = null
      this.state.connectSourceNodeId = null
      this.viewport.scale = 1
      this.didInitializeViewport = false
      this.setStatus('status.imported', { filename: file.name })
      this.applyTheme()
      this.render()
      await this.saveDocument('status.importedSaved')
    } catch (error) {
      this.setStatus('status.importFailed', { reason: getErrorMessage(error) })
      this.render()
    }
  }

  private async refreshMaps(statusKey?: TranslationKey): Promise<void> {
    const maps = await api.listMaps()
    this.state.maps = maps
    if (statusKey) {
      this.setStatus(statusKey)
    }
  }

  private async createMap(): Promise<void> {
    const title = window.prompt(this.t('dialog.newMapTitle'), this.t('node.untitled')) ?? ''
    const doc = await api.createMap(title)
    await this.refreshMaps()
    this.state.document = doc
    this.state.currentMapId = doc.id
    this.state.view = 'map'
    this.setSelection([findRoot(doc).id], findRoot(doc).id)
    this.state.editingNodeId = null
    this.state.connectSourceNodeId = null
    this.state.resize = null
    this.viewport.scale = 1
    this.didInitializeViewport = false
    this.refs = null
    this.resetHistory()
    this.setStatus('status.mapCreated')
    this.render()
  }

  private async openMap(mapId: string): Promise<void> {
    const doc = await api.loadMap(mapId)
    this.state.document = doc
    this.state.currentMapId = mapId
    this.state.view = 'map'
    this.setSelection([findRoot(doc).id], findRoot(doc).id)
    this.state.editingNodeId = null
    this.state.connectSourceNodeId = null
    this.state.resize = null
    this.viewport.scale = 1
    this.didInitializeViewport = false
    this.refs = null
    this.resetHistory()
    this.setStatus('status.loaded')
    this.render()
  }

  private async goHome(): Promise<void> {
    await this.refreshMaps('status.mapListLoaded')
    this.state.view = 'home'
    this.state.currentMapId = null
    this.refs = null
    this.resetHistory()
    this.render()
  }

  private async renameMap(mapId: string): Promise<void> {
    const currentTitle = this.state.currentMapId === mapId ? this.state.document.title : this.findMapSummary(mapId)?.title ?? ''
    const nextTitle = window.prompt(this.t('dialog.renameMap'), currentTitle)
    if (nextTitle === null) {
      return
    }

    const doc = await api.renameMap(mapId, nextTitle)
    await this.refreshMaps()
    if (this.state.currentMapId === mapId) {
      this.state.document = doc
      this.resetHistory()
    }
    this.setStatus('status.mapRenamed')
    this.render()
  }

  private async deleteMap(mapId: string): Promise<void> {
    if (!window.confirm(this.t('dialog.deleteMap'))) {
      return
    }

    await api.deleteMap(mapId)
    await this.refreshMaps()

    if (this.state.currentMapId === mapId || this.state.view === 'home') {
      this.state.view = 'home'
      this.state.currentMapId = null
      this.refs = null
      this.resetHistory()
    }

    this.setStatus('status.mapDeleted')
    this.render()
  }

  private tryStartCanvasPan(event: PointerEvent, target: HTMLElement): void {
    const scroll = this.refs?.scroll
    if (!scroll) {
      return
    }

    const withinScroll = target.closest<HTMLElement>('[data-workspace-scroll]')
    if (!withinScroll) {
      return
    }

    this.pan = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startViewportX: this.viewport.x,
      startViewportY: this.viewport.y,
    }
    event.preventDefault()
    this.setCanvasPanning(true)
  }

  private handleCanvasPan(event: PointerEvent): void {
    if (!this.pan || event.pointerId !== this.pan.pointerId) {
      return
    }

    const deltaX = event.clientX - this.pan.startX
    const deltaY = event.clientY - this.pan.startY
    event.preventDefault()
    this.viewport.x = this.pan.startViewportX + deltaX
    this.viewport.y = this.pan.startViewportY + deltaY
    this.updateCanvasViewportView()
  }

  private commitSettingField(field: string, value: string): void {
    switch (field) {
      case 'locale':
        this.setLocale(value === 'zh-CN' ? 'zh-CN' : 'en', true)
        return
      case 'theme':
        this.setTheme(value === 'light' ? 'light' : 'dark')
        return
      case 'ai.provider':
        this.updatePreferences((preferences) => {
          preferences.ai.provider = value === 'openai-compatible' ? 'openai-compatible' : 'lmstudio'
        })
        this.setStatus('status.aiSettingsSaved')
        this.render()
        return
      case 'ai.baseUrl':
        this.updatePreferences((preferences) => {
          preferences.ai.baseUrl = value.trim() || DEFAULT_LM_STUDIO_URL
        })
        this.setStatus('status.aiSettingsSaved')
        this.render()
        return
      case 'ai.model':
        this.updatePreferences((preferences) => {
          preferences.ai.model = value.trim()
        })
        this.setStatus('status.aiSettingsSaved')
        this.render()
        return
      default:
        break
    }
  }

  private setLocale(locale: Locale, announce: boolean): void {
    this.updatePreferences((preferences) => {
      preferences.locale = locale
    })
    this.applyLocale()
    if (announce) {
      this.setStatus('status.languageUpdated')
    }
    this.render()
  }

  private toggleSettings(): void {
    this.state.settingsOpen = !this.state.settingsOpen
    this.setStatus(this.state.settingsOpen ? 'status.settingsOpened' : 'status.settingsClosed')
    this.render()
  }

  private toggleInspector(): void {
    this.state.inspectorCollapsed = !this.state.inspectorCollapsed
    this.setStatus(this.state.inspectorCollapsed ? 'status.panelClosed' : 'status.panelOpened')
    this.render()
  }

  private closeSettings(): void {
    if (!this.state.settingsOpen) {
      return
    }

    this.state.settingsOpen = false
    this.setStatus('status.settingsClosed')
    this.render()
  }

  private completeOnboarding(): void {
    this.updatePreferences((preferences) => {
      preferences.onboardingCompleted = true
    })
    this.render()
  }

  private updatePreferences(updater: (preferences: AppPreferences) => void): void {
    const nextPreferences: AppPreferences = {
      ...this.state.preferences,
      ai: {
        ...this.state.preferences.ai,
      },
    }
    updater(nextPreferences)
    this.state.preferences = nextPreferences
    savePreferences(nextPreferences)
    this.applyLocale()
  }

  private initializeViewportIfNeeded(): void {
    if (this.didInitializeViewport || !this.refs) {
      return
    }

    const root = findRoot(this.state.document)
    const { scroll } = this.refs
    queueMicrotask(() => {
      this.viewport.scale = 1
      this.viewport.x = scroll.clientWidth / 2 - root.position.x * this.viewport.scale
      this.viewport.y = scroll.clientHeight / 2 - root.position.y * this.viewport.scale
      this.updateCanvasViewportView()
    })
    this.didInitializeViewport = true
  }

  private findNode(nodeId: string): MindNode | undefined {
    return findNode(this.state.document, nodeId)
  }

  private findMapSummary(mapId: string): MindMapSummary | undefined {
    return this.state.maps.find((item) => item.id === mapId)
  }

  private canUndo(): boolean {
    return this.historyPast.length > 0
  }

  private canRedo(): boolean {
    return this.historyFuture.length > 0
  }

  private createHistorySnapshot(): HistorySnapshot {
    return {
      document: cloneDocument(this.state.document),
      selectedNodeId: this.state.selectedNodeId,
      selectedNodeIds: [...this.selectedNodeIds()],
      connectSourceNodeId: this.state.connectSourceNodeId,
    }
  }

  private pushHistorySnapshot(snapshot: HistorySnapshot): void {
    this.historyPast.push(snapshot)
    if (this.historyPast.length > HISTORY_LIMIT) {
      this.historyPast.shift()
    }
    this.historyFuture = []
  }

  private captureHistory(): void {
    this.pushHistorySnapshot(this.createHistorySnapshot())
  }

  private resetHistory(): void {
    this.historyPast = []
    this.historyFuture = []
  }

  private applyHistorySnapshot(snapshot: HistorySnapshot): void {
    this.state.document = cloneDocument(snapshot.document)
    this.setSelection(snapshot.selectedNodeIds, snapshot.selectedNodeId)
    this.state.connectSourceNodeId = snapshot.connectSourceNodeId && findNode(this.state.document, snapshot.connectSourceNodeId)
      ? snapshot.connectSourceNodeId
      : null
    this.state.editingNodeId = null
    this.state.drag = null
    this.state.resize = null
    this.state.contextMenu = null
    this.state.marquee = null
    this.applyTheme()
  }

  private undo(): void {
    if (!this.canUndo()) {
      return
    }

    const snapshot = this.historyPast.pop()
    if (!snapshot) {
      return
    }

    this.historyFuture.push(this.createHistorySnapshot())
    this.applyHistorySnapshot(snapshot)
    this.setStatus('status.undoApplied')
    this.render()
    this.scheduleAutosave('status.saved')
  }

  private redo(): void {
    if (!this.canRedo()) {
      return
    }

    const snapshot = this.historyFuture.pop()
    if (!snapshot) {
      return
    }

    this.historyPast.push(this.createHistorySnapshot())
    this.applyHistorySnapshot(snapshot)
    this.setStatus('status.redoApplied')
    this.render()
    this.scheduleAutosave('status.saved')
  }

  private scheduleLiveNodeUpdate(nodeId: string, includeDimensions = false): void {
    this.liveNodeIds.add(nodeId)
    if (includeDimensions) {
      this.liveNodeDimensionIds.add(nodeId)
    }

    if (this.liveCanvasHandle !== null) {
      return
    }

    this.liveCanvasHandle = window.requestAnimationFrame(() => {
      this.liveCanvasHandle = null
      const nextNodeIds = [...this.liveNodeIds]
      const nextDimensionIds = new Set(this.liveNodeDimensionIds)
      this.liveNodeIds.clear()
      this.liveNodeDimensionIds.clear()
      if (nextNodeIds.length > 0) {
        this.applyLiveNodeUpdate(nextNodeIds, nextDimensionIds)
      }
    })
  }

  private flushLiveNodeUpdate(): void {
    if (this.liveCanvasHandle === null) {
      return
    }

    window.cancelAnimationFrame(this.liveCanvasHandle)
    this.liveCanvasHandle = null
    const nextNodeIds = [...this.liveNodeIds]
    const nextDimensionIds = new Set(this.liveNodeDimensionIds)
    this.liveNodeIds.clear()
    this.liveNodeDimensionIds.clear()

    if (nextNodeIds.length > 0) {
      this.applyLiveNodeUpdate(nextNodeIds, nextDimensionIds)
    }
  }

  private applyLiveNodeUpdate(nodeIds: string[], includeDimensionIds: Set<string>): void {
    if (!this.refs) {
      return
    }

    const bounds = getWorkspaceBounds(this.state.document)
    this.refs.canvas.style.width = `${bounds.width}px`
    this.refs.canvas.style.height = `${bounds.height}px`
    this.refs.edgeLayer.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`)

    for (const nodeId of nodeIds) {
      const node = this.findNode(nodeId)
      const element = this.rootEl.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`)
      if (node && element) {
        element.style.left = `${node.position.x}px`
        element.style.top = `${node.position.y}px`
        if (includeDimensionIds.has(nodeId)) {
          const sizingTarget = element.querySelector<HTMLElement>('.node-shell, .node-editor')
          if (sizingTarget) {
            sizingTarget.style.width = node.width ? `${Math.max(node.width, MIN_NODE_WIDTH)}px` : ''
            sizingTarget.style.height = node.height ? `${Math.max(node.height, MIN_NODE_HEIGHT)}px` : ''
          }
        }
      }
    }

    this.refs.edgeLayer.innerHTML = this.renderEdges()
  }

  private applyMarqueeSelection(marquee: MarqueeState): void {
    const selectionRect = normalizeClientRect(marquee.startClientX, marquee.startClientY, marquee.currentClientX, marquee.currentClientY)
    const matchedIds = this.state.document.nodes
      .map((node) => {
        const element = this.rootEl.querySelector<HTMLElement>(`[data-node-id="${node.id}"]`)
        if (!element) {
          return null
        }

        return rectanglesIntersect(selectionRect, element.getBoundingClientRect()) ? node.id : null
      })
      .filter((nodeId): nodeId is string => Boolean(nodeId))

    if (matchedIds.length === 0) {
      this.render()
      return
    }

    this.setSelection(matchedIds, matchedIds[matchedIds.length - 1])
    this.render()
  }

  private scheduleAutosave(statusKey: TranslationKey, values?: Record<string, string | number>): void {
    if (this.autosaveHandle !== null) {
      window.clearTimeout(this.autosaveHandle)
    }

    this.autosaveHandle = window.setTimeout(() => {
      void this.saveDocument(statusKey, values)
    }, 700)
  }

  private setStatus(key: TranslationKey, values?: Record<string, string | number>): void {
    this.state.status = { key, values }
  }

  private setCanvasPanning(active: boolean): void {
    this.refs?.scroll.classList.toggle('is-panning', active)
  }

  private clientToCanvasPosition(clientX: number, clientY: number): Position {
    const scroll = this.refs?.scroll
    if (!scroll) {
      return { x: clientX, y: clientY }
    }

    const rect = scroll.getBoundingClientRect()
    return {
      x: (clientX - rect.left - this.viewport.x) / this.viewport.scale,
      y: (clientY - rect.top - this.viewport.y) / this.viewport.scale,
    }
  }

  private updateCanvasViewportView(): void {
    if (!this.refs) {
      return
    }

    this.refs.canvas.style.transform = `translate(${Math.round(this.viewport.x)}px, ${Math.round(this.viewport.y)}px) scale(${this.viewport.scale})`
  }

  private t(key: TranslationKey, values?: Record<string, string | number>): string {
    return translate(this.state.preferences.locale, key, values)
  }

  private onboardingOpen(): boolean {
    return !this.state.preferences.onboardingCompleted
  }

  private overlayBlocksCanvas(): boolean {
    return this.onboardingOpen() || this.state.settingsOpen
  }

  private applyTheme(): void {
    document.documentElement.dataset.theme = this.state.document.theme
    document.documentElement.style.colorScheme = this.state.document.theme
  }

  private applyLocale(): void {
    document.documentElement.lang = this.state.preferences.locale
  }
}

function buildHierarchyPath(source: Position, target: Position): string {
  const controlOffset = Math.max(48, Math.abs(target.x - source.x) * 0.36)
  const movingRight = target.x >= source.x
  const controlX1 = movingRight ? source.x + controlOffset : source.x - controlOffset
  const controlX2 = movingRight ? target.x - controlOffset : target.x + controlOffset
  return `M ${source.x} ${source.y} C ${controlX1} ${source.y}, ${controlX2} ${target.y}, ${target.x} ${target.y}`
}

function buildRelationPath(source: Position, target: Position): string {
  const midpoint = getRelationMidpoint(source, target)
  return `M ${source.x} ${source.y} Q ${midpoint.x} ${midpoint.y} ${target.x} ${target.y}`
}

function getRelationMidpoint(source: Position, target: Position): Position {
  return {
    x: (source.x + target.x) / 2,
    y: (source.y + target.y) / 2 - Math.max(60, Math.abs(target.x - source.x) * 0.08),
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function escapeAttribute(value: string): string {
  return escapeHtml(value)
}

function shorten(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`
}

function buildNodeDimensionStyle(node: MindNode): string {
  const styles: string[] = []
  if (node.width) {
    styles.push(`width: ${Math.max(node.width, MIN_NODE_WIDTH)}px;`)
  }
  if (node.height) {
    styles.push(`height: ${Math.max(node.height, MIN_NODE_HEIGHT)}px;`)
  }
  return styles.join(' ')
}

function formatRelativeTime(value: string, locale: Locale): string {
  const targetTime = Date.parse(value)
  if (Number.isNaN(targetTime)) {
    return value
  }

  const diffMinutes = Math.round((targetTime - Date.now()) / (60 * 1000))
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const absMinutes = Math.abs(diffMinutes)

  if (absMinutes < 60) {
    return formatter.format(diffMinutes, 'minute')
  }

  const diffHours = Math.round(diffMinutes / 60)
  if (Math.abs(diffHours) < 24) {
    return formatter.format(diffHours, 'hour')
  }

  const diffDays = Math.round(diffHours / 24)
  if (Math.abs(diffDays) < 30) {
    return formatter.format(diffDays, 'day')
  }

  const diffMonths = Math.round(diffDays / 30)
  if (Math.abs(diffMonths) < 12) {
    return formatter.format(diffMonths, 'month')
  }

  const diffYears = Math.round(diffDays / 365)
  return formatter.format(diffYears, 'year')
}

function clampMin(value: number, min: number): number {
  return Math.max(value, min)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function getWorkspaceBounds(document: MindMapDocument): { width: number; height: number } {
  let maxX = WORKSPACE_MIN_WIDTH - WORKSPACE_PADDING
  let maxY = WORKSPACE_MIN_HEIGHT - WORKSPACE_PADDING

  for (const node of document.nodes) {
    const nodeWidth = node.width ?? estimateNodeWidth(node)
    const nodeHeight = node.height ?? estimateNodeHeight(node)
    maxX = Math.max(maxX, node.position.x + nodeWidth / 2)
    maxY = Math.max(maxY, node.position.y + nodeHeight / 2)
  }

  return {
    width: Math.max(WORKSPACE_MIN_WIDTH, Math.ceil(maxX + WORKSPACE_PADDING)),
    height: Math.max(WORKSPACE_MIN_HEIGHT, Math.ceil(maxY + WORKSPACE_PADDING)),
  }
}

function estimateNodeWidth(node: MindNode): number {
  if (node.kind === 'root') {
    return 220
  }
  return 196
}

function estimateNodeHeight(node: MindNode): number {
  if (node.kind === 'root') {
    return 64
  }
  return MIN_NODE_HEIGHT
}

function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function slugify(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')

  return normalized || 'code-mind'
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return 'Unknown error'
}

function cloneDocument(document: MindMapDocument): MindMapDocument {
  return JSON.parse(JSON.stringify(document)) as MindMapDocument
}

function normalizeClientRect(startX: number, startY: number, endX: number, endY: number): DOMRect {
  const left = Math.min(startX, endX)
  const top = Math.min(startY, endY)
  const width = Math.abs(endX - startX)
  const height = Math.abs(endY - startY)
  return new DOMRect(left, top, width, height)
}

function rectanglesIntersect(left: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>, right: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>): boolean {
  return left.left <= right.right && left.right >= right.left && left.top <= right.bottom && left.bottom >= right.top
}

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector)
  if (!element) {
    throw new Error(`Missing required element: ${selector}`)
  }
  return element
}
