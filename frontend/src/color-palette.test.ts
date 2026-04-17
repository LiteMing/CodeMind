import { describe, it, expect } from 'vitest'
import {
  normalizeNodeColor,
  resolveNodeColorPalette,
  buildNodeColorStyle,
  hexToRgb,
  rgbaFromRgb,
  applyAlphaToHex,
  NODE_COLOR_VALUES,
  NODE_COLOR_PALETTES,
} from './color-palette'

describe('normalizeNodeColor', () => {
  it('returns valid color unchanged', () => {
    expect(normalizeNodeColor('blue')).toBe('blue')
    expect(normalizeNodeColor('rose')).toBe('rose')
  })

  it('returns empty string for invalid color', () => {
    expect(normalizeNodeColor('invalid')).toBe('')
    expect(normalizeNodeColor(null)).toBe('')
    expect(normalizeNodeColor(undefined)).toBe('')
  })

  it('returns empty string for empty string', () => {
    expect(normalizeNodeColor('')).toBe('')
  })
})

describe('resolveNodeColorPalette', () => {
  it('returns palette for valid color', () => {
    const palette = resolveNodeColorPalette('blue')
    expect(palette).not.toBeNull()
    expect(palette!.accent).toBe('#60a5fa')
  })

  it('returns null for empty color', () => {
    expect(resolveNodeColorPalette('')).toBeNull()
  })
})

describe('buildNodeColorStyle', () => {
  it('returns CSS variables for valid color', () => {
    const style = buildNodeColorStyle('teal')
    expect(style).toContain('--node-color:')
    expect(style).toContain('--node-color-text-override:')
  })

  it('returns empty string for empty color', () => {
    expect(buildNodeColorStyle('')).toBe('')
  })
})

describe('hexToRgb', () => {
  it('parses 6-digit hex', () => {
    expect(hexToRgb('#ff0000')).toEqual([255, 0, 0])
    expect(hexToRgb('00ff00')).toEqual([0, 255, 0])
  })

  it('parses 3-digit hex', () => {
    expect(hexToRgb('#f00')).toEqual([255, 0, 0])
  })

  it('returns null for invalid hex', () => {
    expect(hexToRgb('xyz')).toBeNull()
    expect(hexToRgb('')).toBeNull()
  })
})

describe('rgbaFromRgb', () => {
  it('formats rgba string', () => {
    expect(rgbaFromRgb([255, 128, 0], 0.5)).toBe('rgba(255, 128, 0, 0.5)')
  })

  it('clamps alpha to 0-1', () => {
    expect(rgbaFromRgb([0, 0, 0], 2)).toBe('rgba(0, 0, 0, 1)')
    expect(rgbaFromRgb([0, 0, 0], -1)).toBe('rgba(0, 0, 0, 0)')
  })
})

describe('applyAlphaToHex', () => {
  it('converts hex to rgba', () => {
    const result = applyAlphaToHex('#ff0000', 0.5)
    expect(result).toBe('rgba(255, 0, 0, 0.5)')
  })

  it('uses fallback for invalid hex', () => {
    const result = applyAlphaToHex('invalid', 1)
    expect(result).toBe('rgba(241, 245, 249, 1)')
  })
})

describe('NODE_COLOR_VALUES', () => {
  it('includes empty string and all named colors', () => {
    expect(NODE_COLOR_VALUES).toContain('')
    expect(NODE_COLOR_VALUES).toContain('blue')
    expect(NODE_COLOR_VALUES).toContain('violet')
    expect(NODE_COLOR_VALUES.length).toBe(8)
  })
})

describe('NODE_COLOR_PALETTES', () => {
  it('has entries for all non-empty colors', () => {
    const namedColors = NODE_COLOR_VALUES.filter((c) => c !== '')
    for (const color of namedColors) {
      expect(NODE_COLOR_PALETTES[color as keyof typeof NODE_COLOR_PALETTES]).toBeDefined()
    }
  })
})
