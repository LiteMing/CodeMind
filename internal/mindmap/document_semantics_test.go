package mindmap

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestNormalizeSemanticsMigratesLegacySiblingOrderDeterministically(t *testing.T) {
	now := time.Now().UTC()
	doc := NewDefaultDocument()
	doc.Nodes = append(doc.Nodes,
		Node{ID: "node-c", ParentID: "root", Kind: NodeKindTopic, Title: "C", Position: Position{X: 900, Y: 200}, CreatedAt: now, UpdatedAt: now},
		Node{ID: "node-b", ParentID: "root", Kind: NodeKindTopic, Title: "B", Position: Position{X: 800, Y: 100}, CreatedAt: now, UpdatedAt: now},
		Node{ID: "node-a", ParentID: "root", Kind: NodeKindTopic, Title: "A", Position: Position{X: 800, Y: 100}, CreatedAt: now, UpdatedAt: now},
	)

	if err := doc.NormalizeSemantics(); err != nil {
		t.Fatalf("NormalizeSemantics() error = %v", err)
	}

	children := doc.ChildrenOf("root")
	got := []string{children[0].ID, children[1].ID, children[2].ID}
	want := []string{"node-a", "node-b", "node-c"}
	for index := range want {
		if got[index] != want[index] || children[index].Order != index+1 {
			t.Fatalf("child %d = %s/order %d, want %s/order %d", index, got[index], children[index].Order, want[index], index+1)
		}
	}

	doc.Nodes[1].Position.Y = 999
	if err := doc.NormalizeSemantics(); err != nil {
		t.Fatalf("second NormalizeSemantics() error = %v", err)
	}
	children = doc.ChildrenOf("root")
	for index := range want {
		if children[index].ID != want[index] {
			t.Fatalf("coordinate change reordered child %d to %s, want %s", index, children[index].ID, want[index])
		}
	}
}

func TestNormalizeSemanticsFillsMixedLegacyOrder(t *testing.T) {
	doc := NewDefaultDocument()
	now := time.Now().UTC()
	doc.Nodes = append(doc.Nodes,
		Node{ID: "first", ParentID: "root", Kind: NodeKindTopic, Order: 1, Title: "First", Position: Position{Y: 500}, CreatedAt: now, UpdatedAt: now},
		Node{ID: "legacy", ParentID: "root", Kind: NodeKindTopic, Title: "Legacy", Position: Position{Y: 100}, CreatedAt: now, UpdatedAt: now},
	)

	if err := doc.NormalizeSemantics(); err != nil {
		t.Fatalf("NormalizeSemantics() error = %v", err)
	}
	if doc.Nodes[1].Order != 1 || doc.Nodes[2].Order != 2 {
		t.Fatalf("orders = %d, %d; want 1, 2", doc.Nodes[1].Order, doc.Nodes[2].Order)
	}
}

func TestNodeBindingsNormalizeAndRoundTrip(t *testing.T) {
	doc := NewDefaultDocument()
	doc.Nodes[0].Bindings = []NodeBinding{
		{ID: "binding-file", Type: BindingTypeFile, Path: `.\frontend\\src\app.ts`, ContentHash: " sha256:abc "},
		{ID: "binding-symbol", Type: BindingTypeSymbol, Path: "internal/server/maps.go", Symbol: " Server.handleMaps "},
		{ID: "binding-glob", Type: BindingTypeGlob, Path: ".", Glob: "frontend\\src\\**\\*.ts"},
	}

	if err := doc.NormalizeSemantics(); err != nil {
		t.Fatalf("NormalizeSemantics() error = %v", err)
	}
	if got := doc.Nodes[0].Bindings[0].Path; got != "frontend/src/app.ts" {
		t.Fatalf("normalized path = %q", got)
	}
	if got := doc.Nodes[0].Bindings[2].Glob; got != "frontend/src/**/*.ts" {
		t.Fatalf("normalized glob = %q", got)
	}
	if err := doc.Validate(); err != nil {
		t.Fatalf("Validate() error = %v", err)
	}

	payload, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	var decoded Document
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatal(err)
	}
	if err := decoded.NormalizeSemantics(); err != nil {
		t.Fatal(err)
	}
	if decoded.Nodes[0].Bindings[1].Symbol != "Server.handleMaps" {
		t.Fatalf("symbol = %q", decoded.Nodes[0].Bindings[1].Symbol)
	}
}

func TestNodeBindingValidationRejectsInvalidContracts(t *testing.T) {
	tests := []struct {
		name     string
		bindings []NodeBinding
		contains string
	}{
		{name: "absolute", bindings: []NodeBinding{{ID: "bind", Type: BindingTypeFile, Path: "/etc/passwd"}}, contains: "repository-relative"},
		{name: "drive", bindings: []NodeBinding{{ID: "bind", Type: BindingTypeFile, Path: `C:\repo\file.go`}}, contains: "drive prefix"},
		{name: "traversal", bindings: []NodeBinding{{ID: "bind", Type: BindingTypeFile, Path: "src/../secret"}}, contains: "'..'"},
		{name: "symbol required", bindings: []NodeBinding{{ID: "bind", Type: BindingTypeSymbol, Path: "main.go"}}, contains: "requires symbol"},
		{name: "glob required", bindings: []NodeBinding{{ID: "bind", Type: BindingTypeGlob, Path: "."}}, contains: "requires glob"},
		{name: "symbol forbidden", bindings: []NodeBinding{{ID: "bind", Type: BindingTypeFile, Path: "main.go", Symbol: "main"}}, contains: "must not define symbol"},
		{name: "invalid type", bindings: []NodeBinding{{ID: "bind", Type: "url", Path: "main.go"}}, contains: "invalid type"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			doc := NewDefaultDocument()
			doc.Nodes[0].Bindings = test.bindings
			err := doc.NormalizeSemantics()
			if err == nil {
				err = doc.Validate()
			}
			if err == nil || !strings.Contains(err.Error(), test.contains) {
				t.Fatalf("error = %v, want substring %q", err, test.contains)
			}
		})
	}
}

func TestValidateRejectsDuplicateBindingIDAcrossNodes(t *testing.T) {
	doc := NewDefaultDocument()
	now := time.Now().UTC()
	doc.Nodes[0].Bindings = []NodeBinding{{ID: "shared", Type: BindingTypeDirectory, Path: "frontend"}}
	doc.Nodes = append(doc.Nodes, Node{
		ID: "child", ParentID: "root", Kind: NodeKindTopic, Title: "Child", Position: Position{Y: 100}, CreatedAt: now, UpdatedAt: now,
		Bindings: []NodeBinding{{ID: "shared", Type: BindingTypeFile, Path: "frontend/src/app.ts"}},
	})
	if err := doc.NormalizeSemantics(); err != nil {
		t.Fatal(err)
	}
	err := doc.Validate()
	if err == nil || !strings.Contains(err.Error(), "duplicate binding id") {
		t.Fatalf("Validate() error = %v", err)
	}
}

func TestNormalizeSemanticsRejectsDuplicateExplicitOrder(t *testing.T) {
	doc := NewDefaultDocument()
	now := time.Now().UTC()
	doc.Nodes = append(doc.Nodes,
		Node{ID: "a", ParentID: "root", Kind: NodeKindTopic, Order: 1, Title: "A", CreatedAt: now, UpdatedAt: now},
		Node{ID: "b", ParentID: "root", Kind: NodeKindTopic, Order: 1, Title: "B", CreatedAt: now, UpdatedAt: now},
	)
	err := doc.NormalizeSemantics()
	if err == nil || !strings.Contains(err.Error(), "duplicate order") {
		t.Fatalf("NormalizeSemantics() error = %v", err)
	}
}
