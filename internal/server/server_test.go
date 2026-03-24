package server

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

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
	if created.Theme != mindmap.ThemeDark {
		t.Fatalf("expected created theme to default to %q, got %q", mindmap.ThemeDark, created.Theme)
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
			if !strings.Contains(payload.Messages[1].Content, "Every node must include id, title, note, parentId, kind, priority.") {
				t.Fatalf("expected generation prompt to require full node schema, got %q", payload.Messages[1].Content)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"model":"qwen-local","choices":[{"message":{"role":"assistant","content":"{\"title\":\"Graph Databases\",\"summary\":\"覆盖概念、建模、查询与场景。\",\"nodes\":[{\"id\":\"root-topic\",\"title\":\"Graph Databases\",\"note\":\"图数据库用图结构表达实体与关系，适合关联密集型问题。\",\"parentId\":\"\",\"kind\":\"root\",\"priority\":\"\"},{\"id\":\"concepts\",\"title\":\"Core Concepts\",\"note\":\"核心概念包括节点、边、属性，以及如何保持关系可遍历。\",\"parentId\":\"root-topic\",\"kind\":\"topic\",\"priority\":\"P1\"},{\"id\":\"query\",\"title\":\"Query Languages\",\"note\":\"查询语言决定如何高效遍历邻接关系并提取模式。\",\"parentId\":\"root-topic\",\"kind\":\"topic\",\"priority\":\"\"},{\"id\":\"use-cases\",\"title\":\"Use Cases\",\"note\":\"典型场景集中在推荐、风控、知识图谱和网络分析。\",\"parentId\":\"root-topic\",\"kind\":\"topic\",\"priority\":\"\"},{\"id\":\"rdf\",\"title\":\"RDF vs Property Graph\",\"note\":\"两种模型分别强调三元组标准化和属性图工程灵活性。\",\"parentId\":\"concepts\",\"kind\":\"topic\",\"priority\":\"\"},{\"id\":\"cypher\",\"title\":\"Cypher\",\"note\":\"Cypher 用模式匹配表达关系查询，适合业务分析与探索。\",\"parentId\":\"query\",\"kind\":\"topic\",\"priority\":\"\"},{\"id\":\"recommendation\",\"title\":\"Recommendation\",\"note\":\"推荐系统常用图数据库建模用户、物品与交互关系。\",\"parentId\":\"use-cases\",\"kind\":\"topic\",\"priority\":\"\"}],\"relations\":[{\"sourceId\":\"cypher\",\"targetId\":\"rdf\",\"label\":\"对比\"},{\"sourceId\":\"recommendation\",\"targetId\":\"concepts\",\"label\":\"依赖建模\"}]}"}}]}`))
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
	if strings.TrimSpace(payload.Document.Nodes[0].Note) == "" {
		t.Fatal("expected generated document nodes to include notes")
	}
	if payload.Debug.RawMode {
		t.Fatal("expected normal generate flow to report rawMode false")
	}
	if !strings.Contains(payload.Debug.UpstreamRequest, `"model":"qwen-local"`) {
		t.Fatalf("expected debug upstream request to include resolved model, got %q", payload.Debug.UpstreamRequest)
	}
	if !strings.Contains(payload.Debug.UpstreamResponse, `"model":"qwen-local"`) {
		t.Fatalf("expected debug upstream response to keep raw response body, got %q", payload.Debug.UpstreamResponse)
	}
	if !strings.Contains(payload.Debug.AssistantContent, `"title":"Graph Databases"`) {
		t.Fatalf("expected assistant content in debug payload, got %q", payload.Debug.AssistantContent)
	}
}

func TestAIGenerateEndpointSupportsRawRequest(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/chat/completions":
			body, err := io.ReadAll(r.Body)
			if err != nil {
				t.Fatalf("failed to read upstream request body: %v", err)
			}

			var payload map[string]any
			if err := json.Unmarshal(body, &payload); err != nil {
				t.Fatalf("failed to decode raw upstream request body: %v", err)
			}
			if payload["model"] != "qwen-local" {
				t.Fatalf("expected RAW mode to backfill model qwen-local, got %#v", payload["model"])
			}
			if payload["stream"] != false {
				t.Fatalf("expected RAW mode to default stream to false, got %#v", payload["stream"])
			}
			if payload["temperature"] != 0.77 {
				t.Fatalf("expected RAW request to preserve custom temperature, got %#v", payload["temperature"])
			}

			messages, ok := payload["messages"].([]any)
			if !ok || len(messages) != 2 {
				t.Fatalf("expected RAW request messages to be forwarded, got %#v", payload["messages"])
			}

			systemMessage, _ := messages[0].(map[string]any)
			userMessage, _ := messages[1].(map[string]any)
			if systemMessage["content"] != "raw system" || userMessage["content"] != "raw user" {
				t.Fatalf("expected RAW request message content to stay unchanged, got %#v", payload["messages"])
			}

			writeOpenAIChatResponse(t, w, "qwen-local", `{"title":"Raw Mode","summary":"Uses the hand-edited upstream payload.","nodes":[{"id":"raw-root","title":"Raw Mode","note":"Root note","parentId":"","kind":"root","priority":""},{"id":"raw-child","title":"Forwarded Messages","note":"Generated from the raw request body.","parentId":"raw-root","kind":"topic","priority":"P1"}],"relations":[]}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	server := newTestServer(t)
	server.httpClient = upstream.Client()
	handler := server.Handler()

	req := httptest.NewRequest(http.MethodPost, "/api/ai/generate", strings.NewReader(`{"settings":{"provider":"openai-compatible","baseUrl":"`+upstream.URL+`","model":"qwen-local","apiKey":"test-key","maxTokens":4096},"topic":"Raw Mode","template":"concept-graph","instructions":"Ignore this and use raw mode.","debug":{"rawMode":true,"rawRequest":"{\"messages\":[{\"role\":\"system\",\"content\":\"raw system\"},{\"role\":\"user\",\"content\":\"raw user\"}],\"temperature\":0.77}"}}`))
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
	if !payload.Debug.RawMode {
		t.Fatal("expected rawMode debug flag to be true")
	}
	if !strings.Contains(payload.Debug.UpstreamRequest, `"temperature":0.77`) {
		t.Fatalf("expected debug request to keep custom RAW payload, got %q", payload.Debug.UpstreamRequest)
	}
	if !strings.Contains(payload.Debug.UpstreamRequest, `"content":"raw user"`) {
		t.Fatalf("expected debug request to keep RAW messages, got %q", payload.Debug.UpstreamRequest)
	}
}

func TestAIGenerateEndpointReturnsDebugOnRawRequestError(t *testing.T) {
	handler := newTestHandler(t)
	rawRequest := `{"messages":[}`
	requestBody, err := json.Marshal(map[string]any{
		"settings": map[string]any{
			"provider":  "openai-compatible",
			"baseUrl":   "http://127.0.0.1:65535/v1",
			"model":     "qwen-local",
			"apiKey":    "test-key",
			"maxTokens": 4096,
		},
		"topic":        "Broken Raw",
		"template":     "concept-graph",
		"instructions": "",
		"debug": map[string]any{
			"rawMode":    true,
			"rawRequest": rawRequest,
		},
	})
	if err != nil {
		t.Fatalf("failed to marshal request body: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/ai/generate", bytes.NewReader(requestBody))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d with body %s", res.Code, res.Body.String())
	}

	var payload struct {
		Error string      `json:"error"`
		Debug aiDebugInfo `json:"debug"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode AI error response: %v", err)
	}
	if !strings.Contains(payload.Error, "invalid RAW AI request JSON") {
		t.Fatalf("expected RAW JSON parse error, got %q", payload.Error)
	}
	if !payload.Debug.RawMode {
		t.Fatal("expected debug payload to keep rawMode true")
	}
	if payload.Debug.UpstreamRequest != rawRequest {
		t.Fatalf("expected raw request to be echoed for debugging, got %q", payload.Debug.UpstreamRequest)
	}
	if payload.Debug.UpstreamResponse != "" {
		t.Fatalf("expected no upstream response for local RAW parse failure, got %q", payload.Debug.UpstreamResponse)
	}
}

func TestAINodeNotesEndpoint(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/models":
			_, _ = w.Write([]byte(`{"data":[{"id":"qwen-local"}]}`))
		case "/v1/chat/completions":
			body, err := io.ReadAll(r.Body)
			if err != nil {
				t.Fatalf("failed to read upstream request body: %v", err)
			}
			var payload openAIChatRequest
			if err := json.Unmarshal(body, &payload); err != nil {
				t.Fatalf("failed to decode upstream chat request: %v", err)
			}
			if !strings.Contains(payload.Messages[1].Content, "Return notes only for the target nodes listed above.") {
				t.Fatalf("expected node note prompt to target selected nodes, got %q", payload.Messages[1].Content)
			}
			writeOpenAIChatResponse(t, w, "qwen-local", `{"summary":"Expanded the most important execution notes.","notes":[{"id":"scope","note":"Scope defines what is intentionally included and excluded so the team can protect focus and prevent requirement drift."},{"id":"timeline","note":"Timeline note that should be filtered because it was not requested."}]}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	server := newTestServer(t)
	server.httpClient = upstream.Client()
	handler := server.Handler()

	req := httptest.NewRequest(http.MethodPost, "/api/ai/node-notes", strings.NewReader(`{"settings":{"provider":"openai-compatible","baseUrl":"`+upstream.URL+`","model":"","apiKey":"test-key","maxTokens":4096},"document":{"id":"roadmap","title":"Roadmap","theme":"dark","nodes":[{"id":"root","kind":"root","title":"Roadmap","note":"Top level overview","position":{"x":820,"y":320},"createdAt":"2026-03-01T09:30:00Z","updatedAt":"2026-03-01T09:30:00Z"},{"id":"scope","parentId":"root","kind":"topic","title":"Scope","note":"","position":{"x":1100,"y":320},"createdAt":"2026-03-01T09:30:00Z","updatedAt":"2026-03-01T09:30:00Z"},{"id":"timeline","parentId":"root","kind":"topic","title":"Timeline","note":"","position":{"x":1100,"y":420},"createdAt":"2026-03-01T09:30:00Z","updatedAt":"2026-03-01T09:30:00Z"}],"relations":[],"meta":{"version":1,"lastEditedAt":"2026-03-01T09:30:00Z","lastOpenedAt":"2026-03-02T10:00:00Z"}},"targetNodeIds":["scope"],"instructions":"Focus on execution clarity."}`))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", res.Code, res.Body.String())
	}

	var payload aiNodeNotesResponse
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode AI node notes response: %v", err)
	}
	if payload.Model != "qwen-local" {
		t.Fatalf("expected model qwen-local, got %q", payload.Model)
	}
	if len(payload.Notes) != 1 || payload.Notes[0].ID != "scope" {
		t.Fatalf("expected endpoint to keep only requested node notes, got %+v", payload.Notes)
	}
	if !strings.Contains(payload.Notes[0].Note, "prevent requirement drift") {
		t.Fatalf("unexpected node note payload: %+v", payload.Notes[0])
	}
}

func TestAIGenerateEndpointRetriesFlatHierarchy(t *testing.T) {
	chatCalls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/models":
			_, _ = w.Write([]byte(`{"data":[{"id":"qwen-local"}]}`))
		case "/v1/chat/completions":
			chatCalls++

			body, err := io.ReadAll(r.Body)
			if err != nil {
				t.Fatalf("failed to read upstream request body: %v", err)
			}
			var payload openAIChatRequest
			if err := json.Unmarshal(body, &payload); err != nil {
				t.Fatalf("failed to decode upstream chat request: %v", err)
			}

			switch chatCalls {
			case 1:
				if payload.ResponseFormat == nil {
					t.Fatal("expected first generation call to include schema")
				}
				if !strings.Contains(payload.Messages[1].Content, "At least 2 first-level branches should include second-level children") {
					t.Fatalf("expected hierarchy instruction in initial prompt, got %q", payload.Messages[1].Content)
				}
				writeOpenAIChatResponse(t, w, "qwen-local", `{"title":"AI Systems","summary":"Overview","nodes":[{"id":"root-topic","title":"AI Systems","parentId":"","kind":"root","priority":""},{"id":"history","title":"History","parentId":"root-topic","kind":"topic","priority":"P1"},{"id":"models","title":"Models","parentId":"root-topic","kind":"topic","priority":"P1"},{"id":"training","title":"Training","parentId":"root-topic","kind":"topic","priority":""},{"id":"deployment","title":"Deployment","parentId":"root-topic","kind":"topic","priority":""},{"id":"evaluation","title":"Evaluation","parentId":"root-topic","kind":"topic","priority":""},{"id":"safety","title":"Safety","parentId":"root-topic","kind":"topic","priority":""}],"relations":[]}`)
			case 2:
				if payload.ResponseFormat == nil {
					t.Fatal("expected retry generation call to include schema")
				}
				if !strings.Contains(payload.Messages[1].Content, "The previous draft was too flat.") {
					t.Fatalf("expected retry prompt to explain the hierarchy revision, got %q", payload.Messages[1].Content)
				}
				writeOpenAIChatResponse(t, w, "qwen-local", `{"title":"AI Systems","summary":"Layered overview","nodes":[{"id":"root-topic","title":"AI Systems","parentId":"","kind":"root","priority":""},{"id":"model-families","title":"Model Families","parentId":"root-topic","kind":"topic","priority":"P1"},{"id":"training","title":"Training","parentId":"root-topic","kind":"topic","priority":"P1"},{"id":"deployment","title":"Deployment","parentId":"root-topic","kind":"topic","priority":""},{"id":"evaluation","title":"Evaluation","parentId":"root-topic","kind":"topic","priority":""},{"id":"transformers","title":"Transformers","parentId":"model-families","kind":"topic","priority":""},{"id":"multimodal","title":"Multimodal","parentId":"model-families","kind":"topic","priority":""},{"id":"pretraining","title":"Pretraining","parentId":"training","kind":"topic","priority":""},{"id":"alignment","title":"Alignment","parentId":"training","kind":"topic","priority":""},{"id":"tokenizers","title":"Tokenizers","parentId":"transformers","kind":"topic","priority":""},{"id":"attention","title":"Attention","parentId":"transformers","kind":"topic","priority":""}],"relations":[{"sourceId":"alignment","targetId":"evaluation","label":"feeds"}]}`)
			default:
				t.Fatalf("unexpected extra chat completion call %d", chatCalls)
			}
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	server := newTestServer(t)
	server.httpClient = upstream.Client()
	handler := server.Handler()

	req := httptest.NewRequest(http.MethodPost, "/api/ai/generate", strings.NewReader(`{"settings":{"provider":"openai-compatible","baseUrl":"`+upstream.URL+`","model":"","apiKey":"test-key","maxTokens":4096},"topic":"AI Systems","template":"concept-graph","instructions":"Keep it useful for beginners."}`))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", res.Code, res.Body.String())
	}
	if chatCalls != 2 {
		t.Fatalf("expected hierarchy retry to trigger a second chat call, got %d calls", chatCalls)
	}

	var payload aiGenerateResponse
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode AI generate response: %v", err)
	}
	if depth := documentMaxDepth(payload.Document); depth < 3 {
		t.Fatalf("expected generated document depth >= 3 after retry, got %d", depth)
	}
}

func TestAIGenerateEndpointParsesDirtyJSON(t *testing.T) {
	dirtyContent := "Here is the JSON:\n```json\n{\n  \"title\": \"Graph Databases\",\n  \"summary\": \"Overview\",\n  \"nodes\": [\n    {\"id\":\"root-topic\",\"title\":\"Graph Databases\",\"parentId\":\"\",\"kind\":\"root\",\"priority\":\"\"},\n    * {\"id\":\"concepts\",\"title\":\"Core Concepts\",\"parentId\":\"root-topic\",\"kind\":\"topic\",\"priority\":\"P1\"},\n    * {\"id\":\"query\",\"title\":\"Query Languages\",\"parentId\":\"concepts\",\"kind\":\"topic\",\"priority\":\"\"},\n  ],\n  \"relations\": [],\n}\n```"

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/models":
			_, _ = w.Write([]byte(`{"data":[{"id":"gemini-3"}]}`))
		case "/v1/chat/completions":
			writeOpenAIChatResponse(t, w, "gemini-3", dirtyContent)
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	server := newTestServer(t)
	server.httpClient = upstream.Client()
	handler := server.Handler()

	req := httptest.NewRequest(http.MethodPost, "/api/ai/generate", strings.NewReader(`{"settings":{"provider":"openai-compatible","baseUrl":"`+upstream.URL+`","model":"","apiKey":"test-key","maxTokens":4096},"topic":"Graph Databases","template":"concept-graph","instructions":""}`))
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
	if len(payload.Document.Nodes) != 3 {
		t.Fatalf("expected dirty JSON response to yield 3 nodes, got %d", len(payload.Document.Nodes))
	}
}

func TestAIGenerateEndpointParsesWrappedAlternateJSON(t *testing.T) {
	alternateContent := `{"content":"{\n  \"root\": {\n    \"title\": \"水浒传主要人物关系图谱\",\n    \"description\": \"基于《水浒传》核心人物的社交网络与互动模式构建的知识图谱。\",\n    \"children\": [\n      {\n        \"title\": \"核心角色\",\n        \"note\": \"梁山泊的核心成员。\",\n        \"links\": []\n      },\n      {\n        \"title\": \"关键配角\",\n        \"note\": \"负责推动剧情发展。\",\n        \"links\": []\n      }\n    ],\n    \"crossLinks\": [\n      {\n        \"source\": \"宋江\",\n        \"target\": \"李逵\",\n        \"type\": \"emotional_connection\",\n        \"note\": \"兄弟情义。\"\n      }\n    ]\n  },\n  \"nodes\": [\n    {\n      \"title\": \"梁山泊\",\n      \"description\": \"故事发生的地点。\",\n      \"links\": []\n    },\n    {\n      \"title\": \"人物关系网络\",\n      \"description\": \"人物之间复杂的互动模式。\",\n      \"links\": [\n        {\n          \"source\": \"鲁智深\",\n          \"target\": \"武松\",\n          \"type\": \"mentorship_and_conflict\"\n        }\n      ]\n    }\n  ],\n  \"edges\": [\n    {\n      \"title\": \"吴用 - 林冲\",\n      \"source\": \"吴用\",\n      \"target\": \"林冲\",\n      \"type\": \"intellectual_cooperation\"\n    }\n  ]\n}"}`

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/models":
			_, _ = w.Write([]byte(`{"data":[{"id":"gemini-3"}]}`))
		case "/v1/chat/completions":
			writeOpenAIChatResponse(t, w, "gemini-3", alternateContent)
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	server := newTestServer(t)
	server.httpClient = upstream.Client()
	handler := server.Handler()

	req := httptest.NewRequest(http.MethodPost, "/api/ai/generate", strings.NewReader(`{"settings":{"provider":"openai-compatible","baseUrl":"`+upstream.URL+`","model":"","apiKey":"test-key","maxTokens":4096},"topic":"水浒传","template":"character-network","instructions":""}`))
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
	if payload.Document.Root().Title != "水浒传主要人物关系图谱" {
		t.Fatalf("expected salvaged root title, got %q", payload.Document.Root().Title)
	}
	if len(payload.Document.Nodes) < 6 {
		t.Fatalf("expected salvaged alternate payload to yield at least 6 nodes, got %d", len(payload.Document.Nodes))
	}
	if len(payload.Document.Relations) < 2 {
		t.Fatalf("expected salvaged alternate payload to yield relations, got %d", len(payload.Document.Relations))
	}
}

func TestAITestEndpointHonorsConfiguredTimeout(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/models":
			time.Sleep(1500 * time.Millisecond)
			_, _ = w.Write([]byte(`{"data":[{"id":"slow-model"}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	server := newTestServer(t)
	server.httpClient = upstream.Client()
	handler := server.Handler()

	req := httptest.NewRequest(http.MethodPost, "/api/ai/test", strings.NewReader(`{"settings":{"provider":"openai-compatible","baseUrl":"`+upstream.URL+`","model":"","apiKey":"test-key","maxTokens":4096,"timeoutSeconds":1}}`))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusBadGateway {
		t.Fatalf("expected 502 on timeout, got %d with body %s", res.Code, res.Body.String())
	}
	if !strings.Contains(res.Body.String(), "Client.Timeout exceeded") && !strings.Contains(res.Body.String(), "context deadline exceeded") {
		t.Fatalf("expected timeout error, got %s", res.Body.String())
	}
}

func TestAIGenerateEndpointExpandsCurrentDocument(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/models":
			_, _ = w.Write([]byte(`{"data":[{"id":"qwen-local"}]}`))
		case "/v1/chat/completions":
			writeOpenAIChatResponse(t, w, "qwen-local", `{"title":"Roadmap","summary":"Expand execution details","nodes":[{"id":"scope-details","title":"Scope Details","note":"Clarify delivery boundaries and exclusions.","parentId":"scope","kind":"topic","priority":"P1"},{"id":"scope-api","title":"API Surface","note":"List the interfaces that will be touched.","parentId":"scope-details","kind":"topic","priority":""},{"id":"timeline-risks","title":"Timeline Risks","note":"Track schedule risk drivers and mitigations.","parentId":"timeline","kind":"topic","priority":""}],"relations":[{"sourceId":"timeline-risks","targetId":"scope-details","label":"constrains"}]}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	server := newTestServer(t)
	server.httpClient = upstream.Client()
	handler := server.Handler()

	reqBody := `{"settings":{"provider":"openai-compatible","baseUrl":"` + upstream.URL + `","model":"","apiKey":"test-key","maxTokens":4096},"topic":"Roadmap","template":"project-planning","mode":"expand","document":{"id":"roadmap","title":"Roadmap","theme":"dark","nodes":[{"id":"root","kind":"root","title":"Roadmap","position":{"x":820,"y":320},"createdAt":"2026-03-01T09:30:00Z","updatedAt":"2026-03-01T09:30:00Z"},{"id":"scope","parentId":"root","kind":"topic","title":"Scope","position":{"x":1100,"y":320},"createdAt":"2026-03-01T09:30:00Z","updatedAt":"2026-03-01T09:30:00Z"},{"id":"timeline","parentId":"root","kind":"topic","title":"Timeline","position":{"x":1100,"y":420},"createdAt":"2026-03-01T09:30:00Z","updatedAt":"2026-03-01T09:30:00Z"}],"relations":[],"meta":{"version":1,"lastEditedAt":"2026-03-01T09:30:00Z","lastOpenedAt":"2026-03-01T09:30:00Z"}},"instructions":"Deepen weak branches."}`
	req := httptest.NewRequest(http.MethodPost, "/api/ai/generate", strings.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", res.Code, res.Body.String())
	}

	var payload aiGenerateResponse
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode AI expand response: %v", err)
	}
	if payload.Mode != "expand" {
		t.Fatalf("expected mode expand, got %q", payload.Mode)
	}
	if len(payload.Document.Nodes) != 6 {
		t.Fatalf("expected expanded document to have 6 nodes, got %d", len(payload.Document.Nodes))
	}
	if depth := documentMaxDepth(payload.Document); depth < 2 {
		t.Fatalf("expected expanded document depth >= 2, got %d", depth)
	}
	if len(payload.Document.Relations) != 1 {
		t.Fatalf("expected 1 relation after expansion, got %d", len(payload.Document.Relations))
	}
}

func TestAIGenerateEndpointRetriesAfterParseFailure(t *testing.T) {
	chatCalls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/models":
			_, _ = w.Write([]byte(`{"data":[{"id":"gemini-3"}]}`))
		case "/v1/chat/completions":
			chatCalls++

			body, err := io.ReadAll(r.Body)
			if err != nil {
				t.Fatalf("failed to read upstream request body: %v", err)
			}
			var payload openAIChatRequest
			if err := json.Unmarshal(body, &payload); err != nil {
				t.Fatalf("failed to decode upstream chat request: %v", err)
			}

			if chatCalls == 1 {
				if payload.ResponseFormat == nil {
					t.Fatal("expected first chat call to include schema")
				}
				writeOpenAIChatResponse(t, w, "gemini-3", "I cannot follow the schema, but here are some bullet ideas:\n* databases\n* queries")
				return
			}

			if payload.ResponseFormat != nil {
				t.Fatal("expected fallback chat call to remove schema")
			}
			if !strings.Contains(payload.Messages[0].Content, "Return valid JSON only.") {
				t.Fatalf("expected fallback system prompt to enforce JSON-only output, got %q", payload.Messages[0].Content)
			}
			writeOpenAIChatResponse(t, w, "gemini-3", `{"title":"Graph Databases","summary":"Recovered after fallback","nodes":[{"id":"root-topic","title":"Graph Databases","parentId":"","kind":"root","priority":""},{"id":"concepts","title":"Core Concepts","parentId":"root-topic","kind":"topic","priority":"P1"},{"id":"query","title":"Query Languages","parentId":"concepts","kind":"topic","priority":""}],"relations":[]}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	server := newTestServer(t)
	server.httpClient = upstream.Client()
	handler := server.Handler()

	req := httptest.NewRequest(http.MethodPost, "/api/ai/generate", strings.NewReader(`{"settings":{"provider":"openai-compatible","baseUrl":"`+upstream.URL+`","model":"","apiKey":"test-key","maxTokens":4096},"topic":"Graph Databases","template":"concept-graph","instructions":"Return only usable structure."}`))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", res.Code, res.Body.String())
	}
	if chatCalls != 2 {
		t.Fatalf("expected parse failure to trigger fallback call, got %d calls", chatCalls)
	}
}

func TestListMapsPreservesLastEditedAt(t *testing.T) {
	storePath := t.TempDir()
	handler := New(store.NewFileStore(storePath)).Handler()

	lastEditedAt := time.Date(2026, time.March, 1, 9, 30, 0, 0, time.UTC)
	lastOpenedAt := time.Date(2026, time.March, 2, 10, 0, 0, 0, time.UTC)
	writeTestDocument(t, storePath, newStoredDocument("roadmap", "Roadmap", lastEditedAt, lastOpenedAt))

	req := httptest.NewRequest(http.MethodGet, "/api/maps", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", res.Code, res.Body.String())
	}

	var summaries []store.MapSummary
	if err := json.Unmarshal(res.Body.Bytes(), &summaries); err != nil {
		t.Fatalf("failed to decode map summaries: %v", err)
	}
	if len(summaries) != 1 {
		t.Fatalf("expected 1 summary, got %d", len(summaries))
	}
	if !summaries[0].LastEditedAt.Equal(lastEditedAt) {
		t.Fatalf("expected LastEditedAt %s, got %s", lastEditedAt, summaries[0].LastEditedAt)
	}
	if !summaries[0].LastOpenedAt.Equal(lastOpenedAt) {
		t.Fatalf("expected LastOpenedAt %s, got %s", lastOpenedAt, summaries[0].LastOpenedAt)
	}
}

func TestLoadMapTouchesLastOpenedAtWithoutEditing(t *testing.T) {
	storePath := t.TempDir()
	handler := New(store.NewFileStore(storePath)).Handler()

	lastEditedAt := time.Date(2026, time.March, 1, 9, 30, 0, 0, time.UTC)
	lastOpenedAt := time.Date(2026, time.March, 2, 10, 0, 0, 0, time.UTC)
	writeTestDocument(t, storePath, newStoredDocument("roadmap", "Roadmap", lastEditedAt, lastOpenedAt))

	req := httptest.NewRequest(http.MethodGet, "/api/maps/roadmap", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", res.Code, res.Body.String())
	}

	var payload mindmap.Document
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode loaded document: %v", err)
	}
	if !payload.Meta.LastEditedAt.Equal(lastEditedAt) {
		t.Fatalf("expected LastEditedAt %s, got %s", lastEditedAt, payload.Meta.LastEditedAt)
	}
	if !payload.Meta.LastOpenedAt.After(lastOpenedAt) {
		t.Fatalf("expected LastOpenedAt to move forward from %s, got %s", lastOpenedAt, payload.Meta.LastOpenedAt)
	}

	stored := readStoredDocument(t, storePath, "roadmap")
	if !stored.Meta.LastEditedAt.Equal(lastEditedAt) {
		t.Fatalf("expected persisted LastEditedAt %s, got %s", lastEditedAt, stored.Meta.LastEditedAt)
	}
	if !stored.Meta.LastOpenedAt.After(lastOpenedAt) {
		t.Fatalf("expected persisted LastOpenedAt to move forward from %s, got %s", lastOpenedAt, stored.Meta.LastOpenedAt)
	}
}

func TestSaveMapUpdatesLastEditedAt(t *testing.T) {
	storePath := t.TempDir()
	handler := New(store.NewFileStore(storePath)).Handler()

	lastEditedAt := time.Date(2026, time.March, 1, 9, 30, 0, 0, time.UTC)
	lastOpenedAt := time.Date(2026, time.March, 2, 10, 0, 0, 0, time.UTC)
	doc := newStoredDocument("roadmap", "Roadmap", lastEditedAt, lastOpenedAt)
	writeTestDocument(t, storePath, doc)

	doc.Nodes = append(doc.Nodes, mindmap.Node{
		ID:        "scope",
		ParentID:  "root",
		Kind:      mindmap.NodeKindTopic,
		Title:     "Scope",
		Position:  mindmap.Position{X: 1100, Y: 320},
		CreatedAt: lastEditedAt,
		UpdatedAt: lastEditedAt,
	})

	body, err := json.Marshal(doc)
	if err != nil {
		t.Fatalf("failed to marshal document: %v", err)
	}

	req := httptest.NewRequest(http.MethodPut, "/api/maps/roadmap", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", res.Code, res.Body.String())
	}

	stored := readStoredDocument(t, storePath, "roadmap")
	if !stored.Meta.LastEditedAt.After(lastEditedAt) {
		t.Fatalf("expected LastEditedAt to move forward from %s, got %s", lastEditedAt, stored.Meta.LastEditedAt)
	}
	if !stored.Meta.LastOpenedAt.Equal(lastOpenedAt) {
		t.Fatalf("expected LastOpenedAt to stay at %s, got %s", lastOpenedAt, stored.Meta.LastOpenedAt)
	}
}

func TestSaveMapPersistsNodeColor(t *testing.T) {
	storePath := t.TempDir()
	handler := New(store.NewFileStore(storePath)).Handler()

	lastEditedAt := time.Date(2026, time.March, 1, 9, 30, 0, 0, time.UTC)
	lastOpenedAt := time.Date(2026, time.March, 2, 10, 0, 0, 0, time.UTC)
	doc := newStoredDocument("roadmap", "Roadmap", lastEditedAt, lastOpenedAt)
	doc.Nodes = append(doc.Nodes, mindmap.Node{
		ID:        "scope",
		ParentID:  "root",
		Kind:      mindmap.NodeKindTopic,
		Title:     "Scope",
		Color:     mindmap.NodeColor("teal"),
		Position:  mindmap.Position{X: 1100, Y: 320},
		CreatedAt: lastEditedAt,
		UpdatedAt: lastEditedAt,
	})
	writeTestDocument(t, storePath, doc)

	body, err := json.Marshal(doc)
	if err != nil {
		t.Fatalf("failed to marshal document: %v", err)
	}

	req := httptest.NewRequest(http.MethodPut, "/api/maps/roadmap", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", res.Code, res.Body.String())
	}

	stored := readStoredDocument(t, storePath, "roadmap")
	var matched mindmap.Node
	for _, node := range stored.Nodes {
		if node.ID == "scope" {
			matched = node
			break
		}
	}
	if matched.ID == "" {
		t.Fatal("expected saved document to contain scope node")
	}
	if matched.Color != mindmap.NodeColor("teal") {
		t.Fatalf("expected node color teal, got %q", matched.Color)
	}
}

func TestSaveMapPersistsNodeNote(t *testing.T) {
	storePath := t.TempDir()
	handler := New(store.NewFileStore(storePath)).Handler()

	lastEditedAt := time.Date(2026, time.March, 1, 9, 30, 0, 0, time.UTC)
	lastOpenedAt := time.Date(2026, time.March, 2, 10, 0, 0, 0, time.UTC)
	doc := newStoredDocument("roadmap", "Roadmap", lastEditedAt, lastOpenedAt)
	doc.Nodes = append(doc.Nodes, mindmap.Node{
		ID:        "scope",
		ParentID:  "root",
		Kind:      mindmap.NodeKindTopic,
		Title:     "Scope",
		Note:      "Clarify what is in and out of scope.\nTrack open assumptions here.",
		Position:  mindmap.Position{X: 1100, Y: 320},
		CreatedAt: lastEditedAt,
		UpdatedAt: lastEditedAt,
	})
	writeTestDocument(t, storePath, doc)

	body, err := json.Marshal(doc)
	if err != nil {
		t.Fatalf("failed to marshal document: %v", err)
	}

	req := httptest.NewRequest(http.MethodPut, "/api/maps/roadmap", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", res.Code, res.Body.String())
	}

	stored := readStoredDocument(t, storePath, "roadmap")
	var matched mindmap.Node
	for _, node := range stored.Nodes {
		if node.ID == "scope" {
			matched = node
			break
		}
	}
	if matched.ID == "" {
		t.Fatal("expected saved document to contain scope node")
	}
	if matched.Note != "Clarify what is in and out of scope.\nTrack open assumptions here." {
		t.Fatalf("expected node note to persist, got %q", matched.Note)
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

func newStoredDocument(id string, title string, lastEditedAt time.Time, lastOpenedAt time.Time) mindmap.Document {
	return mindmap.Document{
		ID:    id,
		Title: title,
		Theme: mindmap.ThemeLight,
		Nodes: []mindmap.Node{
			{
				ID:        "root",
				Kind:      mindmap.NodeKindRoot,
				Title:     title,
				Position:  mindmap.Position{X: 820, Y: 320},
				CreatedAt: lastEditedAt,
				UpdatedAt: lastEditedAt,
			},
		},
		Relations: []mindmap.RelationEdge{},
		Meta: mindmap.Meta{
			Version:      1,
			LastEditedAt: lastEditedAt,
			LastOpenedAt: lastOpenedAt,
		},
	}
}

func writeTestDocument(t *testing.T, storePath string, doc mindmap.Document) {
	t.Helper()

	payload, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		t.Fatalf("failed to marshal test document: %v", err)
	}
	if err := os.WriteFile(filepath.Join(storePath, doc.ID+".json"), payload, 0o644); err != nil {
		t.Fatalf("failed to write test document: %v", err)
	}
}

func readStoredDocument(t *testing.T, storePath string, id string) mindmap.Document {
	t.Helper()

	payload, err := os.ReadFile(filepath.Join(storePath, id+".json"))
	if err != nil {
		t.Fatalf("failed to read stored document: %v", err)
	}

	var doc mindmap.Document
	if err := json.Unmarshal(payload, &doc); err != nil {
		t.Fatalf("failed to decode stored document: %v", err)
	}
	return doc
}

func writeOpenAIChatResponse(t *testing.T, w http.ResponseWriter, model string, content string) {
	t.Helper()

	payload, err := json.Marshal(map[string]any{
		"model": model,
		"choices": []map[string]any{
			{
				"message": map[string]any{
					"role":    "assistant",
					"content": content,
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("failed to marshal chat response: %v", err)
	}

	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(payload)
}

func documentMaxDepth(doc mindmap.Document) int {
	maxDepth := 0
	parentByID := make(map[string]string, len(doc.Nodes))
	for _, node := range doc.Nodes {
		parentByID[node.ID] = node.ParentID
	}

	for _, node := range doc.Nodes {
		if node.Kind == mindmap.NodeKindRoot {
			continue
		}

		depth := 0
		current := node.ID
		visited := map[string]struct{}{}
		for current != "" {
			parentID := parentByID[current]
			if parentID == "" {
				break
			}
			if _, seen := visited[current]; seen {
				depth = 0
				break
			}
			visited[current] = struct{}{}
			depth++
			current = parentID
		}

		if depth > maxDepth {
			maxDepth = depth
		}
	}

	return maxDepth
}
