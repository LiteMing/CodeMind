package appdata

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
)

const envDataDir = "CODE_MIND_DATA_DIR"

func ResolveDataDir() (string, error) {
	if configured := os.Getenv(envDataDir); configured != "" {
		return configured, nil
	}
	dataDir, err := DefaultDataDir()
	if err != nil {
		return "", err
	}
	legacyDir, err := LegacyDataDirNearExecutable()
	if err == nil && legacyDir != dataDir {
		if err := CopyLegacyDataDirIfNeeded(legacyDir, dataDir); err != nil {
			return "", err
		}
	}
	return dataDir, nil
}

func DefaultDataDir() (string, error) {
	base := os.Getenv("APPDATA")
	if base == "" {
		userConfigDir, err := os.UserConfigDir()
		if err != nil {
			return "", fmt.Errorf("failed to resolve user config dir: %w", err)
		}
		base = userConfigDir
	}
	return filepath.Join(base, "CodeMind", "data"), nil
}

func LegacyDataDirNearExecutable() (string, error) {
	exePath, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("failed to resolve executable path: %w", err)
	}
	return filepath.Join(filepath.Dir(exePath), "data"), nil
}

func CopyLegacyDataDirIfNeeded(srcDir string, dstDir string) error {
	if !hasEntries(srcDir) || hasEntries(dstDir) {
		return nil
	}
	return copyDir(srcDir, dstDir)
}

func hasEntries(dir string) bool {
	entries, err := os.ReadDir(dir)
	return err == nil && len(entries) > 0
}

func copyDir(srcDir string, dstDir string) error {
	return filepath.WalkDir(srcDir, func(srcPath string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relPath, err := filepath.Rel(srcDir, srcPath)
		if err != nil {
			return err
		}
		dstPath := filepath.Join(dstDir, relPath)
		if entry.IsDir() {
			return os.MkdirAll(dstPath, 0o755)
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		return copyFile(srcPath, dstPath, info.Mode())
	})
}

func copyFile(srcPath string, dstPath string, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(dstPath), 0o755); err != nil {
		return err
	}
	src, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer src.Close()
	dst, err := os.OpenFile(dstPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	defer dst.Close()
	_, err = io.Copy(dst, src)
	return err
}
