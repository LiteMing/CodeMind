package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"code-mind/internal/store"
)

// newTestServerWithTokens creates a test server with TokenStore enabled.
func newTestServerWithTokens(t *testing.T) *Server {
	t.Helper()
	storePath := t.TempDir()
	fileStore := store.NewFileStore(storePath)
	tokenStorePath := filepath.Join(storePath, "tokens.json")
	tokenStore, err := store.NewTokenStore(tokenStorePath)
	if err != nil {
		t.Fatalf("failed to create token store: %v", err)
	}
	return NewWithTokenStore(fileStore, storePath, tokenStore)
}

func TestTokenCreateEndpoint(t *testing.T) {
	srv := newTestServerWithTokens(t)
	handler := srv.Handler()

	// Create a token — no auth configured so defaults to owner
	body := `{"mapId":"map-1","accessLevel":"editor","displayName":"Alice"}`
	req := httptest.NewRequest(http.MethodPost, "/api/tokens", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d with body %s", res.Code, res.Body.String())
	}

	var tok tokenResponse
	if err := json.Unmarshal(res.Body.Bytes(), &tok); err != nil {
		t.Fatalf("failed to decode token response: %v", err)
	}
	if tok.MapID != "map-1" {
		t.Fatalf("expected mapId map-1, got %q", tok.MapID)
	}
	if tok.AccessLevel != "editor" {
		t.Fatalf("expected accessLevel editor, got %q", tok.AccessLevel)
	}
	if tok.DisplayName != "Alice" {
		t.Fatalf("expected displayName Alice, got %q", tok.DisplayName)
	}
	if tok.Secret == "" {
		t.Fatal("expected secret to be returned on create")
	}
	if tok.ID == "" {
		t.Fatal("expected token ID to be set")
	}
}

func TestTokenCreateWithExpiration(t *testing.T) {
	srv := newTestServerWithTokens(t)
	handler := srv.Handler()

	body := `{"mapId":"map-1","accessLevel":"viewer","displayName":"Bob","expiresIn":"24h"}`
	req := httptest.NewRequest(http.MethodPost, "/api/tokens", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d with body %s", res.Code, res.Body.String())
	}

	var tok tokenResponse
	if err := json.Unmarshal(res.Body.Bytes(), &tok); err != nil {
		t.Fatalf("failed to decode token response: %v", err)
	}
	if tok.ExpiresAt == nil {
		t.Fatal("expected expiresAt to be set")
	}
}

func TestTokenCreateValidation(t *testing.T) {
	srv := newTestServerWithTokens(t)
	handler := srv.Handler()

	tests := []struct {
		name string
		body string
		want string
	}{
		{"missing mapId", `{"accessLevel":"editor","displayName":"X"}`, "mapId is required"},
		{"missing accessLevel", `{"mapId":"m","displayName":"X"}`, "accessLevel is required"},
		{"invalid accessLevel", `{"mapId":"m","accessLevel":"admin","displayName":"X"}`, "invalid access level"},
		{"invalid expiration", `{"mapId":"m","accessLevel":"editor","displayName":"X","expiresIn":"1s"}`, "expiration must be between"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/api/tokens", strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			res := httptest.NewRecorder()
			handler.ServeHTTP(res, req)

			if res.Code != http.StatusBadRequest {
				t.Fatalf("expected 400, got %d with body %s", res.Code, res.Body.String())
			}
			if !strings.Contains(res.Body.String(), tc.want) {
				t.Fatalf("expected error containing %q, got %s", tc.want, res.Body.String())
			}
		})
	}
}

func TestTokenListEndpoint(t *testing.T) {
	srv := newTestServerWithTokens(t)
	handler := srv.Handler()

	// Create two tokens for map-1
	for _, name := range []string{"Alice", "Bob"} {
		body := `{"mapId":"map-1","accessLevel":"editor","displayName":"` + name + `"}`
		req := httptest.NewRequest(http.MethodPost, "/api/tokens", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != http.StatusCreated {
			t.Fatalf("failed to create token for %s: %d %s", name, res.Code, res.Body.String())
		}
	}

	// Create one token for map-2
	body := `{"mapId":"map-2","accessLevel":"viewer","displayName":"Charlie"}`
	req := httptest.NewRequest(http.MethodPost, "/api/tokens", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusCreated {
		t.Fatalf("failed to create token for Charlie: %d %s", res.Code, res.Body.String())
	}

	// List tokens for map-1
	req = httptest.NewRequest(http.MethodGet, "/api/tokens?mapId=map-1", nil)
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", res.Code, res.Body.String())
	}

	var tokens []tokenResponse
	if err := json.Unmarshal(res.Body.Bytes(), &tokens); err != nil {
		t.Fatalf("failed to decode token list: %v", err)
	}
	if len(tokens) != 2 {
		t.Fatalf("expected 2 tokens for map-1, got %d", len(tokens))
	}

	// Verify secrets are NOT returned in list
	for _, tok := range tokens {
		if tok.Secret != "" {
			t.Fatal("expected secret to be omitted in list response")
		}
	}
}

func TestTokenListRequiresMapId(t *testing.T) {
	srv := newTestServerWithTokens(t)
	handler := srv.Handler()

	req := httptest.NewRequest(http.MethodGet, "/api/tokens", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d with body %s", res.Code, res.Body.String())
	}
	if !strings.Contains(res.Body.String(), "mapId query parameter is required") {
		t.Fatalf("unexpected error: %s", res.Body.String())
	}
}

func TestTokenRevokeEndpoint(t *testing.T) {
	srv := newTestServerWithTokens(t)
	handler := srv.Handler()

	// Create a token
	body := `{"mapId":"map-1","accessLevel":"editor","displayName":"Alice"}`
	req := httptest.NewRequest(http.MethodPost, "/api/tokens", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	var tok tokenResponse
	if err := json.Unmarshal(res.Body.Bytes(), &tok); err != nil {
		t.Fatalf("failed to decode token: %v", err)
	}

	// Revoke the token
	req = httptest.NewRequest(http.MethodDelete, "/api/tokens/"+tok.ID, nil)
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", res.Code, res.Body.String())
	}
	if !strings.Contains(res.Body.String(), "revoked") {
		t.Fatalf("expected revoked status, got %s", res.Body.String())
	}

	// Verify the token is now revoked in the list
	req = httptest.NewRequest(http.MethodGet, "/api/tokens?mapId=map-1", nil)
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	var tokens []tokenResponse
	if err := json.Unmarshal(res.Body.Bytes(), &tokens); err != nil {
		t.Fatalf("failed to decode token list: %v", err)
	}
	if len(tokens) != 1 {
		t.Fatalf("expected 1 token, got %d", len(tokens))
	}
	if !tokens[0].Revoked {
		t.Fatal("expected token to be marked as revoked")
	}
}

func TestTokenRevokeNotFound(t *testing.T) {
	srv := newTestServerWithTokens(t)
	handler := srv.Handler()

	req := httptest.NewRequest(http.MethodDelete, "/api/tokens/nonexistent-id", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d with body %s", res.Code, res.Body.String())
	}
}

func TestTokenEndpointsRequireOwnerAccess(t *testing.T) {
	srv := newTestServerWithTokens(t)
	handler := srv.Handler()

	// First create a viewer token
	body := `{"mapId":"map-1","accessLevel":"viewer","displayName":"Viewer"}`
	req := httptest.NewRequest(http.MethodPost, "/api/tokens", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	var tok tokenResponse
	if err := json.Unmarshal(res.Body.Bytes(), &tok); err != nil {
		t.Fatalf("failed to decode token: %v", err)
	}

	// Configure an API key so auth is enforced
	settings := store.Settings{CollabAPIKey: "owner-key"}
	if err := store.SaveSettings(srv.settingsDir, settings); err != nil {
		t.Fatalf("failed to save settings: %v", err)
	}

	// Try to list tokens using the viewer token — should be forbidden
	req = httptest.NewRequest(http.MethodGet, "/api/tokens?mapId=map-1", nil)
	req.Header.Set("Authorization", "Bearer "+tok.Secret)
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for viewer listing tokens, got %d with body %s", res.Code, res.Body.String())
	}

	// Try to create a token using the viewer token — should be forbidden
	// (viewer can't do POST which is a write op, so it gets 403 from auth middleware)
	req = httptest.NewRequest(http.MethodPost, "/api/tokens", strings.NewReader(`{"mapId":"map-1","accessLevel":"editor","displayName":"X"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+tok.Secret)
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	// Viewer POST is blocked by auth middleware (403 insufficient access level)
	if res.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for viewer creating token, got %d with body %s", res.Code, res.Body.String())
	}

	// Try to revoke using the viewer token — should be forbidden
	req = httptest.NewRequest(http.MethodDelete, "/api/tokens/"+tok.ID, nil)
	req.Header.Set("Authorization", "Bearer "+tok.Secret)
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	// DELETE is a write op, blocked by auth middleware for viewer
	if res.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for viewer revoking token, got %d with body %s", res.Code, res.Body.String())
	}
}

func TestTokenEndpointsEditorCannotManageTokens(t *testing.T) {
	srv := newTestServerWithTokens(t)
	handler := srv.Handler()

	// Create an editor token
	body := `{"mapId":"map-1","accessLevel":"editor","displayName":"Editor"}`
	req := httptest.NewRequest(http.MethodPost, "/api/tokens", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	var tok tokenResponse
	if err := json.Unmarshal(res.Body.Bytes(), &tok); err != nil {
		t.Fatalf("failed to decode token: %v", err)
	}

	// Configure an API key so auth is enforced
	settings := store.Settings{CollabAPIKey: "owner-key"}
	if err := store.SaveSettings(srv.settingsDir, settings); err != nil {
		t.Fatalf("failed to save settings: %v", err)
	}

	// Editor tries to list tokens — should be forbidden (owner only)
	req = httptest.NewRequest(http.MethodGet, "/api/tokens?mapId=map-1", nil)
	req.Header.Set("Authorization", "Bearer "+tok.Secret)
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for editor listing tokens, got %d with body %s", res.Code, res.Body.String())
	}

	// Editor tries to create a token — should be forbidden (owner only)
	req = httptest.NewRequest(http.MethodPost, "/api/tokens", strings.NewReader(`{"mapId":"map-1","accessLevel":"viewer","displayName":"X"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+tok.Secret)
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for editor creating token, got %d with body %s", res.Code, res.Body.String())
	}
}
