package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// mockAPIKeyProvider implements APIKeyProvider for testing.
type mockAPIKeyProvider struct {
	key string
}

func (m *mockAPIKeyProvider) GetCollabAPIKey() string {
	return m.key
}

// dummyHandler is a simple handler that returns 200 OK with a JSON body.
var dummyHandler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
})

func TestAPIKeyMiddleware_EmptyKeyPassesAll(t *testing.T) {
	provider := &mockAPIKeyProvider{key: ""}
	handler := apiKeyMiddleware(provider, dummyHandler)

	// Request without any API key header should pass through.
	req := httptest.NewRequest(http.MethodGet, "/api/maps/test-map", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rec.Code)
	}
}

func TestAPIKeyMiddleware_ValidKeyPasses(t *testing.T) {
	provider := &mockAPIKeyProvider{key: "secret-key-123"}
	handler := apiKeyMiddleware(provider, dummyHandler)

	req := httptest.NewRequest(http.MethodGet, "/api/maps/test-map", nil)
	req.Header.Set("X-API-Key", "secret-key-123")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rec.Code)
	}
}

func TestAPIKeyMiddleware_InvalidKeyReturns401(t *testing.T) {
	provider := &mockAPIKeyProvider{key: "secret-key-123"}
	handler := apiKeyMiddleware(provider, dummyHandler)

	req := httptest.NewRequest(http.MethodGet, "/api/maps/test-map", nil)
	req.Header.Set("X-API-Key", "wrong-key")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401, got %d", rec.Code)
	}

	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode response body: %v", err)
	}
	expected := "authentication required: invalid or missing API key"
	if body["error"] != expected {
		t.Errorf("expected error %q, got %q", expected, body["error"])
	}
}

func TestAPIKeyMiddleware_MissingKeyReturns401(t *testing.T) {
	provider := &mockAPIKeyProvider{key: "secret-key-123"}
	handler := apiKeyMiddleware(provider, dummyHandler)

	// No X-API-Key header at all.
	req := httptest.NewRequest(http.MethodGet, "/api/maps/test-map", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401, got %d", rec.Code)
	}

	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode response body: %v", err)
	}
	expected := "authentication required: invalid or missing API key"
	if body["error"] != expected {
		t.Errorf("expected error %q, got %q", expected, body["error"])
	}
}

func TestAPIKeyMiddleware_HealthEndpointBypassesAuth(t *testing.T) {
	provider := &mockAPIKeyProvider{key: "secret-key-123"}
	handler := apiKeyMiddleware(provider, dummyHandler)

	// Request to /api/health without API key should still pass.
	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200 for /api/health, got %d", rec.Code)
	}
}
