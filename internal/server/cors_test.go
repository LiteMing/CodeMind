package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCORSMiddlewareRejectsUntrustedOrigin(t *testing.T) {
	handler := corsMiddleware(dummyHandler)

	req := httptest.NewRequest(http.MethodGet, "/api/settings", nil)
	req.Header.Set("Origin", "https://example.com")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", rec.Code)
	}
}

func TestCORSMiddlewareAllowsLoopbackOrigin(t *testing.T) {
	handler := corsMiddleware(dummyHandler)

	req := httptest.NewRequest(http.MethodGet, "/api/settings", nil)
	req.Header.Set("Origin", "http://127.0.0.1:5173")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://127.0.0.1:5173" {
		t.Fatalf("unexpected Access-Control-Allow-Origin: %q", got)
	}
}
