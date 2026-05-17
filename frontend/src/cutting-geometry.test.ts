import { describe, it, expect } from 'vitest'
import {
  segmentsIntersect,
  segmentIntersectsAABB,
  segmentIntersectsPolyline,
  sampleCubicBezier,
  parseCubicBezierFromPath,
} from './cutting-geometry'

describe('segmentsIntersect', () => {
  it('detects crossing segments', () => {
    // X-shaped cross
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toBe(true)
  })

  it('returns false for parallel non-overlapping segments', () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 1 }, { x: 10, y: 1 })).toBe(false)
  })

  it('returns false for non-intersecting segments', () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 })).toBe(false)
  })

  it('detects T-shaped intersection (endpoint on segment)', () => {
    expect(segmentsIntersect({ x: 0, y: 5 }, { x: 10, y: 5 }, { x: 5, y: 0 }, { x: 5, y: 5 })).toBe(true)
  })

  it('detects collinear overlapping segments', () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 3, y: 0 }, { x: 8, y: 0 })).toBe(true)
  })

  it('returns false for collinear non-overlapping segments', () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 5, y: 0 })).toBe(false)
  })

  it('detects shared endpoint', () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 5, y: 5 }, { x: 10, y: 0 })).toBe(true)
  })
})

describe('segmentIntersectsAABB', () => {
  const center = { x: 5, y: 5 }
  const width = 4
  const height = 4
  // Rect spans [3,7] x [3,7]

  it('detects segment passing through the rectangle', () => {
    expect(segmentIntersectsAABB({ x: 0, y: 5 }, { x: 10, y: 5 }, center, width, height)).toBe(true)
  })

  it('detects segment fully inside the rectangle', () => {
    expect(segmentIntersectsAABB({ x: 4, y: 4 }, { x: 6, y: 6 }, center, width, height)).toBe(true)
  })

  it('returns false for segment completely outside', () => {
    expect(segmentIntersectsAABB({ x: 0, y: 0 }, { x: 2, y: 0 }, center, width, height)).toBe(false)
  })

  it('detects segment touching the rectangle edge', () => {
    // Segment ends exactly at left edge
    expect(segmentIntersectsAABB({ x: 0, y: 5 }, { x: 3, y: 5 }, center, width, height)).toBe(true)
  })

  it('returns false for segment just outside the rectangle', () => {
    // Segment passes above the rectangle
    expect(segmentIntersectsAABB({ x: 0, y: 2 }, { x: 10, y: 2 }, center, width, height)).toBe(false)
  })

  it('detects diagonal segment crossing rectangle corner', () => {
    expect(segmentIntersectsAABB({ x: 0, y: 0 }, { x: 10, y: 10 }, center, width, height)).toBe(true)
  })

  it('detects segment starting inside and ending outside', () => {
    expect(segmentIntersectsAABB({ x: 5, y: 5 }, { x: 20, y: 5 }, center, width, height)).toBe(true)
  })

  it('handles zero-length segment inside rectangle', () => {
    expect(segmentIntersectsAABB({ x: 5, y: 5 }, { x: 5, y: 5 }, center, width, height)).toBe(true)
  })

  it('handles zero-length segment outside rectangle', () => {
    expect(segmentIntersectsAABB({ x: 0, y: 0 }, { x: 0, y: 0 }, center, width, height)).toBe(false)
  })
})

describe('segmentIntersectsPolyline', () => {
  it('detects intersection with a simple polyline', () => {
    // Polyline forms an inverted V shape
    const polyline = [
      { x: 0, y: 0 },
      { x: 5, y: 10 },
      { x: 10, y: 0 },
    ]
    // Horizontal line crossing the polyline
    expect(segmentIntersectsPolyline({ x: 0, y: 5 }, { x: 10, y: 5 }, polyline)).toBe(true)
  })

  it('returns false when segment does not intersect any polyline segment', () => {
    const polyline = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
    ]
    // Segment above the polyline
    expect(segmentIntersectsPolyline({ x: 0, y: 5 }, { x: 10, y: 5 }, polyline)).toBe(false)
  })

  it('returns false for polyline with fewer than 2 points', () => {
    expect(segmentIntersectsPolyline({ x: 0, y: 0 }, { x: 10, y: 10 }, [])).toBe(false)
    expect(segmentIntersectsPolyline({ x: 0, y: 0 }, { x: 10, y: 10 }, [{ x: 5, y: 5 }])).toBe(false)
  })

  it('detects intersection with the last segment of the polyline', () => {
    const polyline = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]
    // Horizontal line crossing only the last vertical segment
    expect(segmentIntersectsPolyline({ x: 8, y: 5 }, { x: 12, y: 5 }, polyline)).toBe(true)
  })

  it('detects intersection at a polyline vertex', () => {
    const polyline = [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { x: 10, y: 0 },
    ]
    // Segment passing through the vertex at (5,5)
    expect(segmentIntersectsPolyline({ x: 5, y: 0 }, { x: 5, y: 10 }, polyline)).toBe(true)
  })

  it('returns false when segment is parallel and offset from polyline', () => {
    const polyline = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ]
    // Parallel segment offset by 1 unit
    expect(segmentIntersectsPolyline({ x: 0, y: 1 }, { x: 20, y: 1 }, polyline)).toBe(false)
  })

  it('detects intersection with a multi-segment polyline (only one segment hit)', () => {
    const polyline = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 6, y: 0 },
      { x: 9, y: 0 },
      { x: 9, y: 5 },
    ]
    // Segment crosses only the last vertical segment
    expect(segmentIntersectsPolyline({ x: 7, y: 3 }, { x: 11, y: 3 }, polyline)).toBe(true)
  })
})

describe('sampleCubicBezier', () => {
  it('returns segments + 1 points', () => {
    const p0 = { x: 0, y: 0 }
    const cp1 = { x: 1, y: 2 }
    const cp2 = { x: 3, y: 2 }
    const p3 = { x: 4, y: 0 }

    const result = sampleCubicBezier(p0, cp1, cp2, p3, 16)
    expect(result).toHaveLength(17)
  })

  it('first point equals p0', () => {
    const p0 = { x: 10, y: 20 }
    const cp1 = { x: 15, y: 30 }
    const cp2 = { x: 25, y: 30 }
    const p3 = { x: 30, y: 20 }

    const result = sampleCubicBezier(p0, cp1, cp2, p3, 8)
    expect(result[0].x).toBeCloseTo(10)
    expect(result[0].y).toBeCloseTo(20)
  })

  it('last point equals p3', () => {
    const p0 = { x: 10, y: 20 }
    const cp1 = { x: 15, y: 30 }
    const cp2 = { x: 25, y: 30 }
    const p3 = { x: 30, y: 20 }

    const result = sampleCubicBezier(p0, cp1, cp2, p3, 8)
    expect(result[result.length - 1].x).toBeCloseTo(30)
    expect(result[result.length - 1].y).toBeCloseTo(20)
  })

  it('uses default segments of 16 when not specified', () => {
    const p0 = { x: 0, y: 0 }
    const cp1 = { x: 1, y: 1 }
    const cp2 = { x: 2, y: 1 }
    const p3 = { x: 3, y: 0 }

    const result = sampleCubicBezier(p0, cp1, cp2, p3)
    expect(result).toHaveLength(17)
  })

  it('midpoint of a symmetric curve is at expected position', () => {
    // Symmetric Bézier: p0=(0,0), cp1=(0,2), cp2=(4,2), p3=(4,0)
    // At t=0.5: x = (1-0.5)^3*0 + 3*(1-0.5)^2*0.5*0 + 3*(1-0.5)*0.5^2*4 + 0.5^3*4
    //         = 0 + 0 + 3*0.5*0.25*4 + 0.125*4 = 1.5 + 0.5 = 2
    // At t=0.5: y = (1-0.5)^3*0 + 3*(1-0.5)^2*0.5*2 + 3*(1-0.5)*0.5^2*2 + 0.5^3*0
    //         = 0 + 3*0.25*0.5*2 + 3*0.5*0.25*2 + 0 = 0.75 + 0.75 = 1.5
    const p0 = { x: 0, y: 0 }
    const cp1 = { x: 0, y: 2 }
    const cp2 = { x: 4, y: 2 }
    const p3 = { x: 4, y: 0 }

    const result = sampleCubicBezier(p0, cp1, cp2, p3, 2)
    // With 2 segments, midpoint is at index 1 (t=0.5)
    expect(result[1].x).toBeCloseTo(2)
    expect(result[1].y).toBeCloseTo(1.5)
  })

  it('handles a straight line (control points on the line)', () => {
    const p0 = { x: 0, y: 0 }
    const cp1 = { x: 1, y: 1 }
    const cp2 = { x: 2, y: 2 }
    const p3 = { x: 3, y: 3 }

    const result = sampleCubicBezier(p0, cp1, cp2, p3, 4)
    // All points should lie on the line y = x
    for (const pt of result) {
      expect(pt.x).toBeCloseTo(pt.y)
    }
  })

  it('handles segments = 1 (only start and end)', () => {
    const p0 = { x: 5, y: 10 }
    const cp1 = { x: 7, y: 20 }
    const cp2 = { x: 13, y: 20 }
    const p3 = { x: 15, y: 10 }

    const result = sampleCubicBezier(p0, cp1, cp2, p3, 1)
    expect(result).toHaveLength(2)
    expect(result[0].x).toBeCloseTo(5)
    expect(result[0].y).toBeCloseTo(10)
    expect(result[1].x).toBeCloseTo(15)
    expect(result[1].y).toBeCloseTo(10)
  })
})

describe('parseCubicBezierFromPath', () => {
  it('parses standard M...C... format with commas', () => {
    const result = parseCubicBezierFromPath('M 10,20 C 30,40 50,60 70,80')
    expect(result).not.toBeNull()
    expect(result!.start).toEqual({ x: 10, y: 20 })
    expect(result!.cp1).toEqual({ x: 30, y: 40 })
    expect(result!.cp2).toEqual({ x: 50, y: 60 })
    expect(result!.end).toEqual({ x: 70, y: 80 })
  })

  it('parses format with spaces instead of commas', () => {
    const result = parseCubicBezierFromPath('M 10 20 C 30 40 50 60 70 80')
    expect(result).not.toBeNull()
    expect(result!.start).toEqual({ x: 10, y: 20 })
    expect(result!.cp1).toEqual({ x: 30, y: 40 })
    expect(result!.cp2).toEqual({ x: 50, y: 60 })
    expect(result!.end).toEqual({ x: 70, y: 80 })
  })

  it('parses format with no space after M and C', () => {
    const result = parseCubicBezierFromPath('M10,20 C30,40 50,60 70,80')
    expect(result).not.toBeNull()
    expect(result!.start).toEqual({ x: 10, y: 20 })
    expect(result!.cp1).toEqual({ x: 30, y: 40 })
  })

  it('handles negative coordinates', () => {
    const result = parseCubicBezierFromPath('M -10,-20 C -30,40 50,-60 70,80')
    expect(result).not.toBeNull()
    expect(result!.start).toEqual({ x: -10, y: -20 })
    expect(result!.cp1).toEqual({ x: -30, y: 40 })
    expect(result!.cp2).toEqual({ x: 50, y: -60 })
    expect(result!.end).toEqual({ x: 70, y: 80 })
  })

  it('handles decimal coordinates', () => {
    const result = parseCubicBezierFromPath('M 1.5,2.7 C 3.1,4.9 5.2,6.8 7.3,8.4')
    expect(result).not.toBeNull()
    expect(result!.start.x).toBeCloseTo(1.5)
    expect(result!.start.y).toBeCloseTo(2.7)
    expect(result!.end.x).toBeCloseTo(7.3)
    expect(result!.end.y).toBeCloseTo(8.4)
  })

  it('returns null for invalid path (no M command)', () => {
    const result = parseCubicBezierFromPath('C 30,40 50,60 70,80')
    expect(result).toBeNull()
  })

  it('returns null for invalid path (no C command)', () => {
    const result = parseCubicBezierFromPath('M 10,20 L 30,40')
    expect(result).toBeNull()
  })

  it('returns null for empty string', () => {
    const result = parseCubicBezierFromPath('')
    expect(result).toBeNull()
  })

  it('returns null for incomplete coordinates', () => {
    const result = parseCubicBezierFromPath('M 10,20 C 30,40 50,60')
    expect(result).toBeNull()
  })

  it('handles extra whitespace', () => {
    const result = parseCubicBezierFromPath('  M  10 , 20   C  30 , 40   50 , 60   70 , 80  ')
    expect(result).not.toBeNull()
    expect(result!.start).toEqual({ x: 10, y: 20 })
    expect(result!.end).toEqual({ x: 70, y: 80 })
  })
})
