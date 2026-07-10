package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"code-mind/internal/agentcontract"
)

func TestTokenStorePersistsActorKindAndMigratesLegacyTokens(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "tokens.json")
	createdAt := time.Unix(1, 0).UTC()
	legacy := []Token{{
		ID:          "legacy-token",
		MapID:       "map-1",
		AccessLevel: "editor",
		SecretHash:  hashSecret("legacy-secret"),
		DisplayName: "Legacy",
		CreatedAt:   createdAt,
	}}
	payload, err := json.Marshal(legacy)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, payload, 0o644); err != nil {
		t.Fatal(err)
	}

	store, err := NewTokenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	validated, err := store.Validate("legacy-secret")
	if err != nil {
		t.Fatal(err)
	}
	if validated.ActorKind != agentcontract.ActorHuman {
		t.Fatalf("legacy actor kind = %q", validated.ActorKind)
	}

	agent, err := store.CreateWithActorKind("map-1", "editor", "Agent", agentcontract.ActorAgent, nil)
	if err != nil {
		t.Fatal(err)
	}
	reloaded, err := NewTokenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	validatedAgent, err := reloaded.Validate(agent.Secret)
	if err != nil {
		t.Fatal(err)
	}
	if validatedAgent.ActorKind != agentcontract.ActorAgent {
		t.Fatalf("agent actor kind = %q", validatedAgent.ActorKind)
	}
}

func TestTokenStoreRejectsInvalidActorKind(t *testing.T) {
	store, err := NewTokenStore(filepath.Join(t.TempDir(), "tokens.json"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateWithActorKind("map-1", "editor", "Invalid", agentcontract.ActorKind("robot"), nil); err == nil {
		t.Fatal("expected invalid actor kind to be rejected")
	}
}
