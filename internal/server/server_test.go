package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"code-mind/internal/mindmap"
	"code-mind/internal/store"
)

func TestHealthAndMapLifecycle(t *testing.T) {
	handler := newTestHandler(t)

	healthReq := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	healthRes := httptest.NewRecorder()
	handler.ServeHTTP(healthRes, healthReq)

	if healthRes.Code != http.StatusOK {
		t.Fatalf("expected 200 health, got %d", healthRes.Code)
	}

	listReq := httptest.NewRequest(http.MethodGet, "/api/maps", nil)
	listRes := httptest.NewRecorder()
	handler.ServeHTTP(listRes, listReq)

	if listRes.Code != http.StatusOK {
		t.Fatalf("expected 200 map list, got %d", listRes.Code)
	}

	var initialList []store.MapSummary
	if err := json.Unmarshal(listRes.Body.Bytes(), &initialList); err != nil {
		t.Fatalf("failed to decode initial map list: %v", err)
	}
	if len(initialList) != 0 {
		t.Fatalf("expected empty map list, got %d items", len(initialList))
	}

	createReq := httptest.NewRequest(http.MethodPost, "/api/maps", strings.NewReader(`{"title":"Roadmap"}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRes := httptest.NewRecorder()
	handler.ServeHTTP(createRes, createReq)

	if createRes.Code != http.StatusCreated {
		t.Fatalf("expected 201 on create, got %d with body %s", createRes.Code, createRes.Body.String())
	}

	var created mindmap.Document
	if err := json.Unmarshal(createRes.Body.Bytes(), &created); err != nil {
		t.Fatalf("failed to decode created document: %v", err)
	}
	if created.ID == "" {
		t.Fatal("expected created document id")
	}
	if created.Title != "Roadmap" {
		t.Fatalf("expected created title to be Roadmap, got %q", created.Title)
	}

	listReq = httptest.NewRequest(http.MethodGet, "/api/maps", nil)
	listRes = httptest.NewRecorder()
	handler.ServeHTTP(listRes, listReq)

	if listRes.Code != http.StatusOK {
		t.Fatalf("expected 200 map list after create, got %d", listRes.Code)
	}

	var summaries []store.MapSummary
	if err := json.Unmarshal(listRes.Body.Bytes(), &summaries); err != nil {
		t.Fatalf("failed to decode map summaries: %v", err)
	}
	if len(summaries) != 1 {
		t.Fatalf("expected 1 map summary, got %d", len(summaries))
	}
	if summaries[0].ID != created.ID {
		t.Fatalf("expected summary id %q, got %q", created.ID, summaries[0].ID)
	}

	loadReq := httptest.NewRequest(http.MethodGet, "/api/maps/"+created.ID, nil)
	loadRes := httptest.NewRecorder()
	handler.ServeHTTP(loadRes, loadReq)

	if loadRes.Code != http.StatusOK {
		t.Fatalf("expected 200 on load, got %d with body %s", loadRes.Code, loadRes.Body.String())
	}

	var loaded mindmap.Document
	if err := json.Unmarshal(loadRes.Body.Bytes(), &loaded); err != nil {
		t.Fatalf("failed to decode loaded document: %v", err)
	}
	if loaded.Title != "Roadmap" {
		t.Fatalf("expected loaded title to be Roadmap, got %q", loaded.Title)
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
	createReq := httptest.NewRequest(http.MethodPost, "/api/maps", strings.NewReader(`{"title":"Delivery Plan"}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRes := httptest.NewRecorder()
	handler.ServeHTTP(createRes, createReq)

	if createRes.Code != http.StatusCreated {
		t.Fatalf("expected 201 on create, got %d with body %s", createRes.Code, createRes.Body.String())
	}

	var doc mindmap.Document
	if err := json.Unmarshal(createRes.Body.Bytes(), &doc); err != nil {
		t.Fatalf("failed to decode created document: %v", err)
	}

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

	saveReq := httptest.NewRequest(http.MethodPut, "/api/maps/"+doc.ID, bytes.NewReader(savePayload))
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

	storePath := t.TempDir()
	fileStore := store.NewFileStore(storePath)
	return New(fileStore).Handler()
}
