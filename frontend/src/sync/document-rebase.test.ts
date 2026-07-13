import { describe, expect, it } from 'vitest'
import { createDefaultDocument } from '../document'
import type { MindMapDocument, MindNode } from '../types'
import { cloneDocument } from '../utils'
import { rebaseDocument } from './document-rebase'

describe('rebaseDocument', () => {
  it('merges disjoint document and node fields', () => {
    const base = createBaseDocument()
    const local = cloneDocument(base)
    const remote = cloneDocument(base)
    local.nodes[1].note = 'local note'
    local.nodes[1].updatedAt = '2026-07-13T00:00:02.000Z'
    remote.title = 'Remote title'
    remote.nodes[1].priority = 'P1'
    remote.nodes[1].updatedAt = '2026-07-13T00:00:03.000Z'
    remote.meta.revision = 2

    const merged = rebaseDocument(base, local, remote)

    expect(merged?.title).toBe('Remote title')
    expect(merged?.nodes[1].note).toBe('local note')
    expect(merged?.nodes[1].priority).toBe('P1')
    expect(merged?.nodes[1].updatedAt).toBe('2026-07-13T00:00:03.000Z')
    expect(merged?.meta.revision).toBe(2)
  })

  it('merges additions under different parents', () => {
    const base = createBaseDocument()
    const local = cloneDocument(base)
    const remote = cloneDocument(base)
    local.nodes.push(createNode('local-child', 'parent-a', 1))
    remote.nodes.push(createNode('remote-child', 'parent-b', 1))
    remote.nodes[2].note = 'remote edit'
    remote.meta.revision = 2

    const merged = rebaseDocument(base, local, remote)

    expect(merged?.nodes.map((node) => node.id)).toEqual([
      'root',
      'parent-a',
      'parent-b',
      'remote-child',
      'local-child',
    ])
    expect(merged?.nodes.find((node) => node.id === 'parent-b')?.note).toBe('remote edit')
  })

  it('rejects additions under the same parent because sibling order is ambiguous', () => {
    const base = createBaseDocument()
    const local = cloneDocument(base)
    const remote = cloneDocument(base)
    local.nodes.push(createNode('local-child', 'parent-a', 1))
    remote.nodes.push(createNode('remote-child', 'parent-a', 1))

    expect(rebaseDocument(base, local, remote)).toBeNull()
  })

  it('rejects conflicting changes to the same field', () => {
    const base = createBaseDocument()
    const local = cloneDocument(base)
    const remote = cloneDocument(base)
    local.nodes[1].title = 'Local title'
    remote.nodes[1].title = 'Remote title'

    expect(rebaseDocument(base, local, remote)).toBeNull()
  })

  it.each([
    ['local deletion', (_base: MindMapDocument, local: MindMapDocument) => (local.nodes = local.nodes.slice(0, -1))],
    [
      'remote movement',
      (_base: MindMapDocument, _local: MindMapDocument, remote: MindMapDocument) => (remote.nodes[1].position.x += 20),
    ],
    ['local order change', (_base: MindMapDocument, local: MindMapDocument) => (local.nodes[1].order = 2)],
    [
      'relation change',
      (_base: MindMapDocument, local: MindMapDocument) =>
        local.relations.push({
          id: 'relation-1',
          sourceId: 'parent-a',
          targetId: 'parent-b',
          createdAt: '2026-07-13T00:00:00.000Z',
          updatedAt: '2026-07-13T00:00:00.000Z',
        }),
    ],
    [
      'region change',
      (_base: MindMapDocument, _local: MindMapDocument, remote: MindMapDocument) =>
        remote.regions.push({
          id: 'region-1',
          label: 'Region',
          color: 'blue',
          position: { x: 0, y: 0 },
          width: 200,
          height: 120,
          createdAt: '2026-07-13T00:00:00.000Z',
          updatedAt: '2026-07-13T00:00:00.000Z',
        }),
    ],
  ])('rejects %s', (_name, mutate) => {
    const base = createBaseDocument()
    const local = cloneDocument(base)
    const remote = cloneDocument(base)
    mutate(base, local, remote)

    expect(rebaseDocument(base, local, remote)).toBeNull()
  })
})

function createBaseDocument(): MindMapDocument {
  const document = createDefaultDocument()
  document.id = 'map-rebase'
  document.title = 'Base'
  document.nodes[0].id = 'root'
  document.nodes.push(createNode('parent-a', 'root', 1), createNode('parent-b', 'root', 2))
  return document
}

function createNode(id: string, parentId: string, order: number): MindNode {
  return {
    id,
    parentId,
    kind: 'topic',
    order,
    title: id,
    bindings: [],
    position: { x: order * 200, y: order * 100 },
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z',
  }
}
