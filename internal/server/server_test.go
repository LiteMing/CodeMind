package server

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"code-mind/internal/mindmap"
	"code-mind/internal/store"
)

func TestHealthAndMapLifecycle(t *testing.T) {
	handler := newTestHandler(t)

	healthReq := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	healthRes := httptest.NewRecorder()
	handler.ServeHTTP(healthRes, healthReq)

	if healthRes.Code != http.StatusOK {
		t.Fatalf("expected 200 health, got %d", healthRes.Code)
	}

	listReq := httptest.NewRequest(http.MethodGet, "/api/maps", nil)
	listRes := httptest.NewRecorder()
	handler.ServeHTTP(listRes, listReq)

	if listRes.Code != http.StatusOK {
		t.Fatalf("expected 200 map list, got %d", listRes.Code)
	}

	var initialList []store.MapSummary
	if err := json.Unmarshal(listRes.Body.Bytes(), &initialList); err != nil {
		t.Fatalf("failed to decode initial map list: %v", err)
	}
	if len(initialList) != 0 {
		t.Fatalf("expected empty map list, got %d items", len(initialList))
	}

	createReq := httptest.NewRequest(http.MethodPost, "/api/maps", strings.NewReader(`{"title":"Roadmap"}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRes := httptest.NewRecorder()
	handler.ServeHTTP(createRes, createReq)

	if createRes.Code != http.StatusCreated {
		t.Fatalf("expected 201 on create, got %d with body %s", createRes.Code, createRes.Body.String())
	}

	var created mindmap.Document
	if err := json.Unmarshal(createRes.Body.Bytes(), &created); err != nil {
		t.Fatalf("failed to decode created document: %v", err)
	}
	if created.ID == "" {
		t.Fatal("expected created document id")
	}
	if created.Title != "Roadmap" {
		t.Fatalf("expected created title to be Roadmap, got %q", created.Title)
	}

	listReq = httptest.NewRequest(http.MethodGet, "/api/maps", nil)
	listRes = httptest.NewRecorder()
	handler.ServeHTTP(listRes, listReq)

	if listRes.Code != http.StatusOK {
		t.Fatalf("expected 200 map list after create, got %d", listRes.Code)
	}

	var summaries []store.MapSummary
	if err := json.Unmarshal(listRes.Body.Bytes(), &summaries); err != nil {
		t.Fatalf("failed to decode map summaries: %v", err)
	}
	if len(summaries) != 1 {
		t.Fatalf("expected 1 map summary, got %d", len(summaries))
	}
	if summaries[0].ID != created.ID {
		t.Fatalf("expected summary id %q, got %q", created.ID, summaries[0].ID)
	}

	loadReq := httptest.NewRequest(http.MethodGet, "/api/maps/"+created.ID, nil)
	loadRes := httptest.NewRecorder()
	handler.ServeHTTP(loadRes, loadReq)

	if loadRes.Code != http.StatusOK {
		t.Fatalf("expected 200 on load, got %d with body %s", loadRes.Code, loadRes.Body.String())
	}

	var loaded mindmap.Document
	if err := json.Unmarshal(loadRes.Body.Bytes(), &loaded); err != nil {
		t.Fatalf("failed to decode loaded document: %v", err)
	}
	if loaded.Title != "Roadmap" {
		t.Fatalf("expected loaded title to be Roadmap, got %q", loaded.Title)
	}
}

func TestImportRejectsUnsupportedFormat(t *testing.T) {
	handler := newTestHandler(t)

	body := strings.NewReader(`{"content":"hello","format":"json"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/import", body)
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()

	handler.ServeHTTP(res, req)

	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", res.Code)
	}
	if !strings.Contains(res.Body.String(), "unsupported import format") {
		t.Fatalf("unexpected body: %s", res.Body.String())
	}
}

func TestSaveAndExportMarkdown(t *testing.T) {
	handler := newTestHandler(t)
	createReq := httptest.NewRequest(http.MethodPost, "/api/maps", strings.NewReader(`{"title":"Delivery Plan"}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRes := httptest.NewRecorder()
	handler.ServeHTTP(createRes, createReq)

	if createRes.Code != http.StatusCreated {
		t.Fatalf("expected 201 on create, got %d with body %s", createRes.Code, createRes.Body.String())
	}

	var doc mindmap.Document
	if err := json.Unmarshal(createRes.Body.Bytes(), &doc); err != nil {
		t.Fatalf("failed to decode created document: %v", err)
	}

	node := mindmap.Node{
		ID:       "node-1",
		ParentID: "root",
		Kind:     mindmap.NodeKindTopic,
		Title:    "Delivery",
		Position: mindmap.Position{X: 580, Y: 280},
	}
	doc.Nodes = append(doc.Nodes, node)

	savePayload, err := json.Marshal(doc)
	if err != nil {
		t.Fatalf("failed to marshal document: %v", err)
	}

	saveReq := httptest.NewRequest(http.MethodPut, "/api/maps/"+doc.ID, bytes.NewReader(savePayload))
	saveReq.Header.Set("Content-Type", "application/json")
	saveRes := httptest.NewRecorder()
	handler.ServeHTTP(saveRes, saveReq)

	if saveRes.Code != http.StatusOK {
		t.Fatalf("expected 200 on save, got %d with body %s", saveRes.Code, saveRes.Body.String())
	}

	exportReq := httptest.NewRequest(http.MethodPost, "/api/export/markdown", bytes.NewReader(savePayload))
	exportReq.Header.Set("Content-Type", "application/json")
	exportRes := httptest.NewRecorder()
	handler.ServeHTTP(exportRes, exportReq)

	if exportRes.Code != http.StatusOK {
		t.Fatalf("expected 200 on export, got %d", exportRes.Code)
	}
	if !strings.Contains(exportRes.Body.String(), "Delivery") {
		t.Fatalf("expected markdown export to contain node title, got %s", exportRes.Body.String())
	}
}

func TestAIRelationsEndpoint(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/models":
			_, _ = w.Write([]byte(`{"data":[{"id":"qwen-local"}]}`))
		case "/v1/chat/completions":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"model":"qwen-local","choices":[{"message":{"role":"assistant","content":"{\"summary\":\"找到了跨分支的依赖关系\",\"relations\":[{\"sourceId\":\"scope\",\"targetId\":\"timeline\",\"label\":\"影响排期\",\"reason\":\"范围变化会直接影响时间安排\",\"confidence\":0.92}]}"}}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	server := newTestServer(t)
	server.httpClient = upstream.Client()
	handler := server.Handler()

	doc := mindmap.NewDefaultDocument()
	doc.Nodes = append(doc.Nodes,
		mindmap.Node{ID: "scope", ParentID: "root", Kind: mindmap.NodeKindTopic, Title: "Scope", Position: mindmap.Position{X: 1080, Y: 280}},
		mindmap.Node{ID: "timeline", ParentID: "root", Kind: mindmap.NodeKindTopic, Title: "Timeline", Position: mindmap.Position{X: 1080, Y: 400}},
	)

	body := bytes.NewBufferString(`{"settings":{"baseUrl":"` + upstream.URL + `","model":""},"document":`)
	documentPayload, err := json.Marshal(doc)
	if err != nil {
		t.Fatalf("failed to marshal document: %v", err)
	}
	body.Write(documentPayload)
	body.WriteString(`,"instructions":"Focus on practical dependency links."}`)

	req := httptest.NewRequest(http.MethodPost, "/api/ai/relations", body)
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", res.Code, res.Body.String())
	}

	var payload aiRelationsResponse
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode AI relation response: %v", err)
	}
	if len(payload.Relations) != 1 {
		t.Fatalf("expected 1 suggested relation, got %+v", payload.Relations)
	}
	if payload.Relations[0].Label != "影响排期" {
		t.Fatalf("unexpected relation label: %+v", payload.Relations[0])
	}
	if payload.Model != "qwen-local" {
		t.Fatalf("expected model qwen-local, got %q", payload.Model)
	}
}

func TestAITestEndpoint(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/models":
			if auth := r.Header.Get("Authorization"); auth != "Bearer test-key" {
				t.Fatalf("expected Authorization header Bearer test-key, got %q", auth)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":[{"id":"qwen-local"},{"id":"phi-local"}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	server := newTestServer(t)
	server.httpClient = upstream.Client()
	handler := server.Handler()

	req := httptest.NewRequest(http.MethodPost, "/api/ai/test", strings.NewReader(`{"settings":{"provider":"openai-compatible","baseUrl":"`+upstream.URL+`","model":"qwen-local","apiKey":"test-key","maxTokens":4096}}`))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", res.Code, res.Body.String())
	}

	var payload aiTestResponse
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode AI test response: %v", err)
	}
	if !payload.OK {
		t.Fatalf("expected ok response, got %+v", payload)
	}
	if payload.Model != "qwen-local" {
		t.Fatalf("expected model qwen-local, got %q", payload.Model)
	}
	if !strings.Contains(payload.Message, "Connected") {
		t.Fatalf("expected connection message, got %q", payload.Message)
	}
}

func TestAIGenerateEndpoint(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/models":
			if auth := r.Header.Get("Authorization"); auth != "Bearer test-key" {
				t.Fatalf("expected Authorization header Bearer test-key on /models, got %q", auth)
			}
			_, _ = w.Write([]byte(`{"data":[{"id":"qwen-local"}]}`))
		case "/v1/chat/completions":
			if auth := r.Header.Get("Authorization"); auth != "Bearer test-key" {
				t.Fatalf("expected Authorization header Bearer test-key on /chat/completions, got %q", auth)
			}
			body, err := io.ReadAll(r.Body)
			if err != nil {
				t.Fatalf("failed to read upstream request body: %v", err)
			}
			var payload openAIChatRequest
			if err := json.Unmarshal(body, &payload); err != nil {
				t.Fatalf("failed to decode upstream chat request: %v", err)
			}
			if payload.MaxTokens != 4096 {
				t.Fatalf("expected max_tokens 4096, got %d", payload.MaxTokens)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"model":"qwen-local","choices":[{"message":{"role":"assistant","content":"{\"title\":\"Graph Databases\",\"summary\":\"覆盖概念、建模、查询与场景。\",\"nodes\":[{\"id\":\"root-topic\",\"title\":\"Graph Databases\",\"parentId\":\"\",\"kind\":\"root\",\"priority\":\"\"},{\"id\":\"concepts\",\"title\":\"Core Concepts\",\"parentId\":\"root-topic\",\"kind\":\"topic\",\"priority\":\"P1\"},{\"id\":\"query\",\"title\":\"Query Languages\",\"parentId\":\"root-topic\",\"kind\":\"topic\",\"priority\":\"\"},{\"id\":\"use-cases\",\"title\":\"Use Cases\",\"parentId\":\"root-topic\",\"kind\":\"topic\",\"priority\":\"\"},{\"id\":\"rdf\",\"title\":\"RDF vs Property Graph\",\"parentId\":\"concepts\",\"kind\":\"topic\",\"priority\":\"\"},{\"id\":\"cypher\",\"title\":\"Cypher\",\"parentId\":\"query\",\"kind\":\"topic\",\"priority\":\"\"},{\"id\":\"recommendation\",\"title\":\"Recommendation\",\"parentId\":\"use-cases\",\"kind\":\"topic\",\"priority\":\"\"}],\"relations\":[{\"sourceId\":\"cypher\",\"targetId\":\"rdf\",\"label\":\"对比\"},{\"sourceId\":\"recommendation\",\"targetId\":\"concepts\",\"label\":\"依赖建模\"}]}"}}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	server := newTestServer(t)
	server.httpClient = upstream.Client()
	handler := server.Handler()

	req := httptest.NewRequest(http.MethodPost, "/api/ai/generate", strings.NewReader(`{"settings":{"provider":"openai-compatible","baseUrl":"`+upstream.URL+`","model":"","apiKey":"test-key","maxTokens":4096},"topic":"Graph Databases","template":"concept-graph","instructions":"Focus on practical overview."}`))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", res.Code, res.Body.String())
	}

	var payload aiGenerateResponse
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode AI generate response: %v", err)
	}
	if payload.Document.Title != "Graph Databases" {
		t.Fatalf("unexpected document title: %q", payload.Document.Title)
	}
	if len(payload.Document.Nodes) < 4 {
		t.Fatalf("expected generated document to contain multiple nodes, got %d", len(payload.Document.Nodes))
	}
	if len(payload.Document.Relations) == 0 {
		t.Fatalf("expected generated document to contain cross relations")
	}
}

func newTestHandler(t *testing.T) http.Handler {
	t.Helper()
	return newTestServer(t).Handler()
}

func newTestServer(t *testing.T) *Server {
	t.Helper()

	storePath := t.TempDir()
	fileStore := store.NewFileStore(storePath)
	return New(fileStore)
}
