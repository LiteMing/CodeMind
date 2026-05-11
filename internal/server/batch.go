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

// batchOperation represents a single operation in a batch request.
type batchOperation struct {
	Action  string          `json:"action"`
	NodeID  string          `json:"nodeId,omitempty"`
	Payload json.RawMessage `json:"payload"`
}

// batchRequest represents the JSON body for POST /api/maps/{mapId}/batch.
type batchRequest struct {
	Operations []batchOperation `json:"operations"`
}

// batchResponse represents the response for a successful batch operation.
type batchResponse struct {
	Results      []mindmap.Node `json:"results"`
	DeletedCount int            `json:"deletedCount"`
}

func (s *Server) handleNodeBatchPost(w http.ResponseWriter, r *http.Request, mapID string) {
	doc, err := s.store.Load(mapID)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}

	var req batchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	if len(req.Operations) == 0 {
		writeError(w, http.StatusBadRequest, errors.New("operations array is required and must not be empty"))
		return
	}

	// Work on a copy of nodes for atomicity
	nodesCopy := make([]mindmap.Node, len(doc.Nodes))
	copy(nodesCopy, doc.Nodes)

	results := make([]mindmap.Node, 0)
	deletedCount := 0

	for i, op := range req.Operations {
		switch op.Action {
		case "create":
			node, err := batchCreate(nodesCopy, op.Payload)
			if err != nil {
				writeError(w, http.StatusBadRequest, fmt.Errorf("batch operation %d failed: %w", i+1, err))
				return
			}
			nodesCopy = append(nodesCopy, node)
			results = append(results, node)

		case "update":
			if strings.TrimSpace(op.NodeID) == "" {
				writeError(w, http.StatusBadRequest, fmt.Errorf("batch operation %d failed: nodeId is required for update", i+1))
				return
			}
			updated, updatedNodes, err := batchUpdate(nodesCopy, op.NodeID, op.Payload)
			if err != nil {
				writeError(w, http.StatusBadRequest, fmt.Errorf("batch operation %d failed: %w", i+1, err))
				return
			}
			nodesCopy = updatedNodes
			results = append(results, updated)

		case "delete":
			if strings.TrimSpace(op.NodeID) == "" {
				writeError(w, http.StatusBadRequest, fmt.Errorf("batch operation %d failed: nodeId is required for delete", i+1))
				return
			}
			count, remaining, err := batchDelete(nodesCopy, op.NodeID, op.Payload)
			if err != nil {
				writeError(w, http.StatusBadRequest, fmt.Errorf("batch operation %d failed: %w", i+1, err))
				return
			}
			nodesCopy = remaining
			deletedCount += count

		default:
			writeError(w, http.StatusBadRequest, fmt.Errorf("batch operation %d failed: invalid action %q", i+1, op.Action))
			return
		}
	}

	// All operations succeeded, commit changes
	doc.Nodes = nodesCopy
	if err := s.store.Save(doc); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	s.recordAPIModification(mapID)
	writeJSON(w, http.StatusOK, batchResponse{
		Results:      results,
		DeletedCount: deletedCount,
	})
}

// batchCreate creates a new node from the payload, using the current nodes slice for context.
func batchCreate(nodes []mindmap.Node, payload json.RawMessage) (mindmap.Node, error) {
	var req createNodeRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		return mindmap.Node{}, fmt.Errorf("invalid create payload: %w", err)
	}

	if strings.TrimSpace(req.ParentID) == "" {
		return mindmap.Node{}, errors.New("parentId is required")
	}
	if strings.TrimSpace(req.Title) == "" {
		return mindmap.Node{}, errors.New("title is required")
	}
	if req.Kind != "" && !isValidNodeKind(req.Kind) {
		return mindmap.Node{}, fmt.Errorf("invalid node kind: %q", req.Kind)
	}

	// Find parent in current nodes
	var parent mindmap.Node
	found := false
	for _, n := range nodes {
		if n.ID == req.ParentID {
			parent = n
			found = true
			break
		}
	}
	if !found {
		return mindmap.Node{}, fmt.Errorf("parent node %q not found", req.ParentID)
	}

	// Calculate position
	siblings := childrenOf(nodes, req.ParentID)
	position := calculateChildPosition(parent, siblings)

	now := time.Now().UTC()
	kind := req.Kind
	if kind == "" {
		kind = mindmap.NodeKindTopic
	}

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

	return node, nil
}

// batchUpdate applies partial updates to a node identified by nodeID.
func batchUpdate(nodes []mindmap.Node, nodeID string, payload json.RawMessage) (mindmap.Node, []mindmap.Node, error) {
	nodeIndex := -1
	for i, n := range nodes {
		if n.ID == nodeID {
			nodeIndex = i
			break
		}
	}
	if nodeIndex == -1 {
		return mindmap.Node{}, nil, fmt.Errorf("node %q not found", nodeID)
	}

	var fields map[string]interface{}
	if err := json.Unmarshal(payload, &fields); err != nil {
		return mindmap.Node{}, nil, fmt.Errorf("invalid update payload: %w", err)
	}

	node := &nodes[nodeIndex]
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
		}
	}
	node.UpdatedAt = time.Now().UTC()

	return *node, nodes, nil
}

// batchDelete removes a node (and optionally its descendants) from the nodes slice.
func batchDelete(nodes []mindmap.Node, nodeID string, payload json.RawMessage) (int, []mindmap.Node, error) {
	// Find the node
	var target mindmap.Node
	found := false
	for _, n := range nodes {
		if n.ID == nodeID {
			target = n
			found = true
			break
		}
	}
	if !found {
		return 0, nil, fmt.Errorf("node %q not found", nodeID)
	}

	if target.Kind == mindmap.NodeKindRoot {
		return 0, nil, errors.New("cannot delete root node")
	}

	// Parse cascade option from payload
	cascade := true
	if len(payload) > 0 {
		var opts struct {
			Cascade *bool `json:"cascade"`
		}
		if err := json.Unmarshal(payload, &opts); err == nil && opts.Cascade != nil {
			cascade = *opts.Cascade
		}
	}

	deletedCount := 0

	if cascade {
		// Collect all descendants
		toDelete := collectDescendantsFromSlice(nodes, nodeID)
		toDelete[nodeID] = true
		deletedCount = len(toDelete)

		remaining := make([]mindmap.Node, 0, len(nodes)-deletedCount)
		for _, n := range nodes {
			if !toDelete[n.ID] {
				remaining = append(remaining, n)
			}
		}
		return deletedCount, remaining, nil
	}

	// Re-parent direct children
	parentID := target.ParentID
	for i := range nodes {
		if nodes[i].ParentID == nodeID {
			nodes[i].ParentID = parentID
		}
	}

	// Remove only the target node
	remaining := make([]mindmap.Node, 0, len(nodes)-1)
	for _, n := range nodes {
		if n.ID != nodeID {
			remaining = append(remaining, n)
		}
	}
	return 1, remaining, nil
}

// childrenOf returns all nodes whose parentID matches the given ID.
func childrenOf(nodes []mindmap.Node, parentID string) []mindmap.Node {
	children := make([]mindmap.Node, 0)
	for _, n := range nodes {
		if n.ParentID == parentID {
			children = append(children, n)
		}
	}
	return children
}

// collectDescendantsFromSlice returns a set of all descendant node IDs from a flat slice.
func collectDescendantsFromSlice(nodes []mindmap.Node, nodeID string) map[string]bool {
	result := make(map[string]bool)
	queue := []string{nodeID}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		for _, n := range nodes {
			if n.ParentID == current && !result[n.ID] {
				result[n.ID] = true
				queue = append(queue, n.ID)
			}
		}
	}
	return result
}
