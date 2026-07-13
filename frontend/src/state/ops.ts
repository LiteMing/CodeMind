import type { MindMapApp } from '../app'
import { clearNodeEditorState } from '../interaction/editor'
import {
  autoLayoutHierarchy,
  findNode,
  childrenOf,
  createId,
  createNode,
  deleteRelation,
  descendantIds,
  findRoot,
  nextChildPosition,
  nextFloatingPosition,
  nextSiblingOrder,
  nextSiblingPosition,
  normalizeAllSiblingOrders,
  tidySubtree,
  toggleCollapse,
  touchDocument,
  updateRelationLabel,
} from '../document'
import { cloneDocument } from '../utils'
import { estimateNodeHeight, estimateNodeWidth } from '../node-sizing'
import { normalizeNodeColor } from '../color-palette'
import { nodeColorLabel } from '../i18n'
import { normalizeNodeNote } from '../node-render'
import { loadLocalSnapshot } from '../snapshots'
import { renderHeader, renderWorkspace } from '../render/shell'
import { scheduleAutosave } from '../sync/api-sync'
import type { HistorySnapshot } from '../app-types'
import type { MindNode, NodeColor, Priority, RelationEdge } from '../types'

export function captureHistory(app: MindMapApp): void {
  app.pushHistorySnapshot(app.createHistorySnapshot())
}

export function applyHistorySnapshot(app: MindMapApp, snapshot: HistorySnapshot): void {
  app.state.document = cloneDocument(snapshot.document)
  app.setSelection(snapshot.selectedNodeIds, snapshot.selectedNodeId)
  app.state.connectSourceNodeId =
    snapshot.connectSourceNodeId && findNode(app.state.document, snapshot.connectSourceNodeId)
      ? snapshot.connectSourceNodeId
      : null
  app.clearNodeLongPress()
  clearNodeEditorState(app)
  app.clearDropTargetHighlights()
  app.state.drag = null
  app.pan = null
  app.state.resize = null
  app.state.regionResize = null
  app.state.contextMenu = null
  app.state.marquee = null
  app.applyTheme()
}

export function undo(app: MindMapApp): void {
  if (!app.canUndo()) {
    return
  }

  const snapshot = app.historyPast.pop()
  if (!snapshot) {
    return
  }

  app.historyFuture.push(app.createHistorySnapshot())
  applyHistorySnapshot(app, snapshot)
  app.setStatus('status.undoApplied')
  app.render()
  scheduleAutosave(app, 'status.saved')
}

export function redo(app: MindMapApp): void {
  if (!app.canRedo()) {
    return
  }

  const snapshot = app.historyFuture.pop()
  if (!snapshot) {
    return
  }

  app.historyPast.push(app.createHistorySnapshot())
  applyHistorySnapshot(app, snapshot)
  app.setStatus('status.redoApplied')
  app.render()
  scheduleAutosave(app, 'status.saved')
}

export function resetHistory(app: MindMapApp): void {
  app.historyPast = []
  app.historyFuture = []
}

export function applySelectionState(
  app: MindMapApp,
  nodeIds: string[],
  primaryNodeId: string | null = nodeIds[nodeIds.length - 1] ?? null,
): void {
  const normalizedIds = nodeIds.filter((nodeId, index) => {
    return nodeIds.indexOf(nodeId) === index && Boolean(app.findNode(nodeId))
  })
  const nextIds = normalizedIds
  const nextPrimary =
    primaryNodeId && nextIds.includes(primaryNodeId) ? primaryNodeId : (nextIds[nextIds.length - 1] ?? null)

  app.state.selectedNodeIds = nextIds
  app.state.selectedNodeId = nextPrimary
}

export function selectNodeSubtree(app: MindMapApp, nodeId: string): void {
  if (app.state.connectSourceNodeId && app.state.connectSourceNodeId !== nodeId) {
    createRelation(app, app.state.connectSourceNodeId, nodeId)
    return
  }

  const subtreeIds = [nodeId, ...descendantIds(app.state.document, nodeId)]
  app.setSelection(subtreeIds, nodeId)
  app.render()
}

export function createChildNode(app: MindMapApp, parentId: string): void {
  const parent = app.findNode(parentId)
  if (!parent) {
    return
  }

  captureHistory(app)
  parent.collapsed = false
  parent.updatedAt = new Date().toISOString()
  const newNode = createNode({
    parentId,
    kind: 'topic',
    order: nextSiblingOrder(app.state.document, parentId),
    position: nextChildPosition(
      app.state.document,
      parentId,
      app.state.preferences.appearance.layoutMode,
      app.state.preferences.appearance.childGapX,
    ),
    title: app.t('node.newChild'),
    color: normalizeNodeColor(parent.color) || undefined,
  })

  app.state.document.nodes.push(newNode)
  app.relayoutHierarchyAfterInsert(newNode)
  app.setSelection([newNode.id], newNode.id)
  app.state.editingNodeId = newNode.id
  app.editingOriginalTitle = newNode.title
  // Set anchor left so the editor uses left-anchored positioning (no left-right expansion)
  const initWidth = estimateNodeWidth(newNode, 0)
  app.activeEditorAnchorLeft = newNode.position.x - initWidth / 2
  app.activeEditorLockedWidth = initWidth
  app.activeEditorPreview = {
    nodeId: newNode.id,
    anchorLeft: app.activeEditorAnchorLeft,
    width: initWidth,
    height: estimateNodeHeight(newNode, 0, initWidth),
  }
  touchDocument(app.state.document)
  app.applyNodeCreateAnimation(newNode.id)
  app.render()
  app.dismissCanvasGuide()
  scheduleAutosave(app, 'status.childSaveScheduled')
}

export function createSiblingNode(app: MindMapApp, nodeId: string): void {
  const node = app.findNode(nodeId)
  if (!node) {
    return
  }

  captureHistory(app)
  let newNode: MindNode
  if (node.kind === 'root') {
    newNode = createNode({
      kind: 'floating',
      order: 0,
      position: nextFloatingPosition(app.state.document),
      title: app.t('node.newFloating'),
      color: normalizeNodeColor(node.color) || undefined,
    })
  } else if (node.parentId) {
    newNode = createNode({
      parentId: node.parentId,
      kind: 'topic',
      order: nextSiblingOrder(app.state.document, node.parentId),
      position: nextSiblingPosition(
        app.state.document,
        node,
        app.state.preferences.appearance.layoutMode,
        app.state.preferences.appearance.childGapX,
      ),
      title: app.t('node.newSibling'),
      color: normalizeNodeColor(node.color) || undefined,
    })
  } else {
    newNode = createNode({
      kind: 'floating',
      order: 0,
      position: nextFloatingPosition(app.state.document),
      title: app.t('node.newFloating'),
      color: normalizeNodeColor(node.color) || undefined,
    })
  }

  app.state.document.nodes.push(newNode)
  app.relayoutHierarchyAfterInsert(newNode)
  app.setSelection([newNode.id], newNode.id)
  app.state.editingNodeId = newNode.id
  app.editingOriginalTitle = newNode.title
  const sibInitWidth = estimateNodeWidth(newNode, 0)
  app.activeEditorAnchorLeft = newNode.position.x - sibInitWidth / 2
  app.activeEditorLockedWidth = sibInitWidth
  app.activeEditorPreview = {
    nodeId: newNode.id,
    anchorLeft: app.activeEditorAnchorLeft,
    width: sibInitWidth,
    height: estimateNodeHeight(newNode, 0, sibInitWidth),
  }
  touchDocument(app.state.document)
  app.applyNodeCreateAnimation(newNode.id)
  app.render()
  scheduleAutosave(app, 'status.siblingSaveScheduled')
}

export function createFloatingNode(app: MindMapApp, nodeId: string): void {
  const node = app.findNode(nodeId)
  if (!node) {
    return
  }

  captureHistory(app)
  const newNode = createNode({
    kind: 'floating',
    order: 0,
    position: nextFloatingPosition(app.state.document),
    title: app.t('node.newFloating'),
    color: normalizeNodeColor(node.color) || undefined,
  })

  app.state.document.nodes.push(newNode)
  app.setSelection([newNode.id], newNode.id)
  app.state.editingNodeId = newNode.id
  app.editingOriginalTitle = newNode.title
  const floatInitWidth = estimateNodeWidth(newNode, 0)
  app.activeEditorAnchorLeft = newNode.position.x - floatInitWidth / 2
  app.activeEditorLockedWidth = floatInitWidth
  app.activeEditorPreview = {
    nodeId: newNode.id,
    anchorLeft: app.activeEditorAnchorLeft,
    width: floatInitWidth,
    height: estimateNodeHeight(newNode, 0, floatInitWidth),
  }
  touchDocument(app.state.document)
  app.render()
  scheduleAutosave(app, 'status.siblingSaveScheduled')
}

export function deleteSelectedNode(app: MindMapApp): void {
  const selectedIds = app.selectedNodeIds()
  const removableIds = selectedIds.filter((nodeId) => app.findNode(nodeId)?.kind !== 'root')
  if (removableIds.length === 0) {
    app.setStatus('status.rootCannotDelete')
    app.render()
    return
  }

  const primaryNode = app.selectedNode()
  const removeIds = new Set<string>()
  for (const nodeId of removableIds) {
    removeIds.add(nodeId)
    for (const descendantId of descendantIds(app.state.document, nodeId)) {
      removeIds.add(descendantId)
    }
  }

  // Apply deletion animation to visible node elements before removing from data model
  // Use stagger delays for subtree deletion (depth-first order, 40ms per node)
  const orderedRemoveIds = Array.from(removeIds)
  const staggerDelays = app.uxEngine.computeStaggerDelays(orderedRemoveIds, 40)
  const animatingElements: HTMLElement[] = []
  for (const nodeId of orderedRemoveIds) {
    const el = app.rootEl.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`)
    if (el) {
      const delay = staggerDelays.get(nodeId) ?? 0
      el.style.animationDelay = `${delay}ms`
      el.classList.add('node-deleting')
      animatingElements.push(el)
    }
  }

  const fallbackNodeId =
    primaryNode?.parentId && !removeIds.has(primaryNode.parentId)
      ? primaryNode.parentId
      : findRoot(app.state.document).id

  // Fade out edges attached to the deleted subtree in sync with the node
  // fade-out (mirrors what the collapse path does for its subtree edges).
  const edgeLayer = app.rootEl.querySelector<SVGElement>('[data-edge-layer]')
  if (edgeLayer) {
    for (const edge of edgeLayer.querySelectorAll<SVGElement>('.edge-hierarchy, g[data-relation-id]')) {
      const ids = [
        edge.getAttribute('data-source-id'),
        edge.getAttribute('data-target-id'),
        ...(edge.getAttribute('data-branch-targets') ?? '').split(' '),
      ]
      if (ids.some((id) => id && removeIds.has(id))) {
        edge.classList.add('edge-collapsing')
      }
    }
  }

  // Perform actual deletion after animation completes (or immediately if no elements to animate)
  const performDeletion = (): void => {
    const relationCountBefore = app.state.document.relations.length
    const nodeCountBefore = app.state.document.nodes.length

    captureHistory(app)
    app.state.document.nodes = app.state.document.nodes.filter((node) => !removeIds.has(node.id))
    normalizeAllSiblingOrders(app.state.document)
    app.state.document.relations = app.state.document.relations
      .filter((relation) => !removeIds.has(relation.sourceId) && !removeIds.has(relation.targetId))
      .map((relation) => ({
        ...relation,
        branches: (relation.branches ?? []).filter((branch) => !removeIds.has(branch.targetId)),
      }))

    const removedNodes = nodeCountBefore - app.state.document.nodes.length
    const removedRelations = relationCountBefore - app.state.document.relations.length
    if (removedNodes === 0) {
      return
    }

    autoLayoutHierarchy(
      app.state.document,
      app.state.preferences.appearance.layoutMode,
      app.state.preferences.appearance.childGapX,
    )
    app.setSelection([fallbackNodeId], fallbackNodeId)
    app.state.editingNodeId = null
    app.state.connectSourceNodeId = null
    touchDocument(app.state.document)
    app.setStatus('status.deletedSummary', {
      nodes: removedNodes,
      relations: removedRelations,
    })
    app.render()
    scheduleAutosave(app, 'status.deletionSaveScheduled')
    app.showToast(app.t('toast.nodesDeleted', { value: removedNodes }))
  }

  if (animatingElements.length > 0) {
    // Wait for the last element's animation to end (accounting for stagger), then remove all
    const maxStaggerDelay = app.uxEngine.staggerWindow(orderedRemoveIds.length, 40)
    let completed = false
    const onComplete = (): void => {
      if (completed) return
      completed = true
      performDeletion()
    }
    // Listen on the last animated element (longest delay)
    const lastEl = animatingElements[animatingElements.length - 1]
    lastEl.addEventListener('animationend', onComplete, { once: true })
    // Safety timeout: max stagger delay + animation duration (200ms) + buffer
    setTimeout(onComplete, maxStaggerDelay + 250)
  } else {
    performDeletion()
  }
}

/** Apply node-creating animation class to a newly created node element after render */

export function toggleNodeCollapse(app: MindMapApp, nodeId: string): void {
  const node = app.findNode(nodeId)
  if (!node) {
    return
  }

  if (childrenOf(app.state.document, nodeId).length === 0) {
    app.setStatus('status.noBranchToCollapse')
    app.render()
    return
  }

  // Rapid re-toggle: settle the in-flight animation to its end state first
  // (collapse commits its deferred state flip, expand strips its animation
  // classes) so this click is exactly one clean toggle and the previous
  // timer can never double-fire.
  const pendingToggle = app.collapseToggleAnimations.get(nodeId)
  if (pendingToggle) {
    window.clearTimeout(pendingToggle.timer)
    app.collapseToggleAnimations.delete(nodeId)
    pendingToggle.settle()
  }

  const isCollapsing = !node.collapsed
  // Collect descendant IDs after settling (depth-first order via BFS from descendantIds)
  const childNodeIds = descendantIds(app.state.document, nodeId)

  if (isCollapsing) {
    // --- Collapse: animate children out with stagger, then toggle state ---
    // State-driven like expand: collapsingNodeIds is filled BEFORE render so
    // renderNodes/renderEdges output the classes and stagger delays in every
    // paint of the window — intervening renders no longer wipe the animation
    // (nodeLayer.innerHTML is rebuilt wholesale on each render).
    const staggerDelays = app.uxEngine.computeStaggerDelays(childNodeIds, 40)
    for (const childId of childNodeIds) {
      // Collapse takes over any still-running expand on the same subtree.
      app.expandingNodeIds.delete(childId)
      app.collapsingNodeIds.set(childId, staggerDelays.get(childId) ?? 0)
    }
    app.render()

    // After the longest animation completes, toggle state and re-render
    const maxDelay = app.uxEngine.staggerWindow(childNodeIds.length, 40)
    const animDuration = 350 // --duration-slow
    const finalize = (): void => {
      app.collapseToggleAnimations.delete(nodeId)
      for (const childId of childNodeIds) {
        app.collapsingNodeIds.delete(childId)
      }
      if (!app.findNode(nodeId)) {
        // Node vanished mid-animation (deleted / map switched): just drop the
        // animation state instead of toggling a stale id.
        app.render()
        return
      }

      const snapshot = app.createHistorySnapshot()
      app.setSelection([nodeId], nodeId)
      const changed = toggleCollapse(app.state.document, nodeId)
      if (!changed) {
        app.setStatus('status.noBranchToCollapse')
        app.render()
        return
      }

      if (app.state.preferences.interaction.autoLayoutOnCollapse) {
        autoLayoutHierarchy(
          app.state.document,
          app.state.preferences.appearance.layoutMode,
          app.state.preferences.appearance.childGapX,
        )
      }

      app.pushHistorySnapshot(snapshot)
      touchDocument(app.state.document)
      app.setStatus('status.branchCollapsed')
      app.render()
      scheduleAutosave(app, 'status.layoutSaveScheduled')
    }
    const timer = window.setTimeout(finalize, maxDelay + animDuration)
    app.collapseToggleAnimations.set(nodeId, { timer, settle: finalize })
  } else {
    // --- Expand: toggle state first, then animate children in with reverse stagger ---
    const snapshot = app.createHistorySnapshot()
    app.setSelection([nodeId], nodeId)
    const changed = toggleCollapse(app.state.document, nodeId)
    if (!changed) {
      app.setStatus('status.noBranchToCollapse')
      app.render()
      return
    }

    if (app.state.preferences.interaction.autoLayoutOnCollapse) {
      autoLayoutHierarchy(
        app.state.document,
        app.state.preferences.appearance.layoutMode,
        app.state.preferences.appearance.childGapX,
      )
    }

    app.pushHistorySnapshot(snapshot)
    touchDocument(app.state.document)
    app.setStatus('status.branchExpanded')

    // State-driven expand animation: fill expandingNodeIds BEFORE render so
    // renderNodes/renderEdges output the classes and stagger delays in the
    // first paint. Adding classes after render flashed every node at full
    // opacity for a frame before restarting the fade from zero.
    const expandNodeIds = descendantIds(app.state.document, nodeId)
    const staggerDelays = app.uxEngine.computeStaggerDelays(expandNodeIds, 40)
    for (const childId of expandNodeIds) {
      app.collapsingNodeIds.delete(childId)
      app.expandingNodeIds.set(childId, staggerDelays.get(childId) ?? 0)
    }

    app.render()
    scheduleAutosave(app, 'status.layoutSaveScheduled')

    const totalWindow = app.uxEngine.staggerWindow(expandNodeIds.length, 40) + 350 + 50
    const expandIdSet = new Set(expandNodeIds)
    const cleanup = (): void => {
      app.collapseToggleAnimations.delete(nodeId)
      for (const childId of expandNodeIds) {
        app.expandingNodeIds.delete(childId)
        if (app.collapsingNodeIds.has(childId)) {
          // A newer collapse owns this node's animation now — leave its
          // classes and inline delay alone.
          continue
        }
        const el = app.rootEl.querySelector<HTMLElement>(`[data-node-id="${childId}"]`)
        if (el) {
          el.classList.remove('node-expanding')
          el.style.animationDelay = ''
        }
      }
      // Only strip edge classes belonging to this subtree; another expand may
      // still be animating elsewhere.
      app.rootEl.querySelectorAll<SVGElement>('.edge-expanding').forEach((edge) => {
        const sourceId = edge.getAttribute('data-source-id')
        const targetId = edge.getAttribute('data-target-id')
        if ((sourceId && expandIdSet.has(sourceId)) || (targetId && expandIdSet.has(targetId))) {
          edge.classList.remove('edge-expanding')
        }
      })
    }
    const timer = window.setTimeout(cleanup, totalWindow)
    app.collapseToggleAnimations.set(nodeId, { timer, settle: cleanup })
  }
}

export function copySelectedSubtree(app: MindMapApp): void {
  // Support multi-selection: collect all selected nodes' subtrees
  const selectedIds = app.selectedNodeIds()
  if (selectedIds.length === 0) {
    const selectedNode = app.selectedNode()
    if (selectedNode) {
      selectedIds.push(selectedNode.id)
    }
  }
  if (selectedIds.length === 0) {
    return
  }

  // Use the primary selected node as the anchor for offset calculation
  const primaryNode = app.findNode(selectedIds[0])
  if (!primaryNode) {
    return
  }

  // Collect all nodes from all selected subtrees, deduplicating
  const allSubtreeIds = new Set<string>()
  for (const nodeId of selectedIds) {
    allSubtreeIds.add(nodeId)
    for (const descId of descendantIds(app.state.document, nodeId)) {
      allSubtreeIds.add(descId)
    }
  }

  const nodes = [...allSubtreeIds]
    .map((nodeId) => app.findNode(nodeId))
    .filter((node): node is MindNode => Boolean(node))
    .map((node) => {
      return {
        id: node.id,
        parentId: node.parentId,
        kind: node.kind,
        order: node.order,
        title: node.title,
        note: normalizeNodeNote(node.note),
        priority: node.priority,
        color: normalizeNodeColor(node.color) || undefined,
        bindings: node.bindings.map((binding) => ({ ...binding })),
        collapsed: node.collapsed,
        width: node.width,
        height: node.height,
        offset: {
          x: node.position.x - primaryNode.position.x,
          y: node.position.y - primaryNode.position.y,
        },
      }
    })

  if (nodes.length === 0) {
    return
  }

  // Capture relations fully contained in the copied set so paste can rebuild
  // them (branch targets outside the set are dropped per-branch).
  const relations = app.state.document.relations
    .filter((r) => allSubtreeIds.has(r.sourceId) && allSubtreeIds.has(r.targetId))
    .map((r) => ({
      sourceId: r.sourceId,
      targetId: r.targetId,
      label: r.label,
      arrowDirection: r.arrowDirection,
      branchTargetIds: (r.branches ?? []).map((b) => b.targetId).filter((id) => allSubtreeIds.has(id)),
    }))

  app.copiedSubtree = {
    rootId: primaryNode.id,
    nodes,
    relations,
  }
  app.setStatus('status.subtreeCopied', { count: nodes.length })
  renderHeader(app)
}

export function cutSelectedSubtree(app: MindMapApp): void {
  // Support multi-selection: cut all selected nodes
  const selectedIds = app.selectedNodeIds()
  if (selectedIds.length === 0) {
    const selectedNode = app.selectedNode()
    if (selectedNode && selectedNode.kind !== 'root') {
      selectedIds.push(selectedNode.id)
    }
  }

  // Filter out root node — cannot cut root
  const cuttableIds = selectedIds.filter((id) => {
    const node = app.findNode(id)
    return node && node.kind !== 'root'
  })

  if (cuttableIds.length === 0) {
    return
  }

  // Copy first (uses selectedNodeIds internally)
  copySelectedSubtree(app)

  // Then delete all selected subtrees
  captureHistory(app)
  const allSubtreeIds = new Set<string>()
  for (const nodeId of cuttableIds) {
    allSubtreeIds.add(nodeId)
    for (const descId of descendantIds(app.state.document, nodeId)) {
      allSubtreeIds.add(descId)
    }
  }

  // Remove relations referencing deleted nodes
  app.state.document.relations = app.state.document.relations
    .filter((r) => !allSubtreeIds.has(r.sourceId) && !allSubtreeIds.has(r.targetId))
    .map((r) => ({
      ...r,
      branches: (r.branches ?? []).filter((b) => !allSubtreeIds.has(b.targetId)),
    }))

  // Remove nodes
  app.state.document.nodes = app.state.document.nodes.filter((n) => !allSubtreeIds.has(n.id))
  normalizeAllSiblingOrders(app.state.document)

  touchDocument(app.state.document)
  app.selectNode(findRoot(app.state.document)?.id ?? 'root')
  app.setStatus('status.subtreeCut', { count: allSubtreeIds.size })
  scheduleAutosave(app, 'status.saved')
}

export function pasteCopiedSubtree(app: MindMapApp): void {
  if (!app.copiedSubtree) {
    app.setStatus('status.clipboardEmpty')
    app.render()
    return
  }

  const targetNode = app.selectedNode()
  if (!targetNode) {
    return
  }

  const rootSnapshot = app.copiedSubtree.nodes.find((node) => node.id === app.copiedSubtree?.rootId)
  if (!rootSnapshot) {
    app.setStatus('status.clipboardEmpty')
    app.render()
    return
  }

  const now = new Date().toISOString()
  const idMap = new Map<string, string>()
  const parent = app.findNode(targetNode.id)
  if (!parent) {
    return
  }

  captureHistory(app)
  parent.collapsed = false
  parent.updatedAt = now

  const anchor = nextChildPosition(
    app.state.document,
    targetNode.id,
    app.state.preferences.appearance.layoutMode,
    app.state.preferences.appearance.childGapX,
  )
  const insertedNodes: MindNode[] = []

  for (const snapshot of app.copiedSubtree.nodes) {
    idMap.set(snapshot.id, createId('node'))
  }

  const topLevelSnapshots = app.copiedSubtree.nodes
    .filter((snapshot) => snapshot.id === app.copiedSubtree?.rootId || !idMap.has(snapshot.parentId ?? ''))
    .sort(
      (left, right) => left.order - right.order || left.offset.y - right.offset.y || left.id.localeCompare(right.id),
    )
  const topLevelOrder = new Map(
    topLevelSnapshots.map((snapshot, index) => [
      snapshot.id,
      nextSiblingOrder(app.state.document, targetNode.id) + index,
    ]),
  )

  for (const snapshot of app.copiedSubtree.nodes) {
    const nextId = idMap.get(snapshot.id)
    if (!nextId) {
      continue
    }
    const isClipboardRoot = snapshot.id === app.copiedSubtree.rootId
    // For multi-select paste: if a node's parent wasn't copied (not in idMap),
    // treat it as a top-level node and attach to the paste target.
    const parentId = isClipboardRoot
      ? targetNode.id
      : snapshot.parentId
        ? (idMap.get(snapshot.parentId) ?? targetNode.id)
        : targetNode.id
    const isTopLevel = isClipboardRoot || parentId === targetNode.id
    const nodeKind: MindNode['kind'] = isTopLevel ? 'topic' : snapshot.kind === 'root' ? 'topic' : snapshot.kind
    const position = {
      x: anchor.x + snapshot.offset.x,
      y: anchor.y + snapshot.offset.y,
    }
    insertedNodes.push({
      id: nextId,
      parentId,
      kind: nodeKind,
      order: isTopLevel ? (topLevelOrder.get(snapshot.id) ?? 1) : snapshot.order,
      title: snapshot.title,
      note: snapshot.note,
      priority: snapshot.priority,
      color: snapshot.color,
      bindings: snapshot.bindings.map((binding) => ({ ...binding, id: createId('binding') })),
      collapsed: snapshot.collapsed,
      width: snapshot.width,
      height: snapshot.height,
      position,
      createdAt: now,
      updatedAt: now,
    })
  }

  app.state.document.nodes.push(...insertedNodes)
  normalizeAllSiblingOrders(app.state.document)

  // Rebuild copied relations with endpoints remapped to the new node ids;
  // drop any relation whose endpoints did not survive the paste.
  let pastedRelationCount = 0
  for (const copied of app.copiedSubtree.relations ?? []) {
    const sourceId = idMap.get(copied.sourceId)
    const targetId = idMap.get(copied.targetId)
    if (!sourceId || !targetId || sourceId === targetId) {
      continue
    }
    const branches = (copied.branchTargetIds ?? [])
      .map((id) => idMap.get(id))
      .filter((id): id is string => Boolean(id) && id !== sourceId && id !== targetId)
      .map((targetId) => ({ targetId }))
    app.state.document.relations.push({
      id: createId('rel'),
      sourceId,
      targetId,
      label: copied.label,
      arrowDirection: copied.arrowDirection,
      branches,
      createdAt: now,
      updatedAt: now,
    })
    pastedRelationCount++
  }
  if (pastedRelationCount > 0) {
    touchDocument(app.state.document)
  }

  const pastedRootId = idMap.get(app.copiedSubtree.rootId) ?? insertedNodes[0]?.id
  if (!pastedRootId) {
    return
  }

  app.setSelection([pastedRootId], pastedRootId)
  touchDocument(app.state.document)
  app.setStatus('status.subtreePasted', { count: insertedNodes.length })
  app.render()
  scheduleAutosave(app, 'status.layoutSaveScheduled')
  app.showToast(app.t('toast.nodesPasted', { value: insertedNodes.length }))
}

export function createRelation(app: MindMapApp, sourceId: string, targetId: string): void {
  if (sourceId === targetId) {
    app.state.connectSourceNodeId = null
    app.setStatus('status.relationNeedsDifferentNodes')
    app.render()
    return
  }

  const exists = app.state.document.relations.some((edge) => {
    return (
      (edge.sourceId === sourceId && edge.targetId === targetId) ||
      (edge.sourceId === targetId && edge.targetId === sourceId)
    )
  })

  if (exists) {
    app.state.connectSourceNodeId = null
    app.setStatus('status.relationAlreadyExists')
    app.render()
    return
  }

  const relation: RelationEdge = {
    id: createId('rel'),
    sourceId,
    targetId,
    label: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  captureHistory(app)
  app.state.document.relations.push(relation)
  app.state.connectSourceNodeId = null
  app.setSelection([targetId], targetId)
  touchDocument(app.state.document)
  app.setStatus('status.relationCreated')
  app.render()
  scheduleAutosave(app, 'status.relationSaveScheduled')
}

export function removeRelation(app: MindMapApp, relationId: string): void {
  const snapshot = app.createHistorySnapshot()
  const removed = deleteRelation(app.state.document, relationId)
  if (!removed) {
    return
  }

  if (app.state.selectedRelationId === relationId) {
    app.state.selectedRelationId = null
  }
  app.pushHistorySnapshot(snapshot)
  touchDocument(app.state.document)
  app.setStatus('status.relationRemoved')
  app.render()
  scheduleAutosave(app, 'status.relationRemovalSaveScheduled')
}

// ---- Region Box methods ----

export function addBranchTargetToRelation(app: MindMapApp, relation: RelationEdge, targetNodeId: string): void {
  if (app.relationIncludesTarget(relation, targetNodeId)) {
    app.setStatus('status.relationAlreadyExists')
    renderWorkspace(app)
    return
  }

  if (!app.findNode(targetNodeId)) {
    renderWorkspace(app)
    return
  }

  captureHistory(app)
  if (!relation.branches) {
    relation.branches = []
  }
  relation.branches.push({
    targetId: targetNodeId,
  })
  relation.updatedAt = new Date().toISOString()
  touchDocument(app.state.document)
  app.setStatus('status.connectionBranched')
  renderWorkspace(app)
  scheduleAutosave(app, 'status.relationSaveScheduled')
}

export function commitRelationLabel(app: MindMapApp, relationId: string, rawLabel: string): void {
  const relation = app.state.document.relations.find((item) => item.id === relationId)
  const nextLabel = rawLabel.trim()
  if (!relation || (relation.label ?? '') === nextLabel) {
    return
  }

  captureHistory(app)
  updateRelationLabel(app.state.document, relationId, rawLabel)
  touchDocument(app.state.document)
  app.setStatus('status.relationLabelUpdated')
  app.render()
  scheduleAutosave(app, 'status.labelSaveScheduled')
}

export function setNodeColor(app: MindMapApp, color: NodeColor): void {
  const targetIds = app.selectedNodeIds().filter((nodeId) => Boolean(app.findNode(nodeId)))
  if (targetIds.length === 0) {
    return
  }

  const nextColor = normalizeNodeColor(color) || undefined
  const targetNodes = targetIds.map((nodeId) => app.findNode(nodeId)).filter((node): node is MindNode => Boolean(node))

  if (targetNodes.every((node) => (normalizeNodeColor(node.color) || undefined) === nextColor)) {
    return
  }

  captureHistory(app)
  for (const node of targetNodes) {
    app.updateNode(node.id, (draft) => {
      draft.color = nextColor
    })
  }
  touchDocument(app.state.document)
  app.setStatus(
    color ? 'status.colorApplied' : 'status.colorCleared',
    color ? { color: nodeColorLabel(app.state.preferences.locale, color) } : undefined,
  )
  app.render()
  scheduleAutosave(app, 'status.colorSaveScheduled')
}

export function setPriority(app: MindMapApp, priority: Priority): void {
  const targetIds = app.selectedNodeIds().filter((nodeId) => Boolean(app.findNode(nodeId)))
  if (targetIds.length === 0) {
    return
  }

  const nextPriority = priority || undefined
  const targetNodes = targetIds.map((nodeId) => app.findNode(nodeId)).filter((node): node is MindNode => Boolean(node))

  if (targetNodes.every((node) => (node.priority ?? undefined) === nextPriority)) {
    return
  }

  captureHistory(app)
  for (const node of targetNodes) {
    app.updateNode(node.id, (draft) => {
      draft.priority = nextPriority
    })
  }
  touchDocument(app.state.document)
  app.setStatus(priority ? 'status.priorityApplied' : 'status.priorityCleared', priority ? { priority } : undefined)
  app.render()
  scheduleAutosave(app, 'status.prioritySaveScheduled')
}

export function commitNodeNote(app: MindMapApp, nodeId: string, rawNote: string): void {
  const existingNode = app.findNode(nodeId)
  if (!existingNode) {
    return
  }

  const nextNote = normalizeNodeNote(rawNote)
  const currentNote = normalizeNodeNote(existingNode.note)
  if (currentNote === nextNote) {
    return
  }

  captureHistory(app)
  app.updateNode(nodeId, (node) => {
    node.note = nextNote
  })
  // Note text affects rendered node height — re-tidy the local sibling
  // neighborhood so nothing overlaps (UX-10).
  if (existingNode.parentId && app.state.preferences.interaction.autoLayoutOnCollapse) {
    tidySubtree(app.state.document, existingNode.parentId, app.state.preferences.appearance.childGapX)
  }
  touchDocument(app.state.document)
  app.setStatus('status.noteUpdated')
  app.render()
  scheduleAutosave(app, 'status.noteSaveScheduled')
}

export function autoLayout(app: MindMapApp): void {
  const snapshot = app.createHistorySnapshot()
  const movedNodes = autoLayoutHierarchy(
    app.state.document,
    app.state.preferences.appearance.layoutMode,
    app.state.preferences.appearance.childGapX,
  )
  if (movedNodes === 0) {
    app.setStatus('status.layoutUpdated', { count: 0 })
    app.render()
    return
  }

  app.pushHistorySnapshot(snapshot)
  touchDocument(app.state.document)
  app.setStatus('status.layoutUpdated', { count: movedNodes })
  app.render()
  scheduleAutosave(app, 'status.layoutSaveScheduled')
}

export function tidySubtreeCommand(app: MindMapApp, nodeId: string): void {
  const node = app.findNode(nodeId)
  if (!node) {
    return
  }

  const children = childrenOf(app.state.document, nodeId)
  if (children.length === 0) {
    app.setStatus('status.subtreeNoChildren')
    app.render()
    return
  }

  const snapshot = app.createHistorySnapshot()
  const movedNodes = tidySubtree(app.state.document, nodeId, app.state.preferences.appearance.childGapX)
  if (movedNodes === 0) {
    app.setStatus('status.subtreeNoChildren')
    app.render()
    return
  }

  app.pushHistorySnapshot(snapshot)
  touchDocument(app.state.document)
  app.setStatus('status.subtreeTidied', { count: movedNodes })
  app.render()
  scheduleAutosave(app, 'status.layoutSaveScheduled')
}

export function restoreSnapshot(app: MindMapApp, snapshotId: string): void {
  const mapId = app.state.currentMapId
  if (!mapId) {
    return
  }

  const restoredDocument = loadLocalSnapshot(mapId, snapshotId)
  if (!restoredDocument) {
    app.setStatus('status.snapshotRestoreFailed')
    app.render()
    return
  }

  captureHistory(app)
  restoredDocument.id = mapId
  app.state.document = restoredDocument
  app.state.snapshotDraftName = ''
  app.setSelection([findRoot(restoredDocument).id], findRoot(restoredDocument).id)
  app.state.connectSourceNodeId = null
  touchDocument(app.state.document)
  app.applyTheme()
  app.setStatus('status.snapshotRestored')
  app.render()
  scheduleAutosave(app, 'status.saved')
}

export function toggleNodeSelection(app: MindMapApp, nodeId: string): void {
  if (app.state.connectSourceNodeId && app.state.connectSourceNodeId !== nodeId) {
    createRelation(app, app.state.connectSourceNodeId, nodeId)
    return
  }

  const currentIds = app.selectedNodeIds()
  if (currentIds.includes(nodeId)) {
    if (currentIds.length === 1) {
      app.setSelection([nodeId], nodeId)
    } else {
      const nextIds = currentIds.filter((candidateId) => candidateId !== nodeId)
      app.setSelection(nextIds, nextIds[nextIds.length - 1])
    }
  } else {
    app.setSelection([...currentIds, nodeId], nodeId)
  }

  app.render()
}
