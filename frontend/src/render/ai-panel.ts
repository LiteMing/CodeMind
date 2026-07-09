import type { MindMapApp } from '../app'
import { aiDebugActionLabel, aiNoteChildActionLabel, aiStatusTone, resolveAINoteTargets } from '../ai/actions'
import { AI_TEMPLATES, promptTemplateCopy, templateLabel } from '../templates'
import { escapeAttribute, escapeHtml } from '../utils'

export function renderAIWorkspace(app: MindMapApp): void {
  if (!app.refs) {
    return
  }

  if (!app.state.ai.open) {
    app.refs.aiLayer.innerHTML = ''
    app.refs.aiLayer.className = ''
    return
  }

  const examplePrompt = promptTemplateCopy(app.state.ai.template, app.state.preferences.locale)
  const aiStatusNotice = renderAIStatusNotice(app)
  const noteTargets = resolveAINoteTargets(app)
  const rawModeLabel = `${aiDebugText(app, 'rawMode')}: ${app.t(app.state.ai.rawMode ? 'common.on' : 'common.off')}`
  app.refs.aiLayer.className = 'ai-layer is-visible'
  app.refs.aiLayer.innerHTML = `
    <div class="ai-scrim" data-ai-scrim>
      <section class="ai-drawer" role="dialog" aria-modal="true">
        <header class="settings-header">
          <div>
            <p class="section-label">${app.t('toolbar.ai')}</p>
            <h2>${app.t('ai.title')}</h2>
            <p class="inspector-copy">${app.t('ai.subtitle')}</p>
          </div>
          <button type="button" class="ghost-button" data-command="close-ai-workspace">${app.t('settings.close')}</button>
        </header>

        ${aiStatusNotice}

        <section class="settings-card">
          <div class="ai-action-row ai-debug-toggle-row">
            <button type="button" class="chip-button ${app.state.ai.debugOpen ? 'is-active' : ''}" data-command="toggle-ai-debug">
              ${app.state.ai.debugOpen ? aiDebugText(app, 'hide') : aiDebugText(app, 'show')}
            </button>
            <button type="button" class="chip-button ${app.state.ai.rawMode ? 'is-active' : ''}" data-command="toggle-ai-raw-mode">
              ${rawModeLabel}
            </button>
          </div>
          <p class="inspector-copy">${aiDebugText(app, 'hint')}</p>
        </section>

        <section class="settings-card">
          <p class="section-label">${app.t('ai.generate')}</p>
          <label class="field-row">
            <span>${app.t('ai.template')}</span>
            <select class="settings-select" data-ai-field="template">
              ${AI_TEMPLATES.map((template) => {
                return `<option value="${template.id}" ${app.state.ai.template === template.id ? 'selected' : ''}>${templateLabel(template.id, app.state.preferences.locale)}</option>`
              }).join('')}
            </select>
          </label>
          <label class="field-stack">
            <span>${app.t('ai.topic')}</span>
            <input
              class="settings-input"
              data-ai-field="topic"
              value="${escapeAttribute(app.state.ai.topic)}"
              placeholder="${escapeAttribute(app.t('ai.topicPlaceholder'))}"
            />
          </label>
          <label class="field-stack">
            <span>${app.t('ai.instructions')}</span>
            <textarea class="settings-input ai-textarea" data-ai-field="generationInstructions" placeholder="${escapeAttribute(app.t('ai.instructionsPlaceholder'))}">${escapeHtml(app.state.ai.generationInstructions)}</textarea>
          </label>
          <div class="ai-action-row">
            <button type="button" class="action-button primary-action" data-command="ai-generate-map" ${app.state.ai.busy ? 'disabled' : ''}>${app.t('ai.generateAction')}</button>
            <button type="button" class="chip-button" data-command="ai-expand-map" ${app.state.ai.busy ? 'disabled' : ''}>${app.t('ai.expandAction')}</button>
            <button type="button" class="chip-button" data-command="create-template-map:${app.state.ai.template}" ${app.state.ai.busy ? 'disabled' : ''}>${app.t('ai.templateAction')}</button>
          </div>
          ${renderAIRawEditor(app, 'generateRawRequest', app.state.ai.generateRawRequest)}
          <p class="inspector-copy">${escapeHtml(examplePrompt)}</p>
        </section>

        <section class="settings-card">
          <p class="section-label">${app.t('ai.import')}</p>
          <p class="inspector-copy">${app.t('ai.importHint')}</p>
          <label class="field-stack">
            <span>${app.t('ai.instructions')}</span>
            <textarea class="settings-input ai-textarea" data-ai-field="importInstructions" placeholder="${escapeAttribute(app.t('ai.importPlaceholder'))}">${escapeHtml(app.state.ai.importInstructions)}</textarea>
          </label>
          <div class="ai-action-row">
            <button type="button" class="action-button" data-command="ai-import-file" ${app.state.ai.busy ? 'disabled' : ''}>${app.t('ai.importAction')}</button>
          </div>
          ${renderAIRawEditor(app, 'importRawRequest', app.state.ai.importRawRequest)}
        </section>

        <section class="settings-card">
          <p class="section-label">${app.t('ai.notes')}</p>
          <p class="inspector-copy">${app.t(
            noteTargets.mode === 'selection' ? 'ai.notesSelectionHint' : 'ai.notesAllHint',
            {
              value: noteTargets.nodes.length,
            },
          )}</p>
          <label class="field-stack">
            <span>${app.t('ai.instructions')}</span>
            <textarea class="settings-input ai-textarea" data-ai-field="noteInstructions" placeholder="${escapeAttribute(app.t('ai.notesPlaceholder'))}">${escapeHtml(app.state.ai.noteInstructions)}</textarea>
          </label>
          <div class="ai-action-row">
            <button type="button" class="action-button" data-command="ai-complete-node-notes" ${app.state.ai.busy ? 'disabled' : ''}>${app.t('ai.notesAction')}</button>
            <button type="button" class="chip-button" data-command="ai-complete-node-notes-as-children" ${app.state.ai.busy ? 'disabled' : ''}>${aiNoteChildActionLabel(app)}</button>
          </div>
          ${renderAIRawEditor(app, 'noteRawRequest', app.state.ai.noteRawRequest)}
        </section>

        <section class="settings-card">
          <p class="section-label">${app.t('ai.suggestChildren')}</p>
          <p class="inspector-copy">${app.t(
            app.selectedNode() ? 'ai.suggestChildrenHint' : 'ai.suggestChildrenNoSelection',
            {
              title: app.selectedNode()?.title ?? '',
            },
          )}</p>
          <div class="ai-action-row">
            <button type="button" class="action-button" data-command="ai-suggest-children" ${app.state.ai.busy || !app.selectedNode() ? 'disabled' : ''}>${app.t('ai.suggestChildrenAction')}</button>
            <button type="button" class="chip-button" data-command="ai-suggest-siblings" ${app.state.ai.busy || !app.canSuggestSiblings() ? 'disabled' : ''}>${app.t('ai.suggestSiblingsAction')}</button>
          </div>
        </section>

        <section class="settings-card">
          <p class="section-label">${app.t('ai.connect')}</p>
          <p class="inspector-copy">${app.t('ai.connectHint', {
            nodes: app.state.document.nodes.length,
            relations: app.state.document.relations.length,
          })}</p>
          <label class="field-stack">
            <span>${app.t('ai.instructions')}</span>
            <textarea class="settings-input ai-textarea" data-ai-field="relationInstructions" placeholder="${escapeAttribute(app.t('ai.connectPlaceholder'))}">${escapeHtml(app.state.ai.relationInstructions)}</textarea>
          </label>
          <div class="ai-action-row">
            <button type="button" class="chip-button" data-command="test-ai-connection" ${app.state.ai.busy || app.state.ai.testing ? 'disabled' : ''}>${app.state.ai.testing ? `${app.t('ai.testConnection')}...` : app.t('ai.testConnection')}</button>
            <button type="button" class="action-button" data-command="ai-connect-relations" ${app.state.ai.busy ? 'disabled' : ''}>${app.t('ai.connectAction')}</button>
          </div>
          ${renderAIRawEditor(app, 'relationRawRequest', app.state.ai.relationRawRequest)}
          ${
            app.state.ai.connectionMessage
              ? `<p class="ai-connection-note ${app.state.ai.connectionOK === true ? 'is-ok' : app.state.ai.connectionOK === false ? 'is-error' : ''}">${
                  app.state.ai.connectionModel
                    ? `<strong>${escapeHtml(app.t('ai.connectionModel', { value: app.state.ai.connectionModel }))}</strong><br />`
                    : ''
                }${escapeHtml(app.state.ai.connectionMessage)}</p>`
              : ''
          }
        </section>

        ${
          app.state.ai.lastSummary
            ? `
              <section class="settings-card">
                <p class="section-label">${app.t('ai.lastResult')}</p>
                <p class="inspector-copy"><strong>${escapeHtml(app.state.ai.lastModel || app.t('common.unknown'))}</strong>: ${escapeHtml(app.state.ai.lastSummary)}</p>
              </section>
            `
            : ''
        }

        ${renderAIDebugPanel(app)}
      </section>
    </div>
  `
}

export function renderAIDebugPanel(app: MindMapApp): string {
  if (!app.state.ai.debugOpen) {
    return ''
  }

  const debug = app.state.ai.lastDebugInfo
  const actionLabel = aiDebugActionLabel(app, app.state.ai.lastDebugAction)
  return `
    <section class="settings-card">
      <p class="section-label">${aiDebugText(app, 'title')}</p>
      ${
        actionLabel
          ? `<p class="inspector-copy">${escapeHtml(aiDebugText(app, 'lastAction', actionLabel))}</p>`
          : `<p class="inspector-copy">${aiDebugText(app, 'empty')}</p>`
      }
      ${
        app.state.ai.lastDebugError
          ? `<p class="ai-connection-note is-error"><strong>${escapeHtml(aiDebugText(app, 'lastError'))}</strong><br />${escapeHtml(app.state.ai.lastDebugError)}</p>`
          : ''
      }
      ${
        debug
          ? `
            <div class="ai-debug-grid">
              <section class="ai-debug-block">
                <p class="section-label">${aiDebugText(app, 'rawRequest')}</p>
                <pre class="ai-debug-pre">${escapeHtml(debug.upstreamRequest || '')}</pre>
              </section>
              <section class="ai-debug-block">
                <p class="section-label">${aiDebugText(app, 'rawResponse')}</p>
                <pre class="ai-debug-pre">${escapeHtml(debug.upstreamResponse || '')}</pre>
              </section>
              <section class="ai-debug-block">
                <p class="section-label">${aiDebugText(app, 'assistantContent')}</p>
                <pre class="ai-debug-pre">${escapeHtml(debug.assistantContent || '')}</pre>
              </section>
            </div>
          `
          : ''
      }
    </section>
  `
}

export function renderAIRawEditor(
  app: MindMapApp,
  field: 'generateRawRequest' | 'importRawRequest' | 'noteRawRequest' | 'relationRawRequest',
  value: string,
): string {
  if (!app.state.ai.debugOpen && !app.state.ai.rawMode) {
    return ''
  }

  return `
    <label class="field-stack">
      <span>${aiDebugText(app, 'rawRequest')}</span>
      <textarea class="settings-input ai-textarea ai-raw-textarea" data-ai-field="${field}" spellcheck="false">${escapeHtml(value)}</textarea>
    </label>
  `
}

export function renderAIStatusNotice(app: MindMapApp): string {
  const tone = aiStatusTone(app)
  if (!tone) {
    return ''
  }

  return `<p class="ai-status-note ${tone}">${escapeHtml(app.t(app.state.status.key, app.state.status.values))}</p>`
}

export function aiDebugText(
  app: MindMapApp,
  key:
    | 'title'
    | 'show'
    | 'hide'
    | 'hint'
    | 'empty'
    | 'lastAction'
    | 'lastError'
    | 'rawMode'
    | 'rawRequest'
    | 'rawResponse'
    | 'assistantContent',
  value = '',
): string {
  if (app.state.preferences.locale === 'zh-CN') {
    switch (key) {
      case 'title':
        return 'AI 调试'
      case 'show':
        return '显示调试'
      case 'hide':
        return '隐藏调试'
      case 'hint':
        return '开启 RAW 模式后，编辑区中的 JSON 会被直接发送到上游 AI 接口；关闭 RAW 模式时，这里会保留最近一次自动生成并捕获到的请求，方便复制和修改。'
      case 'empty':
        return '先执行一次 AI 操作，才能捕获上游请求和完整响应。'
      case 'lastAction':
        return `最近调试动作：${value}`
      case 'lastError':
        return '最近错误'
      case 'rawMode':
        return 'RAW 模式'
      case 'rawRequest':
        return 'RAW 请求'
      case 'rawResponse':
        return '原始响应'
      case 'assistantContent':
        return '助手内容'
      default:
        return ''
    }
  }

  switch (key) {
    case 'title':
      return 'AI Debug'
    case 'show':
      return 'Show Debug'
    case 'hide':
      return 'Hide Debug'
    case 'hint':
      return 'RAW mode sends the edited JSON directly to the upstream AI endpoint. When RAW mode is off, this area keeps the last captured request for reference.'
    case 'empty':
      return 'Run an AI action to capture the upstream request and full response.'
    case 'lastAction':
      return `Last action: ${value}`
    case 'lastError':
      return 'Last error'
    case 'rawMode':
      return 'RAW Mode'
    case 'rawRequest':
      return 'RAW Request'
    case 'rawResponse':
      return 'Raw Response'
    case 'assistantContent':
      return 'Assistant Content'
    default:
      return ''
  }
}
