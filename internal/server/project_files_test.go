package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"code-mind/internal/mindmap"
)

func TestProjectFilesReturnsCanonicalDocuments(t *testing.T) {
	srv := newTestServer(t)
	document, err := srv.store.Create("Workspace projection")
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/maps/"+document.ID+"/project-files", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if got, want := rec.Header().Get("ETag"), `"rev-1"`; got != want {
		t.Fatalf("expected ETag %s, got %s", want, got)
	}

	var response projectFilesResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.MapID != document.ID || response.Revision != document.Meta.Revision {
		t.Fatalf("unexpected response identity: %+v", response)
	}

	semantic, layout, err := mindmap.SplitProjectMapDocument(document)
	if err != nil {
		t.Fatal(err)
	}
	wantSemantic, err := mindmap.MarshalProjectMapSemantic(semantic)
	if err != nil {
		t.Fatal(err)
	}
	wantLayout, err := mindmap.MarshalProjectMapLayout(layout)
	if err != nil {
		t.Fatal(err)
	}
	if response.Semantic != string(wantSemantic) {
		t.Fatalf("semantic payload is not canonical\nwant: %s\n got: %s", wantSemantic, response.Semantic)
	}
	if response.Layout != string(wantLayout) {
		t.Fatalf("layout payload is not canonical\nwant: %s\n got: %s", wantLayout, response.Layout)
	}
}

func TestProjectFilesIsReadOnly(t *testing.T) {
	srv := newTestServer(t)
	document, err := srv.store.Create("Workspace projection")
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/maps/"+document.ID+"/project-files", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d: %s", rec.Code, rec.Body.String())
	}
}
