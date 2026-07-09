import type { MindMapApp } from '../app'
import { DEFAULT_AI_MAX_TOKENS, DEFAULT_AI_TIMEOUT_SECONDS, DEFAULT_CHILD_GAP_X } from '../preferences'
import { escapeAttribute, escapeHtml } from '../utils'
import type { CanvasDragAction, GestureAction } from '../types'

export function renderSettings(app: MindMapApp): void {
  if (!app.refs) {
    return
  }

  if (!app.state.settingsOpen) {
    app.refs.settingsLayer.innerHTML = ''
    app.refs.settingsLayer.className = ''
    return
  }

  const locale = app.state.preferences.locale
  const appearance = app.state.preferences.appearance
  app.refs.settingsLayer.className = 'settings-layer is-visible'
  app.refs.settingsLayer.innerHTML = `
    <div class="settings-scrim" data-settings-scrim>
      <section class="settings-drawer" role="dialog" aria-modal="true">
        <header class="settings-header">
          <div>
            <p class="section-label">${app.t('toolbar.settings')}</p>
            <h2>${app.t('settings.title')}</h2>
            <p class="inspector-copy">${app.t('settings.subtitle')}</p>
          </div>
          <button type="button" class="ghost-button" data-command="close-settings">${app.t('settings.close')}</button>
        </header>

        <section class="settings-card">
          <p class="section-label">${app.t('settings.appearance')}</p>
          <label class="field-row">
            <span>${app.t('settings.language')}</span>
            <select class="settings-select" data-setting-field="locale">
              <option value="zh-CN" ${locale === 'zh-CN' ? 'selected' : ''}>${app.t('settings.language.zh-CN')}</option>
              <option value="en" ${locale === 'en' ? 'selected' : ''}>${app.t('settings.language.en')}</option>
            </select>
          </label>
          <label class="field-row">
            <span>${app.t('settings.theme')}</span>
            <select class="settings-select" data-setting-field="theme">
              <option value="light" ${app.state.document.theme === 'light' ? 'selected' : ''}>${app.t('settings.theme.light')}</option>
              <option value="dark" ${app.state.document.theme === 'dark' ? 'selected' : ''}>${app.t('settings.theme.dark')}</option>
            </select>
          </label>
          <label class="field-row">
            <span>${app.t('settings.edgeStyle')}</span>
            <select class="settings-select" data-setting-field="appearance.edgeStyle">
              <option value="curve" ${appearance.edgeStyle === 'curve' ? 'selected' : ''}>${app.t('settings.edgeStyle.curve')}</option>
              <option value="orthogonal" ${appearance.edgeStyle === 'orthogonal' ? 'selected' : ''}>${app.t('settings.edgeStyle.orthogonal')}</option>
              <option value="hidden" ${appearance.edgeStyle === 'hidden' ? 'selected' : ''}>${app.t('settings.edgeStyle.hidden')}</option>
            </select>
          </label>
          <label class="field-row">
            <span>${app.t('settings.layoutMode')}</span>
            <select class="settings-select" data-setting-field="appearance.layoutMode">
              <option value="balanced" ${appearance.layoutMode === 'balanced' ? 'selected' : ''}>${app.t('settings.layoutMode.balanced')}</option>
              <option value="right" ${appearance.layoutMode === 'right' ? 'selected' : ''}>${app.t('settings.layoutMode.right')}</option>
            </select>
          </label>
          <label class="field-stack">
            <span>${app.t('settings.childGapX')}</span>
            <input
              class="settings-input"
              type="number"
              min="120"
              max="360"
              step="20"
              inputmode="numeric"
              data-setting-field="appearance.childGapX"
              value="${escapeAttribute(String(appearance.childGapX || DEFAULT_CHILD_GAP_X))}"
            />
          </label>
          <p class="inspector-copy">${app.t('settings.childGapXHint')}</p>
          <label class="field-row">
            <span>${app.t('settings.chromeLayout')}</span>
            <select class="settings-select" data-setting-field="appearance.chromeLayout">
              <option value="floating" ${appearance.chromeLayout === 'floating' ? 'selected' : ''}>${app.t('settings.chromeLayout.floating')}</option>
              <option value="fixed" ${appearance.chromeLayout === 'fixed' ? 'selected' : ''}>${app.t('settings.chromeLayout.fixed')}</option>
            </select>
          </label>
          <label class="field-row">
            <span>${app.t('settings.topPanelPosition')}</span>
            <select class="settings-select" data-setting-field="appearance.topPanelPosition">
              <option value="left" ${appearance.topPanelPosition === 'left' ? 'selected' : ''}>${app.t('settings.topPanelPosition.left')}</option>
              <option value="center" ${appearance.topPanelPosition === 'center' ? 'selected' : ''}>${app.t('settings.topPanelPosition.center')}</option>
              <option value="right" ${appearance.topPanelPosition === 'right' ? 'selected' : ''}>${app.t('settings.topPanelPosition.right')}</option>
            </select>
          </label>
        </section>

        <section class="settings-card">
          <p class="section-label">${app.t('settings.interaction')}</p>
          <label class="field-row">
            <span>${app.t('settings.dragSubtreeWithParent')}</span>
            <select class="settings-select" data-setting-field="interaction.dragSubtreeWithParent">
              <option value="true" ${app.state.preferences.interaction.dragSubtreeWithParent ? 'selected' : ''}>${app.t('common.on')}</option>
              <option value="false" ${app.state.preferences.interaction.dragSubtreeWithParent ? '' : 'selected'}>${app.t('common.off')}</option>
            </select>
          </label>
          <label class="field-row">
            <span>${app.t('settings.dragSnap')}</span>
            <select class="settings-select" data-setting-field="interaction.dragSnap">
              <option value="true" ${app.state.preferences.interaction.dragSnap ? 'selected' : ''}>${app.t('common.on')}</option>
              <option value="false" ${app.state.preferences.interaction.dragSnap ? '' : 'selected'}>${app.t('common.off')}</option>
            </select>
          </label>
          <label class="field-row">
            <span>${app.t('settings.autoLayoutOnCollapse')}</span>
            <select class="settings-select" data-setting-field="interaction.autoLayoutOnCollapse">
              <option value="true" ${app.state.preferences.interaction.autoLayoutOnCollapse ? 'selected' : ''}>${app.t('common.on')}</option>
              <option value="false" ${app.state.preferences.interaction.autoLayoutOnCollapse ? '' : 'selected'}>${app.t('common.off')}</option>
            </select>
          </label>
          <label class="field-row">
            <span>${app.t('settings.autoSnapshots')}</span>
            <select class="settings-select" data-setting-field="interaction.autoSnapshots">
              <option value="true" ${app.state.preferences.interaction.autoSnapshots ? 'selected' : ''}>${app.t('common.on')}</option>
              <option value="false" ${app.state.preferences.interaction.autoSnapshots ? '' : 'selected'}>${app.t('common.off')}</option>
            </select>
          </label>
          <div class="settings-subsection">
            <p class="section-label">${app.t('settings.aiQuickRequests')}</p>
            <label class="field-row">
              <span>${app.t('settings.aiQuickChildren')}</span>
              <select class="settings-select" data-setting-field="interaction.aiQuickChildren">
                <option value="true" ${app.state.preferences.interaction.aiQuickChildren ? 'selected' : ''}>${app.t('common.on')}</option>
                <option value="false" ${app.state.preferences.interaction.aiQuickChildren ? '' : 'selected'}>${app.t('common.off')}</option>
              </select>
            </label>
            <label class="field-row">
              <span>${app.t('settings.aiQuickSiblings')}</span>
              <select class="settings-select" data-setting-field="interaction.aiQuickSiblings">
                <option value="true" ${app.state.preferences.interaction.aiQuickSiblings ? 'selected' : ''}>${app.t('common.on')}</option>
                <option value="false" ${app.state.preferences.interaction.aiQuickSiblings ? '' : 'selected'}>${app.t('common.off')}</option>
              </select>
            </label>
            <label class="field-row">
              <span>${app.t('settings.aiQuickNotes')}</span>
              <select class="settings-select" data-setting-field="interaction.aiQuickNotes">
                <option value="true" ${app.state.preferences.interaction.aiQuickNotes ? 'selected' : ''}>${app.t('common.on')}</option>
                <option value="false" ${app.state.preferences.interaction.aiQuickNotes ? '' : 'selected'}>${app.t('common.off')}</option>
              </select>
            </label>
            <label class="field-row">
              <span>${app.t('settings.aiQuickRelations')}</span>
              <select class="settings-select" data-setting-field="interaction.aiQuickRelations">
                <option value="true" ${app.state.preferences.interaction.aiQuickRelations ? 'selected' : ''}>${app.t('common.on')}</option>
                <option value="false" ${app.state.preferences.interaction.aiQuickRelations ? '' : 'selected'}>${app.t('common.off')}</option>
              </select>
            </label>
          </div>
          <div class="settings-subsection">
            <p class="section-label">${app.t('settings.actionBindings')}</p>
            <label class="field-row">
              <span>${app.t('settings.doubleClickAction')}</span>
              <select class="settings-select" data-setting-field="interaction.doubleClickAction">
                ${renderGestureActionOptions(app, app.state.preferences.interaction.doubleClickAction)}
              </select>
            </label>
            <label class="field-row">
              <span>${app.t('settings.tripleClickAction')}</span>
              <select class="settings-select" data-setting-field="interaction.tripleClickAction">
                ${renderGestureActionOptions(app, app.state.preferences.interaction.tripleClickAction)}
              </select>
            </label>
            <label class="field-row">
              <span>${app.t('settings.leftLongPressAction')}</span>
              <select class="settings-select" data-setting-field="interaction.leftLongPressAction">
                ${renderGestureActionOptions(app, app.state.preferences.interaction.leftLongPressAction)}
              </select>
            </label>
            <label class="field-row">
              <span>${app.t('settings.middleLongPressAction')}</span>
              <select class="settings-select" data-setting-field="interaction.middleLongPressAction">
                ${renderGestureActionOptions(app, app.state.preferences.interaction.middleLongPressAction)}
              </select>
            </label>
            <label class="field-row">
              <span>${app.t('settings.rightLongPressAction')}</span>
              <select class="settings-select" data-setting-field="interaction.rightLongPressAction">
                ${renderGestureActionOptions(app, app.state.preferences.interaction.rightLongPressAction)}
              </select>
            </label>
            <label class="field-row">
              <span>${app.t('settings.spaceAction')}</span>
              <select class="settings-select" data-setting-field="interaction.spaceAction">
                ${renderGestureActionOptions(app, app.state.preferences.interaction.spaceAction)}
              </select>
            </label>
          </div>
          <div class="settings-subsection">
            <p class="section-label">${app.t('settings.operationBindings')}</p>
            <label class="field-row">
              <span>${app.t('settings.leftDragAction')}</span>
              <select class="settings-select" data-setting-field="interaction.canvasLeftDragAction">
                ${renderCanvasDragActionOptions(app, app.state.preferences.interaction.canvasLeftDragAction)}
              </select>
            </label>
            <label class="field-row">
              <span>${app.t('settings.middleDragAction')}</span>
              <select class="settings-select" data-setting-field="interaction.canvasMiddleDragAction">
                ${renderCanvasDragActionOptions(app, app.state.preferences.interaction.canvasMiddleDragAction)}
              </select>
            </label>
            <label class="field-row">
              <span>${app.t('settings.rightDragAction')}</span>
              <select class="settings-select" data-setting-field="interaction.canvasRightDragAction">
                ${renderCanvasDragActionOptions(app, app.state.preferences.interaction.canvasRightDragAction)}
              </select>
            </label>
          </div>
        </section>

        <section class="settings-card">
          <p class="section-label">${app.t('settings.ai')}</p>
          <label class="field-row">
            <span>${app.t('settings.aiProvider')}</span>
            <select class="settings-select" data-setting-field="ai.provider">
              <option value="lmstudio" ${app.state.preferences.ai.provider === 'lmstudio' ? 'selected' : ''}>${app.t('settings.aiProvider.lmstudio')}</option>
              <option value="openai-compatible" ${app.state.preferences.ai.provider === 'openai-compatible' ? 'selected' : ''}>${app.t('settings.aiProvider.openaiCompatible')}</option>
            </select>
          </label>
          <label class="field-stack">
            <span>${app.t('settings.aiBaseUrl')}</span>
            <input class="settings-input" data-setting-field="ai.baseUrl" value="${escapeAttribute(app.state.preferences.ai.baseUrl)}" />
          </label>
          <label class="field-stack">
            <span>${app.t('settings.aiApiKey')}</span>
            <input
              class="settings-input"
              type="password"
              autocomplete="off"
              data-setting-field="ai.apiKey"
              value="${escapeAttribute(app.state.preferences.ai.apiKey)}"
              placeholder="${escapeAttribute(app.t('settings.aiApiKeyPlaceholder'))}"
            />
          </label>
          <label class="field-stack">
            <span>${app.t('settings.aiModel')}</span>
            <input
              class="settings-input"
              data-setting-field="ai.model"
              value="${escapeAttribute(app.state.preferences.ai.model)}"
              placeholder="${escapeAttribute(app.t('settings.aiModelPlaceholder'))}"
            />
          </label>
          <label class="field-stack">
            <span>${app.t('settings.aiMaxTokens')}</span>
            <input
              class="settings-input"
              type="number"
              min="256"
              max="32768"
              step="256"
              inputmode="numeric"
              data-setting-field="ai.maxTokens"
              value="${escapeAttribute(String(app.state.preferences.ai.maxTokens || DEFAULT_AI_MAX_TOKENS))}"
            />
          </label>
          <p class="inspector-copy">${app.t('settings.aiMaxTokensHint')}</p>
          <label class="field-stack">
            <span>${app.t('settings.aiTimeout')}</span>
            <input
              class="settings-input"
              type="number"
              min="1"
              max="600"
              step="1"
              inputmode="numeric"
              data-setting-field="ai.timeoutSeconds"
              value="${escapeAttribute(String(app.state.preferences.ai.timeoutSeconds || DEFAULT_AI_TIMEOUT_SECONDS))}"
            />
          </label>
          <p class="inspector-copy">${app.t('settings.aiTimeoutHint')}</p>
          <p class="inspector-copy">${app.t('settings.aiHint')}</p>
        </section>

        <section class="settings-card">
          <p class="section-label">${app.t('settings.collabApi')}</p>
          <div class="field-stack">
            <span>${app.t('settings.collabApiKey')}</span>
            <p class="settings-input collab-api-key-display" data-collab-key-display>${app.collabApiKeyMasked()}</p>
          </div>
          <div class="collab-api-actions">
            <button type="button" class="ghost-button" data-command="collab-generate-key">${app.t('settings.collabApiKeyGenerate')}</button>
            <button type="button" class="ghost-button" data-command="collab-copy-key">${app.t('settings.collabApiKeyCopy')}</button>
            <button type="button" class="ghost-button" data-command="collab-clear-key">${app.t('settings.collabApiKeyClear')}</button>
          </div>
          <div class="collab-api-actions">
            <button type="button" class="ghost-button" data-command="collab-save-key">${app.t('settings.collabApiKeySave')}</button>
          </div>
          <p class="inspector-copy">${app.t('settings.collabApiKeyHint')}</p>
        </section>
      </section>
    </div>
  `
}

export function renderCanvasDragActionOptions(app: MindMapApp, selected: CanvasDragAction): string {
  const options =
    app.state.preferences.locale === 'zh-CN'
      ? [
          { value: 'none' as const, label: '无操作' },
          { value: 'marquee-select' as const, label: '框选节点' },
          { value: 'pan-canvas' as const, label: '拖动画布' },
          { value: 'cutting' as const, label: '切除模式' },
        ]
      : [
          { value: 'none' as const, label: 'No action' },
          { value: 'marquee-select' as const, label: 'Marquee select' },
          { value: 'pan-canvas' as const, label: 'Pan canvas' },
          { value: 'cutting' as const, label: 'Cutting mode' },
        ]

  return options
    .map(
      (option) =>
        `<option value="${option.value}" ${selected === option.value ? 'selected' : ''}>${escapeHtml(option.label)}</option>`,
    )
    .join('')
}

export function renderGestureActionOptions(app: MindMapApp, selected: GestureAction): string {
  const gestureOptions =
    app.state.preferences.locale === 'zh-CN'
      ? [
          { value: 'none' as const, label: '无操作' },
          { value: 'rename' as const, label: '重命名节点' },
          { value: 'edit-tail' as const, label: '在标题末尾编辑' },
          { value: 'ai-quick' as const, label: 'AI 快捷请求' },
          { value: 'ai-suggest-children' as const, label: '建议子节点' },
          { value: 'ai-suggest-siblings' as const, label: '建议同级节点' },
          { value: 'ai-wheel' as const, label: 'AI 轮盘' },
          { value: 'new-child' as const, label: '新建子节点' },
          { value: 'new-sibling' as const, label: '新建同级节点' },
          { value: 'new-floating' as const, label: '新建自由节点' },
          { value: 'toggle-collapse' as const, label: '折叠 / 展开分支' },
        ]
      : [
          { value: 'none' as const, label: 'No action' },
          { value: 'rename' as const, label: 'Rename node' },
          { value: 'edit-tail' as const, label: 'Edit title tail' },
          { value: 'ai-quick' as const, label: 'AI quick assist' },
          { value: 'ai-suggest-children' as const, label: 'Suggest children' },
          { value: 'ai-suggest-siblings' as const, label: 'Suggest siblings' },
          { value: 'ai-wheel' as const, label: 'AI wheel' },
          { value: 'new-child' as const, label: 'New child' },
          { value: 'new-sibling' as const, label: 'New sibling' },
          { value: 'new-floating' as const, label: 'New floating node' },
          { value: 'toggle-collapse' as const, label: 'Toggle collapse' },
        ]

  return gestureOptions
    .map(
      (option) =>
        `<option value="${option.value}" ${selected === option.value ? 'selected' : ''}>${escapeHtml(option.label)}</option>`,
    )
    .join('')
}
