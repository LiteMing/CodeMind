import type { AIDebugInfo, Locale, MindMapDocument, MindNode, Position } from './types'
import { childrenOf } from './document'
import { estimateNodeHeight, estimateNodeWidth } from './node-sizing'

export const WORKSPACE_MIN_WIDTH = 2400
export const WORKSPACE_MIN_HEIGHT = 1600
export const WORKSPACE_PADDING = 360

export interface WorkspaceBounds {
  minX: number
  minY: number
  width: number
  height: number
  originX: number
  originY: number
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function clampMin(value: number, min: number): number {
  return Math.max(value, min)
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function escapeAttribute(value: string): string {
  return escapeHtml(value)
}

export function shorten(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`
}

export function formatRelativeTime(value: string, locale: Locale): string {
  const targetTime = Date.parse(value)
  if (Number.isNaN(targetTime)) {
    return value
  }

  const diffMinutes = Math.round((targetTime - Date.now()) / (60 * 1000))
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const absMinutes = Math.abs(diffMinutes)

  if (absMinutes < 60) {
    return formatter.format(diffMinutes, 'minute')
  }

  const diffHours = Math.round(diffMinutes / 60)
  if (Math.abs(diffHours) < 24) {
    return formatter.format(diffHours, 'hour')
  }

  const diffDays = Math.round(diffHours / 24)
  if (Math.abs(diffDays) < 30) {
    return formatter.format(diffDays, 'day')
  }

  const diffMonths = Math.round(diffDays / 30)
  if (Math.abs(diffMonths) < 12) {
    return formatter.format(diffMonths, 'month')
  }

  const diffYears = Math.round(diffDays / 365)
  return formatter.format(diffYears, 'year')
}

export function nodeCenter(node: MindNode): Position {
  return {
    x: node.position.x,
    y: node.position.y,
  }
}

export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function slugify(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')

  return normalized || 'code-mind'
}

export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
  )
}

export function parsePixelValue(value: string | null | undefined): number {
  const parsed = Number.parseFloat(value ?? '')
  return Number.isFinite(parsed) ? parsed : 0
}

export function directionalPrimaryDelta(direction: string, deltaX: number, deltaY: number): number {
  if (direction === 'ArrowUp') {
    return -deltaY
  }
  if (direction === 'ArrowDown') {
    return deltaY
  }
  if (direction === 'ArrowLeft') {
    return -deltaX
  }
  return deltaX
}

export function directionalCrossDelta(direction: string, deltaX: number, deltaY: number): number {
  if (direction === 'ArrowUp' || direction === 'ArrowDown') {
    return deltaX
  }
  return deltaY
}

export function getAIDebugInfo(error: unknown): AIDebugInfo | undefined {
  if (!error || typeof error !== 'object' || !('debug' in error)) {
    return undefined
  }

  const candidate = (error as { debug?: Partial<AIDebugInfo> }).debug
  if (!candidate) {
    return undefined
  }

  return {
    rawMode: Boolean(candidate.rawMode),
    upstreamRequest: typeof candidate.upstreamRequest === 'string' ? candidate.upstreamRequest : '',
    upstreamResponse: typeof candidate.upstreamResponse === 'string' ? candidate.upstreamResponse : '',
    assistantContent: typeof candidate.assistantContent === 'string' ? candidate.assistantContent : '',
  }
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return 'Unknown error'
}

export function cloneDocument(document: MindMapDocument): MindMapDocument {
  return JSON.parse(JSON.stringify(document)) as MindMapDocument
}

export function normalizeClientRect(startX: number, startY: number, endX: number, endY: number): DOMRect {
  const left = Math.min(startX, endX)
  const top = Math.min(startY, endY)
  const width = Math.abs(endX - startX)
  const height = Math.abs(endY - startY)
  return new DOMRect(left, top, width, height)
}

export function rectanglesIntersect(
  left: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>,
  right: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>,
): boolean {
  return left.left <= right.right && left.right >= right.left && left.top <= right.bottom && left.bottom >= right.top
}

export function rectanglesOverlapCoords(
  leftA: number,
  topA: number,
  rightA: number,
  bottomA: number,
  leftB: number,
  topB: number,
  rightB: number,
  bottomB: number,
): boolean {
  return leftA <= rightB && rightA >= leftB && topA <= bottomB && bottomA >= topB
}

export function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector)
  if (!element) {
    throw new Error(`Missing required element: ${selector}`)
  }
  return element
}

export function getWorkspaceBounds(document: MindMapDocument): WorkspaceBounds {
  let minX = 0
  let minY = 0
  let maxX = WORKSPACE_MIN_WIDTH
  let maxY = WORKSPACE_MIN_HEIGHT

  for (const node of document.nodes) {
    const childCount = childrenOf(document, node.id).length
    const nodeWidth = estimateNodeWidth(node, childCount)
    const nodeHeight = estimateNodeHeight(node, childCount, nodeWidth)
    minX = Math.min(minX, node.position.x - nodeWidth / 2 - WORKSPACE_PADDING)
    minY = Math.min(minY, node.position.y - nodeHeight / 2 - WORKSPACE_PADDING)
    maxX = Math.max(maxX, node.position.x + nodeWidth / 2 + WORKSPACE_PADDING)
    maxY = Math.max(maxY, node.position.y + nodeHeight / 2 + WORKSPACE_PADDING)
  }

  if (document.regions) {
    for (const region of document.regions) {
      minX = Math.min(minX, region.position.x - region.width / 2 - WORKSPACE_PADDING)
      minY = Math.min(minY, region.position.y - region.height / 2 - WORKSPACE_PADDING)
      maxX = Math.max(maxX, region.position.x + region.width / 2 + WORKSPACE_PADDING)
      maxY = Math.max(maxY, region.position.y + region.height / 2 + WORKSPACE_PADDING)
    }
  }

  const width = Math.max(WORKSPACE_MIN_WIDTH, Math.ceil(maxX - minX))
  const height = Math.max(WORKSPACE_MIN_HEIGHT, Math.ceil(maxY - minY))
  return {
    minX,
    minY,
    width,
    height,
    originX: -minX,
    originY: -minY,
  }
}
