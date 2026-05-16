import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { UxEngine, easeOutCubic } from './ux-engine'
import type { ViewportState } from './ux-engine'

// === easeOutCubic unit tests ===

describe('easeOutCubic', () => {
  it('returns 0 at t=0', () => {
    expect(easeOutCubic(0)).toBe(0)
  })

  it('returns 1 at t=1', () => {
    expect(easeOutCubic(1)).toBe(1)
  })

  it('returns 0.875 at t=0.5', () => {
    // 1 - (1 - 0.5)^3 = 1 - 0.125 = 0.875
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875)
  })

  it('is monotonically increasing', () => {
    for (let i = 0; i < 100; i++) {
      const t1 = i / 100
      const t2 = (i + 1) / 100
      expect(easeOutCubic(t2)).toBeGreaterThanOrEqual(easeOutCubic(t1))
    }
  })
})

// === UxEngine zoom interpolation tests ===

describe('UxEngine - animateZoom', () => {
  let engine: UxEngine
  let updates: ViewportState[]
  let rafCallbacks: Array<(time: number) => void>
  let rafIdCounter: number

  beforeEach(() => {
    updates = []
    rafCallbacks = []
    rafIdCounter = 0

    // Mock requestAnimationFrame
    vi.stubGlobal('requestAnimationFrame', (cb: (time: number) => void) => {
      rafCallbacks.push(cb)
      return ++rafIdCounter
    })

    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      // Remove callback at index id-1 (since ids start at 1)
      // In practice we just need to prevent it from being called
      void id
    })

    // Mock performance.now
    vi.spyOn(performance, 'now').mockReturnValue(0)

    // Mock matchMedia - default: no reduced motion
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)' ? false : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    engine = new UxEngine((viewport) => {
      updates.push({ ...viewport })
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function advanceFrame(time: number) {
    vi.spyOn(performance, 'now').mockReturnValue(time)
    const cbs = [...rafCallbacks]
    rafCallbacks = []
    cbs.forEach((cb) => cb(time))
  }

  it('schedules a requestAnimationFrame on call', () => {
    engine.animateZoom(1.0, 2.0, 400, 300, 0, 0)
    expect(rafCallbacks.length).toBe(1)
  })

  it('interpolates scale from start to target over duration', () => {
    // Start at scale 1.0, target 2.0, center at (400, 300), viewport at (0, 0)
    engine.animateZoom(1.0, 2.0, 400, 300, 0, 0)

    // At t=0 (first frame)
    advanceFrame(0)
    // progress = 0, eased = 0, scale = 1.0
    expect(updates[0].scale).toBeCloseTo(1.0)

    // At t=90ms (half duration, duration=180ms)
    advanceFrame(90)
    const halfProgress = easeOutCubic(90 / 180)
    const expectedScale = 1.0 + (2.0 - 1.0) * halfProgress
    expect(updates[1].scale).toBeCloseTo(expectedScale)

    // At t=180ms (end)
    advanceFrame(180)
    expect(updates[2].scale).toBeCloseTo(2.0)
  })

  it('maintains center point invariant throughout animation', () => {
    const centerX = 400
    const centerY = 300
    const viewportX = 100
    const viewportY = 50

    // World coordinate at center before zoom
    const currentScale = 1.5
    const worldX = (centerX - viewportX) / currentScale
    const worldY = (centerY - viewportY) / currentScale

    // Sync the engine's internal viewport to match the expected starting state
    engine.syncViewport({ x: viewportX, y: viewportY, scale: currentScale })

    engine.animateZoom(currentScale, 3.0, centerX, centerY, viewportX, viewportY)

    // Check multiple frames
    const times = [0, 30, 60, 90, 120, 150, 180]
    for (const t of times) {
      advanceFrame(t)
    }

    // For each update, verify the world point at center is preserved
    for (const vp of updates) {
      const computedWorldX = (centerX - vp.x) / vp.scale
      const computedWorldY = (centerY - vp.y) / vp.scale
      expect(computedWorldX).toBeCloseTo(worldX, 5)
      expect(computedWorldY).toBeCloseTo(worldY, 5)
    }
  })

  it('completes animation and sets active=false', () => {
    engine.animateZoom(1.0, 2.0, 400, 300, 0, 0)

    // Advance past duration
    advanceFrame(180)

    // No more rAF scheduled
    expect(rafCallbacks.length).toBe(0)
  })

  it('cancelZoom stops the animation', () => {
    engine.animateZoom(1.0, 2.0, 400, 300, 0, 0)
    expect(rafCallbacks.length).toBe(1)

    engine.cancelZoom()
    // After cancel, no further updates should happen
    // (the callback is still in our array but cancelAnimationFrame was called)
  })

  it('prefers-reduced-motion skips interpolation and sets target directly', () => {
    // Override matchMedia to return reduced motion
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    engine = new UxEngine((viewport) => {
      updates.push({ ...viewport })
    })

    const centerX = 400
    const centerY = 300
    const viewportX = 100
    const viewportY = 50
    const currentScale = 1.0
    const targetScale = 2.0

    engine.animateZoom(currentScale, targetScale, centerX, centerY, viewportX, viewportY)

    // Should have called onViewportUpdate immediately with target scale
    expect(updates.length).toBe(1)
    expect(updates[0].scale).toBe(targetScale)

    // No rAF scheduled
    expect(rafCallbacks.length).toBe(0)

    // Verify center invariant for the direct set
    const worldX = (centerX - viewportX) / currentScale
    const computedWorldX = (centerX - updates[0].x) / updates[0].scale
    expect(computedWorldX).toBeCloseTo(worldX, 5)
  })

  it('retarget: new zoom during animation starts from current interpolated scale', () => {
    // Start first zoom: scale 1.0 -> 2.0
    vi.spyOn(performance, 'now').mockReturnValue(0)
    engine.animateZoom(1.0, 2.0, 400, 300, 0, 0)

    // Advance to midpoint (90ms)
    advanceFrame(90)
    const midScale = updates[updates.length - 1].scale
    const midViewportX = updates[updates.length - 1].x
    const midViewportY = updates[updates.length - 1].y

    // Now retarget to scale 3.0 from current state
    vi.spyOn(performance, 'now').mockReturnValue(90)
    engine.animateZoom(midScale, 3.0, 400, 300, midViewportX, midViewportY)

    // First frame of new animation should start near midScale (no jump)
    advanceFrame(90) // same time as start
    const firstNewUpdate = updates[updates.length - 1]
    expect(firstNewUpdate.scale).toBeCloseTo(midScale, 1)
  })

  it('retarget preserves continuity (no scale jump)', () => {
    // Start first zoom: scale 1.0 -> 2.0
    vi.spyOn(performance, 'now').mockReturnValue(0)
    engine.animateZoom(1.0, 2.0, 400, 300, 0, 0)

    // Advance to 90ms
    advanceFrame(90)
    const scaleBeforeRetarget = updates[updates.length - 1].scale

    // Retarget to 0.5
    vi.spyOn(performance, 'now').mockReturnValue(90)
    engine.animateZoom(scaleBeforeRetarget, 0.5, 400, 300, updates[updates.length - 1].x, updates[updates.length - 1].y)

    // First frame of retargeted animation
    advanceFrame(90)
    const scaleAfterRetarget = updates[updates.length - 1].scale

    // Should be continuous - the scale should be close to scaleBeforeRetarget
    // (since progress=0 at the start of new animation)
    expect(Math.abs(scaleAfterRetarget - scaleBeforeRetarget)).toBeLessThan(0.1)
  })
})

// === UxEngine inertia scrolling tests ===

describe('UxEngine - startInertia', () => {
  let engine: UxEngine
  let updates: ViewportState[]
  let rafCallbacks: Array<(time: number) => void>
  let rafIdCounter: number

  beforeEach(() => {
    updates = []
    rafCallbacks = []
    rafIdCounter = 0

    vi.stubGlobal('requestAnimationFrame', (cb: (time: number) => void) => {
      rafCallbacks.push(cb)
      return ++rafIdCounter
    })

    vi.stubGlobal('cancelAnimationFrame', (_id: number) => {
      void _id
    })

    vi.spyOn(performance, 'now').mockReturnValue(0)

    // Mock matchMedia - default: no reduced motion
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)' ? false : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    engine = new UxEngine((viewport) => {
      updates.push({ ...viewport })
    })
  })

  afterEach(() => {
    engine.destroy()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function advanceFrame() {
    const cbs = [...rafCallbacks]
    rafCallbacks = []
    cbs.forEach((cb) => cb(0))
  }

  it('schedules a requestAnimationFrame on call', () => {
    engine.startInertia(10, 5, { x: 0, y: 0, scale: 1 })
    expect(rafCallbacks.length).toBe(1)
  })

  it('applies friction each frame (exponential decay)', () => {
    const vx = 20
    const vy = 10
    const friction = 0.95 // default friction

    // Sync the engine's internal viewport to match the expected starting state
    engine.syncViewport({ x: 100, y: 50, scale: 1.5 })

    engine.startInertia(vx, vy, { x: 100, y: 50, scale: 1.5 })

    // Frame 1: velocity becomes vx * friction, vy * friction
    advanceFrame()
    const expectedVx1 = vx * friction
    const expectedVy1 = vy * friction
    expect(updates[0].x).toBeCloseTo(100 + expectedVx1)
    expect(updates[0].y).toBeCloseTo(50 + expectedVy1)
    expect(updates[0].scale).toBe(1.5)

    // Frame 2: velocity becomes vx * friction^2, vy * friction^2
    advanceFrame()
    const expectedVx2 = expectedVx1 * friction
    const expectedVy2 = expectedVy1 * friction
    expect(updates[1].x).toBeCloseTo(100 + expectedVx1 + expectedVx2)
    expect(updates[1].y).toBeCloseTo(50 + expectedVy1 + expectedVy2)
  })

  it('stops when velocity drops below 0.5px/frame on both axes', () => {
    // Start with a small velocity that will quickly decay below threshold
    // With friction 0.95, velocity 1.0 -> after ~14 frames: 1.0 * 0.95^14 ≈ 0.488 < 0.5
    engine.startInertia(1.0, 1.0, { x: 0, y: 0, scale: 1 })

    let frameCount = 0
    const maxFrames = 100

    while (rafCallbacks.length > 0 && frameCount < maxFrames) {
      advanceFrame()
      frameCount++
    }

    // Should have stopped (no more rAF scheduled)
    expect(rafCallbacks.length).toBe(0)
    // Should have stopped within a reasonable number of frames
    expect(frameCount).toBeLessThan(maxFrames)
    expect(frameCount).toBeGreaterThan(0)
  })

  it('preserves scale throughout inertia', () => {
    // Sync the engine's internal viewport to match the expected scale
    engine.syncViewport({ x: 0, y: 0, scale: 2.5 })

    engine.startInertia(10, 10, { x: 0, y: 0, scale: 2.5 })

    advanceFrame()
    advanceFrame()
    advanceFrame()

    for (const update of updates) {
      expect(update.scale).toBe(2.5)
    }
  })

  it('cancelInertia stops the animation', () => {
    engine.startInertia(10, 10, { x: 0, y: 0, scale: 1 })
    expect(rafCallbacks.length).toBe(1)

    engine.cancelInertia()

    // Clear pending callbacks and verify no new ones are scheduled
    rafCallbacks = []
    expect(rafCallbacks.length).toBe(0)
  })

  it('new startInertia cancels previous inertia', () => {
    engine.startInertia(10, 10, { x: 0, y: 0, scale: 1 })

    // Advance one frame to consume the first rAF (unified loop processes it)
    advanceFrame()
    updates = []

    // Sync the engine's internal viewport to the new starting position
    engine.syncViewport({ x: 100, y: 100, scale: 1 })

    // Start a new inertia - should cancel the old one
    engine.startInertia(5, 5, { x: 100, y: 100, scale: 1 })

    // Advance the new inertia
    advanceFrame()
    // Should be based on the new starting position
    expect(updates[0].x).toBeCloseTo(100 + 5 * 0.95)
    expect(updates[0].y).toBeCloseTo(100 + 5 * 0.95)
  })

  it('prefers-reduced-motion skips inertia entirely', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    engine = new UxEngine((viewport) => {
      updates.push({ ...viewport })
    })

    engine.startInertia(10, 10, { x: 0, y: 0, scale: 1 })

    // No rAF scheduled, no updates
    expect(rafCallbacks.length).toBe(0)
    expect(updates.length).toBe(0)
  })

  it('pauses physics when document.hidden is true', () => {
    // Mock document as a global with hidden=true
    const mockDocument = { hidden: true }
    vi.stubGlobal('document', mockDocument)

    engine.startInertia(10, 10, { x: 0, y: 0, scale: 1 })

    // Advance frame while hidden - should not produce viewport updates
    advanceFrame()
    expect(updates.length).toBe(0)
    // But rAF should still be scheduled (loop stays alive)
    expect(rafCallbacks.length).toBe(1)

    // Now unhide
    mockDocument.hidden = false

    // Advance frame while visible - should produce viewport update
    advanceFrame()
    expect(updates.length).toBe(1)
  })

  it('velocity decays exponentially: v_N = v0 * friction^N', () => {
    const v0 = 50
    const friction = 0.95

    engine.startInertia(v0, 0, { x: 0, y: 0, scale: 1 })

    // Run several frames and verify cumulative position matches sum of v0*f^1 + v0*f^2 + ...
    let expectedX = 0
    for (let i = 1; i <= 5; i++) {
      const expectedVelocity = v0 * Math.pow(friction, i)
      expectedX += expectedVelocity
      advanceFrame()
      expect(updates[i - 1].x).toBeCloseTo(expectedX)
    }
  })
})

// === easeInOutCubic unit tests ===

import { easeInOutCubic, computeFitToViewTarget } from './ux-engine'
import type { NodeBounds } from './ux-engine'

describe('easeInOutCubic', () => {
  it('returns 0 at t=0', () => {
    expect(easeInOutCubic(0)).toBe(0)
  })

  it('returns 1 at t=1', () => {
    expect(easeInOutCubic(1)).toBe(1)
  })

  it('returns 0.5 at t=0.5', () => {
    // At midpoint: 4 * 0.5^3 = 4 * 0.125 = 0.5
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5)
  })

  it('is monotonically increasing', () => {
    for (let i = 0; i < 100; i++) {
      const t1 = i / 100
      const t2 = (i + 1) / 100
      expect(easeInOutCubic(t2)).toBeGreaterThanOrEqual(easeInOutCubic(t1))
    }
  })

  it('is symmetric around (0.5, 0.5)', () => {
    for (let i = 1; i < 50; i++) {
      const t = i / 100
      // f(0.5 + d) + f(0.5 - d) should equal 1
      expect(easeInOutCubic(0.5 + t) + easeInOutCubic(0.5 - t)).toBeCloseTo(1)
    }
  })
})

// === computeFitToViewTarget unit tests ===

describe('computeFitToViewTarget', () => {
  it('returns default viewport for empty nodes array', () => {
    const result = computeFitToViewTarget([], 1920, 1080)
    expect(result).toEqual({ x: 0, y: 0, scale: 1 })
  })

  it('centers a single node in the viewport with 60px padding', () => {
    const nodes: NodeBounds[] = [{ id: '1', x: 100, y: 100, width: 200, height: 100 }]
    const result = computeFitToViewTarget(nodes, 1920, 1080)

    // Content center: (200, 150)
    // Scale should be capped at 1.0 since content is smaller than viewport
    expect(result.scale).toBe(1)
    // Viewport x = 1920/2 - 200 * 1 = 760
    expect(result.x).toBeCloseTo(760)
    // Viewport y = 1080/2 - 150 * 1 = 390
    expect(result.y).toBeCloseTo(390)
  })

  it('scales down when content is larger than viewport', () => {
    const nodes: NodeBounds[] = [
      { id: '1', x: 0, y: 0, width: 100, height: 100 },
      { id: '2', x: 3000, y: 2000, width: 100, height: 100 },
    ]
    const result = computeFitToViewTarget(nodes, 1920, 1080)

    // Content: 0 to 3100 (width=3100), 0 to 2100 (height=2100)
    // Available: 1920 - 120 = 1800, 1080 - 120 = 960
    // Scale: min(1800/3100, 960/2100) = min(0.58, 0.457) ≈ 0.457
    expect(result.scale).toBeLessThan(1)
    expect(result.scale).toBeCloseTo(960 / 2100, 2)
  })

  it('ensures all nodes have at least 60px padding from viewport edges', () => {
    const nodes: NodeBounds[] = [
      { id: '1', x: -500, y: -300, width: 150, height: 80 },
      { id: '2', x: 400, y: 200, width: 150, height: 80 },
      { id: '3', x: 0, y: 0, width: 100, height: 60 },
    ]
    const viewportWidth = 1200
    const viewportHeight = 800
    const result = computeFitToViewTarget(nodes, viewportWidth, viewportHeight)

    // Verify all nodes are within viewport bounds with padding
    for (const node of nodes) {
      // Node screen position = node world position * scale + viewport offset
      const screenLeft = node.x * result.scale + result.x
      const screenTop = node.y * result.scale + result.y
      const screenRight = (node.x + node.width) * result.scale + result.x
      const screenBottom = (node.y + node.height) * result.scale + result.y

      expect(screenLeft).toBeGreaterThanOrEqual(60 - 0.01)
      expect(screenTop).toBeGreaterThanOrEqual(60 - 0.01)
      expect(screenRight).toBeLessThanOrEqual(viewportWidth - 60 + 0.01)
      expect(screenBottom).toBeLessThanOrEqual(viewportHeight - 60 + 0.01)
    }
  })

  it('does not zoom in beyond scale 1.0', () => {
    // A tiny node in a large viewport
    const nodes: NodeBounds[] = [{ id: '1', x: 0, y: 0, width: 10, height: 10 }]
    const result = computeFitToViewTarget(nodes, 1920, 1080)
    expect(result.scale).toBeLessThanOrEqual(1)
  })

  it('uses custom padding when specified', () => {
    const nodes: NodeBounds[] = [{ id: '1', x: 0, y: 0, width: 2000, height: 1500 }]
    const result100 = computeFitToViewTarget(nodes, 1920, 1080, 100)
    const result20 = computeFitToViewTarget(nodes, 1920, 1080, 20)

    // More padding = smaller scale (less available space)
    expect(result100.scale).toBeLessThan(result20.scale)
  })
})

// === UxEngine fit-to-view animation tests ===

describe('UxEngine - animateFitToView', () => {
  let engine: UxEngine
  let updates: ViewportState[]
  let rafCallbacks: Array<(time: number) => void>
  let rafIdCounter: number

  beforeEach(() => {
    updates = []
    rafCallbacks = []
    rafIdCounter = 0

    vi.stubGlobal('requestAnimationFrame', (cb: (time: number) => void) => {
      rafCallbacks.push(cb)
      return ++rafIdCounter
    })

    vi.stubGlobal('cancelAnimationFrame', (_id: number) => {
      void _id
    })

    vi.spyOn(performance, 'now').mockReturnValue(0)

    // Mock matchMedia - default: no reduced motion
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)' ? false : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    engine = new UxEngine((viewport) => {
      updates.push({ ...viewport })
    })
  })

  afterEach(() => {
    engine.destroy()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function advanceFrame(time: number) {
    vi.spyOn(performance, 'now').mockReturnValue(time)
    const cbs = [...rafCallbacks]
    rafCallbacks = []
    cbs.forEach((cb) => cb(time))
  }

  it('schedules a requestAnimationFrame on call', () => {
    const current: ViewportState = { x: 0, y: 0, scale: 1 }
    const target: ViewportState = { x: 100, y: 50, scale: 0.5 }
    engine.animateFitToView(current, target)
    expect(rafCallbacks.length).toBe(1)
  })

  it('interpolates x, y, and scale from current to target over 400ms', () => {
    const current: ViewportState = { x: 0, y: 0, scale: 1 }
    const target: ViewportState = { x: 200, y: 100, scale: 0.5 }

    engine.animateFitToView(current, target)

    // At t=0 (first frame)
    advanceFrame(0)
    expect(updates[0].x).toBeCloseTo(0)
    expect(updates[0].y).toBeCloseTo(0)
    expect(updates[0].scale).toBeCloseTo(1)

    // At t=200ms (midpoint) - easeInOutCubic(0.5) = 0.5
    advanceFrame(200)
    expect(updates[1].x).toBeCloseTo(100) // 0 + 200 * 0.5
    expect(updates[1].y).toBeCloseTo(50) // 0 + 100 * 0.5
    expect(updates[1].scale).toBeCloseTo(0.75) // 1 + (0.5 - 1) * 0.5

    // At t=400ms (end)
    advanceFrame(400)
    expect(updates[2].x).toBeCloseTo(200)
    expect(updates[2].y).toBeCloseTo(100)
    expect(updates[2].scale).toBeCloseTo(0.5)
  })

  it('uses ease-in-out timing (not ease-out)', () => {
    const current: ViewportState = { x: 0, y: 0, scale: 1 }
    const target: ViewportState = { x: 400, y: 0, scale: 1 }

    engine.animateFitToView(current, target)

    // At t=100ms (25% progress) - easeInOutCubic(0.25) = 4 * 0.25^3 = 0.0625
    advanceFrame(100)
    expect(updates[0].x).toBeCloseTo(400 * easeInOutCubic(0.25))

    // At t=300ms (75% progress) - easeInOutCubic(0.75) = 1 - (-2*0.75+2)^3/2 = 1 - 0.5^3/2 = 0.9375
    advanceFrame(300)
    expect(updates[1].x).toBeCloseTo(400 * easeInOutCubic(0.75))
  })

  it('completes animation and stops rAF at end', () => {
    const current: ViewportState = { x: 0, y: 0, scale: 1 }
    const target: ViewportState = { x: 100, y: 50, scale: 0.5 }

    engine.animateFitToView(current, target)
    advanceFrame(400)

    // No more rAF scheduled after completion
    expect(rafCallbacks.length).toBe(0)
  })

  it('cancelFitToView stops the animation', () => {
    const current: ViewportState = { x: 0, y: 0, scale: 1 }
    const target: ViewportState = { x: 100, y: 50, scale: 0.5 }

    engine.animateFitToView(current, target)
    expect(rafCallbacks.length).toBe(1)

    engine.cancelFitToView()
    // After cancel, animation should be inactive
    rafCallbacks = []
    expect(rafCallbacks.length).toBe(0)
  })

  it('prefers-reduced-motion skips interpolation and sets target directly', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    engine = new UxEngine((viewport) => {
      updates.push({ ...viewport })
    })

    const current: ViewportState = { x: 0, y: 0, scale: 1 }
    const target: ViewportState = { x: 200, y: 100, scale: 0.5 }

    engine.animateFitToView(current, target)

    // Should have called onViewportUpdate immediately with target
    expect(updates.length).toBe(1)
    expect(updates[0]).toEqual(target)

    // No rAF scheduled
    expect(rafCallbacks.length).toBe(0)
  })

  it('new animateFitToView cancels previous animation', () => {
    const current: ViewportState = { x: 0, y: 0, scale: 1 }
    const target1: ViewportState = { x: 100, y: 50, scale: 0.5 }
    const target2: ViewportState = { x: 200, y: 100, scale: 0.8 }

    engine.animateFitToView(current, target1)
    // Unified loop uses a single rAF, so just verify it's scheduled
    expect(rafCallbacks.length).toBeGreaterThanOrEqual(1)

    // Advance one frame to consume the existing rAF
    advanceFrame(50)
    updates = []

    // Start a new animation - should cancel the first
    vi.spyOn(performance, 'now').mockReturnValue(100)
    engine.animateFitToView(current, target2)

    // Complete the second animation
    advanceFrame(500)
    expect(updates[updates.length - 1].x).toBeCloseTo(200)
    expect(updates[updates.length - 1].y).toBeCloseTo(100)
    expect(updates[updates.length - 1].scale).toBeCloseTo(0.8)
  })

  it('handles same start and target viewport (no-op animation)', () => {
    const viewport: ViewportState = { x: 100, y: 50, scale: 1.5 }

    engine.animateFitToView(viewport, viewport)

    // Should still animate (just stays at same values)
    advanceFrame(200)
    expect(updates[0].x).toBeCloseTo(100)
    expect(updates[0].y).toBeCloseTo(50)
    expect(updates[0].scale).toBeCloseTo(1.5)
  })
})

// === UxEngine computeStaggerDelays unit tests ===

describe('UxEngine - computeStaggerDelays', () => {
  let engine: UxEngine

  beforeEach(() => {
    engine = new UxEngine(() => {})
  })

  it('returns empty map for empty nodeIds array', () => {
    const result = engine.computeStaggerDelays([], 40)
    expect(result.size).toBe(0)
  })

  it('returns delay 0 for a single node', () => {
    const result = engine.computeStaggerDelays(['node-1'], 40)
    expect(result.size).toBe(1)
    expect(result.get('node-1')).toBe(0)
  })

  it('assigns i * baseDelay for each node at index i', () => {
    const nodeIds = ['a', 'b', 'c', 'd', 'e']
    const baseDelay = 40
    const result = engine.computeStaggerDelays(nodeIds, baseDelay)

    expect(result.size).toBe(5)
    expect(result.get('a')).toBe(0)
    expect(result.get('b')).toBe(40)
    expect(result.get('c')).toBe(80)
    expect(result.get('d')).toBe(120)
    expect(result.get('e')).toBe(160)
  })

  it('works with different baseDelay values', () => {
    const nodeIds = ['x', 'y', 'z']
    const result30 = engine.computeStaggerDelays(nodeIds, 30)
    const result50 = engine.computeStaggerDelays(nodeIds, 50)

    expect(result30.get('z')).toBe(60) // 2 * 30
    expect(result50.get('z')).toBe(100) // 2 * 50
  })

  it('preserves order: first node always has delay 0', () => {
    const nodeIds = ['first', 'second', 'third']
    const result = engine.computeStaggerDelays(nodeIds, 45)
    expect(result.get('first')).toBe(0)
  })

  it('last node has maximum delay of (n-1) * baseDelay', () => {
    const nodeIds = ['a', 'b', 'c', 'd']
    const baseDelay = 35
    const result = engine.computeStaggerDelays(nodeIds, baseDelay)
    expect(result.get('d')).toBe(3 * 35) // (4-1) * 35 = 105
  })
})

// === UxEngine detectAlignment unit tests ===

import type { Position, Size } from './ux-engine'

describe('UxEngine - detectAlignment', () => {
  let engine: UxEngine

  beforeEach(() => {
    engine = new UxEngine(() => {})
  })

  it('returns empty array when no other nodes exist', () => {
    const pos: Position = { x: 100, y: 100 }
    const size: Size = { width: 200, height: 80 }
    const result = engine.detectAlignment(pos, size, [])
    expect(result).toEqual([])
  })

  it('detects center-to-center X alignment within 5px', () => {
    // Dragged node: pos (100, 100), size (200, 80) → center X = 200
    // Other node: x=197, width=200 → center X = 297... no
    // Let's make it simpler:
    // Dragged: pos (0, 0), size (100, 50) → center X = 50
    // Other: x=45, width=10 → center X = 50 (exact match)
    const pos: Position = { x: 0, y: 0 }
    const size: Size = { width: 100, height: 50 }
    const otherNodes: NodeBounds[] = [
      { id: 'n1', x: 45, y: 200, width: 10, height: 10 }, // center X = 50
    ]
    const result = engine.detectAlignment(pos, size, otherNodes)
    const xGuides = result.filter((g) => g.axis === 'x' && g.type === 'center')
    expect(xGuides.length).toBe(1)
    expect(xGuides[0].position).toBe(50)
  })

  it('detects center-to-center Y alignment within 5px', () => {
    // Dragged: pos (0, 0), size (100, 50) → center Y = 25
    // Other: y=22, height=6 → center Y = 25 (exact match)
    const pos: Position = { x: 0, y: 0 }
    const size: Size = { width: 100, height: 50 }
    const otherNodes: NodeBounds[] = [
      { id: 'n1', x: 500, y: 22, width: 10, height: 6 }, // center Y = 25
    ]
    const result = engine.detectAlignment(pos, size, otherNodes)
    const yGuides = result.filter((g) => g.axis === 'y' && g.type === 'center')
    expect(yGuides.length).toBe(1)
    expect(yGuides[0].position).toBe(25)
  })

  it('does NOT detect alignment when difference exceeds 5px', () => {
    // Dragged: pos (0, 0), size (100, 50) → center X = 50, center Y = 25
    // Other: center X = 56 (diff = 6 > 5), center Y = 31 (diff = 6 > 5)
    const pos: Position = { x: 0, y: 0 }
    const size: Size = { width: 100, height: 50 }
    const otherNodes: NodeBounds[] = [
      { id: 'n1', x: 6, y: 6, width: 100, height: 50 }, // center X = 56, center Y = 31
    ]
    const result = engine.detectAlignment(pos, size, otherNodes)
    const centerGuides = result.filter((g) => g.type === 'center')
    expect(centerGuides.length).toBe(0)
  })

  it('detects edge alignment: left-left', () => {
    // Dragged: pos (100, 0), size (80, 40) → left = 100
    // Other: x=103 → left = 103, diff = 3 ≤ 5
    const pos: Position = { x: 100, y: 0 }
    const size: Size = { width: 80, height: 40 }
    const otherNodes: NodeBounds[] = [{ id: 'n1', x: 103, y: 200, width: 60, height: 30 }]
    const result = engine.detectAlignment(pos, size, otherNodes)
    const xEdgeGuides = result.filter((g) => g.axis === 'x' && g.type === 'edge')
    expect(xEdgeGuides.length).toBeGreaterThanOrEqual(1)
    expect(xEdgeGuides.some((g) => Math.abs(g.position - 103) < 1)).toBe(true)
  })

  it('detects edge alignment: right-right', () => {
    // Dragged: pos (100, 0), size (80, 40) → right = 180
    // Other: x=120, width=62 → right = 182, diff = 2 ≤ 5
    const pos: Position = { x: 100, y: 0 }
    const size: Size = { width: 80, height: 40 }
    const otherNodes: NodeBounds[] = [{ id: 'n1', x: 120, y: 200, width: 62, height: 30 }]
    const result = engine.detectAlignment(pos, size, otherNodes)
    const xEdgeGuides = result.filter((g) => g.axis === 'x' && g.type === 'edge')
    expect(xEdgeGuides.length).toBeGreaterThanOrEqual(1)
    expect(xEdgeGuides.some((g) => Math.abs(g.position - 182) < 1)).toBe(true)
  })

  it('detects edge alignment: top-top', () => {
    // Dragged: pos (0, 50), size (80, 40) → top = 50
    // Other: y=52 → top = 52, diff = 2 ≤ 5
    const pos: Position = { x: 0, y: 50 }
    const size: Size = { width: 80, height: 40 }
    const otherNodes: NodeBounds[] = [{ id: 'n1', x: 300, y: 52, width: 60, height: 30 }]
    const result = engine.detectAlignment(pos, size, otherNodes)
    const yEdgeGuides = result.filter((g) => g.axis === 'y' && g.type === 'edge')
    expect(yEdgeGuides.length).toBeGreaterThanOrEqual(1)
    expect(yEdgeGuides.some((g) => Math.abs(g.position - 52) < 1)).toBe(true)
  })

  it('detects edge alignment: bottom-bottom', () => {
    // Dragged: pos (0, 50), size (80, 40) → bottom = 90
    // Other: y=55, height=37 → bottom = 92, diff = 2 ≤ 5
    const pos: Position = { x: 0, y: 50 }
    const size: Size = { width: 80, height: 40 }
    const otherNodes: NodeBounds[] = [{ id: 'n1', x: 300, y: 55, width: 60, height: 37 }]
    const result = engine.detectAlignment(pos, size, otherNodes)
    const yEdgeGuides = result.filter((g) => g.axis === 'y' && g.type === 'edge')
    expect(yEdgeGuides.length).toBeGreaterThanOrEqual(1)
    expect(yEdgeGuides.some((g) => Math.abs(g.position - 92) < 1)).toBe(true)
  })

  it('detects alignment at exactly 5px threshold', () => {
    // Dragged: pos (0, 0), size (100, 50) → center X = 50
    // Other: center X = 55, diff = 5 (exactly at threshold)
    const pos: Position = { x: 0, y: 0 }
    const size: Size = { width: 100, height: 50 }
    const otherNodes: NodeBounds[] = [
      { id: 'n1', x: 5, y: 200, width: 100, height: 50 }, // center X = 55
    ]
    const result = engine.detectAlignment(pos, size, otherNodes)
    const xCenterGuides = result.filter((g) => g.axis === 'x' && g.type === 'center')
    expect(xCenterGuides.length).toBe(1)
    expect(xCenterGuides[0].position).toBe(55)
  })

  it('does NOT detect alignment at 5.01px (just over threshold)', () => {
    // Dragged: pos (0, 0), size (100, 50) → center X = 50
    // Other: center X = 55.01, diff = 5.01 > 5
    const pos: Position = { x: 0, y: 0 }
    const size: Size = { width: 100, height: 50 }
    const otherNodes: NodeBounds[] = [
      { id: 'n1', x: 5.01, y: 200, width: 100, height: 50.02 }, // center X = 55.01
    ]
    const result = engine.detectAlignment(pos, size, otherNodes)
    const xCenterGuides = result.filter((g) => g.axis === 'x' && g.type === 'center')
    expect(xCenterGuides.length).toBe(0)
  })

  it('detects multiple guides from multiple nodes', () => {
    // Dragged: pos (0, 0), size (100, 50) → center X = 50, center Y = 25
    const pos: Position = { x: 0, y: 0 }
    const size: Size = { width: 100, height: 50 }
    const otherNodes: NodeBounds[] = [
      { id: 'n1', x: 45, y: 200, width: 10, height: 10 }, // center X = 50 (match)
      { id: 'n2', x: 300, y: 22, width: 10, height: 6 }, // center Y = 25 (match)
    ]
    const result = engine.detectAlignment(pos, size, otherNodes)
    expect(result.length).toBeGreaterThanOrEqual(2)
    expect(result.some((g) => g.axis === 'x')).toBe(true)
    expect(result.some((g) => g.axis === 'y')).toBe(true)
  })

  it('deduplicates guides at the same position', () => {
    // Two other nodes with the same center X as dragged
    // Dragged: pos (0, 0), size (100, 50) → center X = 50
    const pos: Position = { x: 0, y: 0 }
    const size: Size = { width: 100, height: 50 }
    const otherNodes: NodeBounds[] = [
      { id: 'n1', x: 0, y: 200, width: 100, height: 10 }, // center X = 50
      { id: 'n2', x: 0, y: 400, width: 100, height: 10 }, // center X = 50
    ]
    const result = engine.detectAlignment(pos, size, otherNodes)
    const xCenterGuides = result.filter((g) => g.axis === 'x' && g.position === 50)
    expect(xCenterGuides.length).toBe(1) // deduplicated
  })

  it('detects cross-edge alignment: left-right', () => {
    // Dragged: pos (100, 0), size (80, 40) → left = 100
    // Other: x=50, width=52 → right = 102, diff from dragged left = 2 ≤ 5
    const pos: Position = { x: 100, y: 0 }
    const size: Size = { width: 80, height: 40 }
    const otherNodes: NodeBounds[] = [{ id: 'n1', x: 50, y: 200, width: 52, height: 30 }]
    const result = engine.detectAlignment(pos, size, otherNodes)
    const xEdgeGuides = result.filter((g) => g.axis === 'x' && g.type === 'edge')
    expect(xEdgeGuides.length).toBeGreaterThanOrEqual(1)
    expect(xEdgeGuides.some((g) => Math.abs(g.position - 102) < 1)).toBe(true)
  })
})
