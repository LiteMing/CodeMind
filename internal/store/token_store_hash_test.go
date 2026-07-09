package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCreatePersistsHashInsteadOfPlaintext(t *testing.T) {
	path := filepath.Join(t.TempDir(), "tokens.json")
	ts, err := NewTokenStore(path)
	if err != nil {
		t.Fatal(err)
	}

	token, err := ts.Create("map-1", "editor", "alice", nil)
	if err != nil {
		t.Fatal(err)
	}
	if token.Secret == "" {
		t.Fatal("Create must return the plaintext secret once")
	}

	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(payload), token.Secret) {
		t.Fatal("plaintext secret must not be persisted")
	}
	if !strings.Contains(string(payload), hashSecret(token.Secret)) {
		t.Fatal("persisted file must contain the secret hash")
	}

	if _, err := ts.Validate(token.Secret); err != nil {
		t.Fatalf("Validate with plaintext secret failed: %v", err)
	}
	if _, err := ts.Validate("wrong-secret"); err == nil {
		t.Fatal("Validate must reject an unknown secret")
	}
}

func TestLoadMigratesLegacyPlaintextTokens(t *testing.T) {
	path := filepath.Join(t.TempDir(), "tokens.json")
	legacy := []Token{{
		ID:          "tok-1",
		MapID:       "map-1",
		AccessLevel: "editor",
		Secret:      "legacy-plaintext-secret",
		CreatedAt:   time.Now().UTC(),
	}}
	payload, _ := json.Marshal(legacy)
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		t.Fatal(err)
	}

	ts, err := NewTokenStore(path)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := ts.Validate("legacy-plaintext-secret"); err != nil {
		t.Fatalf("legacy secret should still validate after migration: %v", err)
	}

	migrated, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(migrated), "legacy-plaintext-secret") {
		t.Fatal("migration must remove plaintext secret from disk")
	}
}
