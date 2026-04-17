import type { MindMapDocument, MindNode, NodeColor } from './types'
import { connectedRelations, findNode, findRoot } from './document'
import { normalizeNodeColor } from './color-palette'
import { clamp, shorten } from './utils'

export interface GraphHitNode {
  id: string
  x: number
  y: number
  radius: number
}

export function graphNodeDepth(document: MindMapDocument, node: MindNode): number {
  let depth = 0
  let current = node
  while (current.parentId) {
    const parent = findNode(document, current.parentId)
    if (!parent) {
      break
    }
    depth += 1
    current = parent
  }
  return depth
}

export function traceRoundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const safeRadius = Math.min(radius, width / 2, height / 2)
  context.moveTo(x + safeRadius, y)
  context.lineTo(x + width - safeRadius, y)
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius)
  context.lineTo(x + width, y + height - safeRadius)
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height)
  context.lineTo(x + safeRadius, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius)
  context.lineTo(x, y + safeRadius)
  context.quadraticCurveTo(x, y, x + safeRadius, y)
}

export function trimGraphEdge(
  source: { x: number; y: number; radius: number; lineWidth: number },
  target: { x: number; y: number; radius: number; lineWidth: number },
): { x1: number; y1: number; x2: number; y2: number } {
  const dx = target.x - source.x
  const dy = target.y - source.y
  const distance = Math.hypot(dx, dy)
  if (distance < 0.0001) {
    return {
      x1: source.x,
      y1: source.y,
      x2: target.x,
      y2: target.y,
    }
  }

  const unitX = dx / distance
  const unitY = dy / distance
  const sourcePadding = source.radius + Math.max(4.5, source.lineWidth * 1.5)
  const targetPadding = target.radius + Math.max(4.5, target.lineWidth * 1.5)
  const safeDistance = Math.max(distance - sourcePadding - targetPadding, 0)
  return {
    x1: source.x + unitX * sourcePadding,
    y1: source.y + unitY * sourcePadding,
    x2: source.x + unitX * (sourcePadding + safeDistance),
    y2: source.y + unitY * (sourcePadding + safeDistance),
  }
}

export function buildGraphFrame(
  document: MindMapDocument,
  width: number,
  height: number,
  rotation: number,
  tilt: number,
  graphZoom: number,
  searchQuery: string,
  selectedNodeId: string | null,
): {
  nodes: Array<{
    id: string
    x: number
    y: number
    radius: number
    label: string
    color: NodeColor
    opacity: number
    occlusionOpacity: number
    surfaceOpacity: number
    strokeOpacity: number
    textOpacity: number
    lineWidth: number
    fontSize: number
    glow: number
    selected: boolean
    highlighted: boolean
  }>
  edges: Array<{
    x1: number
    y1: number
    x2: number
    y2: number
    opacity: number
    lineWidth: number
    type: 'hierarchy' | 'relation'
  }>
  hitNodes: GraphHitNode[]
} {
  const root = findRoot(document)
  const query = searchQuery.trim().toLowerCase()
  const centerX = width / 2
  const centerY = height / 2 + height * 0.04
  const cameraDistance = Math.max(880, Math.min(width, height) * 1.68)
  const minScale = 0.58
  const maxScale = 1.74
  const nodeById = new Map(document.nodes.map((node) => [node.id, node] as const))
  const childrenByParent = new Map<string, MindNode[]>()
  const siblingPlacement = new Map<string, { centeredIndex: number; count: number }>()
  let maxAbsOffsetX = 1
  let maxAbsOffsetY = 1

  for (const node of document.nodes) {
    maxAbsOffsetX = Math.max(maxAbsOffsetX, Math.abs(node.position.x - root.position.x))
    maxAbsOffsetY = Math.max(maxAbsOffsetY, Math.abs(node.position.y - root.position.y))
    if (!node.parentId) {
      continue
    }

    const siblings = childrenByParent.get(node.parentId) ?? []
    siblings.push(node)
    childrenByParent.set(node.parentId, siblings)
  }

  for (const siblings of childrenByParent.values()) {
    const orderedSiblings = [...siblings].sort((left, right) => {
      return (
        left.position.y - right.position.y ||
        left.position.x - right.position.x ||
        left.title.localeCompare(right.title)
      )
    })
    const midpoint = (orderedSiblings.length - 1) / 2
    orderedSiblings.forEach((sibling, index) => {
      siblingPlacement.set(sibling.id, {
        centeredIndex: index - midpoint,
        count: orderedSiblings.length,
      })
    })
  }

  const planeScale =
    clamp(Math.min((width * 0.34) / maxAbsOffsetX, (height * 0.28) / maxAbsOffsetY), 0.12, 0.72) * graphZoom
  const depthSpread = clamp(0.9 + (graphZoom - 1) * 0.38, 0.72, 1.34)
  const base3dById = new Map<string, { x: number; y: number; z: number }>()
  const projected = new Map<
    string,
    {
      id: string
      x: number
      y: number
      radius: number
      depth: number
      z: number
      scale: number
      color: NodeColor
      opacity: number
      occlusionOpacity: number
      surfaceOpacity: number
      strokeOpacity: number
      textOpacity: number
      lineWidth: number
      fontSize: number
      glow: number
      selected: boolean
      highlighted: boolean
      label: string
    }
  >()

  const nodesByDepth = [...document.nodes].sort((left, right) => {
    return (
      graphNodeDepth(document, left) - graphNodeDepth(document, right) ||
      left.position.y - right.position.y ||
      left.position.x - right.position.x ||
      left.title.localeCompare(right.title)
    )
  })

  nodesByDepth.forEach((node) => {
    const depth = graphNodeDepth(document, node)
    const relationCount = connectedRelations(document, node.id).length
    const siblingMeta = siblingPlacement.get(node.id)
    const siblingOffset = siblingMeta?.centeredIndex ?? 0
    let baseX = 0
    let baseY = 0
    let baseZ: number

    if (node.id === root.id) {
      baseZ = -26 * depthSpread
    } else {
      const parent = node.parentId ? nodeById.get(node.parentId) : undefined
      if (parent) {
        const parentBase = base3dById.get(parent.id) ?? { x: 0, y: 0, z: 0 }
        const rawDx = (node.position.x - parent.position.x) * planeScale
        const rawDy = (node.position.y - parent.position.y) * planeScale
        const branchDistance = Math.hypot(rawDx, rawDy)
        const branchAngle = Math.atan2(rawDy || 0.001, rawDx || 1)
        const lateralSpacing = clamp(branchDistance * 0.16, 10, 26)
        const crossX = -Math.sin(branchAngle)
        const crossY = Math.cos(branchAngle)

        baseX = parentBase.x + rawDx + crossX * siblingOffset * lateralSpacing * 0.28
        baseY = parentBase.y + rawDy + crossY * siblingOffset * lateralSpacing * 0.22
        baseZ =
          parentBase.z +
          (clamp(branchDistance * 0.22 + depth * 3.5, 18, 52) + siblingOffset * 8 + relationCount * 4) * depthSpread
      } else {
        const rawDx = (node.position.x - root.position.x) * planeScale
        const rawDy = (node.position.y - root.position.y) * planeScale
        const radialDistance = Math.hypot(rawDx, rawDy)
        const branchAngle = Math.atan2(rawDy || 0.001, rawDx || 1)

        baseX = rawDx
        baseY = rawDy
        baseZ = (clamp(radialDistance * 0.18 + depth * 18, 12, 72) + Math.sin(branchAngle) * 8) * depthSpread
      }
    }

    base3dById.set(node.id, {
      x: baseX,
      y: baseY,
      z: baseZ,
    })

    const yawX = baseX * Math.cos(rotation) - baseZ * Math.sin(rotation)
    const yawZ = baseX * Math.sin(rotation) + baseZ * Math.cos(rotation)
    const pitchY = baseY * Math.cos(tilt) - yawZ * Math.sin(tilt)
    const pitchZ = baseY * Math.sin(tilt) + yawZ * Math.cos(tilt)
    const scale = clamp(cameraDistance / (cameraDistance + pitchZ), minScale, maxScale)
    const depthProgress = clamp((scale - minScale) / (maxScale - minScale), 0, 1)
    const x = centerX + yawX * scale
    const y = centerY + pitchY * scale - pitchZ * 0.08
    const radiusBase = clamp(11 + relationCount * 1.4 + (node.kind === 'root' ? 10 : 0), 11, 28)
    const radius = radiusBase * clamp(0.74 + depthProgress * 0.72, 0.74, 1.46)
    const selected = node.id === selectedNodeId
    const highlighted = selected || (query !== '' && node.title.toLowerCase().includes(query))
    const emphasisBoost = selected ? 0.2 : highlighted ? 0.1 : 0
    projected.set(node.id, {
      id: node.id,
      x,
      y,
      radius,
      depth,
      z: pitchZ,
      scale,
      color: normalizeNodeColor(node.color),
      opacity: clamp(0.2 + depthProgress * 0.78 + emphasisBoost, 0.2, 1),
      occlusionOpacity: clamp(0.9 + depthProgress * 0.08, 0.9, 0.98),
      surfaceOpacity: clamp(0.72 + depthProgress * 0.24 + emphasisBoost * 0.08, 0.72, 0.98),
      strokeOpacity: clamp(0.28 + depthProgress * 0.48 + emphasisBoost * 0.18, 0.28, 0.96),
      textOpacity: clamp(0.56 + depthProgress * 0.36 + emphasisBoost * 0.12, 0.56, 1),
      lineWidth: clamp(1 + depthProgress * 1.6 + (selected ? 0.45 : 0), 1, 3.05),
      fontSize: clamp((selected ? 15 : highlighted ? 13 : 12) + depthProgress * 3, 12, 18),
      glow: clamp(8 + depthProgress * 14 + (selected ? 8 : highlighted ? 4 : 0), 8, 30),
      selected,
      highlighted,
      label: shorten(node.title, selected ? 18 : highlighted ? 12 : 6),
    })
  })

  const edges: Array<{
    x1: number
    y1: number
    x2: number
    y2: number
    opacity: number
    lineWidth: number
    type: 'hierarchy' | 'relation'
  }> = []
  for (const node of document.nodes) {
    if (!node.parentId) {
      continue
    }

    const source = projected.get(node.parentId)
    const target = projected.get(node.id)
    if (!source || !target) {
      continue
    }

    const trimmed = trimGraphEdge(source, target)
    edges.push({
      x1: trimmed.x1,
      y1: trimmed.y1,
      x2: trimmed.x2,
      y2: trimmed.y2,
      opacity: clamp(((source.opacity + target.opacity) / 2) * 0.6, 0.1, 0.76),
      lineWidth: clamp(((source.lineWidth + target.lineWidth) / 2) * 0.72, 0.9, 2.2),
      type: 'hierarchy',
    })
  }

  for (const relation of document.relations) {
    const source = projected.get(relation.sourceId)
    const target = projected.get(relation.targetId)
    if (!source || !target) {
      continue
    }

    const trimmed = trimGraphEdge(source, target)
    edges.push({
      x1: trimmed.x1,
      y1: trimmed.y1,
      x2: trimmed.x2,
      y2: trimmed.y2,
      opacity: clamp(((source.opacity + target.opacity) / 2) * 0.7, 0.12, 0.88),
      lineWidth: clamp(((source.lineWidth + target.lineWidth) / 2) * 0.9, 1, 2.6),
      type: 'relation',
    })
  }

  const nodes = [...projected.values()].sort((left, right) => right.z - left.z || left.depth - right.depth)
  return {
    nodes,
    edges,
    hitNodes: [...nodes].reverse().map((node) => ({
      id: node.id,
      x: node.x,
      y: node.y,
      radius: node.radius,
    })),
  }
}
