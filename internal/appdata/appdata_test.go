package appdata

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCopyLegacyDataDirIfNeededCopiesWithoutRemovingSource(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "legacy", "data")
	dst := filepath.Join(root, "appdata", "data")
	srcFile := filepath.Join(src, "maps", "map-1.json")
	if err := os.MkdirAll(filepath.Dir(srcFile), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(srcFile, []byte(`{"id":"map-1"}`), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := CopyLegacyDataDirIfNeeded(src, dst); err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(srcFile); err != nil {
		t.Fatalf("source file should remain after copy: %v", err)
	}
	copied, err := os.ReadFile(filepath.Join(dst, "maps", "map-1.json"))
	if err != nil {
		t.Fatalf("expected copied file: %v", err)
	}
	if string(copied) != `{"id":"map-1"}` {
		t.Fatalf("unexpected copied content: %s", copied)
	}
}

func TestCopyLegacyDataDirIfNeededSkipsWhenDestinationHasEntries(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "legacy", "data")
	dst := filepath.Join(root, "appdata", "data")
	if err := os.MkdirAll(src, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dst, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "legacy.txt"), []byte("legacy"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dst, "existing.txt"), []byte("existing"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := CopyLegacyDataDirIfNeeded(src, dst); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dst, "legacy.txt")); !os.IsNotExist(err) {
		t.Fatalf("legacy file should not be copied into non-empty destination")
	}
}
