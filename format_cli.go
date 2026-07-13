package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"code-mind/internal/mindmap"
)

const (
	projectMapSemanticFilename = "semantic.json"
	projectMapLayoutFilename   = "layout.json"
)

func runFormatCLI(args []string, stdout, stderr io.Writer) error {
	if len(args) == 0 {
		printFormatUsage(stderr)
		return errors.New("expected export or import subcommand")
	}

	switch args[0] {
	case "export":
		return runFormatExport(args[1:], stdout, stderr)
	case "import":
		return runFormatImport(args[1:], stdout, stderr)
	case "help", "-h", "--help":
		printFormatUsage(stdout)
		return nil
	default:
		printFormatUsage(stderr)
		return fmt.Errorf("unknown subcommand %q", args[0])
	}
}

func runFormatExport(args []string, stdout, stderr io.Writer) error {
	flags := flag.NewFlagSet("format export", flag.ContinueOnError)
	flags.SetOutput(stderr)
	input := flags.String("input", "", "runtime document JSON")
	outDir := flags.String("out-dir", "", "output directory")
	force := flags.Bool("force", false, "replace existing output files")
	flags.Usage = func() {
		fmt.Fprintln(stderr, "Usage: codemind format export --input <runtime.json> --out-dir <dir> [--force]")
	}
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("unexpected positional arguments: %s", strings.Join(flags.Args(), " "))
	}
	if strings.TrimSpace(*input) == "" || strings.TrimSpace(*outDir) == "" {
		flags.Usage()
		return errors.New("--input and --out-dir are required")
	}

	semanticPath := filepath.Join(*outDir, projectMapSemanticFilename)
	layoutPath := filepath.Join(*outDir, projectMapLayoutFilename)
	if samePath(*input, semanticPath) || samePath(*input, layoutPath) {
		return errors.New("input file must not also be an output file")
	}
	if err := preflightOutputs([]string{semanticPath, layoutPath}, *force); err != nil {
		return err
	}

	payload, err := os.ReadFile(*input)
	if err != nil {
		return fmt.Errorf("read runtime document: %w", err)
	}
	var document mindmap.Document
	if err := decodeSingleJSON(payload, &document); err != nil {
		return fmt.Errorf("parse runtime document: %w", err)
	}
	semantic, layout, err := mindmap.SplitProjectMapDocument(document)
	if err != nil {
		return fmt.Errorf("split runtime document: %w", err)
	}
	semanticPayload, err := mindmap.MarshalProjectMapSemantic(semantic)
	if err != nil {
		return fmt.Errorf("marshal semantic document: %w", err)
	}
	layoutPayload, err := mindmap.MarshalProjectMapLayout(layout)
	if err != nil {
		return fmt.Errorf("marshal layout document: %w", err)
	}

	if err := writeOutputSetAtomic([]outputFile{
		{path: semanticPath, payload: semanticPayload},
		{path: layoutPath, payload: layoutPayload},
	}, *force); err != nil {
		return err
	}
	fmt.Fprintf(stdout, "exported %s and %s\n", semanticPath, layoutPath)
	return nil
}

func runFormatImport(args []string, stdout, stderr io.Writer) error {
	flags := flag.NewFlagSet("format import", flag.ContinueOnError)
	flags.SetOutput(stderr)
	semanticPath := flags.String("semantic", "", "semantic project map JSON")
	layoutPath := flags.String("layout", "", "layout project map JSON")
	output := flags.String("output", "", "runtime document JSON")
	reconcile := flags.Bool("reconcile", false, "allow absent or incomplete layout data")
	force := flags.Bool("force", false, "replace an existing output file")
	flags.Usage = func() {
		fmt.Fprintln(stderr, "Usage: codemind format import --semantic <semantic.json> [--layout <layout.json>] --output <runtime.json> [--reconcile] [--force]")
	}
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("unexpected positional arguments: %s", strings.Join(flags.Args(), " "))
	}
	if strings.TrimSpace(*semanticPath) == "" || strings.TrimSpace(*output) == "" {
		flags.Usage()
		return errors.New("--semantic and --output are required")
	}
	if samePath(*semanticPath, *output) || (*layoutPath != "" && samePath(*layoutPath, *output)) {
		return errors.New("output file must not overwrite an input file")
	}
	if err := preflightOutputs([]string{*output}, *force); err != nil {
		return err
	}

	semanticPayload, err := os.ReadFile(*semanticPath)
	if err != nil {
		return fmt.Errorf("read semantic document: %w", err)
	}
	semantic, err := mindmap.ParseProjectMapSemantic(semanticPayload)
	if err != nil {
		return fmt.Errorf("parse semantic document: %w", err)
	}

	var layout *mindmap.ProjectMapLayoutDocument
	if *layoutPath != "" {
		layoutPayload, err := os.ReadFile(*layoutPath)
		if err != nil {
			return fmt.Errorf("read layout document: %w", err)
		}
		parsed, err := mindmap.DecodeProjectMapLayout(layoutPayload)
		if err != nil {
			return fmt.Errorf("parse layout document: %w", err)
		}
		layout = &parsed
	}

	mode := mindmap.ProjectMapMergeStrict
	if *reconcile || strings.TrimSpace(*layoutPath) == "" {
		mode = mindmap.ProjectMapMergeReconcile
	}
	document, err := mindmap.MergeProjectMapDocuments(semantic, layout, mode, time.Now().UTC())
	if err != nil {
		return fmt.Errorf("merge project map documents: %w", err)
	}
	runtimePayload, err := marshalIndentedJSON(document)
	if err != nil {
		return fmt.Errorf("marshal runtime document: %w", err)
	}
	if err := writeOutputSetAtomic([]outputFile{{path: *output, payload: runtimePayload}}, *force); err != nil {
		return err
	}
	fmt.Fprintf(stdout, "imported %s\n", *output)
	return nil
}

type outputFile struct {
	path      string
	payload   []byte
	temp      string
	backup    string
	committed bool
}

var renameStagedOutput = os.Rename

func preflightOutputs(paths []string, force bool) error {
	seen := make(map[string]struct{}, len(paths))
	for _, path := range paths {
		key, err := normalizedPath(path)
		if err != nil {
			return fmt.Errorf("resolve output path %s: %w", path, err)
		}
		if _, exists := seen[key]; exists {
			return fmt.Errorf("duplicate output path %s", path)
		}
		seen[key] = struct{}{}

		info, err := os.Stat(path)
		switch {
		case err == nil && info.IsDir():
			return fmt.Errorf("output path is a directory: %s", path)
		case err == nil && !force:
			return fmt.Errorf("output file already exists: %s (use --force to replace it)", path)
		case err != nil && !errors.Is(err, os.ErrNotExist):
			return fmt.Errorf("inspect output path %s: %w", path, err)
		}
	}
	return nil
}

func writeOutputSetAtomic(outputs []outputFile, force bool) error {
	if err := preflightOutputs(outputPaths(outputs), force); err != nil {
		return err
	}
	for index := range outputs {
		parent := filepath.Dir(outputs[index].path)
		if err := os.MkdirAll(parent, 0o755); err != nil {
			cleanupOutputTemps(outputs)
			return fmt.Errorf("create output directory %s: %w", parent, err)
		}
		temp, err := os.CreateTemp(parent, ".codemind-format-*")
		if err != nil {
			cleanupOutputTemps(outputs)
			return fmt.Errorf("create temporary output for %s: %w", outputs[index].path, err)
		}
		outputs[index].temp = temp.Name()
		if err := temp.Chmod(0o644); err != nil {
			temp.Close()
			cleanupOutputTemps(outputs)
			return fmt.Errorf("set temporary output permissions for %s: %w", outputs[index].path, err)
		}
		if _, err := temp.Write(outputs[index].payload); err != nil {
			temp.Close()
			cleanupOutputTemps(outputs)
			return fmt.Errorf("write temporary output for %s: %w", outputs[index].path, err)
		}
		if err := temp.Sync(); err != nil {
			temp.Close()
			cleanupOutputTemps(outputs)
			return fmt.Errorf("sync temporary output for %s: %w", outputs[index].path, err)
		}
		if err := temp.Close(); err != nil {
			cleanupOutputTemps(outputs)
			return fmt.Errorf("close temporary output for %s: %w", outputs[index].path, err)
		}
	}

	// Preflight again immediately before committing the staged files.
	if err := preflightOutputs(outputPaths(outputs), force); err != nil {
		cleanupOutputTemps(outputs)
		return err
	}
	if force {
		if err := backupExistingOutputs(outputs); err != nil {
			cleanupOutputTemps(outputs)
			return err
		}
	}
	for index := range outputs {
		if err := renameStagedOutput(outputs[index].temp, outputs[index].path); err != nil {
			commitErr := fmt.Errorf("commit output %s: %w", outputs[index].path, err)
			if rollbackErr := rollbackOutputSet(outputs); rollbackErr != nil {
				return errors.Join(commitErr, rollbackErr)
			}
			return commitErr
		}
		outputs[index].temp = ""
		outputs[index].committed = true
	}
	for index := range outputs {
		if outputs[index].backup != "" {
			if err := os.Remove(outputs[index].backup); err != nil && !errors.Is(err, os.ErrNotExist) {
				return fmt.Errorf("remove output backup for %s: %w", outputs[index].path, err)
			}
			outputs[index].backup = ""
		}
	}
	return nil
}

func backupExistingOutputs(outputs []outputFile) error {
	for index := range outputs {
		if _, err := os.Stat(outputs[index].path); errors.Is(err, os.ErrNotExist) {
			continue
		} else if err != nil {
			if rollbackErr := rollbackOutputSet(outputs); rollbackErr != nil {
				return errors.Join(fmt.Errorf("inspect output %s: %w", outputs[index].path, err), rollbackErr)
			}
			return fmt.Errorf("inspect output %s: %w", outputs[index].path, err)
		}

		parent := filepath.Dir(outputs[index].path)
		placeholder, err := os.CreateTemp(parent, ".codemind-backup-*")
		if err != nil {
			if rollbackErr := rollbackOutputSet(outputs); rollbackErr != nil {
				return errors.Join(fmt.Errorf("reserve output backup for %s: %w", outputs[index].path, err), rollbackErr)
			}
			return fmt.Errorf("reserve output backup for %s: %w", outputs[index].path, err)
		}
		backupPath := placeholder.Name()
		if closeErr := placeholder.Close(); closeErr != nil {
			_ = os.Remove(backupPath)
			if rollbackErr := rollbackOutputSet(outputs); rollbackErr != nil {
				return errors.Join(fmt.Errorf("close output backup placeholder for %s: %w", outputs[index].path, closeErr), rollbackErr)
			}
			return fmt.Errorf("close output backup placeholder for %s: %w", outputs[index].path, closeErr)
		}
		if err := os.Remove(backupPath); err != nil {
			if rollbackErr := rollbackOutputSet(outputs); rollbackErr != nil {
				return errors.Join(fmt.Errorf("prepare output backup for %s: %w", outputs[index].path, err), rollbackErr)
			}
			return fmt.Errorf("prepare output backup for %s: %w", outputs[index].path, err)
		}
		if err := os.Rename(outputs[index].path, backupPath); err != nil {
			if rollbackErr := rollbackOutputSet(outputs); rollbackErr != nil {
				return errors.Join(fmt.Errorf("backup output %s: %w", outputs[index].path, err), rollbackErr)
			}
			return fmt.Errorf("backup output %s: %w", outputs[index].path, err)
		}
		outputs[index].backup = backupPath
	}
	return nil
}

func rollbackOutputSet(outputs []outputFile) error {
	rollbackErrors := make([]error, 0)
	for index := range outputs {
		if outputs[index].committed {
			if err := os.Remove(outputs[index].path); err != nil && !errors.Is(err, os.ErrNotExist) {
				rollbackErrors = append(rollbackErrors, fmt.Errorf("remove partial output %s: %w", outputs[index].path, err))
			}
			outputs[index].committed = false
		}
	}
	for index := range outputs {
		if outputs[index].backup == "" {
			continue
		}
		if err := os.Rename(outputs[index].backup, outputs[index].path); err != nil {
			rollbackErrors = append(rollbackErrors, fmt.Errorf("restore output %s: %w", outputs[index].path, err))
			continue
		}
		outputs[index].backup = ""
	}
	cleanupOutputTemps(outputs)
	return errors.Join(rollbackErrors...)
}

func outputPaths(outputs []outputFile) []string {
	paths := make([]string, len(outputs))
	for index := range outputs {
		paths[index] = outputs[index].path
	}
	return paths
}

func cleanupOutputTemps(outputs []outputFile) {
	for _, output := range outputs {
		if output.temp != "" {
			_ = os.Remove(output.temp)
		}
	}
}

func samePath(left, right string) bool {
	leftKey, leftErr := normalizedPath(left)
	rightKey, rightErr := normalizedPath(right)
	if leftErr == nil && rightErr == nil && leftKey == rightKey {
		return true
	}
	leftInfo, leftStatErr := os.Stat(left)
	rightInfo, rightStatErr := os.Stat(right)
	return leftStatErr == nil && rightStatErr == nil && os.SameFile(leftInfo, rightInfo)
}

func normalizedPath(path string) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	cleaned := filepath.Clean(abs)
	if runtime.GOOS == "windows" {
		cleaned = strings.ToLower(cleaned)
	}
	return cleaned, nil
}

func decodeSingleJSON(payload []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("JSON contains multiple values")
		}
		return err
	}
	return nil
}

func marshalIndentedJSON(value any) ([]byte, error) {
	var output bytes.Buffer
	encoder := json.NewEncoder(&output)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(value); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}

func printFormatUsage(output io.Writer) {
	fmt.Fprintln(output, "Code Mind project map format:")
	fmt.Fprintln(output, "  codemind format export --input <runtime.json> --out-dir <dir> [--force]")
	fmt.Fprintln(output, "  codemind format import --semantic <semantic.json> [--layout <layout.json>] --output <runtime.json> [--reconcile] [--force]")
}
