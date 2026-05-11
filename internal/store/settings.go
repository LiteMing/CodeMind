package store

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

// Settings holds application-level configuration persisted to disk.
type Settings struct {
	CollabAPIKey string `json:"collabApiKey"`
}

const settingsFile = "settings.json"

// LoadSettings reads settings from dir/settings.json.
// If the file does not exist, it returns a zero-value Settings without error.
func LoadSettings(dir string) (Settings, error) {
	path := filepath.Join(dir, settingsFile)

	payload, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Settings{}, nil
		}
		return Settings{}, err
	}

	var s Settings
	if err := json.Unmarshal(payload, &s); err != nil {
		return Settings{}, err
	}
	return s, nil
}

// SaveSettings writes settings to dir/settings.json, creating the directory if needed.
func SaveSettings(dir string, s Settings) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	payload, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(filepath.Join(dir, settingsFile), payload, 0o644)
}
