package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"code-mind/internal/mindmap"
	"code-mind/internal/store"
)

type Server struct {
	store *store.FileStore
}

type importRequest struct {
	Content string `json:"content"`
	Format  string `json:"format"`
}

type createMapRequest struct {
	Title string `json:"title"`
}

type renameMapRequest struct {
	Title string `json:"title"`
}

type markdownResponse struct {
	Content string `json:"content"`
}

func New(fileStore *store.FileStore) *Server {
	return &Server{store: fileStore}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	s.registerAPI(mux)
	mux.HandleFunc("/", s.handleFrontend)
	return loggingMiddleware(mux)
}

func (s *Server) APIHandler() http.Handler {
	mux := http.NewServeMux()
	s.registerAPI(mux)
	return loggingMiddleware(corsMiddleware(mux))
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) registerAPI(mux *http.ServeMux) {
	mux.HandleFunc("/api/health", s.handleHealth)
	mux.HandleFunc("/api/maps", s.handleMaps)
	mux.HandleFunc("/api/maps/", s.handleMapByID)
	mux.HandleFunc("/api/export/markdown", s.handleExportMarkdown)
	mux.HandleFunc("/api/import", s.handleImport)
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
	mapID := strings.TrimPrefix(r.URL.Path, "/api/maps/")
	mapID = strings.TrimSpace(mapID)
	if mapID == "" {
		writeError(w, http.StatusBadRequest, errors.New("map id is required"))
		return
	}

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

func (s *Server) handleFrontend(w http.ResponseWriter, r *http.Request) {
	distDir := filepath.Join("frontend", "dist")
	indexPath := filepath.Join(distDir, "index.html")

	if _, err := os.Stat(indexPath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			http.Error(
				w,
				"frontend build not found. Run `cd frontend && npm install && npm run build` for production or `npm run dev` for local development.",
				http.StatusNotFound,
			)
			return
		}
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	cleanPath := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	requestPath := filepath.Join(distDir, filepath.FromSlash(cleanPath))
	if info, err := os.Stat(requestPath); err == nil && !info.IsDir() {
		http.ServeFile(w, r, requestPath)
		return
	}

	http.ServeFile(w, r, indexPath)
}

func writeJSON(w http.ResponseWriter, statusCode int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, statusCode int, err error) {
	writeJSON(w, statusCode, map[string]string{
		"error": err.Error(),
	})
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		next.ServeHTTP(w, r)
		fmt.Printf("%s %s %s\n", r.Method, r.URL.Path, time.Since(started).Round(time.Millisecond))
	})
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, PUT, PATCH, POST, DELETE, OPTIONS")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}
