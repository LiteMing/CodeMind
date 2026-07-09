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
			s.handleNodes(w, r, mapID)
			return
		case strings.HasPrefix(subPath, "nodes/"):
			nodeID := strings.TrimPrefix(subPath, "nodes/")
			s.handleNodeByID(w, r, mapID, nodeID)
			return
		case subPath == "tree":
			s.handleNodeTree(w, r, mapID)
			return
		case subPath == "batch":
			s.handleNodeBatch(w, r, mapID)
			return
		case subPath == "import-fragment":
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
		writeJSON(w, http.StatusOK, doc)
	case http.MethodPut:
		var doc mindmap.Document
		if err := json.NewDecoder(r.Body).Decode(&doc); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		doc.ID = mapID
		if err := s.store.Save(doc); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		writeJSON(w, http.StatusOK, doc)
	case http.MethodPatch:
		var req renameMapRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		doc, err := s.store.Rename(mapID, req.Title)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		writeJSON(w, http.StatusOK, doc)
	case http.MethodDelete:
		if err := s.store.Delete(mapID); err != nil {
			writeError(w, http.StatusNotFound, err)
			return
		}
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

	writeJSON(w, http.StatusOK, mapVersionResponse{
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

	writeJSON(w, http.StatusOK, pollResponse{
		LastEditedAt:   doc.Meta.LastEditedAt,
		NodeCount:      len(doc.Nodes),
		ModifiedViaAPI: modifiedViaAPI,
	})
}
