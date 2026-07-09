package server

import (
	"encoding/json"
	"net/http"

	"code-mind/internal/store"
)

func (s *Server) handleSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		settings, err := store.LoadSettings(s.settingsDir)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, settings)
	case http.MethodPut:
		var settings store.Settings
		if err := json.NewDecoder(r.Body).Decode(&settings); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if err := store.SaveSettings(s.settingsDir, settings); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		setAPIKeyCookie(w, settings.CollabAPIKey)
		writeJSON(w, http.StatusOK, settings)
	default:
		w.Header().Set("Allow", "GET, PUT")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// Placeholder handlers for node-level CRUD (to be implemented in later tasks)
