import { describe, it, expect } from 'vitest'
import {
  clamp,
  clampMin,
  escapeHtml,
  escapeAttribute,
  shorten,
  slugify,
  isTypingTarget,
  parsePixelValue,
  directionalPrimaryDelta,
  directionalCrossDelta,
  getErrorMessage,
  normalizeClientRect,
  rectanglesIntersect,
  rectanglesOverlapCoords,
} from './utils'

describe('clamp', () => {
  it('returns value when within range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
  })

  it('clamps to min', () => {
    expect(clamp(-5, 0, 10)).toBe(0)
  })

  it('clamps to max', () => {
    expect(clamp(15, 0, 10)).toBe(10)
  })

  it('handles equal min and max', () => {
    expect(clamp(5, 3, 3)).toBe(3)
  })
})

describe('clampMin', () => {
  it('returns value when above min', () => {
    expect(clampMin(5, 0)).toBe(5)
  })

  it('returns min when value is below', () => {
    expect(clampMin(-1, 0)).toBe(0)
  })
})

describe('escapeHtml', () => {
  it('escapes all special characters', () => {
    expect(escapeHtml('<div class="a">b & c\'d</div>')).toBe(
      '&lt;div class=&quot;a&quot;&gt;b &amp; c&#39;d&lt;/div&gt;',
    )
  })

  it('returns empty string unchanged', () => {
    expect(escapeHtml('')).toBe('')
  })
})

describe('escapeAttribute', () => {
  it('delegates to escapeHtml', () => {
    expect(escapeAttribute('"hello"')).toBe('&quot;hello&quot;')
  })
})

describe('shorten', () => {
  it('returns short strings unchanged', () => {
    expect(shorten('abc', 10)).toBe('abc')
  })

  it('truncates long strings with ellipsis', () => {
    expect(shorten('abcdefghij', 6)).toBe('abc...')
  })

  it('handles exact length', () => {
    expect(shorten('abc', 3)).toBe('abc')
  })
})

describe('slugify', () => {
  it('converts to lowercase kebab-case', () => {
    expect(slugify('Hello World')).toBe('hello-world')
  })

  it('handles Chinese characters', () => {
    expect(slugify('你好世界')).toBe('你好世界')
  })

  it('returns default for empty string', () => {
    expect(slugify('')).toBe('code-mind')
  })

  it('strips leading/trailing dashes', () => {
    expect(slugify('  hello  ')).toBe('hello')
  })
})

describe('isTypingTarget', () => {
  it.skipIf(typeof globalThis.HTMLInputElement === 'undefined')('returns false for null', () => {
    expect(isTypingTarget(null)).toBe(false)
  })
})

describe('parsePixelValue', () => {
  it('parses valid pixel string', () => {
    expect(parsePixelValue('42.5px')).toBe(42.5)
  })

  it('returns 0 for null', () => {
    expect(parsePixelValue(null)).toBe(0)
  })

  it('returns 0 for empty string', () => {
    expect(parsePixelValue('')).toBe(0)
  })

  it('returns 0 for non-numeric', () => {
    expect(parsePixelValue('abc')).toBe(0)
  })
})

describe('directionalPrimaryDelta', () => {
  it('returns -deltaY for ArrowUp', () => {
    expect(directionalPrimaryDelta('ArrowUp', 10, 20)).toBe(-20)
  })

  it('returns deltaY for ArrowDown', () => {
    expect(directionalPrimaryDelta('ArrowDown', 10, 20)).toBe(20)
  })

  it('returns -deltaX for ArrowLeft', () => {
    expect(directionalPrimaryDelta('ArrowLeft', 10, 20)).toBe(-10)
  })

  it('returns deltaX for ArrowRight', () => {
    expect(directionalPrimaryDelta('ArrowRight', 10, 20)).toBe(10)
  })
})

describe('directionalCrossDelta', () => {
  it('returns deltaX for vertical arrows', () => {
    expect(directionalCrossDelta('ArrowUp', 10, 20)).toBe(10)
    expect(directionalCrossDelta('ArrowDown', 10, 20)).toBe(10)
  })

  it('returns deltaY for horizontal arrows', () => {
    expect(directionalCrossDelta('ArrowLeft', 10, 20)).toBe(20)
    expect(directionalCrossDelta('ArrowRight', 10, 20)).toBe(20)
  })
})

describe('getErrorMessage', () => {
  it('extracts message from Error', () => {
    expect(getErrorMessage(new Error('test'))).toBe('test')
  })

  it('returns default for non-Error', () => {
    expect(getErrorMessage('string')).toBe('Unknown error')
    expect(getErrorMessage(null)).toBe('Unknown error')
  })
})

describe('normalizeClientRect', () => {
  it.skipIf(typeof globalThis.DOMRect === 'undefined')('normalizes coordinates regardless of direction', () => {
    const rect = normalizeClientRect(100, 200, 50, 150)
    expect(rect.left).toBe(50)
    expect(rect.top).toBe(150)
    expect(rect.width).toBe(50)
    expect(rect.height).toBe(50)
  })
})

describe('rectanglesIntersect', () => {
  it('detects overlapping rectangles', () => {
    const a = { left: 0, right: 10, top: 0, bottom: 10 }
    const b = { left: 5, right: 15, top: 5, bottom: 15 }
    expect(rectanglesIntersect(a, b)).toBe(true)
  })

  it('detects non-overlapping rectangles', () => {
    const a = { left: 0, right: 10, top: 0, bottom: 10 }
    const b = { left: 20, right: 30, top: 20, bottom: 30 }
    expect(rectanglesIntersect(a, b)).toBe(false)
  })
})

describe('rectanglesOverlapCoords', () => {
  it('detects overlap', () => {
    expect(rectanglesOverlapCoords(0, 0, 10, 10, 5, 5, 15, 15)).toBe(true)
  })

  it('detects no overlap', () => {
    expect(rectanglesOverlapCoords(0, 0, 10, 10, 20, 20, 30, 30)).toBe(false)
  })
})
