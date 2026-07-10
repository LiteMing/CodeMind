package mindmap

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"slices"
	"strings"
	"time"
)

const (
	ProjectMapSemanticFormat        = "codemind.project-map.semantic"
	ProjectMapLayoutFormat          = "codemind.project-map.layout"
	ProjectMapFormatSchemaVersion   = 1
	ProjectMapDefaultRuntimeVersion = 1
)

type ProjectMapMergeMode string

const (
	ProjectMapMergeStrict    ProjectMapMergeMode = "strict"
	ProjectMapMergeReconcile ProjectMapMergeMode = "reconcile"
)

type ProjectMapSemanticDocument struct {
	Format        string                       `json:"format"`
	SchemaVersion int                          `json:"schemaVersion"`
	MapID         string                       `json:"mapId"`
	Nodes         []ProjectMapSemanticNode     `json:"nodes"`
	Relations     []ProjectMapSemanticRelation `json:"relations"`
	Regions       []ProjectMapSemanticRegion   `json:"regions"`
}

type ProjectMapSemanticNode struct {
	ID       string        `json:"id"`
	ParentID string        `json:"parentId,omitempty"`
	Kind     NodeKind      `json:"kind"`
	Order    int           `json:"order"`
	Title    string        `json:"title"`
	Note     string        `json:"note,omitempty"`
	Priority Priority      `json:"priority,omitempty"`
	Color    NodeColor     `json:"color,omitempty"`
	Bindings []NodeBinding `json:"bindings"`
}

type ProjectMapSemanticRelation struct {
	ID             string           `json:"id"`
	SourceID       string           `json:"sourceId"`
	TargetID       string           `json:"targetId"`
	Label          string           `json:"label,omitempty"`
	ArrowDirection ArrowDirection   `json:"arrowDirection"`
	Branches       []RelationBranch `json:"branches"`
}

type ProjectMapSemanticRegion struct {
	ID    string    `json:"id"`
	Label string    `json:"label"`
	Color NodeColor `json:"color,omitempty"`
}

type ProjectMapLayoutDocument struct {
	Format        string                     `json:"format"`
	SchemaVersion int                        `json:"schemaVersion"`
	MapID         string                     `json:"mapId"`
	Theme         Theme                      `json:"theme"`
	Nodes         []ProjectMapLayoutNode     `json:"nodes"`
	Relations     []ProjectMapLayoutRelation `json:"relations"`
	Regions       []ProjectMapLayoutRegion   `json:"regions"`
	RuntimeMeta   ProjectMapRuntimeMeta      `json:"runtimeMeta"`
}

type ProjectMapLayoutNode struct {
	ID        string    `json:"id"`
	Position  Position  `json:"position"`
	Width     float64   `json:"width,omitempty"`
	Height    float64   `json:"height,omitempty"`
	Collapsed bool      `json:"collapsed,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type ProjectMapLayoutRelation struct {
	ID             string     `json:"id"`
	MidpointT      float64    `json:"midpointT,omitempty"`
	MidpointOffset *Position  `json:"midpointOffset,omitempty"`
	Waypoints      []Position `json:"waypoints"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
}

type ProjectMapLayoutRegion struct {
	ID        string    `json:"id"`
	Position  Position  `json:"position"`
	Width     float64   `json:"width"`
	Height    float64   `json:"height"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type ProjectMapRuntimeMeta struct {
	RuntimeSchemaVersion int       `json:"runtimeSchemaVersion"`
	Revision             uint64    `json:"revision"`
	LastEditedAt         time.Time `json:"lastEditedAt"`
	LastOpenedAt         time.Time `json:"lastOpenedAt"`
}

func SplitProjectMapDocument(doc Document) (ProjectMapSemanticDocument, ProjectMapLayoutDocument, error) {
	cloned, err := cloneRuntimeDocument(doc)
	if err != nil {
		return ProjectMapSemanticDocument{}, ProjectMapLayoutDocument{}, err
	}
	if cloned.Theme == "" {
		cloned.Theme = ThemeDark
	}
	if err := validateProjectMapTheme(cloned.Theme); err != nil {
		return ProjectMapSemanticDocument{}, ProjectMapLayoutDocument{}, err
	}
	cloned.NormalizeMetadata()
	if err := cloned.Validate(); err != nil {
		return ProjectMapSemanticDocument{}, ProjectMapLayoutDocument{}, err
	}

	semantic := semanticFromValidatedDocument(cloned)
	layout := layoutFromValidatedDocument(cloned)
	return semantic, layout, nil
}

func MergeProjectMapDocuments(
	semantic ProjectMapSemanticDocument,
	layout *ProjectMapLayoutDocument,
	mode ProjectMapMergeMode,
	now time.Time,
) (Document, error) {
	canonicalSemantic, err := canonicalizeProjectMapSemantic(semantic)
	if err != nil {
		return Document{}, err
	}
	if mode != ProjectMapMergeStrict && mode != ProjectMapMergeReconcile {
		return Document{}, fmt.Errorf("unsupported project map merge mode %q", mode)
	}
	if mode == ProjectMapMergeStrict && layout == nil {
		return Document{}, errors.New("strict project map merge requires a layout document")
	}

	var canonicalLayout *ProjectMapLayoutDocument
	if layout != nil {
		layoutInput := *layout
		if mode == ProjectMapMergeReconcile {
			layoutInput = filterProjectMapLayoutForSemantic(layoutInput, canonicalSemantic)
		}
		normalized, err := canonicalizeProjectMapLayout(layoutInput)
		if err != nil {
			return Document{}, err
		}
		if normalized.MapID != canonicalSemantic.MapID {
			return Document{}, fmt.Errorf("project map layout mapId %q does not match semantic mapId %q", normalized.MapID, canonicalSemantic.MapID)
		}
		canonicalLayout = &normalized
	}

	if mode == ProjectMapMergeStrict {
		if err := validateStrictProjectMapIDs(canonicalSemantic, *canonicalLayout); err != nil {
			return Document{}, err
		}
	}

	now = now.UTC()
	if now.IsZero() {
		now = time.Unix(0, 0).UTC()
	}
	defaultPositions := defaultProjectMapPositions(canonicalSemantic.Nodes)
	layoutNodes := make(map[string]ProjectMapLayoutNode)
	layoutRelations := make(map[string]ProjectMapLayoutRelation)
	layoutRegions := make(map[string]ProjectMapLayoutRegion)
	if canonicalLayout != nil {
		for _, node := range canonicalLayout.Nodes {
			layoutNodes[node.ID] = node
		}
		for _, relation := range canonicalLayout.Relations {
			layoutRelations[relation.ID] = relation
		}
		for _, region := range canonicalLayout.Regions {
			layoutRegions[region.ID] = region
		}
	}

	doc := Document{
		ID:        canonicalSemantic.MapID,
		Theme:     ThemeDark,
		Nodes:     make([]Node, 0, len(canonicalSemantic.Nodes)),
		Relations: make([]RelationEdge, 0, len(canonicalSemantic.Relations)),
		Regions:   make([]RegionBox, 0, len(canonicalSemantic.Regions)),
		Meta: Meta{
			Version:      ProjectMapDefaultRuntimeVersion,
			Revision:     1,
			LastEditedAt: now,
			LastOpenedAt: now,
		},
	}
	if canonicalLayout != nil {
		doc.Theme = canonicalLayout.Theme
		doc.Meta = Meta{
			Version:      canonicalLayout.RuntimeMeta.RuntimeSchemaVersion,
			Revision:     canonicalLayout.RuntimeMeta.Revision,
			LastEditedAt: canonicalLayout.RuntimeMeta.LastEditedAt,
			LastOpenedAt: canonicalLayout.RuntimeMeta.LastOpenedAt,
		}
	}

	for _, semanticNode := range canonicalSemantic.Nodes {
		layoutNode, hasLayout := layoutNodes[semanticNode.ID]
		position := defaultPositions[semanticNode.ID]
		createdAt := now
		updatedAt := now
		if hasLayout {
			position = layoutNode.Position
			createdAt = layoutNode.CreatedAt
			updatedAt = layoutNode.UpdatedAt
		}
		node := Node{
			ID:        semanticNode.ID,
			ParentID:  semanticNode.ParentID,
			Kind:      semanticNode.Kind,
			Order:     semanticNode.Order,
			Title:     semanticNode.Title,
			Note:      semanticNode.Note,
			Priority:  semanticNode.Priority,
			Color:     semanticNode.Color,
			Bindings:  cloneNodeBindings(semanticNode.Bindings),
			Position:  position,
			CreatedAt: createdAt,
			UpdatedAt: updatedAt,
		}
		if hasLayout {
			node.Width = layoutNode.Width
			node.Height = layoutNode.Height
			node.Collapsed = layoutNode.Collapsed
		}
		doc.Nodes = append(doc.Nodes, node)
		if node.Kind == NodeKindRoot {
			doc.Title = node.Title
		}
	}

	for _, semanticRelation := range canonicalSemantic.Relations {
		layoutRelation, hasLayout := layoutRelations[semanticRelation.ID]
		relation := RelationEdge{
			ID:             semanticRelation.ID,
			SourceID:       semanticRelation.SourceID,
			TargetID:       semanticRelation.TargetID,
			Label:          semanticRelation.Label,
			ArrowDirection: semanticRelation.ArrowDirection,
			Branches:       cloneRelationBranches(semanticRelation.Branches),
			Waypoints:      []Position{},
			CreatedAt:      now,
			UpdatedAt:      now,
		}
		if hasLayout {
			relation.MidpointT = layoutRelation.MidpointT
			relation.MidpointOffset = clonePosition(layoutRelation.MidpointOffset)
			relation.Waypoints = append([]Position(nil), layoutRelation.Waypoints...)
			relation.CreatedAt = layoutRelation.CreatedAt
			relation.UpdatedAt = layoutRelation.UpdatedAt
		}
		doc.Relations = append(doc.Relations, relation)
	}

	for index, semanticRegion := range canonicalSemantic.Regions {
		layoutRegion, hasLayout := layoutRegions[semanticRegion.ID]
		region := RegionBox{
			ID:        semanticRegion.ID,
			Label:     semanticRegion.Label,
			Color:     semanticRegion.Color,
			Position:  Position{X: 540, Y: 180 + float64(index*180)},
			Width:     320,
			Height:    160,
			CreatedAt: now,
			UpdatedAt: now,
		}
		if hasLayout {
			region.Position = layoutRegion.Position
			region.Width = layoutRegion.Width
			region.Height = layoutRegion.Height
			region.CreatedAt = layoutRegion.CreatedAt
			region.UpdatedAt = layoutRegion.UpdatedAt
		}
		doc.Regions = append(doc.Regions, region)
	}

	if err := doc.Validate(); err != nil {
		return Document{}, err
	}
	return doc, nil
}

func filterProjectMapLayoutForSemantic(
	layout ProjectMapLayoutDocument,
	semantic ProjectMapSemanticDocument,
) ProjectMapLayoutDocument {
	nodeIDs := make(map[string]struct{}, len(semantic.Nodes))
	for _, node := range semantic.Nodes {
		nodeIDs[node.ID] = struct{}{}
	}
	relationIDs := make(map[string]struct{}, len(semantic.Relations))
	for _, relation := range semantic.Relations {
		relationIDs[relation.ID] = struct{}{}
	}
	regionIDs := make(map[string]struct{}, len(semantic.Regions))
	for _, region := range semantic.Regions {
		regionIDs[region.ID] = struct{}{}
	}

	filtered := layout
	filtered.Nodes = make([]ProjectMapLayoutNode, 0, len(layout.Nodes))
	for _, node := range layout.Nodes {
		if _, exists := nodeIDs[node.ID]; exists {
			filtered.Nodes = append(filtered.Nodes, node)
		}
	}
	filtered.Relations = make([]ProjectMapLayoutRelation, 0, len(layout.Relations))
	for _, relation := range layout.Relations {
		if _, exists := relationIDs[relation.ID]; exists {
			filtered.Relations = append(filtered.Relations, relation)
		}
	}
	filtered.Regions = make([]ProjectMapLayoutRegion, 0, len(layout.Regions))
	for _, region := range layout.Regions {
		if _, exists := regionIDs[region.ID]; exists {
			filtered.Regions = append(filtered.Regions, region)
		}
	}
	return filtered
}

func MarshalProjectMapSemantic(doc ProjectMapSemanticDocument) ([]byte, error) {
	canonical, err := canonicalizeProjectMapSemantic(doc)
	if err != nil {
		return nil, err
	}
	return marshalProjectMapJSON(canonical)
}

func MarshalProjectMapLayout(doc ProjectMapLayoutDocument) ([]byte, error) {
	canonical, err := canonicalizeProjectMapLayout(doc)
	if err != nil {
		return nil, err
	}
	return marshalProjectMapJSON(canonical)
}

func ParseProjectMapSemantic(payload []byte) (ProjectMapSemanticDocument, error) {
	var doc ProjectMapSemanticDocument
	if err := decodeProjectMapJSON(payload, &doc); err != nil {
		return ProjectMapSemanticDocument{}, err
	}
	return canonicalizeProjectMapSemantic(doc)
}

func ParseProjectMapLayout(payload []byte) (ProjectMapLayoutDocument, error) {
	doc, err := DecodeProjectMapLayout(payload)
	if err != nil {
		return ProjectMapLayoutDocument{}, err
	}
	return canonicalizeProjectMapLayout(doc)
}

// DecodeProjectMapLayout decodes the layout envelope without validating
// entity payloads. Reconcile callers use it so stale orphan entries can be
// filtered by semantic IDs before the applicable layout is validated.
func DecodeProjectMapLayout(payload []byte) (ProjectMapLayoutDocument, error) {
	var doc ProjectMapLayoutDocument
	if err := decodeProjectMapJSON(payload, &doc); err != nil {
		return ProjectMapLayoutDocument{}, err
	}
	return doc, nil
}

func semanticFromValidatedDocument(doc Document) ProjectMapSemanticDocument {
	nodes := make([]ProjectMapSemanticNode, 0, len(doc.Nodes))
	for _, node := range doc.Nodes {
		bindings := cloneNodeBindings(node.Bindings)
		slices.SortFunc(bindings, func(left, right NodeBinding) int {
			return strings.Compare(left.ID, right.ID)
		})
		if bindings == nil {
			bindings = []NodeBinding{}
		}
		nodes = append(nodes, ProjectMapSemanticNode{
			ID:       node.ID,
			ParentID: node.ParentID,
			Kind:     node.Kind,
			Order:    node.Order,
			Title:    node.Title,
			Note:     node.Note,
			Priority: node.Priority,
			Color:    node.Color,
			Bindings: bindings,
		})
	}
	slices.SortFunc(nodes, func(left, right ProjectMapSemanticNode) int {
		switch {
		case left.Kind == NodeKindRoot && right.Kind != NodeKindRoot:
			return -1
		case right.Kind == NodeKindRoot && left.Kind != NodeKindRoot:
			return 1
		default:
			return strings.Compare(left.ID, right.ID)
		}
	})

	relations := make([]ProjectMapSemanticRelation, 0, len(doc.Relations))
	for _, relation := range doc.Relations {
		branches := cloneRelationBranches(relation.Branches)
		slices.SortFunc(branches, func(left, right RelationBranch) int {
			return strings.Compare(left.TargetID, right.TargetID)
		})
		if branches == nil {
			branches = []RelationBranch{}
		}
		direction := relation.ArrowDirection
		if direction == "" {
			direction = ArrowDirectionNone
		}
		relations = append(relations, ProjectMapSemanticRelation{
			ID:             relation.ID,
			SourceID:       relation.SourceID,
			TargetID:       relation.TargetID,
			Label:          relation.Label,
			ArrowDirection: direction,
			Branches:       branches,
		})
	}
	slices.SortFunc(relations, func(left, right ProjectMapSemanticRelation) int {
		return strings.Compare(left.ID, right.ID)
	})

	regions := make([]ProjectMapSemanticRegion, 0, len(doc.Regions))
	for _, region := range doc.Regions {
		regions = append(regions, ProjectMapSemanticRegion{
			ID:    region.ID,
			Label: region.Label,
			Color: region.Color,
		})
	}
	slices.SortFunc(regions, func(left, right ProjectMapSemanticRegion) int {
		return strings.Compare(left.ID, right.ID)
	})

	return ProjectMapSemanticDocument{
		Format:        ProjectMapSemanticFormat,
		SchemaVersion: ProjectMapFormatSchemaVersion,
		MapID:         doc.ID,
		Nodes:         nodes,
		Relations:     relations,
		Regions:       regions,
	}
}

func layoutFromValidatedDocument(doc Document) ProjectMapLayoutDocument {
	nodes := make([]ProjectMapLayoutNode, 0, len(doc.Nodes))
	for _, node := range doc.Nodes {
		nodes = append(nodes, ProjectMapLayoutNode{
			ID:        node.ID,
			Position:  node.Position,
			Width:     node.Width,
			Height:    node.Height,
			Collapsed: node.Collapsed,
			CreatedAt: node.CreatedAt,
			UpdatedAt: node.UpdatedAt,
		})
	}
	slices.SortFunc(nodes, func(left, right ProjectMapLayoutNode) int {
		return strings.Compare(left.ID, right.ID)
	})

	relations := make([]ProjectMapLayoutRelation, 0, len(doc.Relations))
	for _, relation := range doc.Relations {
		waypoints := append([]Position(nil), relation.Waypoints...)
		if waypoints == nil {
			waypoints = []Position{}
		}
		relations = append(relations, ProjectMapLayoutRelation{
			ID:             relation.ID,
			MidpointT:      relation.MidpointT,
			MidpointOffset: clonePosition(relation.MidpointOffset),
			Waypoints:      waypoints,
			CreatedAt:      relation.CreatedAt,
			UpdatedAt:      relation.UpdatedAt,
		})
	}
	slices.SortFunc(relations, func(left, right ProjectMapLayoutRelation) int {
		return strings.Compare(left.ID, right.ID)
	})

	regions := make([]ProjectMapLayoutRegion, 0, len(doc.Regions))
	for _, region := range doc.Regions {
		regions = append(regions, ProjectMapLayoutRegion{
			ID:        region.ID,
			Position:  region.Position,
			Width:     region.Width,
			Height:    region.Height,
			CreatedAt: region.CreatedAt,
			UpdatedAt: region.UpdatedAt,
		})
	}
	slices.SortFunc(regions, func(left, right ProjectMapLayoutRegion) int {
		return strings.Compare(left.ID, right.ID)
	})

	return ProjectMapLayoutDocument{
		Format:        ProjectMapLayoutFormat,
		SchemaVersion: ProjectMapFormatSchemaVersion,
		MapID:         doc.ID,
		Theme:         doc.Theme,
		Nodes:         nodes,
		Relations:     relations,
		Regions:       regions,
		RuntimeMeta: ProjectMapRuntimeMeta{
			RuntimeSchemaVersion: doc.Meta.Version,
			Revision:             doc.Meta.Revision,
			LastEditedAt:         doc.Meta.LastEditedAt,
			LastOpenedAt:         doc.Meta.LastOpenedAt,
		},
	}
}

func canonicalizeProjectMapSemantic(doc ProjectMapSemanticDocument) (ProjectMapSemanticDocument, error) {
	if doc.Format != ProjectMapSemanticFormat {
		return ProjectMapSemanticDocument{}, fmt.Errorf("unsupported semantic format %q", doc.Format)
	}
	if doc.SchemaVersion != ProjectMapFormatSchemaVersion {
		return ProjectMapSemanticDocument{}, fmt.Errorf("unsupported semantic schemaVersion %d", doc.SchemaVersion)
	}
	if strings.TrimSpace(doc.MapID) == "" {
		return ProjectMapSemanticDocument{}, errors.New("semantic mapId is required")
	}
	if len(doc.Nodes) == 0 {
		return ProjectMapSemanticDocument{}, errors.New("semantic nodes must not be empty")
	}
	if err := ensureUniqueSemanticEntityIDs(doc); err != nil {
		return ProjectMapSemanticDocument{}, err
	}
	if err := validateProjectMapSemanticOrders(doc.Nodes); err != nil {
		return ProjectMapSemanticDocument{}, err
	}

	epoch := time.Unix(0, 0).UTC()
	candidate := Document{
		ID:        doc.MapID,
		Theme:     ThemeDark,
		Nodes:     make([]Node, 0, len(doc.Nodes)),
		Relations: make([]RelationEdge, 0, len(doc.Relations)),
		Regions:   make([]RegionBox, 0, len(doc.Regions)),
		Meta: Meta{
			Version:      ProjectMapDefaultRuntimeVersion,
			Revision:     1,
			LastEditedAt: epoch,
			LastOpenedAt: epoch,
		},
	}
	for _, node := range doc.Nodes {
		if node.Kind != NodeKindRoot && node.Kind != NodeKindTopic && node.Kind != NodeKindFloating {
			return ProjectMapSemanticDocument{}, fmt.Errorf("semantic node %s has invalid kind %q", node.ID, node.Kind)
		}
		candidate.Nodes = append(candidate.Nodes, Node{
			ID:        node.ID,
			ParentID:  node.ParentID,
			Kind:      node.Kind,
			Order:     node.Order,
			Title:     node.Title,
			Note:      node.Note,
			Priority:  node.Priority,
			Color:     node.Color,
			Bindings:  cloneNodeBindings(node.Bindings),
			Position:  Position{},
			CreatedAt: epoch,
			UpdatedAt: epoch,
		})
	}
	for _, relation := range doc.Relations {
		direction := relation.ArrowDirection
		if direction == "" {
			direction = ArrowDirectionNone
		}
		candidate.Relations = append(candidate.Relations, RelationEdge{
			ID:             relation.ID,
			SourceID:       relation.SourceID,
			TargetID:       relation.TargetID,
			Label:          relation.Label,
			ArrowDirection: direction,
			Branches:       cloneRelationBranches(relation.Branches),
			Waypoints:      []Position{},
			CreatedAt:      epoch,
			UpdatedAt:      epoch,
		})
	}
	for _, region := range doc.Regions {
		candidate.Regions = append(candidate.Regions, RegionBox{
			ID:        region.ID,
			Label:     region.Label,
			Color:     region.Color,
			Width:     1,
			Height:    1,
			CreatedAt: epoch,
			UpdatedAt: epoch,
		})
	}
	if err := candidate.Validate(); err != nil {
		return ProjectMapSemanticDocument{}, fmt.Errorf("invalid semantic document: %w", err)
	}
	return semanticFromValidatedDocument(candidate), nil
}

func validateProjectMapSemanticOrders(nodes []ProjectMapSemanticNode) error {
	ordersByParent := make(map[string]map[int]string)
	for _, node := range nodes {
		if node.ParentID == "" {
			if node.Order != 0 {
				return fmt.Errorf("semantic node %s without a parent must have order 0", node.ID)
			}
			continue
		}
		if node.Order <= 0 {
			return fmt.Errorf("semantic node %s must have a positive order", node.ID)
		}
		orders := ordersByParent[node.ParentID]
		if orders == nil {
			orders = make(map[int]string)
			ordersByParent[node.ParentID] = orders
		}
		if existingID, exists := orders[node.Order]; exists {
			return fmt.Errorf("semantic nodes %s and %s have duplicate order %d under parent %s", existingID, node.ID, node.Order, node.ParentID)
		}
		orders[node.Order] = node.ID
	}
	for parentID, orders := range ordersByParent {
		for expected := 1; expected <= len(orders); expected++ {
			if _, exists := orders[expected]; !exists {
				return fmt.Errorf("semantic children of parent %s must use continuous order values starting at 1", parentID)
			}
		}
	}
	return nil
}

func canonicalizeProjectMapLayout(doc ProjectMapLayoutDocument) (ProjectMapLayoutDocument, error) {
	if doc.Format != ProjectMapLayoutFormat {
		return ProjectMapLayoutDocument{}, fmt.Errorf("unsupported layout format %q", doc.Format)
	}
	if doc.SchemaVersion != ProjectMapFormatSchemaVersion {
		return ProjectMapLayoutDocument{}, fmt.Errorf("unsupported layout schemaVersion %d", doc.SchemaVersion)
	}
	if !isSafeIdentifier(doc.MapID) {
		return ProjectMapLayoutDocument{}, errors.New("layout mapId is required and must be a safe identifier")
	}
	if err := validateProjectMapTheme(doc.Theme); err != nil {
		return ProjectMapLayoutDocument{}, err
	}
	if doc.RuntimeMeta.RuntimeSchemaVersion <= 0 {
		return ProjectMapLayoutDocument{}, errors.New("layout runtimeSchemaVersion must be positive")
	}
	if doc.RuntimeMeta.Revision == 0 {
		return ProjectMapLayoutDocument{}, errors.New("layout revision must be positive")
	}

	result := doc
	result.Nodes = append([]ProjectMapLayoutNode(nil), doc.Nodes...)
	result.Relations = append([]ProjectMapLayoutRelation(nil), doc.Relations...)
	result.Regions = append([]ProjectMapLayoutRegion(nil), doc.Regions...)

	nodeIDs := make(map[string]struct{}, len(result.Nodes))
	for _, node := range result.Nodes {
		if !isSafeIdentifier(node.ID) {
			return ProjectMapLayoutDocument{}, fmt.Errorf("layout node id %q is invalid", node.ID)
		}
		if _, exists := nodeIDs[node.ID]; exists {
			return ProjectMapLayoutDocument{}, fmt.Errorf("duplicate layout node id %s", node.ID)
		}
		if node.Width < 0 || node.Height < 0 {
			return ProjectMapLayoutDocument{}, fmt.Errorf("layout node %s size cannot be negative", node.ID)
		}
		nodeIDs[node.ID] = struct{}{}
	}
	slices.SortFunc(result.Nodes, func(left, right ProjectMapLayoutNode) int {
		return strings.Compare(left.ID, right.ID)
	})

	relationIDs := make(map[string]struct{}, len(result.Relations))
	for index := range result.Relations {
		relation := &result.Relations[index]
		if !isSafeIdentifier(relation.ID) {
			return ProjectMapLayoutDocument{}, fmt.Errorf("layout relation id %q is invalid", relation.ID)
		}
		if _, exists := relationIDs[relation.ID]; exists {
			return ProjectMapLayoutDocument{}, fmt.Errorf("duplicate layout relation id %s", relation.ID)
		}
		relationIDs[relation.ID] = struct{}{}
		relation.MidpointOffset = clonePosition(relation.MidpointOffset)
		relation.Waypoints = append([]Position(nil), relation.Waypoints...)
		if relation.Waypoints == nil {
			relation.Waypoints = []Position{}
		}
	}
	slices.SortFunc(result.Relations, func(left, right ProjectMapLayoutRelation) int {
		return strings.Compare(left.ID, right.ID)
	})

	regionIDs := make(map[string]struct{}, len(result.Regions))
	for _, region := range result.Regions {
		if !isSafeIdentifier(region.ID) {
			return ProjectMapLayoutDocument{}, fmt.Errorf("layout region id %q is invalid", region.ID)
		}
		if _, exists := regionIDs[region.ID]; exists {
			return ProjectMapLayoutDocument{}, fmt.Errorf("duplicate layout region id %s", region.ID)
		}
		if region.Width <= 0 || region.Height <= 0 {
			return ProjectMapLayoutDocument{}, fmt.Errorf("layout region %s must have positive width and height", region.ID)
		}
		regionIDs[region.ID] = struct{}{}
	}
	slices.SortFunc(result.Regions, func(left, right ProjectMapLayoutRegion) int {
		return strings.Compare(left.ID, right.ID)
	})

	if result.Nodes == nil {
		result.Nodes = []ProjectMapLayoutNode{}
	}
	if result.Relations == nil {
		result.Relations = []ProjectMapLayoutRelation{}
	}
	if result.Regions == nil {
		result.Regions = []ProjectMapLayoutRegion{}
	}
	return result, nil
}

func ensureUniqueSemanticEntityIDs(doc ProjectMapSemanticDocument) error {
	nodeIDs := make(map[string]struct{}, len(doc.Nodes))
	for _, node := range doc.Nodes {
		if _, exists := nodeIDs[node.ID]; exists {
			return fmt.Errorf("duplicate semantic node id %s", node.ID)
		}
		nodeIDs[node.ID] = struct{}{}
	}
	relationIDs := make(map[string]struct{}, len(doc.Relations))
	for _, relation := range doc.Relations {
		if _, exists := relationIDs[relation.ID]; exists {
			return fmt.Errorf("duplicate semantic relation id %s", relation.ID)
		}
		relationIDs[relation.ID] = struct{}{}
	}
	regionIDs := make(map[string]struct{}, len(doc.Regions))
	for _, region := range doc.Regions {
		if _, exists := regionIDs[region.ID]; exists {
			return fmt.Errorf("duplicate semantic region id %s", region.ID)
		}
		regionIDs[region.ID] = struct{}{}
	}
	return nil
}

func validateStrictProjectMapIDs(semantic ProjectMapSemanticDocument, layout ProjectMapLayoutDocument) error {
	semanticNodeIDs := make(map[string]struct{}, len(semantic.Nodes))
	for _, node := range semantic.Nodes {
		semanticNodeIDs[node.ID] = struct{}{}
	}
	layoutNodeIDs := make(map[string]struct{}, len(layout.Nodes))
	for _, node := range layout.Nodes {
		layoutNodeIDs[node.ID] = struct{}{}
	}
	if err := compareProjectMapIDSets("node", semanticNodeIDs, layoutNodeIDs); err != nil {
		return err
	}

	semanticRelationIDs := make(map[string]struct{}, len(semantic.Relations))
	for _, relation := range semantic.Relations {
		semanticRelationIDs[relation.ID] = struct{}{}
	}
	layoutRelationIDs := make(map[string]struct{}, len(layout.Relations))
	for _, relation := range layout.Relations {
		layoutRelationIDs[relation.ID] = struct{}{}
	}
	if err := compareProjectMapIDSets("relation", semanticRelationIDs, layoutRelationIDs); err != nil {
		return err
	}

	semanticRegionIDs := make(map[string]struct{}, len(semantic.Regions))
	for _, region := range semantic.Regions {
		semanticRegionIDs[region.ID] = struct{}{}
	}
	layoutRegionIDs := make(map[string]struct{}, len(layout.Regions))
	for _, region := range layout.Regions {
		layoutRegionIDs[region.ID] = struct{}{}
	}
	return compareProjectMapIDSets("region", semanticRegionIDs, layoutRegionIDs)
}

func compareProjectMapIDSets(kind string, semanticIDs map[string]struct{}, layoutIDs map[string]struct{}) error {
	if len(semanticIDs) != len(layoutIDs) {
		return fmt.Errorf("strict project map merge requires matching %s id sets", kind)
	}
	for id := range semanticIDs {
		if _, exists := layoutIDs[id]; !exists {
			return fmt.Errorf("strict project map merge is missing layout for %s %s", kind, id)
		}
	}
	return nil
}

func defaultProjectMapPositions(nodes []ProjectMapSemanticNode) map[string]Position {
	positions := make(map[string]Position, len(nodes))
	childrenByParent := make(map[string][]ProjectMapSemanticNode)
	parentless := make([]ProjectMapSemanticNode, 0)
	rootID := ""
	for _, node := range nodes {
		if node.Kind == NodeKindRoot {
			rootID = node.ID
			continue
		}
		if node.ParentID == "" {
			parentless = append(parentless, node)
			continue
		}
		childrenByParent[node.ParentID] = append(childrenByParent[node.ParentID], node)
	}
	for parentID := range childrenByParent {
		slices.SortFunc(childrenByParent[parentID], func(left, right ProjectMapSemanticNode) int {
			if left.Order != right.Order {
				return left.Order - right.Order
			}
			return strings.Compare(left.ID, right.ID)
		})
	}
	slices.SortFunc(parentless, func(left, right ProjectMapSemanticNode) int {
		return strings.Compare(left.ID, right.ID)
	})

	positions[rootID] = Position{X: 820, Y: 320}
	row := 0
	var placeChildren func(string)
	placeChildren = func(parentID string) {
		parentPosition := positions[parentID]
		for _, child := range childrenByParent[parentID] {
			row++
			positions[child.ID] = Position{X: parentPosition.X + 280, Y: 120 + float64(row*96)}
			placeChildren(child.ID)
		}
	}
	placeChildren(rootID)

	for index, node := range parentless {
		positions[node.ID] = Position{X: 500, Y: 520 + float64(index*120)}
		placeChildren(node.ID)
	}
	return positions
}

func cloneRuntimeDocument(doc Document) (Document, error) {
	payload, err := json.Marshal(doc)
	if err != nil {
		return Document{}, err
	}
	var cloned Document
	if err := json.Unmarshal(payload, &cloned); err != nil {
		return Document{}, err
	}
	return cloned, nil
}

func cloneNodeBindings(bindings []NodeBinding) []NodeBinding {
	return append([]NodeBinding(nil), bindings...)
}

func cloneRelationBranches(branches []RelationBranch) []RelationBranch {
	return append([]RelationBranch(nil), branches...)
}

func clonePosition(position *Position) *Position {
	if position == nil {
		return nil
	}
	cloned := *position
	return &cloned
}

func validateProjectMapTheme(theme Theme) error {
	if theme != ThemeLight && theme != ThemeDark {
		return fmt.Errorf("invalid project map theme %q", theme)
	}
	return nil
}

func marshalProjectMapJSON(value any) ([]byte, error) {
	var output bytes.Buffer
	encoder := json.NewEncoder(&output)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(value); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}

func decodeProjectMapJSON(payload []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("project map JSON contains multiple values")
		}
		return err
	}
	return nil
}
