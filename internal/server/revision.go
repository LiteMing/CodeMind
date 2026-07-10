package server

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"

	"code-mind/internal/store"
)

func revisionETag(revision uint64) string {
	return fmt.Sprintf(`"rev-%d"`, revision)
}

func setRevisionETag(w http.ResponseWriter, revision uint64) {
	w.Header().Set("ETag", revisionETag(revision))
}

func requireExpectedRevision(w http.ResponseWriter, r *http.Request) (uint64, bool) {
	if envelope, ok := commandEnvelopeFromContext(r.Context()); ok {
		return envelope.ExpectedRevision, true
	}
	revision, err := parseExpectedRevision(r)
	if err != nil {
		status := http.StatusBadRequest
		if strings.TrimSpace(r.Header.Get("If-Match")) == "" {
			status = http.StatusPreconditionRequired
		}
		writeError(w, status, err)
		return 0, false
	}
	return revision, true
}

func parseExpectedRevision(r *http.Request) (uint64, error) {
	raw := strings.TrimSpace(r.Header.Get("If-Match"))
	if raw == "" {
		return 0, errors.New("If-Match header is required")
	}

	if len(raw) < 2 || raw[0] != '"' || raw[len(raw)-1] != '"' {
		return 0, errors.New(`If-Match must use a quoted ETag such as "rev-1"`)
	}
	value := raw[1 : len(raw)-1]
	if !strings.HasPrefix(value, "rev-") {
		return 0, errors.New(`If-Match must use the format "rev-{revision}"`)
	}
	revision, err := strconv.ParseUint(strings.TrimPrefix(value, "rev-"), 10, 64)
	if err != nil || revision == 0 {
		return 0, errors.New(`If-Match must contain a positive revision`)
	}
	return revision, nil
}

func writeMapStoreError(w http.ResponseWriter, fallbackStatus int, err error) {
	var conflict *store.RevisionConflictError
	if errors.As(err, &conflict) {
		setRevisionETag(w, conflict.Actual)
		writeJSON(w, http.StatusPreconditionFailed, map[string]any{
			"error":            "revision conflict",
			"expectedRevision": conflict.Expected,
			"actualRevision":   conflict.Actual,
		})
		return
	}
	if errors.Is(err, os.ErrNotExist) {
		writeError(w, http.StatusNotFound, err)
		return
	}
	writeError(w, fallbackStatus, err)
}
