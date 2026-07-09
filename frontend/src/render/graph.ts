import type { MindMapApp } from '../app'
import { applyAlphaToHex, resolveNodeColorPalette, rgbaFromRgb } from '../color-palette'
import { childrenOf, connectedRelations, descendantIds } from '../document'
import { buildGraphFrame, traceRoundedRectPath } from '../graph-frame'
import { kindLabel } from '../i18n'
import { escapeAttribute, escapeHtml, shorten } from '../utils'

export function renderGraphOverlay(app: MindMapApp): void {
  if (!app.refs) {
    return
  }

  if (!app.state.graph.open) {
    app.stopGraphAnimation()
    app.refs.graphLayer.innerHTML = ''
    app.refs.graphLayer.className = ''
    return
  }

  app.refs.graphLayer.className = 'graph-layer is-visible'
  app.refs.graphLayer.innerHTML = `
    <div class="graph-scrim" data-graph-scrim>
      <section class="graph-sheet" role="dialog" aria-modal="true">
        <header class="graph-header">
          <div>
            <p class="section-label">${app.t('toolbar.graph3d')}</p>
            <h2>${app.t('graph.title')}</h2>
            <p class="inspector-copy">${app.t('graph.subtitle')}</p>
          </div>
          <div class="ai-action-row">
            <button type="button" class="chip-button" data-command="toggle-graph-autorotate">${app.t(
              'graph.autoRotate',
              {
                value: app.state.graph.autoRotate ? app.t('common.on') : app.t('common.off'),
              },
            )}</button>
            <button type="button" class="chip-button" data-command="reset-graph-view">${app.t('graph.resetView')}</button>
            <button type="button" class="chip-button" data-command="focus-graph-selected" ${app.state.graph.selectedNodeId ? '' : 'disabled'}>${app.t('graph.focusAction')}</button>
            <button type="button" class="ghost-button" data-command="close-graph-overlay">${app.t('settings.close')}</button>
          </div>
        </header>

        <div class="graph-toolbar">
          <input
            class="settings-input"
            data-graph-search
            value="${escapeAttribute(app.state.graph.search)}"
            placeholder="${escapeAttribute(app.t('graph.searchPlaceholder'))}"
          />
          <span class="metric-chip">${app.t('graph.dragHint')}</span>
          <span class="metric-chip">${app.t('graph.zoomHint')}</span>
          <button type="button" class="chip-button" data-command="graph-zoom-out">${app.t('graph.zoomOut')}</button>
          <span class="metric-chip" data-graph-zoom-value>${app.t('graph.zoomValue', { value: Math.round(app.state.graph.zoom * 100) })}</span>
          <button type="button" class="chip-button" data-command="graph-zoom-in">${app.t('graph.zoomIn')}</button>
          <span class="metric-chip">${app.t('dock.nodes', { value: app.state.document.nodes.length })}</span>
          <span class="metric-chip">${app.t('dock.relations', { value: app.state.document.relations.length })}</span>
        </div>

        <div class="graph-layout">
          <div class="graph-canvas-shell">
            <canvas class="graph-canvas" data-graph-canvas></canvas>
          </div>
          <aside class="graph-sidebar">
            <div class="graph-result-list" data-graph-result-list>${renderGraphResultsList(app)}</div>
            <div class="graph-summary" data-graph-summary>${renderGraphSummaryContent(app)}</div>
          </aside>
        </div>
      </section>
    </div>
  `

  app.syncGraphAnimation()
  drawGraphScene(app)
}

export function drawGraphScene(app: MindMapApp): void {
  if (!app.state.graph.open) {
    return
  }

  updateGraphZoomIndicator(app)
  const canvas = app.rootEl.querySelector<HTMLCanvasElement>('[data-graph-canvas]')
  if (!canvas) {
    return
  }

  const context = canvas.getContext('2d')
  if (!context) {
    return
  }

  const width = Math.max(canvas.clientWidth, 320)
  const height = Math.max(canvas.clientHeight, 240)
  const dpr = Math.max(window.devicePixelRatio || 1, 1)
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
  }
  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.clearRect(0, 0, width, height)

  const frame = buildGraphFrame(
    app.state.document,
    width,
    height,
    app.state.graph.rotation,
    app.state.graph.tilt,
    app.state.graph.zoom,
    app.state.graph.search,
    app.state.graph.selectedNodeId,
  )
  app.graphHitNodes = frame.hitNodes

  const background = context.createLinearGradient(0, 0, width, height)
  background.addColorStop(0, 'rgba(15, 23, 42, 0.96)')
  background.addColorStop(1, 'rgba(12, 18, 32, 0.96)')
  context.fillStyle = background
  context.fillRect(0, 0, width, height)

  const atmosphere = context.createRadialGradient(
    width / 2,
    height * 0.56,
    0,
    width / 2,
    height * 0.56,
    Math.max(width, height) * 0.58,
  )
  atmosphere.addColorStop(0, 'rgba(99, 102, 241, 0.12)')
  atmosphere.addColorStop(0.52, 'rgba(56, 189, 248, 0.05)')
  atmosphere.addColorStop(1, 'rgba(15, 23, 42, 0)')
  context.fillStyle = atmosphere
  context.fillRect(0, 0, width, height)

  context.strokeStyle = 'rgba(148, 163, 184, 0.08)'
  for (let index = 0; index < width; index += 48) {
    context.beginPath()
    context.moveTo(index, 0)
    context.lineTo(index, height)
    context.stroke()
  }
  for (let index = 0; index < height; index += 48) {
    context.beginPath()
    context.moveTo(0, index)
    context.lineTo(width, index)
    context.stroke()
  }

  context.lineCap = 'round'
  context.lineJoin = 'round'
  for (const edge of frame.edges) {
    context.beginPath()
    context.strokeStyle =
      edge.type === 'relation' ? `rgba(253, 186, 116, ${edge.opacity})` : `rgba(147, 197, 253, ${edge.opacity})`
    context.lineWidth = edge.lineWidth
    context.moveTo(edge.x1, edge.y1)
    context.lineTo(edge.x2, edge.y2)
    context.stroke()
  }

  context.textAlign = 'center'
  context.textBaseline = 'middle'
  for (const node of frame.nodes) {
    const nodePalette = resolveNodeColorPalette(node.color)
    const occlusionRadius = node.radius + Math.max(3.2, node.lineWidth * 1.25)

    // Draw region ring if node is inside a region
    const regions = app.state.document.regions ?? []
    for (const region of regions) {
      const docNode = app.findNode(node.id)
      if (!docNode) continue
      if (app.nodeOverlapsRegion(docNode, region)) {
        const regionPalette = resolveNodeColorPalette(region.color)
        if (regionPalette) {
          context.save()
          context.beginPath()
          context.strokeStyle = rgbaFromRgb(regionPalette.accentRgb, 0.55)
          context.lineWidth = Math.max(2.5, node.lineWidth * 1.1)
          context.arc(node.x, node.y, occlusionRadius + 4, 0, Math.PI * 2)
          context.stroke()
          context.restore()
        }
        break
      }
    }

    context.save()
    context.beginPath()
    context.fillStyle = nodePalette
      ? rgbaFromRgb(nodePalette.plateRgb, node.occlusionOpacity)
      : `rgba(9, 14, 24, ${node.occlusionOpacity})`
    context.arc(node.x, node.y, occlusionRadius, 0, Math.PI * 2)
    context.fill()
    context.restore()

    context.save()
    context.beginPath()
    context.shadowColor = node.selected
      ? 'rgba(129, 140, 248, 0.48)'
      : node.highlighted
        ? 'rgba(96, 165, 250, 0.34)'
        : nodePalette
          ? rgbaFromRgb(nodePalette.glowRgb, Math.min(0.34, node.opacity * 0.3))
          : `rgba(56, 189, 248, ${Math.min(0.22, node.opacity * 0.22)})`
    context.shadowBlur = node.glow
    context.fillStyle = node.selected
      ? 'rgba(129, 140, 248, 0.95)'
      : node.highlighted
        ? 'rgba(96, 165, 250, 0.92)'
        : nodePalette
          ? rgbaFromRgb(nodePalette.surfaceRgb, node.surfaceOpacity)
          : `rgba(30, 41, 59, ${node.surfaceOpacity})`
    context.strokeStyle = node.selected
      ? 'rgba(199, 210, 254, 0.95)'
      : nodePalette
        ? rgbaFromRgb(nodePalette.accentRgb, Math.max(0.42, node.strokeOpacity))
        : `rgba(148, 163, 184, ${node.strokeOpacity})`
    context.lineWidth = node.lineWidth
    context.arc(node.x, node.y, node.radius, 0, Math.PI * 2)
    context.fill()
    context.stroke()
    context.restore()

    context.font = `${node.fontSize}px "Segoe UI", sans-serif`
    const labelWidth = context.measureText(node.label).width
    const labelPlateWidth = Math.max(node.radius * 1.8, labelWidth + 24)
    const labelPlateHeight = Math.max(node.radius * 0.96, node.fontSize + 12)
    context.save()
    context.beginPath()
    traceRoundedRectPath(
      context,
      node.x - labelPlateWidth / 2,
      node.y - labelPlateHeight / 2,
      labelPlateWidth,
      labelPlateHeight,
      Math.min(labelPlateHeight / 2, 14),
    )
    context.fillStyle = node.selected
      ? 'rgba(79, 70, 229, 0.92)'
      : node.highlighted
        ? 'rgba(37, 99, 235, 0.86)'
        : nodePalette
          ? rgbaFromRgb(nodePalette.plateRgb, Math.max(0.9, node.surfaceOpacity))
          : `rgba(15, 23, 42, ${Math.max(0.84, node.surfaceOpacity)})`
    context.strokeStyle = node.selected
      ? 'rgba(199, 210, 254, 0.94)'
      : nodePalette
        ? rgbaFromRgb(nodePalette.accentRgb, Math.max(0.52, node.strokeOpacity * 0.88))
        : `rgba(148, 163, 184, ${Math.max(0.42, node.strokeOpacity * 0.84)})`
    context.lineWidth = Math.max(1, node.lineWidth * 0.88)
    context.fill()
    context.stroke()
    context.restore()

    context.fillStyle = nodePalette
      ? applyAlphaToHex(nodePalette.text, node.textOpacity)
      : `rgba(241, 245, 249, ${node.textOpacity})`
    context.fillText(node.label, node.x, node.y)
  }
}

export function renderGraphResultsList(app: MindMapApp): string {
  const matches = app.findGraphMatches(app.state.graph.search).slice(0, 8)
  if (matches.length === 0) {
    return `<p class="empty-state">${app.t('graph.emptySearch')}</p>`
  }

  return matches
    .map((node) => {
      const active = node.id === app.state.graph.selectedNodeId
      return `<button type="button" class="graph-result-item ${active ? 'is-active' : ''}" data-graph-node-result="${escapeAttribute(node.id)}">${escapeHtml(shorten(node.title, 36))}</button>`
    })
    .join('')
}

export function renderGraphSummaryContent(app: MindMapApp): string {
  const selectedNode = app.findNode(app.state.graph.selectedNodeId ?? '')
  if (!selectedNode) {
    return `
      <p class="section-label">${app.t('graph.selection')}</p>
      <h3>${app.t('common.unknownNode')}</h3>
      <p class="inspector-copy">${app.t('graph.selectionHint')}</p>
    `
  }

  const relatedRelations = connectedRelations(app.state.document, selectedNode.id)
  const descendants = descendantIds(app.state.document, selectedNode.id)
  return `
    <p class="section-label">${app.t('graph.selection')}</p>
    <h3>${escapeHtml(selectedNode.title)}</h3>
    <div class="metric-row">
      <span class="metric-chip">${kindLabel(app.state.preferences.locale, selectedNode.kind)}</span>
      <span class="metric-chip">${app.t('inspector.children', { value: childrenOf(app.state.document, selectedNode.id).length })}</span>
      <span class="metric-chip">${app.t('inspector.relationsCount', { value: relatedRelations.length })}</span>
    </div>
    <p class="inspector-copy">${app.t('graph.summaryCopy', { value: descendants.length })}</p>
    <p class="inspector-copy">${app.t('graph.doubleClickHint')}</p>
  `
}

export function updateGraphSummaryPanel(app: MindMapApp): void {
  const summary = app.rootEl.querySelector<HTMLElement>('[data-graph-summary]')
  if (summary) {
    summary.innerHTML = renderGraphSummaryContent(app)
  }

  const resultList = app.rootEl.querySelector<HTMLElement>('[data-graph-result-list]')
  if (resultList) {
    resultList.innerHTML = renderGraphResultsList(app)
  }
}

export function updateGraphZoomIndicator(app: MindMapApp): void {
  const indicator = app.rootEl.querySelector<HTMLElement>('[data-graph-zoom-value]')
  if (indicator) {
    indicator.textContent = app.t('graph.zoomValue', { value: Math.round(app.state.graph.zoom * 100) })
  }
}

// --- Minimap ---
