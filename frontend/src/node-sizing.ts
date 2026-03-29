import type { MindNode, NodeKind } from './types'

export const ROOT_NODE_MIN_WIDTH = 182
export const TOPIC_NODE_MIN_WIDTH = 156
export const ROOT_NODE_MIN_HEIGHT = 64
export const TOPIC_NODE_MIN_HEIGHT = 52
export const ROOT_NODE_MAX_WIDTH = 560
export const TOPIC_NODE_MAX_WIDTH = 520

const ROOT_TEXT_FONT = '700 17px "Sora", "Noto Sans SC", sans-serif'
const TOPIC_TEXT_FONT = '500 16px "Sora", "Noto Sans SC", sans-serif'
const BADGE_TEXT_FONT = '500 12px "IBM Plex Mono", "Consolas", monospace'
const ROOT_HORIZONTAL_PADDING = 42
const TOPIC_HORIZONTAL_PADDING = 30
const ROOT_VERTICAL_PADDING = 34
const TOPIC_VERTICAL_PADDING = 30
const ROOT_LINE_HEIGHT = 28
const TOPIC_LINE_HEIGHT = 22
const MIN_CONTENT_WIDTH = 72
const INLINE_GAP = 10

let measureCanvas: HTMLCanvasElement | null = null

export function estimateNodeWidth(node: MindNode, childCount = 0): number {
  const minWidth = resolveNodeMinWidth(node.kind)
  if (node.width) {
    return Math.max(node.width, minWidth)
  }

  const maxWidth = resolveNodeMaxWidth(node.kind)
  const titleWidth = node.title
    .split(/\r?\n/)
    .reduce((maxWidthSoFar, line) => Math.max(maxWidthSoFar, measureText(line || ' ', resolveNodeFont(node.kind))), 0)
  const accessoryWidth = resolveAccessoryWidth(node, childCount)
  const baseWidth = titleWidth + resolveHorizontalPadding(node.kind) + accessoryWidth

  return clamp(Math.round(baseWidth), minWidth, maxWidth)
}

export function estimateNodeHeight(node: MindNode, childCount = 0, width = estimateNodeWidth(node, childCount)): number {
  const minHeight = resolveNodeMinHeight(node.kind)
  if (node.height) {
    return Math.max(node.height, minHeight)
  }

  const contentWidth = Math.max(
    width - resolveHorizontalPadding(node.kind) - resolveAccessoryWidth(node, childCount),
    MIN_CONTENT_WIDTH,
  )
  const titleLines = node.title.split(/\r?\n/)
  const lineCount = titleLines.reduce((total, line) => {
    const measuredWidth = measureText(line || ' ', resolveNodeFont(node.kind))
    return total + Math.max(1, Math.ceil(measuredWidth / contentWidth))
  }, 0)

  return Math.max(minHeight, Math.round(resolveVerticalPadding(node.kind) + lineCount * resolveLineHeight(node.kind)))
}

export function resolveNodeMinWidth(kind: NodeKind): number {
  return kind === 'root' ? ROOT_NODE_MIN_WIDTH : TOPIC_NODE_MIN_WIDTH
}

export function resolveNodeMinHeight(kind: NodeKind): number {
  return kind === 'root' ? ROOT_NODE_MIN_HEIGHT : TOPIC_NODE_MIN_HEIGHT
}

export function resolveNodeMaxWidth(kind: NodeKind): number {
  return kind === 'root' ? ROOT_NODE_MAX_WIDTH : TOPIC_NODE_MAX_WIDTH
}

function resolveAccessoryWidth(node: MindNode, childCount: number): number {
  const badges: string[] = []
  if (node.priority) {
    badges.push(node.priority)
  }
  if (childCount > 0) {
    badges.push(String(childCount))
  }
  if (badges.length === 0) {
    return 0
  }

  const totalBadgeWidth = badges.reduce((sum, badge) => sum + Math.max(34, Math.ceil(measureText(badge, BADGE_TEXT_FONT) + 20)), 0)
  return totalBadgeWidth + badges.length * INLINE_GAP
}

function resolveNodeFont(kind: NodeKind): string {
  return kind === 'root' ? ROOT_TEXT_FONT : TOPIC_TEXT_FONT
}

function resolveHorizontalPadding(kind: NodeKind): number {
  return kind === 'root' ? ROOT_HORIZONTAL_PADDING : TOPIC_HORIZONTAL_PADDING
}

function resolveVerticalPadding(kind: NodeKind): number {
  return kind === 'root' ? ROOT_VERTICAL_PADDING : TOPIC_VERTICAL_PADDING
}

function resolveLineHeight(kind: NodeKind): number {
  return kind === 'root' ? ROOT_LINE_HEIGHT : TOPIC_LINE_HEIGHT
}

function measureText(text: string, font: string): number {
  const context = getMeasureContext()
  if (!context) {
    return roughMeasureText(text)
  }

  context.font = font
  return context.measureText(text).width
}

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') {
    return null
  }
  if (!measureCanvas) {
    measureCanvas = document.createElement('canvas')
  }
  return measureCanvas.getContext('2d')
}

function roughMeasureText(text: string): number {
  let total = 0
  for (const char of text) {
    if (/\s/.test(char)) {
      total += 4.5
      continue
    }
    if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\uff00-\uffef]/.test(char)) {
      total += 16
      continue
    }
    if (/[A-Z]/.test(char)) {
      total += 10
      continue
    }
    if (/[0-9a-z]/.test(char)) {
      total += 8.5
      continue
    }
    total += 9.5
  }
  return total
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
