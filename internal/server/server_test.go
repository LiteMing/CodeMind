package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"code-mind/internal/mindmap"
	"code-mind/internal/store"
)

func TestHealthAndDefaultMap(t *testing.T) {
	handler := newTestHandler(t)

	healthReq := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	healthRes := httptest.NewRecorder()
	handler.ServeHTTP(healthRes, healthReq)

	if healthRes.Code != http.StatusOK {
		t.Fatalf("expected 200 health, got %d", healthRes.Code)
	}

	mapReq := httptest.NewRequest(http.MethodGet, "/api/maps/default", nil)
	mapRes := httptest.NewRecorder()
	handler.ServeHTTP(mapRes, mapReq)

	if mapRes.Code != http.StatusOK {
		t.Fatalf("expected 200 default map, got %d", mapRes.Code)
	}

	var doc mindmap.Document
	if err := json.Unmarshal(mapRes.Body.Bytes(), &doc); err != nil {
		t.Fatalf("failed to decode document: %v", err)
	}
	if doc.Root().Title == "" {
		t.Fatal("expected default root title")
	}
}

func TestImportRejectsUnsupportedFormat(t *testing.T) {
	handler := newTestHandler(t)

	body := strings.NewReader(`{"content":"hello","format":"json"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/import", body)
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()

	handler.ServeHTTP(res, req)

	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", res.Code)
	}
	if !strings.Contains(res.Body.String(), "unsupported import format") {
		t.Fatalf("unexpected body: %s", res.Body.String())
	}
}

func TestSaveAndExportMarkdown(t *testing.T) {
	handler := newTestHandler(t)
	doc := mindmap.NewDefaultDocument()
	node := mindmap.Node{
		ID:       "node-1",
		ParentID: "root",
		Kind:     mindmap.NodeKindTopic,
		Title:    "Delivery",
		Position: mindmap.Position{X: 580, Y: 280},
	}
	doc.Nodes = append(doc.Nodes, node)

	savePayload, err := json.Marshal(doc)
	if err != nil {
		t.Fatalf("failed to marshal document: %v", err)
	}

	saveReq := httptest.NewRequest(http.MethodPut, "/api/maps/default", bytes.NewReader(savePayload))
	saveReq.Header.Set("Content-Type", "application/json")
	saveRes := httptest.NewRecorder()
	handler.ServeHTTP(saveRes, saveReq)

	if saveRes.Code != http.StatusOK {
		t.Fatalf("expected 200 on save, got %d with body %s", saveRes.Code, saveRes.Body.String())
	}

	exportReq := httptest.NewRequest(http.MethodPost, "/api/export/markdown", bytes.NewReader(savePayload))
	exportReq.Header.Set("Content-Type", "application/json")
	exportRes := httptest.NewRecorder()
	handler.ServeHTTP(exportRes, exportReq)

	if exportRes.Code != http.StatusOK {
		t.Fatalf("expected 200 on export, got %d", exportRes.Code)
	}
	if !strings.Contains(exportRes.Body.String(), "Delivery") {
		t.Fatalf("expected markdown export to contain node title, got %s", exportRes.Body.String())
	}
}

func newTestHandler(t *testing.T) http.Handler {
	t.Helper()

	storePath := filepath.Join(t.TempDir(), "default-map.json")
	fileStore := store.NewFileStore(storePath)
	return New(fileStore).Handler()
}
