import { describe, it, expect } from 'vitest'
import {
  buildHierarchyPath,
  resolveHierarchyEdgeEndpoints,
  resolveRelationEdgeEndpoints,
  buildCurvedHierarchyPath,
  buildOrthogonalHierarchyPath,
  getRelationDefaultMidpoint,
  polylineMidpoint,
} from './edge-geometry'

describe('buildHierarchyPath', () => {
  it('returns curved path by default', () => {
    const path = buildHierarchyPath({ x: 0, y: 0 }, { x: 100, y: 50 }, 'curve')
    expect(path).toMatch(/^M 0 0 C/)
  })

  it('returns orthogonal path when specified', () => {
    const path = buildHierarchyPath({ x: 0, y: 0 }, { x: 100, y: 50 }, 'orthogonal')
    expect(path).toMatch(/^M 0 0 L/)
  })
})

describe('buildCurvedHierarchyPath', () => {
  it('produces valid SVG path', () => {
    const path = buildCurvedHierarchyPath({ x: 0, y: 0 }, { x: 200, y: 100 })
    expect(path).toContain('M 0 0')
    expect(path).toContain('C')
    expect(path).toContain('200 100')
  })
})

describe('buildOrthogonalHierarchyPath', () => {
  it('produces valid SVG path with bend', () => {
    const path = buildOrthogonalHierarchyPath({ x: 0, y: 0 }, { x: 200, y: 100 })
    expect(path).toBe('M 0 0 L 100 0 L 100 100 L 200 100')
  })
})

describe('resolveHierarchyEdgeEndpoints', () => {
  it('computes source and target on node edges', () => {
    const parent = { position: { x: 0, y: 0 }, width: 100, height: 40 }
    const child = { position: { x: 200, y: 50 }, width: 80, height: 30 }
    const { source, target } = resolveHierarchyEdgeEndpoints(parent, child)

    expect(source.x).toBe(50) // parent right edge
    expect(source.y).toBe(0)
    expect(target.x).toBe(160) // child left edge
    expect(target.y).toBe(50)
  })

  it('handles child to the left', () => {
    const parent = { position: { x: 200, y: 0 }, width: 100, height: 40 }
    const child = { position: { x: 0, y: 50 }, width: 80, height: 30 }
    const { source, target } = resolveHierarchyEdgeEndpoints(parent, child)

    expect(source.x).toBe(150) // parent left edge
    expect(target.x).toBe(40) // child right edge
  })
})

describe('resolveRelationEdgeEndpoints', () => {
  it('returns anchor points toward each other', () => {
    const source = { position: { x: 0, y: 0 }, width: 100, height: 40 }
    const target = { position: { x: 300, y: 0 }, width: 100, height: 40 }
    const result = resolveRelationEdgeEndpoints(source, target)

    expect(result.source.x).toBeGreaterThan(0)
    expect(result.target.x).toBeLessThan(300)
  })
})

describe('getRelationDefaultMidpoint', () => {
  it('returns midpoint for curved style', () => {
    const mid = getRelationDefaultMidpoint({ x: 0, y: 0 }, { x: 100, y: 100 }, 'curve')
    expect(mid.x).toBe(50)
    expect(mid.y).toBe(50)
  })

  it('returns polyline midpoint for orthogonal style', () => {
    const mid = getRelationDefaultMidpoint({ x: 0, y: 0 }, { x: 100, y: 100 }, 'orthogonal')
    expect(mid.x).toBeCloseTo(50, 0)
  })
})

describe('polylineMidpoint', () => {
  it('returns single point for single-point array', () => {
    const mid = polylineMidpoint([{ x: 5, y: 10 }])
    expect(mid).toEqual({ x: 5, y: 10 })
  })

  it('returns midpoint of two-point segment', () => {
    const mid = polylineMidpoint([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ])
    expect(mid.x).toBeCloseTo(5)
    expect(mid.y).toBeCloseTo(0)
  })

  it('returns default for empty array', () => {
    const mid = polylineMidpoint([])
    expect(mid).toEqual({ x: 0, y: 0 })
  })
})
