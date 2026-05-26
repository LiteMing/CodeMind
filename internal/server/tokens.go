package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

// createTokenRequest is the request body for POST /api/tokens.
type createTokenRequest struct {
	MapID       string  `json:"mapId"`
	AccessLevel string  `json:"accessLevel"`
	DisplayName string  `json:"displayName"`
	ExpiresIn   *string `json:"expiresIn,omitempty"` // duration string, e.g. "24h", "720h"
}

// tokenResponse is the response for token operations (hides internal fields).
type tokenResponse struct {
	ID          string     `json:"id"`
	MapID       string     `json:"mapId"`
	AccessLevel string     `json:"accessLevel"`
	Secret      string     `json:"secret,omitempty"` // only returned on create
	DisplayName string     `json:"displayName"`
	ExpiresAt   *time.Time `json:"expiresAt,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
	Revoked     bool       `json:"revoked"`
}

// handleTokens handles GET /api/tokens?mapId={mapId} and POST /api/tokens.
func (s *Server) handleTokens(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.handleTokensList(w, r)
	case http.MethodPost:
		s.handleTokensCreate(w, r)
	default:
		w.Header().Set("Allow", "GET, POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleTokensList lists tokens for a map (owner only).
func (s *Server) handleTokensList(w http.ResponseWriter, r *http.Request) {
	// Enforce owner-only access
	if GetAccessLevel(r) != AccessOwner {
		writeJSON(w, http.StatusForbidden, map[string]string{
			"error": "only the owner can list tokens",
		})
		return
	}

	mapID := r.URL.Query().Get("mapId")
	if mapID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "mapId query parameter is required",
		})
		return
	}

	if s.tokenStore == nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"error": "token store not available",
		})
		return
	}

	tokens := s.tokenStore.ListByMap(mapID)

	// Convert to response format (without secrets)
	result := make([]tokenResponse, 0, len(tokens))
	for _, t := range tokens {
		result = append(result, tokenResponse{
			ID:          t.ID,
			MapID:       t.MapID,
			AccessLevel: t.AccessLevel,
			DisplayName: t.DisplayName,
			ExpiresAt:   t.ExpiresAt,
			CreatedAt:   t.CreatedAt,
			Revoked:     t.Revoked,
		})
	}

	writeJSON(w, http.StatusOK, result)
}

// handleTokensCreate creates a new token (owner only).
func (s *Server) handleTokensCreate(w http.ResponseWriter, r *http.Request) {
	// Enforce owner-only access
	if GetAccessLevel(r) != AccessOwner {
		writeJSON(w, http.StatusForbidden, map[string]string{
			"error": "only the owner can create tokens",
		})
		return
	}

	if s.tokenStore == nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"error": "token store not available",
		})
		return
	}

	var req createTokenRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "invalid request body",
		})
		return
	}

	// Validate required fields
	if strings.TrimSpace(req.MapID) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "mapId is required",
		})
		return
	}
	if strings.TrimSpace(req.AccessLevel) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "accessLevel is required",
		})
		return
	}

	// Parse optional expiration duration
	var expiration *time.Duration
	if req.ExpiresIn != nil && strings.TrimSpace(*req.ExpiresIn) != "" {
		d, err := time.ParseDuration(*req.ExpiresIn)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{
				"error": "invalid expiresIn duration: " + err.Error(),
			})
			return
		}
		expiration = &d
	}

	token, err := s.tokenStore.Create(req.MapID, req.AccessLevel, req.DisplayName, expiration)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": err.Error(),
		})
		return
	}

	// Return full token including secret (only time secret is exposed)
	writeJSON(w, http.StatusCreated, tokenResponse{
		ID:          token.ID,
		MapID:       token.MapID,
		AccessLevel: token.AccessLevel,
		Secret:      token.Secret,
		DisplayName: token.DisplayName,
		ExpiresAt:   token.ExpiresAt,
		CreatedAt:   token.CreatedAt,
		Revoked:     token.Revoked,
	})
}

// handleTokenByID handles DELETE /api/tokens/{id} — revoke a token (owner only).
func (s *Server) handleTokenByID(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		w.Header().Set("Allow", "DELETE")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Enforce owner-only access
	if GetAccessLevel(r) != AccessOwner {
		writeJSON(w, http.StatusForbidden, map[string]string{
			"error": "only the owner can revoke tokens",
		})
		return
	}

	if s.tokenStore == nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"error": "token store not available",
		})
		return
	}

	// Extract token ID from path: /api/tokens/{id}
	tokenID := strings.TrimPrefix(r.URL.Path, "/api/tokens/")
	tokenID = strings.TrimSpace(tokenID)
	if tokenID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "token id is required",
		})
		return
	}

	if err := s.tokenStore.Revoke(tokenID); err != nil {
		if errors.Is(err, errors.New("")) {
			writeJSON(w, http.StatusNotFound, map[string]string{
				"error": err.Error(),
			})
			return
		}
		// Token not found errors from Revoke contain "token not found"
		if strings.Contains(err.Error(), "not found") {
			writeJSON(w, http.StatusNotFound, map[string]string{
				"error": err.Error(),
			})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"error": err.Error(),
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"status": "revoked",
	})
}
