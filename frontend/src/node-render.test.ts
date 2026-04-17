import { describe, it, expect } from 'vitest'
import { nodeVisibleTitle, normalizeNodeNote, deriveNoteChildTitle } from './node-render'
import type { MindNode } from './types'

function makeMockNode(overrides: Partial<MindNode> = {}): MindNode {
  return {
    id: 'test',
    kind: 'topic',
    title: 'Test Node',
    position: { x: 0, y: 0 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as MindNode
}

describe('nodeVisibleTitle', () => {
  it('returns the node title', () => {
    const node = makeMockNode({ title: 'Hello' })
    expect(nodeVisibleTitle(node)).toBe('Hello')
  })
})

describe('normalizeNodeNote', () => {
  it('returns undefined for non-string', () => {
    expect(normalizeNodeNote(null)).toBeUndefined()
    expect(normalizeNodeNote(undefined)).toBeUndefined()
  })

  it('returns undefined for empty/whitespace string', () => {
    expect(normalizeNodeNote('')).toBeUndefined()
    expect(normalizeNodeNote('   ')).toBeUndefined()
  })

  it('normalizes CRLF to LF and trims', () => {
    expect(normalizeNodeNote('  hello\r\nworld  ')).toBe('hello\nworld')
  })
})

describe('deriveNoteChildTitle', () => {
  it('extracts first sentence for English', () => {
    const parent = makeMockNode({ title: 'Parent' })
    const result = deriveNoteChildTitle(parent, 'This is a long note about something important.', 'en')
    expect(result.length).toBeGreaterThan(0)
    expect(result.length).toBeLessThanOrEqual(31) // 28 + "..."
  })

  it('falls back to parent title + Note for short notes', () => {
    const parent = makeMockNode({ title: 'Parent' })
    const result = deriveNoteChildTitle(parent, 'Hi', 'en')
    expect(result).toBe('Parent Note')
  })

  it('uses Chinese suffix for zh-CN', () => {
    const parent = makeMockNode({ title: '父节点' })
    const result = deriveNoteChildTitle(parent, '短', 'zh-CN')
    expect(result).toBe('父节点 注释')
  })
})
