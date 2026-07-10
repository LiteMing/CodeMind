package server

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"code-mind/internal/mindmap"
)

type createMapRequest struct {
	Title string `json:"title"`
}

type renameMapRequest struct {
	Title string `json:"title"`
}

func (s *Server) handleMaps(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		summaries, err := s.store.List()
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, summaries)
	case http.MethodPost:
		var req createMapRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		doc, err := s.store.Create(req.Title)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		setRevisionETag(w, doc.Meta.Revision)
		writeJSON(w, http.StatusCreated, doc)
	default:
		w.Header().Set("Allow", "GET, POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleMapByID(w http.ResponseWriter, r *http.Request) {
	suffix := strings.TrimPrefix(r.URL.Path, "/api/maps/")
	suffix = strings.TrimSpace(suffix)
	if suffix == "" {
		writeError(w, http.StatusBadRequest, errors.New("map id is required"))
		return
	}

	// Check if the path contains sub-resource segments (nodes, tree, batch, etc.)
	// Format: {mapId}/nodes, {mapId}/nodes/{nodeId}, {mapId}/tree, etc.
	if idx := strings.Index(suffix, "/"); idx >= 0 {
		mapID := suffix[:idx]
		subPath := suffix[idx+1:] // e.g. "nodes", "nodes/abc", "tree", "batch", etc.

		switch {
		case subPath == "nodes":
			if r.Method == http.MethodPost {
				s.handleAgentCommand(w, r, mapID, "create_node", "nodes", func(w http.ResponseWriter, r *http.Request) {
					s.handleNodes(w, r, mapID)
				})
				return
			}
			s.handleNodes(w, r, mapID)
			return
		case strings.HasPrefix(subPath, "nodes/"):
			nodeID := strings.TrimPrefix(subPath, "nodes/")
			if r.Method == http.MethodPatch {
				s.handleAgentCommand(w, r, mapID, "update_node", nodeID, func(w http.ResponseWriter, r *http.Request) {
					s.handleNodeByID(w, r, mapID, nodeID)
				})
				return
			}
			if r.Method == http.MethodDelete {
				s.handleAgentCommand(w, r, mapID, "delete_node", nodeID, func(w http.ResponseWriter, r *http.Request) {
					s.handleNodeByID(w, r, mapID, nodeID)
				})
				return
			}
			s.handleNodeByID(w, r, mapID, nodeID)
			return
		case subPath == "tree":
			s.handleNodeTree(w, r, mapID)
			return
		case subPath == "batch":
			if r.Method == http.MethodPost {
				s.handleAgentCommand(w, r, mapID, "batch_operations", "batch", func(w http.ResponseWriter, r *http.Request) {
					s.handleNodeBatch(w, r, mapID)
				})
				return
			}
			s.handleNodeBatch(w, r, mapID)
			return
		case subPath == "import-fragment":
			if r.Method == http.MethodPost {
				s.handleAgentCommand(w, r, mapID, "import_fragment", "import-fragment", func(w http.ResponseWriter, r *http.Request) {
					s.handleImportFragment(w, r, mapID)
				})
				return
			}
			s.handleImportFragment(w, r, mapID)
			return
		case subPath == "version":
			s.handleMapVersion(w, r, mapID)
			return
		case subPath == "poll":
			s.handleMapPoll(w, r, mapID)
			return
		}
	}

	// Original map-level CRUD (no sub-resource)
	mapID := suffix

	switch r.Method {
	case http.MethodGet:
		doc, err := s.store.Load(mapID)
		if err != nil {
			writeError(w, http.StatusNotFound, err)
			return
		}
		setRevisionETag(w, doc.Meta.Revision)
		writeJSON(w, http.StatusOK, doc)
	case http.MethodPut:
		expectedRevision, ok := requireExpectedRevision(w, r)
		if !ok {
			return
		}
		var doc mindmap.Document
		if err := json.NewDecoder(r.Body).Decode(&doc); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		doc.ID = mapID
		persisted, err := s.store.SaveIfRevision(doc, expectedRevision)
		if err != nil {
			writeMapStoreError(w, http.StatusBadRequest, err)
			return
		}
		setRevisionETag(w, persisted.Meta.Revision)
		s.recordAPIModification(mapID)
		writeJSON(w, http.StatusOK, persisted)
	case http.MethodPatch:
		expectedRevision, ok := requireExpectedRevision(w, r)
		if !ok {
			return
		}
		var req renameMapRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		trimmedTitle := strings.TrimSpace(req.Title)
		if trimmedTitle == "" {
			writeError(w, http.StatusBadRequest, errors.New("title is required"))
			return
		}
		doc, err := s.store.LoadReadOnly(mapID)
		if err != nil {
			writeMapStoreError(w, http.StatusBadRequest, err)
			return
		}
		for index := range doc.Nodes {
			if doc.Nodes[index].Kind == mindmap.NodeKindRoot {
				doc.Nodes[index].Title = trimmedTitle
				doc.Nodes[index].UpdatedAt = time.Now().UTC()
			}
		}
		doc.Title = trimmedTitle
		persisted, err := s.store.SaveIfRevision(doc, expectedRevision)
		if err != nil {
			writeMapStoreError(w, http.StatusBadRequest, err)
			return
		}
		setRevisionETag(w, persisted.Meta.Revision)
		s.recordAPIModification(mapID)
		writeJSON(w, http.StatusOK, persisted)
	case http.MethodDelete:
		expectedRevision, ok := requireExpectedRevision(w, r)
		if !ok {
			return
		}
		if err := s.store.DeleteIfRevision(mapID, expectedRevision); err != nil {
			writeMapStoreError(w, http.StatusNotFound, err)
			return
		}
		setRevisionETag(w, expectedRevision)
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
	default:
		w.Header().Set("Allow", "GET, PUT, PATCH, DELETE")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleNodeByID(w http.ResponseWriter, r *http.Request, mapID string, nodeID string) {
	switch r.Method {
	case http.MethodGet:
		s.handleNodeByIDGet(w, r, mapID, nodeID)
	case http.MethodPatch:
		s.handleNodeByIDPatch(w, r, mapID, nodeID)
	case http.MethodDelete:
		s.handleNodeByIDDelete(w, r, mapID, nodeID)
	default:
		w.Header().Set("Allow", "GET, PATCH, DELETE")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleNodeTree(w http.ResponseWriter, r *http.Request, mapID string) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	doc, err := s.store.LoadReadOnly(mapID)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}

	setRevisionETag(w, doc.Meta.Revision)
	if r.URL.Query().Get("compact") == "true" {
		tree := buildCompactTree(doc)
		writeJSON(w, http.StatusOK, tree)
		return
	}

	tree := buildTree(doc)
	writeJSON(w, http.StatusOK, tree)
}

func (s *Server) handleNodeBatch(w http.ResponseWriter, r *http.Request, mapID string) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	s.handleNodeBatchPost(w, r, mapID)
}

func (s *Server) handleImportFragment(w http.ResponseWriter, r *http.Request, mapID string) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	s.handleImportFragmentPost(w, r, mapID)
}

func (s *Server) handleMapVersion(w http.ResponseWriter, r *http.Request, mapID string) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	doc, err := s.store.LoadReadOnly(mapID)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}

	setRevisionETag(w, doc.Meta.Revision)
	writeJSON(w, http.StatusOK, mapVersionResponse{
		Revision:     doc.Meta.Revision,
		LastEditedAt: doc.Meta.LastEditedAt,
		NodeCount:    len(doc.Nodes),
	})
}

// recordAPIModification records the current time as the last API modification for a map.
func (s *Server) recordAPIModification(mapID string) {
	s.apiModifications.Store(mapID, time.Now().UTC())
}

// pollResponse is the response for GET /api/maps/{mapId}/poll.
type pollResponse struct {
	Revision       uint64    `json:"revision"`
	LastEditedAt   time.Time `json:"lastEditedAt"`
	NodeCount      int       `json:"nodeCount"`
	ModifiedViaAPI bool      `json:"modifiedViaAPI"`
}

func (s *Server) handleMapPoll(w http.ResponseWriter, r *http.Request, mapID string) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	doc, err := s.store.LoadReadOnly(mapID)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}

	modifiedViaAPI := false
	sinceStr := r.URL.Query().Get("since")
	if sinceStr != "" {
		since, parseErr := time.Parse(time.RFC3339Nano, sinceStr)
		if parseErr == nil {
			if val, ok := s.apiModifications.Load(mapID); ok {
				lastMod := val.(time.Time)
				if lastMod.After(since) {
					modifiedViaAPI = true
				}
			}
		}
	} else {
		// If no since parameter, just check if there's any recorded API modification
		if _, ok := s.apiModifications.Load(mapID); ok {
			modifiedViaAPI = true
		}
	}

	setRevisionETag(w, doc.Meta.Revision)
	writeJSON(w, http.StatusOK, pollResponse{
		Revision:       doc.Meta.Revision,
		LastEditedAt:   doc.Meta.LastEditedAt,
		NodeCount:      len(doc.Nodes),
		ModifiedViaAPI: modifiedViaAPI,
	})
}
