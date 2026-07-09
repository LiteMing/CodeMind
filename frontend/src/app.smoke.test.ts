/**
 * @vitest-environment jsdom
 *
 * Interaction smoke guardrail for app.ts ahead of its module split: boots the
 * real MindMapApp against a mocked API and drives the core keyboard flow
 * (create map → Tab child → Enter sibling → undo → delete). If the split
 * breaks state wiring, rendering, or the save payload, these fail first.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createDefaultDocument } from './document'
import type { MindMapDocument } from './types'

const savedDocuments: MindMapDocument[] = []

vi.mock('./api', () => {
  let current: MindMapDocument | null = null
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
  return {
    api: {
      setOwnerApiKey: vi.fn(),
      listMaps: vi.fn(async () =>
        current
          ? [
              {
                id: current.id,
                title: current.title,
                lastEditedAt: current.meta.lastEditedAt,
                lastOpenedAt: current.meta.lastOpenedAt,
              },
            ]
          : [],
      ),
      createMap: vi.fn(async (title: string) => {
        current = { ...createDefaultDocument(), id: 'map-smoke-1' }
        if (title.trim()) {
          current.title = title
          current.nodes[0].title = title
        }
        return clone(current)
      }),
      loadMap: vi.fn(async () => clone(current ?? createDefaultDocument())),
      saveMap: vi.fn(async (document: MindMapDocument) => {
        current = clone(document)
        savedDocuments.push(clone(document))
        return clone(document)
      }),
      renameMap: vi.fn(async () => clone(current ?? createDefaultDocument())),
      deleteMap: vi.fn(async () => undefined),
      exportMarkdown: vi.fn(async () => '# stub'),
      importDocument: vi.fn(async () => clone(createDefaultDocument())),
      importDocumentWithAI: vi.fn(),
      suggestRelations: vi.fn(),
      completeNodeNotes: vi.fn(),
      generateKnowledgeMap: vi.fn(),
      suggestChildren: vi.fn(),
      testAIConnection: vi.fn(),
      getSettings: vi.fn(async () => ({ collabApiKey: '' })),
      saveSettings: vi.fn(async (settings: unknown) => settings),
      pollMap: vi.fn(async () => ({
        lastEditedAt: new Date().toISOString(),
        nodeCount: current?.nodes.length ?? 1,
        modifiedViaAPI: false,
      })),
      createShareToken: vi.fn(),
    },
  }
})

function installBrowserStubs(): void {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver
  }
  if (typeof globalThis.requestAnimationFrame === 'undefined') {
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
      setTimeout(() => cb(performance.now()), 0)) as unknown as typeof requestAnimationFrame
    globalThis.cancelAnimationFrame = ((handle: number) => clearTimeout(handle)) as typeof cancelAnimationFrame
  }
  // jsdom has no canvas implementation; the app only uses 2D contexts for
  // text measurement and the minimap, both non-essential to the smoke flow.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    measureText: () => ({ width: 100 }),
    clearRect: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    fill: () => {},
    arc: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    scale: () => {},
    setTransform: () => {},
    fillText: () => {},
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {})
  window.prompt = vi.fn(() => '冒烟测试图')
  window.confirm = vi.fn(() => true)
}

async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

function pressKey(key: string, init: KeyboardEventInit = {}): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
}

function nodeElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-node-id]'))
}

function nodeIds(root: HTMLElement): Set<string> {
  return new Set(nodeElements(root).map((el) => el.dataset.nodeId ?? ''))
}

describe('app interaction smoke', () => {
  let root: HTMLElement

  beforeEach(() => {
    document.body.innerHTML = ''
    savedDocuments.length = 0
    localStorage.clear()
    // Skip the first-run onboarding dialog; it swallows global shortcuts.
    localStorage.setItem('code-mind.preferences', JSON.stringify({ onboardingCompleted: true }))
    installBrowserStubs()
    root = document.createElement('div')
    document.body.appendChild(root)
  })

  it('boots to home, creates a map, and drives the core keyboard flow', async () => {
    const { createApp } = await import('./app')
    await createApp(root)
    await flush()

    // Home view renders with a create-map action.
    const createButton = root.querySelector<HTMLElement>('[data-command="create-map"]')
    expect(createButton, 'home view should offer create-map').toBeTruthy()

    createButton!.click()
    await flush()

    // Workspace shows the root node.
    expect(nodeIds(root).has('root'), 'workspace should render the root node').toBe(true)
    const initialCount = nodeElements(root).length

    // Tab creates a child of the selected (root) node; the new node opens an
    // inline editor, so press Escape to leave editing before the next key.
    pressKey('Tab')
    await flush()
    expect(nodeElements(root).length).toBe(initialCount + 1)
    pressKey('Escape')
    await flush()

    // Enter creates a sibling of the newly selected child.
    pressKey('Enter')
    await flush()
    expect(nodeElements(root).length).toBe(initialCount + 2)
    pressKey('Escape')
    await flush()

    // Ctrl+Z undoes the sibling creation.
    pressKey('z', { ctrlKey: true })
    await flush()
    expect(nodeElements(root).length).toBe(initialCount + 1)

    // Undo restores the snapshot's selection (root, which is not deletable),
    // so click the remaining child to select it, then delete it.
    const child = nodeElements(root).find((el) => el.dataset.nodeId !== 'root')
    expect(child, 'child node should be rendered').toBeTruthy()
    const childButton = root.querySelector<HTMLElement>(`[data-node-button="${child!.dataset.nodeId}"]`)
    expect(childButton, 'child node button should be rendered').toBeTruthy()
    childButton!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flush()
    pressKey('Delete')
    // Deletion is applied after the exit animation (250ms safety timeout).
    await new Promise((resolve) => setTimeout(resolve, 350))
    await flush()
    expect(nodeElements(root).length).toBe(initialCount)
    expect(nodeIds(root).has('root')).toBe(true)
  })

  it('persists a structurally valid document through saveMap', async () => {
    const { createApp } = await import('./app')
    await createApp(root)
    await flush()

    root.querySelector<HTMLElement>('[data-command="create-map"]')!.click()
    await flush()
    pressKey('Tab')
    await flush()
    pressKey('Escape')
    await flush()
    pressKey('s', { ctrlKey: true })
    await flush(12)

    expect(savedDocuments.length, 'saveMap should have been called').toBeGreaterThan(0)
    const doc = savedDocuments[savedDocuments.length - 1]

    // Backend Validate() invariants: exactly one root, valid parent links,
    // unique ids, relations reference existing nodes.
    expect(doc.nodes.filter((n) => n.kind === 'root')).toHaveLength(1)
    const ids = new Set(doc.nodes.map((n) => n.id))
    expect(ids.size).toBe(doc.nodes.length)
    for (const node of doc.nodes) {
      if (node.parentId) {
        expect(ids.has(node.parentId)).toBe(true)
      }
      expect(node.title.trim().length).toBeGreaterThan(0)
    }
    for (const relation of doc.relations) {
      expect(ids.has(relation.sourceId)).toBe(true)
      expect(ids.has(relation.targetId)).toBe(true)
    }
    // The Tab-created child must be part of the saved payload.
    expect(doc.nodes.length).toBeGreaterThanOrEqual(2)
  })
})
