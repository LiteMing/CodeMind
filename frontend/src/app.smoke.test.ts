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

  it('keeps rapid collapse/expand toggles consistent without flicker-prone timer double-fires', async () => {
    const { createApp } = await import('./app')
    await createApp(root)
    await flush()

    root.querySelector<HTMLElement>('[data-command="create-map"]')!.click()
    await flush()
    pressKey('Tab')
    await flush()
    pressKey('Escape')
    await flush()

    const childId = nodeElements(root).find((el) => el.dataset.nodeId !== 'root')?.dataset.nodeId
    expect(childId, 'a child node should exist').toBeTruthy()
    const childEl = () => root.querySelector<HTMLElement>(`[data-node-id="${childId}"]`)
    const clickCollapse = (): void => {
      const button = root.querySelector<HTMLElement>('[data-node-collapse-button="root"]')
      expect(button, 'root collapse button should be rendered').toBeTruthy()
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    }

    vi.useFakeTimers()
    try {
      // 1st click: collapse starts — the child fades out via a state-driven
      // class while the actual state flip is deferred past the animation.
      clickCollapse()
      expect(childEl(), 'child stays in DOM during collapse animation').toBeTruthy()
      expect(childEl()!.classList.contains('node-collapsing')).toBe(true)

      // 2nd click 120ms later, inside the old double-fire window: must settle
      // the collapse and start one clean expand.
      await vi.advanceTimersByTimeAsync(120)
      clickCollapse()
      expect(childEl(), 'child is visible again right after the re-toggle').toBeTruthy()
      expect(childEl()!.classList.contains('node-expanding')).toBe(true)
      expect(childEl()!.classList.contains('node-collapsing')).toBe(false)

      // t≈420ms: the old code's first deferred toggle fired around here and
      // hid the child (before the second toggle popped it back at full
      // opacity — the reported flicker). It must stay visible now.
      await vi.advanceTimersByTimeAsync(300)
      expect(childEl(), 'child must not blink out after the re-toggle').toBeTruthy()
      expect(childEl()!.classList.contains('node-collapsing')).toBe(false)

      // All timers drained: still expanded and every animation class cleaned.
      await vi.advanceTimersByTimeAsync(2000)
      expect(childEl()).toBeTruthy()
      expect(root.querySelector('.node-collapsing, .node-expanding')).toBeNull()

      // A further single click still performs a normal, clean collapse.
      clickCollapse()
      await vi.advanceTimersByTimeAsync(2000)
      expect(childEl(), 'child hidden after the final collapse').toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders a yellow note badge and pops the Inspector note card open on click', async () => {
    const { createApp } = await import('./app')
    await createApp(root)
    await flush()

    root.querySelector<HTMLElement>('[data-command="create-map"]')!.click()
    await flush()

    // No badge until the node has a note.
    expect(root.querySelector('[data-node-note-badge="root"]')).toBeNull()

    // Open the (default-collapsed) inspector and write a note for root.
    root.querySelector<HTMLElement>('[data-command="toggle-inspector"]')!.click()
    await flush()
    const noteInput = root.querySelector<HTMLTextAreaElement>('[data-node-note="root"]')
    expect(noteInput, 'inspector note input should be rendered').toBeTruthy()
    noteInput!.value = '这是根节点的注释'
    noteInput!.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()

    const badge = root.querySelector<HTMLElement>('[data-node-note-badge="root"]')
    expect(badge, 'note badge should render for a node with a note').toBeTruthy()

    // Collapse the "current node" section so the badge click has a card to pop open.
    root.querySelector<HTMLElement>('[data-command="toggle-inspector-section:node"]')!.click()
    await flush()
    expect(root.querySelector('[data-node-note="root"]')!.closest('.section-collapsed')).toBeTruthy()

    badge!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    // The click lands while the inspector's slide-in animation is still
    // "in flight" (jsdom never fires animationend, so the 300ms safety
    // timeout clears it) — openNodeNoteEditor retries until it settles,
    // then focuses on the next animation frame. Wait past the whole window.
    await new Promise((resolve) => setTimeout(resolve, 600))
    await flush()

    const reopenedInput = root.querySelector<HTMLTextAreaElement>('[data-node-note="root"]')
    expect(reopenedInput, 'note input should be rendered after the badge click').toBeTruthy()
    expect(reopenedInput!.closest('.section-expanded'), 'note card should be expanded').toBeTruthy()
    expect(document.activeElement, 'note input should be focused').toBe(reopenedInput)
  })
})
