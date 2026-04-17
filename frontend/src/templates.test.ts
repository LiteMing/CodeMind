import { describe, it, expect } from 'vitest'
import { normalizeAITemplateId, templateLabel, normalizedRelationPairKey } from './templates'

describe('normalizeAITemplateId', () => {
  it('returns known template IDs unchanged', () => {
    expect(normalizeAITemplateId('project-planning')).toBe('project-planning')
    expect(normalizeAITemplateId('character-network')).toBe('character-network')
  })

  it('defaults to concept-graph for unknown values', () => {
    expect(normalizeAITemplateId('unknown')).toBe('concept-graph')
    expect(normalizeAITemplateId('')).toBe('concept-graph')
  })
})

describe('templateLabel', () => {
  it('returns English labels', () => {
    expect(templateLabel('project-planning', 'en')).toBe('Project Planning Graph')
    expect(templateLabel('character-network', 'en')).toBe('Character Network')
    expect(templateLabel('concept-graph', 'en')).toBe('Concept Graph')
  })

  it('returns Chinese labels', () => {
    expect(templateLabel('project-planning', 'zh-CN')).toBe('项目规划图谱')
    expect(templateLabel('character-network', 'zh-CN')).toBe('人物关系图谱')
    expect(templateLabel('concept-graph', 'zh-CN')).toBe('概念知识图谱')
  })
})

describe('normalizedRelationPairKey', () => {
  it('produces consistent key regardless of order', () => {
    expect(normalizedRelationPairKey('a', 'b')).toBe('a::b')
    expect(normalizedRelationPairKey('b', 'a')).toBe('a::b')
  })

  it('handles equal values', () => {
    expect(normalizedRelationPairKey('x', 'x')).toBe('x::x')
  })
})
