import { estimateNodeHeight, estimateNodeWidth, resolveNodeMinHeight, resolveNodeMinWidth } from './node-sizing'
import type { LayoutMode, MindMapDocument, MindNode, NodeBinding, Position, RelationEdge } from './types'

const ROOT_POSITION: Position = { x: 820, y: 320 }
const DEFAULT_CHILD_GAP_X = 220
const NODE_GAP_Y = 96
const COMPACT_NODE_GAP_Y = 18
const PLACEMENT_PADDING_X = 28
const PLACEMENT_PADDING_Y = 8
const PLACEMENT_SEARCH_STEPS = 40
const PLACEMENT_SCAN_STEP_Y = 14

export function createDefaultDocument(): MindMapDocument {
  const now = new Date().toISOString()
  return {
    id: 'default',
    title: 'New Mind Map',
    theme: 'dark',
    nodes: [
      {
        id: 'root',
        kind: 'root',
        order: 0,
        title: 'New Mind Map',
        bindings: [],
        position: ROOT_POSITION,
        createdAt: now,
        updatedAt: now,
      },
    ],
    relations: [],
    regions: [],
    meta: {
      version: 1,
      revision: 1,
      lastEditedAt: now,
      lastOpenedAt: now,
    },
  }
}

export function createNode(input: {
  title: string
  position: Position
  kind: MindNode['kind']
  parentId?: string
  order: number
  color?: MindNode['color']
  bindings?: NodeBinding[]
}): MindNode {
  const now = new Date().toISOString()
  return {
    id: createId('node'),
    title: input.title,
    kind: input.kind,
    parentId: input.parentId,
    order: input.parentId ? input.order : 0,
    color: input.color,
    bindings: input.bindings?.map((binding) => ({ ...binding })) ?? [],
    position: input.position,
    createdAt: now,
    updatedAt: now,
  }
}

export function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`
}

export function findRoot(document: MindMapDocument): MindNode {
  return document.nodes.find((node) => node.kind === 'root') ?? document.nodes[0]
}

export function findNode(document: MindMapDocument, nodeId: string): MindNode | undefined {
  return document.nodes.find((node) => node.id === nodeId)
}

export function childrenOf(document: MindMapDocument, parentId: string): MindNode[] {
  return document.nodes
    .filter((node) => node.parentId === parentId)
    .sort((left, right) => {
      if (left.order > 0 && right.order > 0 && left.order !== right.order) {
        return left.order - right.order
      }
      if (left.position.y !== right.position.y) {
        return left.position.y - right.position.y
      }
      if (left.position.x !== right.position.x) {
        return left.position.x - right.position.x
      }
      return left.id.localeCompare(right.id)
    })
}

export function nextSiblingOrder(document: MindMapDocument, parentId?: string): number {
  return parentId ? childrenOf(document, parentId).length + 1 : 0
}

export function normalizeDocumentSemantics(document: MindMapDocument): MindMapDocument {
  for (const node of document.nodes) {
    node.bindings = Array.isArray(node.bindings) ? node.bindings.map((binding) => ({ ...binding })) : []
    if (!node.parentId) {
      node.order = 0
    }
  }

  const parentIds = new Set(
    document.nodes.map((node) => node.parentId).filter((parentId): parentId is string => Boolean(parentId)),
  )
  for (const parentId of parentIds) {
    normalizeLegacySiblingGroup(document, parentId)
  }
  return document
}

export function normalizeSiblingOrders(document: MindMapDocument, parentId: string): void {
  childrenOf(document, parentId).forEach((node, index) => {
    node.order = index + 1
  })
}

export function normalizeAllSiblingOrders(document: MindMapDocument): void {
  const parentIds = new Set<string>()
  for (const node of document.nodes) {
    if (!node.parentId) {
      node.order = 0
      continue
    }
    parentIds.add(node.parentId)
  }
  for (const parentId of parentIds) {
    normalizeSiblingOrders(document, parentId)
  }
}

export function setNodeParent(
  document: MindMapDocument,
  nodeId: string,
  parentId?: string,
  targetOrder?: number,
): boolean {
  const node = findNode(document, nodeId)
  if (!node) {
    return false
  }

  const normalizedParentId = parentId?.trim() || undefined
  const previousParentId = node.parentId
  if (previousParentId === normalizedParentId && targetOrder === undefined) {
    node.order = normalizedParentId ? node.order : 0
    return false
  }

  const destination = normalizedParentId
    ? childrenOf(document, normalizedParentId).filter((candidate) => candidate.id !== node.id)
    : []
  node.parentId = normalizedParentId
  node.order = normalizedParentId ? 1 : 0

  if (previousParentId && previousParentId !== normalizedParentId) {
    normalizeSiblingOrders(document, previousParentId)
  }
  if (normalizedParentId) {
    const insertionIndex =
      targetOrder === undefined
        ? destination.length
        : Math.max(0, Math.min(destination.length, Math.trunc(targetOrder) - 1))
    destination.splice(insertionIndex, 0, node)
    destination.forEach((sibling, index) => {
      sibling.order = index + 1
    })
  }
  return previousParentId !== normalizedParentId || targetOrder !== undefined
}

export function deleteNodesPromotingChildren(document: MindMapDocument, nodeIds: Set<string>): number {
  const root = findRoot(document)
  const removeIds = new Set(
    [...nodeIds].filter((nodeId) => {
      const node = findNode(document, nodeId)
      return Boolean(node && node.id !== root.id)
    }),
  )
  if (removeIds.size === 0) {
    return 0
  }

  const childrenByParent = new Map<string, MindNode[]>()
  for (const node of document.nodes) {
    if (node.parentId) {
      childrenByParent.set(node.parentId, childrenOf(document, node.parentId))
    }
  }
  const expand = (node: MindNode): MindNode[] => {
    if (!removeIds.has(node.id)) {
      return [node]
    }
    return (childrenByParent.get(node.id) ?? []).flatMap(expand)
  }

  const affectedParentIds = new Set<string | undefined>()
  for (const nodeId of removeIds) {
    const node = findNode(document, nodeId)
    if (node && (!node.parentId || !removeIds.has(node.parentId))) {
      affectedParentIds.add(node.parentId)
    }
  }
  for (const parentId of affectedParentIds) {
    const siblings = parentId
      ? childrenOf(document, parentId)
      : document.nodes.filter((node) => !node.parentId && node.id !== root.id).sort(compareNodesByPosition)
    const replacements = siblings.flatMap(expand)
    replacements.forEach((node, index) => {
      node.parentId = parentId
      node.order = parentId ? index + 1 : 0
      if (!parentId) {
        node.kind = 'floating'
      }
    })
  }

  document.nodes = document.nodes.filter((node) => !removeIds.has(node.id))
  normalizeAllSiblingOrders(document)
  return removeIds.size
}

function normalizeLegacySiblingGroup(document: MindMapDocument, parentId: string): void {
  const siblings = document.nodes.filter((node) => node.parentId === parentId)
  const allPositiveOrders = siblings.every((node) => Number.isSafeInteger(node.order) && node.order > 0)
  const uniquePositiveOrders = new Set(siblings.map((node) => node.order))
  if (allPositiveOrders && uniquePositiveOrders.size === siblings.length) {
    siblings
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
      .forEach((node, index) => {
        node.order = index + 1
      })
    return
  }

  const orderCounts = new Map<number, number>()
  for (const node of siblings) {
    if (Number.isSafeInteger(node.order) && node.order > 0 && node.order <= siblings.length) {
      orderCounts.set(node.order, (orderCounts.get(node.order) ?? 0) + 1)
    }
  }

  const reserved = new Map<number, MindNode>()
  const missing: MindNode[] = []
  for (const node of siblings) {
    if (orderCounts.get(node.order) === 1) {
      reserved.set(node.order, node)
    } else {
      missing.push(node)
    }
  }
  missing.sort(compareNodesByPosition)

  let missingIndex = 0
  for (let order = 1; order <= siblings.length; order += 1) {
    const node = reserved.get(order) ?? missing[missingIndex++]
    node.order = order
  }
}

function compareNodesByPosition(left: MindNode, right: MindNode): number {
  return left.position.y - right.position.y || left.position.x - right.position.x || left.id.localeCompare(right.id)
}

export function connectedRelations(document: MindMapDocument, nodeId: string): RelationEdge[] {
  return document.relations.filter((relation) => {
    if (relation.sourceId === nodeId || relation.targetId === nodeId) {
      return true
    }
    return (relation.branches ?? []).some((branch) => branch.targetId === nodeId)
  })
}

export function descendantIds(document: MindMapDocument, nodeId: string): string[] {
  const descendants: string[] = []
  const visited = new Set<string>([nodeId])
  const queue = [nodeId]

  while (queue.length > 0) {
    const currentId = queue.shift()
    if (!currentId) {
      continue
    }

    for (const child of childrenOf(document, currentId)) {
      if (visited.has(child.id)) {
        continue // Prevent infinite loop on circular references
      }
      visited.add(child.id)
      descendants.push(child.id)
      queue.push(child.id)
    }
  }

  return descendants
}

export function hiddenDescendantCount(document: MindMapDocument, nodeId: string): number {
  const node = findNode(document, nodeId)
  if (!node?.collapsed) {
    return 0
  }
  return descendantIds(document, nodeId).length
}

export function visibleNodeIds(document: MindMapDocument): Set<string> {
  const nodeMap = new Map(document.nodes.map((node) => [node.id, node]))
  const visible = new Set<string>()

  for (const node of document.nodes) {
    let current: MindNode | undefined = node
    let hidden = false
    const visited = new Set<string>()

    while (current?.parentId) {
      if (visited.has(current.id)) {
        break // Prevent infinite loop on circular references
      }
      visited.add(current.id)
      const parent = nodeMap.get(current.parentId)
      if (!parent) {
        break
      }
      if (parent.collapsed) {
        hidden = true
        break
      }
      current = parent
    }

    if (!hidden) {
      visible.add(node.id)
    }
  }

  return visible
}

export function nextChildPosition(
  document: MindMapDocument,
  parentId: string,
  layoutMode: LayoutMode = 'balanced',
  childGapX = DEFAULT_CHILD_GAP_X,
): Position {
  const parent = findNode(document, parentId)
  if (!parent) {
    return ROOT_POSITION
  }

  const children = childrenOf(document, parentId)
  const direction =
    parent.kind === 'root'
      ? preferredRootChildDirection(document, children, layoutMode)
      : branchDirection(document, parent)
  const laneChildren =
    parent.kind === 'root' && layoutMode === 'right'
      ? children
      : parent.kind === 'root'
        ? children.filter((child) => branchDirection(document, child) === direction)
        : children
  const targetX = resolveChildColumn(document, parent, laneChildren, direction, childGapX)
  const targetY = nextStackedY(document, laneChildren, 'topic', parent.position.y)
  return findAvailablePosition(document, { x: targetX, y: targetY }, 'topic')
}

export function nextSiblingPosition(
  document: MindMapDocument,
  node: MindNode,
  layoutMode: LayoutMode = 'balanced',
  childGapX = DEFAULT_CHILD_GAP_X,
): Position {
  if (!node.parentId) {
    return nextFloatingPosition(document)
  }

  const parent = findNode(document, node.parentId)
  if (parent?.kind === 'root') {
    return nextChildPosition(document, parent.id, layoutMode, childGapX)
  }

  const siblings = childrenOf(document, node.parentId)
  return findAvailablePosition(
    document,
    {
      x: node.position.x,
      y: nextStackedY(
        document,
        siblings,
        node.kind === 'floating' ? 'floating' : 'topic',
        node.position.y + NODE_GAP_Y,
      ),
    },
    node.kind === 'floating' ? 'floating' : 'topic',
  )
}

export function nextFloatingPosition(document: MindMapDocument): Position {
  const floatingNodes = document.nodes
    .filter((node) => node.kind === 'floating')
    .sort((left, right) => left.position.y - right.position.y)

  if (floatingNodes.length === 0) {
    const root = findRoot(document)
    return findAvailablePosition(document, { x: root.position.x - 140, y: root.position.y + 180 }, 'floating')
  }

  const lastFloatingNode = floatingNodes[floatingNodes.length - 1]
  return findAvailablePosition(
    document,
    {
      x: lastFloatingNode.position.x + 36,
      y: nextStackedY(document, floatingNodes, 'floating', lastFloatingNode.position.y + NODE_GAP_Y),
    },
    'floating',
  )
}

function branchDirection(document: MindMapDocument, node: MindNode): -1 | 1 {
  if (node.parentId) {
    const parent = findNode(document, node.parentId)
    if (parent) {
      return node.position.x < parent.position.x ? -1 : 1
    }
  }

  const root = findRoot(document)
  return node.position.x < root.position.x ? -1 : 1
}

function preferredRootChildDirection(document: MindMapDocument, children: MindNode[], layoutMode: LayoutMode): -1 | 1 {
  if (layoutMode === 'right') {
    return 1
  }

  if (children.length === 0) {
    return 1
  }

  const root = findRoot(document)
  const leftCount = children.filter((child) => child.position.x < root.position.x).length
  const rightCount = children.length - leftCount
  if (leftCount < rightCount) {
    return -1
  }
  if (rightCount < leftCount) {
    return 1
  }

  const lastChild = children[children.length - 1]
  return lastChild.position.x < root.position.x ? 1 : -1
}

function resolveChildColumn(
  document: MindMapDocument,
  parent: MindNode,
  children: MindNode[],
  direction: -1 | 1,
  childGapX: number,
): number {
  const parentColumnEdge = resolveRelativeChildColumnEdge(document, parent, direction, childGapX)
  if (children.length === 0) {
    return resolveAlignedChildCenter(parentColumnEdge, direction, defaultNodeWidth('topic'))
  }

  if (direction === 1) {
    const leftColumn = Math.max(
      parentColumnEdge,
      ...children.map(
        (child) => child.position.x - estimateNodeWidth(child, childrenOf(document, child.id).length) / 2,
      ),
    )
    return resolveAlignedChildCenter(leftColumn, direction, defaultNodeWidth('topic'))
  }

  const rightColumn = Math.min(
    parentColumnEdge,
    ...children.map((child) => child.position.x + estimateNodeWidth(child, childrenOf(document, child.id).length) / 2),
  )
  return resolveAlignedChildCenter(rightColumn, direction, defaultNodeWidth('topic'))
}

function nextStackedY(document: MindMapDocument, nodes: MindNode[], kind: MindNode['kind'], fallbackY: number): number {
  if (nodes.length === 0) {
    return fallbackY
  }

  const lowestBottom = nodes.reduce((maxBottom, node) => {
    const childCount = childrenOf(document, node.id).length
    return Math.max(maxBottom, node.position.y + estimateNodeHeight(node, childCount) / 2)
  }, Number.NEGATIVE_INFINITY)

  return Math.round(lowestBottom + COMPACT_NODE_GAP_Y + defaultNodeHeight(kind) / 2)
}

function findAvailablePosition(document: MindMapDocument, preferred: Position, kind: MindNode['kind']): Position {
  for (let step = 0; step <= PLACEMENT_SEARCH_STEPS; step += 1) {
    const candidate = {
      x: preferred.x,
      y: Math.round(preferred.y + step * PLACEMENT_SCAN_STEP_Y),
    }
    if (!positionCollides(document, candidate, kind)) {
      return candidate
    }
  }

  return {
    x: preferred.x,
    y: preferred.y + (PLACEMENT_SEARCH_STEPS + 1) * NODE_GAP_Y,
  }
}

function positionCollides(document: MindMapDocument, position: Position, kind: MindNode['kind']): boolean {
  const candidateBounds = nodeBounds({
    kind,
    width: defaultNodeWidth(kind),
    height: defaultNodeHeight(kind),
    position,
  })

  return document.nodes.some((node) => {
    const existingBounds = nodeBounds({
      kind: node.kind,
      width: estimateNodeWidth(node, childrenOf(document, node.id).length),
      height: estimateNodeHeight(node, childrenOf(document, node.id).length),
      position: node.position,
    })

    return !(
      candidateBounds.right < existingBounds.left ||
      candidateBounds.left > existingBounds.right ||
      candidateBounds.bottom < existingBounds.top ||
      candidateBounds.top > existingBounds.bottom
    )
  })
}

function nodeBounds(input: { kind: MindNode['kind']; width: number; height: number; position: Position }): {
  left: number
  right: number
  top: number
  bottom: number
} {
  const width = Math.max(input.width, defaultNodeWidth(input.kind))
  const height = Math.max(input.height, defaultNodeHeight(input.kind))

  return {
    left: input.position.x - width / 2 - PLACEMENT_PADDING_X,
    right: input.position.x + width / 2 + PLACEMENT_PADDING_X,
    top: input.position.y - height / 2 - PLACEMENT_PADDING_Y,
    bottom: input.position.y + height / 2 + PLACEMENT_PADDING_Y,
  }
}

function defaultNodeWidth(kind: MindNode['kind']): number {
  return resolveNodeMinWidth(kind)
}

function defaultNodeHeight(kind: MindNode['kind']): number {
  return resolveNodeMinHeight(kind)
}

function resolveAlignedChildCenter(columnEdge: number, direction: -1 | 1, nodeWidth: number): number {
  return direction === 1 ? Math.round(columnEdge + nodeWidth / 2) : Math.round(columnEdge - nodeWidth / 2)
}

function resolveRelativeChildColumnEdge(
  document: MindMapDocument,
  parent: MindNode,
  direction: -1 | 1,
  childGapX: number,
): number {
  const parentWidth = estimateNodeWidth(parent, childrenOf(document, parent.id).length)
  return direction === 1
    ? parent.position.x + parentWidth / 2 + childGapX
    : parent.position.x - parentWidth / 2 - childGapX
}

export function touchDocument(document: MindMapDocument): void {
  const root = findRoot(document)
  document.title = root.title
  document.meta.lastEditedAt = new Date().toISOString()
}

export function deleteNodeTree(
  document: MindMapDocument,
  nodeId: string,
): { removedNodes: number; removedRelations: number } {
  if (nodeId === 'root') {
    return { removedNodes: 0, removedRelations: 0 }
  }

  const removeIds = new Set<string>([nodeId, ...descendantIds(document, nodeId)])
  const relationCountBefore = document.relations.length
  const nodeCountBefore = document.nodes.length

  document.nodes = document.nodes.filter((node) => !removeIds.has(node.id))
  document.relations = document.relations
    .filter((relation) => !removeIds.has(relation.sourceId) && !removeIds.has(relation.targetId))
    .map((relation) => ({
      ...relation,
      branches: (relation.branches ?? []).filter((branch) => !removeIds.has(branch.targetId)),
    }))
  normalizeAllSiblingOrders(document)

  return {
    removedNodes: nodeCountBefore - document.nodes.length,
    removedRelations: relationCountBefore - document.relations.length,
  }
}

export function updateRelationLabel(document: MindMapDocument, relationId: string, label: string): void {
  const relation = document.relations.find((item) => item.id === relationId)
  if (!relation) {
    return
  }

  relation.label = label.trim()
  relation.updatedAt = new Date().toISOString()
}

export function deleteRelation(document: MindMapDocument, relationId: string): boolean {
  const before = document.relations.length
  document.relations = document.relations.filter((relation) => relation.id !== relationId)
  return document.relations.length < before
}

export function toggleCollapse(document: MindMapDocument, nodeId: string): boolean {
  const node = findNode(document, nodeId)
  if (!node) {
    return false
  }

  if (childrenOf(document, nodeId).length === 0) {
    return false
  }

  node.collapsed = !node.collapsed
  node.updatedAt = new Date().toISOString()
  return true
}

export function tidySubtree(document: MindMapDocument, parentNodeId: string, childGapX = DEFAULT_CHILD_GAP_X): number {
  const parent = findNode(document, parentNodeId)
  if (!parent) {
    return 0
  }

  const children = branchChildren(document, parent)
  if (children.length === 0) {
    return 0
  }

  const side = parent.kind === 'root' ? 1 : (branchDirection(document, parent) as -1 | 1)
  const moved = new Set<string>()
  layoutGroup(document, parent, children, side, childGapX, moved)
  return moved.size
}

export function autoLayoutHierarchy(
  document: MindMapDocument,
  layoutMode: LayoutMode = 'balanced',
  childGapX = DEFAULT_CHILD_GAP_X,
): number {
  const root = findRoot(document)
  root.position = { ...ROOT_POSITION }
  root.updatedAt = new Date().toISOString()

  const rootChildren = childrenOf(document, root.id)
  if (rootChildren.length === 0) {
    return 1
  }

  const moved = new Set<string>(['root'])
  if (layoutMode === 'right') {
    layoutGroup(document, root, rootChildren, 1, childGapX, moved)
    return moved.size
  }

  let leftRoots = rootChildren.filter((node) => node.position.x < root.position.x)
  let rightRoots = rootChildren.filter((node) => node.position.x >= root.position.x)
  if (leftRoots.length === 0 || rightRoots.length === 0) {
    leftRoots = []
    rightRoots = []
    rootChildren.forEach((node, index) => {
      if (index % 2 === 0) {
        rightRoots.push(node)
      } else {
        leftRoots.push(node)
      }
    })
  }

  layoutGroup(document, root, leftRoots, -1, childGapX, moved)
  layoutGroup(document, root, rightRoots, 1, childGapX, moved)
  return moved.size
}

function layoutGroup(
  document: MindMapDocument,
  root: MindNode,
  nodes: MindNode[],
  side: -1 | 1,
  childGapX: number,
  moved: Set<string>,
): void {
  if (nodes.length === 0) {
    return
  }

  const extents = nodes.map((node) => branchExtent(document, node.id))
  const total = extents.reduce((sum, value) => sum + value, 0)
  let cursorY = root.position.y - total / 2

  nodes.forEach((node, index) => {
    layoutBranch(document, root, node.id, side, cursorY, extents[index], childGapX, moved)
    cursorY += extents[index]
  })
}

function layoutBranch(
  document: MindMapDocument,
  parent: MindNode,
  nodeId: string,
  side: -1 | 1,
  topY: number,
  extent: number,
  childGapX: number,
  moved: Set<string>,
): void {
  const node = findNode(document, nodeId)
  if (!node) {
    return
  }

  const columnEdge = resolveRelativeChildColumnEdge(document, parent, side, childGapX)
  const nodeWidth = estimateNodeWidth(node, childrenOf(document, node.id).length)
  node.position = {
    x: resolveAlignedChildCenter(columnEdge, side, nodeWidth),
    y: topY + extent / 2,
  }
  node.updatedAt = new Date().toISOString()
  moved.add(node.id)

  const children = branchChildren(document, node)
  if (children.length === 0) {
    return
  }

  const childExtents = children.map((child) => branchExtent(document, child.id))
  const childSum = childExtents.reduce((sum, value) => sum + value, 0)
  // Center the children block within this branch's band (the band may be
  // taller than the children when the node itself is tall).
  let childCursorY = topY + (extent - childSum) / 2
  children.forEach((child, index) => {
    layoutBranch(document, node, child.id, side, childCursorY, childExtents[index], childGapX, moved)
    childCursorY += childExtents[index]
  })
}

/** Vertical breathing room added around each node's actual height. A typical
 * single-line node (~56px) lands on the legacy NODE_GAP_Y=96 band, so default
 * density is unchanged; taller (multi-line) nodes get proportionally more
 * space instead of overlapping their siblings (UX-10). */
const BRANCH_VERTICAL_MARGIN = 40

function nodeLayoutHeight(document: MindMapDocument, node: MindNode): number {
  const childCount = childrenOf(document, node.id).length
  const width = node.width ?? estimateNodeWidth(node, childCount)
  return node.height ?? estimateNodeHeight(node, childCount, width)
}

/** Vertical space a branch occupies: its own height (plus margin) or the sum
 * of its children's extents, whichever is larger. Replaces the fixed
 * leaf-count × NODE_GAP_Y weighting that ignored node heights. */
function branchExtent(document: MindMapDocument, nodeId: string): number {
  const node = findNode(document, nodeId)
  if (!node) {
    return NODE_GAP_Y
  }

  const own = Math.max(nodeLayoutHeight(document, node) + BRANCH_VERTICAL_MARGIN, NODE_GAP_Y)
  const children = branchChildren(document, node)
  if (children.length === 0) {
    return own
  }

  const childSum = children.reduce((sum, child) => sum + branchExtent(document, child.id), 0)
  return Math.max(own, childSum)
}

function branchChildren(document: MindMapDocument, node: MindNode): MindNode[] {
  if (node.collapsed) {
    return []
  }

  return childrenOf(document, node.id)
}
