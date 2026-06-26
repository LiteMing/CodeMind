package mindmap

import (
	"strings"
	"testing"
)

func TestDocumentValidateRejectsUnsafeNodeID(t *testing.T) {
	doc := NewDefaultDocument()
	doc.Nodes = append(doc.Nodes, Node{
		ID:       `bad" onmouseover="x`,
		ParentID: "root",
		Kind:     NodeKindTopic,
		Title:    "Bad",
		Position: Position{X: 1, Y: 1},
	})

	err := doc.Validate()
	if err == nil {
		t.Fatal("expected unsafe node id to be rejected")
	}
	if !strings.Contains(err.Error(), "unsafe characters") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestDocumentValidateAcceptsGeneratedStyleIDs(t *testing.T) {
	doc := NewDefaultDocument()
	doc.ID = "map-123_ok"
	doc.Nodes = append(doc.Nodes, Node{
		ID:       "node-123_ok:part.1",
		ParentID: "root",
		Kind:     NodeKindTopic,
		Title:    "OK",
		Position: Position{X: 1, Y: 1},
	})
	doc.Relations = append(doc.Relations, RelationEdge{
		ID:       "rel-123_ok",
		SourceID: "root",
		TargetID: "node-123_ok:part.1",
	})

	if err := doc.Validate(); err != nil {
		t.Fatalf("expected generated style ids to validate: %v", err)
	}
}
