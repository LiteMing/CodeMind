/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MinimapRenderer } from './ux-engine'
import type { MinimapNodeData } from './ux-engine'

// Mock canvas 2D context since jsdom doesn't support it
function mockCanvasContext() {
  const mockCtx = {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    measureText: vi.fn(() => ({ width: 0 })),
    setTransform: vi.fn(),
    resetTransform: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    transform: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(0), width: 0, height: 0 })),
    putImageData: vi.fn(),
    canvas: null as unknown as HTMLCanvasElement,
  }

  // Patch HTMLCanvasElement.prototype.getContext
  const originalGetContext = HTMLCanvasElement.prototype.getContext

  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, contextId: string) {
    if (contextId === '2d') {
      mockCtx.canvas = this
      return mockCtx as unknown as CanvasRenderingContext2D
    }
    return originalGetContext.call(this, contextId as '2d')
  } as typeof HTMLCanvasElement.prototype.getContext

  return {
    mockCtx,
    restore() {
      HTMLCanvasElement.prototype.getContext = originalGetContext
    },
  }
}

describe('MinimapRenderer', () => {
  let container: HTMLElement
  let renderer: MinimapRenderer
  let canvasMock: ReturnType<typeof mockCanvasContext>

  beforeEach(() => {
    canvasMock = mockCanvasContext()

    // Create a mock container
    container = document.createElement('div')
    document.body.appendChild(container)

    renderer = new MinimapRenderer(container, 180, 120)
  })

  afterEach(() => {
    renderer.destroy()
    container.remove()
    canvasMock.restore()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('creates a canvas element with correct dimensions', () => {
    const canvas = renderer.getCanvas()
    expect(canvas).toBeInstanceOf(HTMLCanvasElement)
    expect(canvas.width).toBe(180)
    expect(canvas.height).toBe(120)
  })

  it('positions canvas in bottom-right corner', () => {
    const canvas = renderer.getCanvas()
    expect(canvas.style.position).toBe('fixed')
    expect(canvas.style.bottom).toBe('16px')
    expect(canvas.style.right).toBe('16px')
  })

  it('starts with idle opacity (0.4)', () => {
    const canvas = renderer.getCanvas()
    expect(canvas.style.opacity).toBe('0.4')
  })

  it('transitions to hover opacity (0.85) on mouseenter', () => {
    const canvas = renderer.getCanvas()
    canvas.dispatchEvent(new MouseEvent('mouseenter'))
    expect(canvas.style.opacity).toBe('0.85')
  })

  it('transitions back to idle opacity (0.4) on mouseleave', () => {
    const canvas = renderer.getCanvas()
    canvas.dispatchEvent(new MouseEvent('mouseenter'))
    canvas.dispatchEvent(new MouseEvent('mouseleave'))
    expect(canvas.style.opacity).toBe('0.4')
  })

  it('exposes hovered state via getter', () => {
    const canvas = renderer.getCanvas()
    expect(renderer.hovered).toBe(false)
    canvas.dispatchEvent(new MouseEvent('mouseenter'))
    expect(renderer.hovered).toBe(true)
    canvas.dispatchEvent(new MouseEvent('mouseleave'))
    expect(renderer.hovered).toBe(false)
  })

  it('accepts node data via setNodes', () => {
    const nodes: MinimapNodeData[] = [
      { x: 0, y: 0, width: 100, height: 50, color: 'red' },
      { x: 200, y: 100, width: 80, height: 40 },
    ]
    expect(() => renderer.setNodes(nodes)).not.toThrow()
  })

  it('accepts viewport data via setViewport', () => {
    expect(() =>
      renderer.setViewport({
        x: 100,
        y: 50,
        scale: 1.5,
        screenWidth: 1920,
        screenHeight: 1080,
      }),
    ).not.toThrow()
  })

  it('renders without error when calling render()', () => {
    renderer.setNodes([
      { x: 0, y: 0, width: 100, height: 50 },
      { x: 200, y: 100, width: 80, height: 40 },
    ])
    renderer.setViewport({
      x: 0,
      y: 0,
      scale: 1,
      screenWidth: 800,
      screenHeight: 600,
    })
    expect(() => renderer.render()).not.toThrow()
  })

  it('calls canvas 2D context methods when rendering nodes', () => {
    renderer.setNodes([{ x: 0, y: 0, width: 100, height: 50, color: 'rgba(255,0,0,0.8)' }])
    renderer.setViewport({
      x: 0,
      y: 0,
      scale: 1,
      screenWidth: 800,
      screenHeight: 600,
    })
    renderer.render()

    // Should have cleared the canvas
    expect(canvasMock.mockCtx.clearRect).toHaveBeenCalled()
    // Should have drawn at least the background + 1 node rect + viewport rect
    expect(canvasMock.mockCtx.fillRect).toHaveBeenCalled()
  })

  it('draws viewport rectangle when viewport data is set', () => {
    renderer.setNodes([{ x: 0, y: 0, width: 100, height: 50 }])
    renderer.setViewport({
      x: 0,
      y: 0,
      scale: 1,
      screenWidth: 800,
      screenHeight: 600,
    })
    renderer.render()

    // Should have drawn the viewport stroke rect
    expect(canvasMock.mockCtx.strokeRect).toHaveBeenCalled()
  })

  it('removes canvas from DOM on destroy', () => {
    expect(container.querySelector('canvas')).not.toBeNull()
    renderer.destroy()
    expect(container.querySelector('canvas')).toBeNull()
  })

  it('has CSS transition for opacity', () => {
    const canvas = renderer.getCanvas()
    expect(canvas.style.transition).toContain('opacity')
  })

  it('appends canvas to the provided container', () => {
    const canvasElements = container.querySelectorAll('canvas')
    expect(canvasElements.length).toBe(1)
  })

  it('canvas has minimap-canvas class', () => {
    const canvas = renderer.getCanvas()
    expect(canvas.className).toBe('minimap-canvas')
  })

  it('canvas has pointer-events auto for interaction', () => {
    const canvas = renderer.getCanvas()
    expect(canvas.style.pointerEvents).toBe('auto')
  })

  it('canvas has cursor pointer for clickability', () => {
    const canvas = renderer.getCanvas()
    expect(canvas.style.cursor).toBe('pointer')
  })

  describe('minimapToWorld', () => {
    it('returns null when no nodes or viewport data is set', () => {
      const result = renderer.minimapToWorld(90, 60)
      expect(result).toBeNull()
    })

    it('maps center of minimap to center of world bounds', () => {
      // Set nodes spanning from (0,0) to (800,600)
      renderer.setNodes([{ x: 0, y: 0, width: 800, height: 600 }])
      renderer.render()

      // The world bounds are minX=0, minY=0, worldWidth=800, worldHeight=600
      // padding=8, availW=164, availH=104
      // scaleX=164/800=0.205, scaleY=104/600=0.1733 → mapScale=0.1733
      // contentW=800*0.1733=138.67, contentH=600*0.1733=104
      // offsetX=8+(164-138.67)/2=20.67, offsetY=8+(104-104)/2=8
      // Center of minimap is (90, 60)
      // worldX = (90 - 20.67) / 0.1733 + 0 = 400
      // worldY = (60 - 8) / 0.1733 + 0 = 300
      const result = renderer.minimapToWorld(90, 60)
      expect(result).not.toBeNull()
      // Center of world should be approximately (400, 300)
      expect(result!.worldX).toBeCloseTo(400, 0)
      expect(result!.worldY).toBeCloseTo(300, 0)
    })

    it('maps top-left corner of content area to world minX/minY', () => {
      renderer.setNodes([{ x: 100, y: 50, width: 400, height: 300 }])
      renderer.render()

      // World bounds: minX=100, minY=50, worldWidth=400, worldHeight=300
      // padding=8, availW=164, availH=104
      // scaleX=164/400=0.41, scaleY=104/300=0.3467 → mapScale=0.3467
      // contentW=400*0.3467=138.67, contentH=300*0.3467=104
      // offsetX=8+(164-138.67)/2=20.67, offsetY=8+(104-104)/2=8
      // At minimap pixel (offsetX, offsetY) = (20.67, 8):
      // worldX = (20.67 - 20.67) / 0.3467 + 100 = 100
      // worldY = (8 - 8) / 0.3467 + 50 = 50
      const result = renderer.minimapToWorld(20.67, 8)
      expect(result).not.toBeNull()
      expect(result!.worldX).toBeCloseTo(100, 0)
      expect(result!.worldY).toBeCloseTo(50, 0)
    })

    it('correctly maps when viewport data is also set', () => {
      renderer.setNodes([{ x: 0, y: 0, width: 200, height: 100 }])
      renderer.setViewport({
        x: 0,
        y: 0,
        scale: 1,
        screenWidth: 200,
        screenHeight: 100,
      })
      renderer.render()

      // With viewport at origin and scale 1, visible area is (0,0)-(200,100)
      // Combined with node bounds: minX=0, minY=0, maxX=200, maxY=100
      // worldWidth=200, worldHeight=100
      const result = renderer.minimapToWorld(90, 60)
      expect(result).not.toBeNull()
      // Should map to center of world
      expect(result!.worldX).toBeCloseTo(100, 0)
      expect(result!.worldY).toBeCloseTo(50, 0)
    })
  })
})
