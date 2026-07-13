package server

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"code-mind/internal/agentcontract"
)

const (
	commandCacheMaxEntries = 256
	commandCacheTTL        = 15 * time.Minute
	maxIdempotencyKeyBytes = 128
)

type commandContextKey struct{}

type cachedCommandResponse struct {
	status int
	header http.Header
	body   []byte
}

type commandCacheEntry struct {
	fingerprint string
	done        chan struct{}
	response    *cachedCommandResponse
	completedAt time.Time
}

type commandCache struct {
	mu      sync.Mutex
	entries map[string]*commandCacheEntry
	max     int
	ttl     time.Duration
}

func newCommandCache(maxEntries int, ttl time.Duration) *commandCache {
	return &commandCache{
		entries: make(map[string]*commandCacheEntry),
		max:     maxEntries,
		ttl:     ttl,
	}
}

type captureResponseWriter struct {
	header http.Header
	body   bytes.Buffer
	status int
}

func newCaptureResponseWriter() *captureResponseWriter {
	return &captureResponseWriter{header: make(http.Header)}
}

func (writer *captureResponseWriter) Header() http.Header {
	return writer.header
}

func (writer *captureResponseWriter) WriteHeader(status int) {
	if writer.status == 0 {
		writer.status = status
	}
}

func (writer *captureResponseWriter) Write(payload []byte) (int, error) {
	if writer.status == 0 {
		writer.status = http.StatusOK
	}
	return writer.body.Write(payload)
}

func commandEnvelopeFromContext(ctx context.Context) (agentcontract.CommandEnvelope, bool) {
	envelope, ok := ctx.Value(commandContextKey{}).(agentcontract.CommandEnvelope)
	return envelope, ok
}

func isAgentCommandRequest(r *http.Request) bool {
	path := strings.TrimSuffix(r.URL.Path, "/")
	switch r.Method {
	case http.MethodPost:
		return strings.HasSuffix(path, "/nodes") ||
			strings.HasSuffix(path, "/batch") ||
			strings.HasSuffix(path, "/import-fragment")
	case http.MethodPatch, http.MethodDelete:
		return strings.Contains(path, "/nodes/")
	default:
		return false
	}
}

func (s *Server) handleAgentCommand(
	w http.ResponseWriter,
	r *http.Request,
	mapID string,
	operation string,
	target string,
	next http.HandlerFunc,
) {
	envelope, ok := requireCommandEnvelope(w, r)
	if !ok {
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	r.Body = io.NopCloser(bytes.NewReader(body))

	fingerprintTarget := target
	if r.URL.RawQuery != "" {
		fingerprintTarget += "?" + r.URL.Query().Encode()
	}
	fingerprint := commandFingerprint(operation, fingerprintTarget, envelope, canonicalCommandPayload(body))
	scope := envelope.Actor.ID + "\x00" + mapID + "\x00" + envelope.IdempotencyKey
	entry, execute, conflict, full := s.commandCache.acquire(scope, fingerprint, time.Now())
	if full {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "idempotency command cache is busy",
			"code":  "idempotency_cache_busy",
		})
		return
	}
	if conflict {
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":          "idempotency key reused with a different command",
			"code":           "idempotency_key_reused",
			"idempotencyKey": envelope.IdempotencyKey,
		})
		return
	}
	if !execute {
		select {
		case <-entry.done:
			if entry.response == nil {
				// Failed executions are not cached; a waiter may make a fresh attempt.
				s.handleAgentCommand(w, r, mapID, operation, target, next)
				return
			}
			writeCachedCommandResponse(w, entry.response, true)
		case <-r.Context().Done():
			writeError(w, http.StatusRequestTimeout, r.Context().Err())
		}
		return
	}

	capture := newCaptureResponseWriter()
	ctx := context.WithValue(r.Context(), commandContextKey{}, envelope)
	next(capture, r.WithContext(ctx))
	response := &cachedCommandResponse{
		status: capture.status,
		header: capture.header.Clone(),
		body:   append([]byte(nil), capture.body.Bytes()...),
	}
	if response.status == 0 {
		response.status = http.StatusOK
	}

	s.commandCache.complete(scope, entry, response, response.status >= 200 && response.status < 300, time.Now())
	writeCachedCommandResponse(w, response, false)
}

func requireCommandEnvelope(w http.ResponseWriter, r *http.Request) (agentcontract.CommandEnvelope, bool) {
	expectedRevision, err := parseExpectedRevision(r)
	if err != nil {
		status := http.StatusBadRequest
		if strings.TrimSpace(r.Header.Get("If-Match")) == "" {
			status = http.StatusPreconditionRequired
		}
		writeError(w, status, err)
		return agentcontract.CommandEnvelope{}, false
	}

	actor := GetActor(r)
	if strings.TrimSpace(actor.ID) == "" || !actor.Kind.Valid() {
		writeJSON(w, http.StatusUnauthorized, map[string]string{
			"error": "authenticated actor is invalid",
			"code":  "invalid_actor",
		})
		return agentcontract.CommandEnvelope{}, false
	}

	partition := agentcontract.Partition(strings.TrimSpace(r.Header.Get("X-CodeMind-Partition")))
	if partition == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "X-CodeMind-Partition header is required",
			"code":  "partition_required",
		})
		return agentcontract.CommandEnvelope{}, false
	}
	if !partition.Valid() {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "partition must be requirements, development, or stable",
			"code":  "invalid_partition",
		})
		return agentcontract.CommandEnvelope{}, false
	}
	if partition == agentcontract.PartitionStable {
		writeJSON(w, http.StatusForbidden, map[string]string{
			"error": "stable partition is read-only",
			"code":  "stable_partition_read_only",
		})
		return agentcontract.CommandEnvelope{}, false
	}

	idempotencyKey := r.Header.Get("Idempotency-Key")
	if err := validateIdempotencyKey(idempotencyKey); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": err.Error(),
			"code":  "invalid_idempotency_key",
		})
		return agentcontract.CommandEnvelope{}, false
	}

	return agentcontract.CommandEnvelope{
		Actor:            actor,
		Partition:        partition,
		IdempotencyKey:   idempotencyKey,
		ExpectedRevision: expectedRevision,
	}, true
}

func validateIdempotencyKey(key string) error {
	if key == "" {
		return errors.New("Idempotency-Key header is required")
	}
	if len(key) > maxIdempotencyKeyBytes {
		return errors.New("Idempotency-Key must be at most 128 bytes")
	}
	for _, char := range []byte(key) {
		if char < 0x21 || char > 0x7e {
			return errors.New("Idempotency-Key must contain visible ASCII characters without spaces")
		}
	}
	return nil
}

func canonicalCommandPayload(payload []byte) []byte {
	trimmed := bytes.TrimSpace(payload)
	if len(trimmed) == 0 {
		return []byte("null")
	}
	var value any
	decoder := json.NewDecoder(bytes.NewReader(trimmed))
	decoder.UseNumber()
	if err := decoder.Decode(&value); err != nil {
		return trimmed
	}
	canonical, err := json.Marshal(value)
	if err != nil {
		return trimmed
	}
	return canonical
}

func commandFingerprint(
	operation string,
	target string,
	envelope agentcontract.CommandEnvelope,
	payload []byte,
) string {
	hash := sha256.New()
	for _, part := range []string{
		operation,
		target,
		string(envelope.Partition),
		revisionETag(envelope.ExpectedRevision),
	} {
		_, _ = hash.Write([]byte(part))
		_, _ = hash.Write([]byte{0})
	}
	_, _ = hash.Write(payload)
	return hex.EncodeToString(hash.Sum(nil))
}

func (cache *commandCache) acquire(
	scope string,
	fingerprint string,
	now time.Time,
) (entry *commandCacheEntry, execute bool, conflict bool, full bool) {
	cache.mu.Lock()
	defer cache.mu.Unlock()

	cache.removeExpiredLocked(now)
	if existing, ok := cache.entries[scope]; ok {
		if existing.fingerprint != fingerprint {
			return existing, false, true, false
		}
		return existing, false, false, false
	}
	if len(cache.entries) >= cache.max {
		cache.evictOldestCompletedLocked()
	}
	if len(cache.entries) >= cache.max {
		return nil, false, false, true
	}
	entry = &commandCacheEntry{fingerprint: fingerprint, done: make(chan struct{})}
	cache.entries[scope] = entry
	return entry, true, false, false
}

func (cache *commandCache) complete(
	scope string,
	entry *commandCacheEntry,
	response *cachedCommandResponse,
	success bool,
	now time.Time,
) {
	cache.mu.Lock()
	defer cache.mu.Unlock()
	current, ok := cache.entries[scope]
	if !ok || current != entry {
		return
	}
	if success {
		entry.response = response
		entry.completedAt = now
	} else {
		delete(cache.entries, scope)
	}
	close(entry.done)
}

func (cache *commandCache) removeExpiredLocked(now time.Time) {
	for scope, entry := range cache.entries {
		if entry.response != nil && now.Sub(entry.completedAt) >= cache.ttl {
			delete(cache.entries, scope)
		}
	}
}

func (cache *commandCache) evictOldestCompletedLocked() {
	var oldestScope string
	var oldestTime time.Time
	for scope, entry := range cache.entries {
		if entry.response == nil {
			continue
		}
		if oldestScope == "" || entry.completedAt.Before(oldestTime) {
			oldestScope = scope
			oldestTime = entry.completedAt
		}
	}
	if oldestScope != "" {
		delete(cache.entries, oldestScope)
	}
}

func writeCachedCommandResponse(w http.ResponseWriter, response *cachedCommandResponse, replay bool) {
	for key, values := range response.header {
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	if replay {
		w.Header().Set("X-CodeMind-Idempotent-Replay", "true")
	}
	w.WriteHeader(response.status)
	_, _ = w.Write(response.body)
}
