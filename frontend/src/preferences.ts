import type { AppPreferences, Locale } from './types'

const STORAGE_KEY = 'code-mind.preferences'
export const DEFAULT_LM_STUDIO_URL = 'http://127.0.0.1:1234/v1'
export const DEFAULT_AI_MAX_TOKENS = 3200
const MIN_AI_MAX_TOKENS = 256
const MAX_AI_MAX_TOKENS = 32768

export function createDefaultPreferences(): AppPreferences {
  return {
    locale: detectLocale(),
    onboardingCompleted: false,
    ai: {
      provider: 'lmstudio',
      baseUrl: DEFAULT_LM_STUDIO_URL,
      model: '',
      apiKey: '',
      maxTokens: DEFAULT_AI_MAX_TOKENS,
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
      ai: {
        provider: parsed.ai?.provider === 'openai-compatible' ? 'openai-compatible' : 'lmstudio',
        baseUrl: (parsed.ai?.baseUrl ?? defaults.ai.baseUrl).trim() || defaults.ai.baseUrl,
        model: (parsed.ai?.model ?? '').trim(),
        apiKey: (parsed.ai?.apiKey ?? '').trim(),
        maxTokens: normalizeAIMaxTokens(parsed.ai?.maxTokens),
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

export function normalizeAIMaxTokens(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? '').trim(), 10)
  if (!Number.isFinite(parsed)) {
    return DEFAULT_AI_MAX_TOKENS
  }

  return clamp(Math.round(parsed), MIN_AI_MAX_TOKENS, MAX_AI_MAX_TOKENS)
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
