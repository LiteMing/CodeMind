import type { MindMapApp } from '../app'
import { childrenOf } from '../document'
import { themeLabel } from '../i18n'
import { escapeAttribute, escapeHtml } from '../utils'
import type { FixedMenuId } from '../app-types'

export function renderFixedToolbar(app: MindMapApp): string {
  const locale = app.state.preferences.locale
  const selectedNode = app.selectedNode()
  const hasSelection = Boolean(selectedNode)
  const childCount = selectedNode ? childrenOf(app.state.document, selectedNode.id).length : 0
  const canDeleteSelection = app.selectedNodeIds().some((nodeId) => app.findNode(nodeId)?.kind !== 'root')
  const aiBusy = app.state.ai.busy
  const labels =
    locale === 'zh-CN'
      ? {
          file: '文件',
          node: '节点',
          ai: 'AI',
          view: '视图',
        }
      : {
          file: 'File',
          node: 'Node',
          ai: 'AI',
          view: 'View',
        }

  const renderMenuItem = (command: string, label: string, disabled = false, tone: '' | 'danger' = ''): string => {
    return `
      <button type="button" class="fixed-menu-item ${tone}" data-command="${command}" ${disabled ? 'disabled' : ''}>
        ${escapeHtml(label)}
      </button>
    `
  }

  const renderMenu = (menuId: FixedMenuId, label: string, content: string): string => {
    const open = app.state.fixedMenu === menuId
    return `
      <div class="fixed-menu-group ${open ? 'is-open' : ''}">
        <button
          type="button"
          class="fixed-toolbar-tab ${open ? 'is-active' : ''}"
          data-command="toggle-fixed-menu:${menuId}"
          aria-expanded="${open ? 'true' : 'false'}"
        >
          ${escapeHtml(label)}
        </button>
        ${
          open
            ? `
              <div class="fixed-menu-popup">
                ${content}
              </div>
            `
            : ''
        }
      </div>
    `
  }

  return `
    <div class="fixed-toolbar-shell" data-fixed-menu-shell>
      <div class="fixed-toolbar-main">
        <button type="button" class="chip-button fixed-toolbar-home" data-command="go-home">${app.t('toolbar.home')}</button>
        <div class="fixed-toolbar-copy">
          <p class="eyebrow">${app.t('app.eyebrow')}</p>
          <strong>${escapeHtml(app.state.document.title)}</strong>
        </div>
        <span class="save-indicator ${app.state.dirty ? 'is-dirty' : ''}" title="${escapeAttribute(app.t(app.state.dirty ? 'status.unsaved' : 'status.allSaved'))}"></span>
        <p class="fixed-toolbar-status" aria-live="polite">${escapeHtml(app.t(app.state.status.key, app.state.status.values))}</p>
      </div>

      <div class="fixed-toolbar-menus">
        ${renderMenu(
          'file',
          labels.file,
          [
            renderMenuItem('save', app.t('toolbar.save')),
            renderMenuItem('import-file', app.t('toolbar.import')),
            renderMenuItem('export-markdown', app.t('toolbar.exportMarkdown')),
            renderMenuItem('rename-map', app.t('toolbar.renameMap')),
            renderMenuItem('delete-map', app.t('toolbar.deleteMap'), false, 'danger'),
          ].join(''),
        )}
        ${renderMenu(
          'node',
          labels.node,
          [
            renderMenuItem('new-child', app.t('action.newChild'), !hasSelection),
            renderMenuItem('new-sibling', app.t('action.newSibling'), !hasSelection),
            renderMenuItem('new-floating', app.t('action.newFloating')),
            renderMenuItem(
              'toggle-collapse',
              selectedNode?.collapsed ? app.t('action.expand') : app.t('action.collapse'),
              !hasSelection || childCount === 0,
            ),
            renderMenuItem('connect-selected', app.t('action.linkRelation'), !hasSelection),
            renderMenuItem('delete-selected', app.t('action.delete'), !canDeleteSelection, 'danger'),
          ].join(''),
        )}
        ${renderMenu(
          'ai',
          labels.ai,
          [
            renderMenuItem('open-ai-workspace', app.t('toolbar.ai'), aiBusy),
            renderMenuItem('ai-suggest-children', app.t('ai.suggestChildrenAction'), aiBusy || !hasSelection),
            renderMenuItem(
              'ai-suggest-siblings',
              app.t('ai.suggestSiblingsAction'),
              aiBusy || !app.canSuggestSiblings(),
            ),
            renderMenuItem('ai-complete-node-notes', app.t('ai.notesAction'), aiBusy),
            renderMenuItem('ai-connect-relations', app.t('ai.connectAction'), aiBusy),
          ].join(''),
        )}
        ${renderMenu(
          'view',
          labels.view,
          [
            renderMenuItem('auto-layout', app.t('toolbar.autoLayout')),
            renderMenuItem(
              'toggle-inspector',
              app.t(app.state.inspectorCollapsed ? 'panel.side.show' : 'panel.side.hide'),
            ),
            renderMenuItem('open-graph-overlay', app.t('toolbar.graph3d')),
            renderMenuItem(
              'theme-toggle',
              app.t('toolbar.theme', { theme: themeLabel(locale, app.state.document.theme) }),
            ),
            renderMenuItem('toggle-settings', app.t('toolbar.settings')),
            renderMenuItem('show-shortcut-overlay', app.t('toolbar.shortcuts')),
          ].join(''),
        )}
      </div>

      <div class="fixed-toolbar-quick">
        <button type="button" class="chip-button" data-command="undo" ${app.canUndo() ? '' : 'disabled'}>${app.t('toolbar.undo')}</button>
        <button type="button" class="chip-button" data-command="redo" ${app.canRedo() ? '' : 'disabled'}>${app.t('toolbar.redo')}</button>
        <button type="button" class="chip-button" data-command="save">${app.t('toolbar.save')}</button>
        <button type="button" class="chip-button" data-command="show-shortcut-overlay" title="${app.t('toolbar.shortcuts')} (Ctrl+/)" aria-label="${app.t('toolbar.shortcuts')}">?</button>
      </div>
    </div>
  `
}
