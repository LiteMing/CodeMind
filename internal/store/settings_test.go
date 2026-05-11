package store

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadSettings_FileNotExist(t *testing.T) {
	dir := t.TempDir()

	s, err := LoadSettings(dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if s.CollabAPIKey != "" {
		t.Fatalf("expected empty CollabAPIKey, got %q", s.CollabAPIKey)
	}
}

func TestSaveAndLoadSettings(t *testing.T) {
	dir := t.TempDir()

	want := Settings{CollabAPIKey: "test-key-abc123"}
	if err := SaveSettings(dir, want); err != nil {
		t.Fatalf("SaveSettings failed: %v", err)
	}

	got, err := LoadSettings(dir)
	if err != nil {
		t.Fatalf("LoadSettings failed: %v", err)
	}
	if got.CollabAPIKey != want.CollabAPIKey {
		t.Fatalf("CollabAPIKey = %q, want %q", got.CollabAPIKey, want.CollabAPIKey)
	}
}

func TestSaveSettings_CreatesDirectory(t *testing.T) {
	base := t.TempDir()
	dir := filepath.Join(base, "nested", "dir")

	s := Settings{CollabAPIKey: "key-in-nested-dir"}
	if err := SaveSettings(dir, s); err != nil {
		t.Fatalf("SaveSettings failed: %v", err)
	}

	// Verify file exists
	path := filepath.Join(dir, "settings.json")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("settings file not created: %v", err)
	}

	// Verify content is readable
	got, err := LoadSettings(dir)
	if err != nil {
		t.Fatalf("LoadSettings failed: %v", err)
	}
	if got.CollabAPIKey != s.CollabAPIKey {
		t.Fatalf("CollabAPIKey = %q, want %q", got.CollabAPIKey, s.CollabAPIKey)
	}
}

func TestLoadSettings_InvalidJSON(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")

	if err := os.WriteFile(path, []byte("not json"), 0o644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	_, err := LoadSettings(dir)
	if err == nil {
		t.Fatal("expected error for invalid JSON, got nil")
	}
}

func TestSaveSettings_EmptyKey(t *testing.T) {
	dir := t.TempDir()

	s := Settings{CollabAPIKey: ""}
	if err := SaveSettings(dir, s); err != nil {
		t.Fatalf("SaveSettings failed: %v", err)
	}

	got, err := LoadSettings(dir)
	if err != nil {
		t.Fatalf("LoadSettings failed: %v", err)
	}
	if got.CollabAPIKey != "" {
		t.Fatalf("expected empty CollabAPIKey, got %q", got.CollabAPIKey)
	}
}
