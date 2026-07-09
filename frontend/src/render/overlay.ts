import type { MindMapApp } from '../app'
import { syncAIWheelPosition } from '../ai/actions'
import { resolveNodeColorPalette } from '../color-palette'
import { renderContextMenu } from '../render/context-menu'
import { escapeHtml } from '../utils'
import type { MarqueeState } from '../app-types'
import type { TranslationKey } from '../i18n'
import type { Locale } from '../types'
import { renderRegions } from '../render/regions'

export function renderOverlay(app: MindMapApp): void {
  if (!app.refs) {
    return
  }

  if (app.overlayBlocksCanvas()) {
    app.refs.overlayLayer.innerHTML = ''
    app.refs.overlayLayer.classList.remove('is-visible')
    return
  }

  const marqueeMarkup = app.state.marquee?.active ? renderMarqueeBox(app, app.state.marquee) : ''
  const contextMenuMarkup = app.state.contextMenu ? renderContextMenu(app) : ''
  const aiWheelMarkup = app.state.aiWheel.open ? renderAIWheel(app) : ''

  app.refs.overlayLayer.classList.toggle('is-visible', Boolean(marqueeMarkup || contextMenuMarkup || aiWheelMarkup))
  app.refs.overlayLayer.innerHTML = `${marqueeMarkup}${contextMenuMarkup}${aiWheelMarkup}`
  if (app.state.contextMenu) {
    app.syncContextMenuPosition()
  }
  if (app.state.aiWheel.open) {
    syncAIWheelPosition(app)
  }
}

export function renderMarqueeBox(app: MindMapApp, marquee: MarqueeState): string {
  const left = Math.min(marquee.startClientX, marquee.currentClientX)
  const top = Math.min(marquee.startClientY, marquee.currentClientY)
  const width = Math.abs(marquee.currentClientX - marquee.startClientX)
  const height = Math.abs(marquee.currentClientY - marquee.startClientY)
  const stageRect = app.refs?.overlayLayer.getBoundingClientRect()
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

export function renderRegionDrawPreview(app: MindMapApp): void {
  if (!app.refs || !app.state.regionDraw || app.state.regionDraw.pointerId === -1) {
    return
  }
  const rd = app.state.regionDraw
  const originX = app.workspaceBounds.originX
  const originY = app.workspaceBounds.originY
  const left = Math.min(rd.startCanvasX, rd.currentCanvasX) + originX
  const top = Math.min(rd.startCanvasY, rd.currentCanvasY) + originY
  const w = Math.abs(rd.currentCanvasX - rd.startCanvasX)
  const h = Math.abs(rd.currentCanvasY - rd.startCanvasY)
  const palette = resolveNodeColorPalette(rd.color)
  const borderColor = palette ? `rgba(${palette.accentRgb.join(',')}, 0.6)` : 'rgba(96,165,250,0.5)'
  const bgColor = palette ? `rgba(${palette.surfaceRgb.join(',')}, 0.15)` : 'rgba(96,165,250,0.1)'
  // Show preview overlay in the region layer
  app.refs.regionLayer.innerHTML =
    renderRegions(app) +
    `<div class="region-box region-draw-preview" style="
    left: ${left}px; top: ${top}px; width: ${w}px; height: ${h}px;
    background: ${bgColor}; border: 2px dashed ${borderColor};
  "></div>`
}

export function renderAIWheel(app: MindMapApp): string {
  if (!app.refs || !app.state.aiWheel.open || !app.state.aiWheel.nodeId) {
    return ''
  }

  const labels = {
    children: app.state.preferences.locale === 'zh-CN' ? '子节点' : 'Children',
    notes: app.state.preferences.locale === 'zh-CN' ? '注释' : 'Notes',
    relations: app.state.preferences.locale === 'zh-CN' ? '连线' : 'Relations',
    siblings: app.state.preferences.locale === 'zh-CN' ? '同级节点' : 'Siblings',
    close: app.state.preferences.locale === 'zh-CN' ? '关闭 AI 轮盘' : 'Close AI wheel',
  }

  return `
    <section class="ai-wheel" data-ai-wheel style="left: 0; top: 0;">
      <button type="button" class="ai-wheel-button ai-wheel-button-top" data-command="ai-wheel-children">${labels.children}</button>
      <button type="button" class="ai-wheel-button ai-wheel-button-left" data-command="ai-wheel-notes">${labels.notes}</button>
      <button type="button" class="ai-wheel-button ai-wheel-button-right" data-command="ai-wheel-relations">${labels.relations}</button>
      <button type="button" class="ai-wheel-button ai-wheel-button-bottom" data-command="ai-wheel-siblings">${labels.siblings}</button>
      <button type="button" class="ai-wheel-center" data-command="close-ai-wheel" aria-label="${labels.close}">AI</button>
    </section>
  `
}

export function renderOnboarding(app: MindMapApp): void {
  if (!app.refs) {
    return
  }

  if (!app.onboardingOpen()) {
    app.refs.onboardingLayer.innerHTML = ''
    app.refs.onboardingLayer.className = ''
    return
  }

  const locale = app.state.preferences.locale
  app.refs.onboardingLayer.className = 'onboarding-layer is-visible'
  app.refs.onboardingLayer.innerHTML = `
    <div class="onboarding-scrim">
      <section class="onboarding-dialog" role="dialog" aria-modal="true">
        <p class="section-label">${app.t('toolbar.settings')}</p>
        <h2>${app.t('onboarding.title')}</h2>
        <p class="inspector-copy">${app.t('onboarding.subtitle')}</p>
        <div class="locale-grid">
          ${renderLocaleOption(app, 'zh-CN', locale)}
          ${renderLocaleOption(app, 'en', locale)}
        </div>
        <button type="button" class="action-button primary-action" data-command="complete-onboarding">${app.t('onboarding.continue')}</button>
      </section>
    </div>
  `
}

export function renderLocaleOption(app: MindMapApp, option: Locale, activeLocale: Locale): string {
  const activeClass = option === activeLocale ? 'is-active' : ''
  return `
    <button type="button" class="locale-option ${activeClass}" data-locale-option="${option}">
      <strong>${escapeHtml(app.t(`onboarding.locale.${option}.title` as TranslationKey))}</strong>
      <span>${escapeHtml(app.t(`onboarding.locale.${option}.copy` as TranslationKey))}</span>
    </button>
  `
}

export function renderToasts(app: MindMapApp): void {
  const container = app.ensureToastContainer()
  const maxVisible = 3
  const autoDismissMs = 2500

  // If more than maxVisible, dismiss oldest immediately
  while (app.state.toastQueue.length > maxVisible) {
    const oldest = app.state.toastQueue[0]
    if (oldest) {
      // Remove timer
      const timer = app.toastTimers.get(oldest.id)
      if (timer != null) {
        window.clearTimeout(timer)
        app.toastTimers.delete(oldest.id)
      }
      // Remove element immediately
      if (oldest.element) {
        oldest.element.remove()
      }
      app.state.toastQueue.shift()
    }
  }

  // Render each toast that doesn't have an element yet
  for (const item of app.state.toastQueue) {
    if (item.element && container.contains(item.element)) continue

    const el = document.createElement('div')
    el.className = 'toast-item toast-entering'
    el.textContent = item.message
    el.dataset.toastId = item.id
    container.appendChild(el)
    item.element = el

    // Schedule auto-dismiss after 2500ms
    const timer = window.setTimeout(() => {
      app.toastTimers.delete(item.id)
      app.dismissToast(item.id)
    }, autoDismissMs)
    app.toastTimers.set(item.id, timer)
  }
}

export function renderCanvasGuide(app: MindMapApp): void {
  if (!app.refs) {
    return
  }
  const existing = app.refs.scroll.querySelector('.canvas-guide')
  if (app.state.guideOverlay.canvasGuideVisible) {
    if (!existing) {
      const guide = document.createElement('div')
      guide.className = 'canvas-guide'
      guide.textContent = app.t('guide.canvasHint')
      app.refs.scroll.appendChild(guide)
    }
  } else {
    existing?.remove()
  }
}

export function updateCanvasGuide(app: MindMapApp): void {
  if (app.state.guideOverlay.canvasGuideDismissed) {
    app.state.guideOverlay.canvasGuideVisible = false
    return
  }
  const root = app.state.document.nodes.find((n) => n.kind === 'root')
  if (!root) {
    app.state.guideOverlay.canvasGuideVisible = false
    return
  }
  const hasChildren = app.state.document.nodes.some((n) => n.parentId === root.id)
  app.state.guideOverlay.canvasGuideVisible = !hasChildren
}
