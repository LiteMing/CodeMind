package server

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"code-mind/internal/mindmap"
	"code-mind/internal/store"
)

const (
	defaultAIBaseURL   = "http://127.0.0.1:1234/v1"
	defaultAIMaxTokens = 3200
	defaultRootX       = 820
	defaultRootY       = 320
	defaultBranchGapX  = 280
	defaultBranchGapY  = 100
)

type Server struct {
	store      *store.FileStore
	httpClient *http.Client
}

type importRequest struct {
	Content string `json:"content"`
	Format  string `json:"format"`
}

type createMapRequest struct {
	Title string `json:"title"`
}

type renameMapRequest struct {
	Title string `json:"title"`
}

type markdownResponse struct {
	Content string `json:"content"`
}

type aiSettingsRequest struct {
	Provider  string `json:"provider"`
	BaseURL   string `json:"baseUrl"`
	Model     string `json:"model"`
	APIKey    string `json:"apiKey"`
	MaxTokens int    `json:"maxTokens"`
}

type aiRelationsRequest struct {
	Settings     aiSettingsRequest `json:"settings"`
	Document     mindmap.Document  `json:"document"`
	Instructions string            `json:"instructions"`
}

type aiTestRequest struct {
	Settings aiSettingsRequest `json:"settings"`
}

type aiRelationSuggestion struct {
	SourceID   string  `json:"sourceId"`
	TargetID   string  `json:"targetId"`
	Label      string  `json:"label"`
	Reason     string  `json:"reason"`
	Confidence float64 `json:"confidence"`
}

type aiRelationsResponse struct {
	Relations []aiRelationSuggestion `json:"relations"`
	Summary   string                 `json:"summary"`
	Model     string                 `json:"model"`
}

type aiGenerateRequest struct {
	Settings     aiSettingsRequest `json:"settings"`
	Topic        string            `json:"topic"`
	Template     string            `json:"template"`
	Instructions string            `json:"instructions"`
}

type aiGenerateResponse struct {
	Document mindmap.Document `json:"document"`
	Summary  string           `json:"summary"`
	Prompt   string           `json:"prompt"`
	Template string           `json:"template"`
	Model    string           `json:"model"`
}

type aiTestResponse struct {
	OK      bool   `json:"ok"`
	Model   string `json:"model"`
	Message string `json:"message"`
}

type aiGeneratedGraph struct {
	Title     string                `json:"title"`
	Summary   string                `json:"summary"`
	Nodes     []aiGeneratedNode     `json:"nodes"`
	Relations []aiGeneratedRelation `json:"relations"`
}

type aiGeneratedNode struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	ParentID string `json:"parentId"`
	Kind     string `json:"kind"`
	Priority string `json:"priority"`
}

type aiGeneratedRelation struct {
	SourceID string `json:"sourceId"`
	TargetID string `json:"targetId"`
	Label    string `json:"label"`
}

type openAIChatRequest struct {
	Model          string              `json:"model"`
	Messages       []openAIChatMessage `json:"messages"`
	Temperature    float64             `json:"temperature,omitempty"`
	MaxTokens      int                 `json:"max_tokens,omitempty"`
	Stream         bool                `json:"stream"`
	ResponseFormat any                 `json:"response_format,omitempty"`
}

type openAIChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openAIChatResponse struct {
	Model   string `json:"model"`
	Choices []struct {
		Message openAIChatMessage `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

type openAIModelsResponse struct {
	Data []struct {
		ID string `json:"id"`
	} `json:"data"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func New(fileStore *store.FileStore) *Server {
	return &Server{
		store: fileStore,
		httpClient: &http.Client{
			Timeout: 45 * time.Second,
		},
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	s.registerAPI(mux)
	mux.HandleFunc("/", s.handleFrontend)
	return loggingMiddleware(mux)
}

func (s *Server) APIHandler() http.Handler {
	mux := http.NewServeMux()
	s.registerAPI(mux)
	return loggingMiddleware(corsMiddleware(mux))
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) registerAPI(mux *http.ServeMux) {
	mux.HandleFunc("/api/health", s.handleHealth)
	mux.HandleFunc("/api/maps", s.handleMaps)
	mux.HandleFunc("/api/maps/", s.handleMapByID)
	mux.HandleFunc("/api/export/markdown", s.handleExportMarkdown)
	mux.HandleFunc("/api/import", s.handleImport)
	mux.HandleFunc("/api/ai/test", s.handleAITest)
	mux.HandleFunc("/api/ai/relations", s.handleAIRelations)
	mux.HandleFunc("/api/ai/generate", s.handleAIGenerate)
}

func (s *Server) handleMaps(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		summaries, err := s.store.List()
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, summaries)
	case http.MethodPost:
		var req createMapRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		doc, err := s.store.Create(req.Title)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		writeJSON(w, http.StatusCreated, doc)
	default:
		w.Header().Set("Allow", "GET, POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleMapByID(w http.ResponseWriter, r *http.Request) {
	mapID := strings.TrimPrefix(r.URL.Path, "/api/maps/")
	mapID = strings.TrimSpace(mapID)
	if mapID == "" {
		writeError(w, http.StatusBadRequest, errors.New("map id is required"))
		return
	}

	switch r.Method {
	case http.MethodGet:
		doc, err := s.store.Load(mapID)
		if err != nil {
			writeError(w, http.StatusNotFound, err)
			return
		}
		writeJSON(w, http.StatusOK, doc)
	case http.MethodPut:
		var doc mindmap.Document
		if err := json.NewDecoder(r.Body).Decode(&doc); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		doc.ID = mapID
		if err := s.store.Save(doc); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		writeJSON(w, http.StatusOK, doc)
	case http.MethodPatch:
		var req renameMapRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		doc, err := s.store.Rename(mapID, req.Title)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		writeJSON(w, http.StatusOK, doc)
	case http.MethodDelete:
		if err := s.store.Delete(mapID); err != nil {
			writeError(w, http.StatusNotFound, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
	default:
		w.Header().Set("Allow", "GET, PUT, PATCH, DELETE")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleExportMarkdown(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var doc mindmap.Document
	if err := json.NewDecoder(r.Body).Decode(&doc); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := doc.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	writeJSON(w, http.StatusOK, markdownResponse{
		Content: mindmap.ExportMarkdown(doc),
	})
}

func (s *Server) handleImport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req importRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if strings.TrimSpace(req.Content) == "" {
		writeError(w, http.StatusBadRequest, errors.New("content is required"))
		return
	}

	var doc mindmap.Document
	switch strings.ToLower(strings.TrimSpace(req.Format)) {
	case "markdown", "md":
		doc = mindmap.ImportMarkdown(req.Content)
	case "text", "txt":
		doc = mindmap.ImportPlainText(req.Content)
	default:
		writeError(w, http.StatusBadRequest, fmt.Errorf("unsupported import format: %s", req.Format))
		return
	}

	writeJSON(w, http.StatusOK, doc)
}

func (s *Server) handleAIRelations(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req aiRelationsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := req.Document.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	result, err := s.suggestAIRelations(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleAITest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req aiTestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	result, err := s.testAIConnection(req.Settings)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleAIGenerate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req aiGenerateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if strings.TrimSpace(req.Topic) == "" {
		writeError(w, http.StatusBadRequest, errors.New("topic is required"))
		return
	}

	result, err := s.generateAIDocument(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) suggestAIRelations(req aiRelationsRequest) (aiRelationsResponse, error) {
	type relationPayload struct {
		Summary   string                 `json:"summary"`
		Relations []aiRelationSuggestion `json:"relations"`
	}

	systemPrompt := strings.Join([]string{
		"You analyze a mind map and propose semantic relation lines between nodes.",
		"Only suggest non-hierarchical links that add useful context beyond the existing parent-child structure.",
		"Prefer concise labels like causes, blocks, depends on, reinforces, compares with, example of, impacts.",
		"Avoid duplicates, reverse duplicates, self-links, and ancestor-descendant links.",
	}, "\n")

	documentPayload, err := marshalMindMapForPrompt(req.Document)
	if err != nil {
		return aiRelationsResponse{}, err
	}

	userPrompt := strings.Join([]string{
		"Mind map document:",
		documentPayload,
		"",
		"Task:",
		"- Suggest up to 12 new semantic relations.",
		"- Ignore relations that already exist.",
		"- Ignore direct or indirect parent-child chains.",
		"- Return labels in the same language as the node titles when possible.",
		"- Confidence is a number between 0 and 1.",
		optionalInstructionBlock(req.Instructions),
	}, "\n")

	schema := map[string]any{
		"type": "json_schema",
		"json_schema": map[string]any{
			"name":   "mind_map_relations",
			"strict": true,
			"schema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"summary": map[string]any{"type": "string"},
					"relations": map[string]any{
						"type": "array",
						"items": map[string]any{
							"type": "object",
							"properties": map[string]any{
								"sourceId":   map[string]any{"type": "string"},
								"targetId":   map[string]any{"type": "string"},
								"label":      map[string]any{"type": "string"},
								"reason":     map[string]any{"type": "string"},
								"confidence": map[string]any{"type": "number"},
							},
							"required":             []string{"sourceId", "targetId", "label", "reason", "confidence"},
							"additionalProperties": false,
						},
					},
				},
				"required":             []string{"summary", "relations"},
				"additionalProperties": false,
			},
		},
	}

	var payload relationPayload
	model, err := s.runJSONTask(req.Settings, systemPrompt, userPrompt, schema, &payload)
	if err != nil {
		return aiRelationsResponse{}, err
	}

	filtered := filterSuggestedRelations(req.Document, payload.Relations)
	return aiRelationsResponse{
		Relations: filtered,
		Summary:   strings.TrimSpace(payload.Summary),
		Model:     model,
	}, nil
}

func (s *Server) generateAIDocument(req aiGenerateRequest) (aiGenerateResponse, error) {
	systemPrompt := strings.Join([]string{
		"You create concise but information-dense knowledge-graph style mind maps.",
		"Return a root topic, meaningful branches, and a few cross-links.",
		"Keep node titles short enough to fit on a mind map.",
		"Prefer 10 to 22 nodes total unless the user asks for a larger graph.",
		"Include a few semantic relation lines between distant branches when they genuinely help understanding.",
	}, "\n")

	templatePrompt := promptTemplateForGraph(req.Template)
	userPrompt := strings.Join([]string{
		fmt.Sprintf("Topic: %s", strings.TrimSpace(req.Topic)),
		fmt.Sprintf("Template direction: %s", templatePrompt),
		"Output rules:",
		"- Create exactly one root node.",
		"- Each non-root node must either point to a parentId or be marked as floating.",
		"- Use relation lines only for semantic cross-links, not for tree structure.",
		"- Keep labels clear and practical.",
		optionalInstructionBlock(req.Instructions),
	}, "\n")

	schema := map[string]any{
		"type": "json_schema",
		"json_schema": map[string]any{
			"name":   "mind_map_generation",
			"strict": true,
			"schema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"title":   map[string]any{"type": "string"},
					"summary": map[string]any{"type": "string"},
					"nodes": map[string]any{
						"type": "array",
						"items": map[string]any{
							"type": "object",
							"properties": map[string]any{
								"id":       map[string]any{"type": "string"},
								"title":    map[string]any{"type": "string"},
								"parentId": map[string]any{"type": "string"},
								"kind":     map[string]any{"type": "string"},
								"priority": map[string]any{"type": "string"},
							},
							"required":             []string{"id", "title", "parentId", "kind", "priority"},
							"additionalProperties": false,
						},
					},
					"relations": map[string]any{
						"type": "array",
						"items": map[string]any{
							"type": "object",
							"properties": map[string]any{
								"sourceId": map[string]any{"type": "string"},
								"targetId": map[string]any{"type": "string"},
								"label":    map[string]any{"type": "string"},
							},
							"required":             []string{"sourceId", "targetId", "label"},
							"additionalProperties": false,
						},
					},
				},
				"required":             []string{"title", "summary", "nodes", "relations"},
				"additionalProperties": false,
			},
		},
	}

	var payload aiGeneratedGraph
	model, err := s.runJSONTask(req.Settings, systemPrompt, userPrompt, schema, &payload)
	if err != nil {
		return aiGenerateResponse{}, err
	}

	document, err := generatedGraphToDocument(strings.TrimSpace(req.Topic), payload)
	if err != nil {
		return aiGenerateResponse{}, err
	}

	return aiGenerateResponse{
		Document: document,
		Summary:  strings.TrimSpace(payload.Summary),
		Prompt:   userPrompt,
		Template: strings.TrimSpace(req.Template),
		Model:    model,
	}, nil
}

func (s *Server) testAIConnection(settings aiSettingsRequest) (aiTestResponse, error) {
	baseURL := normalizeAIBaseURL(settings.BaseURL)
	models, err := s.listAIModels(settings, baseURL)
	if err != nil {
		return aiTestResponse{}, err
	}
	if len(models) == 0 {
		return aiTestResponse{}, errors.New("no model available from the configured AI endpoint")
	}

	configuredModel := strings.TrimSpace(settings.Model)
	if configuredModel == "" {
		return aiTestResponse{
			OK:      true,
			Model:   models[0],
			Message: fmt.Sprintf("Connected to %s. First available model: %s.", baseURL, models[0]),
		}, nil
	}

	for _, model := range models {
		if strings.EqualFold(model, configuredModel) {
			return aiTestResponse{
				OK:      true,
				Model:   model,
				Message: fmt.Sprintf("Connected to %s. Configured model %s is available.", baseURL, model),
			}, nil
		}
	}

	return aiTestResponse{
		OK:      true,
		Model:   configuredModel,
		Message: fmt.Sprintf("Connected to %s. Configured model %s was not reported by /models. First available model: %s.", baseURL, configuredModel, models[0]),
	}, nil
}

func (s *Server) runJSONTask(settings aiSettingsRequest, systemPrompt string, userPrompt string, schema map[string]any, target any) (string, error) {
	baseURL := normalizeAIBaseURL(settings.BaseURL)
	model, err := s.resolveAIModel(settings, baseURL, strings.TrimSpace(settings.Model))
	if err != nil {
		return "", err
	}

	raw, responseModel, err := s.chatCompletion(settings, baseURL, model, systemPrompt, userPrompt, schema)
	if err != nil && schema != nil {
		fallbackSystemPrompt := systemPrompt + "\nReturn valid JSON only. Do not wrap it in markdown fences."
		raw, responseModel, err = s.chatCompletion(settings, baseURL, model, fallbackSystemPrompt, userPrompt, nil)
	}
	if err != nil {
		return "", err
	}

	normalized := extractJSONObject(raw)
	if err := json.Unmarshal([]byte(normalized), target); err != nil {
		return "", fmt.Errorf("failed to parse AI response JSON: %w", err)
	}

	if strings.TrimSpace(responseModel) != "" {
		model = responseModel
	}
	return model, nil
}

func (s *Server) resolveAIModel(settings aiSettingsRequest, baseURL string, configuredModel string) (string, error) {
	if configuredModel != "" {
		return configuredModel, nil
	}

	models, err := s.listAIModels(settings, baseURL)
	if err != nil {
		return "", err
	}
	if len(models) == 0 {
		return "", errors.New("no model available from the configured AI endpoint")
	}

	return models[0], nil
}

func (s *Server) listAIModels(settings aiSettingsRequest, baseURL string) ([]string, error) {
	request, err := http.NewRequest(http.MethodGet, baseURL+"/models", nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/json")
	if token := authorizationToken(settings); token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}

	response, err := s.httpClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("failed to list models: %w", err)
	}
	defer response.Body.Close()

	body, _ := io.ReadAll(response.Body)
	if response.StatusCode >= http.StatusBadRequest {
		return nil, fmt.Errorf("model discovery failed: %s", strings.TrimSpace(string(body)))
	}

	var payload openAIModelsResponse
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("failed to decode models response: %w", err)
	}
	if payload.Error != nil && strings.TrimSpace(payload.Error.Message) != "" {
		return nil, errors.New(strings.TrimSpace(payload.Error.Message))
	}

	models := make([]string, 0, len(payload.Data))
	for _, model := range payload.Data {
		if strings.TrimSpace(model.ID) != "" {
			models = append(models, strings.TrimSpace(model.ID))
		}
	}

	return models, nil
}

func (s *Server) chatCompletion(settings aiSettingsRequest, baseURL string, model string, systemPrompt string, userPrompt string, schema any) (string, string, error) {
	requestBody := openAIChatRequest{
		Model:       model,
		Messages:    []openAIChatMessage{{Role: "system", Content: systemPrompt}, {Role: "user", Content: userPrompt}},
		Temperature: 0.2,
		MaxTokens:   normalizeAIMaxTokens(settings.MaxTokens),
		Stream:      false,
	}
	if schema != nil {
		requestBody.ResponseFormat = schema
	}

	payload, err := json.Marshal(requestBody)
	if err != nil {
		return "", "", err
	}

	request, err := http.NewRequest(http.MethodPost, baseURL+"/chat/completions", bytes.NewReader(payload))
	if err != nil {
		return "", "", err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	if token := authorizationToken(settings); token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}

	response, err := s.httpClient.Do(request)
	if err != nil {
		return "", "", fmt.Errorf("failed to call AI model: %w", err)
	}
	defer response.Body.Close()

	body, _ := io.ReadAll(response.Body)
	if response.StatusCode >= http.StatusBadRequest {
		return "", "", fmt.Errorf("AI endpoint returned %d: %s", response.StatusCode, strings.TrimSpace(string(body)))
	}

	var payloadResponse openAIChatResponse
	if err := json.Unmarshal(body, &payloadResponse); err != nil {
		return "", "", fmt.Errorf("failed to decode AI response: %w", err)
	}
	if payloadResponse.Error != nil && strings.TrimSpace(payloadResponse.Error.Message) != "" {
		return "", "", errors.New(strings.TrimSpace(payloadResponse.Error.Message))
	}
	if len(payloadResponse.Choices) == 0 {
		return "", "", errors.New("AI response did not include any choices")
	}

	return payloadResponse.Choices[0].Message.Content, payloadResponse.Model, nil
}

func authorizationToken(settings aiSettingsRequest) string {
	token := strings.TrimSpace(settings.APIKey)
	if token != "" {
		return token
	}
	if strings.TrimSpace(settings.Provider) == "lmstudio" {
		return "lm-studio"
	}
	return ""
}

func normalizeAIMaxTokens(value int) int {
	if value <= 0 {
		return defaultAIMaxTokens
	}
	if value < 256 {
		return 256
	}
	if value > 32768 {
		return 32768
	}
	return value
}

func marshalMindMapForPrompt(doc mindmap.Document) (string, error) {
	type promptNode struct {
		ID       string           `json:"id"`
		Title    string           `json:"title"`
		ParentID string           `json:"parentId,omitempty"`
		Kind     mindmap.NodeKind `json:"kind"`
		Priority mindmap.Priority `json:"priority,omitempty"`
	}

	type promptRelation struct {
		SourceID string `json:"sourceId"`
		TargetID string `json:"targetId"`
		Label    string `json:"label,omitempty"`
	}

	nodes := make([]promptNode, 0, len(doc.Nodes))
	for _, node := range doc.Nodes {
		nodes = append(nodes, promptNode{
			ID:       node.ID,
			Title:    node.Title,
			ParentID: node.ParentID,
			Kind:     node.Kind,
			Priority: node.Priority,
		})
	}

	relations := make([]promptRelation, 0, len(doc.Relations))
	for _, relation := range doc.Relations {
		relations = append(relations, promptRelation{
			SourceID: relation.SourceID,
			TargetID: relation.TargetID,
			Label:    relation.Label,
		})
	}

	payload, err := json.MarshalIndent(map[string]any{
		"title":     doc.Title,
		"nodes":     nodes,
		"relations": relations,
	}, "", "  ")
	if err != nil {
		return "", err
	}

	return string(payload), nil
}

func filterSuggestedRelations(doc mindmap.Document, relations []aiRelationSuggestion) []aiRelationSuggestion {
	validNodeIDs := make(map[string]struct{}, len(doc.Nodes))
	parentByID := make(map[string]string, len(doc.Nodes))
	for _, node := range doc.Nodes {
		validNodeIDs[node.ID] = struct{}{}
		parentByID[node.ID] = node.ParentID
	}

	existingPairs := make(map[string]struct{}, len(doc.Relations))
	for _, relation := range doc.Relations {
		existingPairs[normalizedPairKey(relation.SourceID, relation.TargetID)] = struct{}{}
	}

	filtered := make([]aiRelationSuggestion, 0, len(relations))
	addedPairs := make(map[string]struct{}, len(relations))
	for _, relation := range relations {
		relation.SourceID = strings.TrimSpace(relation.SourceID)
		relation.TargetID = strings.TrimSpace(relation.TargetID)
		relation.Label = strings.TrimSpace(relation.Label)
		relation.Reason = strings.TrimSpace(relation.Reason)
		relation.Confidence = clampConfidence(relation.Confidence)

		if relation.SourceID == "" || relation.TargetID == "" || relation.SourceID == relation.TargetID {
			continue
		}
		if relation.Label == "" {
			continue
		}
		if _, ok := validNodeIDs[relation.SourceID]; !ok {
			continue
		}
		if _, ok := validNodeIDs[relation.TargetID]; !ok {
			continue
		}
		if isAncestor(parentByID, relation.SourceID, relation.TargetID) || isAncestor(parentByID, relation.TargetID, relation.SourceID) {
			continue
		}

		key := normalizedPairKey(relation.SourceID, relation.TargetID)
		if _, exists := existingPairs[key]; exists {
			continue
		}
		if _, exists := addedPairs[key]; exists {
			continue
		}

		addedPairs[key] = struct{}{}
		filtered = append(filtered, relation)
	}

	return filtered
}

func generatedGraphToDocument(topic string, payload aiGeneratedGraph) (mindmap.Document, error) {
	now := time.Now().UTC()
	title := strings.TrimSpace(payload.Title)
	if title == "" {
		title = strings.TrimSpace(topic)
	}
	if title == "" {
		title = "AI Knowledge Map"
	}

	rootSource := findGeneratedRoot(payload.Nodes)
	if rootSource.ID == "" {
		rootSource = aiGeneratedNode{
			ID:    "root",
			Title: title,
			Kind:  string(mindmap.NodeKindRoot),
		}
	}

	doc := mindmap.Document{
		ID:    "generated-preview",
		Title: title,
		Theme: mindmap.ThemeDark,
		Nodes: []mindmap.Node{
			{
				ID:        "root",
				Kind:      mindmap.NodeKindRoot,
				Title:     fallbackString(strings.TrimSpace(rootSource.Title), title),
				Position:  mindmap.Position{X: defaultRootX, Y: defaultRootY},
				CreatedAt: now,
				UpdatedAt: now,
			},
		},
		Relations: []mindmap.RelationEdge{},
		Meta: mindmap.Meta{
			Version:      1,
			LastEditedAt: now,
			LastOpenedAt: now,
		},
	}

	idMapping := map[string]string{
		rootSource.ID: "root",
	}

	childrenByParent := make(map[string][]aiGeneratedNode)
	floatingNodes := make([]aiGeneratedNode, 0)
	for _, node := range payload.Nodes {
		if strings.TrimSpace(node.ID) == "" || node.ID == rootSource.ID {
			continue
		}
		parentID := strings.TrimSpace(node.ParentID)
		if parentID == "" || strings.EqualFold(strings.TrimSpace(node.Kind), string(mindmap.NodeKindFloating)) {
			floatingNodes = append(floatingNodes, node)
			continue
		}
		childrenByParent[parentID] = append(childrenByParent[parentID], node)
	}

	rootChildren := childrenByParent[rootSource.ID]
	layoutGeneratedBranches(rootChildren, childrenByParent, idMapping, &doc, "root", defaultRootX, defaultRootY, now)

	for index, node := range floatingNodes {
		actualID := ensureGeneratedNode(doc.NodeMap(), node.ID)
		idMapping[node.ID] = actualID
		doc.Nodes = append(doc.Nodes, mindmap.Node{
			ID:        actualID,
			Kind:      mindmap.NodeKindFloating,
			Title:     fallbackString(strings.TrimSpace(node.Title), "Untitled"),
			Priority:  parsePriority(node.Priority),
			Position:  mindmap.Position{X: defaultRootX - 220 + float64(index*36), Y: defaultRootY + 220 + float64(index*defaultBranchGapY)},
			CreatedAt: now,
			UpdatedAt: now,
		})
		layoutGeneratedBranches(childrenByParent[node.ID], childrenByParent, idMapping, &doc, actualID, defaultRootX-220+float64(index*36), defaultRootY+220+float64(index*defaultBranchGapY), now)
	}

	nodeMap := doc.NodeMap()
	addedPairs := make(map[string]struct{})
	for _, relation := range payload.Relations {
		sourceID := idMapping[strings.TrimSpace(relation.SourceID)]
		targetID := idMapping[strings.TrimSpace(relation.TargetID)]
		label := strings.TrimSpace(relation.Label)
		if sourceID == "" || targetID == "" || sourceID == targetID || label == "" {
			continue
		}
		if _, ok := nodeMap[sourceID]; !ok {
			continue
		}
		if _, ok := nodeMap[targetID]; !ok {
			continue
		}
		key := normalizedPairKey(sourceID, targetID)
		if _, exists := addedPairs[key]; exists {
			continue
		}
		addedPairs[key] = struct{}{}
		doc.Relations = append(doc.Relations, mindmap.RelationEdge{
			ID:        mindmap.NewID("rel"),
			SourceID:  sourceID,
			TargetID:  targetID,
			Label:     label,
			CreatedAt: now,
			UpdatedAt: now,
		})
	}

	if err := doc.Validate(); err != nil {
		return mindmap.Document{}, err
	}

	return doc, nil
}

func layoutGeneratedBranches(
	nodes []aiGeneratedNode,
	childrenByParent map[string][]aiGeneratedNode,
	idMapping map[string]string,
	doc *mindmap.Document,
	parentID string,
	parentX float64,
	parentY float64,
	now time.Time,
) {
	if len(nodes) == 0 {
		return
	}

	side := 1.0
	if parentID == "root" {
		for index, node := range nodes {
			if index%2 == 1 {
				side = -1
			} else {
				side = 1
			}
			x := parentX + side*defaultBranchGapX
			y := parentY + float64(index-(len(nodes)-1)/2)*defaultBranchGapY
			appendGeneratedNode(doc, idMapping, node, parentID, x, y, now)
			layoutGeneratedSubtree(node, childrenByParent, idMapping, doc, x, y, side, 2, now)
		}
		return
	}

	for index, node := range nodes {
		x := parentX + defaultBranchGapX
		y := parentY + float64(index-(len(nodes)-1)/2)*defaultBranchGapY
		appendGeneratedNode(doc, idMapping, node, parentID, x, y, now)
		layoutGeneratedSubtree(node, childrenByParent, idMapping, doc, x, y, 1, 2, now)
	}
}

func layoutGeneratedSubtree(
	source aiGeneratedNode,
	childrenByParent map[string][]aiGeneratedNode,
	idMapping map[string]string,
	doc *mindmap.Document,
	parentX float64,
	parentY float64,
	side float64,
	depth int,
	now time.Time,
) {
	children := childrenByParent[source.ID]
	if len(children) == 0 {
		return
	}

	actualParentID := idMapping[source.ID]
	for index, child := range children {
		x := parentX + side*defaultBranchGapX
		y := parentY + float64(index-(len(children)-1)/2)*defaultBranchGapY
		appendGeneratedNode(doc, idMapping, child, actualParentID, x, y, now)
		layoutGeneratedSubtree(child, childrenByParent, idMapping, doc, x, y, side, depth+1, now)
	}
}

func appendGeneratedNode(
	doc *mindmap.Document,
	idMapping map[string]string,
	source aiGeneratedNode,
	parentID string,
	x float64,
	y float64,
	now time.Time,
) {
	actualID := ensureGeneratedNode(doc.NodeMap(), source.ID)
	idMapping[source.ID] = actualID

	doc.Nodes = append(doc.Nodes, mindmap.Node{
		ID:        actualID,
		ParentID:  parentID,
		Kind:      parseNodeKind(source.Kind),
		Title:     fallbackString(strings.TrimSpace(source.Title), "Untitled"),
		Priority:  parsePriority(source.Priority),
		Position:  mindmap.Position{X: x, Y: y},
		CreatedAt: now,
		UpdatedAt: now,
	})
}

func ensureGeneratedNode(nodeMap map[string]mindmap.Node, proposed string) string {
	candidate := strings.TrimSpace(proposed)
	if candidate == "" {
		return mindmap.NewID("node")
	}
	if _, exists := nodeMap[candidate]; !exists {
		return candidate
	}
	return mindmap.NewID("node")
}

func findGeneratedRoot(nodes []aiGeneratedNode) aiGeneratedNode {
	for _, node := range nodes {
		if strings.EqualFold(strings.TrimSpace(node.Kind), string(mindmap.NodeKindRoot)) {
			return node
		}
	}
	for _, node := range nodes {
		if strings.TrimSpace(node.ParentID) == "" {
			return node
		}
	}
	return aiGeneratedNode{}
}

func parseNodeKind(value string) mindmap.NodeKind {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case string(mindmap.NodeKindFloating):
		return mindmap.NodeKindFloating
	default:
		return mindmap.NodeKindTopic
	}
}

func parsePriority(value string) mindmap.Priority {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case string(mindmap.Priority0):
		return mindmap.Priority0
	case string(mindmap.Priority1):
		return mindmap.Priority1
	case string(mindmap.Priority2):
		return mindmap.Priority2
	case string(mindmap.Priority3):
		return mindmap.Priority3
	default:
		return mindmap.PriorityNone
	}
}

func normalizeAIBaseURL(baseURL string) string {
	trimmed := strings.TrimSpace(baseURL)
	if trimmed == "" {
		trimmed = defaultAIBaseURL
	}
	trimmed = strings.TrimRight(trimmed, "/")
	if strings.HasSuffix(trimmed, "/v1") {
		return trimmed
	}
	return trimmed + "/v1"
}

func promptTemplateForGraph(template string) string {
	switch strings.TrimSpace(template) {
	case "project-planning":
		return "Create a project-planning map with goals, stakeholders, scope, milestones, risks, dependencies, resources, and success metrics."
	case "character-network":
		return "Create a character or role relationship graph with factions, motivations, conflicts, alliances, triggers, and notable events."
	default:
		return "Create a concept-learning graph with definitions, components, workflows, comparisons, examples, applications, risks, and related ideas."
	}
}

func optionalInstructionBlock(instructions string) string {
	instructions = strings.TrimSpace(instructions)
	if instructions == "" {
		return ""
	}
	return "Extra instruction: " + instructions
}

func normalizedPairKey(left string, right string) string {
	if left > right {
		left, right = right, left
	}
	return left + "::" + right
}

func isAncestor(parentByID map[string]string, ancestorID string, nodeID string) bool {
	current := strings.TrimSpace(parentByID[nodeID])
	for current != "" {
		if current == ancestorID {
			return true
		}
		current = strings.TrimSpace(parentByID[current])
	}
	return false
}

func extractJSONObject(raw string) string {
	trimmed := strings.TrimSpace(raw)
	trimmed = strings.TrimPrefix(trimmed, "```json")
	trimmed = strings.TrimPrefix(trimmed, "```")
	trimmed = strings.TrimSuffix(trimmed, "```")
	trimmed = strings.TrimSpace(trimmed)

	start := strings.Index(trimmed, "{")
	end := strings.LastIndex(trimmed, "}")
	if start >= 0 && end > start {
		return trimmed[start : end+1]
	}
	return trimmed
}

func fallbackString(value string, fallback string) string {
	if value != "" {
		return value
	}
	return fallback
}

func clampConfidence(value float64) float64 {
	if value < 0 {
		return 0
	}
	if value > 1 {
		return 1
	}
	return value
}

func (s *Server) handleFrontend(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		writeError(w, http.StatusNotFound, fmt.Errorf("unknown api route: %s", r.URL.Path))
		return
	}

	distDir := filepath.Join("frontend", "dist")
	indexPath := filepath.Join(distDir, "index.html")

	if _, err := os.Stat(indexPath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			http.Error(
				w,
				"frontend build not found. Run `cd frontend && npm install && npm run build` for production or `npm run dev` for local development.",
				http.StatusNotFound,
			)
			return
		}
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	cleanPath := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	requestPath := filepath.Join(distDir, filepath.FromSlash(cleanPath))
	if info, err := os.Stat(requestPath); err == nil && !info.IsDir() {
		http.ServeFile(w, r, requestPath)
		return
	}

	http.ServeFile(w, r, indexPath)
}

func writeJSON(w http.ResponseWriter, statusCode int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, statusCode int, err error) {
	writeJSON(w, statusCode, map[string]string{
		"error": err.Error(),
	})
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		next.ServeHTTP(w, r)
		fmt.Printf("%s %s %s\n", r.Method, r.URL.Path, time.Since(started).Round(time.Millisecond))
	})
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, PUT, PATCH, POST, DELETE, OPTIONS")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}
