package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"code-mind/internal/mindmap"
)

// createNodeRequest represents the JSON body for POST /api/maps/{mapId}/nodes.
type createNodeRequest struct {
	ParentID string            `json:"parentId"`
	Title    string            `json:"title"`
	Note     string            `json:"note,omitempty"`
	Kind     mindmap.NodeKind  `json:"kind,omitempty"`
	Priority mindmap.Priority  `json:"priority,omitempty"`
	Color    mindmap.NodeColor `json:"color,omitempty"`
}

func (s *Server) handleNodes(w http.ResponseWriter, r *http.Request, mapID string) {
	switch r.Method {
	case http.MethodGet:
		s.handleNodesGet(w, r, mapID)
	case http.MethodPost:
		s.handleNodesPost(w, r, mapID)
	default:
		w.Header().Set("Allow", "GET, POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleNodesGet(w http.ResponseWriter, r *http.Request, mapID string) {
	doc, err := s.store.Load(mapID)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	setRevisionETag(w, doc.Meta.Revision)
	if r.URL.Query().Get("compact") == "true" {
		writeJSON(w, http.StatusOK, toCompactNodes(doc.Nodes))
		return
	}
	writeJSON(w, http.StatusOK, doc.Nodes)
}

func (s *Server) handleNodesPost(w http.ResponseWriter, r *http.Request, mapID string) {
	expectedRevision, ok := requireExpectedRevision(w, r)
	if !ok {
		return
	}
	doc, err := s.store.LoadReadOnly(mapID)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}

	var req createNodeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	// Validate required fields
	if strings.TrimSpace(req.ParentID) == "" {
		writeError(w, http.StatusBadRequest, errors.New("parentId is required"))
		return
	}
	if strings.TrimSpace(req.Title) == "" {
		writeError(w, http.StatusBadRequest, errors.New("title is required"))
		return
	}

	// Validate kind if provided
	if req.Kind != "" && !isValidNodeKind(req.Kind) {
		writeError(w, http.StatusBadRequest, fmt.Errorf("invalid node kind: %q", req.Kind))
		return
	}

	// Verify parentId exists in document
	nodeMap := doc.NodeMap()
	parent, exists := nodeMap[req.ParentID]
	if !exists {
		writeError(w, http.StatusBadRequest, fmt.Errorf("parent node %q not found in map %q", req.ParentID, mapID))
		return
	}

	// Auto-complete fields
	now := time.Now().UTC()
	kind := req.Kind
	if kind == "" {
		kind = mindmap.NodeKindTopic
	}

	siblings := doc.ChildrenOf(req.ParentID)
	position := calculateChildPosition(parent, siblings)

	node := mindmap.Node{
		ID:        mindmap.NewID("node"),
		ParentID:  req.ParentID,
		Kind:      kind,
		Title:     req.Title,
		Note:      req.Note,
		Priority:  req.Priority,
		Color:     req.Color,
		Position:  position,
		CreatedAt: now,
		UpdatedAt: now,
	}

	doc.Nodes = append(doc.Nodes, node)

	persisted, err := s.store.SaveIfRevision(doc, expectedRevision)
	if err != nil {
		writeMapStoreError(w, http.StatusInternalServerError, err)
		return
	}

	s.recordAPIModification(mapID)
	setRevisionETag(w, persisted.Meta.Revision)
	writeJSON(w, http.StatusCreated, persisted.NodeMap()[node.ID])
}

func isValidNodeKind(kind mindmap.NodeKind) bool {
	switch kind {
	case mindmap.NodeKindRoot, mindmap.NodeKindTopic, mindmap.NodeKindFloating:
		return true
	default:
		return false
	}
}

// nodeDetailResponse is the response for GET /api/maps/{mapId}/nodes/{nodeId}.
type nodeDetailResponse struct {
	Revision  uint64         `json:"revision"`
	Node      mindmap.Node   `json:"node"`
	Ancestors []mindmap.Node `json:"ancestors"`
	Children  []mindmap.Node `json:"children"`
}

func (s *Server) handleNodeByIDGet(w http.ResponseWriter, r *http.Request, mapID string, nodeID string) {
	doc, err := s.store.Load(mapID)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}

	nodeMap := doc.NodeMap()
	node, exists := nodeMap[nodeID]
	if !exists {
		writeError(w, http.StatusNotFound, fmt.Errorf("node %q not found in map %q", nodeID, mapID))
		return
	}
	setRevisionETag(w, doc.Meta.Revision)

	// Walk up the parentId chain to collect ancestors (from immediate parent to root)
	ancestors := make([]mindmap.Node, 0)
	currentID := node.ParentID
	for currentID != "" {
		ancestor, ok := nodeMap[currentID]
		if !ok {
			break
		}
		ancestors = append(ancestors, ancestor)
		currentID = ancestor.ParentID
	}

	// Get direct children
	children := doc.ChildrenOf(nodeID)

	if r.URL.Query().Get("compact") == "true" {
		writeJSON(w, http.StatusOK, compactNodeDetailResponse{
			Revision:  doc.Meta.Revision,
			Node:      toCompactNode(node),
			Ancestors: toCompactNodes(ancestors),
			Children:  toCompactNodes(children),
		})
		return
	}

	writeJSON(w, http.StatusOK, nodeDetailResponse{
		Revision:  doc.Meta.Revision,
		Node:      node,
		Ancestors: ancestors,
		Children:  children,
	})
}

func (s *Server) handleNodeByIDPatch(w http.ResponseWriter, r *http.Request, mapID string, nodeID string) {
	expectedRevision, ok := requireExpectedRevision(w, r)
	if !ok {
		return
	}
	doc, err := s.store.LoadReadOnly(mapID)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}

	// Find the node index
	nodeIndex := -1
	for i, n := range doc.Nodes {
		if n.ID == nodeID {
			nodeIndex = i
			break
		}
	}
	if nodeIndex == -1 {
		writeError(w, http.StatusNotFound, fmt.Errorf("node %q not found in map %q", nodeID, mapID))
		return
	}

	// Parse request body as map for partial updates
	var fields map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&fields); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	node := &doc.Nodes[nodeIndex]

	// Apply only updatable fields
	for key, val := range fields {
		switch key {
		case "title":
			if s, ok := val.(string); ok {
				node.Title = s
			}
		case "note":
			if s, ok := val.(string); ok {
				node.Note = s
			}
		case "priority":
			if s, ok := val.(string); ok {
				node.Priority = mindmap.Priority(s)
			}
		case "color":
			if s, ok := val.(string); ok {
				node.Color = mindmap.NodeColor(s)
			}
		case "collapsed":
			if b, ok := val.(bool); ok {
				node.Collapsed = b
			}
			// Ignore non-updatable fields: id, parentId, kind, position, createdAt
		}
	}

	// Update updatedAt to current UTC time
	node.UpdatedAt = time.Now().UTC()

	persisted, err := s.store.SaveIfRevision(doc, expectedRevision)
	if err != nil {
		writeMapStoreError(w, http.StatusInternalServerError, err)
		return
	}

	s.recordAPIModification(mapID)
	setRevisionETag(w, persisted.Meta.Revision)
	writeJSON(w, http.StatusOK, persisted.NodeMap()[nodeID])
}

func (s *Server) handleNodeByIDDelete(w http.ResponseWriter, r *http.Request, mapID string, nodeID string) {
	expectedRevision, ok := requireExpectedRevision(w, r)
	if !ok {
		return
	}
	doc, err := s.store.LoadReadOnly(mapID)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}

	// Find the node
	nodeMap := doc.NodeMap()
	node, exists := nodeMap[nodeID]
	if !exists {
		writeError(w, http.StatusNotFound, fmt.Errorf("node %q not found in map %q", nodeID, mapID))
		return
	}

	// Cannot delete root node
	if node.Kind == mindmap.NodeKindRoot {
		writeError(w, http.StatusBadRequest, errors.New("cannot delete root node"))
		return
	}

	// Parse cascade query parameter (default "true")
	cascadeStr := r.URL.Query().Get("cascade")
	cascade := true
	if cascadeStr == "false" {
		cascade = false
	}

	deletedCount := 0

	if cascade {
		// Collect all descendants recursively
		toDelete := collectDescendants(doc, nodeID)
		toDelete[nodeID] = true
		deletedCount = len(toDelete)

		// Filter out deleted nodes
		remaining := make([]mindmap.Node, 0, len(doc.Nodes)-deletedCount)
		for _, n := range doc.Nodes {
			if !toDelete[n.ID] {
				remaining = append(remaining, n)
			}
		}
		doc.Nodes = remaining
	} else {
		// Re-parent direct children to the deleted node's parent
		parentID := node.ParentID
		for i := range doc.Nodes {
			if doc.Nodes[i].ParentID == nodeID {
				doc.Nodes[i].ParentID = parentID
			}
		}

		// Remove only the target node
		remaining := make([]mindmap.Node, 0, len(doc.Nodes)-1)
		for _, n := range doc.Nodes {
			if n.ID != nodeID {
				remaining = append(remaining, n)
			}
		}
		doc.Nodes = remaining
		deletedCount = 1
	}

	pruneRelationsToExistingNodes(&doc)

	persisted, err := s.store.SaveIfRevision(doc, expectedRevision)
	if err != nil {
		writeMapStoreError(w, http.StatusInternalServerError, err)
		return
	}

	s.recordAPIModification(mapID)
	setRevisionETag(w, persisted.Meta.Revision)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":       "deleted",
		"deletedCount": deletedCount,
	})
}

// TreeNode represents a node in the nested tree structure returned by GET /tree.
type TreeNode struct {
	mindmap.Node
	Revision uint64     `json:"revision,omitempty"`
	Children []TreeNode `json:"children"`
}

// buildTree converts a flat list of nodes into a nested tree rooted at the root node.
func buildTree(doc mindmap.Document) TreeNode {
	// Build a map of parentID -> children
	childrenMap := make(map[string][]mindmap.Node)
	var root mindmap.Node

	for _, n := range doc.Nodes {
		if n.Kind == mindmap.NodeKindRoot {
			root = n
		} else {
			childrenMap[n.ParentID] = append(childrenMap[n.ParentID], n)
		}
	}

	tree := buildTreeNode(root, childrenMap)
	tree.Revision = doc.Meta.Revision
	return tree
}

// buildTreeNode recursively constructs a TreeNode from a node and its children map.
func buildTreeNode(node mindmap.Node, childrenMap map[string][]mindmap.Node) TreeNode {
	children := childrenMap[node.ID]
	treeChildren := make([]TreeNode, 0, len(children))
	for _, child := range children {
		treeChildren = append(treeChildren, buildTreeNode(child, childrenMap))
	}
	return TreeNode{
		Node:     node,
		Children: treeChildren,
	}
}

// --- Compact representations for AI consumption ---

// compactNode is a minimal representation of a node for AI consumption.
// It omits position, createdAt, updatedAt, and the default "topic" kind.
type compactNode struct {
	ID        string            `json:"id"`
	ParentID  string            `json:"parentId,omitempty"`
	Kind      mindmap.NodeKind  `json:"kind,omitempty"`
	Title     string            `json:"title"`
	Note      string            `json:"note,omitempty"`
	Priority  mindmap.Priority  `json:"priority,omitempty"`
	Color     mindmap.NodeColor `json:"color,omitempty"`
	Collapsed bool              `json:"collapsed,omitempty"`
}

// compactNodeDetailResponse is the compact response for GET /api/maps/{mapId}/nodes/{nodeId}?compact=true.
type compactNodeDetailResponse struct {
	Revision  uint64        `json:"revision"`
	Node      compactNode   `json:"node"`
	Ancestors []compactNode `json:"ancestors"`
	Children  []compactNode `json:"children"`
}

// compactTreeNode is a compact nested tree node for AI consumption.
type compactTreeNode struct {
	ID        string            `json:"id"`
	ParentID  string            `json:"parentId,omitempty"`
	Kind      mindmap.NodeKind  `json:"kind,omitempty"`
	Title     string            `json:"title"`
	Note      string            `json:"note,omitempty"`
	Priority  mindmap.Priority  `json:"priority,omitempty"`
	Color     mindmap.NodeColor `json:"color,omitempty"`
	Collapsed bool              `json:"collapsed,omitempty"`
	Revision  uint64            `json:"revision,omitempty"`
	Children  []compactTreeNode `json:"children"`
}

func toCompactNode(n mindmap.Node) compactNode {
	kind := n.Kind
	if kind == mindmap.NodeKindTopic {
		kind = "" // omit default kind
	}
	return compactNode{
		ID:        n.ID,
		ParentID:  n.ParentID,
		Kind:      kind,
		Title:     n.Title,
		Note:      n.Note,
		Priority:  n.Priority,
		Color:     n.Color,
		Collapsed: n.Collapsed,
	}
}

func toCompactNodes(nodes []mindmap.Node) []compactNode {
	result := make([]compactNode, len(nodes))
	for i, n := range nodes {
		result[i] = toCompactNode(n)
	}
	return result
}

// buildCompactTree converts a flat list of nodes into a compact nested tree.
func buildCompactTree(doc mindmap.Document) compactTreeNode {
	childrenMap := make(map[string][]mindmap.Node)
	var root mindmap.Node

	for _, n := range doc.Nodes {
		if n.Kind == mindmap.NodeKindRoot {
			root = n
		} else {
			childrenMap[n.ParentID] = append(childrenMap[n.ParentID], n)
		}
	}

	tree := buildCompactTreeNode(root, childrenMap)
	tree.Revision = doc.Meta.Revision
	return tree
}

// buildCompactTreeNode recursively constructs a compactTreeNode.
func buildCompactTreeNode(node mindmap.Node, childrenMap map[string][]mindmap.Node) compactTreeNode {
	children := childrenMap[node.ID]
	treeChildren := make([]compactTreeNode, 0, len(children))
	for _, child := range children {
		treeChildren = append(treeChildren, buildCompactTreeNode(child, childrenMap))
	}

	kind := node.Kind
	if kind == mindmap.NodeKindTopic {
		kind = ""
	}

	return compactTreeNode{
		ID:        node.ID,
		ParentID:  node.ParentID,
		Kind:      kind,
		Title:     node.Title,
		Note:      node.Note,
		Priority:  node.Priority,
		Color:     node.Color,
		Collapsed: node.Collapsed,
		Children:  treeChildren,
	}
}

// mapVersionResponse is the response for GET /api/maps/{mapId}/version.
type mapVersionResponse struct {
	Revision     uint64    `json:"revision"`
	LastEditedAt time.Time `json:"lastEditedAt"`
	NodeCount    int       `json:"nodeCount"`
}

// collectDescendants returns a set of all descendant node IDs for the given nodeID.
func collectDescendants(doc mindmap.Document, nodeID string) map[string]bool {
	result := make(map[string]bool)
	queue := []string{nodeID}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		for _, n := range doc.Nodes {
			if n.ParentID == current && !result[n.ID] {
				result[n.ID] = true
				queue = append(queue, n.ID)
			}
		}
	}
	return result
}

func pruneRelationsToExistingNodes(doc *mindmap.Document) int {
	existing := make(map[string]struct{}, len(doc.Nodes))
	for _, node := range doc.Nodes {
		existing[node.ID] = struct{}{}
	}

	prunedCount := 0
	relations := make([]mindmap.RelationEdge, 0, len(doc.Relations))
	for _, relation := range doc.Relations {
		if _, ok := existing[relation.SourceID]; !ok {
			prunedCount++
			continue
		}
		if _, ok := existing[relation.TargetID]; !ok {
			prunedCount++
			continue
		}

		branches := make([]mindmap.RelationBranch, 0, len(relation.Branches))
		for _, branch := range relation.Branches {
			if _, ok := existing[branch.TargetID]; ok {
				branches = append(branches, branch)
			} else {
				prunedCount++
			}
		}
		relation.Branches = branches
		relations = append(relations, relation)
	}
	doc.Relations = relations
	return prunedCount
}
