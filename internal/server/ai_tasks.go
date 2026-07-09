package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"path/filepath"
	"strings"
	"time"

	"code-mind/internal/mindmap"
)

type aiGeneratedGraph struct {
	Title     string                `json:"title"`
	Summary   string                `json:"summary"`
	Nodes     []aiGeneratedNode     `json:"nodes"`
	Relations []aiGeneratedRelation `json:"relations"`
}

type aiGeneratedNode struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Note     string `json:"note"`
	ParentID string `json:"parentId"`
	Kind     string `json:"kind"`
	Priority string `json:"priority"`
}

type aiGeneratedRelation struct {
	SourceID string `json:"sourceId"`
	TargetID string `json:"targetId"`
	Label    string `json:"label"`
}

func (s *Server) suggestAIRelations(req aiRelationsRequest) (aiRelationsResponse, error) {
	type relationPayload struct {
		Summary   string                 `json:"summary"`
		Relations []aiRelationSuggestion `json:"relations"`
	}

	focusTargets := resolveAIRelationFocusTargets(req.Document, req.FocusNodeIDs)

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
		relationFocusPromptBlock(focusTargets),
		"Task:",
		fmt.Sprintf("- Suggest up to %d new semantic relations.", relationSuggestionLimit(focusTargets)),
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
	taskResult, err := s.runJSONTask(req.Settings, systemPrompt, userPrompt, schema, req.Debug, &payload)
	if err != nil {
		return aiRelationsResponse{}, err
	}

	filtered := filterSuggestedRelations(req.Document, payload.Relations)
	filtered = filterSuggestedRelationsForFocus(filtered, focusTargets)
	return aiRelationsResponse{
		Relations: filtered,
		Summary:   strings.TrimSpace(payload.Summary),
		Model:     taskResult.Model,
		Debug:     taskResult.Debug,
	}, nil
}

func (s *Server) completeAINodeNotes(req aiNodeNotesRequest) (aiNodeNotesResponse, error) {
	type notePayload struct {
		Summary string                 `json:"summary"`
		Notes   []aiNodeNoteSuggestion `json:"notes"`
	}

	targets := resolveAINoteTargets(req.Document, req.TargetNodeIDs)
	if len(targets) == 0 {
		return aiNodeNotesResponse{}, errors.New("no target nodes available for note completion")
	}

	systemPrompt := strings.Join([]string{
		"You expand and improve node notes for a mind map.",
		"Write plain text notes that are clear, specific, and useful for future reading.",
		"Prefer same-language output as the node title and existing note.",
		"Do not use markdown bullet lists or JSON inside note text.",
		"Each note should explain what the node means, why it matters, and include an example, mechanism, or caveat when helpful.",
	}, "\n")

	documentPayload, err := marshalMindMapForPrompt(req.Document)
	if err != nil {
		return aiNodeNotesResponse{}, err
	}

	targetPayload, err := json.MarshalIndent(targets, "", "  ")
	if err != nil {
		return aiNodeNotesResponse{}, err
	}

	userPrompt := strings.Join([]string{
		"Mind map document:",
		documentPayload,
		"",
		"Target nodes to annotate:",
		string(targetPayload),
		"",
		"Task:",
		"- Return notes only for the target nodes listed above.",
		"- Rewrite existing notes into richer, clearer versions when a note already exists.",
		"- Prefer 3 to 6 informative sentences per node when the topic supports it.",
		"- Make notes denser for high-level nodes and still useful for detailed nodes.",
		"- Keep note text factual, readable, and directly tied to the current mind map context.",
		optionalInstructionBlock(req.Instructions),
	}, "\n")

	schema := map[string]any{
		"type": "json_schema",
		"json_schema": map[string]any{
			"name":   "mind_map_node_notes",
			"strict": true,
			"schema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"summary": map[string]any{"type": "string"},
					"notes": map[string]any{
						"type": "array",
						"items": map[string]any{
							"type": "object",
							"properties": map[string]any{
								"id":   map[string]any{"type": "string"},
								"note": map[string]any{"type": "string"},
							},
							"required":             []string{"id", "note"},
							"additionalProperties": false,
						},
					},
				},
				"required":             []string{"summary", "notes"},
				"additionalProperties": false,
			},
		},
	}

	var payload notePayload
	taskResult, err := s.runJSONTask(req.Settings, systemPrompt, userPrompt, schema, req.Debug, &payload)
	if err != nil {
		return aiNodeNotesResponse{}, err
	}

	return aiNodeNotesResponse{
		Notes:   filterCompletedNodeNotes(req.Document, req.TargetNodeIDs, payload.Notes),
		Summary: strings.TrimSpace(payload.Summary),
		Model:   taskResult.Model,
		Debug:   taskResult.Debug,
	}, nil
}

func (s *Server) generateAIDocument(req aiGenerateRequest) (aiGenerateResponse, error) {
	mode := normalizeAIGenerateMode(req.Mode)
	systemPrompt := strings.Join([]string{
		"You create concise but information-dense knowledge-graph style mind maps.",
		"Keep node titles short enough to fit on a mind map.",
		"Every node must also include a useful explanatory note in plain text.",
		"Default to a 2 to 3 level hierarchy instead of a flat root-level list.",
		"Prefer richer notes over adding many shallow branches with no explanation.",
		"CRITICAL FORMAT RULES (you MUST follow these exactly):",
		"- The top-level JSON object MUST have exactly four keys: title, summary, nodes, relations.",
		"- Do NOT invent alternate top-level shapes such as root, children, crossLinks, mindmap, graph, or any other key.",
		"- Do NOT wrap the JSON in markdown fences (```), a content string, or any commentary.",
		"- If response_format is ignored, still return strict JSON with only the four keys above.",
		"- The first element of the nodes array MUST be the root node with kind=root and an empty parentId.",
		"- Every non-root node MUST have all six fields: id, title, note, parentId, kind, priority.",
		"- parentId must refer to an existing node id in the same array; never leave it empty for non-root nodes.",
		"- kind must be one of: root, topic, floating.  priority must be one of: (empty string), P0, P1, P2, P3.",
		"- relations is an array of {sourceId, targetId, label} for semantic cross-links only, not hierarchy.",
	}, "\n")

	templatePrompt := promptTemplateForGraph(req.Template)
	userPromptLines := []string{
		fmt.Sprintf("Topic: %s", fallbackString(strings.TrimSpace(req.Topic), strings.TrimSpace(documentTitleOrEmpty(req.Document)))),
		fmt.Sprintf("Template direction: %s", templatePrompt),
	}
	if mode == "expand" && req.Document != nil {
		documentPayload, err := marshalMindMapForPrompt(*req.Document)
		if err != nil {
			return aiGenerateResponse{}, err
		}
		userPromptLines = append(userPromptLines,
			"",
			"Current mind map document:",
			documentPayload,
			"",
			"Expansion task:",
			"- Return only NEW nodes and NEW relations to add to the existing map.",
			"- Do not repeat or rewrite existing nodes from the current map.",
			"- Prefer deepening thin branches and filling obvious knowledge gaps.",
			"- parentId may refer to an existing node id from the current map or to another new node id from your additions.",
			"- If you add a new top-level branch, attach it to the existing root id.",
			"- Add 6 to 18 new nodes when the topic allows it.",
			"- At least 2 additions should be second-level or deeper when the current map allows it.",
			"- Every new node must include id, title, note, parentId, kind, priority.",
			"- Use relations only for semantic cross-links, not for hierarchy.",
		)
	} else {
		userPromptLines = append(userPromptLines,
			"Output rules:",
			"- Create exactly one root node.",
			"- Do not place nearly every node directly under the root.",
			"- At least 2 first-level branches should include second-level children when the topic allows it.",
			"- At least 1 branch should reach third-level depth when the topic allows it.",
			"- Prefer 4 to 7 first-level branches and 14 to 28 nodes total unless the user asks for a smaller graph.",
			"- Every node must include id, title, note, parentId, kind, priority.",
			"- Root and first-level branches should have especially detailed notes.",
			"- Notes should be plain text, specific, and as detailed as the token budget allows.",
			"- Each non-root node must either point to a parentId or be marked as floating.",
			"- Use relation lines only for semantic cross-links, not for tree structure.",
			"- Keep labels clear and practical.",
		)
	}
	if extra := optionalInstructionBlock(req.Instructions); extra != "" {
		userPromptLines = append(userPromptLines, extra)
	}
	userPrompt := strings.Join(userPromptLines, "\n")

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
								"note":     map[string]any{"type": "string"},
								"parentId": map[string]any{"type": "string"},
								"kind":     map[string]any{"type": "string"},
								"priority": map[string]any{"type": "string"},
							},
							"required":             []string{"id", "title", "note", "parentId", "kind", "priority"},
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
	taskResult, err := s.runJSONTask(req.Settings, systemPrompt, userPrompt, schema, req.Debug, &payload)
	if err != nil {
		return aiGenerateResponse{}, err
	}
	payload, err = normalizeGeneratedGraphPayload(taskResult.Content, payload)
	if err != nil {
		return aiGenerateResponse{}, err
	}
	if mode == "new" && shouldRetryGeneratedHierarchy(payload) {
		retryPrompt := strings.Join([]string{
			userPrompt,
			"Revision rules:",
			"- The previous draft was too flat.",
			"- Rebuild it as a layered hierarchy with coherent sibling groups.",
			"- Keep 4 to 7 first-level branches, but give at least 2 branches meaningful second-level children.",
			"- Ensure at least 1 branch reaches third-level depth unless the topic truly cannot support it.",
			"- Preserve detailed notes for every node while revising the hierarchy.",
			"- Preserve only relation lines that connect distant branches semantically.",
		}, "\n")
		taskResult, err = s.runJSONTask(req.Settings, systemPrompt, retryPrompt, schema, req.Debug, &payload)
		if err != nil {
			return aiGenerateResponse{}, err
		}
		payload, err = normalizeGeneratedGraphPayload(taskResult.Content, payload)
		if err != nil {
			return aiGenerateResponse{}, err
		}
	}

	var document mindmap.Document
	if mode == "expand" && req.Document != nil {
		document, err = mergeGeneratedGraphIntoDocument(*req.Document, payload)
		if err != nil {
			return aiGenerateResponse{}, err
		}
	} else {
		document, err = generatedGraphToDocument(strings.TrimSpace(req.Topic), payload)
		if err != nil {
			return aiGenerateResponse{}, err
		}
	}

	return aiGenerateResponse{
		Document: document,
		Summary:  strings.TrimSpace(payload.Summary),
		Prompt:   userPrompt,
		Template: strings.TrimSpace(req.Template),
		Mode:     mode,
		Model:    taskResult.Model,
		Debug:    taskResult.Debug,
	}, nil
}

func (s *Server) importDocumentWithAI(req aiImportRequest) (aiImportResponse, error) {
	systemPrompt := strings.Join([]string{
		"You convert arbitrary text-format content into a structured mind-map document.",
		"Read the source content carefully and extract the hierarchy of topics, subtopics, and details.",
		"Organize it as a tree with a root node representing the overall document.",
		"CRITICAL FORMAT RULES (you MUST follow these exactly):",
		"- The top-level JSON object MUST have exactly four keys: title, summary, nodes, relations.",
		"- Do NOT invent alternate top-level shapes such as root, children, crossLinks, mindmap, graph, or any other key.",
		"- Do NOT wrap the JSON in markdown fences, a content string, or any commentary.",
		"- The first element of the nodes array MUST be the root node with kind=root and an empty parentId.",
		"- Every non-root node MUST have all six fields: id, title, note, parentId, kind, priority.",
		"- parentId must refer to an existing node id in the same array; never leave it empty for non-root nodes.",
		"- kind must be one of: root, topic, floating.  priority must be one of: (empty string), P0, P1, P2, P3.",
		"- relations is an array of {sourceId, targetId, label} for semantic cross-links only, not hierarchy.",
		"- Preserve the original structure and hierarchy of the source content as faithfully as possible.",
		"- Keep node titles short and put details in the note field.",
		"- Use the same language as the source content for titles and notes.",
	}, "\n")

	fileName := strings.TrimSpace(req.FileName)
	format := strings.TrimSpace(req.Format)
	if format == "" {
		format = path.Ext(fileName)
	}

	contentPreview := strings.TrimSpace(req.Content)
	if len(contentPreview) > 12000 {
		contentPreview = contentPreview[:12000] + "\n... (content truncated for token budget)"
	}

	userPromptLines := []string{
		fmt.Sprintf("Source file: %s (format: %s)", fileName, format),
		"",
		"Source content:",
		contentPreview,
		"",
		"Task:",
		"- Convert this content into a hierarchical mind-map.",
		"- Derive a clear title from the content.",
		"- Create a proper tree structure with meaningful groupings.",
		"- Prefer 2 to 4 levels of hierarchy when the content supports it.",
		"- Every node must include id, title, note, parentId, kind, priority.",
		"- Root and first-level branches should have especially detailed notes.",
		"- Use relation lines only for semantic cross-links between distant branches.",
	}
	if extra := optionalInstructionBlock(req.Instructions); extra != "" {
		userPromptLines = append(userPromptLines, extra)
	}
	userPrompt := strings.Join(userPromptLines, "\n")

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
								"note":     map[string]any{"type": "string"},
								"parentId": map[string]any{"type": "string"},
								"kind":     map[string]any{"type": "string"},
								"priority": map[string]any{"type": "string"},
							},
							"required":             []string{"id", "title", "note", "parentId", "kind", "priority"},
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
	taskResult, err := s.runJSONTask(req.Settings, systemPrompt, userPrompt, schema, req.Debug, &payload)
	if err != nil {
		return aiImportResponse{}, err
	}
	payload, err = normalizeGeneratedGraphPayload(taskResult.Content, payload)
	if err != nil {
		return aiImportResponse{}, err
	}

	title := strings.TrimSpace(payload.Title)
	if title == "" {
		title = strings.TrimSuffix(fileName, filepath.Ext(fileName))
	}
	if title == "" {
		title = "AI Import"
	}

	document, err := generatedGraphToDocument(title, payload)
	if err != nil {
		return aiImportResponse{}, err
	}

	return aiImportResponse{
		Document: document,
		Summary:  strings.TrimSpace(payload.Summary),
		Prompt:   userPrompt,
		Model:    taskResult.Model,
		Debug:    taskResult.Debug,
	}, nil
}

func (s *Server) suggestAIChildren(req aiSuggestChildrenRequest) (aiSuggestChildrenResponse, error) {
	type suggestionPayload struct {
		Summary     string              `json:"summary"`
		Suggestions []aiChildSuggestion `json:"suggestions"`
	}

	mode := normalizeAISuggestNodeMode(req.Mode)
	nodeMap := req.Document.NodeMap()
	targetNode, ok := nodeMap[strings.TrimSpace(req.TargetNodeID)]
	if !ok {
		return aiSuggestChildrenResponse{}, errors.New("target node not found")
	}
	promptNode := targetNode
	requestLine := fmt.Sprintf("Target node to suggest children for: id=%s, title=%q", targetNode.ID, targetNode.Title)
	taskLine := "- Suggest 3 to 6 child nodes for the target node."
	duplicateLine := "Existing children titles (avoid duplicating these): %s"

	systemPrompt := strings.Join([]string{
		"You suggest nearby nodes for a specific node in a mind map.",
		"Each suggestion should be a natural next-level subtopic, sibling topic, or detail depending on the requested mode.",
		"Keep titles short (under 30 characters preferred).",
		"Notes should be 1 to 3 informative sentences.",
		"Prefer the same language as the source mind map.",
		"Avoid duplicating existing children or sibling topics.",
	}, "\n")

	documentPayload, err := marshalMindMapForPrompt(req.Document)
	if err != nil {
		return aiSuggestChildrenResponse{}, err
	}

	existingChildren := make([]string, 0)
	if mode == "siblings" {
		parentNode, hasParent := nodeMap[strings.TrimSpace(targetNode.ParentID)]
		if !hasParent {
			return aiSuggestChildrenResponse{}, errors.New("target node has no parent for sibling suggestions")
		}
		promptNode = parentNode
		requestLine = fmt.Sprintf(
			"Target node to suggest siblings for: id=%s, title=%q, parent=%q",
			targetNode.ID,
			targetNode.Title,
			parentNode.Title,
		)
		taskLine = "- Suggest 3 to 6 sibling nodes that belong under the same parent as the target node."
		duplicateLine = "Existing sibling titles under the same parent (avoid duplicating these): %s"
	}

	for _, node := range req.Document.Nodes {
		if node.ParentID == promptNode.ID {
			existingChildren = append(existingChildren, strings.TrimSpace(node.Title))
		}
	}

	userPromptLines := []string{
		"Mind map document:",
		documentPayload,
		"",
		requestLine,
	}
	if len(existingChildren) > 0 {
		existingJSON, _ := json.Marshal(existingChildren)
		userPromptLines = append(userPromptLines, fmt.Sprintf(duplicateLine, string(existingJSON)))
	}
	userPromptLines = append(userPromptLines,
		"",
		"Task:",
		taskLine,
		"- Each suggestion should be a meaningful topic, detail, or related concept.",
		"- Titles should be concise and informative.",
		"- Notes should explain what the suggested node is about.",
	)
	if extra := optionalInstructionBlock(req.Instructions); extra != "" {
		userPromptLines = append(userPromptLines, extra)
	}
	userPrompt := strings.Join(userPromptLines, "\n")

	schema := map[string]any{
		"type": "json_schema",
		"json_schema": map[string]any{
			"name":   "mind_map_child_suggestions",
			"strict": true,
			"schema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"summary": map[string]any{"type": "string"},
					"suggestions": map[string]any{
						"type": "array",
						"items": map[string]any{
							"type": "object",
							"properties": map[string]any{
								"title": map[string]any{"type": "string"},
								"note":  map[string]any{"type": "string"},
							},
							"required":             []string{"title", "note"},
							"additionalProperties": false,
						},
					},
				},
				"required":             []string{"summary", "suggestions"},
				"additionalProperties": false,
			},
		},
	}

	var payload suggestionPayload
	taskResult, err := s.runJSONTask(req.Settings, systemPrompt, userPrompt, schema, req.Debug, &payload)
	if err != nil {
		return aiSuggestChildrenResponse{}, err
	}

	filtered := make([]aiChildSuggestion, 0, len(payload.Suggestions))
	for _, suggestion := range payload.Suggestions {
		suggestion.Title = strings.TrimSpace(suggestion.Title)
		suggestion.Note = strings.TrimSpace(suggestion.Note)
		if suggestion.Title == "" {
			continue
		}
		filtered = append(filtered, suggestion)
	}

	return aiSuggestChildrenResponse{
		Suggestions: filtered,
		Summary:     strings.TrimSpace(payload.Summary),
		Model:       taskResult.Model,
		Debug:       taskResult.Debug,
	}, nil
}

func (s *Server) testAIConnection(settings aiSettingsRequest) (aiTestResponse, error) {
	baseURL := normalizeAIBaseURL(settings.BaseURL)
	if err := s.checkAIBaseURL(baseURL); err != nil {
		return aiTestResponse{}, err
	}
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

func marshalMindMapForPrompt(doc mindmap.Document) (string, error) {
	type promptNode struct {
		ID       string           `json:"id"`
		Title    string           `json:"title"`
		Note     string           `json:"note,omitempty"`
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
			Note:     strings.TrimSpace(node.Note),
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

func resolveAIRelationFocusTargets(doc mindmap.Document, requested []string) []map[string]string {
	if len(requested) == 0 {
		return nil
	}

	nodeByID := doc.NodeMap()
	targets := make([]map[string]string, 0, len(requested))
	added := make(map[string]struct{}, len(requested))
	for _, nodeID := range requested {
		node, ok := nodeByID[strings.TrimSpace(nodeID)]
		if !ok {
			continue
		}
		if _, exists := added[node.ID]; exists {
			continue
		}
		added[node.ID] = struct{}{}
		targets = append(targets, map[string]string{
			"id":       node.ID,
			"title":    strings.TrimSpace(node.Title),
			"parentId": strings.TrimSpace(node.ParentID),
			"kind":     string(node.Kind),
		})
	}
	return targets
}

func relationFocusPromptBlock(targets []map[string]string) string {
	if len(targets) == 0 {
		return ""
	}

	payload, err := json.MarshalIndent(targets, "", "  ")
	if err != nil {
		return ""
	}

	return strings.Join([]string{
		"Focus nodes:",
		string(payload),
		"",
		"Focus rules:",
		"- Every returned relation must involve at least one focus node listed above.",
		"- Prefer relations that connect the focus nodes to other branches rather than only to nearby siblings.",
	}, "\n")
}

func relationSuggestionLimit(targets []map[string]string) int {
	if len(targets) > 0 {
		return 6
	}
	return 12
}

func filterSuggestedRelationsForFocus(relations []aiRelationSuggestion, targets []map[string]string) []aiRelationSuggestion {
	if len(targets) == 0 {
		return relations
	}

	validTargets := make(map[string]struct{}, len(targets))
	for _, target := range targets {
		if nodeID := strings.TrimSpace(target["id"]); nodeID != "" {
			validTargets[nodeID] = struct{}{}
		}
	}

	filtered := make([]aiRelationSuggestion, 0, len(relations))
	for _, relation := range relations {
		if _, ok := validTargets[relation.SourceID]; ok {
			filtered = append(filtered, relation)
			continue
		}
		if _, ok := validTargets[relation.TargetID]; ok {
			filtered = append(filtered, relation)
		}
	}
	return filtered
}

func resolveAINoteTargets(doc mindmap.Document, requested []string) []map[string]string {
	nodeByID := doc.NodeMap()
	targets := make([]map[string]string, 0)
	added := make(map[string]struct{})
	appendTarget := func(node mindmap.Node) {
		if _, exists := added[node.ID]; exists {
			return
		}
		added[node.ID] = struct{}{}
		targets = append(targets, map[string]string{
			"id":       node.ID,
			"title":    strings.TrimSpace(node.Title),
			"parentId": strings.TrimSpace(node.ParentID),
			"kind":     string(node.Kind),
			"note":     strings.TrimSpace(node.Note),
		})
	}

	for _, nodeID := range requested {
		if node, ok := nodeByID[strings.TrimSpace(nodeID)]; ok {
			appendTarget(node)
		}
	}
	if len(targets) > 0 {
		return targets
	}

	for _, node := range doc.Nodes {
		if node.Kind == mindmap.NodeKindRoot {
			continue
		}
		appendTarget(node)
	}
	if len(targets) > 0 {
		return targets
	}

	root := doc.Root()
	if strings.TrimSpace(root.ID) != "" {
		appendTarget(root)
	}
	return targets
}

func filterCompletedNodeNotes(doc mindmap.Document, requested []string, notes []aiNodeNoteSuggestion) []aiNodeNoteSuggestion {
	validTargets := make(map[string]struct{})
	nodeByID := doc.NodeMap()

	for _, nodeID := range requested {
		trimmed := strings.TrimSpace(nodeID)
		if trimmed == "" {
			continue
		}
		if _, exists := nodeByID[trimmed]; exists {
			validTargets[trimmed] = struct{}{}
		}
	}
	if len(validTargets) == 0 {
		for _, node := range doc.Nodes {
			if node.Kind == mindmap.NodeKindRoot {
				continue
			}
			validTargets[node.ID] = struct{}{}
		}
		if len(validTargets) == 0 {
			root := doc.Root()
			if strings.TrimSpace(root.ID) != "" {
				validTargets[root.ID] = struct{}{}
			}
		}
	}

	filtered := make([]aiNodeNoteSuggestion, 0, len(notes))
	added := make(map[string]struct{}, len(notes))
	for _, item := range notes {
		item.ID = strings.TrimSpace(item.ID)
		item.Note = strings.TrimSpace(item.Note)
		if item.ID == "" || item.Note == "" {
			continue
		}
		if _, ok := validTargets[item.ID]; !ok {
			continue
		}
		if _, exists := added[item.ID]; exists {
			continue
		}
		added[item.ID] = struct{}{}
		filtered = append(filtered, item)
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
				Note:      strings.TrimSpace(rootSource.Note),
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
			Note:      strings.TrimSpace(node.Note),
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
		Note:      strings.TrimSpace(source.Note),
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

func shouldRetryGeneratedHierarchy(payload aiGeneratedGraph) bool {
	if len(payload.Nodes) < 7 {
		return false
	}

	root := findGeneratedRoot(payload.Nodes)
	if strings.TrimSpace(root.ID) == "" {
		return false
	}

	rootChildren := 0
	for _, node := range payload.Nodes {
		if strings.TrimSpace(node.ID) == "" || strings.TrimSpace(node.ID) == strings.TrimSpace(root.ID) {
			continue
		}
		if strings.TrimSpace(node.ParentID) == strings.TrimSpace(root.ID) {
			rootChildren++
		}
	}

	maxDepth := generatedGraphMaxDepth(payload)
	if rootChildren >= 5 && maxDepth < 2 {
		return true
	}
	if len(payload.Nodes) >= 12 && rootChildren >= 6 && maxDepth < 3 {
		return true
	}

	return false
}

func generatedGraphMaxDepth(payload aiGeneratedGraph) int {
	root := findGeneratedRoot(payload.Nodes)
	if strings.TrimSpace(root.ID) == "" {
		return 0
	}

	parentByID := make(map[string]string, len(payload.Nodes))
	for _, node := range payload.Nodes {
		nodeID := strings.TrimSpace(node.ID)
		if nodeID == "" {
			continue
		}
		parentByID[nodeID] = strings.TrimSpace(node.ParentID)
	}

	maxDepth := 0
	for _, node := range payload.Nodes {
		nodeID := strings.TrimSpace(node.ID)
		if nodeID == "" || nodeID == strings.TrimSpace(root.ID) {
			continue
		}

		depth := 0
		current := nodeID
		visited := map[string]struct{}{}
		for current != "" && current != strings.TrimSpace(root.ID) {
			if _, seen := visited[current]; seen {
				depth = 0
				break
			}
			visited[current] = struct{}{}

			parentID := strings.TrimSpace(parentByID[current])
			if parentID == "" {
				depth = 0
				break
			}
			depth++
			current = parentID
		}

		if current == strings.TrimSpace(root.ID) && depth > maxDepth {
			maxDepth = depth
		}
	}

	return maxDepth
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

func normalizeAIGenerateMode(mode string) string {
	if strings.EqualFold(strings.TrimSpace(mode), "expand") {
		return "expand"
	}
	return "new"
}

func normalizeAISuggestNodeMode(mode string) string {
	if strings.EqualFold(strings.TrimSpace(mode), "siblings") {
		return "siblings"
	}
	return "children"
}

func documentTitleOrEmpty(doc *mindmap.Document) string {
	if doc == nil {
		return ""
	}
	root := doc.Root()
	if strings.TrimSpace(root.Title) != "" {
		return strings.TrimSpace(root.Title)
	}
	return strings.TrimSpace(doc.Title)
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

func normalizeGeneratedGraphPayload(raw string, parsed aiGeneratedGraph) (aiGeneratedGraph, error) {
	if !generatedGraphNeedsNormalization(parsed) {
		return trimGeneratedGraph(parsed), nil
	}
	graph, err := salvageGeneratedGraph(raw)
	if err != nil {
		return trimGeneratedGraph(parsed), nil
	}
	return trimGeneratedGraph(graph), nil
}

func generatedGraphNeedsNormalization(payload aiGeneratedGraph) bool {
	if len(payload.Nodes) == 0 {
		return true
	}
	missingIDs := 0
	structured := 0
	for _, node := range payload.Nodes {
		if strings.TrimSpace(node.ID) == "" {
			missingIDs++
		}
		if strings.TrimSpace(node.ParentID) != "" || strings.EqualFold(strings.TrimSpace(node.Kind), string(mindmap.NodeKindRoot)) {
			structured++
		}
	}
	if missingIDs*2 > len(payload.Nodes) {
		return true
	}
	if structured == 0 {
		return true
	}
	return false
}

func trimGeneratedGraph(payload aiGeneratedGraph) aiGeneratedGraph {
	payload.Title = strings.TrimSpace(payload.Title)
	payload.Summary = strings.TrimSpace(payload.Summary)
	for index := range payload.Nodes {
		payload.Nodes[index].ID = strings.TrimSpace(payload.Nodes[index].ID)
		payload.Nodes[index].Title = strings.TrimSpace(payload.Nodes[index].Title)
		payload.Nodes[index].Note = strings.TrimSpace(payload.Nodes[index].Note)
		payload.Nodes[index].ParentID = strings.TrimSpace(payload.Nodes[index].ParentID)
		payload.Nodes[index].Kind = strings.TrimSpace(payload.Nodes[index].Kind)
		payload.Nodes[index].Priority = strings.TrimSpace(payload.Nodes[index].Priority)
	}
	for index := range payload.Relations {
		payload.Relations[index].SourceID = strings.TrimSpace(payload.Relations[index].SourceID)
		payload.Relations[index].TargetID = strings.TrimSpace(payload.Relations[index].TargetID)
		payload.Relations[index].Label = strings.TrimSpace(payload.Relations[index].Label)
	}
	return payload
}

func salvageGeneratedGraph(raw string) (aiGeneratedGraph, error) {
	for _, candidate := range collectAIJSONCandidates(raw) {
		var value any
		if err := json.Unmarshal([]byte(candidate), &value); err != nil {
			continue
		}
		if graph, ok := coerceGeneratedGraph(value); ok {
			return graph, nil
		}
	}
	return aiGeneratedGraph{}, errors.New("no salvageable graph payload found")
}

func coerceGeneratedGraph(value any) (aiGeneratedGraph, bool) {
	object, ok := value.(map[string]any)
	if !ok {
		return aiGeneratedGraph{}, false
	}
	if graph, ok := coerceAlternateGeneratedGraph(object); ok {
		return graph, true
	}

	payloadBytes, err := json.Marshal(object)
	if err != nil {
		return aiGeneratedGraph{}, false
	}
	var graph aiGeneratedGraph
	if err := json.Unmarshal(payloadBytes, &graph); err != nil {
		return aiGeneratedGraph{}, false
	}
	if len(graph.Nodes) == 0 && len(graph.Relations) == 0 && strings.TrimSpace(graph.Title) == "" {
		return aiGeneratedGraph{}, false
	}
	return graph, true
}

func coerceAlternateGeneratedGraph(object map[string]any) (aiGeneratedGraph, bool) {
	rootObject, hasRoot := object["root"].(map[string]any)
	_, hasEdges := object["edges"]
	_, hasNodes := object["nodes"]
	if !hasRoot && !hasEdges && !hasNodes {
		return aiGeneratedGraph{}, false
	}

	graph := aiGeneratedGraph{
		Title:     fallbackString(readObjectString(object, "title"), readObjectString(rootObject, "title")),
		Summary:   fallbackString(readObjectString(object, "summary"), readObjectString(rootObject, "description")),
		Nodes:     make([]aiGeneratedNode, 0),
		Relations: make([]aiGeneratedRelation, 0),
	}

	titleToID := make(map[string]string)
	relationSet := make(map[string]struct{})
	nextNodeID := 1

	ensureNode := func(title string, note string, parentID string, kind string) string {
		title = strings.TrimSpace(title)
		note = strings.TrimSpace(note)
		if title == "" {
			title = fmt.Sprintf("Node %d", nextNodeID)
		}
		titleKey := strings.ToLower(title)
		if existingID, ok := titleToID[titleKey]; ok {
			for index := range graph.Nodes {
				if graph.Nodes[index].ID == existingID && graph.Nodes[index].Note == "" && note != "" {
					graph.Nodes[index].Note = note
				}
			}
			return existingID
		}

		nodeID := fmt.Sprintf("node-%d", nextNodeID)
		nextNodeID++
		graph.Nodes = append(graph.Nodes, aiGeneratedNode{
			ID:       nodeID,
			Title:    title,
			Note:     note,
			ParentID: strings.TrimSpace(parentID),
			Kind:     fallbackString(strings.TrimSpace(kind), string(mindmap.NodeKindTopic)),
			Priority: "",
		})
		titleToID[titleKey] = nodeID
		return nodeID
	}

	addRelation := func(source string, target string, label string) {
		source = strings.TrimSpace(source)
		target = strings.TrimSpace(target)
		label = strings.TrimSpace(label)
		if source == "" || target == "" || source == target {
			return
		}
		if label == "" {
			label = "related"
		}
		key := normalizedPairKey(source, target) + "::" + strings.ToLower(label)
		if _, exists := relationSet[key]; exists {
			return
		}
		relationSet[key] = struct{}{}
		graph.Relations = append(graph.Relations, aiGeneratedRelation{
			SourceID: source,
			TargetID: target,
			Label:    label,
		})
	}

	var walkChildren func(items []any, parentID string)
	walkChildren = func(items []any, parentID string) {
		for _, item := range items {
			childObject, ok := item.(map[string]any)
			if !ok {
				continue
			}
			childID := ensureNode(
				readObjectString(childObject, "title"),
				fallbackString(readObjectString(childObject, "note"), readObjectString(childObject, "description")),
				parentID,
				string(mindmap.NodeKindTopic),
			)
			for _, relation := range coerceAlternateRelations(childObject["links"]) {
				addRelation(
					ensureNode(relation.SourceID, "", "", string(mindmap.NodeKindTopic)),
					ensureNode(relation.TargetID, "", "", string(mindmap.NodeKindTopic)),
					relation.Label,
				)
			}
			if nestedChildren, ok := childObject["children"].([]any); ok {
				walkChildren(nestedChildren, childID)
			}
		}
	}

	rootID := ensureNode(
		fallbackString(readObjectString(rootObject, "title"), graph.Title),
		fallbackString(readObjectString(rootObject, "note"), readObjectString(rootObject, "description")),
		"",
		string(mindmap.NodeKindRoot),
	)
	for index := range graph.Nodes {
		if graph.Nodes[index].ID == rootID {
			graph.Nodes[index].Kind = string(mindmap.NodeKindRoot)
			graph.Nodes[index].ParentID = ""
		}
	}
	if graph.Title == "" {
		graph.Title = readObjectString(rootObject, "title")
	}

	if rootChildren, ok := rootObject["children"].([]any); ok {
		walkChildren(rootChildren, rootID)
	}
	for _, relation := range coerceAlternateRelations(rootObject["crossLinks"]) {
		addRelation(
			ensureNode(relation.SourceID, "", "", string(mindmap.NodeKindTopic)),
			ensureNode(relation.TargetID, "", "", string(mindmap.NodeKindTopic)),
			relation.Label,
		)
	}

	if nodeItems, ok := object["nodes"].([]any); ok {
		walkChildren(nodeItems, rootID)
	}
	for _, relation := range coerceAlternateRelations(object["edges"]) {
		addRelation(
			ensureNode(relation.SourceID, "", "", string(mindmap.NodeKindTopic)),
			ensureNode(relation.TargetID, "", "", string(mindmap.NodeKindTopic)),
			relation.Label,
		)
	}

	if len(graph.Nodes) == 0 {
		return aiGeneratedGraph{}, false
	}
	return graph, true
}

func coerceAlternateRelations(value any) []aiGeneratedRelation {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	result := make([]aiGeneratedRelation, 0, len(items))
	for _, item := range items {
		object, ok := item.(map[string]any)
		if !ok {
			continue
		}
		source := fallbackString(readObjectString(object, "sourceId"), readObjectString(object, "source"))
		target := fallbackString(readObjectString(object, "targetId"), readObjectString(object, "target"))
		label := fallbackString(readObjectString(object, "label"), readObjectString(object, "type"))
		label = fallbackString(label, readObjectString(object, "title"))
		label = fallbackString(label, readObjectString(object, "note"))
		result = append(result, aiGeneratedRelation{
			SourceID: source,
			TargetID: target,
			Label:    shortenText(strings.TrimSpace(label), 48),
		})
	}
	return result
}

func readObjectString(object map[string]any, key string) string {
	if object == nil {
		return ""
	}
	value, ok := object[key]
	if !ok {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	default:
		return ""
	}
}

func shortenText(value string, limit int) string {
	value = strings.TrimSpace(value)
	if limit <= 0 || len([]rune(value)) <= limit {
		return value
	}
	runes := []rune(value)
	if limit <= 1 {
		return string(runes[:limit])
	}
	return string(runes[:limit-1]) + "…"
}

func mergeGeneratedGraphIntoDocument(base mindmap.Document, payload aiGeneratedGraph) (mindmap.Document, error) {
	doc := base
	now := time.Now().UTC()
	root := doc.Root()
	existingByID := doc.NodeMap()
	idMapping := make(map[string]string)
	titleToID := make(map[string]string, len(doc.Nodes))
	for _, node := range doc.Nodes {
		title := strings.ToLower(strings.TrimSpace(node.Title))
		if title != "" {
			titleToID[title] = node.ID
		}
	}

	rawRoot := findGeneratedRoot(payload.Nodes)
	if strings.TrimSpace(rawRoot.ID) != "" {
		idMapping[strings.TrimSpace(rawRoot.ID)] = root.ID
	}

	pending := make([]aiGeneratedNode, 0, len(payload.Nodes))
	for _, node := range payload.Nodes {
		if strings.EqualFold(strings.TrimSpace(node.Kind), string(mindmap.NodeKindRoot)) {
			continue
		}
		if strings.TrimSpace(node.ID) == strings.TrimSpace(rawRoot.ID) && strings.TrimSpace(rawRoot.ID) != "" {
			continue
		}
		pending = append(pending, node)
	}

	addedNodes := 0
	for len(pending) > 0 {
		progressed := false
		nextPending := make([]aiGeneratedNode, 0, len(pending))
		for _, node := range pending {
			actualParentID, resolved := resolveExpansionParentID(node, root.ID, existingByID, idMapping)
			if !resolved {
				nextPending = append(nextPending, node)
				continue
			}
			appendExpandedNode(&doc, node, actualParentID, now, existingByID, idMapping, titleToID)
			addedNodes++
			progressed = true
		}
		if !progressed {
			for _, node := range nextPending {
				appendExpandedNode(&doc, node, root.ID, now, existingByID, idMapping, titleToID)
				addedNodes++
			}
			break
		}
		pending = nextPending
	}

	relationPairs := make(map[string]struct{}, len(doc.Relations))
	for _, relation := range doc.Relations {
		relationPairs[normalizedPairKey(relation.SourceID, relation.TargetID)] = struct{}{}
	}
	for _, relation := range payload.Relations {
		sourceID := resolveExpansionNodeReference(relation.SourceID, existingByID, idMapping, titleToID)
		targetID := resolveExpansionNodeReference(relation.TargetID, existingByID, idMapping, titleToID)
		label := strings.TrimSpace(relation.Label)
		if sourceID == "" || targetID == "" || sourceID == targetID {
			continue
		}
		key := normalizedPairKey(sourceID, targetID)
		if _, exists := relationPairs[key]; exists {
			continue
		}
		relationPairs[key] = struct{}{}
		doc.Relations = append(doc.Relations, mindmap.RelationEdge{
			ID:        mindmap.NewID("rel"),
			SourceID:  sourceID,
			TargetID:  targetID,
			Label:     label,
			CreatedAt: now,
			UpdatedAt: now,
		})
	}

	if addedNodes == 0 {
		return base, nil
	}
	doc.PrepareForSave(now)
	if err := doc.Validate(); err != nil {
		return mindmap.Document{}, err
	}
	return doc, nil
}

func resolveExpansionParentID(
	node aiGeneratedNode,
	rootID string,
	existingByID map[string]mindmap.Node,
	idMapping map[string]string,
) (string, bool) {
	parentID := strings.TrimSpace(node.ParentID)
	if parentID == "" {
		return rootID, true
	}
	if actualID, ok := idMapping[parentID]; ok {
		return actualID, true
	}
	if _, ok := existingByID[parentID]; ok {
		return parentID, true
	}
	return "", false
}

func appendExpandedNode(
	doc *mindmap.Document,
	node aiGeneratedNode,
	actualParentID string,
	now time.Time,
	existingByID map[string]mindmap.Node,
	idMapping map[string]string,
	titleToID map[string]string,
) {
	lookupKey := strings.ToLower(strings.TrimSpace(node.Title))
	if lookupKey != "" {
		if existingID, ok := titleToID[lookupKey]; ok {
			idMapping[strings.TrimSpace(node.ID)] = existingID
			return
		}
	}

	actualID := ensureGeneratedNode(existingByID, node.ID)
	position := nextChildPositionForDocument(*doc, actualParentID)
	parentID := actualParentID
	kind := parseNodeKind(node.Kind)
	if kind == mindmap.NodeKindFloating && strings.TrimSpace(node.ParentID) == "" {
		parentID = ""
		position = nextFloatingPositionForDocument(*doc)
	}

	newNode := mindmap.Node{
		ID:        actualID,
		ParentID:  parentID,
		Kind:      kind,
		Title:     fallbackString(strings.TrimSpace(node.Title), "Untitled"),
		Note:      strings.TrimSpace(node.Note),
		Priority:  parsePriority(node.Priority),
		Position:  position,
		CreatedAt: now,
		UpdatedAt: now,
	}
	doc.Nodes = append(doc.Nodes, newNode)
	existingByID[actualID] = newNode
	if titleKey := strings.ToLower(strings.TrimSpace(newNode.Title)); titleKey != "" {
		titleToID[titleKey] = actualID
	}
	idMapping[strings.TrimSpace(node.ID)] = actualID
}

func resolveExpansionNodeReference(
	raw string,
	existingByID map[string]mindmap.Node,
	idMapping map[string]string,
	titleToID map[string]string,
) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if actualID, ok := idMapping[raw]; ok {
		return actualID
	}
	if _, ok := existingByID[raw]; ok {
		return raw
	}
	if actualID, ok := titleToID[strings.ToLower(raw)]; ok {
		return actualID
	}
	return ""
}

func nextChildPositionForDocument(doc mindmap.Document, parentID string) mindmap.Position {
	parent, ok := doc.NodeMap()[parentID]
	if !ok {
		return mindmap.Position{X: defaultRootX, Y: defaultRootY}
	}
	children := doc.ChildrenOf(parentID)
	if len(children) == 0 {
		return mindmap.Position{X: parent.Position.X + 280, Y: parent.Position.Y}
	}
	last := children[len(children)-1]
	return mindmap.Position{X: parent.Position.X + 280, Y: last.Position.Y + 96}
}

func nextFloatingPositionForDocument(doc mindmap.Document) mindmap.Position {
	root := doc.Root()
	lastY := root.Position.Y + 180.0
	hasFloating := false
	for _, node := range doc.Nodes {
		if node.Kind != mindmap.NodeKindFloating {
			continue
		}
		if !hasFloating || node.Position.Y > lastY {
			lastY = node.Position.Y
		}
		hasFloating = true
	}
	if !hasFloating {
		return mindmap.Position{X: root.Position.X - 140, Y: root.Position.Y + 180}
	}
	return mindmap.Position{X: root.Position.X - 140, Y: lastY + 96}
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
