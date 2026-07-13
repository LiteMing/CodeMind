package mindmap

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

const projectFormatTestdataDir = "testdata/gitformat"

func TestProjectMapFormatGolden(t *testing.T) {
	doc := loadProjectFormatRuntimeFixture(t, "full.runtime.json")
	semantic, layout, err := SplitProjectMapDocument(doc)
	if err != nil {
		t.Fatal(err)
	}
	semanticPayload, err := MarshalProjectMapSemantic(semantic)
	if err != nil {
		t.Fatal(err)
	}
	layoutPayload, err := MarshalProjectMapLayout(layout)
	if err != nil {
		t.Fatal(err)
	}

	assertProjectFormatGolden(t, "full.semantic.golden.json", semanticPayload)
	assertProjectFormatGolden(t, "full.layout.golden.json", layoutPayload)
	for name, payload := range map[string][]byte{"semantic": semanticPayload, "layout": layoutPayload} {
		if bytes.Contains(payload, []byte("\r")) {
			t.Fatalf("%s payload contains CR line endings", name)
		}
		if !bytes.HasSuffix(payload, []byte("\n")) || bytes.HasSuffix(payload, []byte("\n\n")) {
			t.Fatalf("%s payload must end with exactly one newline", name)
		}
	}
	if !bytes.Contains(semanticPayload, []byte(`Project <Map> & Plan`)) {
		t.Fatalf("semantic payload unexpectedly HTML-escaped: %s", semanticPayload)
	}
}

func TestProjectMapSemanticIgnoresLayoutRuntimeStateAndSliceOrder(t *testing.T) {
	doc := loadProjectFormatRuntimeFixture(t, "full.runtime.json")
	before, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	semantic, _, err := SplitProjectMapDocument(doc)
	if err != nil {
		t.Fatal(err)
	}
	baseline, err := MarshalProjectMapSemantic(semantic)
	if err != nil {
		t.Fatal(err)
	}
	after, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("SplitProjectMapDocument mutated its input document")
	}

	changed := loadProjectFormatRuntimeFixture(t, "full.runtime.json")
	slices.Reverse(changed.Nodes)
	slices.Reverse(changed.Relations)
	slices.Reverse(changed.Regions)
	for index := range changed.Nodes {
		slices.Reverse(changed.Nodes[index].Bindings)
		changed.Nodes[index].Position.X += 777
		changed.Nodes[index].Position.Y -= 333
		changed.Nodes[index].Width += 40
		changed.Nodes[index].Height += 20
		changed.Nodes[index].Collapsed = !changed.Nodes[index].Collapsed
		changed.Nodes[index].CreatedAt = changed.Nodes[index].CreatedAt.Add(24 * time.Hour)
		changed.Nodes[index].UpdatedAt = changed.Nodes[index].UpdatedAt.Add(48 * time.Hour)
	}
	for index := range changed.Relations {
		slices.Reverse(changed.Relations[index].Branches)
		changed.Relations[index].MidpointT += 0.1
		changed.Relations[index].MidpointOffset = &Position{X: 999, Y: 888}
		changed.Relations[index].Waypoints = []Position{{X: 1, Y: 2}}
		changed.Relations[index].CreatedAt = changed.Relations[index].CreatedAt.Add(time.Hour)
		changed.Relations[index].UpdatedAt = changed.Relations[index].UpdatedAt.Add(2 * time.Hour)
	}
	for index := range changed.Regions {
		changed.Regions[index].Position = Position{X: 9, Y: 8}
		changed.Regions[index].Width += 100
		changed.Regions[index].Height += 100
		changed.Regions[index].CreatedAt = changed.Regions[index].CreatedAt.Add(time.Hour)
		changed.Regions[index].UpdatedAt = changed.Regions[index].UpdatedAt.Add(2 * time.Hour)
	}
	changed.Theme = ThemeDark
	changed.Title = "Stale duplicate title"
	changed.Meta.Version = 42
	changed.Meta.Revision = 99
	changed.Meta.LastEditedAt = changed.Meta.LastEditedAt.Add(72 * time.Hour)
	changed.Meta.LastOpenedAt = changed.Meta.LastOpenedAt.Add(96 * time.Hour)

	changedSemantic, _, err := SplitProjectMapDocument(changed)
	if err != nil {
		t.Fatal(err)
	}
	changedPayload, err := MarshalProjectMapSemantic(changedSemantic)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(baseline, changedPayload) {
		t.Fatalf("layout/runtime-only changes altered semantic bytes\n--- baseline ---\n%s\n--- changed ---\n%s", baseline, changedPayload)
	}
}

func TestProjectMapSemanticChangesForSemanticEdit(t *testing.T) {
	doc := loadProjectFormatRuntimeFixture(t, "full.runtime.json")
	semantic, _, err := SplitProjectMapDocument(doc)
	if err != nil {
		t.Fatal(err)
	}
	baseline, err := MarshalProjectMapSemantic(semantic)
	if err != nil {
		t.Fatal(err)
	}
	for index := range doc.Nodes {
		if doc.Nodes[index].ID == "child-a" {
			doc.Nodes[index].Title = "Frontend Updated"
		}
	}
	changed, _, err := SplitProjectMapDocument(doc)
	if err != nil {
		t.Fatal(err)
	}
	changedPayload, err := MarshalProjectMapSemantic(changed)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(baseline, changedPayload) {
		t.Fatal("semantic edit did not alter semantic bytes")
	}
}

func TestProjectMapStrictRoundTripPreservesBothProjections(t *testing.T) {
	doc := loadProjectFormatRuntimeFixture(t, "full.runtime.json")
	semantic, layout, err := SplitProjectMapDocument(doc)
	if err != nil {
		t.Fatal(err)
	}
	restored, err := MergeProjectMapDocuments(semantic, &layout, ProjectMapMergeStrict, time.Unix(123, 0))
	if err != nil {
		t.Fatal(err)
	}
	restoredSemantic, restoredLayout, err := SplitProjectMapDocument(restored)
	if err != nil {
		t.Fatal(err)
	}
	assertSameProjectFormatBytes(t, semantic, restoredSemantic, layout, restoredLayout)
}

func TestProjectMapReconcileUsesExistingLayoutAndDefaultsNewEntities(t *testing.T) {
	doc := loadProjectFormatRuntimeFixture(t, "full.runtime.json")
	semantic, layout, err := SplitProjectMapDocument(doc)
	if err != nil {
		t.Fatal(err)
	}
	semantic.Nodes = slices.DeleteFunc(semantic.Nodes, func(node ProjectMapSemanticNode) bool {
		return node.ID == "child-b"
	})
	semantic.Relations = []ProjectMapSemanticRelation{}
	semantic.Regions = slices.DeleteFunc(semantic.Regions, func(region ProjectMapSemanticRegion) bool {
		return region.ID == "region-a"
	})
	semantic.Nodes = append(semantic.Nodes, ProjectMapSemanticNode{
		ID: "child-new", ParentID: "root", Kind: NodeKindTopic, Order: 2, Title: "New Child", Bindings: []NodeBinding{},
	})
	for index := range layout.Regions {
		if layout.Regions[index].ID == "region-a" {
			layout.Regions[index].Width = 0
		}
	}
	fixedNow := time.Date(2026, 7, 10, 8, 0, 0, 0, time.UTC)
	reconciled, err := MergeProjectMapDocuments(semantic, &layout, ProjectMapMergeReconcile, fixedNow)
	if err != nil {
		t.Fatal(err)
	}
	nodes := reconciled.NodeMap()
	if _, exists := nodes["child-b"]; exists {
		t.Fatal("reconcile retained node removed from semantic")
	}
	for _, region := range reconciled.Regions {
		if region.ID == "region-a" {
			t.Fatal("reconcile retained region removed from semantic")
		}
	}
	if nodes["child-a"].Position != (Position{X: 1120, Y: 220}) {
		t.Fatalf("existing node layout was not preserved: %#v", nodes["child-a"].Position)
	}
	if nodes["child-new"].Position == (Position{}) || !nodes["child-new"].CreatedAt.Equal(fixedNow) {
		t.Fatalf("new node did not receive deterministic defaults: %#v", nodes["child-new"])
	}

	semanticOnlyA, err := MergeProjectMapDocuments(semantic, nil, ProjectMapMergeReconcile, fixedNow)
	if err != nil {
		t.Fatal(err)
	}
	semanticOnlyB, err := MergeProjectMapDocuments(semantic, nil, ProjectMapMergeReconcile, fixedNow)
	if err != nil {
		t.Fatal(err)
	}
	left, _ := json.Marshal(semanticOnlyA)
	right, _ := json.Marshal(semanticOnlyB)
	if !bytes.Equal(left, right) {
		t.Fatal("semantic-only reconcile is not deterministic for a fixed clock")
	}
}

func TestProjectMapFormatRejectsInvalidContracts(t *testing.T) {
	doc := loadProjectFormatRuntimeFixture(t, "full.runtime.json")
	semantic, layout, err := SplitProjectMapDocument(doc)
	if err != nil {
		t.Fatal(err)
	}

	t.Run("unsupported semantic schema", func(t *testing.T) {
		candidate := semantic
		candidate.SchemaVersion = 99
		if _, err := MarshalProjectMapSemantic(candidate); err == nil || !strings.Contains(err.Error(), "unsupported semantic schemaVersion") {
			t.Fatalf("error = %v", err)
		}
	})
	t.Run("duplicate relation id", func(t *testing.T) {
		candidate := semantic
		candidate.Relations = append([]ProjectMapSemanticRelation(nil), semantic.Relations...)
		candidate.Relations = append(candidate.Relations, semantic.Relations[0])
		if _, err := MarshalProjectMapSemantic(candidate); err == nil || !strings.Contains(err.Error(), "duplicate semantic relation id") {
			t.Fatalf("error = %v", err)
		}
	})
	t.Run("invalid node kind", func(t *testing.T) {
		candidate := semantic
		candidate.Nodes = append([]ProjectMapSemanticNode(nil), semantic.Nodes...)
		candidate.Nodes[1].Kind = "invalid"
		if _, err := MarshalProjectMapSemantic(candidate); err == nil || !strings.Contains(err.Error(), "invalid kind") {
			t.Fatalf("error = %v", err)
		}
	})
	t.Run("missing semantic order", func(t *testing.T) {
		candidate := semantic
		candidate.Nodes = append([]ProjectMapSemanticNode(nil), semantic.Nodes...)
		candidate.Nodes[1].Order = 0
		if _, err := MarshalProjectMapSemantic(candidate); err == nil || !strings.Contains(err.Error(), "positive order") {
			t.Fatalf("error = %v", err)
		}
	})
	t.Run("map mismatch", func(t *testing.T) {
		candidate := layout
		candidate.MapID = "other-map"
		if _, err := MergeProjectMapDocuments(semantic, &candidate, ProjectMapMergeReconcile, time.Now()); err == nil || !strings.Contains(err.Error(), "does not match") {
			t.Fatalf("error = %v", err)
		}
	})
	t.Run("strict id mismatch", func(t *testing.T) {
		candidate := layout
		candidate.Nodes = candidate.Nodes[1:]
		if _, err := MergeProjectMapDocuments(semantic, &candidate, ProjectMapMergeStrict, time.Now()); err == nil || !strings.Contains(err.Error(), "matching node id sets") {
			t.Fatalf("error = %v", err)
		}
	})
	t.Run("unknown json field", func(t *testing.T) {
		payload := []byte(`{"format":"codemind.project-map.semantic","schemaVersion":1,"mapId":"x","nodes":[],"relations":[],"regions":[],"unknown":true}`)
		if _, err := ParseProjectMapSemantic(payload); err == nil || !strings.Contains(err.Error(), "unknown field") {
			t.Fatalf("error = %v", err)
		}
	})
}

func TestProjectMapLegacyRuntimeExportsWithoutChangingSourceFile(t *testing.T) {
	path := filepath.Join(projectFormatTestdataDir, "legacy.runtime.json")
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var doc Document
	if err := json.Unmarshal(before, &doc); err != nil {
		t.Fatal(err)
	}
	semantic, layout, err := SplitProjectMapDocument(doc)
	if err != nil {
		t.Fatal(err)
	}
	if semantic.Nodes[1].ID != "earlier" || semantic.Nodes[1].Order != 1 {
		t.Fatalf("legacy order migration = %#v", semantic.Nodes)
	}
	if layout.RuntimeMeta.Revision != 1 || layout.RuntimeMeta.RuntimeSchemaVersion != 1 {
		t.Fatalf("legacy runtime meta = %#v", layout.RuntimeMeta)
	}
	if layout.Theme != ThemeDark {
		t.Fatalf("legacy theme = %q, want dark", layout.Theme)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("legacy source fixture changed during export")
	}
}

func loadProjectFormatRuntimeFixture(t *testing.T, name string) Document {
	t.Helper()
	payload, err := os.ReadFile(filepath.Join(projectFormatTestdataDir, name))
	if err != nil {
		t.Fatal(err)
	}
	var doc Document
	if err := json.Unmarshal(payload, &doc); err != nil {
		t.Fatal(err)
	}
	return doc
}

func assertProjectFormatGolden(t *testing.T, name string, actual []byte) {
	t.Helper()
	path := filepath.Join(projectFormatTestdataDir, name)
	if os.Getenv("UPDATE_GOLDEN") == "1" {
		if err := os.WriteFile(path, actual, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	expected, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read golden %s: %v; run with UPDATE_GOLDEN=1 to create it", name, err)
	}
	if !bytes.Equal(expected, actual) {
		t.Fatalf("golden mismatch for %s\n--- expected ---\n%s\n--- actual ---\n%s", name, expected, actual)
	}
}

func assertSameProjectFormatBytes(
	t *testing.T,
	leftSemantic ProjectMapSemanticDocument,
	rightSemantic ProjectMapSemanticDocument,
	leftLayout ProjectMapLayoutDocument,
	rightLayout ProjectMapLayoutDocument,
) {
	t.Helper()
	leftSemanticPayload, err := MarshalProjectMapSemantic(leftSemantic)
	if err != nil {
		t.Fatal(err)
	}
	rightSemanticPayload, err := MarshalProjectMapSemantic(rightSemantic)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(leftSemanticPayload, rightSemanticPayload) {
		t.Fatalf("semantic round trip mismatch\n%s\n%s", leftSemanticPayload, rightSemanticPayload)
	}
	leftLayoutPayload, err := MarshalProjectMapLayout(leftLayout)
	if err != nil {
		t.Fatal(err)
	}
	rightLayoutPayload, err := MarshalProjectMapLayout(rightLayout)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(leftLayoutPayload, rightLayoutPayload) {
		t.Fatalf("layout round trip mismatch\n%s\n%s", leftLayoutPayload, rightLayoutPayload)
	}
}
