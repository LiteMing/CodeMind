import type { MindMapApp } from '../app'
import { NODE_COLOR_PALETTES, NODE_COLOR_VALUES } from '../color-palette'
import { childrenOf } from '../document'
import { escapeHtml, shorten } from '../utils'
import type { NodeColor } from '../types'

export function renderContextMenu(app: MindMapApp): string {
  if (!app.refs || !app.state.contextMenu) {
    return ''
  }

  const stageRect = app.refs.overlayLayer.getBoundingClientRect()
  const left = Math.round(app.state.contextMenu.clientX - stageRect.left)
  const top = Math.round(app.state.contextMenu.clientY - stageRect.top)

  // Relation context menu
  if (app.state.contextMenu.relationId) {
    const relation = app.state.document.relations.find((r) => r.id === app.state.contextMenu!.relationId)
    const sourceNode = relation ? app.findNode(relation.sourceId) : null
    const targetNode = relation ? app.findNode(relation.targetId) : null
    const arrowDir = relation?.arrowDirection ?? 'none'
    const sourceLabel = sourceNode ? shorten(sourceNode.title, 12) : 'A'
    const targetLabel = targetNode ? shorten(targetNode.title, 12) : 'B'
    return `
      <section class="relation-wheel-shell" data-context-menu style="left: ${Math.round(left)}px; top: ${Math.round(top)}px;">
        <section class="relation-wheel" data-relation-wheel>
          <p class="section-label relation-wheel-label">${app.t('context.relation')}</p>
          <button type="button" class="relation-wheel-button relation-wheel-button-top ${arrowDir === 'both' ? 'is-active' : ''}" data-command="set-arrow:both:${app.state.contextMenu.relationId}">${app.t('action.arrowBoth')}</button>
          <button type="button" class="relation-wheel-button relation-wheel-button-left ${arrowDir === 'backward' ? 'is-active' : ''}" data-command="set-arrow:backward:${app.state.contextMenu.relationId}">${escapeHtml(sourceLabel)}</button>
          <button type="button" class="relation-wheel-button relation-wheel-button-right ${arrowDir === 'forward' ? 'is-active' : ''}" data-command="set-arrow:forward:${app.state.contextMenu.relationId}">${escapeHtml(targetLabel)}</button>
          <button type="button" class="relation-wheel-button relation-wheel-button-bottom ${arrowDir === 'none' ? 'is-active' : ''}" data-command="set-arrow:none:${app.state.contextMenu.relationId}">${app.t('action.arrowNone')}</button>
          <div class="relation-wheel-center">${app.state.preferences.locale === 'zh-CN' ? '箭头' : 'Arrow'}</div>
        </section>
        <div class="relation-wheel-actions">
          <button type="button" class="chip-button context-menu-button" data-command="branch-connection:${app.state.contextMenu.relationId}">${app.t('action.branchConnection')}</button>
          <button type="button" class="chip-button danger context-menu-button" data-command="delete-relation:${app.state.contextMenu.relationId}">${app.t('action.remove')}</button>
        </div>
      </section>
    `
  }

  // Region context menu
  if (app.state.contextMenu.regionId) {
    const ctxRegion = app.state.document.regions?.find((r) => r.id === app.state.contextMenu!.regionId)
    const currentRegionColor = ctxRegion?.color ?? ''
    return `
      <section class="context-menu" data-context-menu style="left: ${Math.round(left)}px; top: ${Math.round(top)}px;">
        <p class="section-label">${app.t('context.regionActions')}</p>
        ${NODE_COLOR_VALUES.filter((c) => c !== '')
          .map((color) => {
            const palette = NODE_COLOR_PALETTES[color as Exclude<NodeColor, ''>]
            const activeClass = color === currentRegionColor ? ' is-active' : ''
            return `<button type="button" class="chip-button context-menu-button${activeClass}" data-command="set-region-color:${color}:${app.state.contextMenu!.regionId}" style="border-left: 4px solid ${palette.accent};">${app.t(palette.labelKey)}</button>`
          })
          .join('')}
        <div class="context-menu-divider"></div>
        <button type="button" class="chip-button danger context-menu-button" data-command="delete-region:${app.state.contextMenu.regionId}">${app.t('action.deleteRegion')}</button>
      </section>
    `
  }

  const selectedIds = app.selectedNodeIds()
  const selectedCount = selectedIds.length
  const primaryNode = app.selectedNode()
  const isCanvasMenu = app.state.contextMenu.nodeId === null
  const primaryChildren = !isCanvasMenu && primaryNode ? childrenOf(app.state.document, primaryNode.id).length : 0
  const canUseSingleNodeActions = !isCanvasMenu && selectedCount === 1 && Boolean(primaryNode)
  const canDelete = !isCanvasMenu && selectedIds.some((nodeId) => app.findNode(nodeId)?.kind !== 'root')
  const heading = isCanvasMenu
    ? app.t('context.canvas')
    : selectedCount > 1
      ? app.t('context.selectionCount', { value: selectedCount })
      : escapeHtml(primaryNode?.title ?? app.t('context.canvas'))

  return `
    <section class="context-menu" data-context-menu style="left: ${Math.round(left)}px; top: ${Math.round(top)}px;">
      <p class="section-label">${app.t(app.state.contextMenu.nodeId ? 'context.node' : 'context.canvas')}</p>
      <h3 class="context-menu-title">${heading}</h3>
      <button type="button" class="chip-button context-menu-button" data-command="new-child" ${canUseSingleNodeActions ? '' : 'disabled'}>${app.t('action.newChild')}</button>
      <button type="button" class="chip-button context-menu-button" data-command="new-sibling" ${canUseSingleNodeActions ? '' : 'disabled'}>${app.t('action.newSibling')}</button>
      <button type="button" class="chip-button context-menu-button" data-command="new-floating">${app.t('action.newFloating')}</button>
      <button type="button" class="chip-button context-menu-button" data-command="rename-selected" ${canUseSingleNodeActions ? '' : 'disabled'}>${app.t('action.rename')}</button>
      <button type="button" class="chip-button context-menu-button" data-command="toggle-collapse" ${canUseSingleNodeActions && primaryChildren > 0 ? '' : 'disabled'}>
        ${primaryNode?.collapsed ? app.t('action.expand') : app.t('action.collapse')}
      </button>
      <button type="button" class="chip-button context-menu-button" data-command="tidy-subtree:${app.state.contextMenu.nodeId ?? ''}" ${canUseSingleNodeActions && primaryChildren > 0 ? '' : 'disabled'}>${app.t('context.tidyChildren')}</button>
      <button type="button" class="chip-button context-menu-button" data-command="connect-selected" ${canUseSingleNodeActions ? '' : 'disabled'}>${app.t('action.linkRelation')}</button>
      <div class="context-menu-divider"></div>
      <button type="button" class="chip-button context-menu-button" data-command="create-region">${app.t('action.createRegion')}</button>
      <div class="context-menu-divider"></div>
      <button type="button" class="chip-button context-menu-button" data-command="set-priority:P0" ${canUseSingleNodeActions ? '' : 'disabled'}>${app.t('context.priorityP0')}</button>
      <button type="button" class="chip-button context-menu-button" data-command="set-priority:P1" ${canUseSingleNodeActions ? '' : 'disabled'}>${app.t('context.priorityP1')}</button>
      <button type="button" class="chip-button context-menu-button" data-command="set-priority:" ${canUseSingleNodeActions ? '' : 'disabled'}>${app.t('context.clearPriority')}</button>
      <button type="button" class="chip-button danger context-menu-button" data-command="delete-selected" ${canDelete ? '' : 'disabled'}>${app.t('action.delete')}</button>
    </section>
  `
}
