package mindmap

import (
	"testing"
	"time"
)

func cycleTestDoc() Document {
	now := time.Now().UTC()
	node := func(id, parent string, kind NodeKind) Node {
		return Node{ID: id, ParentID: parent, Kind: kind, Title: id, CreatedAt: now, UpdatedAt: now}
	}
	return Document{
		ID:    "doc-1",
		Title: "doc",
		Nodes: []Node{
			node("root", "", NodeKindRoot),
			node("a", "root", NodeKindTopic),
			node("b", "a", NodeKindTopic),
			node("c", "b", NodeKindTopic),
		},
	}
}

func TestValidateAcceptsAcyclicParents(t *testing.T) {
	doc := cycleTestDoc()
	if err := doc.Validate(); err != nil {
		t.Fatalf("expected valid document, got %v", err)
	}
}

func TestValidateRejectsParentCycle(t *testing.T) {
	doc := cycleTestDoc()
	// a -> b -> c -> a
	for i := range doc.Nodes {
		if doc.Nodes[i].ID == "a" {
			doc.Nodes[i].ParentID = "c"
		}
	}
	if err := doc.Validate(); err == nil {
		t.Fatal("expected cycle to be rejected")
	}
}

func TestValidateRejectsSelfParent(t *testing.T) {
	doc := cycleTestDoc()
	for i := range doc.Nodes {
		if doc.Nodes[i].ID == "c" {
			doc.Nodes[i].ParentID = "c"
		}
	}
	if err := doc.Validate(); err == nil {
		t.Fatal("expected self-parent to be rejected")
	}
}
