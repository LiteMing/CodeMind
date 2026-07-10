import { describe, expect, it } from 'vitest'
import {
  childrenOf,
  createDefaultDocument,
  createNode,
  deleteNodesPromotingChildren,
  normalizeDocumentSemantics,
  setNodeParent,
} from './document'

describe('node semantics', () => {
  it('migrates legacy sibling order deterministically by y, x, and id', () => {
    const document = createDefaultDocument()
    const nodes = [
      createNode({ title: 'C', kind: 'topic', parentId: 'root', order: 1, position: { x: 200, y: 100 } }),
      createNode({ title: 'B', kind: 'topic', parentId: 'root', order: 1, position: { x: 100, y: 100 } }),
      createNode({ title: 'A', kind: 'topic', parentId: 'root', order: 1, position: { x: 100, y: 100 } }),
    ]
    nodes[0].id = 'node-c'
    nodes[1].id = 'node-b'
    nodes[2].id = 'node-a'
    for (const node of nodes) {
      ;(node as { order?: number; bindings?: unknown }).order = undefined
      ;(node as { bindings?: unknown }).bindings = undefined
    }
    document.nodes.push(...nodes)

    normalizeDocumentSemantics(document)

    expect(childrenOf(document, 'root').map((node) => [node.id, node.order])).toEqual([
      ['node-a', 1],
      ['node-b', 2],
      ['node-c', 3],
    ])
    expect(nodes.every((node) => Array.isArray(node.bindings))).toBe(true)
  })

  it('preserves valid explicit order when coordinates change', () => {
    const document = createDefaultDocument()
    const first = createNode({
      title: 'First',
      kind: 'topic',
      parentId: 'root',
      order: 1,
      position: { x: 900, y: 500 },
    })
    const second = createNode({
      title: 'Second',
      kind: 'topic',
      parentId: 'root',
      order: 2,
      position: { x: 900, y: 100 },
    })
    document.nodes.push(first, second)

    normalizeDocumentSemantics(document)
    first.position.y = 900
    second.position.y = 0

    expect(childrenOf(document, 'root').map((node) => node.id)).toEqual([first.id, second.id])
  })

  it('keeps valid legacy slots and fills missing slots by position', () => {
    const document = createDefaultDocument()
    const top = createNode({ title: 'Top', kind: 'topic', parentId: 'root', order: 1, position: { x: 0, y: 0 } })
    const fixed = createNode({
      title: 'Fixed',
      kind: 'topic',
      parentId: 'root',
      order: 2,
      position: { x: 0, y: 999 },
    })
    const bottom = createNode({
      title: 'Bottom',
      kind: 'topic',
      parentId: 'root',
      order: 3,
      position: { x: 0, y: 100 },
    })
    ;(top as { order?: number }).order = undefined
    ;(bottom as { order?: number }).order = undefined
    document.nodes.push(bottom, fixed, top)

    normalizeDocumentSemantics(document)

    expect(childrenOf(document, 'root').map((node) => node.title)).toEqual(['Top', 'Fixed', 'Bottom'])
  })

  it('compacts all-positive legacy order gaps without falling back to coordinates', () => {
    const document = createDefaultDocument()
    const first = createNode({
      title: 'First',
      kind: 'topic',
      parentId: 'root',
      order: 20,
      position: { x: 0, y: 500 },
    })
    const second = createNode({
      title: 'Second',
      kind: 'topic',
      parentId: 'root',
      order: 40,
      position: { x: 0, y: 0 },
    })
    document.nodes.push(second, first)

    normalizeDocumentSemantics(document)

    expect(childrenOf(document, 'root').map((node) => [node.title, node.order])).toEqual([
      ['First', 1],
      ['Second', 2],
    ])
  })

  it('appends on reparent and compacts the previous sibling group', () => {
    const document = createDefaultDocument()
    const left = createNode({ title: 'Left', kind: 'topic', parentId: 'root', order: 1, position: { x: 0, y: 0 } })
    const right = createNode({ title: 'Right', kind: 'topic', parentId: 'root', order: 2, position: { x: 0, y: 100 } })
    const destination = createNode({
      title: 'Destination',
      kind: 'topic',
      parentId: 'root',
      order: 3,
      position: { x: 0, y: 200 },
    })
    const existing = createNode({
      title: 'Existing',
      kind: 'topic',
      parentId: destination.id,
      order: 1,
      position: { x: 0, y: 300 },
    })
    document.nodes.push(left, right, destination, existing)

    setNodeParent(document, right.id, destination.id)

    expect(childrenOf(document, 'root').map((node) => node.order)).toEqual([1, 2])
    expect(childrenOf(document, destination.id).map((node) => [node.id, node.order])).toEqual([
      [existing.id, 1],
      [right.id, 2],
    ])
  })

  it('promotes direct children into the deleted node position', () => {
    const document = createDefaultDocument()
    const before = createNode({ title: 'Before', kind: 'topic', parentId: 'root', order: 1, position: { x: 0, y: 0 } })
    const removed = createNode({
      title: 'Removed',
      kind: 'topic',
      parentId: 'root',
      order: 2,
      position: { x: 0, y: 100 },
    })
    const after = createNode({ title: 'After', kind: 'topic', parentId: 'root', order: 3, position: { x: 0, y: 200 } })
    const childA = createNode({
      title: 'Child A',
      kind: 'topic',
      parentId: removed.id,
      order: 1,
      position: { x: 0, y: 50 },
    })
    const childB = createNode({
      title: 'Child B',
      kind: 'topic',
      parentId: removed.id,
      order: 2,
      position: { x: 0, y: 150 },
    })
    document.nodes.push(before, removed, after, childA, childB)

    deleteNodesPromotingChildren(document, new Set([removed.id]))

    expect(childrenOf(document, 'root').map((node) => [node.title, node.order])).toEqual([
      ['Before', 1],
      ['Child A', 2],
      ['Child B', 3],
      ['After', 4],
    ])
  })
})
