package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"code-mind/internal/agentcontract"
	"code-mind/internal/store"
)

func TestAgentCommandHeadersAreRequiredAndStableIsReadOnly(t *testing.T) {
	server := newTestServer(t)
	doc, err := server.store.Create("Commands")
	if err != nil {
		t.Fatal(err)
	}
	handler := server.Handler()
	path := "/api/maps/" + doc.ID + "/nodes"
	body := `{"parentId":"root","title":"Child"}`

	tests := []struct {
		name      string
		partition string
		key       string
		status    int
		code      string
	}{
		{name: "missing partition", key: "command-1", status: http.StatusBadRequest, code: "partition_required"},
		{name: "missing idempotency key", partition: "development", status: http.StatusBadRequest, code: "invalid_idempotency_key"},
		{name: "invalid partition", partition: "unknown", key: "command-2", status: http.StatusBadRequest, code: "invalid_partition"},
		{name: "stable is read only", partition: "stable", key: "command-3", status: http.StatusForbidden, code: "stable_partition_read_only"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
			req.Header.Set("If-Match", revisionETag(doc.Meta.Revision))
			if test.partition != "" {
				req.Header.Set("X-CodeMind-Partition", test.partition)
			}
			if test.key != "" {
				req.Header.Set("Idempotency-Key", test.key)
			}
			res := httptest.NewRecorder()
			handler.ServeHTTP(res, req)
			if res.Code != test.status {
				t.Fatalf("expected %d, got %d: %s", test.status, res.Code, res.Body.String())
			}
			var payload struct {
				Code string `json:"code"`
			}
			if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
				t.Fatal(err)
			}
			if payload.Code != test.code {
				t.Fatalf("expected code %q, got %q", test.code, payload.Code)
			}
		})
	}
}

func TestAgentCommandIdempotentReplayPrecedesRevisionConflict(t *testing.T) {
	server := newTestServer(t)
	doc, err := server.store.Create("Replay")
	if err != nil {
		t.Fatal(err)
	}
	handler := server.Handler()
	path := "/api/maps/" + doc.ID + "/nodes"

	first := executeAgentCommand(t, handler, http.MethodPost, path, `{"parentId":"root","title":"Child","note":"same"}`, 1, "replay-1")
	if first.Code != http.StatusCreated {
		t.Fatalf("first write failed: %d %s", first.Code, first.Body.String())
	}
	second := executeAgentCommand(t, handler, http.MethodPost, path, `{"note":"same","title":"Child","parentId":"root"}`, 1, "replay-1")
	if second.Code != http.StatusCreated {
		t.Fatalf("replay failed: %d %s", second.Code, second.Body.String())
	}
	if second.Header().Get("X-CodeMind-Idempotent-Replay") != "true" {
		t.Fatal("expected replay response header")
	}
	if !bytes.Equal(first.Body.Bytes(), second.Body.Bytes()) {
		t.Fatalf("replay body changed:\nfirst=%s\nsecond=%s", first.Body.String(), second.Body.String())
	}

	persisted, err := server.store.LoadReadOnly(doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if persisted.Meta.Revision != 2 || len(persisted.Nodes) != 2 {
		t.Fatalf("replay wrote twice: revision=%d nodes=%d", persisted.Meta.Revision, len(persisted.Nodes))
	}
}

func TestAgentCommandRejectsIdempotencyKeyReuseWithDifferentFingerprint(t *testing.T) {
	server := newTestServer(t)
	doc, err := server.store.Create("Reuse")
	if err != nil {
		t.Fatal(err)
	}
	handler := server.Handler()
	path := "/api/maps/" + doc.ID + "/nodes"

	first := executeAgentCommand(t, handler, http.MethodPost, path, `{"parentId":"root","title":"First"}`, 1, "reuse-1")
	if first.Code != http.StatusCreated {
		t.Fatalf("first write failed: %d %s", first.Code, first.Body.String())
	}
	second := executeAgentCommand(t, handler, http.MethodPost, path, `{"parentId":"root","title":"Second"}`, 1, "reuse-1")
	if second.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", second.Code, second.Body.String())
	}
	var payload struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(second.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Code != "idempotency_key_reused" {
		t.Fatalf("unexpected code %q", payload.Code)
	}
}

func TestAgentCommandFingerprintIncludesDeleteQuery(t *testing.T) {
	server := newTestServer(t)
	doc, err := server.store.Create("Delete query")
	if err != nil {
		t.Fatal(err)
	}
	handler := server.Handler()
	created := executeAgentCommand(
		t,
		handler,
		http.MethodPost,
		"/api/maps/"+doc.ID+"/nodes",
		`{"parentId":"root","title":"Child"}`,
		1,
		"create-delete-target",
	)
	if created.Code != http.StatusCreated {
		t.Fatalf("create failed: %d %s", created.Code, created.Body.String())
	}
	var node struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &node); err != nil {
		t.Fatal(err)
	}

	path := "/api/maps/" + doc.ID + "/nodes/" + node.ID
	first := executeAgentCommand(t, handler, http.MethodDelete, path+"?cascade=true", ``, 2, "delete-query-1")
	if first.Code != http.StatusOK {
		t.Fatalf("delete failed: %d %s", first.Code, first.Body.String())
	}
	second := executeAgentCommand(t, handler, http.MethodDelete, path+"?cascade=false", ``, 2, "delete-query-1")
	if second.Code != http.StatusConflict {
		t.Fatalf("query change should reuse-conflict, got %d: %s", second.Code, second.Body.String())
	}
}

func TestAgentCommandConcurrentReplayExecutesOnce(t *testing.T) {
	server := newTestServer(t)
	doc, err := server.store.Create("Concurrent")
	if err != nil {
		t.Fatal(err)
	}
	handler := server.Handler()
	path := "/api/maps/" + doc.ID + "/nodes"
	const workers = 8

	start := make(chan struct{})
	responses := make([]*httptest.ResponseRecorder, workers)
	var wait sync.WaitGroup
	wait.Add(workers)
	for index := 0; index < workers; index++ {
		go func(index int) {
			defer wait.Done()
			<-start
			responses[index] = executeAgentCommand(t, handler, http.MethodPost, path, `{"parentId":"root","title":"Concurrent child"}`, 1, "concurrent-1")
		}(index)
	}
	close(start)
	wait.Wait()

	for index, response := range responses {
		if response.Code != http.StatusCreated {
			t.Fatalf("response %d: expected 201, got %d: %s", index, response.Code, response.Body.String())
		}
	}
	persisted, err := server.store.LoadReadOnly(doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if persisted.Meta.Revision != 2 || len(persisted.Nodes) != 2 {
		t.Fatalf("concurrent command executed more than once: revision=%d nodes=%d", persisted.Meta.Revision, len(persisted.Nodes))
	}
}

func TestAgentCommandFailuresAreNotCached(t *testing.T) {
	server := newTestServer(t)
	doc, err := server.store.Create("Retry")
	if err != nil {
		t.Fatal(err)
	}
	handler := server.Handler()
	path := "/api/maps/" + doc.ID + "/nodes"

	failed := executeAgentCommand(t, handler, http.MethodPost, path, `{"parentId":"missing","title":"Child"}`, 1, "retry-1")
	if failed.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", failed.Code, failed.Body.String())
	}
	retried := executeAgentCommand(t, handler, http.MethodPost, path, `{"parentId":"root","title":"Child"}`, 1, "retry-1")
	if retried.Code != http.StatusCreated {
		t.Fatalf("corrected retry should execute, got %d: %s", retried.Code, retried.Body.String())
	}
}

func TestTokenAuthDerivesActorFromStoredToken(t *testing.T) {
	dir := t.TempDir()
	tokenStore, err := store.NewTokenStore(dir + "/tokens.json")
	if err != nil {
		t.Fatal(err)
	}
	token, err := tokenStore.CreateWithActorKind("map-1", "editor", "Build agent", agentcontract.ActorAgent, nil)
	if err != nil {
		t.Fatal(err)
	}

	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, GetActor(r))
	})
	provider := staticAPIKeyProvider("")
	handler := tokenAuthMiddleware(provider, tokenStore, next)
	req := httptest.NewRequest(http.MethodGet, "/api/maps/map-1", nil)
	req.Header.Set("Authorization", "Bearer "+token.Secret)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", res.Code, res.Body.String())
	}
	var actor agentcontract.ActorRef
	if err := json.Unmarshal(res.Body.Bytes(), &actor); err != nil {
		t.Fatal(err)
	}
	if actor.ID != token.ID || actor.Kind != agentcontract.ActorAgent || actor.Label != "Build agent" {
		t.Fatalf("unexpected actor: %+v", actor)
	}
}

func TestTokenEndpointIssuesAgentActorKind(t *testing.T) {
	dir := t.TempDir()
	tokenStore, err := store.NewTokenStore(dir + "/tokens.json")
	if err != nil {
		t.Fatal(err)
	}
	server := NewWithTokenStore(store.NewFileStore(dir+"/maps"), dir, tokenStore)
	req := httptest.NewRequest(
		http.MethodPost,
		"/api/tokens",
		strings.NewReader(`{"mapId":"map-1","accessLevel":"editor","displayName":"Agent","actorKind":"agent"}`),
	)
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", res.Code, res.Body.String())
	}
	var payload struct {
		Secret    string                  `json:"secret"`
		ActorKind agentcontract.ActorKind `json:"actorKind"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Secret == "" || payload.ActorKind != agentcontract.ActorAgent {
		t.Fatalf("unexpected token response: %+v", payload)
	}
	validated, err := tokenStore.Validate(payload.Secret)
	if err != nil {
		t.Fatal(err)
	}
	if validated.ActorKind != agentcontract.ActorAgent {
		t.Fatalf("stored actor kind = %q", validated.ActorKind)
	}
}

func TestChangeSetMetadataShape(t *testing.T) {
	metadata := agentcontract.ChangeSetMetadata{
		ID:             "change-1",
		Author:         agentcontract.ActorRef{ID: "actor-1", Kind: agentcontract.ActorAgent, Label: "Agent"},
		Partition:      agentcontract.PartitionDevelopment,
		IdempotencyKey: "command-1",
		BaseRevision:   7,
		ResultRevision: 8,
		CreatedAt:      time.Unix(1, 0).UTC(),
	}
	payload, err := json.Marshal(metadata)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"id", "author", "partition", "idempotencyKey", "baseRevision", "resultRevision", "createdAt"} {
		if !bytes.Contains(payload, []byte(`"`+field+`"`)) {
			t.Fatalf("missing field %s in %s", field, payload)
		}
	}
}

func TestCommandCacheStaysBoundedWhileEntriesAreInFlight(t *testing.T) {
	cache := newCommandCache(1, time.Minute)
	if _, execute, conflict, full := cache.acquire("scope-1", "fingerprint-1", time.Now()); !execute || conflict || full {
		t.Fatalf("first acquire = execute:%v conflict:%v full:%v", execute, conflict, full)
	}
	if _, execute, conflict, full := cache.acquire("scope-2", "fingerprint-2", time.Now()); execute || conflict || !full {
		t.Fatalf("second acquire = execute:%v conflict:%v full:%v", execute, conflict, full)
	}
}

func executeAgentCommand(
	t *testing.T,
	handler http.Handler,
	method string,
	path string,
	body string,
	revision uint64,
	key string,
) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("If-Match", revisionETag(revision))
	req.Header.Set("X-CodeMind-Partition", "development")
	req.Header.Set("Idempotency-Key", key)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	return res
}

type staticAPIKeyProvider string

func (provider staticAPIKeyProvider) GetCollabAPIKey() string {
	return string(provider)
}
