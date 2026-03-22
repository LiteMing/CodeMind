package store

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"

	"code-mind/internal/mindmap"
)

type FileStore struct {
	path string
	mu   sync.Mutex
}

func NewFileStore(path string) *FileStore {
	return &FileStore{path: path}
}

func (s *FileStore) LoadOrCreate() (mindmap.Document, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, err := os.Stat(s.path); errors.Is(err, os.ErrNotExist) {
		doc := mindmap.NewDefaultDocument()
		if err := s.write(doc); err != nil {
			return mindmap.Document{}, err
		}
		return doc, nil
	}

	payload, err := os.ReadFile(s.path)
	if err != nil {
		return mindmap.Document{}, err
	}

	var doc mindmap.Document
	if err := json.Unmarshal(payload, &doc); err != nil {
		return mindmap.Document{}, err
	}
	if err := doc.Validate(); err != nil {
		return mindmap.Document{}, err
	}

	return doc, nil
}

func (s *FileStore) Save(doc mindmap.Document) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := doc.Validate(); err != nil {
		return err
	}
	return s.write(doc)
}

func (s *FileStore) write(doc mindmap.Document) error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}

	payload, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(s.path, payload, 0o644)
}
