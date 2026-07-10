package store

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"code-mind/internal/mindmap"
)

func TestLegacyDocumentDefaultsToRevisionOne(t *testing.T) {
	dir := t.TempDir()
	doc := mindmap.NewDefaultDocument()
	doc.ID = "legacy"
	doc.Meta.Revision = 0
	payload, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "legacy.json"), payload, 0o644); err != nil {
		t.Fatal(err)
	}

	loaded, err := NewFileStore(dir).LoadReadOnly("legacy")
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Meta.Revision != 1 {
		t.Fatalf("expected legacy revision 1, got %d", loaded.Meta.Revision)
	}
}

func TestSaveIfRevisionIncrementsAndRejectsStaleWriter(t *testing.T) {
	store := NewFileStore(t.TempDir())
	doc, err := store.Create("Revision Test")
	if err != nil {
		t.Fatal(err)
	}
	if doc.Meta.Revision != 1 {
		t.Fatalf("expected initial revision 1, got %d", doc.Meta.Revision)
	}

	doc.Nodes[0].Title = "Revision Two"
	persisted, err := store.SaveIfRevision(doc, 1)
	if err != nil {
		t.Fatal(err)
	}
	if persisted.Meta.Revision != 2 {
		t.Fatalf("expected revision 2, got %d", persisted.Meta.Revision)
	}

	_, err = store.SaveIfRevision(doc, 1)
	var conflict *RevisionConflictError
	if !errors.As(err, &conflict) {
		t.Fatalf("expected revision conflict, got %v", err)
	}
	if conflict.Expected != 1 || conflict.Actual != 2 {
		t.Fatalf("unexpected conflict: %+v", conflict)
	}
}

func TestConcurrentConditionalSavesAllowOnlyOneWinner(t *testing.T) {
	store := NewFileStore(t.TempDir())
	doc, err := store.Create("Concurrent")
	if err != nil {
		t.Fatal(err)
	}

	left := doc
	left.Nodes = append([]mindmap.Node(nil), doc.Nodes...)
	left.Nodes[0].Title = "Left"
	right := doc
	right.Nodes = append([]mindmap.Node(nil), doc.Nodes...)
	right.Nodes[0].Title = "Right"

	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for _, candidate := range []mindmap.Document{left, right} {
		wg.Add(1)
		go func(candidate mindmap.Document) {
			defer wg.Done()
			_, err := store.SaveIfRevision(candidate, 1)
			errs <- err
		}(candidate)
	}
	wg.Wait()
	close(errs)

	successes := 0
	conflicts := 0
	for err := range errs {
		if err == nil {
			successes++
			continue
		}
		var conflict *RevisionConflictError
		if errors.As(err, &conflict) {
			conflicts++
			continue
		}
		t.Fatalf("unexpected save error: %v", err)
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("expected one success and one conflict, got success=%d conflict=%d", successes, conflicts)
	}
}

func TestLoadTouchDoesNotAdvanceRevision(t *testing.T) {
	store := NewFileStore(t.TempDir())
	doc, err := store.Create("Opened")
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(time.Millisecond)
	opened, err := store.Load(doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if opened.Meta.Revision != doc.Meta.Revision {
		t.Fatalf("read advanced revision from %d to %d", doc.Meta.Revision, opened.Meta.Revision)
	}
}
