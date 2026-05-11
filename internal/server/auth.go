package server

import (
	"net/http"
	"strings"
)

// APIKeyProvider is implemented by any type that can supply the current API key.
type APIKeyProvider interface {
	GetCollabAPIKey() string
}

// apiKeyMiddleware enforces API key authentication when a non-empty key is configured.
// Requests to /api/health are always allowed through without authentication.
// When the configured key is empty, all requests pass through (backward compatible).
func apiKeyMiddleware(provider APIKeyProvider, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Always allow health check
		if r.URL.Path == "/api/health" {
			next.ServeHTTP(w, r)
			return
		}

		key := provider.GetCollabAPIKey()
		if key == "" {
			// No key configured — allow all requests (backward compatible)
			next.ServeHTTP(w, r)
			return
		}

		// Only enforce auth on /api/maps/ paths
		if strings.HasPrefix(r.URL.Path, "/api/maps") {
			provided := r.Header.Get("X-API-Key")
			if provided != key {
				writeJSON(w, http.StatusUnauthorized, map[string]string{
					"error": "authentication required: invalid or missing API key",
				})
				return
			}
		}

		next.ServeHTTP(w, r)
	})
}
