package server

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

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

type aiTaskResult struct {
	Model   string
	Content string
	Debug   aiDebugInfo
}

type aiChatCompletionResult struct {
	Content          string
	Model            string
	UpstreamRequest  string
	UpstreamResponse string
}

type aiDebugError struct {
	Err   error
	Debug aiDebugInfo
}

func (e *aiDebugError) Error() string {
	return e.Err.Error()
}

func (e *aiDebugError) Unwrap() error {
	return e.Err
}

func (s *Server) runJSONTask(settings aiSettingsRequest, systemPrompt string, userPrompt string, schema map[string]any, debugRequest aiDebugRequest, target any) (aiTaskResult, error) {
	baseURL := normalizeAIBaseURL(settings.BaseURL)
	if err := s.checkAIBaseURL(baseURL); err != nil {
		return aiTaskResult{}, err
	}
	model, err := s.resolveAIModel(settings, baseURL, strings.TrimSpace(settings.Model))
	if err != nil {
		return aiTaskResult{}, err
	}

	rawModeActive := isAIRawModeActive(debugRequest)
	fallbackUsed := false
	chatResult, err := s.chatCompletion(settings, baseURL, model, systemPrompt, userPrompt, schema, debugRequest)
	if err != nil && schema != nil && !rawModeActive {
		fallbackUsed = true
		fallbackSystemPrompt := jsonOnlySystemPrompt(systemPrompt)
		chatResult, err = s.chatCompletion(settings, baseURL, model, fallbackSystemPrompt, userPrompt, nil, debugRequest)
	}
	if err != nil {
		return aiTaskResult{}, err
	}

	debugInfo := aiDebugInfo{
		RawMode:          rawModeActive,
		UpstreamRequest:  chatResult.UpstreamRequest,
		UpstreamResponse: chatResult.UpstreamResponse,
		AssistantContent: chatResult.Content,
	}

	if err := unmarshalAIJSON(chatResult.Content, target); err != nil {
		if schema != nil && !fallbackUsed && !rawModeActive {
			fallbackUsed = true
			fallbackSystemPrompt := jsonOnlySystemPrompt(systemPrompt)
			chatResult, err = s.chatCompletion(settings, baseURL, model, fallbackSystemPrompt, userPrompt, nil, debugRequest)
			if err != nil {
				return aiTaskResult{}, err
			}
			debugInfo = aiDebugInfo{
				RawMode:          rawModeActive,
				UpstreamRequest:  chatResult.UpstreamRequest,
				UpstreamResponse: chatResult.UpstreamResponse,
				AssistantContent: chatResult.Content,
			}
			if err := unmarshalAIJSON(chatResult.Content, target); err != nil {
				return aiTaskResult{}, &aiDebugError{Err: fmt.Errorf("failed to parse AI response JSON: %w", err), Debug: debugInfo}
			}
		} else {
			return aiTaskResult{}, &aiDebugError{Err: fmt.Errorf("failed to parse AI response JSON: %w", err), Debug: debugInfo}
		}
	}

	if strings.TrimSpace(chatResult.Model) != "" {
		model = chatResult.Model
	}
	return aiTaskResult{
		Model:   model,
		Content: chatResult.Content,
		Debug:   debugInfo,
	}, nil
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

	response, err := s.aiHTTPClient(settings).Do(request)
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

func buildAIChatPayload(
	settings aiSettingsRequest,
	model string,
	systemPrompt string,
	userPrompt string,
	schema any,
	debugRequest aiDebugRequest,
) ([]byte, error) {
	if isAIRawModeActive(debugRequest) {
		rawRequest := strings.TrimSpace(debugRequest.RawRequest)
		var rawPayload map[string]any
		if err := json.Unmarshal([]byte(rawRequest), &rawPayload); err != nil {
			return nil, &aiDebugError{
				Err: fmt.Errorf("invalid RAW AI request JSON: %w", err),
				Debug: aiDebugInfo{
					RawMode:         true,
					UpstreamRequest: rawRequest,
				},
			}
		}

		if rawModel, ok := rawPayload["model"].(string); !ok || strings.TrimSpace(rawModel) == "" {
			rawPayload["model"] = model
		}
		if _, ok := rawPayload["stream"]; !ok {
			rawPayload["stream"] = false
		}

		payload, err := json.Marshal(rawPayload)
		if err != nil {
			return nil, &aiDebugError{
				Err: fmt.Errorf("failed to encode RAW AI request JSON: %w", err),
				Debug: aiDebugInfo{
					RawMode:         true,
					UpstreamRequest: rawRequest,
				},
			}
		}
		return payload, nil
	}

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
		return nil, err
	}
	return payload, nil
}

func (s *Server) chatCompletion(
	settings aiSettingsRequest,
	baseURL string,
	model string,
	systemPrompt string,
	userPrompt string,
	schema any,
	debugRequest aiDebugRequest,
) (aiChatCompletionResult, error) {
	payload, err := buildAIChatPayload(settings, model, systemPrompt, userPrompt, schema, debugRequest)
	if err != nil {
		return aiChatCompletionResult{}, err
	}
	requestJSON := string(payload)
	rawModeActive := isAIRawModeActive(debugRequest)

	request, err := http.NewRequest(http.MethodPost, baseURL+"/chat/completions", bytes.NewReader(payload))
	if err != nil {
		return aiChatCompletionResult{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	if token := authorizationToken(settings); token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}

	response, err := s.aiHTTPClient(settings).Do(request)
	if err != nil {
		return aiChatCompletionResult{}, &aiDebugError{
			Err: fmt.Errorf("failed to call AI model: %w", err),
			Debug: aiDebugInfo{
				RawMode:         rawModeActive,
				UpstreamRequest: requestJSON,
			},
		}
	}
	defer response.Body.Close()

	body, _ := io.ReadAll(response.Body)
	rawResponse := string(body)
	debugInfo := aiDebugInfo{
		RawMode:          rawModeActive,
		UpstreamRequest:  requestJSON,
		UpstreamResponse: rawResponse,
	}
	if response.StatusCode >= http.StatusBadRequest {
		return aiChatCompletionResult{}, &aiDebugError{
			Err:   fmt.Errorf("AI endpoint returned %d: %s", response.StatusCode, strings.TrimSpace(rawResponse)),
			Debug: debugInfo,
		}
	}

	var payloadResponse openAIChatResponse
	if err := json.Unmarshal(body, &payloadResponse); err != nil {
		return aiChatCompletionResult{}, &aiDebugError{
			Err:   fmt.Errorf("failed to decode AI response: %w", err),
			Debug: debugInfo,
		}
	}
	if payloadResponse.Error != nil && strings.TrimSpace(payloadResponse.Error.Message) != "" {
		return aiChatCompletionResult{}, &aiDebugError{
			Err:   errors.New(strings.TrimSpace(payloadResponse.Error.Message)),
			Debug: debugInfo,
		}
	}
	if len(payloadResponse.Choices) == 0 {
		return aiChatCompletionResult{}, &aiDebugError{
			Err:   errors.New("AI response did not include any choices"),
			Debug: debugInfo,
		}
	}

	debugInfo.AssistantContent = payloadResponse.Choices[0].Message.Content
	return aiChatCompletionResult{
		Content:          payloadResponse.Choices[0].Message.Content,
		Model:            payloadResponse.Model,
		UpstreamRequest:  requestJSON,
		UpstreamResponse: rawResponse,
	}, nil
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

func normalizeAITimeoutSeconds(value int) int {
	if value <= 0 {
		return defaultAITimeout
	}
	if value < 1 {
		return 1
	}
	if value > 600 {
		return 600
	}
	return value
}

func (s *Server) aiHTTPClient(settings aiSettingsRequest) *http.Client {
	clientCopy := *s.httpClient
	clientCopy.Timeout = time.Duration(normalizeAITimeoutSeconds(settings.TimeoutSeconds)) * time.Second
	return &clientCopy
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

func jsonOnlySystemPrompt(systemPrompt string) string {
	return strings.Join([]string{
		strings.TrimSpace(systemPrompt),
		"Return valid JSON only.",
		"Do not wrap it in markdown fences.",
		"Do not add commentary, bullet markers, or trailing commas.",
	}, "\n")
}

func unmarshalAIJSON(raw string, target any) error {
	candidates := collectAIJSONCandidates(raw)

	seen := make(map[string]struct{}, len(candidates))
	var lastErr error
	for _, candidate := range candidates {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		if _, exists := seen[candidate]; exists {
			continue
		}
		seen[candidate] = struct{}{}

		if err := json.Unmarshal([]byte(candidate), target); err == nil {
			return nil
		} else {
			lastErr = err
		}
	}

	if lastErr == nil {
		lastErr = errors.New("empty AI response")
	}
	return lastErr
}

func collectAIJSONCandidates(raw string) []string {
	seen := make(map[string]struct{})
	candidates := make([]string, 0, 8)
	appendCandidate := func(candidate string) {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			return
		}
		if _, exists := seen[candidate]; exists {
			return
		}
		seen[candidate] = struct{}{}
		candidates = append(candidates, candidate)
	}

	appendCandidate(raw)
	appendCandidate(extractJSONObject(raw))

	for _, candidate := range appendEmbeddedJSONCandidates(strings.TrimSpace(raw), map[string]struct{}{}) {
		appendCandidate(candidate)
	}
	return candidates
}

func appendEmbeddedJSONCandidates(raw string, seen map[string]struct{}) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	if _, exists := seen[raw]; exists {
		return nil
	}
	seen[raw] = struct{}{}

	var value any
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return nil
	}
	return extractEmbeddedJSONCandidates(value, seen)
}

func extractEmbeddedJSONCandidates(value any, seen map[string]struct{}) []string {
	results := make([]string, 0)
	appendResult := func(candidate string) {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			return
		}
		if _, exists := seen[candidate]; exists {
			return
		}
		seen[candidate] = struct{}{}
		results = append(results, candidate)
	}

	switch typed := value.(type) {
	case map[string]any:
		for _, key := range []string{"content", "output", "text", "response", "result", "data"} {
			if nested, ok := typed[key]; ok {
				switch nestedTyped := nested.(type) {
				case string:
					appendResult(nestedTyped)
					appendResult(extractJSONObject(nestedTyped))
					results = append(results, appendEmbeddedJSONCandidates(nestedTyped, seen)...)
				default:
					results = append(results, extractEmbeddedJSONCandidates(nestedTyped, seen)...)
				}
			}
		}
		for _, nested := range typed {
			results = append(results, extractEmbeddedJSONCandidates(nested, seen)...)
		}
	case []any:
		for _, nested := range typed {
			results = append(results, extractEmbeddedJSONCandidates(nested, seen)...)
		}
	case string:
		appendResult(typed)
		appendResult(extractJSONObject(typed))
		results = append(results, appendEmbeddedJSONCandidates(typed, seen)...)
	}

	return results
}

func extractJSONObject(raw string) string {
	trimmed := strings.TrimSpace(raw)
	trimmed = strings.NewReplacer(
		"```json", "",
		"```JSON", "",
		"```", "",
		"“", `"`,
		"”", `"`,
		"‘", "'",
		"’", "'",
	).Replace(trimmed)
	trimmed = strings.TrimSpace(trimmed)

	if extracted, ok := extractBalancedJSONObject(trimmed); ok {
		trimmed = extracted
	}

	trimmed = aiJSONBulletPrefixPattern.ReplaceAllString(trimmed, "$1")
	trimmed = aiJSONTrailingCommaPattern.ReplaceAllString(trimmed, "$1")
	return strings.TrimSpace(trimmed)
}

func extractBalancedJSONObject(raw string) (string, bool) {
	start := strings.Index(raw, "{")
	if start < 0 {
		return "", false
	}

	depth := 0
	inString := false
	escaped := false
	for index := start; index < len(raw); index++ {
		char := raw[index]
		if inString {
			if escaped {
				escaped = false
				continue
			}
			if char == '\\' {
				escaped = true
				continue
			}
			if char == '"' {
				inString = false
			}
			continue
		}

		switch char {
		case '"':
			inString = true
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return raw[start : index+1], true
			}
		}
	}

	return "", false
}

func isAIRawModeActive(debugRequest aiDebugRequest) bool {
	return debugRequest.RawMode && strings.TrimSpace(debugRequest.RawRequest) != ""
}
