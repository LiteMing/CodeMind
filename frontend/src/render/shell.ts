import type { MindMapApp } from '../app'
import { themeLabel } from '../i18n'
import { renderEdges, renderNodes } from '../render/canvas'
import { renderRegions } from '../render/regions'
import { renderFixedToolbar } from '../render/toolbar'
import { getWorkspaceBounds } from '../utils'

export function renderHeader(app: MindMapApp): void {
  if (!app.refs) {
    return
  }

  const locale = app.state.preferences.locale
  const chromeLayout = app.state.preferences.appearance.chromeLayout
  app.refs.topChrome.dataset.panelPosition = app.state.preferences.appearance.topPanelPosition
  app.refs.topChrome.dataset.chromeLayout = chromeLayout
  app.refs.topPanel.classList.toggle('is-collapsed', app.state.topPanelCollapsed)
  app.refs.topPanel.classList.toggle('is-hidden', chromeLayout === 'fixed')
  app.refs.fixedToolbar.classList.toggle('is-visible', chromeLayout === 'fixed')
  app.refs.fixedToolbar.innerHTML = chromeLayout === 'fixed' ? renderFixedToolbar(app) : ''
  app.refs.eyebrow.textContent = app.t('app.eyebrow')
  app.refs.title.textContent = app.state.document.title
  app.refs.saveIndicator.classList.toggle('is-dirty', app.state.dirty)
  app.refs.saveIndicator.title = app.t(app.state.dirty ? 'status.unsaved' : 'status.allSaved')
  app.refs.status.textContent = app.t(app.state.status.key, app.state.status.values)
  app.refs.homeButton.textContent = app.t('toolbar.home')
  app.refs.topPanelButton.textContent = app.t(app.state.topPanelCollapsed ? 'panel.top.show' : 'panel.top.hide')
  app.refs.renameMapButton.textContent = app.t('toolbar.renameMap')
  app.refs.deleteMapButton.textContent = app.t('toolbar.deleteMap')
  app.refs.undoButton.textContent = app.t('toolbar.undo')
  app.refs.redoButton.textContent = app.t('toolbar.redo')
  app.refs.saveButton.textContent = app.t('toolbar.save')
  app.refs.conflictActions.hidden = app.state.revisionConflict === null
  app.refs.reloadServerButton.textContent = app.t('conflict.reloadServer')
  app.refs.overwriteServerButton.textContent = app.t('conflict.overwriteServer')
  app.refs.reloadServerButton.disabled = app.conflictResolutionInFlight
  app.refs.overwriteServerButton.disabled =
    app.conflictResolutionInFlight || app.state.revisionConflict?.actualRevision === null
  app.refs.layoutButton.textContent = app.t('toolbar.autoLayout')
  app.refs.exportButton.textContent = app.t('toolbar.exportMarkdown')
  app.refs.importButton.textContent = app.t('toolbar.import')
  app.refs.aiButton.textContent = app.t('toolbar.ai')
  app.refs.graphButton.textContent = app.t('toolbar.graph3d')
  app.refs.settingsButton.textContent = app.t('toolbar.settings')
  app.refs.panelButton.textContent = app.t(app.state.inspectorCollapsed ? 'panel.side.show' : 'panel.side.hide')
  app.refs.themeButton.textContent = app.t('toolbar.theme', {
    theme: themeLabel(locale, app.state.document.theme),
  })
  app.refs.topbarConnectButton.textContent = app.t('toolbar.connect')
  app.refs.undoButton.disabled = !app.canUndo()
  app.refs.redoButton.disabled = !app.canRedo()
  app.refs.topbarConnectButton.classList.toggle('is-active', app.state.connectSourceNodeId !== null)
  app.refs.aiButton.classList.toggle('is-active', app.state.ai.open)
  app.refs.aiButton.disabled = app.state.ai.busy
  app.refs.graphButton.classList.toggle('is-active', app.state.graph.open)
  app.refs.settingsButton.classList.toggle('is-active', app.state.settingsOpen)
  app.refs.panelButton.classList.toggle('is-active', !app.state.inspectorCollapsed)
  app.refs.topPanelButton.setAttribute('aria-pressed', String(!app.state.topPanelCollapsed))
  app.updateZoomControlTitles()
  document.title = `${app.state.document.title} - Code Mind`
}

export function renderWorkspace(app: MindMapApp): void {
  if (!app.refs) {
    return
  }

  const bounds = getWorkspaceBounds(app.state.document)
  app.applyCanvasMetrics(bounds)
  app.refs.edgeLayer.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`)
  app.updateCanvasViewportView()
  app.refs.scroll.classList.toggle('is-marqueeing', Boolean(app.state.marquee))
  app.refs.edgeLayer.innerHTML = renderEdges(app)
  app.refs.regionLayer.innerHTML = renderRegions(app)
  app.refs.nodeLayer.innerHTML = renderNodes(app)
}
