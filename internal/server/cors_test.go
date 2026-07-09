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

// The desktop GUI's WebView2 frontend runs at http://wails.localhost; blocking
// it makes every API call in the packaged app fail ("Failed to fetch").
func TestCORSMiddlewareAllowsWailsWebviewOrigin(t *testing.T) {
	handler := corsMiddleware(dummyHandler)

	for _, origin := range []string{"http://wails.localhost", "http://wails.localhost:34115", "wails://wails.localhost"} {
		req := httptest.NewRequest(http.MethodGet, "/api/settings", nil)
		req.Header.Set("Origin", origin)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("origin %q: expected 200, got %d", origin, rec.Code)
		}
		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != origin {
			t.Fatalf("origin %q: unexpected Access-Control-Allow-Origin %q", origin, got)
		}
	}
}
