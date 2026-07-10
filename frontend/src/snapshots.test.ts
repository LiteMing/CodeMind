/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultDocument } from './document'
import { listLocalSnapshots, saveLocalSnapshot, type SnapshotMode } from './snapshots'

const MAP_ID = 'snapshot-retention-map'

function saveSnapshot(mode: SnapshotMode, index: number): void {
  vi.setSystemTime(new Date(Date.UTC(2026, 6, 10, 0, 0, index)))
  const document = createDefaultDocument()
  document.id = MAP_ID
  document.title = `Snapshot ${index}`
  saveLocalSnapshot({
    mapId: MAP_ID,
    title: `${mode}-${index}`,
    mapTitle: document.title,
    mode,
    document,
  })
}

describe('local snapshot retention', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
  })

  it('protects the four newest manual snapshots during a high-frequency AI session', () => {
    for (let index = 0; index < 4; index += 1) {
      saveSnapshot('manual', index)
    }
    for (let index = 4; index < 24; index += 1) {
      saveSnapshot('ai', index)
    }

    const snapshots = listLocalSnapshots(MAP_ID)
    expect(snapshots).toHaveLength(14)
    expect(snapshots.filter((snapshot) => snapshot.mode === 'manual').map((snapshot) => snapshot.title)).toEqual([
      'manual-3',
      'manual-2',
      'manual-1',
      'manual-0',
    ])
    expect(snapshots.filter((snapshot) => snapshot.mode === 'ai')).toHaveLength(10)
  })

  it('uses all fourteen slots when no manual snapshots exist', () => {
    for (let index = 0; index < 20; index += 1) {
      saveSnapshot(index % 2 === 0 ? 'auto' : 'ai', index)
    }

    const snapshots = listLocalSnapshots(MAP_ID)
    expect(snapshots).toHaveLength(14)
    expect(snapshots[0].title).toBe('ai-19')
    expect(snapshots.at(-1)?.title).toBe('auto-6')
  })

  it('keeps additional manual snapshots when they are recent enough for shared slots', () => {
    for (let index = 0; index < 8; index += 1) {
      saveSnapshot('manual', index)
    }
    for (let index = 8; index < 14; index += 1) {
      saveSnapshot('ai', index)
    }

    const snapshots = listLocalSnapshots(MAP_ID)
    expect(snapshots).toHaveLength(14)
    expect(snapshots.filter((snapshot) => snapshot.mode === 'manual')).toHaveLength(8)
  })
})
