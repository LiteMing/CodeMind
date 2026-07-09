/**
 * @vitest-environment jsdom
 *
 * UX-09 regression: copy/cut → paste must preserve relation edges between
 * nodes inside the copied set (endpoints remapped to the new node ids).
 */
import { describe, it, expect } from 'vitest'
import { copySelectedSubtree, cutSelectedSubtree, pasteCopiedSubtree } from './ops'
import { createDefaultDocument, createNode, findNode } from '../document'
import type { MindMapApp } from '../app'
import type { MindMapDocument, MindNode, RelationEdge } from '../types'

function buildDocWithRelation(): { doc: MindMapDocument; a: MindNode; b: MindNode } {
  const doc = createDefaultDocument()
  const a = createNode({ title: 'A', kind: 'topic', parentId: 'root', position: { x: 100, y: 100 } })
  const b = createNode({ title: 'B', kind: 'topic', parentId: a.id, position: { x: 200, y: 200 } })
  doc.nodes.push(a, b)
  const relation: RelationEdge = {
    id: 'rel-1',
    sourceId: b.id,
    targetId: a.id,
    label: '阻塞',
    arrowDirection: 'forward',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  doc.relations.push(relation)
  return { doc, a, b }
}

/** Minimal stand-in exposing exactly what the clipboard ops touch. */
function fakeApp(doc: MindMapDocument, selectedIds: string[]): MindMapApp {
  const app = {
    state: {
      document: doc,
      selectedNodeId: selectedIds[0] ?? null,
      selectedNodeIds: selectedIds,
      editingNodeId: null,
      connectSourceNodeId: null,
      preferences: { appearance: { layoutMode: 'balanced', childGapX: 220 } },
      status: { key: '' },
    },
    autosaveHandle: null as number | null,
    copiedSubtree: null,
    refs: null,
    historyPast: [],
    historyFuture: [],
    selectedNodeIds: () => [...app.state.selectedNodeIds],
    selectedNode: () => findNode(doc, app.state.selectedNodeId ?? '') ?? null,
    findNode: (id: string) => findNode(app.state.document, id),
    setSelection: (ids: string[], primary: string | null) => {
      app.state.selectedNodeIds = ids
      app.state.selectedNodeId = primary ?? ''
    },
    selectNode: (id: string) => app.setSelection([id], id),
    setStatus: () => {},
    render: () => {},
    showToast: () => {},
    t: (key: string) => key,
    createHistorySnapshot: () => ({}),
    pushHistorySnapshot: () => {},
    clearNodeEditorState: () => {},
  }
  return app as unknown as MindMapApp
}

function clearAutosave(app: MindMapApp): void {
  if (app.autosaveHandle !== null) {
    window.clearTimeout(app.autosaveHandle)
    app.autosaveHandle = null
  }
}

describe('clipboard relations round-trip (UX-09)', () => {
  it('copy → paste rebuilds the relation with remapped endpoints', () => {
    const { doc, a } = buildDocWithRelation()
    const app = fakeApp(doc, [a.id])

    copySelectedSubtree(app)
    expect(app.copiedSubtree?.relations).toHaveLength(1)

    // Paste under root
    app.setSelection(['root'], 'root')
    pasteCopiedSubtree(app)
    clearAutosave(app)

    // Original relation plus the pasted copy
    expect(doc.relations).toHaveLength(2)
    const pasted = doc.relations[1]
    expect(pasted.id).not.toBe('rel-1')
    expect(pasted.label).toBe('阻塞')
    expect(pasted.arrowDirection).toBe('forward')
    // Endpoints must be NEW node ids that exist in the document
    expect(pasted.sourceId).not.toBe(doc.relations[0].sourceId)
    expect(findNode(doc, pasted.sourceId)).toBeDefined()
    expect(findNode(doc, pasted.targetId)).toBeDefined()
  })

  it('cut → paste preserves the relation (previously lost entirely)', () => {
    const { doc, a } = buildDocWithRelation()
    const app = fakeApp(doc, [a.id])

    cutSelectedSubtree(app)
    clearAutosave(app)
    expect(doc.relations).toHaveLength(0)
    expect(app.copiedSubtree?.relations).toHaveLength(1)

    app.setSelection(['root'], 'root')
    pasteCopiedSubtree(app)
    clearAutosave(app)

    expect(doc.relations).toHaveLength(1)
    const rel = doc.relations[0]
    expect(findNode(doc, rel.sourceId)).toBeDefined()
    expect(findNode(doc, rel.targetId)).toBeDefined()
    expect(rel.sourceId).not.toBe(rel.targetId)
  })

  it('drops relations whose endpoints were not copied', () => {
    const { doc, a, b } = buildDocWithRelation()
    // Select only B's subtree — relation target A is outside the copied set
    const app = fakeApp(doc, [b.id])
    void a

    copySelectedSubtree(app)
    expect(app.copiedSubtree?.relations ?? []).toHaveLength(0)

    app.setSelection(['root'], 'root')
    pasteCopiedSubtree(app)
    clearAutosave(app)
    // Only the original relation remains; nothing dangling was created
    expect(doc.relations).toHaveLength(1)
    for (const rel of doc.relations) {
      expect(findNode(doc, rel.sourceId)).toBeDefined()
      expect(findNode(doc, rel.targetId)).toBeDefined()
    }
  })
})
