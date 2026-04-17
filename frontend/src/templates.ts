import type { AITemplateId, Locale, MindMapDocument, Priority, RelationEdge } from './types'
import { createDefaultDocument, createId, createNode, findRoot, touchDocument } from './document'

export const AI_TEMPLATES: Array<{ id: AITemplateId }> = [
  { id: 'concept-graph' },
  { id: 'project-planning' },
  { id: 'character-network' },
]

export function normalizeAITemplateId(value: string): AITemplateId {
  switch (value) {
    case 'project-planning':
      return 'project-planning'
    case 'character-network':
      return 'character-network'
    default:
      return 'concept-graph'
  }
}

export function templateLabel(templateId: AITemplateId, locale: Locale): string {
  if (locale === 'zh-CN') {
    switch (templateId) {
      case 'project-planning':
        return '项目规划图谱'
      case 'character-network':
        return '人物关系图谱'
      default:
        return '概念知识图谱'
    }
  }

  switch (templateId) {
    case 'project-planning':
      return 'Project Planning Graph'
    case 'character-network':
      return 'Character Network'
    default:
      return 'Concept Graph'
  }
}

export function promptTemplateCopy(templateId: AITemplateId, locale: Locale): string {
  if (locale === 'zh-CN') {
    switch (templateId) {
      case 'project-planning':
        return '模板提示词：围绕目标、范围、里程碑、风险、依赖、资源和成功指标，生成一个可直接用于执行沟通的项目脑图。'
      case 'character-network':
        return '模板提示词：围绕人物、阵营、动机、冲突、盟友、关键事件，生成一个便于阅读关系线的角色网络图。'
      default:
        return '模板提示词：围绕定义、核心概念、机制、应用、对比、风险和案例，生成一个高密度概念知识图谱。'
    }
  }

  switch (templateId) {
    case 'project-planning':
      return 'Template prompt: generate a project map around goals, scope, milestones, risks, dependencies, resources, and success metrics.'
    case 'character-network':
      return 'Template prompt: generate a character network around roles, factions, motivations, conflicts, alliances, and turning points.'
    default:
      return 'Template prompt: generate a concept graph around definition, components, mechanisms, applications, comparisons, risks, and examples.'
  }
}

export function createTemplateDocument(templateId: AITemplateId, locale: Locale): MindMapDocument {
  const doc = createDefaultDocument()
  const root = findRoot(doc)
  const rootTitle =
    templateId === 'project-planning'
      ? locale === 'zh-CN'
        ? '项目规划模板'
        : 'Project Planning Template'
      : templateId === 'character-network'
        ? locale === 'zh-CN'
          ? '人物关系模板'
          : 'Character Network Template'
        : locale === 'zh-CN'
          ? '概念图谱模板'
          : 'Concept Graph Template'

  root.title = rootTitle
  doc.title = rootTitle

  const now = new Date().toISOString()
  const addNode = (title: string, x: number, y: number, parentId = 'root', priority: Priority = ''): string => {
    const node = createNode({
      title,
      position: { x, y },
      kind: parentId ? 'topic' : 'floating',
      parentId: parentId || undefined,
    })
    node.priority = priority
    node.createdAt = now
    node.updatedAt = now
    doc.nodes.push(node)
    return node.id
  }

  if (templateId === 'project-planning') {
    const goals = addNode(
      locale === 'zh-CN' ? '目标' : 'Goals',
      root.position.x + 280,
      root.position.y - 140,
      'root',
      'P1',
    )
    const scope = addNode(locale === 'zh-CN' ? '范围' : 'Scope', root.position.x + 280, root.position.y - 20)
    const timeline = addNode(locale === 'zh-CN' ? '里程碑' : 'Milestones', root.position.x + 280, root.position.y + 120)
    const risks = addNode(locale === 'zh-CN' ? '风险' : 'Risks', root.position.x - 280, root.position.y - 90)
    const resources = addNode(locale === 'zh-CN' ? '资源' : 'Resources', root.position.x - 280, root.position.y + 70)
    const metrics = addNode(locale === 'zh-CN' ? '指标' : 'Metrics', root.position.x - 280, root.position.y + 190)
    addNode(locale === 'zh-CN' ? '验收标准' : 'Acceptance', root.position.x + 560, root.position.y - 140, goals)
    addNode(locale === 'zh-CN' ? '边界' : 'Boundaries', root.position.x + 560, root.position.y - 20, scope)
    addNode(locale === 'zh-CN' ? '关键日期' : 'Dates', root.position.x + 560, root.position.y + 120, timeline)
    addNode(locale === 'zh-CN' ? '依赖' : 'Dependencies', root.position.x - 560, root.position.y - 120, risks)
    addNode(locale === 'zh-CN' ? '预算' : 'Budget', root.position.x - 560, root.position.y + 30, resources)
    addNode(locale === 'zh-CN' ? '复盘' : 'Review', root.position.x - 560, root.position.y + 210, metrics)
    doc.relations.push(createTemplateRelation(scope, timeline, locale === 'zh-CN' ? '影响排期' : 'affects timeline'))
    doc.relations.push(createTemplateRelation(resources, risks, locale === 'zh-CN' ? '缓解' : 'mitigates'))
  } else if (templateId === 'character-network') {
    const roles = addNode(locale === 'zh-CN' ? '主要角色' : 'Main Roles', root.position.x + 280, root.position.y - 130)
    const factions = addNode(locale === 'zh-CN' ? '阵营' : 'Factions', root.position.x + 280, root.position.y + 20)
    const motives = addNode(locale === 'zh-CN' ? '动机' : 'Motivations', root.position.x - 280, root.position.y - 70)
    const conflicts = addNode(
      locale === 'zh-CN' ? '冲突' : 'Conflicts',
      root.position.x - 280,
      root.position.y + 120,
      'root',
      'P1',
    )
    const hero = addNode(
      locale === 'zh-CN' ? '主角' : 'Protagonist',
      root.position.x + 560,
      root.position.y - 180,
      roles,
    )
    const rival = addNode(locale === 'zh-CN' ? '对手' : 'Rival', root.position.x + 560, root.position.y - 70, roles)
    const guild = addNode(locale === 'zh-CN' ? '公会' : 'Guild', root.position.x + 560, root.position.y + 20, factions)
    const empire = addNode(
      locale === 'zh-CN' ? '帝国' : 'Empire',
      root.position.x + 560,
      root.position.y + 120,
      factions,
    )
    const freedom = addNode(
      locale === 'zh-CN' ? '自由' : 'Freedom',
      root.position.x - 560,
      root.position.y - 90,
      motives,
    )
    const revenge = addNode(
      locale === 'zh-CN' ? '复仇' : 'Revenge',
      root.position.x - 560,
      root.position.y + 10,
      motives,
    )
    const betrayal = addNode(
      locale === 'zh-CN' ? '背叛' : 'Betrayal',
      root.position.x - 560,
      root.position.y + 120,
      conflicts,
    )
    doc.relations.push(createTemplateRelation(hero, rival, locale === 'zh-CN' ? '宿敌' : 'rivals'))
    doc.relations.push(createTemplateRelation(guild, freedom, locale === 'zh-CN' ? '推动' : 'drives'))
    doc.relations.push(createTemplateRelation(empire, betrayal, locale === 'zh-CN' ? '诱发' : 'triggers'))
    doc.relations.push(createTemplateRelation(revenge, rival, locale === 'zh-CN' ? '针对' : 'targets'))
  } else {
    const definition = addNode(
      locale === 'zh-CN' ? '定义' : 'Definition',
      root.position.x + 280,
      root.position.y - 150,
      'root',
      'P1',
    )
    const concepts = addNode(
      locale === 'zh-CN' ? '核心概念' : 'Core Concepts',
      root.position.x + 280,
      root.position.y - 10,
    )
    const workflow = addNode(locale === 'zh-CN' ? '工作流' : 'Workflow', root.position.x + 280, root.position.y + 130)
    const applications = addNode(
      locale === 'zh-CN' ? '应用场景' : 'Use Cases',
      root.position.x - 280,
      root.position.y - 100,
    )
    const tradeoffs = addNode(locale === 'zh-CN' ? '权衡' : 'Tradeoffs', root.position.x - 280, root.position.y + 40)
    const examples = addNode(locale === 'zh-CN' ? '案例' : 'Examples', root.position.x - 280, root.position.y + 180)
    const ontology = addNode(
      locale === 'zh-CN' ? '本体' : 'Ontology',
      root.position.x + 560,
      root.position.y - 60,
      concepts,
    )
    const entities = addNode(
      locale === 'zh-CN' ? '实体与关系' : 'Entities & Edges',
      root.position.x + 560,
      root.position.y + 20,
      concepts,
    )
    const pipeline = addNode(
      locale === 'zh-CN' ? '采集到推理' : 'Ingest to Reasoning',
      root.position.x + 560,
      root.position.y + 130,
      workflow,
    )
    const recommendation = addNode(
      locale === 'zh-CN' ? '推荐系统' : 'Recommendation',
      root.position.x - 560,
      root.position.y - 120,
      applications,
    )
    const quality = addNode(
      locale === 'zh-CN' ? '数据质量' : 'Data Quality',
      root.position.x - 560,
      root.position.y + 40,
      tradeoffs,
    )
    const search = addNode(
      locale === 'zh-CN' ? '搜索增强' : 'Search Augment',
      root.position.x - 560,
      root.position.y + 180,
      examples,
    )
    doc.relations.push(
      createTemplateRelation(ontology, quality, locale === 'zh-CN' ? '依赖一致性' : 'needs consistency'),
    )
    doc.relations.push(createTemplateRelation(recommendation, entities, locale === 'zh-CN' ? '使用' : 'uses'))
    doc.relations.push(createTemplateRelation(search, pipeline, locale === 'zh-CN' ? '接入' : 'plugs into'))
    doc.relations.push(createTemplateRelation(definition, applications, locale === 'zh-CN' ? '落地到' : 'applies to'))
  }

  touchDocument(doc)
  return doc
}

export function createTemplateRelation(sourceId: string, targetId: string, label: string): RelationEdge {
  const now = new Date().toISOString()
  return {
    id: createId('rel'),
    sourceId,
    targetId,
    label,
    createdAt: now,
    updatedAt: now,
  }
}

export function normalizedRelationPairKey(left: string, right: string): string {
  return left < right ? `${left}::${right}` : `${right}::${left}`
}
