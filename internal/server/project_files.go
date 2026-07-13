package server

import (
	"fmt"
	"net/http"

	"code-mind/internal/mindmap"
)

type projectFilesResponse struct {
	MapID    string `json:"mapId"`
	Revision uint64 `json:"revision"`
	Semantic string `json:"semantic"`
	Layout   string `json:"layout"`
}

// handleProjectFiles returns the canonical Git-oriented representation without
// exposing the runtime data directory to thin clients.
func (s *Server) handleProjectFiles(w http.ResponseWriter, r *http.Request, mapID string) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	document, err := s.store.LoadReadOnly(mapID)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	semantic, layout, err := mindmap.SplitProjectMapDocument(document)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Errorf("split project map: %w", err))
		return
	}
	semanticPayload, err := mindmap.MarshalProjectMapSemantic(semantic)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Errorf("marshal semantic project map: %w", err))
		return
	}
	layoutPayload, err := mindmap.MarshalProjectMapLayout(layout)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Errorf("marshal layout project map: %w", err))
		return
	}

	setRevisionETag(w, document.Meta.Revision)
	writeJSON(w, http.StatusOK, projectFilesResponse{
		MapID:    document.ID,
		Revision: document.Meta.Revision,
		Semantic: string(semanticPayload),
		Layout:   string(layoutPayload),
	})
}
