import type { AppPreferences, ChromeLayout, EdgeStyle, GestureAction, LayoutMode, Locale, TopPanelPosition } from './types'

const STORAGE_KEY = 'code-mind.preferences'
export const DEFAULT_LM_STUDIO_URL = 'http://127.0.0.1:1234/v1'
export const DEFAULT_AI_MAX_TOKENS = 4800
export const DEFAULT_AI_TIMEOUT_SECONDS = 45
const MIN_AI_MAX_TOKENS = 256
const MAX_AI_MAX_TOKENS = 32768
const MIN_AI_TIMEOUT_SECONDS = 1
const MAX_AI_TIMEOUT_SECONDS = 600

export function createDefaultPreferences(): AppPreferences {
  return {
    locale: detectLocale(),
    onboardingCompleted: false,
    appearance: {
      edgeStyle: 'curve',
      layoutMode: 'balanced',
      chromeLayout: 'floating',
      topPanelPosition: 'left',
    },
    interaction: {
      dragSubtreeWithParent: true,
      dragSnap: true,
      autoLayoutOnCollapse: true,
      autoSnapshots: true,
      aiQuickChildren: true,
      aiQuickSiblings: false,
      aiQuickNotes: false,
      aiQuickRelations: false,
      doubleClickAction: 'rename',
      tripleClickAction: 'ai-quick',
      longPressAction: 'ai-wheel',
      spaceAction: 'edit-tail',
    },
    ai: {
      provider: 'lmstudio',
      baseUrl: DEFAULT_LM_STUDIO_URL,
      model: '',
      apiKey: '',
      maxTokens: DEFAULT_AI_MAX_TOKENS,
      timeoutSeconds: DEFAULT_AI_TIMEOUT_SECONDS,
    },
  }
}

export function loadPreferences(): AppPreferences {
  const defaults = createDefaultPreferences()
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return defaults
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AppPreferences>
    return {
      locale: normalizeLocale(parsed.locale) ?? defaults.locale,
      onboardingCompleted: parsed.onboardingCompleted ?? defaults.onboardingCompleted,
      appearance: {
        edgeStyle: normalizeEdgeStyle(parsed.appearance?.edgeStyle),
        layoutMode: normalizeLayoutMode(parsed.appearance?.layoutMode),
        chromeLayout: normalizeChromeLayout(parsed.appearance?.chromeLayout),
        topPanelPosition: normalizeTopPanelPosition(parsed.appearance?.topPanelPosition),
      },
      interaction: {
        dragSubtreeWithParent: normalizeBoolean(parsed.interaction?.dragSubtreeWithParent, defaults.interaction.dragSubtreeWithParent),
        dragSnap: normalizeBoolean(parsed.interaction?.dragSnap, defaults.interaction.dragSnap),
        autoLayoutOnCollapse: normalizeBoolean(parsed.interaction?.autoLayoutOnCollapse, defaults.interaction.autoLayoutOnCollapse),
        autoSnapshots: normalizeBoolean(parsed.interaction?.autoSnapshots, defaults.interaction.autoSnapshots),
        aiQuickChildren: normalizeBoolean(parsed.interaction?.aiQuickChildren, defaults.interaction.aiQuickChildren),
        aiQuickSiblings: normalizeBoolean(parsed.interaction?.aiQuickSiblings, defaults.interaction.aiQuickSiblings),
        aiQuickNotes: normalizeBoolean(parsed.interaction?.aiQuickNotes, defaults.interaction.aiQuickNotes),
        aiQuickRelations: normalizeBoolean(parsed.interaction?.aiQuickRelations, defaults.interaction.aiQuickRelations),
        doubleClickAction: normalizeGestureAction(parsed.interaction?.doubleClickAction, defaults.interaction.doubleClickAction),
        tripleClickAction: normalizeGestureAction(parsed.interaction?.tripleClickAction, defaults.interaction.tripleClickAction),
        longPressAction: normalizeGestureAction(parsed.interaction?.longPressAction, defaults.interaction.longPressAction),
        spaceAction: normalizeGestureAction(parsed.interaction?.spaceAction, defaults.interaction.spaceAction),
      },
      ai: {
        provider: parsed.ai?.provider === 'openai-compatible' ? 'openai-compatible' : 'lmstudio',
        baseUrl: (parsed.ai?.baseUrl ?? defaults.ai.baseUrl).trim() || defaults.ai.baseUrl,
        model: (parsed.ai?.model ?? '').trim(),
        apiKey: (parsed.ai?.apiKey ?? '').trim(),
        maxTokens: normalizeAIMaxTokens(parsed.ai?.maxTokens),
        timeoutSeconds: normalizeAITimeoutSeconds(parsed.ai?.timeoutSeconds),
      },
    }
  } catch {
    return defaults
  }
}

export function savePreferences(preferences: AppPreferences): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
}

function detectLocale(): Locale {
  return normalizeLocale(window.navigator.language) ?? 'en'
}

function normalizeLocale(value: string | undefined): Locale | null {
  if (!value) {
    return null
  }

  return value.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

export function normalizeEdgeStyle(value: unknown): EdgeStyle {
  return value === 'orthogonal' ? 'orthogonal' : 'curve'
}

export function normalizeLayoutMode(value: unknown): LayoutMode {
  return value === 'right' ? 'right' : 'balanced'
}

export function normalizeChromeLayout(value: unknown): ChromeLayout {
  return value === 'fixed' ? 'fixed' : 'floating'
}

export function normalizeTopPanelPosition(value: unknown): TopPanelPosition {
  if (value === 'center' || value === 'right') {
    return value
  }
  return 'left'
}

export function normalizeGestureAction(value: unknown, fallback: GestureAction = 'none'): GestureAction {
  switch (value) {
    case 'rename':
    case 'edit-tail':
    case 'ai-quick':
    case 'ai-suggest-children':
    case 'ai-suggest-siblings':
    case 'ai-wheel':
    case 'new-child':
    case 'new-sibling':
    case 'new-floating':
    case 'toggle-collapse':
    case 'none':
      return value
    default:
      return fallback
  }
}

export function normalizeBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  return fallback
}

export function normalizeAIMaxTokens(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? '').trim(), 10)
  if (!Number.isFinite(parsed)) {
    return DEFAULT_AI_MAX_TOKENS
  }

  return clamp(Math.round(parsed), MIN_AI_MAX_TOKENS, MAX_AI_MAX_TOKENS)
}

export function normalizeAITimeoutSeconds(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? '').trim(), 10)
  if (!Number.isFinite(parsed)) {
    return DEFAULT_AI_TIMEOUT_SECONDS
  }

  return clamp(Math.round(parsed), MIN_AI_TIMEOUT_SECONDS, MAX_AI_TIMEOUT_SECONDS)
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min
  }
  if (value > max) {
    return max
  }
  return value
}
