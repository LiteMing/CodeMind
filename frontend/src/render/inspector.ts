import type { MindMapApp } from '../app'
import { PRIORITY_VALUES } from '../app-types'
import { NODE_COLOR_PALETTES, NODE_COLOR_VALUES } from '../color-palette'
import { childrenOf, connectedRelations, hiddenDescendantCount } from '../document'
import { kindLabel, themeLabel } from '../i18n'
import { normalizeNodeNote } from '../node-render'
import { escapeAttribute, escapeHtml, formatRelativeTime, shorten } from '../utils'
import type { NodeColor, Priority } from '../types'

export function renderInspector(app: MindMapApp): void {
  if (!app.refs) {
    return
  }

  const selectedNode = app.selectedNode()
  const selectedCount = app.selectedNodeIds().length
  const workspaceMetrics = `
    <span class="metric-chip">${app.t('dock.selected', { value: selectedCount })}</span>
    <span class="metric-chip">${app.t('dock.nodes', { value: app.state.document.nodes.length })}</span>
    <span class="metric-chip">${app.t('dock.relations', { value: app.state.document.relations.length })}</span>
    <span class="metric-chip">${Math.round(app.viewport.scale * 100)}%</span>
    <span class="metric-chip">${app.t('dock.theme', { value: themeLabel(app.state.preferences.locale, app.state.document.theme) })}</span>
  `

  app.refs.inspector.classList.toggle('is-collapsed', app.state.inspectorCollapsed)
  if (!selectedNode) {
    app.refs.inspector.innerHTML = app.state.inspectorCollapsed
      ? `
        <section class="inspector-card inspector-card-compact inspector-handle-card">
          <p class="section-label">${app.t('inspector.summary')}</p>
          <p class="inspector-handle-copy">${app.t('inspector.noneSelected')}</p>
          <button type="button" class="action-button inspector-toggle-button" data-command="toggle-inspector">${app.t('panel.side.show')}</button>
        </section>
      `
      : `
        <section class="inspector-card">
          <div class="inspector-header">
            <div>
              <p class="section-label">${app.t('inspector.selected')}</p>
              <h2>${app.t('inspector.noneSelected')}</h2>
            </div>
            <button type="button" class="ghost-button" data-command="toggle-inspector">${app.t('panel.side.hide')}</button>
          </div>
          <p class="inspector-copy">${app.t('inspector.emptySelectionCopy')}</p>
        </section>

        <section class="inspector-card">
          <p class="section-label inspector-section-header" data-command="toggle-inspector-section:advanced">${app.t('panel.workspace')} ${app.inspectorSectionsCollapsed.has('advanced') ? '▸' : '▾'}</p>
          <div class="${app.inspectorSectionsCollapsed.has('advanced') ? 'section-collapsed' : 'section-expanded'}">
            <div class="metric-row">
              ${workspaceMetrics}
            </div>
          </div>
        </section>

        <section class="inspector-card">
          <p class="section-label inspector-section-header" data-command="toggle-inspector-section:snapshots">${app.t('snapshot.title')} ${app.inspectorSectionsCollapsed.has('snapshots') ? '▸' : '▾'}</p>
          <div class="${app.inspectorSectionsCollapsed.has('snapshots') ? 'section-collapsed' : 'section-expanded'}">
            ${renderSnapshotSectionContent(app)}
          </div>
        </section>
      `
    return
  }

  const relatedRelations = connectedRelations(app.state.document, selectedNode.id)
  const directChildren = childrenOf(app.state.document, selectedNode.id)
  const hiddenChildren = hiddenDescendantCount(app.state.document, selectedNode.id)
  const singleSelection = selectedCount === 1
  const canDeleteSelection = app.selectedNodeIds().some((nodeId) => app.findNode(nodeId)?.kind !== 'root')
  const relationModeText = app.state.connectSourceNodeId
    ? app.t('inspector.relationConnecting', {
        title: app.findNode(app.state.connectSourceNodeId)?.title ?? app.t('common.unknown'),
      })
    : app.t('inspector.relationIdle')
  const selectionTitle = singleSelection
    ? selectedNode.title
    : app.t('context.selectionCount', {
        value: selectedCount,
      })
  const selectedNote = normalizeNodeNote(selectedNode.note) ?? ''

  app.refs.inspector.innerHTML = app.state.inspectorCollapsed
    ? `
      <section class="inspector-card inspector-card-compact inspector-handle-card">
        <p class="section-label">${app.t('inspector.summary')}</p>
        <p class="inspector-handle-copy">${escapeHtml(shorten(selectionTitle, 24))}</p>
        <button type="button" class="action-button inspector-toggle-button" data-command="toggle-inspector">${app.t('panel.side.show')}</button>
      </section>
    `
    : `
      <section class="inspector-card">
        <div class="inspector-header">
          <div>
            <p class="section-label inspector-section-header" data-command="toggle-inspector-section:node">${app.t('inspector.selected')} ${app.inspectorSectionsCollapsed.has('node') ? '▸' : '▾'}</p>
            <h2>${escapeHtml(selectionTitle)}</h2>
          </div>
          <button type="button" class="ghost-button" data-command="toggle-inspector">${app.t('panel.side.hide')}</button>
        </div>
        <div class="${app.inspectorSectionsCollapsed.has('node') ? 'section-collapsed' : 'section-expanded'}">
        <div class="metric-row">
          <span class="metric-chip">${app.t('dock.selected', { value: selectedCount })}</span>
          <span class="metric-chip">${app.t('inspector.type', { value: kindLabel(app.state.preferences.locale, selectedNode.kind) })}</span>
          <span class="metric-chip">${app.t('inspector.children', { value: directChildren.length })}</span>
          <span class="metric-chip">${app.t('inspector.relationsCount', { value: relatedRelations.length })}</span>
          <span class="metric-chip">${app.t('inspector.hidden', { value: hiddenChildren })}</span>
        </div>
        <p class="inspector-copy">${app.t('inspector.position', {
          x: Math.round(selectedNode.position.x),
          y: Math.round(selectedNode.position.y),
        })}</p>
        <div class="inspector-note-group">
          <div class="inspector-note-header">
            <p class="section-label">${app.t('inspector.note')}</p>
            ${singleSelection && selectedNote ? `<span class="metric-chip">${app.t('inspector.noteSaved')}</span>` : ''}
          </div>
          <textarea class="settings-input inspector-note-input" data-node-note="${escapeAttribute(selectedNode.id)}" placeholder="${escapeAttribute(
            singleSelection ? app.t('inspector.notePlaceholder') : app.t('inspector.noteDisabledPlaceholder'),
          )}" ${singleSelection ? '' : 'readonly'}>${escapeHtml(singleSelection ? selectedNote : '')}</textarea>
        </div>
        <div class="priority-row">
          ${PRIORITY_VALUES.map((priority) => renderPriorityButton(app, priority, selectedNode.priority ?? '')).join('')}
        </div>
        <div class="inspector-color-group">
          <p class="section-label">${app.t('inspector.color')}</p>
          <div class="color-row">
            ${NODE_COLOR_VALUES.map((color) => renderNodeColorButton(app, color, selectedNode.color ?? '')).join('')}
          </div>
        </div>
        <div class="action-grid">
          <button type="button" class="chip-button" data-command="new-child" ${singleSelection ? '' : 'disabled'}>${app.t('action.newChild')}</button>
          <button type="button" class="chip-button" data-command="new-sibling" ${singleSelection ? '' : 'disabled'}>${app.t('action.newSibling')}</button>
          <button type="button" class="chip-button" data-command="new-floating" ${singleSelection ? '' : 'disabled'}>${app.t('action.newFloating')}</button>
          <button type="button" class="chip-button" data-command="rename-selected" ${singleSelection ? '' : 'disabled'}>${app.t('action.rename')}</button>
          <button type="button" class="chip-button" data-command="toggle-collapse" ${singleSelection && directChildren.length > 0 ? '' : 'disabled'}>
            ${selectedNode.collapsed ? app.t('action.expand') : app.t('action.collapse')}
          </button>
          <button type="button" class="chip-button ${app.state.connectSourceNodeId ? 'is-active' : ''}" data-command="connect-selected" ${singleSelection ? '' : 'disabled'}>${app.t('action.linkRelation')}</button>
          <button type="button" class="chip-button danger" data-command="delete-selected" ${canDeleteSelection ? '' : 'disabled'}>${app.t('action.delete')}</button>
        </div>
        </div>
      </section>

      <section class="inspector-card">
        <p class="section-label inspector-section-header" data-command="toggle-inspector-section:advanced">${app.t('panel.workspace')} ${app.inspectorSectionsCollapsed.has('advanced') ? '▸' : '▾'}</p>
        <div class="${app.inspectorSectionsCollapsed.has('advanced') ? 'section-collapsed' : 'section-expanded'}">
          <div class="metric-row">
            ${workspaceMetrics}
          </div>
        </div>
      </section>

      <section class="inspector-card">
        <p class="section-label inspector-section-header" data-command="toggle-inspector-section:snapshots">${app.t('snapshot.title')} ${app.inspectorSectionsCollapsed.has('snapshots') ? '▸' : '▾'}</p>
        <div class="${app.inspectorSectionsCollapsed.has('snapshots') ? 'section-collapsed' : 'section-expanded'}">
          ${renderSnapshotSectionContent(app)}
        </div>
      </section>

      <section class="inspector-card">
        <p class="section-label inspector-section-header" data-command="toggle-inspector-section:relations">${app.t('inspector.relations')} ${app.inspectorSectionsCollapsed.has('relations') ? '▸' : '▾'}</p>
        <div class="${app.inspectorSectionsCollapsed.has('relations') ? 'section-collapsed' : 'section-expanded'}">
          <p class="inspector-copy">${escapeHtml(relationModeText)}</p>
          ${renderRelationList(app, selectedNode.id)}
        </div>
      </section>
    `
}

export function renderNodeColorButton(app: MindMapApp, color: NodeColor, selectedColor: NodeColor): string {
  const active = selectedColor === color
  if (color === '') {
    return `<button type="button" class="color-button color-button-clear ${active ? 'is-active' : ''}" data-node-color="" title="${escapeAttribute(app.t('color.clear'))}" aria-label="${escapeAttribute(app.t('color.clear'))}">${app.t('color.clear')}</button>`
  }

  const palette = NODE_COLOR_PALETTES[color]
  const label = app.t(palette.labelKey)
  return `
    <button
      type="button"
      class="color-button ${active ? 'is-active' : ''}"
      data-node-color="${color}"
      title="${escapeAttribute(label)}"
      aria-label="${escapeAttribute(label)}"
      style="--color-swatch: ${palette.accent};"
    >
      <span class="color-button-swatch"></span>
    </button>
  `
}

export function renderPriorityButton(app: MindMapApp, priority: Priority, selectedPriority: Priority): string {
  const label = priority === '' ? app.t('priority.clear') : priority
  const active = selectedPriority === priority
  return `<button type="button" class="chip-button ${active ? 'is-active' : ''}" data-priority="${priority}">${label}</button>`
}

export function renderRelationList(app: MindMapApp, nodeId: string): string {
  const relations = connectedRelations(app.state.document, nodeId)
  if (relations.length === 0) {
    return `<p class="empty-state">${app.t('inspector.emptyRelations')}</p>`
  }

  return `
    <ul class="relation-list">
      ${relations
        .map((relation) => {
          const otherNodeId = relation.sourceId === nodeId ? relation.targetId : relation.sourceId
          const otherNode = app.findNode(otherNodeId)
          const otherNodeCommandId = escapeAttribute(otherNodeId)
          const relationId = escapeAttribute(relation.id)
          return `
            <li class="relation-item">
              <div class="relation-item-top">
                <button type="button" class="text-button" data-command="focus-node:${otherNodeCommandId}">
                  ${escapeHtml(otherNode?.title ?? app.t('common.unknownNode'))}
                </button>
                <button type="button" class="ghost-button danger" data-command="delete-relation:${relationId}">${app.t('action.remove')}</button>
              </div>
              <input
                class="relation-input"
                data-relation-label="${relationId}"
                value="${escapeAttribute(relation.label ?? '')}"
                placeholder="${escapeAttribute(app.t('inspector.relationPlaceholder'))}"
              />
            </li>
          `
        })
        .join('')}
    </ul>
  `
}

export function renderSnapshotSectionContent(app: MindMapApp): string {
  const snapshots = app.currentSnapshotList()
  const canSaveSnapshot = Boolean(app.state.currentMapId)
  return `
    <p class="inspector-copy">${app.t('snapshot.copy')}</p>
    <div class="snapshot-save-row">
      <label class="snapshot-name-field">
        <span class="snapshot-name-label">${app.t('snapshot.nameLabel')}</span>
        <input
          class="settings-input snapshot-name-input"
          data-snapshot-name
          value="${escapeAttribute(app.state.snapshotDraftName)}"
          placeholder="${escapeAttribute(app.t('snapshot.namePlaceholder'))}"
          ${canSaveSnapshot ? '' : 'disabled'}
        />
      </label>
      <button type="button" class="chip-button" data-command="save-snapshot" ${canSaveSnapshot ? '' : 'disabled'}>${app.t('snapshot.save')}</button>
    </div>
    ${
      snapshots.length === 0
        ? `<p class="empty-state">${app.t('snapshot.empty')}</p>`
        : `
          <ul class="snapshot-list">
            ${snapshots
              .map((snapshot) => {
                const modeLabel = snapshot.mode === 'manual' ? app.t('snapshot.modeManual') : app.t('snapshot.modeAuto')
                const metaSuffix =
                  snapshot.mapTitle && snapshot.mapTitle !== snapshot.title ? ` · ${escapeHtml(snapshot.mapTitle)}` : ''
                return `
                  <li class="snapshot-item">
                    <div class="snapshot-item-copy">
                      <p class="snapshot-item-title">${escapeHtml(snapshot.title)}</p>
                      <p class="snapshot-item-meta">${escapeHtml(modeLabel)} · ${escapeHtml(
                        formatRelativeTime(snapshot.createdAt, app.state.preferences.locale),
                      )} · ${escapeHtml(app.t('dock.nodes', { value: snapshot.nodeCount }))}${metaSuffix}</p>
                    </div>
                    <button type="button" class="ghost-button snapshot-restore-button" data-command="restore-snapshot:${escapeAttribute(snapshot.id)}">${app.t('snapshot.restore')}</button>
                  </li>
                `
              })
              .join('')}
          </ul>
        `
    }
  `
}
