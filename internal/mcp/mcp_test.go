package mcp

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// helper to create a JSON-RPC message with Content-Length framing
func makeMessage(t *testing.T, method string, id any, params any) string {
	t.Helper()
	req := jsonrpcRequest{
		JSONRPC: "2.0",
		ID:      id,
		Method:  method,
	}
	if params != nil {
		p, err := json.Marshal(params)
		if err != nil {
			t.Fatal(err)
		}
		req.Params = p
	}
	body, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	return fmt.Sprintf("Content-Length: %d\r\n\r\n%s", len(body), body)
}

// helper to read a JSON-RPC response from a reader
func readResponse(t *testing.T, reader *bufio.Reader) jsonrpcResponse {
	t.Helper()
	msg, err := readMessage(reader)
	if err != nil {
		t.Fatalf("failed to read response: %v", err)
	}
	var resp jsonrpcResponse
	if err := json.Unmarshal(msg, &resp); err != nil {
		t.Fatalf("failed to unmarshal response: %v (raw: %s)", err, string(msg))
	}
	return resp
}

func TestInitializeHandler(t *testing.T) {
	input := makeMessage(t, "initialize", 1, map[string]any{
		"protocolVersion": "2024-11-05",
		"capabilities":    map[string]any{},
		"clientInfo":      map[string]any{"name": "test", "version": "1.0"},
	})

	var buf bytes.Buffer
	srv := newMCPServer()
	srv.out = &buf

	reader := bufio.NewReader(strings.NewReader(input))
	msg, err := readMessage(reader)
	if err != nil {
		t.Fatal(err)
	}
	var req jsonrpcRequest
	json.Unmarshal(msg, &req)
	srv.handleRequest(req)

	respReader := bufio.NewReader(&buf)
	resp := readResponse(t, respReader)

	if resp.Error != nil {
		t.Fatalf("unexpected error: %v", resp.Error)
	}

	var result mcpInitializeResult
	if err := json.Unmarshal(resp.Result, &result); err != nil {
		t.Fatalf("failed to unmarshal result: %v", err)
	}

	if result.ProtocolVersion != "2024-11-05" {
		t.Errorf("expected protocol version 2024-11-05, got %s", result.ProtocolVersion)
	}
	if result.ServerInfo.Name != "codemind-mcp" {
		t.Errorf("expected server name codemind-mcp, got %s", result.ServerInfo.Name)
	}
	if result.ServerInfo.Version != "1.0.0" {
		t.Errorf("expected server version 1.0.0, got %s", result.ServerInfo.Version)
	}
	if result.Capabilities.Tools == nil {
		t.Fatal("expected tools capability to be present")
	}
}

func TestToolsListHandler(t *testing.T) {
	input := makeMessage(t, "tools/list", 2, nil)

	var buf bytes.Buffer
	srv := newMCPServer()
	srv.out = &buf

	reader := bufio.NewReader(strings.NewReader(input))
	msg, err := readMessage(reader)
	if err != nil {
		t.Fatal(err)
	}
	var req jsonrpcRequest
	json.Unmarshal(msg, &req)
	srv.handleRequest(req)

	respReader := bufio.NewReader(&buf)
	resp := readResponse(t, respReader)

	if resp.Error != nil {
		t.Fatalf("unexpected error: %v", resp.Error)
	}

	var result mcpToolsListResult
	if err := json.Unmarshal(resp.Result, &result); err != nil {
		t.Fatalf("failed to unmarshal result: %v", err)
	}

	if len(result.Tools) != 8 {
		t.Fatalf("expected 8 tools, got %d", len(result.Tools))
	}

	expectedTools := []string{
		"list_maps", "get_tree", "get_node", "create_node",
		"update_node", "delete_node", "batch_operations", "import_fragment",
	}
	for i, expected := range expectedTools {
		if result.Tools[i].Name != expected {
			t.Errorf("tool %d: expected name %q, got %q", i, expected, result.Tools[i].Name)
		}
		if result.Tools[i].Description == "" {
			t.Errorf("tool %d (%s): description should not be empty", i, expected)
		}
		if len(result.Tools[i].InputSchema) == 0 {
			t.Errorf("tool %d (%s): inputSchema should not be empty", i, expected)
		}
	}
}

func TestEnvironmentVariables(t *testing.T) {
	// Test default values
	os.Unsetenv("CODEMIND_API_URL")
	os.Unsetenv("CODEMIND_API_KEY")
	srv := newMCPServer()
	if srv.apiURL != "http://127.0.0.1:34117" {
		t.Errorf("expected default API URL http://127.0.0.1:34117, got %s", srv.apiURL)
	}
	if srv.apiKey != "" {
		t.Errorf("expected empty API key, got %s", srv.apiKey)
	}

	// Test custom values
	os.Setenv("CODEMIND_API_URL", "http://localhost:9999")
	os.Setenv("CODEMIND_API_KEY", "test-key-123")
	defer os.Unsetenv("CODEMIND_API_URL")
	defer os.Unsetenv("CODEMIND_API_KEY")

	srv = newMCPServer()
	if srv.apiURL != "http://localhost:9999" {
		t.Errorf("expected API URL http://localhost:9999, got %s", srv.apiURL)
	}
	if srv.apiKey != "test-key-123" {
		t.Errorf("expected API key test-key-123, got %s", srv.apiKey)
	}
}

func TestIsReadOp(t *testing.T) {
	readOps := []string{"list_maps", "get_tree", "get_node"}
	writeOps := []string{"create_node", "update_node", "delete_node", "batch_operations", "import_fragment"}

	for _, op := range readOps {
		if !isReadOp(op) {
			t.Errorf("expected %s to be a read operation", op)
		}
	}
	for _, op := range writeOps {
		if isReadOp(op) {
			t.Errorf("expected %s to NOT be a read operation", op)
		}
	}
}

func TestBuildHTTPRequest(t *testing.T) {
	srv := newMCPServer()

	tests := []struct {
		name       string
		tool       string
		args       map[string]any
		wantMethod string
		wantPath   string
		wantErr    bool
	}{
		{
			name:       "list_maps",
			tool:       "list_maps",
			args:       map[string]any{},
			wantMethod: "GET",
			wantPath:   "/api/maps",
		},
		{
			name:       "get_tree",
			tool:       "get_tree",
			args:       map[string]any{"mapId": "map-123"},
			wantMethod: "GET",
			wantPath:   "/api/maps/map-123/tree",
		},
		{
			name:    "get_tree missing mapId",
			tool:    "get_tree",
			args:    map[string]any{},
			wantErr: true,
		},
		{
			name:       "get_node",
			tool:       "get_node",
			args:       map[string]any{"mapId": "map-123", "nodeId": "node-456"},
			wantMethod: "GET",
			wantPath:   "/api/maps/map-123/nodes/node-456",
		},
		{
			name:       "create_node",
			tool:       "create_node",
			args:       map[string]any{"mapId": "map-123", "expectedRevision": float64(7), "parentId": "root", "title": "Test"},
			wantMethod: "POST",
			wantPath:   "/api/maps/map-123/nodes",
		},
		{
			name:       "update_node",
			tool:       "update_node",
			args:       map[string]any{"mapId": "map-123", "nodeId": "node-456", "expectedRevision": float64(7), "title": "Updated"},
			wantMethod: "PATCH",
			wantPath:   "/api/maps/map-123/nodes/node-456",
		},
		{
			name:       "delete_node",
			tool:       "delete_node",
			args:       map[string]any{"mapId": "map-123", "nodeId": "node-456", "expectedRevision": float64(7)},
			wantMethod: "DELETE",
			wantPath:   "/api/maps/map-123/nodes/node-456",
		},
		{
			name:       "batch_operations",
			tool:       "batch_operations",
			args:       map[string]any{"mapId": "map-123", "expectedRevision": float64(7), "operations": []any{}},
			wantMethod: "POST",
			wantPath:   "/api/maps/map-123/batch",
		},
		{
			name:       "import_fragment",
			tool:       "import_fragment",
			args:       map[string]any{"mapId": "map-123", "expectedRevision": float64(7), "nodes": []any{}},
			wantMethod: "POST",
			wantPath:   "/api/maps/map-123/import-fragment",
		},
		{
			name:    "unknown tool",
			tool:    "unknown_tool",
			args:    map[string]any{},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			method, path, _, err := srv.buildHTTPRequest(tt.tool, tt.args)
			if tt.wantErr {
				if err == nil {
					t.Error("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if method != tt.wantMethod {
				t.Errorf("expected method %s, got %s", tt.wantMethod, method)
			}
			if path != tt.wantPath {
				t.Errorf("expected path %s, got %s", tt.wantPath, path)
			}
		})
	}
}

func TestWriteToolsRequireExpectedRevision(t *testing.T) {
	srv := newMCPServer()
	for _, tool := range []string{"create_node", "update_node", "delete_node", "batch_operations", "import_fragment"} {
		_, _, _, err := srv.buildHTTPRequest(tool, map[string]any{"mapId": "map-123"})
		if err == nil || !strings.Contains(err.Error(), "expectedRevision is required") {
			t.Fatalf("%s should require expectedRevision, got %v", tool, err)
		}
	}
}

func TestWriteToolSchemasRequireExpectedRevision(t *testing.T) {
	for _, tool := range getToolManifest() {
		if !isWriteOp(tool.Name) {
			continue
		}
		var schema struct {
			Required []string `json:"required"`
		}
		if err := json.Unmarshal(tool.InputSchema, &schema); err != nil {
			t.Fatalf("%s schema is invalid: %v", tool.Name, err)
		}
		found := false
		for _, field := range schema.Required {
			if field == "expectedRevision" {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("%s schema does not require expectedRevision", tool.Name)
		}
	}
}

func TestExecuteWriteSendsIfMatchAndReturnsNewRevision(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("If-Match"); got != `"rev-7"` {
			t.Fatalf("expected If-Match rev-7, got %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("ETag", `"rev-8"`)
		_, _ = w.Write([]byte(`{"id":"node-1","title":"Test"}`))
	}))
	defer backend.Close()

	srv := newMCPServer()
	srv.apiURL = backend.URL
	result, err := srv.executeToolCall("create_node", map[string]any{
		"mapId":            "map-123",
		"expectedRevision": float64(7),
		"parentId":         "root",
		"title":            "Test",
	})
	if err != nil {
		t.Fatal(err)
	}

	var payload struct {
		Revision uint64         `json:"revision"`
		Result   map[string]any `json:"result"`
	}
	if err := json.Unmarshal([]byte(result), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Revision != 8 || payload.Result["id"] != "node-1" {
		t.Fatalf("unexpected wrapped result: %s", result)
	}
}

func TestUnknownMethodReturnsError(t *testing.T) {
	input := makeMessage(t, "unknown/method", 99, nil)

	var buf bytes.Buffer
	srv := newMCPServer()
	srv.out = &buf

	reader := bufio.NewReader(strings.NewReader(input))
	msg, err := readMessage(reader)
	if err != nil {
		t.Fatal(err)
	}
	var req jsonrpcRequest
	json.Unmarshal(msg, &req)
	srv.handleRequest(req)

	respReader := bufio.NewReader(&buf)
	resp := readResponse(t, respReader)

	if resp.Error == nil {
		t.Fatal("expected error response for unknown method")
	}
	if resp.Error.Code != -32601 {
		t.Errorf("expected error code -32601, got %d", resp.Error.Code)
	}
}
