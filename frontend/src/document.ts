import type { MindMapDocument, MindNode, Position, RelationEdge } from './types'

const ROOT_POSITION: Position = { x: 820, y: 320 }
const NODE_GAP_X = 280
const NODE_GAP_Y = 96

export function createDefaultDocument(): MindMapDocument {
  const now = new Date().toISOString()
  return {
    id: 'default',
    title: 'New Mind Map',
    theme: 'light',
    nodes: [
      {
        id: 'root',
        kind: 'root',
        title: 'New Mind Map',
        position: ROOT_POSITION,
        createdAt: now,
        updatedAt: now,
      },
    ],
    relations: [],
    meta: {
      version: 1,
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
}): MindNode {
  const now = new Date().toISOString()
  return {
    id: createId('node'),
    title: input.title,
    kind: input.kind,
    parentId: input.parentId,
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
      if (left.position.y !== right.position.y) {
        return left.position.y - right.position.y
      }
      return left.position.x - right.position.x
    })
}

export function connectedRelations(document: MindMapDocument, nodeId: string): RelationEdge[] {
  return document.relations.filter((relation) => relation.sourceId === nodeId || relation.targetId === nodeId)
}

export function descendantIds(document: MindMapDocument, nodeId: string): string[] {
  const descendants: string[] = []
  const queue = [nodeId]

  while (queue.length > 0) {
    const currentId = queue.shift()
    if (!currentId) {
      continue
    }

    for (const child of childrenOf(document, currentId)) {
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

    while (current?.parentId) {
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

export function nextChildPosition(document: MindMapDocument, parentId: string): Position {
  const parent = findNode(document, parentId)
  if (!parent) {
    return ROOT_POSITION
  }

  const children = childrenOf(document, parentId)
  if (children.length === 0) {
    return { x: parent.position.x + NODE_GAP_X, y: parent.position.y }
  }

  const lastChild = children[children.length - 1]
  return { x: parent.position.x + NODE_GAP_X, y: lastChild.position.y + NODE_GAP_Y }
}

export function nextSiblingPosition(document: MindMapDocument, node: MindNode): Position {
  if (!node.parentId) {
    return nextFloatingPosition(document)
  }

  const siblings = childrenOf(document, node.parentId)
  const lastSibling = siblings[siblings.length - 1]
  return { x: node.position.x, y: lastSibling.position.y + NODE_GAP_Y }
}

export function nextFloatingPosition(document: MindMapDocument): Position {
  const floatingNodes = document.nodes
    .filter((node) => node.kind === 'floating')
    .sort((left, right) => left.position.y - right.position.y)

  if (floatingNodes.length === 0) {
    const root = findRoot(document)
    return { x: root.position.x - 140, y: root.position.y + 180 }
  }

  const lastFloatingNode = floatingNodes[floatingNodes.length - 1]
  return { x: lastFloatingNode.position.x + 36, y: lastFloatingNode.position.y + NODE_GAP_Y }
}

export function touchDocument(document: MindMapDocument): void {
  const root = findRoot(document)
  document.title = root.title
  document.meta.lastEditedAt = new Date().toISOString()
}

export function deleteNodeTree(document: MindMapDocument, nodeId: string): { removedNodes: number; removedRelations: number } {
  if (nodeId === 'root') {
    return { removedNodes: 0, removedRelations: 0 }
  }

  const removeIds = new Set<string>([nodeId, ...descendantIds(document, nodeId)])
  const relationCountBefore = document.relations.length
  const nodeCountBefore = document.nodes.length

  document.nodes = document.nodes.filter((node) => !removeIds.has(node.id))
  document.relations = document.relations.filter((relation) => !removeIds.has(relation.sourceId) && !removeIds.has(relation.targetId))

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

export function autoLayoutHierarchy(document: MindMapDocument): number {
  const root = findRoot(document)
  root.position = { ...ROOT_POSITION }
  root.updatedAt = new Date().toISOString()

  const rootChildren = childrenOf(document, root.id)
  if (rootChildren.length === 0) {
    return 1
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

  const moved = new Set<string>(['root'])
  layoutGroup(document, root, leftRoots, -1, moved)
  layoutGroup(document, root, rightRoots, 1, moved)
  return moved.size
}

function layoutGroup(
  document: MindMapDocument,
  root: MindNode,
  nodes: MindNode[],
  side: -1 | 1,
  moved: Set<string>,
): void {
  if (nodes.length === 0) {
    return
  }

  const weights = nodes.map((node) => branchWeight(document, node.id))
  const totalUnits = weights.reduce((sum, value) => sum + value, 0)
  let cursorY = root.position.y - ((totalUnits - 1) * NODE_GAP_Y) / 2

  nodes.forEach((node, index) => {
    layoutBranch(document, root, node.id, 1, side, cursorY, moved)
    cursorY += weights[index] * NODE_GAP_Y
  })
}

function layoutBranch(
  document: MindMapDocument,
  root: MindNode,
  nodeId: string,
  depth: number,
  side: -1 | 1,
  topY: number,
  moved: Set<string>,
): void {
  const node = findNode(document, nodeId)
  if (!node) {
    return
  }

  const weight = branchWeight(document, nodeId)
  node.position = {
    x: root.position.x + side * depth * NODE_GAP_X,
    y: topY + ((weight - 1) * NODE_GAP_Y) / 2,
  }
  node.updatedAt = new Date().toISOString()
  moved.add(node.id)

  const children = childrenOf(document, nodeId)
  if (children.length === 0) {
    return
  }

  let childCursorY = topY
  for (const child of children) {
    const childWeight = branchWeight(document, child.id)
    layoutBranch(document, root, child.id, depth + 1, side, childCursorY, moved)
    childCursorY += childWeight * NODE_GAP_Y
  }
}

function branchWeight(document: MindMapDocument, nodeId: string): number {
  const children = childrenOf(document, nodeId)
  if (children.length === 0) {
    return 1
  }

  return Math.max(
    1,
    children.reduce((sum, child) => sum + branchWeight(document, child.id), 0),
  )
}
