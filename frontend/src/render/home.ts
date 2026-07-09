import type { MindMapApp } from '../app'
import { AI_TEMPLATES, promptTemplateCopy, templateLabel } from '../templates'
import { escapeAttribute, escapeHtml, formatRelativeTime } from '../utils'

export function renderHome(app: MindMapApp): void {
  app.destroyContextToolbar()
  app.refs = null
  app.rootEl.innerHTML = `
    <div class="home-shell">
      <header class="home-hero">
        <div>
          <p class="eyebrow">${app.t('app.eyebrow')}</p>
          <h1>${app.t('home.title')}</h1>
          <p class="home-copy">${app.t('home.subtitle')}</p>
          <p class="home-status">${app.t(app.state.status.key, app.state.status.values)}</p>
        </div>
        <button type="button" class="action-button primary-action" data-command="create-map">${app.t('home.create')}</button>
      </header>

      <section class="file-grid">
        ${
          app.state.maps.length === 0
            ? `<article class="file-card file-card-empty">
                 <p class="section-label">${app.t('home.title')}</p>
                 <h2>${app.t('home.empty')}</h2>
                 <button type="button" class="action-button" data-command="create-map">${app.t('home.create')}</button>
               </article>`
            : app.state.maps
                .map((summary) => {
                  const summaryId = escapeAttribute(summary.id)
                  return `
                    <article class="file-card">
                      <div class="file-card-top">
                        <div>
                          <p class="section-label">${escapeHtml(summary.id)}</p>
                          <h2>${escapeHtml(summary.title)}</h2>
                          <p class="file-meta">${app.t('home.lastEdited', {
                            value: formatRelativeTime(summary.lastEditedAt, app.state.preferences.locale),
                          })}</p>
                        </div>
                      </div>
                      <div class="file-card-actions">
                        <button type="button" class="chip-button" data-command="open-map:${summaryId}">${app.t('home.open')}</button>
                        <button type="button" class="chip-button" data-command="rename-map:${summaryId}">${app.t('home.rename')}</button>
                        <button type="button" class="chip-button danger" data-command="delete-map:${summaryId}">${app.t('home.delete')}</button>
                      </div>
                    </article>
                  `
                })
                .join('')
        }
      </section>

      <section class="template-strip">
        <div class="template-strip-copy">
          <p class="section-label">${app.t('ai.templateExamples')}</p>
          <h2>${app.t('ai.templateExamplesTitle')}</h2>
          <p class="inspector-copy">${app.t('ai.templateExamplesCopy')}</p>
        </div>
        <div class="template-grid">
          ${AI_TEMPLATES.map((template) => {
            return `
              <article class="template-card">
                <p class="section-label">${templateLabel(template.id, app.state.preferences.locale)}</p>
                <p class="inspector-copy">${escapeHtml(promptTemplateCopy(template.id, app.state.preferences.locale))}</p>
                <button type="button" class="chip-button" data-command="create-template-map:${template.id}">${app.t('ai.templateAction')}</button>
              </article>
            `
          }).join('')}
        </div>
      </section>
    </div>
  `
}
