import type { Locale, MindNode } from './types'
import { resolveNodeMinHeight, resolveNodeMinWidth } from './node-sizing'
import { shorten } from './utils'

export const MIN_NODE_WIDTH = resolveNodeMinWidth('topic')
export const MIN_NODE_HEIGHT = resolveNodeMinHeight('topic')

export function buildNodeDimensionStyle(node: MindNode, preview?: { width: number; height: number }): string {
  const styles: string[] = []
  if (preview) {
    styles.push(`width: ${Math.max(preview.width, MIN_NODE_WIDTH)}px;`)
    styles.push(`height: ${Math.max(preview.height, MIN_NODE_HEIGHT)}px;`)
    styles.push('max-width: none;')
  } else if (node.width) {
    styles.push(`width: ${Math.max(node.width, MIN_NODE_WIDTH)}px;`)
    styles.push('max-width: none;')
  }
  if (!preview && node.height) {
    styles.push(`height: ${Math.max(node.height, MIN_NODE_HEIGHT)}px;`)
  }
  return styles.join(' ')
}

export function nodeVisibleTitle(node: MindNode): string {
  return node.title
}

export function normalizeNodeNote(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.replace(/\r\n/g, '\n').trim()
  return normalized ? normalized : undefined
}

export function deriveNoteChildTitle(parent: MindNode, note: string, locale: Locale): string {
  const normalized = note.replace(/\s+/g, ' ').trim()
  const firstChunk = normalized.split(/(?<=[。！？.!?])\s+|\n+/).find((item) => item.trim().length > 0) ?? normalized
  const maxLength = locale === 'zh-CN' ? 18 : 28
  const compact = shorten(firstChunk.trim(), maxLength)

  if (compact.length >= (locale === 'zh-CN' ? 6 : 10)) {
    return compact
  }

  return locale === 'zh-CN' ? `${parent.title} 注释` : `${parent.title} Note`
}
