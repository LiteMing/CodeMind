package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"code-mind/internal/mindmap"
)

type aiSettingsRequest struct {
	Provider       string `json:"provider"`
	BaseURL        string `json:"baseUrl"`
	Model          string `json:"model"`
	APIKey         string `json:"apiKey"`
	MaxTokens      int    `json:"maxTokens"`
	TimeoutSeconds int    `json:"timeoutSeconds"`
}

type aiDebugRequest struct {
	RawMode    bool   `json:"rawMode"`
	RawRequest string `json:"rawRequest"`
}

type aiRelationsRequest struct {
	Settings     aiSettingsRequest `json:"settings"`
	Document     mindmap.Document  `json:"document"`
	FocusNodeIDs []string          `json:"focusNodeIds"`
	Instructions string            `json:"instructions"`
	Debug        aiDebugRequest    `json:"debug"`
}

type aiNodeNotesRequest struct {
	Settings      aiSettingsRequest `json:"settings"`
	Document      mindmap.Document  `json:"document"`
	TargetNodeIDs []string          `json:"targetNodeIds"`
	Instructions  string            `json:"instructions"`
	Debug         aiDebugRequest    `json:"debug"`
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

type aiDebugInfo struct {
	RawMode          bool   `json:"rawMode"`
	UpstreamRequest  string `json:"upstreamRequest"`
	UpstreamResponse string `json:"upstreamResponse"`
	AssistantContent string `json:"assistantContent"`
}

type aiRelationsResponse struct {
	Relations []aiRelationSuggestion `json:"relations"`
	Summary   string                 `json:"summary"`
	Model     string                 `json:"model"`
	Debug     aiDebugInfo            `json:"debug"`
}

type aiNodeNoteSuggestion struct {
	ID   string `json:"id"`
	Note string `json:"note"`
}

type aiNodeNotesResponse struct {
	Notes   []aiNodeNoteSuggestion `json:"notes"`
	Summary string                 `json:"summary"`
	Model   string                 `json:"model"`
	Debug   aiDebugInfo            `json:"debug"`
}

type aiGenerateRequest struct {
	Settings     aiSettingsRequest `json:"settings"`
	Topic        string            `json:"topic"`
	Template     string            `json:"template"`
	Mode         string            `json:"mode"`
	Document     *mindmap.Document `json:"document,omitempty"`
	Instructions string            `json:"instructions"`
	Debug        aiDebugRequest    `json:"debug"`
}

type aiGenerateResponse struct {
	Document mindmap.Document `json:"document"`
	Summary  string           `json:"summary"`
	Prompt   string           `json:"prompt"`
	Template string           `json:"template"`
	Mode     string           `json:"mode,omitempty"`
	Model    string           `json:"model"`
	Debug    aiDebugInfo      `json:"debug"`
}

type aiImportRequest struct {
	Settings     aiSettingsRequest `json:"settings"`
	FileName     string            `json:"fileName"`
	Format       string            `json:"format"`
	Content      string            `json:"content"`
	Instructions string            `json:"instructions"`
	Debug        aiDebugRequest    `json:"debug"`
}

type aiImportResponse struct {
	Document mindmap.Document `json:"document"`
	Summary  string           `json:"summary"`
	Prompt   string           `json:"prompt"`
	Model    string           `json:"model"`
	Debug    aiDebugInfo      `json:"debug"`
}

type aiSuggestChildrenRequest struct {
	Settings     aiSettingsRequest `json:"settings"`
	Document     mindmap.Document  `json:"document"`
	TargetNodeID string            `json:"targetNodeId"`
	Mode         string            `json:"mode"`
	Instructions string            `json:"instructions"`
	Debug        aiDebugRequest    `json:"debug"`
}

type aiSuggestChildrenResponse struct {
	Suggestions []aiChildSuggestion `json:"suggestions"`
	Summary     string              `json:"summary"`
	Model       string              `json:"model"`
	Debug       aiDebugInfo         `json:"debug"`
}

type aiChildSuggestion struct {
	Title string `json:"title"`
	Note  string `json:"note"`
}

type aiTestResponse struct {
	OK      bool   `json:"ok"`
	Model   string `json:"model"`
	Message string `json:"message"`
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
		writeAIError(w, http.StatusBadGateway, err)
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleAINodeNotes(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req aiNodeNotesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := req.Document.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	result, err := s.completeAINodeNotes(req)
	if err != nil {
		writeAIError(w, http.StatusBadGateway, err)
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
		if normalizeAIGenerateMode(req.Mode) != "expand" || req.Document == nil || strings.TrimSpace(req.Document.Title) == "" {
			writeError(w, http.StatusBadRequest, errors.New("topic is required"))
			return
		}
	}
	if normalizeAIGenerateMode(req.Mode) == "expand" {
		if req.Document == nil {
			writeError(w, http.StatusBadRequest, errors.New("document is required for expand mode"))
			return
		}
		if err := req.Document.Validate(); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
	} else if req.Document != nil {
		if err := req.Document.Validate(); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
	}

	result, err := s.generateAIDocument(req)
	if err != nil {
		writeAIError(w, http.StatusBadGateway, err)
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleAIImport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req aiImportRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if strings.TrimSpace(req.Content) == "" {
		writeError(w, http.StatusBadRequest, errors.New("content is required"))
		return
	}

	result, err := s.importDocumentWithAI(req)
	if err != nil {
		writeAIError(w, http.StatusBadGateway, err)
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleAISuggestChildren(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req aiSuggestChildrenRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := req.Document.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if strings.TrimSpace(req.TargetNodeID) == "" {
		writeError(w, http.StatusBadRequest, errors.New("targetNodeId is required"))
		return
	}

	result, err := s.suggestAIChildren(req)
	if err != nil {
		writeAIError(w, http.StatusBadGateway, err)
		return
	}

	writeJSON(w, http.StatusOK, result)
}
