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
	expectedRevision, ok := requireExpectedRevision(w, r)
	if !ok {
		return
	}
	doc, err := s.store.LoadReadOnly(mapID)
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

	resultIDs := make([]string, 0)
	deletedCount := 0

	for i, op := range req.Operations {
		switch op.Action {
		case "create":
			node, updatedNodes, err := batchCreate(nodesCopy, op.Payload)
			if err != nil {
				writeError(w, http.StatusBadRequest, fmt.Errorf("batch operation %d failed: %w", i+1, err))
				return
			}
			nodesCopy = updatedNodes
			resultIDs = append(resultIDs, node.ID)

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
			resultIDs = append(resultIDs, updated.ID)

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

		candidate := doc
		candidate.Nodes = nodesCopy
		pruneRelationsToExistingNodes(&candidate)
		if err := candidate.Validate(); err != nil {
			writeError(w, http.StatusBadRequest, fmt.Errorf("batch operation %d failed: %w", i+1, err))
			return
		}
		nodesCopy = candidate.Nodes
	}

	// All operations succeeded, commit changes
	doc.Nodes = nodesCopy
	pruneRelationsToExistingNodes(&doc)
	persisted, err := s.store.SaveIfRevision(doc, expectedRevision)
	if err != nil {
		writeMapStoreError(w, http.StatusInternalServerError, err)
		return
	}

	s.recordAPIModification(mapID)
	setRevisionETag(w, persisted.Meta.Revision)
	persistedNodes := persisted.NodeMap()
	results := make([]mindmap.Node, 0, len(resultIDs))
	for _, nodeID := range resultIDs {
		if node, exists := persistedNodes[nodeID]; exists {
			results = append(results, node)
		}
	}
	writeJSON(w, http.StatusOK, batchResponse{
		Results:      results,
		DeletedCount: deletedCount,
	})
}

// batchCreate creates a new node from the payload, using the current nodes slice for context.
func batchCreate(nodes []mindmap.Node, payload json.RawMessage) (mindmap.Node, []mindmap.Node, error) {
	var req createNodeRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		return mindmap.Node{}, nil, fmt.Errorf("invalid create payload: %w", err)
	}

	if strings.TrimSpace(req.ParentID) == "" {
		return mindmap.Node{}, nil, errors.New("parentId is required")
	}
	if strings.TrimSpace(req.Title) == "" {
		return mindmap.Node{}, nil, errors.New("title is required")
	}
	if req.Kind != "" && !isValidNodeKind(req.Kind) {
		return mindmap.Node{}, nil, fmt.Errorf("invalid node kind: %q", req.Kind)
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
		return mindmap.Node{}, nil, fmt.Errorf("parent node %q not found", req.ParentID)
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
		Bindings:  req.Bindings,
		Position:  position,
		CreatedAt: now,
		UpdatedAt: now,
	}

	updatedNodes, err := insertNodeWithOrder(nodes, node, req.Order)
	if err != nil {
		return mindmap.Node{}, nil, err
	}
	return updatedNodes[len(updatedNodes)-1], updatedNodes, nil
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

	var req updateNodeRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		return mindmap.Node{}, nil, fmt.Errorf("invalid update payload: %w", err)
	}

	targetParentID := nodes[nodeIndex].ParentID
	if req.ParentID != nil {
		targetParentID = strings.TrimSpace(*req.ParentID)
	}
	if req.ParentID != nil || req.Order != nil {
		if err := moveNodeWithOrder(nodes, nodeIndex, targetParentID, req.Order); err != nil {
			return mindmap.Node{}, nil, err
		}
	}

	node := &nodes[nodeIndex]
	if req.Title != nil {
		if strings.TrimSpace(*req.Title) == "" {
			return mindmap.Node{}, nil, errors.New("title is required")
		}
		node.Title = *req.Title
	}
	if req.Note != nil {
		node.Note = *req.Note
	}
	if req.Priority != nil {
		node.Priority = *req.Priority
	}
	if req.Color != nil {
		node.Color = *req.Color
	}
	if req.Bindings != nil {
		node.Bindings = *req.Bindings
	}
	if req.Collapsed != nil {
		node.Collapsed = *req.Collapsed
	}
	node.UpdatedAt = time.Now().UTC()

	return *node, nodes, nil
}

// batchDelete removes a node (and optionally its descendants) from the nodes slice.
func batchDelete(nodes []mindmap.Node, nodeID string, payload json.RawMessage) (int, []mindmap.Node, error) {
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

	return deleteNodeWithOrder(nodes, nodeID, cascade)
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
