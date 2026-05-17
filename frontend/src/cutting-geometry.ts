import type { Position } from './types'

/**
 * 检测两条线段是否相交
 * 使用向量叉积方向判定法
 * 线段 P1P2 与线段 P3P4
 */
export function segmentsIntersect(p1: Position, p2: Position, p3: Position, p4: Position): boolean {
  const d1 = direction(p3, p4, p1)
  const d2 = direction(p3, p4, p2)
  const d3 = direction(p1, p2, p3)
  const d4 = direction(p1, p2, p4)

  // If the signs differ, segments straddle each other's lines
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true
  }

  // Collinear cases: check if endpoints lie on the other segment
  if (d1 === 0 && onSegment(p3, p4, p1)) return true
  if (d2 === 0 && onSegment(p3, p4, p2)) return true
  if (d3 === 0 && onSegment(p1, p2, p3)) return true
  if (d4 === 0 && onSegment(p1, p2, p4)) return true

  return false
}

/**
 * 检测线段 AB 是否与轴对齐矩形 (AABB) 相交
 * 使用 Liang-Barsky 参数化裁剪算法
 *
 * 如果线段的任何部分在矩形内部或与矩形边界相交，返回 true
 */
export function segmentIntersectsAABB(
  a: Position,
  b: Position,
  rectCenter: Position,
  rectWidth: number,
  rectHeight: number,
): boolean {
  const halfW = rectWidth / 2
  const halfH = rectHeight / 2

  const xMin = rectCenter.x - halfW
  const xMax = rectCenter.x + halfW
  const yMin = rectCenter.y - halfH
  const yMax = rectCenter.y + halfH

  const dx = b.x - a.x
  const dy = b.y - a.y

  // Liang-Barsky parameters: p[i], q[i]
  // The line is parameterized as P(t) = A + t*(B-A), t in [0,1]
  // For each edge we have p*t <= q
  const p = [-dx, dx, -dy, dy]
  const q = [a.x - xMin, xMax - a.x, a.y - yMin, yMax - a.y]

  let tMin = 0
  let tMax = 1

  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      // Line is parallel to this edge
      if (q[i] < 0) {
        // Line is outside this edge entirely
        return false
      }
      // Otherwise line is between the edges for this dimension, continue
    } else {
      const t = q[i] / p[i]
      if (p[i] < 0) {
        // Entry edge
        if (t > tMin) tMin = t
      } else {
        // Exit edge
        if (t < tMax) tMax = t
      }
      if (tMin > tMax) {
        return false
      }
    }
  }

  return true
}

/**
 * 检测线段 AB 是否与折线 (polyline) 的任意一段相交
 * 遍历折线的连续点对，逐段调用 segmentsIntersect
 */
export function segmentIntersectsPolyline(a: Position, b: Position, polyline: Position[]): boolean {
  if (polyline.length < 2) return false

  for (let i = 0; i < polyline.length - 1; i++) {
    if (segmentsIntersect(a, b, polyline[i], polyline[i + 1])) {
      return true
    }
  }

  return false
}

/**
 * 将三次 Bézier 曲线采样为折线点序列
 * 使用 De Casteljau 公式在均匀 t 值上求值
 * @param p0 起点
 * @param cp1 第一控制点
 * @param cp2 第二控制点
 * @param p3 终点
 * @param segments 采样段数，默认 16
 * @returns 采样点数组，长度为 segments + 1
 */
export function sampleCubicBezier(
  p0: Position,
  cp1: Position,
  cp2: Position,
  p3: Position,
  segments: number = 16,
): Position[] {
  const points: Position[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const u = 1 - t
    const u2 = u * u
    const u3 = u2 * u
    const t2 = t * t
    const t3 = t2 * t

    points.push({
      x: u3 * p0.x + 3 * u2 * t * cp1.x + 3 * u * t2 * cp2.x + t3 * p3.x,
      y: u3 * p0.y + 3 * u2 * t * cp1.y + 3 * u * t2 * cp2.y + t3 * p3.y,
    })
  }
  return points
}

/**
 * 解析 SVG path d 属性中的 cubic Bézier (M...C...) 为控制点
 * 支持格式: "M x,y C x1,y1 x2,y2 x3,y3" 或 "M x y C x1 y1 x2 y2 x3 y3"
 * @param d SVG path d 属性字符串
 * @returns 解析后的控制点对象，解析失败返回 null
 */
export function parseCubicBezierFromPath(d: string): {
  start: Position
  cp1: Position
  cp2: Position
  end: Position
} | null {
  // Normalize: replace commas with spaces, collapse whitespace
  const normalized = d.replace(/,/g, ' ').replace(/\s+/g, ' ').trim()

  // Match pattern: M x y C x1 y1 x2 y2 x3 y3
  const match = normalized.match(
    /^M\s*(-?[\d.]+)\s+(-?[\d.]+)\s+C\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)$/i,
  )

  if (!match) return null

  const nums = match.slice(1).map(Number)
  if (nums.some(isNaN)) return null

  return {
    start: { x: nums[0], y: nums[1] },
    cp1: { x: nums[2], y: nums[3] },
    cp2: { x: nums[4], y: nums[5] },
    end: { x: nums[6], y: nums[7] },
  }
}

// --- Helper functions ---

/**
 * Cross product of vectors (b-a) and (c-a)
 * Returns positive if c is counter-clockwise from ab,
 * negative if clockwise, 0 if collinear
 */
function direction(a: Position, b: Position, c: Position): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

/**
 * Check if point p lies on segment ab (assuming collinearity)
 */
function onSegment(a: Position, b: Position, p: Position): boolean {
  return (
    Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y)
  )
}

/**
 * Parse an SVG path d attribute containing M...L...L... (polyline/orthogonal) format
 * into an array of Position points.
 * Supports formats like: "M x,y L x1,y1 L x2,y2 L x3,y3"
 * @param d SVG path d attribute string
 * @returns Array of positions (empty if parsing fails)
 */
export function parsePolylineFromPath(d: string): Position[] {
  // Normalize: replace commas with spaces, collapse whitespace
  const normalized = d.replace(/,/g, ' ').replace(/\s+/g, ' ').trim()

  const points: Position[] = []
  // Match all M/L commands followed by coordinates
  const commandRegex = /([ML])\s*(-?[\d.]+)\s+(-?[\d.]+)/gi
  let match: RegExpExecArray | null

  while ((match = commandRegex.exec(normalized)) !== null) {
    const x = Number(match[2])
    const y = Number(match[3])
    if (!isNaN(x) && !isNaN(y)) {
      points.push({ x, y })
    }
  }

  return points
}
