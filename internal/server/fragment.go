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

// fragmentNode represents a node in the import fragment tree.
type fragmentNode struct {
	Title    string            `json:"title"`
	ParentID string            `json:"parentId,omitempty"`
	Note     string            `json:"note,omitempty"`
	Priority mindmap.Priority  `json:"priority,omitempty"`
	Color    mindmap.NodeColor `json:"color,omitempty"`
	Children []fragmentNode    `json:"children,omitempty"`
}

// importFragmentRequest represents the JSON body for POST /api/maps/{mapId}/import-fragment.
type importFragmentRequest struct {
	Nodes []fragmentNode `json:"nodes"`
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

	// Find root node ID for default parentId
	rootID := ""
	for _, n := range doc.Nodes {
		if n.Kind == mindmap.NodeKindRoot {
			rootID = n.ID
			break
		}
	}

	// Build a node map for parent validation (includes existing + newly created nodes)
	nodeMap := doc.NodeMap()

	// Recursively create all nodes
	created := make([]mindmap.Node, 0)
	for _, frag := range req.Nodes {
		// Default parentId to root if not specified
		parentID := frag.ParentID
		if strings.TrimSpace(parentID) == "" {
			parentID = rootID
		}

		nodes, err := createFragmentNodes(frag, parentID, doc.Nodes, nodeMap)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		// Add all created nodes to doc and nodeMap for subsequent fragments
		for _, n := range nodes {
			doc.Nodes = append(doc.Nodes, n)
			nodeMap[n.ID] = n
		}
		created = append(created, nodes...)
	}

	persisted, err := s.store.SaveIfRevision(doc, expectedRevision)
	if err != nil {
		writeMapStoreError(w, http.StatusInternalServerError, err)
		return
	}

	s.recordAPIModification(mapID)
	setRevisionETag(w, persisted.Meta.Revision)
	writeJSON(w, http.StatusCreated, created)
}

// createFragmentNodes recursively creates nodes from a fragment tree.
// It returns all created nodes as a flat array.
func createFragmentNodes(frag fragmentNode, parentID string, existingNodes []mindmap.Node, nodeMap map[string]mindmap.Node) ([]mindmap.Node, error) {
	// Validate parentId exists
	if _, exists := nodeMap[parentID]; !exists {
		return nil, fmt.Errorf("parent node %q not found", parentID)
	}

	if strings.TrimSpace(frag.Title) == "" {
		return nil, errors.New("fragment node title is required")
	}

	// Find parent node and siblings for position calculation
	parent := nodeMap[parentID]

	// Collect all current children of this parent (existing + already created in this batch)
	siblings := make([]mindmap.Node, 0)
	for _, n := range existingNodes {
		if n.ParentID == parentID {
			siblings = append(siblings, n)
		}
	}

	position := calculateChildPosition(parent, siblings)

	now := time.Now().UTC()
	node := mindmap.Node{
		ID:        mindmap.NewID("node"),
		ParentID:  parentID,
		Kind:      mindmap.NodeKindTopic,
		Title:     frag.Title,
		Note:      frag.Note,
		Priority:  frag.Priority,
		Color:     frag.Color,
		Position:  position,
		CreatedAt: now,
		UpdatedAt: now,
	}

	result := []mindmap.Node{node}

	// Add this node to existingNodes and nodeMap so children can reference it
	existingNodes = append(existingNodes, node)
	nodeMap[node.ID] = node

	// Recursively process children
	for _, child := range frag.Children {
		childNodes, err := createFragmentNodes(child, node.ID, existingNodes, nodeMap)
		if err != nil {
			return nil, err
		}
		// Add child nodes to existingNodes for sibling position calculation
		for _, cn := range childNodes {
			existingNodes = append(existingNodes, cn)
			nodeMap[cn.ID] = cn
		}
		result = append(result, childNodes...)
	}

	return result, nil
}
