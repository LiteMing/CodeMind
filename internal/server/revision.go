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
	raw := strings.TrimSpace(r.Header.Get("If-Match"))
	if raw == "" {
		writeError(w, http.StatusPreconditionRequired, errors.New("If-Match header is required"))
		return 0, false
	}

	if len(raw) < 2 || raw[0] != '"' || raw[len(raw)-1] != '"' {
		writeError(w, http.StatusBadRequest, errors.New(`If-Match must use a quoted ETag such as "rev-1"`))
		return 0, false
	}
	value := raw[1 : len(raw)-1]
	if !strings.HasPrefix(value, "rev-") {
		writeError(w, http.StatusBadRequest, errors.New(`If-Match must use the format "rev-{revision}"`))
		return 0, false
	}
	revision, err := strconv.ParseUint(strings.TrimPrefix(value, "rev-"), 10, 64)
	if err != nil || revision == 0 {
		writeError(w, http.StatusBadRequest, errors.New(`If-Match must contain a positive revision`))
		return 0, false
	}
	return revision, true
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
