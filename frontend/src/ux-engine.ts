// ux-engine.ts — JS 动画引擎核心模块
// 负责所有需要 JS 驱动的动画逻辑：zoom 插值、惯性滚动、fit-to-view、stagger、对齐检测

// === Interfaces ===

export interface ViewportState {
  x: number
  y: number
  scale: number
}

export interface InertiaState {
  active: boolean
  velocityX: number
  velocityY: number
  friction: number
  rafId: number | null
}

export interface ZoomAnimState {
  active: boolean
  startScale: number
  targetScale: number
  centerX: number
  centerY: number
  worldX: number
  worldY: number
  startTime: number
  duration: number
  rafId: number | null
}

export interface FitViewAnimState {
  active: boolean
  startViewport: ViewportState
  targetViewport: ViewportState
  startTime: number
  duration: number
  rafId: number | null
}

export type ViewportUpdateCallback = (viewport: ViewportState) => void

export interface Position {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface NodeBounds {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export interface AlignmentGuide {
  axis: 'x' | 'y'
  position: number
  type: 'center' | 'edge'
}

// === Pure Functions ===

/**
 * Ease-out cubic timing function.
 * easeOutCubic(t) = 1 - (1 - t)³
 */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

/**
 * Ease-in-out cubic timing function.
 * Accelerates until halfway, then decelerates.
 * easeInOutCubic(t) = t < 0.5 ? 4t³ : 1 - (-2t + 2)³ / 2
 */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/**
 * Compute the target viewport that fits all nodes with padding.
 * If no nodes exist, returns the default viewport (center, scale 1.0).
 *
 * @param nodes - Array of node bounding boxes
 * @param viewportWidth - Width of the viewport in pixels
 * @param viewportHeight - Height of the viewport in pixels
 * @param padding - Padding in pixels on each side (default 60)
 * @returns Target ViewportState that fits all nodes
 */
export function computeFitToViewTarget(
  nodes: NodeBounds[],
  viewportWidth: number,
  viewportHeight: number,
  padding: number = 60,
): ViewportState {
  // Empty canvas: return default viewport
  if (nodes.length === 0) {
    return { x: 0, y: 0, scale: 1 }
  }

  // Compute bounding box of all nodes
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const node of nodes) {
    minX = Math.min(minX, node.x)
    minY = Math.min(minY, node.y)
    maxX = Math.max(maxX, node.x + node.width)
    maxY = Math.max(maxY, node.y + node.height)
  }

  // Content dimensions
  const contentWidth = maxX - minX
  const contentHeight = maxY - minY

  // Available viewport space after padding
  const availableWidth = viewportWidth - padding * 2
  const availableHeight = viewportHeight - padding * 2

  // Compute scale to fit content within available space
  let scale: number
  if (contentWidth <= 0 || contentHeight <= 0) {
    scale = 1
  } else {
    scale = Math.min(availableWidth / contentWidth, availableHeight / contentHeight)
  }

  // Cap scale at 1.0 (don't zoom in beyond 100%)
  scale = Math.min(scale, 1)

  // Compute viewport position to center the content
  const contentCenterX = (minX + maxX) / 2
  const contentCenterY = (minY + maxY) / 2

  // The viewport position (x, y) represents the translation applied to the canvas.
  // To center content: viewportX = viewportWidth/2 - contentCenterX * scale
  const x = viewportWidth / 2 - contentCenterX * scale
  const y = viewportHeight / 2 - contentCenterY * scale

  return { x, y, scale }
}

// === UxEngine Class ===

export class UxEngine {
  private inertia: InertiaState
  private zoomAnim: ZoomAnimState
  private fitViewAnim: FitViewAnimState
  private onViewportUpdate: ViewportUpdateCallback

  // Unified animation loop: a single rAF drives all concurrent animations
  private loopRafId: number | null = null
  // The "ground truth" viewport that the unified loop maintains
  private currentViewport: ViewportState = { x: 0, y: 0, scale: 1 }

  constructor(onViewportUpdate: ViewportUpdateCallback) {
    this.onViewportUpdate = onViewportUpdate

    this.inertia = {
      active: false,
      velocityX: 0,
      velocityY: 0,
      friction: 0.95,
      rafId: null,
    }

    this.zoomAnim = {
      active: false,
      startScale: 1,
      targetScale: 1,
      centerX: 0,
      centerY: 0,
      worldX: 0,
      worldY: 0,
      startTime: 0,
      duration: 180,
      rafId: null,
    }

    this.fitViewAnim = {
      active: false,
      startViewport: { x: 0, y: 0, scale: 1 },
      targetViewport: { x: 0, y: 0, scale: 1 },
      startTime: 0,
      duration: 400,
      rafId: null,
    }
  }

  // --- Unified animation loop ---

  /**
   * The unified tick processes all active animations each frame and emits
   * a single viewport update. This allows inertia + zoom to compose naturally.
   */
  private readonly unifiedTick = (): void => {
    this.loopRafId = null

    // If document is hidden, keep loop alive but skip physics
    if (typeof document !== 'undefined' && document.hidden) {
      if (this.hasActiveAnimations()) {
        this.loopRafId = requestAnimationFrame(this.unifiedTick)
      }
      return
    }

    const vp = { ...this.currentViewport }
    let changed = false

    // 1. Process fit-to-view (exclusive — overrides everything)
    if (this.fitViewAnim.active) {
      const now = performance.now()
      const elapsed = now - this.fitViewAnim.startTime
      const progress = Math.min(elapsed / this.fitViewAnim.duration, 1)
      const easedProgress = easeInOutCubic(progress)

      vp.x =
        this.fitViewAnim.startViewport.x +
        (this.fitViewAnim.targetViewport.x - this.fitViewAnim.startViewport.x) * easedProgress
      vp.y =
        this.fitViewAnim.startViewport.y +
        (this.fitViewAnim.targetViewport.y - this.fitViewAnim.startViewport.y) * easedProgress
      vp.scale =
        this.fitViewAnim.startViewport.scale +
        (this.fitViewAnim.targetViewport.scale - this.fitViewAnim.startViewport.scale) * easedProgress

      if (progress >= 1) {
        this.fitViewAnim.active = false
      }
      changed = true
    } else {
      // 2. Process zoom interpolation (computes viewport from center invariant)
      if (this.zoomAnim.active) {
        const now = performance.now()
        const elapsed = now - this.zoomAnim.startTime
        const progress = Math.min(elapsed / this.zoomAnim.duration, 1)
        const easedProgress = easeOutCubic(progress)

        const interpolatedScale =
          this.zoomAnim.startScale + (this.zoomAnim.targetScale - this.zoomAnim.startScale) * easedProgress

        // Center point invariant: world point stays at screen center
        vp.x = this.zoomAnim.centerX - this.zoomAnim.worldX * interpolatedScale
        vp.y = this.zoomAnim.centerY - this.zoomAnim.worldY * interpolatedScale
        vp.scale = interpolatedScale

        if (progress >= 1) {
          this.zoomAnim.active = false
        }
        changed = true
      }

      // 3. Process inertia (additive displacement on top of zoom result)
      if (this.inertia.active) {
        // Apply friction
        this.inertia.velocityX *= this.inertia.friction
        this.inertia.velocityY *= this.inertia.friction

        // Stop condition
        if (Math.abs(this.inertia.velocityX) < 0.5 && Math.abs(this.inertia.velocityY) < 0.5) {
          this.inertia.active = false
        } else {
          // Apply displacement additively
          vp.x += this.inertia.velocityX
          vp.y += this.inertia.velocityY

          // If zoom is also active, shift the zoom's world point to account for inertia drift
          // so the center invariant stays correct relative to the moving viewport
          if (this.zoomAnim.active) {
            this.zoomAnim.worldX = (this.zoomAnim.centerX - vp.x) / vp.scale
            this.zoomAnim.worldY = (this.zoomAnim.centerY - vp.y) / vp.scale
          }

          changed = true
        }
      }
    }

    if (changed) {
      this.currentViewport = vp
      this.onViewportUpdate(vp)
    }

    // Continue loop if any animation is still active
    if (this.hasActiveAnimations()) {
      this.loopRafId = requestAnimationFrame(this.unifiedTick)
    }
  }

  private hasActiveAnimations(): boolean {
    return this.inertia.active || this.zoomAnim.active || this.fitViewAnim.active
  }

  private ensureLoopRunning(): void {
    if (this.loopRafId === null && this.hasActiveAnimations()) {
      this.loopRafId = requestAnimationFrame(this.unifiedTick)
    }
  }

  /**
   * Sync the engine's internal viewport with the app's viewport.
   * Call this when the app changes viewport externally (e.g., direct pan).
   */
  syncViewport(viewport: ViewportState): void {
    this.currentViewport = { ...viewport }
  }

  // --- Zoom interpolation ---

  /**
   * Animate zoom from currentScale to targetScale, keeping the world-space
   * coordinate at screen point (centerX, centerY) fixed throughout.
   *
   * If an animation is already in progress (retarget), it captures the current
   * interpolated scale and restarts from there — no visual jump.
   *
   * When prefers-reduced-motion is active, skips interpolation and directly
   * sets the target viewport state.
   */
  animateZoom(
    currentScale: number,
    targetScale: number,
    centerX: number,
    centerY: number,
    viewportX: number,
    viewportY: number,
  ): void {
    // prefers-reduced-motion: skip interpolation, directly set target
    if (this.prefersReducedMotion()) {
      const worldX = (centerX - viewportX) / currentScale
      const worldY = (centerY - viewportY) / currentScale
      const newViewportX = centerX - worldX * targetScale
      const newViewportY = centerY - worldY * targetScale
      const vp = { x: newViewportX, y: newViewportY, scale: targetScale }
      this.currentViewport = vp
      this.onViewportUpdate(vp)
      return
    }

    // Use the engine's internal viewport as ground truth (more accurate than caller's)
    let startScale = this.currentViewport.scale
    let startViewportX = this.currentViewport.x
    let startViewportY = this.currentViewport.y

    if (this.zoomAnim.active) {
      // Retarget: compute current interpolated state from the in-progress animation
      const now = performance.now()
      const elapsed = now - this.zoomAnim.startTime
      const progress = Math.min(elapsed / this.zoomAnim.duration, 1)
      const easedProgress = easeOutCubic(progress)

      startScale = this.zoomAnim.startScale + (this.zoomAnim.targetScale - this.zoomAnim.startScale) * easedProgress

      // Recompute viewport from stored world point for consistency
      startViewportX = this.zoomAnim.centerX - this.zoomAnim.worldX * startScale
      startViewportY = this.zoomAnim.centerY - this.zoomAnim.worldY * startScale
    }

    // Compute the world-space coordinate at the zoom center (invariant point)
    const worldX = (centerX - startViewportX) / startScale
    const worldY = (centerY - startViewportY) / startScale

    // Set up animation state
    this.zoomAnim.active = true
    this.zoomAnim.startScale = startScale
    this.zoomAnim.targetScale = targetScale
    this.zoomAnim.centerX = centerX
    this.zoomAnim.centerY = centerY
    this.zoomAnim.worldX = worldX
    this.zoomAnim.worldY = worldY
    this.zoomAnim.startTime = performance.now()
    // rafId no longer used (unified loop), but keep for interface compat
    this.zoomAnim.rafId = null

    this.ensureLoopRunning()
  }

  cancelZoom(): void {
    this.zoomAnim.active = false
    this.zoomAnim.rafId = null
  }

  /**
   * Detect if the user prefers reduced motion.
   */
  private prefersReducedMotion(): boolean {
    if (typeof globalThis.matchMedia === 'function') {
      return globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches
    }
    return false
  }

  // --- Inertia scrolling ---

  /**
   * Start inertia scrolling after a pan gesture ends.
   *
   * Uses an exponential decay model: velocity *= friction each frame.
   * Stops when both |velocityX| and |velocityY| drop below 0.5px/frame.
   *
   * Composes with zoom: inertia displacement is applied additively on top of
   * zoom interpolation each frame.
   *
   * When prefers-reduced-motion is active, skips inertia entirely.
   */
  startInertia(velocityX: number, velocityY: number, _currentViewport: ViewportState): void {
    // prefers-reduced-motion: skip inertia entirely
    if (this.prefersReducedMotion()) {
      return
    }

    // Cancel any existing inertia
    this.inertia.active = false

    // Set up inertia state
    this.inertia.active = true
    this.inertia.velocityX = velocityX
    this.inertia.velocityY = velocityY
    this.inertia.rafId = null

    this.ensureLoopRunning()
  }

  cancelInertia(): void {
    this.inertia.active = false
    this.inertia.rafId = null
  }

  // --- Fit-to-view ---

  /**
   * Animate from the current viewport to the target viewport using ease-in-out
   * cubic interpolation over the configured duration (400ms).
   *
   * Fit-to-view is exclusive: it cancels inertia and zoom.
   *
   * When prefers-reduced-motion is active, skips interpolation and directly
   * sets the target viewport state.
   */
  animateFitToView(current: ViewportState, target: ViewportState): void {
    // Cancel other animations — fit-to-view is exclusive
    this.cancelZoom()
    this.cancelInertia()

    // prefers-reduced-motion: skip interpolation, directly set target
    if (this.prefersReducedMotion()) {
      this.currentViewport = { ...target }
      this.onViewportUpdate(target)
      return
    }

    // Set up animation state
    this.fitViewAnim.active = true
    this.fitViewAnim.startViewport = { ...current }
    this.fitViewAnim.targetViewport = { ...target }
    this.fitViewAnim.startTime = performance.now()
    this.fitViewAnim.rafId = null

    this.ensureLoopRunning()
  }

  cancelFitToView(): void {
    this.fitViewAnim.active = false
    this.fitViewAnim.rafId = null
  }

  // --- Stagger helpers ---

  /**
   * Compute stagger delays for a list of node IDs.
   * Each node at index i gets a delay of i * baseDelay (ms).
   * Used for collapse/expand and subtree deletion animations.
   *
   * @param nodeIds - Array of node IDs in the desired animation order (e.g., depth-first)
   * @param baseDelay - Base delay between each node's animation start (typically 30–50ms)
   * @returns Map from nodeId to delay in ms
   */
  computeStaggerDelays(nodeIds: string[], baseDelay: number): Map<string, number> {
    const delays = new Map<string, number>()
    for (let i = 0; i < nodeIds.length; i++) {
      delays.set(nodeIds[i], i * baseDelay)
    }
    return delays
  }

  // --- Alignment detection ---

  /**
   * Detect alignment guides between the dragged node and other nodes.
   *
   * Checks both center-to-center and edge-to-edge alignment on X and Y axes.
   * Returns guides when the absolute difference is within the ALIGNMENT_THRESHOLD (5px).
   *
   * For X axis (vertical guide lines):
   *   - Center alignment: dragged center X vs other center X
   *   - Edge alignment: left-left, left-right, right-left, right-right
   *
   * For Y axis (horizontal guide lines):
   *   - Center alignment: dragged center Y vs other center Y
   *   - Edge alignment: top-top, top-bottom, bottom-top, bottom-bottom
   */
  detectAlignment(draggedPos: Position, draggedSize: Size, otherNodes: NodeBounds[]): AlignmentGuide[] {
    const ALIGNMENT_THRESHOLD = 5
    const guides: AlignmentGuide[] = []
    const seenX = new Set<number>()
    const seenY = new Set<number>()

    // Compute dragged node geometry
    const draggedCenterX = draggedPos.x + draggedSize.width / 2
    const draggedCenterY = draggedPos.y + draggedSize.height / 2
    const draggedLeft = draggedPos.x
    const draggedRight = draggedPos.x + draggedSize.width
    const draggedTop = draggedPos.y
    const draggedBottom = draggedPos.y + draggedSize.height

    for (const other of otherNodes) {
      // Compute other node geometry
      const otherCenterX = other.x + other.width / 2
      const otherCenterY = other.y + other.height / 2
      const otherLeft = other.x
      const otherRight = other.x + other.width
      const otherTop = other.y
      const otherBottom = other.y + other.height

      // --- X axis checks (produce vertical guide lines) ---

      // Center-to-center X
      if (Math.abs(draggedCenterX - otherCenterX) <= ALIGNMENT_THRESHOLD) {
        const pos = Math.round(otherCenterX)
        if (!seenX.has(pos)) {
          seenX.add(pos)
          guides.push({ axis: 'x', position: otherCenterX, type: 'center' })
        }
      }

      // Edge alignments X: left-left, left-right, right-left, right-right
      const xEdgePairs: Array<[number, number]> = [
        [draggedLeft, otherLeft],
        [draggedLeft, otherRight],
        [draggedRight, otherLeft],
        [draggedRight, otherRight],
      ]
      for (const [draggedEdge, otherEdge] of xEdgePairs) {
        if (Math.abs(draggedEdge - otherEdge) <= ALIGNMENT_THRESHOLD) {
          const pos = Math.round(otherEdge)
          if (!seenX.has(pos)) {
            seenX.add(pos)
            guides.push({ axis: 'x', position: otherEdge, type: 'edge' })
          }
        }
      }

      // --- Y axis checks (produce horizontal guide lines) ---

      // Center-to-center Y
      if (Math.abs(draggedCenterY - otherCenterY) <= ALIGNMENT_THRESHOLD) {
        const pos = Math.round(otherCenterY)
        if (!seenY.has(pos)) {
          seenY.add(pos)
          guides.push({ axis: 'y', position: otherCenterY, type: 'center' })
        }
      }

      // Edge alignments Y: top-top, top-bottom, bottom-top, bottom-bottom
      const yEdgePairs: Array<[number, number]> = [
        [draggedTop, otherTop],
        [draggedTop, otherBottom],
        [draggedBottom, otherTop],
        [draggedBottom, otherBottom],
      ]
      for (const [draggedEdge, otherEdge] of yEdgePairs) {
        if (Math.abs(draggedEdge - otherEdge) <= ALIGNMENT_THRESHOLD) {
          const pos = Math.round(otherEdge)
          if (!seenY.has(pos)) {
            seenY.add(pos)
            guides.push({ axis: 'y', position: otherEdge, type: 'edge' })
          }
        }
      }
    }

    return guides
  }

  // --- Cleanup ---

  destroy(): void {
    this.cancelZoom()
    this.cancelInertia()
    this.cancelFitToView()
  }
}

// === Minimap Renderer ===

export interface MinimapNodeData {
  x: number
  y: number
  width: number
  height: number
  color?: string
}

export interface MinimapViewportData {
  /** Viewport offset X in world coordinates */
  x: number
  /** Viewport offset Y in world coordinates */
  y: number
  /** Current zoom scale */
  scale: number
  /** Viewport width in screen pixels */
  screenWidth: number
  /** Viewport height in screen pixels */
  screenHeight: number
}

export class MinimapRenderer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private readonly width: number
  private readonly height: number
  private _hovered = false
  private currentOpacity: number
  private targetOpacity: number
  private opacityRafId: number | null = null

  // Throttle state
  private lastRenderTime = 0
  private renderRafId: number | null = null
  private isActive = false
  private activeTimeout: number | null = null
  private idleRenderInterval: number | null = null

  // Cached data for rendering
  private nodes: MinimapNodeData[] = []
  private viewportData: MinimapViewportData | null = null
  private dirty = true

  // Configuration
  private readonly hoverOpacity = 0.85
  private readonly idleOpacity = 0.4
  private readonly activeFrameInterval = 1000 / 60 // ~16.67ms for 60fps
  private readonly idleFrameInterval = 1000 / 10 // 100ms for 10fps

  constructor(container: HTMLElement, width = 180, height = 120) {
    this.width = width
    this.height = height
    this.currentOpacity = this.idleOpacity
    this.targetOpacity = this.idleOpacity

    // Create canvas element
    this.canvas = document.createElement('canvas')
    this.canvas.width = width
    this.canvas.height = height
    this.canvas.className = 'minimap-canvas'
    this.canvas.style.position = 'fixed'
    this.canvas.style.bottom = '16px'
    this.canvas.style.right = '16px'
    this.canvas.style.width = `${width}px`
    this.canvas.style.height = `${height}px`
    this.canvas.style.borderRadius = '6px'
    this.canvas.style.boxShadow = '0 2px 8px rgba(0,0,0,0.25)'
    this.canvas.style.opacity = String(this.currentOpacity)
    this.canvas.style.transition = 'opacity 200ms ease'
    this.canvas.style.zIndex = '100'
    this.canvas.style.pointerEvents = 'auto'
    this.canvas.style.cursor = 'pointer'

    const ctx = this.canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Failed to get 2D context for minimap canvas')
    }
    this.ctx = ctx

    // Attach hover listeners for opacity transition
    this.canvas.addEventListener('mouseenter', this.handleMouseEnter)
    this.canvas.addEventListener('mouseleave', this.handleMouseLeave)

    container.appendChild(this.canvas)

    // Start idle render loop
    this.startIdleRenderLoop()
  }

  /** Get the canvas element (for external event binding like click/drag) */
  getCanvas(): HTMLCanvasElement {
    return this.canvas
  }

  /** Whether the minimap is currently hovered */
  get hovered(): boolean {
    return this._hovered
  }

  /** Update node data for rendering */
  setNodes(nodes: MinimapNodeData[]): void {
    this.nodes = nodes
    this.dirty = true
    this.markActive()
  }

  /** Update viewport data for rendering */
  setViewport(viewport: MinimapViewportData): void {
    this.viewportData = viewport
    this.dirty = true
    this.markActive()
  }

  /** Mark the minimap as active (triggers 60fps rendering) */
  markActive(): void {
    this.isActive = true

    // Clear previous active timeout
    if (this.activeTimeout !== null) {
      clearTimeout(this.activeTimeout)
    }

    // Schedule transition back to idle after 500ms of no activity
    this.activeTimeout = window.setTimeout(() => {
      this.isActive = false
      this.activeTimeout = null
    }, 500)

    // Schedule a render if not already pending
    this.scheduleRender()
  }

  /** Force an immediate render */
  render(): void {
    this.dirty = true
    this.drawFrame()
  }

  /** Destroy the minimap and clean up resources */
  destroy(): void {
    this.canvas.removeEventListener('mouseenter', this.handleMouseEnter)
    this.canvas.removeEventListener('mouseleave', this.handleMouseLeave)

    if (this.renderRafId !== null) {
      cancelAnimationFrame(this.renderRafId)
      this.renderRafId = null
    }
    if (this.opacityRafId !== null) {
      cancelAnimationFrame(this.opacityRafId)
      this.opacityRafId = null
    }
    if (this.activeTimeout !== null) {
      clearTimeout(this.activeTimeout)
      this.activeTimeout = null
    }
    if (this.idleRenderInterval !== null) {
      clearInterval(this.idleRenderInterval)
      this.idleRenderInterval = null
    }

    this.canvas.remove()
  }

  // --- Private methods ---

  private readonly handleMouseEnter = (): void => {
    this._hovered = true
    this.targetOpacity = this.hoverOpacity
    this.canvas.style.opacity = String(this.targetOpacity)
    this.currentOpacity = this.targetOpacity
  }

  private readonly handleMouseLeave = (): void => {
    this._hovered = false
    this.targetOpacity = this.idleOpacity
    this.canvas.style.opacity = String(this.targetOpacity)
    this.currentOpacity = this.targetOpacity
  }

  private startIdleRenderLoop(): void {
    // Use setInterval for idle rendering at 10fps
    this.idleRenderInterval = window.setInterval(() => {
      if (!this.isActive && this.dirty) {
        this.drawFrame()
      }
    }, this.idleFrameInterval)
  }

  private scheduleRender(): void {
    if (this.renderRafId !== null) return

    this.renderRafId = requestAnimationFrame(() => {
      this.renderRafId = null
      const now = performance.now()

      // Throttle: respect frame interval based on active/idle state
      const frameInterval = this.isActive ? this.activeFrameInterval : this.idleFrameInterval
      if (now - this.lastRenderTime < frameInterval) {
        // Re-schedule if we're too early
        if (this.dirty) {
          this.scheduleRender()
        }
        return
      }

      this.drawFrame()
    })
  }

  private drawFrame(): void {
    if (!this.dirty) return
    this.dirty = false
    this.lastRenderTime = performance.now()

    const ctx = this.ctx
    const w = this.width
    const h = this.height

    // Clear canvas
    ctx.clearRect(0, 0, w, h)

    // Draw background
    ctx.fillStyle = 'rgba(30, 30, 30, 0.85)'
    ctx.fillRect(0, 0, w, h)

    // Compute world bounds from all nodes
    const bounds = this.computeWorldBounds()
    if (!bounds) return

    const { minX, minY, worldWidth, worldHeight } = bounds

    // Compute scale to fit all nodes into minimap with padding
    const padding = 8
    const availW = w - padding * 2
    const availH = h - padding * 2
    const scaleX = worldWidth > 0 ? availW / worldWidth : 1
    const scaleY = worldHeight > 0 ? availH / worldHeight : 1
    const mapScale = Math.min(scaleX, scaleY)

    // Offset to center the content
    const contentW = worldWidth * mapScale
    const contentH = worldHeight * mapScale
    const offsetX = padding + (availW - contentW) / 2
    const offsetY = padding + (availH - contentH) / 2

    // Draw nodes as simplified rectangles
    for (const node of this.nodes) {
      const nx = offsetX + (node.x - minX) * mapScale
      const ny = offsetY + (node.y - minY) * mapScale
      const nw = Math.max(2, node.width * mapScale)
      const nh = Math.max(2, node.height * mapScale)

      ctx.fillStyle = node.color || 'rgba(100, 160, 255, 0.8)'
      ctx.fillRect(nx, ny, nw, nh)
    }

    // Draw viewport rectangle
    if (this.viewportData) {
      const vp = this.viewportData

      // The viewport shows what's visible on screen.
      // viewport.x and viewport.y are the translation applied to the canvas.
      // The visible world area is:
      //   worldLeft = -vp.x / vp.scale
      //   worldTop = -vp.y / vp.scale
      //   worldVisibleWidth = vp.screenWidth / vp.scale
      //   worldVisibleHeight = vp.screenHeight / vp.scale
      const worldLeft = -vp.x / vp.scale
      const worldTop = -vp.y / vp.scale
      const worldVisibleWidth = vp.screenWidth / vp.scale
      const worldVisibleHeight = vp.screenHeight / vp.scale

      // Map to minimap coordinates
      const vpX = offsetX + (worldLeft - minX) * mapScale
      const vpY = offsetY + (worldTop - minY) * mapScale
      const vpW = worldVisibleWidth * mapScale
      const vpH = worldVisibleHeight * mapScale

      // Draw semi-transparent viewport rectangle
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)'
      ctx.lineWidth = 1.5
      ctx.strokeRect(vpX, vpY, vpW, vpH)

      // Fill with very subtle overlay
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'
      ctx.fillRect(vpX, vpY, vpW, vpH)
    }
  }

  /**
   * Convert a minimap pixel coordinate to a world coordinate.
   * Returns null if the minimap has no content to map against.
   */
  minimapToWorld(mx: number, my: number): { worldX: number; worldY: number } | null {
    const bounds = this.computeWorldBounds()
    if (!bounds) return null

    const { minX, minY, worldWidth, worldHeight } = bounds

    const padding = 8
    const availW = this.width - padding * 2
    const availH = this.height - padding * 2
    const scaleX = worldWidth > 0 ? availW / worldWidth : 1
    const scaleY = worldHeight > 0 ? availH / worldHeight : 1
    const mapScale = Math.min(scaleX, scaleY)

    const contentW = worldWidth * mapScale
    const contentH = worldHeight * mapScale
    const offsetX = padding + (availW - contentW) / 2
    const offsetY = padding + (availH - contentH) / 2

    const worldX = (mx - offsetX) / mapScale + minX
    const worldY = (my - offsetY) / mapScale + minY

    return { worldX, worldY }
  }

  private computeWorldBounds(): { minX: number; minY: number; worldWidth: number; worldHeight: number } | null {
    if (this.nodes.length === 0 && !this.viewportData) return null

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    for (const node of this.nodes) {
      minX = Math.min(minX, node.x)
      minY = Math.min(minY, node.y)
      maxX = Math.max(maxX, node.x + node.width)
      maxY = Math.max(maxY, node.y + node.height)
    }

    // Also include viewport bounds to ensure the viewport rect is always visible
    if (this.viewportData) {
      const vp = this.viewportData
      const worldLeft = -vp.x / vp.scale
      const worldTop = -vp.y / vp.scale
      const worldRight = worldLeft + vp.screenWidth / vp.scale
      const worldBottom = worldTop + vp.screenHeight / vp.scale

      minX = Math.min(minX, worldLeft)
      minY = Math.min(minY, worldTop)
      maxX = Math.max(maxX, worldRight)
      maxY = Math.max(maxY, worldBottom)
    }

    // Handle edge case where bounds are invalid
    if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
      return null
    }

    const worldWidth = Math.max(1, maxX - minX)
    const worldHeight = Math.max(1, maxY - minY)

    return { minX, minY, worldWidth, worldHeight }
  }
}
