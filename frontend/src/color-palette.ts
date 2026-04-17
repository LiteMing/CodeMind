import type { TranslationKey } from './i18n'
import type { NodeColor } from './types'
import { clamp } from './utils'

export type NodeColorChoice = Exclude<NodeColor, ''>

export interface NodeColorPalette {
  accent: string
  accentRgb: [number, number, number]
  surfaceRgb: [number, number, number]
  plateRgb: [number, number, number]
  glowRgb: [number, number, number]
  text: string
  labelKey: TranslationKey
}

export const NODE_COLOR_VALUES: NodeColor[] = ['', 'slate', 'blue', 'teal', 'green', 'amber', 'rose', 'violet']

export const NODE_COLOR_PALETTES: Record<NodeColorChoice, NodeColorPalette> = {
  slate: {
    accent: '#94a3b8',
    accentRgb: [148, 163, 184],
    surfaceRgb: [71, 85, 105],
    plateRgb: [51, 65, 85],
    glowRgb: [148, 163, 184],
    text: '#f8fafc',
    labelKey: 'color.slate',
  },
  blue: {
    accent: '#60a5fa',
    accentRgb: [96, 165, 250],
    surfaceRgb: [37, 99, 235],
    plateRgb: [29, 78, 216],
    glowRgb: [96, 165, 250],
    text: '#eff6ff',
    labelKey: 'color.blue',
  },
  teal: {
    accent: '#2dd4bf',
    accentRgb: [45, 212, 191],
    surfaceRgb: [13, 148, 136],
    plateRgb: [15, 118, 110],
    glowRgb: [45, 212, 191],
    text: '#ecfeff',
    labelKey: 'color.teal',
  },
  green: {
    accent: '#4ade80',
    accentRgb: [74, 222, 128],
    surfaceRgb: [22, 163, 74],
    plateRgb: [21, 128, 61],
    glowRgb: [74, 222, 128],
    text: '#f0fdf4',
    labelKey: 'color.green',
  },
  amber: {
    accent: '#f59e0b',
    accentRgb: [245, 158, 11],
    surfaceRgb: [217, 119, 6],
    plateRgb: [180, 83, 9],
    glowRgb: [245, 158, 11],
    text: '#fffbeb',
    labelKey: 'color.amber',
  },
  rose: {
    accent: '#fb7185',
    accentRgb: [251, 113, 133],
    surfaceRgb: [225, 29, 72],
    plateRgb: [190, 24, 93],
    glowRgb: [251, 113, 133],
    text: '#fff1f2',
    labelKey: 'color.rose',
  },
  violet: {
    accent: '#a78bfa',
    accentRgb: [167, 139, 250],
    surfaceRgb: [109, 40, 217],
    plateRgb: [91, 33, 182],
    glowRgb: [167, 139, 250],
    text: '#f5f3ff',
    labelKey: 'color.violet',
  },
}

export function resolveNodeColorPalette(color: NodeColor): NodeColorPalette | null {
  return color ? NODE_COLOR_PALETTES[color as NodeColorChoice] : null
}

export function buildNodeColorStyle(color: NodeColor): string {
  const palette = resolveNodeColorPalette(color)
  if (!palette) {
    return ''
  }

  return `--node-color: ${palette.accent}; --node-color-text-override: ${palette.text};`
}

export function normalizeNodeColor(value: string | null | undefined): NodeColor {
  return NODE_COLOR_VALUES.includes(value as NodeColor) ? (value as NodeColor) : ''
}

export function rgbaFromRgb(rgb: [number, number, number], alpha: number): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${clamp(alpha, 0, 1)})`
}

export function applyAlphaToHex(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex)
  return rgbaFromRgb(rgb ?? [241, 245, 249], alpha)
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const normalized = hex.trim().replace('#', '')
  const expanded =
    normalized.length === 3
      ? normalized
          .split('')
          .map((value) => `${value}${value}`)
          .join('')
      : normalized
  if (expanded.length !== 6) {
    return null
  }

  const value = Number.parseInt(expanded, 16)
  if (Number.isNaN(value)) {
    return null
  }

  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}
