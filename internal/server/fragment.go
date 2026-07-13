package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"code-mind/internal/mindmap"
)

// fragmentNode represents a node in the import fragment tree.
type fragmentNode struct {
	Title    string                `json:"title"`
	ParentID string                `json:"parentId,omitempty"`
	Order    *int                  `json:"order,omitempty"`
	Note     string                `json:"note,omitempty"`
	Priority mindmap.Priority      `json:"priority,omitempty"`
	Color    mindmap.NodeColor     `json:"color,omitempty"`
	Bindings []mindmap.NodeBinding `json:"bindings,omitempty"`
	Children []fragmentNode        `json:"children,omitempty"`
}

// importFragmentRequest represents the JSON body for POST /api/maps/{mapId}/import-fragment.
type importFragmentRequest struct {
	ParentID string         `json:"parentId,omitempty"`
	Nodes    []fragmentNode `json:"nodes"`
}

func (s *Server) handleImportFragmentPost(w http.ResponseWriter, r *http.Request, mapID string) {
	expectedRevision, ok := requireExpectedRevision(w, r)
	if !ok {
		return
	}
	doc, err := s.store.LoadReadOnly(mapID)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}

	var req importFragmentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	if len(req.Nodes) == 0 {
		writeError(w, http.StatusBadRequest, errors.New("nodes array is required and must not be empty"))
		return
	}

	rootID := ""
	for _, node := range doc.Nodes {
		if node.Kind == mindmap.NodeKindRoot {
			rootID = node.ID
			break
		}
	}

	nodeMap := doc.NodeMap()
	createdIDs := make([]string, 0)
	for _, fragment := range orderedFragmentNodes(req.Nodes) {
		parentID := strings.TrimSpace(fragment.ParentID)
		if parentID == "" {
			parentID = strings.TrimSpace(req.ParentID)
		}
		if parentID == "" {
			parentID = rootID
		}

		nodes, err := createFragmentNodes(fragment, parentID, &doc, nodeMap)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		for _, node := range nodes {
			nodeMap[node.ID] = node
			createdIDs = append(createdIDs, node.ID)
		}
	}

	if err := doc.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	persisted, err := s.store.SaveIfRevision(doc, expectedRevision)
	if err != nil {
		writeMapStoreError(w, http.StatusInternalServerError, err)
		return
	}

	persistedNodes := persisted.NodeMap()
	created := make([]mindmap.Node, 0, len(createdIDs))
	for _, nodeID := range createdIDs {
		created = append(created, persistedNodes[nodeID])
	}
	s.recordAPIModification(mapID)
	setRevisionETag(w, persisted.Meta.Revision)
	writeJSON(w, http.StatusCreated, created)
}

// createFragmentNodes recursively creates nodes from a fragment tree and
// returns them as a flat array in creation order.
func createFragmentNodes(
	fragment fragmentNode,
	parentID string,
	doc *mindmap.Document,
	nodeMap map[string]mindmap.Node,
) ([]mindmap.Node, error) {
	parent, exists := nodeMap[parentID]
	if !exists {
		return nil, fmt.Errorf("parent node %q not found", parentID)
	}
	if strings.TrimSpace(fragment.Title) == "" {
		return nil, errors.New("fragment node title is required")
	}

	position := calculateChildPosition(parent, doc.ChildrenOf(parentID))
	now := time.Now().UTC()
	node := mindmap.Node{
		ID:        mindmap.NewID("node"),
		ParentID:  parentID,
		Kind:      mindmap.NodeKindTopic,
		Title:     fragment.Title,
		Note:      fragment.Note,
		Priority:  fragment.Priority,
		Color:     fragment.Color,
		Bindings:  fragment.Bindings,
		Position:  position,
		CreatedAt: now,
		UpdatedAt: now,
	}

	var err error
	doc.Nodes, err = insertNodeWithOrder(doc.Nodes, node, fragment.Order)
	if err != nil {
		return nil, err
	}
	if err := doc.Validate(); err != nil {
		return nil, err
	}
	node = doc.NodeMap()[node.ID]
	nodeMap[node.ID] = node
	result := []mindmap.Node{node}

	for _, child := range orderedFragmentNodes(fragment.Children) {
		childNodes, err := createFragmentNodes(child, node.ID, doc, nodeMap)
		if err != nil {
			return nil, err
		}
		for _, childNode := range childNodes {
			nodeMap[childNode.ID] = childNode
		}
		result = append(result, childNodes...)
	}

	return result, nil
}

func orderedFragmentNodes(nodes []fragmentNode) []fragmentNode {
	ordered := append([]fragmentNode(nil), nodes...)
	slices.SortStableFunc(ordered, func(left, right fragmentNode) int {
		switch {
		case left.Order == nil && right.Order == nil:
			return 0
		case left.Order == nil:
			return 1
		case right.Order == nil:
			return -1
		default:
			return *left.Order - *right.Order
		}
	})
	return ordered
}
