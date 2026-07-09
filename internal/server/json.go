package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
)

func writeJSON(w http.ResponseWriter, statusCode int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, statusCode int, err error) {
	writeJSON(w, statusCode, map[string]string{
		"error": err.Error(),
	})
}

func writeAIError(w http.ResponseWriter, statusCode int, err error) {
	var debugErr *aiDebugError
	if errors.As(err, &debugErr) {
		writeJSON(w, statusCode, map[string]any{
			"error": debugErr.Error(),
			"debug": debugErr.Debug,
		})
		return
	}

	writeError(w, statusCode, err)
}

func setAPIKeyCookie(w http.ResponseWriter, apiKey string) {
	cookie := &http.Cookie{
		Name:     "codemind_api_key",
		Value:    url.QueryEscape(apiKey),
		Path:     "/",
		SameSite: http.SameSiteLaxMode,
		HttpOnly: true,
		MaxAge:   365 * 24 * 60 * 60,
	}
	if strings.TrimSpace(apiKey) == "" {
		cookie.Value = ""
		cookie.MaxAge = -1
	}
	http.SetCookie(w, cookie)
}
