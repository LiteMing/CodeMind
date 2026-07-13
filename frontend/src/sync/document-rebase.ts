import type { MindMapDocument, MindNode } from '../types'
import { cloneDocument } from '../utils'

const MERGEABLE_NODE_FIELDS = [
  'title',
  'note',
  'priority',
  'color',
  'bindings',
  'collapsed',
  'width',
  'height',
] as const satisfies readonly (keyof MindNode)[]

const STRUCTURAL_NODE_FIELDS = [
  'parentId',
  'kind',
  'order',
  'position',
  'createdAt',
] as const satisfies readonly (keyof MindNode)[]

export function rebaseDocument(
  baseDocument: MindMapDocument,
  localDocument: MindMapDocument,
  remoteDocument: MindMapDocument,
): MindMapDocument | null {
  if (
    baseDocument.id !== localDocument.id ||
    baseDocument.id !== remoteDocument.id ||
    localDocument.meta.version !== baseDocument.meta.version ||
    remoteDocument.meta.version !== baseDocument.meta.version ||
    !sameValue(localDocument.relations, baseDocument.relations) ||
    !sameValue(remoteDocument.relations, baseDocument.relations) ||
    !sameValue(localDocument.regions, baseDocument.regions) ||
    !sameValue(remoteDocument.regions, baseDocument.regions)
  ) {
    return null
  }

  const merged = cloneDocument(remoteDocument)
  const mergedTitle = mergeField(baseDocument.title, localDocument.title, remoteDocument.title)
  const mergedTheme = mergeField(baseDocument.theme, localDocument.theme, remoteDocument.theme)
  if (!mergedTitle.ok || !mergedTheme.ok) {
    return null
  }
  merged.title = mergedTitle.value
  merged.theme = mergedTheme.value

  const baseNodes = indexNodes(baseDocument.nodes)
  const localNodes = indexNodes(localDocument.nodes)
  const remoteNodes = indexNodes(remoteDocument.nodes)
  if (!baseNodes || !localNodes || !remoteNodes) {
    return null
  }

  for (const [nodeId, baseNode] of baseNodes) {
    const localNode = localNodes.get(nodeId)
    const remoteNode = remoteNodes.get(nodeId)
    if (
      !localNode ||
      !remoteNode ||
      hasStructuralNodeChange(baseNode, localNode) ||
      hasStructuralNodeChange(baseNode, remoteNode)
    ) {
      return null
    }

    const mergedNode = merged.nodes.find((node) => node.id === nodeId)
    if (!mergedNode || !mergeExistingNode(baseNode, localNode, remoteNode, mergedNode)) {
      return null
    }
  }

  const localAdditions = localDocument.nodes.filter((node) => !baseNodes.has(node.id))
  const remoteAdditions = remoteDocument.nodes.filter((node) => !baseNodes.has(node.id))
  if (!canMergeAdditions(baseDocument, localAdditions, remoteAdditions)) {
    return null
  }

  merged.nodes.push(...localAdditions.map(cloneNode))
  return merged
}

function mergeExistingNode(base: MindNode, local: MindNode, remote: MindNode, merged: MindNode): boolean {
  let localChanged = false
  let remoteChanged = false
  for (const field of MERGEABLE_NODE_FIELDS) {
    const result = mergeField(base[field], local[field], remote[field])
    if (!result.ok) {
      return false
    }
    localChanged ||= !sameValue(local[field], base[field])
    remoteChanged ||= !sameValue(remote[field], base[field])
    assignNodeField(merged, field, result.value)
  }

  if (localChanged && remoteChanged) {
    merged.updatedAt = latestTimestamp(local.updatedAt, remote.updatedAt)
  } else if (localChanged) {
    merged.updatedAt = local.updatedAt
  }
  return true
}

function canMergeAdditions(
  baseDocument: MindMapDocument,
  localAdditions: MindNode[],
  remoteAdditions: MindNode[],
): boolean {
  const localIds = new Set(localAdditions.map((node) => node.id))
  const remoteIds = new Set(remoteAdditions.map((node) => node.id))
  if (localIds.size !== localAdditions.length || remoteIds.size !== remoteAdditions.length) {
    return false
  }
  if ([...localIds].some((nodeId) => remoteIds.has(nodeId))) {
    return false
  }

  const localParents = new Set(localAdditions.map((node) => node.parentId).filter((id): id is string => Boolean(id)))
  const remoteParents = new Set(remoteAdditions.map((node) => node.parentId).filter((id): id is string => Boolean(id)))
  if ([...localParents].some((parentId) => remoteParents.has(parentId))) {
    return false
  }

  return additionsAppendCleanly(baseDocument, localAdditions) && additionsAppendCleanly(baseDocument, remoteAdditions)
}

function additionsAppendCleanly(baseDocument: MindMapDocument, additions: MindNode[]): boolean {
  const baseIds = new Set(baseDocument.nodes.map((node) => node.id))
  const additionIds = new Set(additions.map((node) => node.id))
  const additionsByParent = new Map<string, MindNode[]>()

  for (const node of additions) {
    if (node.kind === 'root' || (!node.parentId && node.order !== 0)) {
      return false
    }
    if (!node.parentId) {
      continue
    }
    if (!baseIds.has(node.parentId) && !additionIds.has(node.parentId)) {
      return false
    }
    const siblings = additionsByParent.get(node.parentId) ?? []
    siblings.push(node)
    additionsByParent.set(node.parentId, siblings)
  }

  for (const [parentId, nodes] of additionsByParent) {
    const baseSiblingCount = baseDocument.nodes.filter((node) => node.parentId === parentId).length
    const expectedStart = baseIds.has(parentId) ? baseSiblingCount + 1 : 1
    const orders = nodes.map((node) => node.order).sort((left, right) => left - right)
    if (orders.some((order, index) => order !== expectedStart + index)) {
      return false
    }
  }
  return true
}

function hasStructuralNodeChange(base: MindNode, candidate: MindNode): boolean {
  return STRUCTURAL_NODE_FIELDS.some((field) => !sameValue(base[field], candidate[field]))
}

function mergeField<T>(base: T, local: T, remote: T): { ok: true; value: T } | { ok: false } {
  const localChanged = !sameValue(local, base)
  const remoteChanged = !sameValue(remote, base)
  if (localChanged && remoteChanged && !sameValue(local, remote)) {
    return { ok: false }
  }
  return { ok: true, value: localChanged ? local : remote }
}

function indexNodes(nodes: MindNode[]): Map<string, MindNode> | null {
  const result = new Map<string, MindNode>()
  for (const node of nodes) {
    if (result.has(node.id)) {
      return null
    }
    result.set(node.id, node)
  }
  return result
}

function assignNodeField<K extends (typeof MERGEABLE_NODE_FIELDS)[number]>(
  node: MindNode,
  field: K,
  value: MindNode[K],
): void {
  Object.assign(node, { [field]: structuredClone(value) })
}

function cloneNode(node: MindNode): MindNode {
  return structuredClone(node)
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function latestTimestamp(left: string, right: string): string {
  return left > right ? left : right
}
