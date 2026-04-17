import type { EdgeStyle, Position } from './types'
import { clamp } from './utils'

export interface NodeRenderMetrics {
  position: Position
  width: number
  height: number
}

export function buildHierarchyPath(source: Position, target: Position, edgeStyle: EdgeStyle): string {
  return edgeStyle === 'orthogonal'
    ? buildOrthogonalHierarchyPath(source, target)
    : buildCurvedHierarchyPath(source, target)
}

export function resolveHierarchyEdgeEndpoints(
  parent: NodeRenderMetrics,
  child: NodeRenderMetrics,
): { source: Position; target: Position } {
  const direction = child.position.x >= parent.position.x ? 1 : -1

  return {
    source: {
      x: parent.position.x + (direction * parent.width) / 2,
      y: parent.position.y,
    },
    target: {
      x: child.position.x - (direction * child.width) / 2,
      y: child.position.y,
    },
  }
}

export function resolveRelationEdgeEndpoints(
  source: NodeRenderMetrics,
  target: NodeRenderMetrics,
): { source: Position; target: Position } {
  return {
    source: resolveNodeAnchorToward(source, target.position),
    target: resolveNodeAnchorToward(target, source.position),
  }
}

export function resolveNodeAnchorToward(node: NodeRenderMetrics, toward: Position): Position {
  const halfWidth = node.width / 2
  const halfHeight = node.height / 2
  const deltaX = toward.x - node.position.x
  const deltaY = toward.y - node.position.y

  if (Math.abs(deltaX) * halfHeight >= Math.abs(deltaY) * halfWidth) {
    return {
      x: node.position.x + Math.sign(deltaX || 1) * halfWidth,
      y: node.position.y + clamp(deltaY, -halfHeight + 10, halfHeight - 10),
    }
  }

  return {
    x: node.position.x + clamp(deltaX, -halfWidth + 10, halfWidth - 10),
    y: node.position.y + Math.sign(deltaY || 1) * halfHeight,
  }
}

export function buildCurvedHierarchyPath(source: Position, target: Position): string {
  const controlOffset = Math.max(48, Math.abs(target.x - source.x) * 0.36)
  const movingRight = target.x >= source.x
  const controlX1 = movingRight ? source.x + controlOffset : source.x - controlOffset
  const controlX2 = movingRight ? target.x - controlOffset : target.x + controlOffset
  return `M ${source.x} ${source.y} C ${controlX1} ${source.y}, ${controlX2} ${target.y}, ${target.x} ${target.y}`
}

export function buildOrthogonalHierarchyPath(source: Position, target: Position): string {
  const bendX = source.x + (target.x - source.x) / 2
  return `M ${source.x} ${source.y} L ${bendX} ${source.y} L ${bendX} ${target.y} L ${target.x} ${target.y}`
}

export function buildRelationSegmentPath(source: Position, target: Position, edgeStyle: EdgeStyle): string {
  return edgeStyle === 'orthogonal'
    ? buildOrthogonalRelationSegmentPath(source, target)
    : buildCurvedRelationSegmentPath(source, target)
}

export function buildCurvedRelationSegmentPath(source: Position, target: Position): string {
  const deltaX = target.x - source.x
  const deltaY = target.y - source.y
  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    const controlOffset = clamp(Math.abs(deltaX) * 0.32, 20, 92) * Math.sign(deltaX || 1)
    return `M ${source.x} ${source.y} C ${source.x + controlOffset} ${source.y}, ${target.x - controlOffset} ${target.y}, ${target.x} ${target.y}`
  }

  const controlOffset = clamp(Math.abs(deltaY) * 0.32, 20, 92) * Math.sign(deltaY || 1)
  return `M ${source.x} ${source.y} C ${source.x} ${source.y + controlOffset}, ${target.x} ${target.y - controlOffset}, ${target.x} ${target.y}`
}

export function buildOrthogonalRelationSegmentPath(source: Position, target: Position): string {
  const points = buildOrthogonalRelationPolyline(source, target)
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
}

export function getRelationDefaultMidpoint(source: Position, target: Position, edgeStyle: EdgeStyle): Position {
  if (edgeStyle !== 'orthogonal') {
    return {
      x: (source.x + target.x) / 2,
      y: (source.y + target.y) / 2,
    }
  }

  return polylineMidpoint(buildOrthogonalRelationPolyline(source, target))
}

export function buildOrthogonalRelationPolyline(source: Position, target: Position): Position[] {
  if (Math.abs(target.x - source.x) >= Math.abs(target.y - source.y)) {
    const bendX = source.x + (target.x - source.x) / 2
    return [source, { x: bendX, y: source.y }, { x: bendX, y: target.y }, target]
  }

  const bendY = source.y + (target.y - source.y) / 2
  return [source, { x: source.x, y: bendY }, { x: target.x, y: bendY }, target]
}

export function polylineMidpoint(points: Position[]): Position {
  if (points.length < 2) {
    return points[0] ?? { x: 0, y: 0 }
  }

  let totalLength = 0
  for (let index = 1; index < points.length; index += 1) {
    totalLength += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y)
  }

  const halfway = totalLength / 2
  let traversed = 0
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]
    const end = points[index]
    const segmentLength = Math.hypot(end.x - start.x, end.y - start.y)
    if (traversed + segmentLength >= halfway) {
      const segmentRatio = segmentLength === 0 ? 0 : (halfway - traversed) / segmentLength
      return {
        x: start.x + (end.x - start.x) * segmentRatio,
        y: start.y + (end.y - start.y) * segmentRatio,
      }
    }
    traversed += segmentLength
  }

  return points[points.length - 1]
}
