package mcp

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// JSON-RPC 2.0 message types
type jsonrpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      any             `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type jsonrpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      any             `json:"id"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *jsonrpcError   `json:"error,omitempty"`
}

type jsonrpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// MCP-specific types
type mcpInitializeResult struct {
	ProtocolVersion string          `json:"protocolVersion"`
	Capabilities    mcpCapabilities `json:"capabilities"`
	ServerInfo      mcpServerInfo   `json:"serverInfo"`
}

type mcpCapabilities struct {
	Tools *mcpToolsCapability `json:"tools,omitempty"`
}

type mcpToolsCapability struct {
	ListChanged bool `json:"listChanged"`
}

type mcpServerInfo struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

type mcpTool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"inputSchema"`
}

type mcpToolsListResult struct {
	Tools []mcpTool `json:"tools"`
}

type mcpToolCallParams struct {
	Name      string         `json:"name"`
	Arguments map[string]any `json:"arguments"`
}

type mcpToolResult struct {
	Content []mcpContent `json:"content"`
	IsError bool         `json:"isError,omitempty"`
}

type mcpContent struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type toolCallError struct {
	text string
}

func (e *toolCallError) Error() string {
	return e.text
}

type revisionConflictPayload struct {
	Error revisionConflictDetails `json:"error"`
}

type revisionConflictDetails struct {
	Code             string `json:"code"`
	HTTPStatus       int    `json:"httpStatus"`
	Message          string `json:"message"`
	ExpectedRevision uint64 `json:"expectedRevision"`
	ActualRevision   uint64 `json:"actualRevision"`
}

type writeCommandEnvelope struct {
	ExpectedRevision uint64
	Partition        string
	IdempotencyKey   string
}

// MCPServer holds the server state and configuration.
type MCPServer struct {
	apiURL      string
	apiKey      string
	accessToken string
	httpClient  *http.Client
	out         io.Writer
}

func newMCPServer() *MCPServer {
	apiURL := os.Getenv("CODEMIND_API_URL")
	if apiURL == "" {
		apiURL = "http://127.0.0.1:34117"
	}
	apiKey := os.Getenv("CODEMIND_API_KEY")
	accessToken := os.Getenv("CODEMIND_ACCESS_TOKEN")

	return &MCPServer{
		apiURL:      apiURL,
		apiKey:      apiKey,
		accessToken: accessToken,
		out:         os.Stdout,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// Run starts the stdio MCP adapter. It blocks until stdin is closed.
func Run() {
	// Disable log output to stdout (MCP uses stdout for JSON-RPC)
	log.SetOutput(os.Stderr)

	srv := newMCPServer()
	srv.run()
}

func (s *MCPServer) run() {
	reader := bufio.NewReader(os.Stdin)

	for {
		msg, err := readMessage(reader)
		if err != nil {
			if err == io.EOF {
				return
			}
			log.Printf("error reading message: %v", err)
			return
		}

		var req jsonrpcRequest
		if err := json.Unmarshal(msg, &req); err != nil {
			s.writeError(nil, -32700, "Parse error")
			continue
		}

		if req.JSONRPC != "2.0" {
			s.writeError(req.ID, -32600, "Invalid Request: jsonrpc must be \"2.0\"")
			continue
		}

		s.handleRequest(req)
	}
}

func (s *MCPServer) handleRequest(req jsonrpcRequest) {
	switch req.Method {
	case "initialize":
		s.handleInitialize(req)
	case "initialized":
		// Notification, no response needed
	case "tools/list":
		s.handleToolsList(req)
	case "tools/call":
		s.handleToolCall(req)
	case "ping":
		s.writeResult(req.ID, json.RawMessage(`{}`))
	default:
		s.writeError(req.ID, -32601, fmt.Sprintf("Method not found: %s", req.Method))
	}
}

func (s *MCPServer) handleInitialize(req jsonrpcRequest) {
	result := mcpInitializeResult{
		ProtocolVersion: "2024-11-05",
		Capabilities: mcpCapabilities{
			Tools: &mcpToolsCapability{
				ListChanged: false,
			},
		},
		ServerInfo: mcpServerInfo{
			Name:    "codemind-mcp",
			Version: "1.0.0",
		},
	}

	data, _ := json.Marshal(result)
	s.writeResult(req.ID, data)
}

func (s *MCPServer) handleToolsList(req jsonrpcRequest) {
	result := mcpToolsListResult{
		Tools: getToolManifest(),
	}

	data, _ := json.Marshal(result)
	s.writeResult(req.ID, data)
}

func (s *MCPServer) handleToolCall(req jsonrpcRequest) {
	var params mcpToolCallParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		s.writeError(req.ID, -32602, "Invalid params: "+err.Error())
		return
	}

	result, err := s.executeToolCall(params.Name, params.Arguments)
	if err != nil {
		text := err.Error()
		var toolErr *toolCallError
		if errors.As(err, &toolErr) {
			text = toolErr.text
		}
		toolResult := mcpToolResult{
			Content: []mcpContent{{Type: "text", Text: text}},
			IsError: true,
		}
		data, _ := json.Marshal(toolResult)
		s.writeResult(req.ID, data)
		return
	}

	toolResult := mcpToolResult{
		Content: []mcpContent{{Type: "text", Text: result}},
	}
	data, _ := json.Marshal(toolResult)
	s.writeResult(req.ID, data)
}

// executeToolCall translates an MCP tool call into an HTTP request to the Code Mind REST API.
func (s *MCPServer) executeToolCall(name string, args map[string]any) (string, error) {
	method, urlPath, body, err := s.buildHTTPRequest(name, args)
	if err != nil {
		return "", err
	}

	fullURL := s.apiURL + urlPath

	var bodyReader io.Reader
	if body != nil {
		bodyBytes, err := json.Marshal(body)
		if err != nil {
			return "", fmt.Errorf("failed to marshal request body: %w", err)
		}
		bodyReader = strings.NewReader(string(bodyBytes))
	}

	req, err := http.NewRequest(method, fullURL, bodyReader)
	if err != nil {
		return "", fmt.Errorf("failed to create HTTP request: %w", err)
	}

	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if isWriteOp(name) {
		envelope, err := writeCommandEnvelopeArgument(args)
		if err != nil {
			return "", err
		}
		req.Header.Set("If-Match", fmt.Sprintf(`"rev-%d"`, envelope.ExpectedRevision))
		req.Header.Set("X-CodeMind-Partition", envelope.Partition)
		req.Header.Set("Idempotency-Key", envelope.IdempotencyKey)
	}

	// Bearer credentials carry actor identity, so they take precedence when
	// both legacy API-key and token configuration are present.
	if s.accessToken != "" {
		req.Header.Set("Authorization", "Bearer "+s.accessToken)
	} else if s.apiKey != "" {
		req.Header.Set("X-API-Key", s.apiKey)
	}

	// Append compact=true for read operations
	if isReadOp(name) {
		q := req.URL.Query()
		q.Set("compact", "true")
		req.URL.RawQuery = q.Encode()
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("Code Mind backend unavailable: %v", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode == http.StatusPreconditionFailed {
		if conflictErr := newRevisionConflictToolError(respBody); conflictErr != nil {
			return "", conflictErr
		}
	}
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(respBody))
	}
	if isWriteOp(name) {
		return wrapWriteResultWithRevision(respBody, resp.Header.Get("ETag"))
	}

	return string(respBody), nil
}

// buildHTTPRequest maps a tool name and arguments to an HTTP method, path, and body.
func (s *MCPServer) buildHTTPRequest(name string, args map[string]any) (method string, path string, body any, err error) {
	mapID, _ := args["mapId"].(string)
	nodeID, _ := args["nodeId"].(string)
	if isWriteOp(name) {
		if _, err := writeCommandEnvelopeArgument(args); err != nil {
			return "", "", nil, err
		}
	}

	switch name {
	case "list_maps":
		return http.MethodGet, "/api/maps", nil, nil

	case "get_tree":
		if mapID == "" {
			return "", "", nil, fmt.Errorf("mapId is required")
		}
		return http.MethodGet, "/api/maps/" + mapID + "/tree", nil, nil

	case "get_node":
		if mapID == "" {
			return "", "", nil, fmt.Errorf("mapId is required")
		}
		if nodeID == "" {
			return "", "", nil, fmt.Errorf("nodeId is required")
		}
		return http.MethodGet, "/api/maps/" + mapID + "/nodes/" + nodeID, nil, nil

	case "create_node":
		if mapID == "" {
			return "", "", nil, fmt.Errorf("mapId is required")
		}
		payload := buildCreatePayload(args)
		return http.MethodPost, "/api/maps/" + mapID + "/nodes", payload, nil

	case "update_node":
		if mapID == "" {
			return "", "", nil, fmt.Errorf("mapId is required")
		}
		if nodeID == "" {
			return "", "", nil, fmt.Errorf("nodeId is required")
		}
		payload := buildUpdatePayload(args)
		return http.MethodPatch, "/api/maps/" + mapID + "/nodes/" + nodeID, payload, nil

	case "delete_node":
		if mapID == "" {
			return "", "", nil, fmt.Errorf("mapId is required")
		}
		if nodeID == "" {
			return "", "", nil, fmt.Errorf("nodeId is required")
		}
		path := "/api/maps/" + mapID + "/nodes/" + nodeID
		if cascade, ok := args["cascade"]; ok {
			path += "?cascade=" + fmt.Sprintf("%v", cascade)
		}
		return http.MethodDelete, path, nil, nil

	case "batch_operations":
		if mapID == "" {
			return "", "", nil, fmt.Errorf("mapId is required")
		}
		operations, _ := args["operations"]
		payload := map[string]any{"operations": operations}
		return http.MethodPost, "/api/maps/" + mapID + "/batch", payload, nil

	case "import_fragment":
		if mapID == "" {
			return "", "", nil, fmt.Errorf("mapId is required")
		}
		payload := buildImportFragmentPayload(args)
		return http.MethodPost, "/api/maps/" + mapID + "/import-fragment", payload, nil

	default:
		return "", "", nil, fmt.Errorf("unknown tool: %s", name)
	}
}

func buildCreatePayload(args map[string]any) map[string]any {
	payload := map[string]any{}
	for _, key := range []string{"parentId", "order", "title", "note", "kind", "priority", "color", "bindings"} {
		if v, ok := args[key]; ok {
			payload[key] = v
		}
	}
	return payload
}

func buildUpdatePayload(args map[string]any) map[string]any {
	payload := map[string]any{}
	for _, key := range []string{"parentId", "order", "title", "note", "priority", "color", "bindings", "collapsed"} {
		if v, ok := args[key]; ok {
			payload[key] = v
		}
	}
	return payload
}

func buildImportFragmentPayload(args map[string]any) map[string]any {
	payload := map[string]any{}
	nodes, ok := args["nodes"]
	if !ok {
		return payload
	}

	// The REST contract stores parentId on each top-level fragment node. Keep
	// the MCP convenience argument by applying it only where a node omits one.
	parentID, _ := args["parentId"].(string)
	if strings.TrimSpace(parentID) != "" {
		if nodeList, isList := nodes.([]any); isList {
			withParent := make([]any, len(nodeList))
			for index, item := range nodeList {
				node, isObject := item.(map[string]any)
				if !isObject {
					withParent[index] = item
					continue
				}
				copyOfNode := make(map[string]any, len(node)+1)
				for key, value := range node {
					copyOfNode[key] = value
				}
				if existing, hasParent := copyOfNode["parentId"].(string); !hasParent || strings.TrimSpace(existing) == "" {
					copyOfNode["parentId"] = parentID
				}
				withParent[index] = copyOfNode
			}
			nodes = withParent
		}
	}
	payload["nodes"] = nodes
	return payload
}

func isReadOp(name string) bool {
	switch name {
	case "list_maps", "get_tree", "get_node":
		return true
	}
	return false
}

func isWriteOp(name string) bool {
	switch name {
	case "create_node", "update_node", "delete_node", "batch_operations", "import_fragment":
		return true
	default:
		return false
	}
}

func expectedRevisionArgument(args map[string]any) (uint64, error) {
	value, ok := args["expectedRevision"]
	if !ok {
		return 0, fmt.Errorf("expectedRevision is required")
	}
	number, ok := value.(float64)
	const maxSafeJSONInteger = 9_007_199_254_740_991
	if !ok || math.Trunc(number) != number || number < 1 || number > maxSafeJSONInteger {
		return 0, fmt.Errorf("expectedRevision must be a positive integer")
	}
	return uint64(number), nil
}

func writeCommandEnvelopeArgument(args map[string]any) (writeCommandEnvelope, error) {
	expectedRevision, err := expectedRevisionArgument(args)
	if err != nil {
		return writeCommandEnvelope{}, err
	}

	partition, ok := args["partition"].(string)
	partition = strings.TrimSpace(partition)
	if !ok || partition == "" {
		return writeCommandEnvelope{}, fmt.Errorf("partition is required")
	}
	switch partition {
	case "requirements", "development", "stable":
	default:
		return writeCommandEnvelope{}, fmt.Errorf("partition must be requirements, development, or stable")
	}

	idempotencyKey, ok := args["idempotencyKey"].(string)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if !ok || idempotencyKey == "" {
		return writeCommandEnvelope{}, fmt.Errorf("idempotencyKey is required")
	}

	return writeCommandEnvelope{
		ExpectedRevision: expectedRevision,
		Partition:        partition,
		IdempotencyKey:   idempotencyKey,
	}, nil
}

func newRevisionConflictToolError(payload []byte) error {
	var backend struct {
		ExpectedRevision uint64 `json:"expectedRevision"`
		ActualRevision   uint64 `json:"actualRevision"`
	}
	if err := json.Unmarshal(payload, &backend); err != nil || backend.ExpectedRevision == 0 || backend.ActualRevision == 0 {
		return nil
	}

	encoded, err := json.Marshal(revisionConflictPayload{
		Error: revisionConflictDetails{
			Code:             "revision_conflict",
			HTTPStatus:       http.StatusPreconditionFailed,
			Message:          "revision conflict",
			ExpectedRevision: backend.ExpectedRevision,
			ActualRevision:   backend.ActualRevision,
		},
	})
	if err != nil {
		return nil
	}
	return &toolCallError{text: string(encoded)}
}

func wrapWriteResultWithRevision(payload []byte, etag string) (string, error) {
	revisionText := strings.TrimPrefix(strings.Trim(etag, `"`), "rev-")
	revision, err := strconv.ParseUint(revisionText, 10, 64)
	if err != nil || revision == 0 {
		return "", fmt.Errorf("Code Mind backend returned a write response without a valid ETag")
	}

	var result any
	if err := json.Unmarshal(payload, &result); err != nil {
		return "", fmt.Errorf("failed to decode write response: %w", err)
	}
	wrapper, err := json.Marshal(map[string]any{
		"revision": revision,
		"result":   result,
	})
	if err != nil {
		return "", fmt.Errorf("failed to encode write response: %w", err)
	}
	return string(wrapper), nil
}

// readMessage reads a JSON-RPC message from stdin using Content-Length header framing.
func readMessage(reader *bufio.Reader) ([]byte, error) {
	// Read headers until empty line
	contentLength := -1
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return nil, err
		}
		line = strings.TrimSpace(line)
		if line == "" {
			break
		}
		if strings.HasPrefix(strings.ToLower(line), "content-length:") {
			valStr := strings.TrimSpace(line[len("content-length:"):])
			val, err := strconv.Atoi(valStr)
			if err != nil {
				return nil, fmt.Errorf("invalid Content-Length: %s", valStr)
			}
			contentLength = val
		}
	}

	if contentLength < 0 {
		return nil, fmt.Errorf("missing Content-Length header")
	}

	// Read exactly contentLength bytes
	buf := make([]byte, contentLength)
	_, err := io.ReadFull(reader, buf)
	if err != nil {
		return nil, err
	}

	return buf, nil
}

// writeMessage writes a JSON-RPC response with Content-Length header framing to the server's output.
func (s *MCPServer) writeMessage(data []byte) {
	header := fmt.Sprintf("Content-Length: %d\r\n\r\n", len(data))
	io.WriteString(s.out, header)
	s.out.Write(data)
}

func (s *MCPServer) writeResult(id any, result json.RawMessage) {
	resp := jsonrpcResponse{
		JSONRPC: "2.0",
		ID:      id,
		Result:  result,
	}
	data, _ := json.Marshal(resp)
	s.writeMessage(data)
}

func (s *MCPServer) writeError(id any, code int, message string) {
	resp := jsonrpcResponse{
		JSONRPC: "2.0",
		ID:      id,
		Error: &jsonrpcError{
			Code:    code,
			Message: message,
		},
	}
	data, _ := json.Marshal(resp)
	s.writeMessage(data)
}

// getToolManifest returns the 8 MCP tools with descriptions and input schemas.
func getToolManifest() []mcpTool {
	return []mcpTool{
		{
			Name:        "list_maps",
			Description: "List all mindmaps. Returns map summaries with id, title, revision, and timestamps.",
			InputSchema: json.RawMessage(`{
				"type": "object",
				"properties": {},
				"required": []
			}`),
		},
		{
			Name:        "get_tree",
			Description: "Get a mindmap as a nested tree structure. The root includes the current revision required by write tools.",
			InputSchema: json.RawMessage(`{
				"type": "object",
				"properties": {
					"mapId": {
						"type": "string",
						"description": "The ID of the mindmap to retrieve"
					}
				},
				"required": ["mapId"]
			}`),
		},
		{
			Name:        "get_node",
			Description: "Get a node with its ancestors, children, and the current map revision required by write tools.",
			InputSchema: json.RawMessage(`{
				"type": "object",
				"properties": {
					"mapId": {
						"type": "string",
						"description": "The ID of the mindmap containing the node"
					},
					"nodeId": {
						"type": "string",
						"description": "The ID of the node to retrieve"
					}
				},
				"required": ["mapId", "nodeId"]
			}`),
		},
		{
			Name:        "create_node",
			Description: "Create a new node using optimistic concurrency. Optional order inserts it at that sibling position; bindings attach repository-relative code anchors. Returns the new revision and created node.",
			InputSchema: json.RawMessage(`{
				"type": "object",
				"properties": {
					"mapId": {
						"type": "string",
						"description": "The ID of the mindmap to add the node to"
					},
					"expectedRevision": {
						"type": "integer",
						"minimum": 1,
						"description": "Current map revision returned by list_maps, get_tree, or get_node"
					},
					"partition": {
						"type": "string",
						"enum": ["requirements", "development", "stable"],
						"description": "Target authority partition for this command"
					},
					"idempotencyKey": {
						"type": "string",
						"minLength": 1,
						"description": "Unique retry key for this logical write; reuse it only for an identical retry"
					},
					"parentId": {
						"type": "string",
						"description": "The ID of the parent node to attach the new node under"
					},
					"order": {
						"type": "integer",
						"minimum": 1,
						"description": "Optional 1-based sibling position. Omit to append after existing siblings."
					},
					"title": {
						"type": "string",
						"description": "The title/label of the new node"
					},
					"note": {
						"type": "string",
						"description": "Optional note/description for the node"
					},
					"kind": {
						"type": "string",
						"description": "Node type: 'topic' (default) or 'floating'",
						"enum": ["topic", "floating"]
					},
					"priority": {
						"type": "string",
						"description": "Priority level: '' (none), 'P0', 'P1', 'P2', or 'P3'",
						"enum": ["", "P0", "P1", "P2", "P3"]
					},
					"color": {
						"type": "string",
						"description": "Node color: '' (default), 'slate', 'blue', 'teal', 'green', 'amber', 'rose', 'violet'",
						"enum": ["", "slate", "blue", "teal", "green", "amber", "rose", "violet"]
					},
					"bindings": {
						"type": "array",
						"description": "Repository-relative code bindings. Binding IDs must be unique across the map.",
						"items": {
							"type": "object",
							"properties": {
								"id": {"type": "string", "description": "Stable binding ID, unique across the map"},
								"type": {"type": "string", "enum": ["file", "directory", "glob", "symbol", "asset"]},
								"path": {"type": "string", "description": "Repository-relative path using forward slashes; absolute and '..' paths are rejected"},
								"symbol": {"type": "string", "description": "Required only for symbol bindings"},
								"glob": {"type": "string", "description": "Required only for glob bindings"},
								"contentHash": {"type": "string", "description": "Optional content hash for future rename tracking"}
							},
							"required": ["id", "type", "path"]
						}
					}
				},
				"required": ["mapId", "expectedRevision", "partition", "idempotencyKey", "parentId", "title"]
			}`),
		},
		{
			Name:        "update_node",
			Description: "Update or move an existing node using optimistic concurrency. parentId and order change its semantic sibling placement; bindings replaces the node's binding list. Returns the new revision and updated node.",
			InputSchema: json.RawMessage(`{
				"type": "object",
				"properties": {
					"mapId": {
						"type": "string",
						"description": "The ID of the mindmap containing the node"
					},
					"nodeId": {
						"type": "string",
						"description": "The ID of the node to update"
					},
					"expectedRevision": {
						"type": "integer",
						"minimum": 1,
						"description": "Current map revision returned by list_maps, get_tree, or get_node"
					},
					"partition": {
						"type": "string",
						"enum": ["requirements", "development", "stable"],
						"description": "Target authority partition for this command"
					},
					"idempotencyKey": {
						"type": "string",
						"minLength": 1,
						"description": "Unique retry key for this logical write; reuse it only for an identical retry"
					},
					"parentId": {
						"type": "string",
						"description": "New parent node ID. Use with order to move and insert the node among the new parent's children."
					},
					"order": {
						"type": "integer",
						"minimum": 1,
						"description": "New 1-based sibling position. Existing siblings are shifted and both sibling groups are compacted after a move."
					},
					"title": {
						"type": "string",
						"description": "New title for the node"
					},
					"note": {
						"type": "string",
						"description": "New note content for the node"
					},
					"priority": {
						"type": "string",
						"description": "New priority: '' (none), 'P0', 'P1', 'P2', or 'P3'",
						"enum": ["", "P0", "P1", "P2", "P3"]
					},
					"color": {
						"type": "string",
						"description": "New color: '' (default), 'slate', 'blue', 'teal', 'green', 'amber', 'rose', 'violet'",
						"enum": ["", "slate", "blue", "teal", "green", "amber", "rose", "violet"]
					},
					"collapsed": {
						"type": "boolean",
						"description": "Whether the node's children should be collapsed/hidden"
					},
					"bindings": {
						"type": "array",
						"description": "Replacement repository binding list. Pass [] to clear all bindings.",
						"items": {
							"type": "object",
							"properties": {
								"id": {"type": "string", "description": "Stable binding ID, unique across the map"},
								"type": {"type": "string", "enum": ["file", "directory", "glob", "symbol", "asset"]},
								"path": {"type": "string", "description": "Repository-relative path using forward slashes; absolute and '..' paths are rejected"},
								"symbol": {"type": "string", "description": "Required only for symbol bindings"},
								"glob": {"type": "string", "description": "Required only for glob bindings"},
								"contentHash": {"type": "string", "description": "Optional content hash for future rename tracking"}
							},
							"required": ["id", "type", "path"]
						}
					}
				},
				"required": ["mapId", "nodeId", "expectedRevision", "partition", "idempotencyKey"]
			}`),
		},
		{
			Name:        "delete_node",
			Description: "Delete a node using optimistic concurrency. By default, cascades to descendants. Returns the new map revision.",
			InputSchema: json.RawMessage(`{
				"type": "object",
				"properties": {
					"mapId": {
						"type": "string",
						"description": "The ID of the mindmap containing the node"
					},
					"nodeId": {
						"type": "string",
						"description": "The ID of the node to delete"
					},
					"expectedRevision": {
						"type": "integer",
						"minimum": 1,
						"description": "Current map revision returned by list_maps, get_tree, or get_node"
					},
					"partition": {
						"type": "string",
						"enum": ["requirements", "development", "stable"],
						"description": "Target authority partition for this command"
					},
					"idempotencyKey": {
						"type": "string",
						"minLength": 1,
						"description": "Unique retry key for this logical write; reuse it only for an identical retry"
					},
					"cascade": {
						"type": "boolean",
						"description": "If true (default), delete all descendant nodes. If false, re-parent children to the deleted node's parent."
					}
				},
				"required": ["mapId", "nodeId", "expectedRevision", "partition", "idempotencyKey"]
			}`),
		},
		{
			Name:        "batch_operations",
			Description: "Execute multiple node operations atomically at an expected map revision. Returns the new revision and results.",
			InputSchema: json.RawMessage(`{
				"type": "object",
				"properties": {
					"mapId": {
						"type": "string",
						"description": "The ID of the mindmap to operate on"
					},
					"expectedRevision": {
						"type": "integer",
						"minimum": 1,
						"description": "Current map revision returned by list_maps, get_tree, or get_node"
					},
					"partition": {
						"type": "string",
						"enum": ["requirements", "development", "stable"],
						"description": "Target authority partition for this command"
					},
					"idempotencyKey": {
						"type": "string",
						"minLength": 1,
						"description": "Unique retry key for this logical write; reuse it only for an identical retry"
					},
					"operations": {
						"type": "array",
						"description": "Array of operations to execute atomically",
						"items": {
							"type": "object",
							"properties": {
								"action": {
									"type": "string",
									"description": "Operation type: 'create', 'update', or 'delete'",
									"enum": ["create", "update", "delete"]
								},
								"nodeId": {
									"type": "string",
									"description": "Node ID (required for update and delete)"
								},
								"payload": {
									"type": "object",
									"description": "Operation payload. create accepts parentId/order/title/note/kind/priority/color/bindings; update also supports moving via parentId/order and replacing bindings; delete accepts cascade.",
									"properties": {
										"parentId": {"type": "string"},
										"order": {"type": "integer", "minimum": 1},
										"title": {"type": "string"},
										"note": {"type": "string"},
										"kind": {"type": "string", "enum": ["topic", "floating"]},
										"priority": {"type": "string", "enum": ["", "P0", "P1", "P2", "P3"]},
										"color": {"type": "string", "enum": ["", "slate", "blue", "teal", "green", "amber", "rose", "violet"]},
										"collapsed": {"type": "boolean"},
										"cascade": {"type": "boolean"},
										"bindings": {
											"type": "array",
											"items": {
												"type": "object",
												"properties": {
													"id": {"type": "string"},
													"type": {"type": "string", "enum": ["file", "directory", "glob", "symbol", "asset"]},
													"path": {"type": "string"},
													"symbol": {"type": "string"},
													"glob": {"type": "string"},
													"contentHash": {"type": "string"}
												},
												"required": ["id", "type", "path"]
											}
										}
									}
								}
							},
							"required": ["action"]
						}
					}
				},
				"required": ["mapId", "expectedRevision", "partition", "idempotencyKey", "operations"]
			}`),
		},
		{
			Name:        "import_fragment",
			Description: "Import a JSON subtree at an expected map revision. Nodes may include explicit sibling order and repository bindings. Returns the new revision and created nodes.",
			InputSchema: json.RawMessage(`{
				"type": "object",
				"properties": {
					"mapId": {
						"type": "string",
						"description": "The ID of the mindmap to import into"
					},
					"expectedRevision": {
						"type": "integer",
						"minimum": 1,
						"description": "Current map revision returned by list_maps, get_tree, or get_node"
					},
					"partition": {
						"type": "string",
						"enum": ["requirements", "development", "stable"],
						"description": "Target authority partition for this command"
					},
					"idempotencyKey": {
						"type": "string",
						"minLength": 1,
						"description": "Unique retry key for this logical write; reuse it only for an identical retry"
					},
					"parentId": {
						"type": "string",
						"description": "Convenience parent applied to each top-level fragment node that omits parentId. Defaults to root if omitted."
					},
					"nodes": {
						"type": "array",
						"description": "Array of node objects to import. Each node can have nested 'children' arrays for recursive creation.",
						"items": {
							"type": "object",
							"properties": {
								"parentId": {
									"type": "string",
									"description": "Parent override for this top-level fragment node; nested children attach to their containing fragment node"
								},
								"order": {
									"type": "integer",
									"minimum": 1,
									"description": "Optional 1-based sibling insertion position"
								},
								"title": {
									"type": "string",
									"description": "Node title"
								},
								"note": {
									"type": "string",
									"description": "Optional node note"
								},
								"priority": {"type": "string", "enum": ["", "P0", "P1", "P2", "P3"]},
								"color": {"type": "string", "enum": ["", "slate", "blue", "teal", "green", "amber", "rose", "violet"]},
								"bindings": {
									"type": "array",
									"items": {
										"type": "object",
										"properties": {
											"id": {"type": "string"},
											"type": {"type": "string", "enum": ["file", "directory", "glob", "symbol", "asset"]},
											"path": {"type": "string"},
											"symbol": {"type": "string"},
											"glob": {"type": "string"},
											"contentHash": {"type": "string"}
										},
										"required": ["id", "type", "path"]
									}
								},
								"children": {
									"type": "array",
									"description": "Nested child nodes",
									"items": {
										"type": "object"
									}
								}
							},
							"required": ["title"]
						}
					}
				},
				"required": ["mapId", "expectedRevision", "partition", "idempotencyKey", "nodes"]
			}`),
		},
	}
}
