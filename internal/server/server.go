package server

import (
	"net/http"
	"regexp"
	"sync"
	"time"

	"code-mind/internal/store"
)

const (
	defaultAIBaseURL   = "http://127.0.0.1:1234/v1"
	defaultAIMaxTokens = 4800
	defaultAITimeout   = 45
	defaultRootX       = 820
	defaultRootY       = 320
	defaultBranchGapX  = 280
	defaultBranchGapY  = 100
)

var (
	aiJSONBulletPrefixPattern  = regexp.MustCompile(`(?m)^(\s*)[*•-]\s+`)
	aiJSONTrailingCommaPattern = regexp.MustCompile(`,\s*([}\]])`)
)

type Server struct {
	store            *store.FileStore
	tokenStore       *store.TokenStore
	httpClient       *http.Client
	settingsDir      string
	apiModifications sync.Map // map[string]time.Time — tracks last API modification time per mapId
	commandCache     *commandCache
}

func New(fileStore *store.FileStore, settingsDir string) *Server {
	return &Server{
		store:        fileStore,
		settingsDir:  settingsDir,
		commandCache: newCommandCache(commandCacheMaxEntries, commandCacheTTL),
		httpClient: &http.Client{
			Timeout: time.Duration(defaultAITimeout) * time.Second,
		},
	}
}

// NewWithTokenStore creates a Server with both FileStore and TokenStore for full auth support.
func NewWithTokenStore(fileStore *store.FileStore, settingsDir string, tokenStore *store.TokenStore) *Server {
	return &Server{
		store:        fileStore,
		tokenStore:   tokenStore,
		settingsDir:  settingsDir,
		commandCache: newCommandCache(commandCacheMaxEntries, commandCacheTTL),
		httpClient: &http.Client{
			Timeout: time.Duration(defaultAITimeout) * time.Second,
		},
	}
}

// GetCollabAPIKey implements APIKeyProvider by loading the current key from settings.
func (s *Server) GetCollabAPIKey() string {
	settings, err := store.LoadSettings(s.settingsDir)
	if err != nil {
		return ""
	}
	return settings.CollabAPIKey
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	s.registerAPI(mux)
	mux.HandleFunc("/", s.handleFrontend)
	if s.tokenStore != nil {
		return loggingMiddleware(corsMiddleware(maxBodyMiddleware(tokenAuthMiddleware(s, s.tokenStore, mux))))
	}
	return loggingMiddleware(corsMiddleware(maxBodyMiddleware(apiKeyMiddleware(s, mux))))
}

func (s *Server) APIHandler() http.Handler {
	mux := http.NewServeMux()
	s.registerAPI(mux)
	mux.HandleFunc("/share/", s.handleShareDebugPage)
	if s.tokenStore != nil {
		return loggingMiddleware(corsMiddleware(maxBodyMiddleware(tokenAuthMiddleware(s, s.tokenStore, mux))))
	}
	return loggingMiddleware(corsMiddleware(maxBodyMiddleware(apiKeyMiddleware(s, mux))))
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) registerAPI(mux *http.ServeMux) {
	mux.HandleFunc("/api/health", s.handleHealth)
	mux.HandleFunc("/api/maps", s.handleMaps)
	mux.HandleFunc("/api/maps/", s.handleMapByID)
	mux.HandleFunc("/api/tokens", s.handleTokens)
	mux.HandleFunc("/api/tokens/", s.handleTokenByID)
	mux.HandleFunc("/api/settings", s.handleSettings)
	mux.HandleFunc("/api/export/markdown", s.handleExportMarkdown)
	mux.HandleFunc("/api/import", s.handleImport)
	mux.HandleFunc("/api/ai/test", s.handleAITest)
	mux.HandleFunc("/api/ai/relations", s.handleAIRelations)
	mux.HandleFunc("/api/ai/node-notes", s.handleAINodeNotes)
	mux.HandleFunc("/api/ai/generate", s.handleAIGenerate)
	mux.HandleFunc("/api/ai/import", s.handleAIImport)
	mux.HandleFunc("/api/ai/suggest-children", s.handleAISuggestChildren)
}
