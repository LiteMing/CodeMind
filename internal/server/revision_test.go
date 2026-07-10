package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"code-mind/internal/mindmap"
)

func TestExistingMapWritesRequireIfMatch(t *testing.T) {
	handler := newTestServer(t).Handler()
	paths := []struct {
		method string
		path   string
	}{
		{http.MethodPut, "/api/maps/map-1"},
		{http.MethodPatch, "/api/maps/map-1"},
		{http.MethodDelete, "/api/maps/map-1"},
		{http.MethodPost, "/api/maps/map-1/nodes"},
		{http.MethodPatch, "/api/maps/map-1/nodes/node-1"},
		{http.MethodDelete, "/api/maps/map-1/nodes/node-1"},
		{http.MethodPost, "/api/maps/map-1/batch"},
		{http.MethodPost, "/api/maps/map-1/import-fragment"},
	}

	for _, item := range paths {
		t.Run(item.method+" "+item.path, func(t *testing.T) {
			req := httptest.NewRequest(item.method, item.path, strings.NewReader(`{}`))
			res := httptest.NewRecorder()
			handler.ServeHTTP(res, req)
			if res.Code != http.StatusPreconditionRequired {
				t.Fatalf("expected 428, got %d: %s", res.Code, res.Body.String())
			}
		})
	}
}

func TestMapSaveUsesETagAndRejectsStaleRevision(t *testing.T) {
	handler := newTestServer(t).Handler()
	createReq := httptest.NewRequest(http.MethodPost, "/api/maps", strings.NewReader(`{"title":"Revision"}`))
	createRes := httptest.NewRecorder()
	handler.ServeHTTP(createRes, createReq)
	if createRes.Code != http.StatusCreated {
		t.Fatalf("create failed: %d %s", createRes.Code, createRes.Body.String())
	}
	if got := createRes.Header().Get("ETag"); got != `"rev-1"` {
		t.Fatalf("expected create ETag rev-1, got %q", got)
	}

	var doc mindmap.Document
	if err := json.Unmarshal(createRes.Body.Bytes(), &doc); err != nil {
		t.Fatal(err)
	}
	doc.Nodes[0].Title = "Revision Two"
	payload, _ := json.Marshal(doc)
	saveReq := httptest.NewRequest(http.MethodPut, "/api/maps/"+doc.ID, bytes.NewReader(payload))
	saveReq.Header.Set("If-Match", `"rev-1"`)
	saveRes := httptest.NewRecorder()
	handler.ServeHTTP(saveRes, saveReq)
	if saveRes.Code != http.StatusOK {
		t.Fatalf("save failed: %d %s", saveRes.Code, saveRes.Body.String())
	}
	if got := saveRes.Header().Get("ETag"); got != `"rev-2"` {
		t.Fatalf("expected save ETag rev-2, got %q", got)
	}

	staleReq := httptest.NewRequest(http.MethodPut, "/api/maps/"+doc.ID, bytes.NewReader(payload))
	staleReq.Header.Set("If-Match", `"rev-1"`)
	staleRes := httptest.NewRecorder()
	handler.ServeHTTP(staleRes, staleReq)
	if staleRes.Code != http.StatusPreconditionFailed {
		t.Fatalf("expected 412, got %d: %s", staleRes.Code, staleRes.Body.String())
	}
	if got := staleRes.Header().Get("ETag"); got != `"rev-2"` {
		t.Fatalf("expected conflict ETag rev-2, got %q", got)
	}
	var conflict struct {
		Expected uint64 `json:"expectedRevision"`
		Actual   uint64 `json:"actualRevision"`
	}
	if err := json.Unmarshal(staleRes.Body.Bytes(), &conflict); err != nil {
		t.Fatal(err)
	}
	if conflict.Expected != 1 || conflict.Actual != 2 {
		t.Fatalf("unexpected conflict payload: %+v", conflict)
	}
}

func TestMalformedIfMatchIsRejected(t *testing.T) {
	handler := newTestServer(t).Handler()
	for _, value := range []string{"revision-1", "rev-1", `"revision-1"`} {
		req := httptest.NewRequest(http.MethodPut, "/api/maps/map-1", strings.NewReader(`{}`))
		req.Header.Set("If-Match", value)
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != http.StatusBadRequest {
			t.Fatalf("If-Match %q: expected 400, got %d: %s", value, res.Code, res.Body.String())
		}
	}
}

func TestMapReadEndpointsExposeRevision(t *testing.T) {
	handler := newTestServer(t).Handler()
	createReq := httptest.NewRequest(http.MethodPost, "/api/maps", strings.NewReader(`{"title":"Read Revision"}`))
	createRes := httptest.NewRecorder()
	handler.ServeHTTP(createRes, createReq)
	var doc mindmap.Document
	if err := json.Unmarshal(createRes.Body.Bytes(), &doc); err != nil {
		t.Fatal(err)
	}

	for _, path := range []string{
		"/api/maps/" + doc.ID,
		"/api/maps/" + doc.ID + "/nodes",
		"/api/maps/" + doc.ID + "/nodes/root",
		"/api/maps/" + doc.ID + "/tree",
		"/api/maps/" + doc.ID + "/version",
		"/api/maps/" + doc.ID + "/poll",
	} {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			res := httptest.NewRecorder()
			handler.ServeHTTP(res, req)
			if res.Code != http.StatusOK {
				t.Fatalf("expected 200, got %d: %s", res.Code, res.Body.String())
			}
			if got := res.Header().Get("ETag"); got != `"rev-1"` {
				t.Fatalf("expected ETag rev-1, got %q", got)
			}
		})
	}
}
