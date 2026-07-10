import { describe, it, expect } from 'vitest'
import {
  childrenOf,
  createDefaultDocument,
  createNode,
  deleteNodeTree,
  deleteRelation,
  descendantIds,
  findNode,
  findRoot,
  nextChildPosition,
  toggleCollapse,
  touchDocument,
  visibleNodeIds,
} from './document'
import type { MindMapDocument, MindNode, RelationEdge } from './types'

// Serialization guardrail: saveMap sends the MindMapDocument object as-is, so
// a JSON round-trip must preserve structure exactly and keep all invariants
// the backend validates (single root, valid parent links, valid relation
// endpoints). This pins the wire format before the app.ts split.

function addChild(doc: MindMapDocument, parentId: string, title: string): MindNode {
  const parent = findNode(doc, parentId)
  if (!parent) throw new Error(`missing parent ${parentId}`)
  const node = createNode({
    title,
    kind: 'topic',
    parentId,
    order: childrenOf(doc, parentId).length + 1,
    position: nextChildPosition(doc, parentId),
  })
  doc.nodes.push(node)
  touchDocument(doc)
  return node
}

function addRelation(doc: MindMapDocument, sourceId: string, targetId: string, label?: string): RelationEdge {
  const now = new Date().toISOString()
  const edge: RelationEdge = {
    id: `rel-${doc.relations.length + 1}`,
    sourceId,
    targetId,
    label,
    createdAt: now,
    updatedAt: now,
  }
  doc.relations.push(edge)
  touchDocument(doc)
  return edge
}

function buildSampleDocument(): MindMapDocument {
  const doc = createDefaultDocument()
  const a = addChild(doc, 'root', '需求区')
  const b = addChild(doc, 'root', '开发区')
  const a1 = addChild(doc, a.id, '素材接线')
  addChild(doc, b.id, 'AI 草稿')
  addRelation(doc, a1.id, b.id, '阻塞')
  return doc
}

function assertInvariants(doc: MindMapDocument): void {
  const roots = doc.nodes.filter((n) => n.kind === 'root')
  expect(roots).toHaveLength(1)
  expect(roots[0].parentId).toBeUndefined()

  const ids = new Set(doc.nodes.map((n) => n.id))
  expect(ids.size).toBe(doc.nodes.length)
  for (const node of doc.nodes) {
    if (node.parentId) {
      expect(ids.has(node.parentId), `node ${node.id} parent ${node.parentId} exists`).toBe(true)
    }
  }
  for (const relation of doc.relations) {
    expect(ids.has(relation.sourceId), `relation ${relation.id} source exists`).toBe(true)
    expect(ids.has(relation.targetId), `relation ${relation.id} target exists`).toBe(true)
    expect(relation.sourceId).not.toBe(relation.targetId)
  }
}

describe('document serialization round-trip', () => {
  it('JSON round-trip preserves the document exactly', () => {
    const doc = buildSampleDocument()
    const restored = JSON.parse(JSON.stringify(doc)) as MindMapDocument
    expect(restored).toEqual(doc)
    assertInvariants(restored)
  })

  it('round-tripped document keeps working with the document helpers', () => {
    const doc = buildSampleDocument()
    const restored = JSON.parse(JSON.stringify(doc)) as MindMapDocument

    expect(findRoot(restored).id).toBe('root')
    expect(childrenOf(restored, 'root')).toHaveLength(2)

    const branch = childrenOf(restored, 'root')[0]
    const before = visibleNodeIds(restored).size
    expect(toggleCollapse(restored, branch.id)).toBe(true)
    const after = visibleNodeIds(restored).size
    expect(after).toBe(before - descendantIds(restored, branch.id).length)
  })

  it('deleteNodeTree removes descendants and dangling relations, invariants hold', () => {
    const doc = buildSampleDocument()
    const branch = childrenOf(doc, 'root')[0]
    const removedIds = [branch.id, ...descendantIds(doc, branch.id)]

    deleteNodeTree(doc, branch.id)

    for (const id of removedIds) {
      expect(findNode(doc, id)).toBeUndefined()
    }
    assertInvariants(doc)
    // The relation pointing at the deleted subtree must not survive.
    for (const relation of doc.relations) {
      expect(removedIds).not.toContain(relation.sourceId)
      expect(removedIds).not.toContain(relation.targetId)
    }
  })

  it('deleteRelation removes only the targeted relation', () => {
    const doc = buildSampleDocument()
    const relation = doc.relations[0]
    expect(deleteRelation(doc, relation.id)).toBe(true)
    expect(doc.relations).toHaveLength(0)
    assertInvariants(doc)
  })
})
