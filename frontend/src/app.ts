import { api } from './api'
import {
  autoLayoutHierarchy,
  childrenOf,
  connectedRelations,
  createDefaultDocument,
  createId,
  createNode,
  deleteNodeTree,
  deleteRelation,
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
  MindNode,
  Position,
  Priority,
  RelationEdge,
  Theme,
} from './types'

interface DragState {
  nodeId: string
  offsetX: number
  offsetY: number
}

interface StatusDescriptor {
  key: TranslationKey
  values?: Record<string, string | number>
}

interface AppState {
  document: MindMapDocument
  selectedNodeId: string
  editingNodeId: string | null
  connectSourceNodeId: string | null
  drag: DragState | null
  status: StatusDescriptor
  preferences: AppPreferences
  settingsOpen: boolean
}

interface ShellRefs {
  eyebrow: HTMLParagraphElement
  title: HTMLHeadingElement
  status: HTMLParagraphElement
  settingsButton: HTMLButtonElement
  themeButton: HTMLButtonElement
  saveButton: HTMLButtonElement
  layoutButton: HTMLButtonElement
  exportButton: HTMLButtonElement
  importButton: HTMLButtonElement
  topbarConnectButton: HTMLButtonElement
  importInput: HTMLInputElement
  canvas: HTMLElement
  edgeLayer: SVGSVGElement
  nodeLayer: HTMLElement
  inspector: HTMLElement
  settingsLayer: HTMLElement
  onboardingLayer: HTMLElement
  dock: HTMLElement
}

const WORKSPACE_WIDTH = 2200
const WORKSPACE_HEIGHT = 1400
const PRIORITY_VALUES: Priority[] = ['', 'P0', 'P1', 'P2', 'P3']

export async function createApp(rootEl: HTMLElement): Promise<void> {
  const app = new MindMapApp(rootEl)
  await app.mount()
}

class MindMapApp {
  private readonly rootEl: HTMLElement
  private autosaveHandle: number | null = null
  private refs: ShellRefs | null = null
  private state: AppState

  constructor(rootEl: HTMLElement) {
    this.rootEl = rootEl
    this.state = {
      document: createDefaultDocument(),
      selectedNodeId: 'root',
      editingNodeId: null,
      connectSourceNodeId: null,
      drag: null,
      status: { key: 'status.loading' },
      preferences: loadPreferences(),
      settingsOpen: false,
    }

    this.applyLocale()
    this.applyTheme()
    this.bindEvents()
  }

  async mount(): Promise<void> {
    try {
      const loadedDocument = await api.loadMap()
      this.state.document = loadedDocument
      this.state.selectedNodeId = findRoot(loadedDocument).id
      this.setStatus('status.loaded')
    } catch {
      this.state.document = createDefaultDocument()
      this.state.selectedNodeId = 'root'
      this.setStatus('status.backendUnavailable')
    }

    this.render()
  }

  private bindEvents(): void {
    this.rootEl.addEventListener('click', this.handleClick)
    this.rootEl.addEventListener('dblclick', this.handleDoubleClick)
    this.rootEl.addEventListener('pointerdown', this.handlePointerDown)
    this.rootEl.addEventListener('keydown', this.handleEditorKeyDown)
    this.rootEl.addEventListener('focusout', this.handleFocusOut, true)
    this.rootEl.addEventListener('change', this.handleChange)
    window.addEventListener('pointermove', this.handlePointerMove)
    window.addEventListener('pointerup', this.handlePointerUp)
    window.addEventListener('keydown', this.handleGlobalKeyDown)
  }

  private readonly handleClick = (event: MouseEvent): void => {
    const target = event.target
    if (!(target instanceof HTMLElement)) {
      return
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
      this.selectNode(nodeButton.dataset.nodeButton)
    }
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
    this.state.selectedNodeId = nodeButton.dataset.nodeButton
    this.render()
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.overlayBlocksCanvas()) {
      return
    }

    const target = event.target
    if (!(target instanceof HTMLElement)) {
      return
    }

    const nodeButton = target.closest<HTMLElement>('[data-node-button]')
    const nodeId = nodeButton?.dataset.nodeButton
    if (!nodeId) {
      return
    }

    const node = this.findNode(nodeId)
    if (!node || node.kind === 'root' || this.state.editingNodeId === nodeId || this.state.connectSourceNodeId !== null) {
      return
    }

    const canvas = this.refs?.canvas
    if (!canvas) {
      return
    }

    const rect = canvas.getBoundingClientRect()
    this.state.drag = {
      nodeId,
      offsetX: event.clientX - rect.left - node.position.x,
      offsetY: event.clientY - rect.top - node.position.y,
    }
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (!this.state.drag) {
      return
    }

    const canvas = this.refs?.canvas
    if (!canvas) {
      return
    }

    const rect = canvas.getBoundingClientRect()
    const nextPosition = {
      x: clamp(event.clientX - rect.left - this.state.drag.offsetX, 120, WORKSPACE_WIDTH - 120),
      y: clamp(event.clientY - rect.top - this.state.drag.offsetY, 96, WORKSPACE_HEIGHT - 96),
    }

    this.updateNode(this.state.drag.nodeId, (node) => {
      node.position = nextPosition
    })
    this.updateDraggedNodeView(this.state.drag.nodeId)
  }

  private readonly handlePointerUp = (): void => {
    if (!this.state.drag) {
      return
    }

    this.state.drag = null
    touchDocument(this.state.document)
    this.scheduleAutosave('status.layoutSaveScheduled')
  }

  private readonly handleGlobalKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.state.settingsOpen) {
      event.preventDefault()
      this.closeSettings()
      return
    }

    if (this.onboardingOpen() || this.state.settingsOpen || isTypingTarget(event.target)) {
      return
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      void this.saveDocument('status.saved')
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
    const selectedNode = this.selectedNode()
    if (!selectedNode) {
      return
    }

    this.ensureShell()
    this.applyLocale()
    this.applyTheme()
    this.renderHeader()
    this.renderWorkspace()
    this.renderInspector()
    this.renderDock()
    this.renderSettings()
    this.renderOnboarding()
    this.focusEditorIfNeeded()
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
          </section>

          <section class="floating-bar floating-bar-center toolbar-cluster">
            <button type="button" class="action-button" data-role="save-button" data-command="save"></button>
            <button type="button" class="action-button" data-role="layout-button" data-command="auto-layout"></button>
            <button type="button" class="action-button" data-role="connect-button" data-command="connect-selected"></button>
            <button type="button" class="action-button" data-role="export-button" data-command="export-markdown"></button>
          </section>

          <section class="floating-bar floating-bar-right toolbar-cluster">
            <button type="button" class="action-button" data-role="theme-button" data-command="theme-toggle"></button>
            <button type="button" class="action-button" data-role="settings-button" data-command="toggle-settings"></button>
            <button type="button" class="action-button" data-role="import-button" data-command="import-file"></button>
            <input type="file" accept=".md,.markdown,.txt,text/plain,text/markdown" data-role="import-input" data-import-input hidden />
          </section>

          <section class="workspace-panel">
            <div class="workspace-scroll">
              <div class="workspace-canvas" data-workspace-canvas>
                <svg class="edge-layer" viewBox="0 0 ${WORKSPACE_WIDTH} ${WORKSPACE_HEIGHT}" aria-hidden="true" data-edge-layer></svg>
                <div class="node-layer" data-node-layer></div>
              </div>
            </div>
          </section>

          <aside class="inspector" data-inspector></aside>
          <section class="floating-bar floating-bar-bottom" data-dock></section>
          <div data-settings-layer></div>
          <div data-onboarding-layer></div>
        </div>
      </div>
    `

    this.refs = {
      eyebrow: requiredElement(this.rootEl, '[data-app-eyebrow]'),
      title: requiredElement(this.rootEl, '[data-app-title]'),
      status: requiredElement(this.rootEl, '[data-app-status]'),
      settingsButton: requiredElement(this.rootEl, '[data-role="settings-button"]'),
      themeButton: requiredElement(this.rootEl, '[data-role="theme-button"]'),
      saveButton: requiredElement(this.rootEl, '[data-role="save-button"]'),
      layoutButton: requiredElement(this.rootEl, '[data-role="layout-button"]'),
      exportButton: requiredElement(this.rootEl, '[data-role="export-button"]'),
      importButton: requiredElement(this.rootEl, '[data-role="import-button"]'),
      topbarConnectButton: requiredElement(this.rootEl, '[data-role="connect-button"]'),
      importInput: requiredElement(this.rootEl, '[data-role="import-input"]'),
      canvas: requiredElement(this.rootEl, '[data-workspace-canvas]'),
      edgeLayer: requiredElement(this.rootEl, '[data-edge-layer]'),
      nodeLayer: requiredElement(this.rootEl, '[data-node-layer]'),
      inspector: requiredElement(this.rootEl, '[data-inspector]'),
      settingsLayer: requiredElement(this.rootEl, '[data-settings-layer]'),
      onboardingLayer: requiredElement(this.rootEl, '[data-onboarding-layer]'),
      dock: requiredElement(this.rootEl, '[data-dock]'),
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
    this.refs.saveButton.textContent = this.t('toolbar.save')
    this.refs.layoutButton.textContent = this.t('toolbar.autoLayout')
    this.refs.exportButton.textContent = this.t('toolbar.exportMarkdown')
    this.refs.importButton.textContent = this.t('toolbar.import')
    this.refs.settingsButton.textContent = this.t('toolbar.settings')
    this.refs.themeButton.textContent = this.t('toolbar.theme', {
      theme: themeLabel(locale, this.state.document.theme),
    })
    this.refs.topbarConnectButton.textContent = this.t('toolbar.connect')
    this.refs.topbarConnectButton.classList.toggle('is-active', this.state.connectSourceNodeId !== null)
    this.refs.settingsButton.classList.toggle('is-active', this.state.settingsOpen)
    document.title = `${this.state.document.title} · Code Mind`
  }

  private renderWorkspace(): void {
    if (!this.refs) {
      return
    }

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
    const relationModeText = this.state.connectSourceNodeId
      ? this.t('inspector.relationConnecting', {
          title: this.findNode(this.state.connectSourceNodeId)?.title ?? this.t('common.unknown'),
        })
      : this.t('inspector.relationIdle')

    this.refs.inspector.innerHTML = `
      <section class="inspector-card">
        <p class="section-label">${this.t('inspector.selected')}</p>
        <h2>${escapeHtml(selectedNode.title)}</h2>
        <div class="metric-row">
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
          <button type="button" class="chip-button" data-command="new-child">${this.t('action.newChild')}</button>
          <button type="button" class="chip-button" data-command="new-sibling">${this.t('action.newSibling')}</button>
          <button type="button" class="chip-button" data-command="rename-selected">${this.t('action.rename')}</button>
          <button type="button" class="chip-button" data-command="toggle-collapse" ${directChildren.length === 0 ? 'disabled' : ''}>
            ${selectedNode.collapsed ? this.t('action.expand') : this.t('action.collapse')}
          </button>
          <button type="button" class="chip-button ${this.state.connectSourceNodeId ? 'is-active' : ''}" data-command="connect-selected">${this.t('action.linkRelation')}</button>
          <button type="button" class="chip-button danger" data-command="delete-selected" ${selectedNode.id === 'root' ? 'disabled' : ''}>${this.t('action.delete')}</button>
        </div>
      </section>

      <section class="inspector-card">
        <p class="section-label">${this.t('inspector.relations')}</p>
        <p class="inspector-copy">${escapeHtml(relationModeText)}</p>
        ${this.renderRelationList(selectedNode.id)}
      </section>

      <section class="inspector-card">
        <p class="section-label">${this.t('inspector.interaction')}</p>
        <ul class="shortcut-list">
          <li><kbd>Tab</kbd><span>${this.t('interaction.addChild')}</span></li>
          <li><kbd>Enter</kbd><span>${this.t('interaction.addSibling')}</span></li>
          <li><kbd>Delete</kbd><span>${this.t('interaction.deleteSubtree')}</span></li>
          <li><kbd>Space</kbd><span>${this.t('interaction.collapseBranch')}</span></li>
          <li><kbd>F2</kbd><span>${this.t('interaction.renameNode')}</span></li>
          <li><kbd>Ctrl/Cmd + L</kbd><span>${this.t('interaction.tidyLayout')}</span></li>
          <li><kbd>Ctrl/Cmd + S</kbd><span>${this.t('interaction.saveLocal')}</span></li>
        </ul>
      </section>

      <section class="inspector-card">
        <p class="section-label">${this.t('inspector.deferred')}</p>
        <p class="inspector-copy">${this.t('inspector.deferredCopy')}</p>
      </section>
    `
  }

  private renderDock(): void {
    if (!this.refs) {
      return
    }

    this.refs.dock.innerHTML = `
      <span class="dock-chip">${this.t('dock.nodes', { value: this.state.document.nodes.length })}</span>
      <span class="dock-chip">${this.t('dock.relations', { value: this.state.document.relations.length })}</span>
      <span class="dock-chip">${this.t('dock.theme', { value: themeLabel(this.state.preferences.locale, this.state.document.theme) })}</span>
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

    return this.state.document.nodes
      .filter((node) => visibleIds.has(node.id))
      .map((node) => {
        const classes = [
          'node-card',
          `node-${node.kind}`,
          node.id === this.state.selectedNodeId ? 'is-selected' : '',
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

        const content = this.state.editingNodeId === node.id
          ? `<input class="node-editor" data-node-editor="${node.id}" value="${escapeAttribute(node.title)}" maxlength="120" />`
          : `<button type="button" class="node-shell" data-node-button="${node.id}">
               ${priorityBadge}
               <span class="node-title">${escapeHtml(shorten(node.title, node.kind === 'root' ? 60 : 72))}</span>
               ${branchBadge}
             </button>`

        return `
          <article
            class="${classes}"
            data-node-id="${node.id}"
            style="left: ${node.position.x}px; top: ${node.position.y}px;"
          >
            ${content}
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

  private selectNode(nodeId: string): void {
    if (this.state.connectSourceNodeId && this.state.connectSourceNodeId !== nodeId) {
      this.createRelation(this.state.connectSourceNodeId, nodeId)
      return
    }

    if (this.state.connectSourceNodeId && this.state.connectSourceNodeId === nodeId) {
      this.state.connectSourceNodeId = null
      this.setStatus('status.relationModeCancelled')
    }

    this.state.selectedNodeId = nodeId
    this.state.editingNodeId = null
    this.render()
  }

  private createChildNode(parentId: string): void {
    const parent = this.findNode(parentId)
    if (!parent) {
      return
    }

    parent.collapsed = false
    parent.updatedAt = new Date().toISOString()
    const newNode = createNode({
      parentId,
      kind: 'topic',
      position: nextChildPosition(this.state.document, parentId),
      title: this.t('node.newChild'),
    })

    this.state.document.nodes.push(newNode)
    this.state.selectedNodeId = newNode.id
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
    this.state.selectedNodeId = newNode.id
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

    this.state.document.relations.push(relation)
    this.state.connectSourceNodeId = null
    this.state.selectedNodeId = targetId
    touchDocument(this.state.document)
    this.setStatus('status.relationCreated')
    this.render()
    this.scheduleAutosave('status.relationSaveScheduled')
  }

  private deleteSelectedNode(): void {
    const selectedNode = this.selectedNode()
    if (!selectedNode || selectedNode.id === 'root') {
      this.setStatus('status.rootCannotDelete')
      this.render()
      return
    }

    const fallbackNodeId = selectedNode.parentId || findRoot(this.state.document).id
    const result = deleteNodeTree(this.state.document, selectedNode.id)
    if (result.removedNodes === 0) {
      return
    }

    this.state.selectedNodeId = fallbackNodeId
    this.state.editingNodeId = null
    this.state.connectSourceNodeId = null
    touchDocument(this.state.document)
    this.setStatus('status.deletedSummary', {
      nodes: result.removedNodes,
      relations: result.removedRelations,
    })
    this.render()
    this.scheduleAutosave('status.deletionSaveScheduled')
  }

  private setPriority(priority: Priority): void {
    const node = this.selectedNode()
    if (!node) {
      return
    }

    this.updateNode(node.id, (draft) => {
      draft.priority = priority || undefined
    })
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
    this.updateNode(nodeId, (node) => {
      node.title = title
    })
    this.state.editingNodeId = null
    this.state.selectedNodeId = nodeId
    touchDocument(this.state.document)
    this.setStatus('status.nodeTitleUpdated')
    this.render()
    this.scheduleAutosave('status.titleSaveScheduled')
  }

  private commitRelationLabel(relationId: string, rawLabel: string): void {
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
    const movedNodes = autoLayoutHierarchy(this.state.document)
    touchDocument(this.state.document)
    this.setStatus('status.layoutUpdated', { count: movedNodes })
    this.render()
    this.scheduleAutosave('status.layoutSaveScheduled')
  }

  private async runCommand(rawCommand: string): Promise<void> {
    const [command, argument = ''] = rawCommand.split(':')

    switch (command) {
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
  }

  private removeRelation(relationId: string): void {
    const removed = deleteRelation(this.state.document, relationId)
    if (!removed) {
      return
    }

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
      this.state.document = importedDocument
      this.state.selectedNodeId = findRoot(importedDocument).id
      this.state.editingNodeId = null
      this.state.connectSourceNodeId = null
      this.setStatus('status.imported', { filename: file.name })
      this.applyTheme()
      this.render()
      await this.saveDocument('status.importedSaved')
    } catch (error) {
      this.setStatus('status.importFailed', { reason: getErrorMessage(error) })
      this.render()
    }
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

  private findNode(nodeId: string): MindNode | undefined {
    return findNode(this.state.document, nodeId)
  }

  private updateDraggedNodeView(nodeId: string): void {
    if (!this.refs) {
      return
    }

    const node = this.findNode(nodeId)
    const element = this.rootEl.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`)
    if (node && element) {
      element.style.left = `${node.position.x}px`
      element.style.top = `${node.position.y}px`
    }

    this.refs.edgeLayer.innerHTML = this.renderEdges()
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
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

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector)
  if (!element) {
    throw new Error(`Missing required element: ${selector}`)
  }
  return element
}
