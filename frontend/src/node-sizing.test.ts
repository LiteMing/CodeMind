import { describe, it, expect } from 'vitest'
import { estimateNodeWidth } from './node-sizing'
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

describe('estimateNodeWidth note badge accessory', () => {
  // A title long enough that the estimate is not clamped to the minimum width,
  // yet stays under the maximum even with badges added.
  const longTitle = 'a fairly long node title used for width estimation'

  it('reserves extra width for the note badge', () => {
    const plain = makeMockNode({ title: longTitle })
    const withNote = makeMockNode({ title: longTitle, note: 'has a note' })
    expect(estimateNodeWidth(withNote, 0)).toBeGreaterThan(estimateNodeWidth(plain, 0))
  })

  it('ignores whitespace-only notes', () => {
    const plain = makeMockNode({ title: longTitle })
    const blankNote = makeMockNode({ title: longTitle, note: '   ' })
    expect(estimateNodeWidth(blankNote, 0)).toBe(estimateNodeWidth(plain, 0))
  })

  it('stacks with the branch badge', () => {
    const withChildren = makeMockNode({ title: longTitle })
    const withChildrenAndNote = makeMockNode({ title: longTitle, note: 'note' })
    expect(estimateNodeWidth(withChildrenAndNote, 3)).toBeGreaterThan(estimateNodeWidth(withChildren, 3))
  })
})
