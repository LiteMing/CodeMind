import type { MindMapDocument } from './types'

// 'ai' snapshots are captured automatically right before an AI write lands —
// the rollback guarantee ("AI 操作必须可评审可回滚") — and are rendered with a
// distinct badge in the snapshot list.
export type SnapshotMode = 'manual' | 'auto' | 'ai'

export interface LocalSnapshotSummary {
  id: string
  title: string
  mapTitle: string
  mode: SnapshotMode
  createdAt: string
  nodeCount: number
}

interface StoredSnapshot extends LocalSnapshotSummary {
  document: MindMapDocument
}

const STORAGE_PREFIX = 'code-mind.snapshots'
const MAX_SNAPSHOTS_PER_MAP = 14
const MIN_MANUAL_SNAPSHOTS_TO_KEEP = 4

export function listLocalSnapshots(mapId: string): LocalSnapshotSummary[] {
  return readSnapshots(mapId).map((snapshot) => ({
    id: snapshot.id,
    title: snapshot.title,
    mapTitle: snapshot.mapTitle,
    mode: snapshot.mode,
    createdAt: snapshot.createdAt,
    nodeCount: snapshot.nodeCount,
  }))
}

export function loadLocalSnapshot(mapId: string, snapshotId: string): MindMapDocument | null {
  const snapshot = readSnapshots(mapId).find((entry) => entry.id === snapshotId)
  return snapshot ? cloneDocument(snapshot.document) : null
}

export function saveLocalSnapshot(input: {
  mapId: string
  title: string
  mapTitle: string
  mode: SnapshotMode
  document: MindMapDocument
}): LocalSnapshotSummary[] {
  const snapshots = readSnapshots(input.mapId)
  const mapTitle = input.mapTitle.trim() || input.document.title.trim() || 'Untitled Map'
  const nextSnapshot: StoredSnapshot = {
    id: createSnapshotID(),
    title: input.title.trim() || mapTitle,
    mapTitle,
    mode: input.mode,
    createdAt: new Date().toISOString(),
    nodeCount: input.document.nodes.length,
    document: cloneDocument(input.document),
  }

  const nextSnapshots = trimSnapshots([nextSnapshot, ...snapshots])
  window.localStorage.setItem(storageKey(input.mapId), JSON.stringify(nextSnapshots))
  return nextSnapshots.map((snapshot) => ({
    id: snapshot.id,
    title: snapshot.title,
    mapTitle: snapshot.mapTitle,
    mode: snapshot.mode,
    createdAt: snapshot.createdAt,
    nodeCount: snapshot.nodeCount,
  }))
}

function readSnapshots(mapId: string): StoredSnapshot[] {
  const raw = window.localStorage.getItem(storageKey(mapId))
  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredSnapshot>[]
    const snapshots = parsed
      .filter((entry) => {
        return (
          typeof entry?.id === 'string' &&
          typeof entry?.title === 'string' &&
          (entry?.mode === 'manual' || entry?.mode === 'auto' || entry?.mode === 'ai') &&
          typeof entry?.createdAt === 'string' &&
          typeof entry?.nodeCount === 'number' &&
          Boolean(entry?.document && typeof entry.document === 'object')
        )
      })
      .map((entry) => ({
        id: entry.id as string,
        title: (entry.title as string).trim() || 'Untitled Snapshot',
        mapTitle:
          typeof entry.mapTitle === 'string' && entry.mapTitle.trim()
            ? entry.mapTitle.trim()
            : (entry.title as string).trim() || 'Untitled Map',
        mode: entry.mode as SnapshotMode,
        createdAt: entry.createdAt as string,
        nodeCount: entry.nodeCount as number,
        document: cloneDocument(entry.document as MindMapDocument),
      }))
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    return trimSnapshots(snapshots)
  } catch {
    return []
  }
}

function trimSnapshots(snapshots: StoredSnapshot[]): StoredSnapshot[] {
  const sorted = [...snapshots].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
  const protectedManualIds = new Set(
    sorted
      .filter((snapshot) => snapshot.mode === 'manual')
      .slice(0, MIN_MANUAL_SNAPSHOTS_TO_KEEP)
      .map((snapshot) => snapshot.id),
  )
  const remainingSlots = MAX_SNAPSHOTS_PER_MAP - protectedManualIds.size
  const retained = [
    ...sorted.filter((snapshot) => protectedManualIds.has(snapshot.id)),
    ...sorted.filter((snapshot) => !protectedManualIds.has(snapshot.id)).slice(0, remainingSlots),
  ]
  return retained.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
}

function storageKey(mapId: string): string {
  return `${STORAGE_PREFIX}.${mapId}`
}

function createSnapshotID(): string {
  return `snapshot-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`
}

function cloneDocument(document: MindMapDocument): MindMapDocument {
  return JSON.parse(JSON.stringify(document)) as MindMapDocument
}
