package store

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestNewTokenStore_EmptyFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "tokens.json")

	ts, err := NewTokenStore(path)
	if err != nil {
		t.Fatalf("NewTokenStore failed: %v", err)
	}
	if ts == nil {
		t.Fatal("expected non-nil TokenStore")
	}
}

func TestNewTokenStore_LoadExisting(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "tokens.json")

	// Write a valid token file
	content := `[{"id":"tok-1","mapId":"map1","accessLevel":"editor","secret":"abc123","displayName":"Test","createdAt":"2024-01-01T00:00:00Z","revoked":false}]`
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	ts, err := NewTokenStore(path)
	if err != nil {
		t.Fatalf("NewTokenStore failed: %v", err)
	}

	tokens := ts.ListByMap("map1")
	if len(tokens) != 1 {
		t.Fatalf("expected 1 token, got %d", len(tokens))
	}
	if tokens[0].ID != "tok-1" {
		t.Errorf("expected token ID 'tok-1', got '%s'", tokens[0].ID)
	}
}

func TestCreate_Success(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "tokens.json")

	ts, err := NewTokenStore(path)
	if err != nil {
		t.Fatalf("NewTokenStore failed: %v", err)
	}

	exp := 24 * time.Hour
	token, err := ts.Create("map1", "editor", "Alice", &exp)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	if token.MapID != "map1" {
		t.Errorf("expected mapId 'map1', got '%s'", token.MapID)
	}
	if token.AccessLevel != "editor" {
		t.Errorf("expected accessLevel 'editor', got '%s'", token.AccessLevel)
	}
	if token.DisplayName != "Alice" {
		t.Errorf("expected displayName 'Alice', got '%s'", token.DisplayName)
	}
	if token.Revoked {
		t.Error("expected token not revoked")
	}
	if token.ExpiresAt == nil {
		t.Error("expected non-nil ExpiresAt")
	}
	if len(token.Secret) != 64 { // 32 bytes = 64 hex chars
		t.Errorf("expected 64-char hex secret, got %d chars", len(token.Secret))
	}
}

func TestCreate_NoExpiration(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "tokens.json")

	ts, err := NewTokenStore(path)
	if err != nil {
		t.Fatalf("NewTokenStore failed: %v", err)
	}

	token, err := ts.Create("map1", "viewer", "Bob", nil)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	if token.ExpiresAt != nil {
		t.Error("expected nil ExpiresAt for no expiration")
	}
}

func TestCreate_InvalidAccessLevel(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "tokens.json")

	ts, err := NewTokenStore(path)
	if err != nil {
		t.Fatalf("NewTokenStore failed: %v", err)
	}

	exp := time.Hour
	_, err = ts.Create("map1", "admin", "Test", &exp)
	if err == nil {
		t.Fatal("expected error for invalid access level")
	}
}

func TestCreate_ExpirationTooShort(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "tokens.json")

	ts, err := NewTokenStore(path)
	if err != nil {
		t.Fatalf("NewTokenStore failed: %v", err)
	}

	exp := 30 * time.Second // less than 1 minute
	_, err = ts.Create("map1", "editor", "Test", &exp)
	if err == nil {
		t.Fatal("expected error for expiration too short")
	}
}

func TestCreate_ExpirationTooLong(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "tokens.json")

	ts, err := NewTokenStore(path)
	if err != nil {
		t.Fatalf("NewTokenStore failed: %v", err)
	}

	exp := 366 * 24 * time.Hour // more than 365 days
	_, err = ts.Create("map1", "editor", "Test", &exp)
	if err == nil {
		t.Fatal("expected error for expiration too long")
	}
}

func TestCreate_TokenLimit(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "tokens.json")

	ts, err := NewTokenStore(path)
	if err != nil {
		t.Fatalf("NewTokenStore failed: %v", err)
	}

	exp := time.Hour
	// Create 50 tokens
	for i := 0; i < 50; i++ {
		_, err := ts.Create("map1", "editor", "User", &exp)
		if err != nil {
			t.Fatalf("Create #%d failed: %v", i+1, err)
		}
	}

	// 51st should fail
	_, err = ts.Create("map1", "editor", "User51", &exp)
	if err == nil {
		t.Fatal("expected error for 51st token")
	}
}

func TestCreate_TokenLimitPerMap(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "tokens.json")

	ts, err := NewTokenStore(path)
	if err != nil {
		t.Fatalf("NewTokenStore failed: %v", err)
	}

	exp := time.Hour
	// Create 50 tokens for map1
	for i := 0; i < 50; i++ {
		_, err := ts.Create("map1", "editor", "User", &exp)
		if err != nil {
			t.Fatalf("Create #%d failed: %v", i+1, err)
		}
	}

	// Should still be able to create for map2
	_, err = ts.Create("map2", "editor", "User", &exp)
	if err != nil {
		t.Fatalf("Create for map2 should succeed: %v", err)
	}
}

func TestValidate_Success(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "tokens.json")

	ts, err := NewTokenStore(path)
	if err != nil {
		t.Fatalf("NewTokenStore failed: %v", err)
	}

	exp := time.Hour
	created, err := ts.Create("map1", "editor", "Alice", &exp)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	validated, err := ts.Validate(created.Secret)
	if err != nil {
		t.Fatalf("Validate failed: %v", err)
	}
	if validated.ID != created.ID {
		t.Errorf("expected ID '%s', got '%s'", created.ID, validated.ID)
	}
}

func TestValidate_InvalidSecret(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "tokens.json")

	ts, err := NewTokenStore(path)
	if err != nil {
		t.Fatalf("NewTokenStore failed: %v", err)
	}

	_, err = ts.Validate("nonexistent-secret")
	if err == nil {
		t.Fatal("expected error for invalid secret")
	}
}

func TestValidate_RevokedToken(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "tokens.json")

	ts, err := NewTokenStore(path)
	if err != nil {
		t.Fatalf("NewTokenStore failed: %v", err)
	}

	exp := time.Hour
	created, err := ts.Create("map1", "editor", "Alice", &exp)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	if err := ts.Revoke(created.ID); err != nil {
		t.Fatalf("Revoke failed: %v", err)
	}

	_, err = ts.Validate(created.Secret)
	if err == nil {
		t.Fatal("expected error for revoked token")
	}
}

func TestValidate_ExpiredToken(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "tokens.json")

	// Write a token that's already expired
	past := time.Now().UTC().Add(-time.Hour)
	content := `[{"id":"tok-1","mapId":"map1","accessLevel":"editor","secret":"expired-secret-hex","displayName":"Test","expiresAt":"` + past.Format(time.RFC3339Nano) + `","createdAt":"2024-01-01T00:00:00Z","revoked":false}]`
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	ts, err := NewTokenStore(path)
	if err != nil {
		t.Fatalf("NewTokenStore failed: %v", err)
	}

	_, err = ts.Validate("expired-secret-hex")
	if err == nil {
		t.Fatal("expected error for expired token")
	}
}

func TestRevoke_Success(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "tokens.json")

	ts, err := NewTokenStore(path)
	if err != nil {
		t.Fatalf("NewTokenStore failed: %v", err)
	}

	exp := time.Hour
	created, err := ts.Create("map1", "editor", "Alice", &exp)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	if err := ts.Revoke(created.ID); err != nil {
		t.Fatalf("Revoke failed: %v", err)
	}

	// Verify it's revoked
	tokens := ts.ListByMap("map1")
	if len(tokens) != 1 {
		t.Fatalf("expected 1 token, got %d", len(tokens))
	}
	if !tokens[0].Revoked {
		t.Error("expected token to be revoked")
	}
}

func TestRevoke_NotFound(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "tokens.json")

	ts, err := NewTokenStore(path)
	if err != nil {
		t.Fatalf("NewTokenStore failed: %v", err)
	}

	err = ts.Revoke("nonexistent-id")
	if err == nil {
		t.Fatal("expected error for nonexistent token")
	}
}

func TestListByMap(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "tokens.json")

	ts, err := NewTokenStore(path)
	if err != nil {
		t.Fatalf("NewTokenStore failed: %v", err)
	}

	exp := time.Hour
	ts.Create("map1", "editor", "Alice", &exp)
	ts.Create("map1", "viewer", "Bob", &exp)
	ts.Create("map2", "editor", "Charlie", &exp)

	map1Tokens := ts.ListByMap("map1")
	if len(map1Tokens) != 2 {
		t.Errorf("expected 2 tokens for map1, got %d", len(map1Tokens))
	}

	map2Tokens := ts.ListByMap("map2")
	if len(map2Tokens) != 1 {
		t.Errorf("expected 1 token for map2, got %d", len(map2Tokens))
	}

	map3Tokens := ts.ListByMap("map3")
	if len(map3Tokens) != 0 {
		t.Errorf("expected 0 tokens for map3, got %d", len(map3Tokens))
	}
}

func TestCountActiveByMap(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "tokens.json")

	ts, err := NewTokenStore(path)
	if err != nil {
		t.Fatalf("NewTokenStore failed: %v", err)
	}

	exp := time.Hour
	token1, _ := ts.Create("map1", "editor", "Alice", &exp)
	ts.Create("map1", "viewer", "Bob", &exp)
	ts.Create("map2", "editor", "Charlie", &exp)

	if count := ts.CountActiveByMap("map1"); count != 2 {
		t.Errorf("expected 2 active tokens for map1, got %d", count)
	}

	// Revoke one
	ts.Revoke(token1.ID)
	if count := ts.CountActiveByMap("map1"); count != 1 {
		t.Errorf("expected 1 active token for map1 after revoke, got %d", count)
	}
}

func TestCreate_DisplayNameTruncation(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "tokens.json")

	ts, err := NewTokenStore(path)
	if err != nil {
		t.Fatalf("NewTokenStore failed: %v", err)
	}

	longName := "This is a very long display name that exceeds thirty characters"
	exp := time.Hour
	token, err := ts.Create("map1", "editor", longName, &exp)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	if len(token.DisplayName) > 30 {
		t.Errorf("expected display name truncated to 30 chars, got %d", len(token.DisplayName))
	}
}

func TestPersistence_RoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "tokens.json")

	// Create and populate
	ts1, err := NewTokenStore(path)
	if err != nil {
		t.Fatalf("NewTokenStore failed: %v", err)
	}

	exp := time.Hour
	created, err := ts1.Create("map1", "editor", "Alice", &exp)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	// Load from same file
	ts2, err := NewTokenStore(path)
	if err != nil {
		t.Fatalf("NewTokenStore (reload) failed: %v", err)
	}

	validated, err := ts2.Validate(created.Secret)
	if err != nil {
		t.Fatalf("Validate after reload failed: %v", err)
	}
	if validated.ID != created.ID {
		t.Errorf("expected ID '%s' after reload, got '%s'", created.ID, validated.ID)
	}
}
