package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"code-mind/internal/mindmap"
)

func TestFormatCLIRequiresSubcommandAndArguments(t *testing.T) {
	tests := []struct {
		name string
		args []string
		want string
	}{
		{name: "subcommand", args: nil, want: "expected export or import subcommand"},
		{name: "known subcommand", args: []string{"unknown"}, want: "unknown subcommand"},
		{name: "export paths", args: []string{"export"}, want: "--input and --out-dir are required"},
		{name: "import paths", args: []string{"import"}, want: "--semantic and --output are required"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var stdout bytes.Buffer
			var stderr bytes.Buffer
			err := runFormatCLI(test.args, &stdout, &stderr)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("runFormatCLI() error = %v, want containing %q", err, test.want)
			}
		})
	}
}

func TestFormatCLIExportImportStrictRoundTrip(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, "runtime.json")
	original := readProjectFormatFixture(t)
	writeTestFile(t, input, original)

	outDir := filepath.Join(dir, "project-map")
	runFormatTestCommand(t, "export", "--input", input, "--out-dir", outDir)
	if got := readTestFile(t, input); !bytes.Equal(got, original) {
		t.Fatal("export modified its runtime input")
	}

	semanticPath := filepath.Join(outDir, projectMapSemanticFilename)
	layoutPath := filepath.Join(outDir, projectMapLayoutFilename)
	semanticPayload := readTestFile(t, semanticPath)
	layoutPayload := readTestFile(t, layoutPath)
	semantic, err := mindmap.ParseProjectMapSemantic(semanticPayload)
	if err != nil {
		t.Fatalf("parse exported semantic document: %v", err)
	}
	layout, err := mindmap.ParseProjectMapLayout(layoutPayload)
	if err != nil {
		t.Fatalf("parse exported layout document: %v", err)
	}

	output := filepath.Join(dir, "restored", "runtime.json")
	runFormatTestCommand(t, "import", "--semantic", semanticPath, "--layout", layoutPath, "--output", output)
	var restored mindmap.Document
	if err := json.Unmarshal(readTestFile(t, output), &restored); err != nil {
		t.Fatalf("parse imported runtime document: %v", err)
	}
	restoredSemantic, restoredLayout, err := mindmap.SplitProjectMapDocument(restored)
	if err != nil {
		t.Fatalf("split imported runtime document: %v", err)
	}
	assertProjectFormatEqual(t, semantic, restoredSemantic, layout, restoredLayout)
	if got := readTestFile(t, semanticPath); !bytes.Equal(got, semanticPayload) {
		t.Fatal("import modified its semantic input")
	}
	if got := readTestFile(t, layoutPath); !bytes.Equal(got, layoutPayload) {
		t.Fatal("import modified its layout input")
	}
}

func TestFormatCLIReconcileAllowsMissingLayout(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, "runtime.json")
	writeTestFile(t, input, readProjectFormatFixture(t))
	outDir := filepath.Join(dir, "format")
	runFormatTestCommand(t, "export", "--input", input, "--out-dir", outDir)

	output := filepath.Join(dir, "reconciled.json")
	runFormatTestCommand(t,
		"import",
		"--semantic", filepath.Join(outDir, projectMapSemanticFilename),
		"--output", output,
	)
	var document mindmap.Document
	if err := json.Unmarshal(readTestFile(t, output), &document); err != nil {
		t.Fatalf("parse reconciled runtime document: %v", err)
	}
	if err := document.Validate(); err != nil {
		t.Fatalf("reconciled runtime document is invalid: %v", err)
	}
	if document.ID != "project-map" || document.Meta.Revision != 1 {
		t.Fatalf("unexpected reconciled runtime identity: id=%q revision=%d", document.ID, document.Meta.Revision)
	}
}

func TestFormatCLIRefusesPartialOverwriteAndForceReplaces(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, "runtime.json")
	writeTestFile(t, input, readProjectFormatFixture(t))
	outDir := filepath.Join(dir, "format")
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		t.Fatal(err)
	}
	semanticPath := filepath.Join(outDir, projectMapSemanticFilename)
	layoutPath := filepath.Join(outDir, projectMapLayoutFilename)
	writeTestFile(t, semanticPath, []byte("keep me"))

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	err := runFormatCLI([]string{"export", "--input", input, "--out-dir", outDir}, &stdout, &stderr)
	if err == nil || !strings.Contains(err.Error(), "already exists") {
		t.Fatalf("export error = %v, want overwrite refusal", err)
	}
	if got := readTestFile(t, semanticPath); string(got) != "keep me" {
		t.Fatalf("existing output changed after refused export: %q", got)
	}
	if _, err := os.Stat(layoutPath); !os.IsNotExist(err) {
		t.Fatalf("layout output was created during refused export: %v", err)
	}

	runFormatTestCommand(t, "export", "--input", input, "--out-dir", outDir, "--force")
	if _, err := mindmap.ParseProjectMapSemantic(readTestFile(t, semanticPath)); err != nil {
		t.Fatalf("forced export did not replace semantic output: %v", err)
	}
	if _, err := mindmap.ParseProjectMapLayout(readTestFile(t, layoutPath)); err != nil {
		t.Fatalf("forced export did not write layout output: %v", err)
	}

	output := filepath.Join(dir, "imported.json")
	writeTestFile(t, output, []byte("keep runtime"))
	err = runFormatCLI([]string{
		"import", "--semantic", semanticPath, "--layout", layoutPath, "--output", output,
	}, &stdout, &stderr)
	if err == nil || !strings.Contains(err.Error(), "already exists") {
		t.Fatalf("import error = %v, want overwrite refusal", err)
	}
	if got := readTestFile(t, output); string(got) != "keep runtime" {
		t.Fatalf("existing runtime changed after refused import: %q", got)
	}
	runFormatTestCommand(t,
		"import", "--semantic", semanticPath, "--layout", layoutPath, "--output", output, "--force",
	)
	var imported mindmap.Document
	if err := json.Unmarshal(readTestFile(t, output), &imported); err != nil {
		t.Fatalf("forced import did not replace runtime output: %v", err)
	}
}

func TestFormatCLIRejectsInputOutputCollision(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, projectMapSemanticFilename)
	writeTestFile(t, input, readProjectFormatFixture(t))

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	err := runFormatCLI([]string{"export", "--input", input, "--out-dir", dir, "--force"}, &stdout, &stderr)
	if err == nil || !strings.Contains(err.Error(), "input file must not") {
		t.Fatalf("export collision error = %v", err)
	}
	if got := readTestFile(t, input); !bytes.Equal(got, readProjectFormatFixture(t)) {
		t.Fatal("colliding export modified its input")
	}
}

func TestFormatCLIExportRollsBackWholeOutputSetOnCommitFailure(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, "runtime.json")
	writeTestFile(t, input, readProjectFormatFixture(t))
	outDir := filepath.Join(dir, "format")
	semanticPath := filepath.Join(outDir, projectMapSemanticFilename)
	layoutPath := filepath.Join(outDir, projectMapLayoutFilename)
	writeTestFile(t, semanticPath, []byte("old semantic"))
	writeTestFile(t, layoutPath, []byte("old layout"))

	originalRename := renameStagedOutput
	renameStagedOutput = func(oldPath, newPath string) error {
		if samePath(newPath, layoutPath) {
			return errors.New("injected layout commit failure")
		}
		return os.Rename(oldPath, newPath)
	}
	defer func() { renameStagedOutput = originalRename }()

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	err := runFormatCLI([]string{"export", "--input", input, "--out-dir", outDir, "--force"}, &stdout, &stderr)
	if err == nil || !strings.Contains(err.Error(), "injected layout commit failure") {
		t.Fatalf("export error = %v", err)
	}
	if got := string(readTestFile(t, semanticPath)); got != "old semantic" {
		t.Fatalf("semantic rollback = %q", got)
	}
	if got := string(readTestFile(t, layoutPath)); got != "old layout" {
		t.Fatalf("layout rollback = %q", got)
	}
}

func TestFormatCLIReconcileIgnoresInvalidLayoutOrphan(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, "runtime.json")
	writeTestFile(t, input, readProjectFormatFixture(t))
	outDir := filepath.Join(dir, "format")
	runFormatTestCommand(t, "export", "--input", input, "--out-dir", outDir)

	semanticPath := filepath.Join(outDir, projectMapSemanticFilename)
	layoutPath := filepath.Join(outDir, projectMapLayoutFilename)
	semantic, err := mindmap.ParseProjectMapSemantic(readTestFile(t, semanticPath))
	if err != nil {
		t.Fatal(err)
	}
	semantic.Regions = slices.DeleteFunc(semantic.Regions, func(region mindmap.ProjectMapSemanticRegion) bool {
		return region.ID == "region-a"
	})
	semanticPayload, err := mindmap.MarshalProjectMapSemantic(semantic)
	if err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, semanticPath, semanticPayload)

	layout, err := mindmap.DecodeProjectMapLayout(readTestFile(t, layoutPath))
	if err != nil {
		t.Fatal(err)
	}
	for index := range layout.Regions {
		if layout.Regions[index].ID == "region-a" {
			layout.Regions[index].Width = 0
		}
	}
	layoutPayload, err := marshalIndentedJSON(layout)
	if err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, layoutPath, layoutPayload)

	output := filepath.Join(dir, "reconciled.json")
	runFormatTestCommand(t,
		"import", "--semantic", semanticPath, "--layout", layoutPath, "--output", output, "--reconcile",
	)
	var reconciled mindmap.Document
	if err := json.Unmarshal(readTestFile(t, output), &reconciled); err != nil {
		t.Fatal(err)
	}
	for _, region := range reconciled.Regions {
		if region.ID == "region-a" {
			t.Fatal("reconcile retained invalid orphan region")
		}
	}
}

func assertProjectFormatEqual(
	t *testing.T,
	wantSemantic, gotSemantic mindmap.ProjectMapSemanticDocument,
	wantLayout, gotLayout mindmap.ProjectMapLayoutDocument,
) {
	t.Helper()
	wantSemanticPayload, err := mindmap.MarshalProjectMapSemantic(wantSemantic)
	if err != nil {
		t.Fatal(err)
	}
	gotSemanticPayload, err := mindmap.MarshalProjectMapSemantic(gotSemantic)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(wantSemanticPayload, gotSemanticPayload) {
		t.Fatalf("semantic projection changed after round trip\nwant:\n%s\ngot:\n%s", wantSemanticPayload, gotSemanticPayload)
	}
	wantLayoutPayload, err := mindmap.MarshalProjectMapLayout(wantLayout)
	if err != nil {
		t.Fatal(err)
	}
	gotLayoutPayload, err := mindmap.MarshalProjectMapLayout(gotLayout)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(wantLayoutPayload, gotLayoutPayload) {
		t.Fatalf("layout projection changed after round trip\nwant:\n%s\ngot:\n%s", wantLayoutPayload, gotLayoutPayload)
	}
}

func runFormatTestCommand(t *testing.T, args ...string) {
	t.Helper()
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	if err := runFormatCLI(args, &stdout, &stderr); err != nil {
		t.Fatalf("runFormatCLI(%q): %v\nstderr: %s", args, err, stderr.String())
	}
}

func readProjectFormatFixture(t *testing.T) []byte {
	t.Helper()
	return readTestFile(t, filepath.Join("internal", "mindmap", "testdata", "gitformat", "full.runtime.json"))
}

func readTestFile(t *testing.T, path string) []byte {
	t.Helper()
	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return payload
}

func writeTestFile(t *testing.T, path string, payload []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("create parent for %s: %v", path, err)
	}
	if err := os.WriteFile(path, payload, 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}
