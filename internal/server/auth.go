package server

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"code-mind/internal/agentcontract"
	"code-mind/internal/store"
)

// AccessLevel represents the permission level of an authenticated request.
type AccessLevel string

const (
	AccessOwner  AccessLevel = "owner"
	AccessEditor AccessLevel = "editor"
	AccessViewer AccessLevel = "viewer"
)

// contextKey is an unexported type for context keys in this package.
type contextKey string

const (
	accessLevelKey contextKey = "accessLevel"
	actorKey       contextKey = "actor"
)

var localOwnerActor = agentcontract.ActorRef{
	ID:    "local-owner",
	Kind:  agentcontract.ActorHuman,
	Label: "Local owner",
}

// APIKeyProvider is implemented by any type that can supply the current API key.
type APIKeyProvider interface {
	GetCollabAPIKey() string
}

// GetAccessLevel retrieves the access level from the request context.
// Returns AccessOwner if not set (should not happen if middleware is applied).
func GetAccessLevel(r *http.Request) AccessLevel {
	if level, ok := r.Context().Value(accessLevelKey).(AccessLevel); ok {
		return level
	}
	return AccessOwner
}

// GetActor returns the server-derived actor for a request. Local and API-key
// owner requests deliberately share one stable identity.
func GetActor(r *http.Request) agentcontract.ActorRef {
	if actor, ok := r.Context().Value(actorKey).(agentcontract.ActorRef); ok {
		return actor
	}
	return localOwnerActor
}

// tokenAuthMiddleware checks X-API-Key header first (owner level), then Bearer token
// or query param token. Enforces access levels and maintains backward compatibility.
func tokenAuthMiddleware(provider APIKeyProvider, tokenStore *store.TokenStore, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Always allow health check without auth
		if r.URL.Path == "/api/health" {
			ctx := context.WithValue(r.Context(), accessLevelKey, AccessOwner)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}
		if strings.HasPrefix(r.URL.Path, "/share/") {
			ctx := context.WithValue(r.Context(), accessLevelKey, AccessOwner)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}
		if !strings.HasPrefix(r.URL.Path, "/api/") {
			ctx := context.WithValue(r.Context(), accessLevelKey, AccessOwner)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}

		apiKey := provider.GetCollabAPIKey()

		if r.URL.Path == "/api/settings" {
			if settingsAccessAllowed(apiKey, r) {
				ctx := context.WithValue(r.Context(), accessLevelKey, AccessOwner)
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}
			writeJSON(w, http.StatusUnauthorized, map[string]string{
				"error": "authentication required",
			})
			return
		}

		// 1. Check X-API-Key header (existing mechanism → owner level)
		if apiKey != "" && requestHasAPIKey(r, apiKey) {
			ctx := context.WithValue(r.Context(), accessLevelKey, AccessOwner)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}

		// 2. Check Authorization: Bearer {token} or ?token= query param
		tokenSecret := extractToken(r)

		if tokenSecret == "" {
			if apiKey != "" {
				// API key is configured but neither valid API key nor token provided
				// Check if X-API-Key was provided but invalid
				if r.Header.Get("X-API-Key") != "" {
					writeJSON(w, http.StatusUnauthorized, map[string]string{
						"error": "authentication required: invalid or missing API key",
					})
					return
				}
				// No credentials at all
				writeJSON(w, http.StatusUnauthorized, map[string]string{
					"error": "authentication required",
				})
				return
			}
			// No auth configured — allow as owner (backward compatible)
			ctx := context.WithValue(r.Context(), accessLevelKey, AccessOwner)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}

		// Validate the token via TokenStore
		if tokenStore == nil {
			// TokenStore not available — if API key is configured, reject
			if apiKey != "" {
				writeJSON(w, http.StatusUnauthorized, map[string]string{
					"error": "authentication required",
				})
				return
			}
			// No auth configured — allow as owner
			ctx := context.WithValue(r.Context(), accessLevelKey, AccessOwner)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}

		token, err := tokenStore.Validate(tokenSecret)
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{
				"error": err.Error(),
			})
			return
		}
		if err := enforceTokenMapScope(r, token); err != nil {
			writeJSON(w, http.StatusForbidden, map[string]string{
				"error": err.Error(),
			})
			return
		}

		// 3. Enforce access level for write operations
		if isWriteOperation(r) && token.AccessLevel == "viewer" {
			writeJSON(w, http.StatusForbidden, map[string]string{
				"error": "insufficient access level",
			})
			return
		}

		label := strings.TrimSpace(token.DisplayName)
		if label == "" {
			label = token.ID
		}
		actor := agentcontract.ActorRef{ID: token.ID, Kind: token.ActorKind, Label: label}
		ctx := context.WithValue(r.Context(), accessLevelKey, AccessLevel(token.AccessLevel))
		ctx = context.WithValue(ctx, actorKey, actor)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// apiKeyMiddleware is the legacy middleware that only checks X-API-Key.
// Kept for backward compatibility with existing Handler() method.
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

		if r.URL.Path == "/api/settings" {
			if !settingsAccessAllowed(key, r) {
				writeJSON(w, http.StatusUnauthorized, map[string]string{
					"error": "authentication required: invalid or missing API key",
				})
				return
			}
			next.ServeHTTP(w, r)
			return
		}

		// Only enforce auth on protected API paths.
		if isLegacyProtectedAPIPath(r.URL.Path) && !requestHasAPIKey(r, key) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{
				"error": "authentication required: invalid or missing API key",
			})
			return
		}

		next.ServeHTTP(w, r)
	})
}

func isLegacyProtectedAPIPath(path string) bool {
	return strings.HasPrefix(path, "/api/maps") || strings.HasPrefix(path, "/api/tokens")
}

func settingsAccessAllowed(apiKey string, r *http.Request) bool {
	if apiKey == "" {
		return true
	}
	if requestHasAPIKey(r, apiKey) {
		return true
	}
	return isTrustedBrowserOrigin(r.Header.Get("Origin"))
}

func requestHasAPIKey(r *http.Request, apiKey string) bool {
	if apiKey == "" {
		return false
	}
	if r.Header.Get("X-API-Key") == apiKey {
		return true
	}
	if cookie, err := r.Cookie("codemind_api_key"); err == nil && cookieAPIKey(cookie.Value) == apiKey {
		return true
	}
	return false
}

func enforceTokenMapScope(r *http.Request, token *store.Token) error {
	if token == nil || token.AccessLevel == string(AccessOwner) {
		return nil
	}
	if r.URL.Path == "/api/maps" || r.URL.Path == "/api/maps/" {
		return errors.New("token cannot list all maps")
	}
	mapID, ok := requestMapID(r.URL.Path)
	if !ok {
		return nil
	}
	if token.MapID != mapID {
		return errors.New("token does not grant access to this map")
	}
	return nil
}

func requestMapID(path string) (string, bool) {
	if !strings.HasPrefix(path, "/api/maps/") {
		return "", false
	}
	suffix := strings.TrimSpace(strings.TrimPrefix(path, "/api/maps/"))
	if suffix == "" {
		return "", false
	}
	if index := strings.Index(suffix, "/"); index >= 0 {
		suffix = suffix[:index]
	}
	return suffix, suffix != ""
}

func cookieAPIKey(value string) string {
	decoded, err := url.QueryUnescape(value)
	if err != nil {
		return value
	}
	return decoded
}

// extractToken extracts a token secret from the request.
// It checks the Authorization header (Bearer scheme) first, then the ?token= query param.
func extractToken(r *http.Request) string {
	// Check Authorization: Bearer {token}
	authHeader := r.Header.Get("Authorization")
	if authHeader != "" {
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
			token := strings.TrimSpace(parts[1])
			if token != "" {
				return token
			}
		}
	}

	// Check ?token= query parameter
	if token := r.URL.Query().Get("token"); token != "" {
		return token
	}

	return ""
}

// isWriteOperation returns true if the HTTP request is a write operation
// (anything other than GET, HEAD, OPTIONS).
func isWriteOperation(r *http.Request) bool {
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return false
	default:
		return true
	}
}
