package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"code-mind/internal/store"
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

// accessLevelHandler returns the access level from context in the response.
var accessLevelHandler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	level := GetAccessLevel(r)
	writeJSON(w, http.StatusOK, map[string]string{"level": string(level)})
})

// newTestTokenStore creates a temporary TokenStore for testing.
func newTestTokenStore(t *testing.T) *store.TokenStore {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "tokens.json")
	ts, err := store.NewTokenStore(path)
	if err != nil {
		t.Fatalf("failed to create token store: %v", err)
	}
	return ts
}

// createTestToken creates a token in the store and returns it.
func createTestToken(t *testing.T, ts *store.TokenStore, mapID, accessLevel, displayName string, expiration *time.Duration) *store.Token {
	t.Helper()
	token, err := ts.Create(mapID, accessLevel, displayName, expiration)
	if err != nil {
		t.Fatalf("failed to create test token: %v", err)
	}
	return token
}

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

// --- tokenAuthMiddleware tests ---

func TestTokenAuth_NoAuthConfigured_AllowsAsOwner(t *testing.T) {
	provider := &mockAPIKeyProvider{key: ""}
	ts := newTestTokenStore(t)
	handler := tokenAuthMiddleware(provider, ts, accessLevelHandler)

	req := httptest.NewRequest(http.MethodPost, "/api/maps/test-map/nodes", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}

	var body map[string]string
	json.NewDecoder(rec.Body).Decode(&body)
	if body["level"] != "owner" {
		t.Errorf("expected access level 'owner', got %q", body["level"])
	}
}

func TestTokenAuth_ValidAPIKey_GrantsOwner(t *testing.T) {
	provider := &mockAPIKeyProvider{key: "my-api-key"}
	ts := newTestTokenStore(t)
	handler := tokenAuthMiddleware(provider, ts, accessLevelHandler)

	req := httptest.NewRequest(http.MethodPost, "/api/maps/test-map/nodes", nil)
	req.Header.Set("X-API-Key", "my-api-key")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}

	var body map[string]string
	json.NewDecoder(rec.Body).Decode(&body)
	if body["level"] != "owner" {
		t.Errorf("expected access level 'owner', got %q", body["level"])
	}
}

func TestTokenAuth_InvalidAPIKey_NoToken_Returns401(t *testing.T) {
	provider := &mockAPIKeyProvider{key: "my-api-key"}
	ts := newTestTokenStore(t)
	handler := tokenAuthMiddleware(provider, ts, accessLevelHandler)

	req := httptest.NewRequest(http.MethodGet, "/api/maps/test-map", nil)
	req.Header.Set("X-API-Key", "wrong-key")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401, got %d", rec.Code)
	}
}

func TestTokenAuth_NoCredentials_WithAPIKeyConfigured_Returns401(t *testing.T) {
	provider := &mockAPIKeyProvider{key: "my-api-key"}
	ts := newTestTokenStore(t)
	handler := tokenAuthMiddleware(provider, ts, accessLevelHandler)

	req := httptest.NewRequest(http.MethodGet, "/api/maps/test-map", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401, got %d", rec.Code)
	}
}

func TestTokenAuth_ValidBearerToken_EditorLevel(t *testing.T) {
	provider := &mockAPIKeyProvider{key: "my-api-key"}
	ts := newTestTokenStore(t)
	token := createTestToken(t, ts, "map-1", "editor", "Alice", nil)
	handler := tokenAuthMiddleware(provider, ts, accessLevelHandler)

	req := httptest.NewRequest(http.MethodPost, "/api/maps/map-1/nodes", nil)
	req.Header.Set("Authorization", "Bearer "+token.Secret)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}

	var body map[string]string
	json.NewDecoder(rec.Body).Decode(&body)
	if body["level"] != "editor" {
		t.Errorf("expected access level 'editor', got %q", body["level"])
	}
}

func TestTokenAuth_ValidQueryToken_ViewerLevel(t *testing.T) {
	provider := &mockAPIKeyProvider{key: "my-api-key"}
	ts := newTestTokenStore(t)
	token := createTestToken(t, ts, "map-1", "viewer", "Bob", nil)
	handler := tokenAuthMiddleware(provider, ts, accessLevelHandler)

	req := httptest.NewRequest(http.MethodGet, "/api/maps/map-1?token="+token.Secret, nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}

	var body map[string]string
	json.NewDecoder(rec.Body).Decode(&body)
	if body["level"] != "viewer" {
		t.Errorf("expected access level 'viewer', got %q", body["level"])
	}
}

func TestTokenAuth_ViewerWriteOperation_Returns403(t *testing.T) {
	provider := &mockAPIKeyProvider{key: "my-api-key"}
	ts := newTestTokenStore(t)
	token := createTestToken(t, ts, "map-1", "viewer", "Bob", nil)
	handler := tokenAuthMiddleware(provider, ts, accessLevelHandler)

	// POST is a write operation
	req := httptest.NewRequest(http.MethodPost, "/api/maps/map-1/nodes", nil)
	req.Header.Set("Authorization", "Bearer "+token.Secret)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected status 403, got %d", rec.Code)
	}

	var body map[string]string
	json.NewDecoder(rec.Body).Decode(&body)
	if body["error"] != "insufficient access level" {
		t.Errorf("expected error 'insufficient access level', got %q", body["error"])
	}
}

func TestTokenAuth_ViewerPatchOperation_Returns403(t *testing.T) {
	provider := &mockAPIKeyProvider{key: "my-api-key"}
	ts := newTestTokenStore(t)
	token := createTestToken(t, ts, "map-1", "viewer", "Bob", nil)
	handler := tokenAuthMiddleware(provider, ts, accessLevelHandler)

	req := httptest.NewRequest(http.MethodPatch, "/api/maps/map-1/nodes/node-1", nil)
	req.Header.Set("Authorization", "Bearer "+token.Secret)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected status 403, got %d", rec.Code)
	}
}

func TestTokenAuth_ViewerDeleteOperation_Returns403(t *testing.T) {
	provider := &mockAPIKeyProvider{key: "my-api-key"}
	ts := newTestTokenStore(t)
	token := createTestToken(t, ts, "map-1", "viewer", "Bob", nil)
	handler := tokenAuthMiddleware(provider, ts, accessLevelHandler)

	req := httptest.NewRequest(http.MethodDelete, "/api/maps/map-1/nodes/node-1", nil)
	req.Header.Set("Authorization", "Bearer "+token.Secret)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected status 403, got %d", rec.Code)
	}
}

func TestTokenAuth_ViewerGetOperation_Allowed(t *testing.T) {
	provider := &mockAPIKeyProvider{key: "my-api-key"}
	ts := newTestTokenStore(t)
	token := createTestToken(t, ts, "map-1", "viewer", "Bob", nil)
	handler := tokenAuthMiddleware(provider, ts, accessLevelHandler)

	req := httptest.NewRequest(http.MethodGet, "/api/maps/map-1/tree", nil)
	req.Header.Set("Authorization", "Bearer "+token.Secret)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}
}

func TestTokenAuth_EditorWriteOperation_Allowed(t *testing.T) {
	provider := &mockAPIKeyProvider{key: "my-api-key"}
	ts := newTestTokenStore(t)
	token := createTestToken(t, ts, "map-1", "editor", "Alice", nil)
	handler := tokenAuthMiddleware(provider, ts, accessLevelHandler)

	req := httptest.NewRequest(http.MethodPost, "/api/maps/map-1/nodes", nil)
	req.Header.Set("Authorization", "Bearer "+token.Secret)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}

	var body map[string]string
	json.NewDecoder(rec.Body).Decode(&body)
	if body["level"] != "editor" {
		t.Errorf("expected access level 'editor', got %q", body["level"])
	}
}

func TestTokenAuth_ExpiredToken_Returns401(t *testing.T) {
	provider := &mockAPIKeyProvider{key: "my-api-key"}
	dir := t.TempDir()
	path := filepath.Join(dir, "tokens.json")

	// Create a token store and a token with very short expiration
	ts, err := store.NewTokenStore(path)
	if err != nil {
		t.Fatalf("failed to create token store: %v", err)
	}

	expiration := time.Minute
	token, err := ts.Create("map-1", "editor", "Alice", &expiration)
	if err != nil {
		t.Fatalf("failed to create token: %v", err)
	}

	// Manually expire the token by modifying the file
	// Read the file, modify ExpiresAt, write back
	data, _ := os.ReadFile(path)
	var tokens []store.Token
	json.Unmarshal(data, &tokens)
	past := time.Now().Add(-time.Hour)
	for i := range tokens {
		if tokens[i].ID == token.ID {
			tokens[i].ExpiresAt = &past
		}
	}
	newData, _ := json.Marshal(tokens)
	os.WriteFile(path, newData, 0o644)

	// Reload the token store
	ts2, err := store.NewTokenStore(path)
	if err != nil {
		t.Fatalf("failed to reload token store: %v", err)
	}

	handler := tokenAuthMiddleware(provider, ts2, accessLevelHandler)

	req := httptest.NewRequest(http.MethodGet, "/api/maps/map-1", nil)
	req.Header.Set("Authorization", "Bearer "+token.Secret)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401, got %d", rec.Code)
	}

	var body map[string]string
	json.NewDecoder(rec.Body).Decode(&body)
	if body["error"] != "token expired" {
		t.Errorf("expected error 'token expired', got %q", body["error"])
	}
}

func TestTokenAuth_RevokedToken_Returns401(t *testing.T) {
	provider := &mockAPIKeyProvider{key: "my-api-key"}
	ts := newTestTokenStore(t)
	token := createTestToken(t, ts, "map-1", "editor", "Alice", nil)

	// Revoke the token
	if err := ts.Revoke(token.ID); err != nil {
		t.Fatalf("failed to revoke token: %v", err)
	}

	handler := tokenAuthMiddleware(provider, ts, accessLevelHandler)

	req := httptest.NewRequest(http.MethodGet, "/api/maps/map-1", nil)
	req.Header.Set("Authorization", "Bearer "+token.Secret)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401, got %d", rec.Code)
	}

	var body map[string]string
	json.NewDecoder(rec.Body).Decode(&body)
	if body["error"] != "token has been revoked" {
		t.Errorf("expected error 'token has been revoked', got %q", body["error"])
	}
}

func TestTokenAuth_InvalidTokenSecret_Returns401(t *testing.T) {
	provider := &mockAPIKeyProvider{key: "my-api-key"}
	ts := newTestTokenStore(t)
	handler := tokenAuthMiddleware(provider, ts, accessLevelHandler)

	req := httptest.NewRequest(http.MethodGet, "/api/maps/map-1", nil)
	req.Header.Set("Authorization", "Bearer invalid-secret-that-does-not-exist")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401, got %d", rec.Code)
	}

	var body map[string]string
	json.NewDecoder(rec.Body).Decode(&body)
	if body["error"] != "invalid token" {
		t.Errorf("expected error 'invalid token', got %q", body["error"])
	}
}

func TestTokenAuth_HealthEndpoint_BypassesAuth(t *testing.T) {
	provider := &mockAPIKeyProvider{key: "my-api-key"}
	ts := newTestTokenStore(t)
	handler := tokenAuthMiddleware(provider, ts, accessLevelHandler)

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rec.Code)
	}

	var body map[string]string
	json.NewDecoder(rec.Body).Decode(&body)
	if body["level"] != "owner" {
		t.Errorf("expected access level 'owner' for health endpoint, got %q", body["level"])
	}
}

func TestTokenAuth_BearerTokenTakesPrecedenceOverQueryParam(t *testing.T) {
	provider := &mockAPIKeyProvider{key: "my-api-key"}
	ts := newTestTokenStore(t)
	editorToken := createTestToken(t, ts, "map-1", "editor", "Alice", nil)
	viewerToken := createTestToken(t, ts, "map-1", "viewer", "Bob", nil)
	handler := tokenAuthMiddleware(provider, ts, accessLevelHandler)

	// Bearer header has editor token, query param has viewer token
	req := httptest.NewRequest(http.MethodGet, "/api/maps/map-1?token="+viewerToken.Secret, nil)
	req.Header.Set("Authorization", "Bearer "+editorToken.Secret)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}

	var body map[string]string
	json.NewDecoder(rec.Body).Decode(&body)
	if body["level"] != "editor" {
		t.Errorf("expected access level 'editor' (from Bearer), got %q", body["level"])
	}
}

func TestTokenAuth_APIKeyTakesPrecedenceOverToken(t *testing.T) {
	provider := &mockAPIKeyProvider{key: "my-api-key"}
	ts := newTestTokenStore(t)
	viewerToken := createTestToken(t, ts, "map-1", "viewer", "Bob", nil)
	handler := tokenAuthMiddleware(provider, ts, accessLevelHandler)

	// Both API key and Bearer token provided — API key wins (owner)
	req := httptest.NewRequest(http.MethodPost, "/api/maps/map-1/nodes", nil)
	req.Header.Set("X-API-Key", "my-api-key")
	req.Header.Set("Authorization", "Bearer "+viewerToken.Secret)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}

	var body map[string]string
	json.NewDecoder(rec.Body).Decode(&body)
	if body["level"] != "owner" {
		t.Errorf("expected access level 'owner' (from API key), got %q", body["level"])
	}
}

func TestTokenAuth_NilTokenStore_NoAuthConfigured_AllowsAsOwner(t *testing.T) {
	provider := &mockAPIKeyProvider{key: ""}
	handler := tokenAuthMiddleware(provider, nil, accessLevelHandler)

	req := httptest.NewRequest(http.MethodPost, "/api/maps/test-map/nodes", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}

	var body map[string]string
	json.NewDecoder(rec.Body).Decode(&body)
	if body["level"] != "owner" {
		t.Errorf("expected access level 'owner', got %q", body["level"])
	}
}

func TestExtractToken_BearerHeader(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/maps/test", nil)
	req.Header.Set("Authorization", "Bearer my-secret-token")

	token := extractToken(req)
	if token != "my-secret-token" {
		t.Errorf("expected 'my-secret-token', got %q", token)
	}
}

func TestExtractToken_QueryParam(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/maps/test?token=query-token", nil)

	token := extractToken(req)
	if token != "query-token" {
		t.Errorf("expected 'query-token', got %q", token)
	}
}

func TestExtractToken_Empty(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/maps/test", nil)

	token := extractToken(req)
	if token != "" {
		t.Errorf("expected empty string, got %q", token)
	}
}

func TestIsWriteOperation(t *testing.T) {
	tests := []struct {
		method string
		write  bool
	}{
		{http.MethodGet, false},
		{http.MethodHead, false},
		{http.MethodOptions, false},
		{http.MethodPost, true},
		{http.MethodPut, true},
		{http.MethodPatch, true},
		{http.MethodDelete, true},
	}

	for _, tt := range tests {
		req := httptest.NewRequest(tt.method, "/api/maps/test", nil)
		got := isWriteOperation(req)
		if got != tt.write {
			t.Errorf("isWriteOperation(%s) = %v, want %v", tt.method, got, tt.write)
		}
	}
}
