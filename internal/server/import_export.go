package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"code-mind/internal/mindmap"
)

type importRequest struct {
	Content string `json:"content"`
	Format  string `json:"format"`
}

type markdownResponse struct {
	Content string `json:"content"`
}

func (s *Server) handleExportMarkdown(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var doc mindmap.Document
	if err := json.NewDecoder(r.Body).Decode(&doc); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := doc.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	writeJSON(w, http.StatusOK, markdownResponse{
		Content: mindmap.ExportMarkdown(doc),
	})
}

func (s *Server) handleImport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req importRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if strings.TrimSpace(req.Content) == "" {
		writeError(w, http.StatusBadRequest, errors.New("content is required"))
		return
	}

	var doc mindmap.Document
	switch strings.ToLower(strings.TrimSpace(req.Format)) {
	case "markdown", "md":
		doc = mindmap.ImportMarkdown(req.Content)
	case "text", "txt":
		doc = mindmap.ImportPlainText(req.Content)
	default:
		writeError(w, http.StatusBadRequest, fmt.Errorf("unsupported import format: %s", req.Format))
		return
	}

	writeJSON(w, http.StatusOK, doc)
}
