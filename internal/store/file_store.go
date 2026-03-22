package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"code-mind/internal/mindmap"
)

type MapSummary struct {
	ID           string    `json:"id"`
	Title        string    `json:"title"`
	LastEditedAt time.Time `json:"lastEditedAt"`
	LastOpenedAt time.Time `json:"lastOpenedAt"`
}

type FileStore struct {
	dir        string
	legacyPath string
	mu         sync.Mutex
}

func NewFileStore(dir string) *FileStore {
	return &FileStore{
		dir:        dir,
		legacyPath: filepath.Join(filepath.Dir(dir), "default-map.json"),
	}
}

func (s *FileStore) List() ([]MapSummary, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := s.ensureMigratedLocked(); err != nil {
		return nil, err
	}

	return s.listLocked()
}

func (s *FileStore) LoadOrCreate() (mindmap.Document, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := s.ensureMigratedLocked(); err != nil {
		return mindmap.Document{}, err
	}

	summaries, err := s.listLocked()
	if err != nil {
		return mindmap.Document{}, err
	}
	if len(summaries) == 0 {
		doc := mindmap.NewDefaultDocument()
		doc.ID = "default"
		if err := s.saveLocked(doc); err != nil {
			return mindmap.Document{}, err
		}
		return doc, nil
	}

	primaryID := summaries[0].ID
	for _, summary := range summaries {
		if summary.ID == "default" {
			primaryID = summary.ID
			break
		}
	}

	return s.loadLocked(primaryID, true)
}

func (s *FileStore) Load(id string) (mindmap.Document, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := s.ensureMigratedLocked(); err != nil {
		return mindmap.Document{}, err
	}

	return s.loadLocked(id, true)
}

func (s *FileStore) Create(title string) (mindmap.Document, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := s.ensureMigratedLocked(); err != nil {
		return mindmap.Document{}, err
	}

	doc := mindmap.NewDefaultDocument()
	doc.ID = sanitizeID(mindmap.NewID("map"))
	if trimmed := strings.TrimSpace(title); trimmed != "" {
		for index := range doc.Nodes {
			if doc.Nodes[index].Kind == mindmap.NodeKindRoot {
				doc.Nodes[index].Title = trimmed
				doc.Nodes[index].UpdatedAt = time.Now().UTC()
			}
		}
		doc.Title = trimmed
	}

	if err := s.saveLocked(doc); err != nil {
		return mindmap.Document{}, err
	}
	return doc, nil
}

func (s *FileStore) Save(doc mindmap.Document) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := s.ensureMigratedLocked(); err != nil {
		return err
	}

	return s.saveLocked(doc)
}

func (s *FileStore) Rename(id string, title string) (mindmap.Document, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := s.ensureMigratedLocked(); err != nil {
		return mindmap.Document{}, err
	}

	trimmedTitle := strings.TrimSpace(title)
	if trimmedTitle == "" {
		return mindmap.Document{}, errors.New("title is required")
	}

	doc, err := s.loadLocked(id, false)
	if err != nil {
		return mindmap.Document{}, err
	}

	for index := range doc.Nodes {
		if doc.Nodes[index].Kind == mindmap.NodeKindRoot {
			doc.Nodes[index].Title = trimmedTitle
			doc.Nodes[index].UpdatedAt = time.Now().UTC()
		}
	}
	doc.Title = trimmedTitle

	if err := s.saveLocked(doc); err != nil {
		return mindmap.Document{}, err
	}
	return doc, nil
}

func (s *FileStore) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := s.ensureMigratedLocked(); err != nil {
		return err
	}

	docPath := s.documentPath(id)
	if _, err := os.Stat(docPath); err != nil {
		return err
	}
	return os.Remove(docPath)
}

func (s *FileStore) listLocked() ([]MapSummary, error) {
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return nil, err
	}

	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, err
	}

	summaries := make([]MapSummary, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}

		doc, err := s.readDocumentLocked(filepath.Join(s.dir, entry.Name()))
		if err != nil {
			return nil, err
		}

		summaries = append(summaries, MapSummary{
			ID:           doc.ID,
			Title:        doc.Title,
			LastEditedAt: doc.Meta.LastEditedAt,
			LastOpenedAt: doc.Meta.LastOpenedAt,
		})
	}

	slices.SortFunc(summaries, func(left, right MapSummary) int {
		switch {
		case left.LastEditedAt.After(right.LastEditedAt):
			return -1
		case left.LastEditedAt.Before(right.LastEditedAt):
			return 1
		default:
			return strings.Compare(left.Title, right.Title)
		}
	})

	return summaries, nil
}

func (s *FileStore) loadLocked(id string, touchOpened bool) (mindmap.Document, error) {
	docPath := s.documentPath(id)
	doc, err := s.readDocumentLocked(docPath)
	if err != nil {
		return mindmap.Document{}, err
	}

	if touchOpened {
		doc.Meta.LastOpenedAt = time.Now().UTC()
		if err := s.writeLocked(doc); err != nil {
			return mindmap.Document{}, err
		}
	}

	return doc, nil
}

func (s *FileStore) saveLocked(doc mindmap.Document) error {
	if strings.TrimSpace(doc.ID) == "" {
		doc.ID = sanitizeID(mindmap.NewID("map"))
	}
	if err := doc.Validate(); err != nil {
		return err
	}
	return s.writeLocked(doc)
}

func (s *FileStore) ensureMigratedLocked() error {
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return err
	}

	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if !entry.IsDir() && filepath.Ext(entry.Name()) == ".json" {
			return nil
		}
	}

	if _, err := os.Stat(s.legacyPath); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}

	doc, err := s.readDocumentLocked(s.legacyPath)
	if err != nil {
		return err
	}
	if strings.TrimSpace(doc.ID) == "" {
		doc.ID = "default"
	}
	return s.writeLocked(doc)
}

func (s *FileStore) readDocumentLocked(path string) (mindmap.Document, error) {
	payload, err := os.ReadFile(path)
	if err != nil {
		return mindmap.Document{}, err
	}

	var doc mindmap.Document
	if err := json.Unmarshal(payload, &doc); err != nil {
		return mindmap.Document{}, err
	}
	if err := doc.Validate(); err != nil {
		return mindmap.Document{}, fmt.Errorf("invalid document %s: %w", path, err)
	}
	return doc, nil
}

func (s *FileStore) writeLocked(doc mindmap.Document) error {
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return err
	}

	payload, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(s.documentPath(doc.ID), payload, 0o644)
}

func (s *FileStore) documentPath(id string) string {
	return filepath.Join(s.dir, sanitizeID(id)+".json")
}

func sanitizeID(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "map"
	}

	var builder strings.Builder
	builder.Grow(len(trimmed))
	for _, r := range trimmed {
		switch {
		case r >= 'a' && r <= 'z':
			builder.WriteRune(r)
		case r >= 'A' && r <= 'Z':
			builder.WriteRune(r + 32)
		case r >= '0' && r <= '9':
			builder.WriteRune(r)
		case r == '-' || r == '_':
			builder.WriteRune(r)
		default:
			builder.WriteByte('-')
		}
	}

	sanitized := strings.Trim(builder.String(), "-")
	if sanitized == "" {
		return "map"
	}
	return sanitized
}
