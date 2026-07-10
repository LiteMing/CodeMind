package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"code-mind/internal/mindmap"
)

func TestFileStoreMigratesLegacyOrderAndBindingPathOnRead(t *testing.T) {
	dir := t.TempDir()
	now := time.Now().UTC()
	doc := mindmap.NewDefaultDocument()
	doc.ID = "legacy-semantics"
	doc.Nodes = append(doc.Nodes,
		mindmap.Node{ID: "later", ParentID: "root", Kind: mindmap.NodeKindTopic, Title: "Later", Position: mindmap.Position{Y: 300}, CreatedAt: now, UpdatedAt: now},
		mindmap.Node{
			ID: "earlier", ParentID: "root", Kind: mindmap.NodeKindTopic, Title: "Earlier", Position: mindmap.Position{Y: 100}, CreatedAt: now, UpdatedAt: now,
			Bindings: []mindmap.NodeBinding{{ID: "source", Type: mindmap.BindingTypeFile, Path: `internal\server\maps.go`}},
		},
	)
	payload, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, doc.ID+".json"), payload, 0o644); err != nil {
		t.Fatal(err)
	}

	fileStore := NewFileStore(dir)
	first, err := fileStore.LoadReadOnly(doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	second, err := fileStore.LoadReadOnly(doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	firstChildren := first.ChildrenOf("root")
	secondChildren := second.ChildrenOf("root")
	if firstChildren[0].ID != "earlier" || firstChildren[0].Order != 1 || firstChildren[1].Order != 2 {
		t.Fatalf("first migration = %#v", firstChildren)
	}
	if secondChildren[0].ID != firstChildren[0].ID || secondChildren[1].ID != firstChildren[1].ID {
		t.Fatalf("migration is not deterministic: %#v vs %#v", firstChildren, secondChildren)
	}
	if firstChildren[0].Bindings[0].Path != "internal/server/maps.go" {
		t.Fatalf("binding path = %q", firstChildren[0].Bindings[0].Path)
	}

	persisted, err := fileStore.SaveIfRevision(first, first.Meta.Revision)
	if err != nil {
		t.Fatal(err)
	}
	if persisted.Meta.Revision != 2 || persisted.ChildrenOf("root")[0].Order != 1 {
		t.Fatalf("persisted migration = revision %d, children %#v", persisted.Meta.Revision, persisted.ChildrenOf("root"))
	}
}
