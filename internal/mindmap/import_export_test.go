package mindmap

import (
	"strings"
	"testing"
)

func TestImportMarkdownKeepsFloatingHierarchyAndRelations(t *testing.T) {
	content := strings.TrimSpace(`
# Product Plan

- Research
  - Interview users
- Delivery

## Floating Nodes

- Free Cluster
  - Loose Child

## Relations

- Research -> Loose Child : cross-link
`)

	doc := ImportMarkdown(content)
	if err := doc.Validate(); err != nil {
		t.Fatalf("document should validate: %v", err)
	}

	if doc.Root().Title != "Product Plan" {
		t.Fatalf("unexpected root title: %s", doc.Root().Title)
	}

	var floating Node
	var floatingChild Node
	for _, node := range doc.Nodes {
		if node.Title == "Free Cluster" {
			floating = node
		}
		if node.Title == "Loose Child" {
			floatingChild = node
		}
	}

	if floating.ID == "" || floating.Kind != NodeKindFloating || floating.ParentID != "" {
		t.Fatalf("expected floating node without parent, got %+v", floating)
	}
	if floatingChild.ID == "" || floatingChild.ParentID != floating.ID {
		t.Fatalf("expected floating child parent to be %s, got %+v", floating.ID, floatingChild)
	}

	if len(doc.Relations) != 1 {
		t.Fatalf("expected 1 relation, got %d", len(doc.Relations))
	}
	if doc.Relations[0].Label != "cross-link" {
		t.Fatalf("unexpected relation label: %s", doc.Relations[0].Label)
	}
}

func TestImportPlainTextUsesFirstLineAsRoot(t *testing.T) {
	content := strings.TrimSpace(`
Roadmap
  Discovery
    Interview users
  Delivery
`)

	doc := ImportPlainText(content)
	if err := doc.Validate(); err != nil {
		t.Fatalf("document should validate: %v", err)
	}

	if doc.Root().Title != "Roadmap" {
		t.Fatalf("expected root title Roadmap, got %s", doc.Root().Title)
	}

	children := doc.ChildrenOf("root")
	if len(children) != 2 {
		t.Fatalf("expected 2 root children, got %d", len(children))
	}

	var discovery Node
	var interview Node
	for _, node := range doc.Nodes {
		if node.Title == "Discovery" {
			discovery = node
		}
		if node.Title == "Interview users" {
			interview = node
		}
	}

	if discovery.ID == "" || discovery.ParentID != "root" {
		t.Fatalf("expected Discovery under root, got %+v", discovery)
	}
	if interview.ID == "" || interview.ParentID != discovery.ID {
		t.Fatalf("expected Interview users under Discovery, got %+v", interview)
	}
}

func TestExportMarkdownIncludesRelationsAndPriority(t *testing.T) {
	doc := NewDefaultDocument()
	parent := newImportedNode("Launch", "root", NodeKindTopic, Position{X: 580, Y: 280})
	parent.Priority = Priority1
	child := newImportedNode("Checklist", parent.ID, NodeKindTopic, Position{X: 840, Y: 280})
	free := newImportedNode("Scratchpad", "", NodeKindFloating, Position{X: 280, Y: 520})
	doc.Nodes = append(doc.Nodes, parent, child, free)
	doc.Relations = append(doc.Relations, RelationEdge{
		ID:       NewID("rel"),
		SourceID: parent.ID,
		TargetID: free.ID,
		Label:    "supports",
	})

	markdown := ExportMarkdown(doc)

	expectedSnippets := []string{
		"# New Mind Map",
		"- [P1] Launch",
		"  - Checklist",
		"## Floating Nodes",
		"- Scratchpad",
		"## Relations",
		"- Launch -> Scratchpad : supports",
	}

	for _, snippet := range expectedSnippets {
		if !strings.Contains(markdown, snippet) {
			t.Fatalf("expected markdown to contain %q, got:\n%s", snippet, markdown)
		}
	}
}
