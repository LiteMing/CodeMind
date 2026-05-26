package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log"
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

// MCPServer holds the server state and configuration.
type MCPServer struct {
	apiURL     string
	apiKey     string
	httpClient *http.Client
	out        io.Writer
}

func newMCPServer() *MCPServer {
	apiURL := os.Getenv("CODEMIND_API_URL")
	if apiURL == "" {
		apiURL = "http://127.0.0.1:34117"
	}
	apiKey := os.Getenv("CODEMIND_API_KEY")

	return &MCPServer{
		apiURL: apiURL,
		apiKey: apiKey,
		out:    os.Stdout,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func main() {
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
		toolResult := mcpToolResult{
			Content: []mcpContent{{Type: "text", Text: err.Error()}},
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

	// Forward API key if configured
	if s.apiKey != "" {
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

	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	return string(respBody), nil
}

// buildHTTPRequest maps a tool name and arguments to an HTTP method, path, and body.
func (s *MCPServer) buildHTTPRequest(name string, args map[string]any) (method string, path string, body any, err error) {
	mapID, _ := args["mapId"].(string)
	nodeID, _ := args["nodeId"].(string)

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
	for _, key := range []string{"parentId", "title", "note", "kind", "priority", "color"} {
		if v, ok := args[key]; ok {
			payload[key] = v
		}
	}
	return payload
}

func buildUpdatePayload(args map[string]any) map[string]any {
	payload := map[string]any{}
	for _, key := range []string{"title", "note", "priority", "color", "collapsed"} {
		if v, ok := args[key]; ok {
			payload[key] = v
		}
	}
	return payload
}

func buildImportFragmentPayload(args map[string]any) map[string]any {
	payload := map[string]any{}
	if nodes, ok := args["nodes"]; ok {
		payload["nodes"] = nodes
	}
	if parentID, ok := args["parentId"]; ok {
		payload["parentId"] = parentID
	}
	return payload
}

func isReadOp(name string) bool {
	switch name {
	case "list_maps", "get_tree", "get_node":
		return true
	}
	return false
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
			Description: "List all mindmaps. Returns an array of map summaries with id, title, and timestamps.",
			InputSchema: json.RawMessage(`{
				"type": "object",
				"properties": {},
				"required": []
			}`),
		},
		{
			Name:        "get_tree",
			Description: "Get a mindmap as a nested tree structure. Returns the full hierarchy with nodes and their children. Recommended for understanding map context.",
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
			Description: "Get a single node with its ancestors chain and direct children. Useful for focused context around a specific node.",
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
			Description: "Create a new node in a mindmap. The node is added as a child of the specified parent node. Position is automatically calculated.",
			InputSchema: json.RawMessage(`{
				"type": "object",
				"properties": {
					"mapId": {
						"type": "string",
						"description": "The ID of the mindmap to add the node to"
					},
					"parentId": {
						"type": "string",
						"description": "The ID of the parent node to attach the new node under"
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
					}
				},
				"required": ["mapId", "parentId", "title"]
			}`),
		},
		{
			Name:        "update_node",
			Description: "Update fields of an existing node. Only specified fields are modified; others remain unchanged.",
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
					}
				},
				"required": ["mapId", "nodeId"]
			}`),
		},
		{
			Name:        "delete_node",
			Description: "Delete a node from the mindmap. By default, cascades to delete all descendant nodes. The root node cannot be deleted.",
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
					"cascade": {
						"type": "boolean",
						"description": "If true (default), delete all descendant nodes. If false, re-parent children to the deleted node's parent."
					}
				},
				"required": ["mapId", "nodeId"]
			}`),
		},
		{
			Name:        "batch_operations",
			Description: "Execute multiple node operations atomically. All operations succeed or all are rolled back. Supports create, update, and delete actions.",
			InputSchema: json.RawMessage(`{
				"type": "object",
				"properties": {
					"mapId": {
						"type": "string",
						"description": "The ID of the mindmap to operate on"
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
									"description": "Operation payload (fields depend on action type)"
								}
							},
							"required": ["action"]
						}
					}
				},
				"required": ["mapId", "operations"]
			}`),
		},
		{
			Name:        "import_fragment",
			Description: "Import a JSON subtree into the mindmap. Recursively creates an entire branch structure with nested children. Useful for bulk node creation.",
			InputSchema: json.RawMessage(`{
				"type": "object",
				"properties": {
					"mapId": {
						"type": "string",
						"description": "The ID of the mindmap to import into"
					},
					"parentId": {
						"type": "string",
						"description": "The ID of the parent node to attach the imported subtree under. Defaults to root if omitted."
					},
					"nodes": {
						"type": "array",
						"description": "Array of node objects to import. Each node can have nested 'children' arrays for recursive creation.",
						"items": {
							"type": "object",
							"properties": {
								"title": {
									"type": "string",
									"description": "Node title"
								},
								"note": {
									"type": "string",
									"description": "Optional node note"
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
				"required": ["mapId", "nodes"]
			}`),
		},
	}
}
