package mindmap

import (
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync/atomic"
	"time"
)

var idCounter atomic.Uint64

type Theme string

const (
	ThemeLight Theme = "light"
	ThemeDark  Theme = "dark"
)

type NodeKind string

const (
	NodeKindRoot     NodeKind = "root"
	NodeKindTopic    NodeKind = "topic"
	NodeKindFloating NodeKind = "floating"
)

type Priority string

const (
	PriorityNone Priority = ""
	Priority0    Priority = "P0"
	Priority1    Priority = "P1"
	Priority2    Priority = "P2"
	Priority3    Priority = "P3"
)

type NodeColor string

type BindingType string

const (
	BindingTypeFile      BindingType = "file"
	BindingTypeDirectory BindingType = "directory"
	BindingTypeGlob      BindingType = "glob"
	BindingTypeSymbol    BindingType = "symbol"
	BindingTypeAsset     BindingType = "asset"
)

type ArrowDirection string

const (
	ArrowDirectionNone     ArrowDirection = "none"
	ArrowDirectionForward  ArrowDirection = "forward"
	ArrowDirectionBackward ArrowDirection = "backward"
	ArrowDirectionBoth     ArrowDirection = "both"
)

type Position struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type NodeBinding struct {
	ID          string      `json:"id"`
	Type        BindingType `json:"type"`
	Path        string      `json:"path"`
	Symbol      string      `json:"symbol,omitempty"`
	Glob        string      `json:"glob,omitempty"`
	ContentHash string      `json:"contentHash,omitempty"`
}

type Node struct {
	ID        string        `json:"id"`
	ParentID  string        `json:"parentId,omitempty"`
	Kind      NodeKind      `json:"kind"`
	Order     int           `json:"order,omitempty"`
	Title     string        `json:"title"`
	Note      string        `json:"note,omitempty"`
	Priority  Priority      `json:"priority,omitempty"`
	Color     NodeColor     `json:"color,omitempty"`
	Bindings  []NodeBinding `json:"bindings,omitempty"`
	Collapsed bool          `json:"collapsed,omitempty"`
	Width     float64       `json:"width,omitempty"`
	Height    float64       `json:"height,omitempty"`
	Position  Position      `json:"position"`
	CreatedAt time.Time     `json:"createdAt"`
	UpdatedAt time.Time     `json:"updatedAt"`
}

type RelationEdge struct {
	ID             string           `json:"id"`
	SourceID       string           `json:"sourceId"`
	TargetID       string           `json:"targetId"`
	Label          string           `json:"label,omitempty"`
	ArrowDirection ArrowDirection   `json:"arrowDirection,omitempty"`
	Branches       []RelationBranch `json:"branches,omitempty"`
	MidpointT      float64          `json:"midpointT,omitempty"`
	MidpointOffset *Position        `json:"midpointOffset,omitempty"`
	Waypoints      []Position       `json:"waypoints,omitempty"`
	CreatedAt      time.Time        `json:"createdAt"`
	UpdatedAt      time.Time        `json:"updatedAt"`
}

type RelationBranch struct {
	TargetID string `json:"targetId"`
}

type RegionBox struct {
	ID        string    `json:"id"`
	Label     string    `json:"label"`
	Color     NodeColor `json:"color,omitempty"`
	Position  Position  `json:"position"`
	Width     float64   `json:"width"`
	Height    float64   `json:"height"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Meta struct {
	Version      int       `json:"version"`
	Revision     uint64    `json:"revision"`
	LastEditedAt time.Time `json:"lastEditedAt"`
	LastOpenedAt time.Time `json:"lastOpenedAt"`
}

type Document struct {
	ID        string         `json:"id"`
	Title     string         `json:"title"`
	Theme     Theme          `json:"theme"`
	Nodes     []Node         `json:"nodes"`
	Relations []RelationEdge `json:"relations"`
	Regions   []RegionBox    `json:"regions"`
	Meta      Meta           `json:"meta"`
}

func NewID(prefix string) string {
	return fmt.Sprintf("%s-%d", prefix, time.Now().UnixNano()+int64(idCounter.Add(1)))
}

func NewDefaultDocument() Document {
	now := time.Now().UTC()
	root := Node{
		ID:        "root",
		Kind:      NodeKindRoot,
		Title:     "New Mind Map",
		Position:  Position{X: 820, Y: 320},
		CreatedAt: now,
		UpdatedAt: now,
	}

	return Document{
		ID:        "default",
		Title:     root.Title,
		Theme:     ThemeDark,
		Nodes:     []Node{root},
		Relations: []RelationEdge{},
		Regions:   []RegionBox{},
		Meta: Meta{
			Version:      1,
			Revision:     1,
			LastEditedAt: now,
			LastOpenedAt: now,
		},
	}
}

func (d *Document) Validate() error {
	if err := d.NormalizeSemantics(); err != nil {
		return err
	}
	if strings.TrimSpace(d.ID) == "" {
		return errors.New("document id is required")
	}
	if !isSafeIdentifier(d.ID) {
		return fmt.Errorf("document id contains unsafe characters: %s", d.ID)
	}
	if len(d.Nodes) == 0 {
		return errors.New("document must contain at least one node")
	}

	rootCount := 0
	nodeByID := make(map[string]Node, len(d.Nodes))
	bindingOwnerByID := make(map[string]string)
	ordersByParent := make(map[string]map[int]string)
	for _, node := range d.Nodes {
		if strings.TrimSpace(node.ID) == "" {
			return errors.New("node id is required")
		}
		if !isSafeIdentifier(node.ID) {
			return fmt.Errorf("node %s id contains unsafe characters", node.ID)
		}
		if strings.TrimSpace(node.Title) == "" {
			return fmt.Errorf("node %s title is required", node.ID)
		}
		if node.Width < 0 || node.Height < 0 {
			return fmt.Errorf("node %s size cannot be negative", node.ID)
		}
		if _, exists := nodeByID[node.ID]; exists {
			return fmt.Errorf("duplicate node id: %s", node.ID)
		}
		if node.Kind == NodeKindRoot {
			rootCount++
		}
		if node.ParentID == "" {
			if node.Order != 0 {
				return fmt.Errorf("node %s without a parent must have order 0", node.ID)
			}
		} else {
			if node.Order <= 0 {
				return fmt.Errorf("node %s must have a positive order", node.ID)
			}
			orders := ordersByParent[node.ParentID]
			if orders == nil {
				orders = make(map[int]string)
				ordersByParent[node.ParentID] = orders
			}
			if existingID, exists := orders[node.Order]; exists {
				return fmt.Errorf("nodes %s and %s have duplicate order %d under parent %s", existingID, node.ID, node.Order, node.ParentID)
			}
			orders[node.Order] = node.ID
		}
		for _, binding := range node.Bindings {
			if err := validateNodeBinding(binding); err != nil {
				return fmt.Errorf("node %s binding %s: %w", node.ID, binding.ID, err)
			}
			if ownerID, exists := bindingOwnerByID[binding.ID]; exists {
				return fmt.Errorf("duplicate binding id %s on nodes %s and %s", binding.ID, ownerID, node.ID)
			}
			bindingOwnerByID[binding.ID] = node.ID
		}
		nodeByID[node.ID] = node
	}

	if rootCount != 1 {
		return errors.New("document must contain exactly one root node")
	}
	for parentID, orders := range ordersByParent {
		for expected := 1; expected <= len(orders); expected++ {
			if _, exists := orders[expected]; !exists {
				return fmt.Errorf("children of parent %s must use continuous order values starting at 1", parentID)
			}
		}
	}

	for _, node := range d.Nodes {
		if node.Kind == NodeKindRoot {
			if node.ParentID != "" {
				return errors.New("root node cannot have a parent")
			}
			continue
		}

		if node.ParentID != "" {
			if _, exists := nodeByID[node.ParentID]; !exists {
				return fmt.Errorf("node %s has unknown parent %s", node.ID, node.ParentID)
			}
		}
	}

	if err := detectParentCycles(d.Nodes); err != nil {
		return err
	}

	for _, edge := range d.Relations {
		if strings.TrimSpace(edge.ID) == "" {
			return errors.New("relation id is required")
		}
		if !isSafeIdentifier(edge.ID) {
			return fmt.Errorf("relation %s id contains unsafe characters", edge.ID)
		}
		if edge.SourceID == edge.TargetID {
			return fmt.Errorf("relation %s cannot connect node to itself", edge.ID)
		}
		if _, exists := nodeByID[edge.SourceID]; !exists {
			return fmt.Errorf("relation %s has unknown source %s", edge.ID, edge.SourceID)
		}
		if _, exists := nodeByID[edge.TargetID]; !exists {
			return fmt.Errorf("relation %s has unknown target %s", edge.ID, edge.TargetID)
		}
		if !isValidArrowDirection(edge.ArrowDirection) {
			return fmt.Errorf("relation %s has invalid arrow direction %s", edge.ID, edge.ArrowDirection)
		}

		branchTargets := make(map[string]struct{}, len(edge.Branches))
		for _, branch := range edge.Branches {
			if strings.TrimSpace(branch.TargetID) == "" {
				return fmt.Errorf("relation %s has empty branch target", edge.ID)
			}
			if branch.TargetID == edge.SourceID {
				return fmt.Errorf("relation %s cannot branch back to source %s", edge.ID, edge.SourceID)
			}
			if branch.TargetID == edge.TargetID {
				return fmt.Errorf("relation %s has duplicate branch target %s", edge.ID, edge.TargetID)
			}
			if _, exists := nodeByID[branch.TargetID]; !exists {
				return fmt.Errorf("relation %s has unknown branch target %s", edge.ID, branch.TargetID)
			}
			if _, exists := branchTargets[branch.TargetID]; exists {
				return fmt.Errorf("relation %s has duplicate branch target %s", edge.ID, branch.TargetID)
			}
			branchTargets[branch.TargetID] = struct{}{}
		}
	}

	for _, region := range d.Regions {
		if strings.TrimSpace(region.ID) == "" {
			return errors.New("region id is required")
		}
		if !isSafeIdentifier(region.ID) {
			return fmt.Errorf("region %s id contains unsafe characters", region.ID)
		}
		if region.Width <= 0 || region.Height <= 0 {
			return fmt.Errorf("region %s must have positive width and height", region.ID)
		}
	}

	return nil
}

func (d *Document) PrepareForSave(now time.Time) {
	d.NormalizeMetadata()
	if d.Relations == nil {
		d.Relations = []RelationEdge{}
	}
	if d.Regions == nil {
		d.Regions = []RegionBox{}
	}
	for i := range d.Relations {
		if d.Relations[i].Branches == nil {
			d.Relations[i].Branches = []RelationBranch{}
		}
		if d.Relations[i].Waypoints == nil {
			d.Relations[i].Waypoints = []Position{}
		}
	}

	root := d.Root()
	if strings.TrimSpace(root.Title) != "" {
		d.Title = root.Title
	}
	d.Meta.LastEditedAt = now
	if d.Meta.LastOpenedAt.IsZero() {
		d.Meta.LastOpenedAt = now
	}
}

// NormalizeSemantics upgrades legacy node ordering and canonicalizes code
// binding paths without allowing invalid repository traversal.
func (d *Document) NormalizeSemantics() error {
	for nodeIndex := range d.Nodes {
		node := &d.Nodes[nodeIndex]
		for bindingIndex := range node.Bindings {
			binding := &node.Bindings[bindingIndex]
			binding.ID = strings.TrimSpace(binding.ID)
			binding.Type = BindingType(strings.ToLower(strings.TrimSpace(string(binding.Type))))
			binding.Symbol = strings.TrimSpace(binding.Symbol)
			binding.ContentHash = strings.TrimSpace(binding.ContentHash)

			normalizedPath, err := normalizeRepositoryPath(binding.Path)
			if err != nil {
				return fmt.Errorf("node %s binding %s: %w", node.ID, binding.ID, err)
			}
			binding.Path = normalizedPath

			if strings.TrimSpace(binding.Glob) != "" {
				normalizedGlob, err := normalizeRepositoryPath(binding.Glob)
				if err != nil {
					return fmt.Errorf("node %s binding %s glob: %w", node.ID, binding.ID, err)
				}
				binding.Glob = normalizedGlob
			}
		}
	}

	groups := make(map[string][]int)
	for index := range d.Nodes {
		node := &d.Nodes[index]
		if node.ParentID == "" {
			if node.Order != 0 {
				return fmt.Errorf("node %s without a parent must have order 0", node.ID)
			}
			continue
		}
		if node.Order < 0 {
			return fmt.Errorf("node %s cannot have a negative order", node.ID)
		}
		groups[node.ParentID] = append(groups[node.ParentID], index)
	}

	for parentID, indexes := range groups {
		if err := d.normalizeSiblingGroup(parentID, indexes); err != nil {
			return err
		}
	}

	return nil
}

func (d *Document) normalizeSiblingGroup(parentID string, indexes []int) error {
	used := make(map[int]string, len(indexes))
	missing := make([]int, 0, len(indexes))
	for _, index := range indexes {
		node := d.Nodes[index]
		if node.Order == 0 {
			missing = append(missing, index)
			continue
		}
		if existingID, exists := used[node.Order]; exists {
			return fmt.Errorf("nodes %s and %s have duplicate order %d under parent %s", existingID, node.ID, node.Order, parentID)
		}
		used[node.Order] = node.ID
	}

	if len(missing) == 0 {
		slices.SortFunc(indexes, func(left, right int) int {
			leftNode := d.Nodes[left]
			rightNode := d.Nodes[right]
			switch {
			case leftNode.Order < rightNode.Order:
				return -1
			case leftNode.Order > rightNode.Order:
				return 1
			default:
				return strings.Compare(leftNode.ID, rightNode.ID)
			}
		})
		for order, index := range indexes {
			d.Nodes[index].Order = order + 1
		}
		return nil
	}

	for order := range used {
		if order > len(indexes) {
			return fmt.Errorf("node order %d under parent %s exceeds sibling count %d", order, parentID, len(indexes))
		}
	}

	slices.SortFunc(missing, func(left, right int) int {
		return compareNodesByPosition(d.Nodes[left], d.Nodes[right])
	})
	missingIndex := 0
	for order := 1; order <= len(indexes); order++ {
		if _, exists := used[order]; exists {
			continue
		}
		d.Nodes[missing[missingIndex]].Order = order
		missingIndex++
	}
	return nil
}

func normalizeRepositoryPath(value string) (string, error) {
	normalized := strings.ReplaceAll(strings.TrimSpace(value), `\`, "/")
	if normalized == "" {
		return "", errors.New("path is required")
	}
	if strings.HasPrefix(normalized, "/") || strings.HasPrefix(normalized, "//") {
		return "", errors.New("path must be repository-relative")
	}
	if len(normalized) >= 2 && normalized[1] == ':' && ((normalized[0] >= 'a' && normalized[0] <= 'z') || (normalized[0] >= 'A' && normalized[0] <= 'Z')) {
		return "", errors.New("path must not use a Windows drive prefix")
	}

	segments := strings.Split(normalized, "/")
	canonical := make([]string, 0, len(segments))
	for _, segment := range segments {
		switch segment {
		case "", ".":
			continue
		case "..":
			return "", errors.New("path must not contain '..' segments")
		}
		for _, char := range segment {
			if char == 0 || char < 0x20 || char == 0x7f {
				return "", errors.New("path contains control characters")
			}
		}
		canonical = append(canonical, segment)
	}
	if len(canonical) == 0 {
		return ".", nil
	}
	return strings.Join(canonical, "/"), nil
}

func validateNodeBinding(binding NodeBinding) error {
	if !isSafeIdentifier(binding.ID) {
		return errors.New("id is required and must be a safe identifier")
	}
	switch binding.Type {
	case BindingTypeFile, BindingTypeDirectory, BindingTypeGlob, BindingTypeSymbol, BindingTypeAsset:
	default:
		return fmt.Errorf("invalid type %q", binding.Type)
	}
	if _, err := normalizeRepositoryPath(binding.Path); err != nil {
		return err
	}

	switch binding.Type {
	case BindingTypeSymbol:
		if binding.Symbol == "" {
			return errors.New("symbol binding requires symbol")
		}
		if binding.Glob != "" {
			return errors.New("symbol binding must not define glob")
		}
	case BindingTypeGlob:
		if binding.Glob == "" {
			return errors.New("glob binding requires glob")
		}
		if _, err := normalizeRepositoryPath(binding.Glob); err != nil {
			return fmt.Errorf("invalid glob: %w", err)
		}
		if binding.Symbol != "" {
			return errors.New("glob binding must not define symbol")
		}
	default:
		if binding.Symbol != "" {
			return fmt.Errorf("%s binding must not define symbol", binding.Type)
		}
		if binding.Glob != "" {
			return fmt.Errorf("%s binding must not define glob", binding.Type)
		}
	}
	return nil
}

// NormalizeMetadata upgrades legacy documents that predate explicit schema
// and persistence revisions without treating a read as a document write.
func (d *Document) NormalizeMetadata() {
	if d.Meta.Version <= 0 {
		d.Meta.Version = 1
	}
	if d.Meta.Revision == 0 {
		d.Meta.Revision = 1
	}
}

// detectParentCycles verifies the parentId graph is acyclic. Node parents were
// already checked to exist, so any walk that revisits a node is a cycle.
func detectParentCycles(nodes []Node) error {
	parentOf := make(map[string]string, len(nodes))
	for _, node := range nodes {
		parentOf[node.ID] = node.ParentID
	}

	const (
		unvisited = 0
		visiting  = 1
		done      = 2
	)
	state := make(map[string]int, len(nodes))
	for _, node := range nodes {
		if state[node.ID] != unvisited {
			continue
		}
		path := make([]string, 0, 8)
		current := node.ID
		for current != "" && state[current] == unvisited {
			state[current] = visiting
			path = append(path, current)
			current = parentOf[current]
		}
		if current != "" && state[current] == visiting {
			return fmt.Errorf("node %s is part of a parent cycle", current)
		}
		for _, id := range path {
			state[id] = done
		}
	}
	return nil
}

func isSafeIdentifier(value string) bool {
	if strings.TrimSpace(value) != value || value == "" {
		return false
	}
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= 'A' && r <= 'Z':
		case r >= '0' && r <= '9':
		case r == '-' || r == '_' || r == '.' || r == ':':
		default:
			return false
		}
	}
	return true
}

func (d *Document) TouchOpened(now time.Time) {
	if d.Relations == nil {
		d.Relations = []RelationEdge{}
	}
	if d.Regions == nil {
		d.Regions = []RegionBox{}
	}
	for i := range d.Relations {
		if d.Relations[i].Branches == nil {
			d.Relations[i].Branches = []RelationBranch{}
		}
		if d.Relations[i].Waypoints == nil {
			d.Relations[i].Waypoints = []Position{}
		}
	}

	root := d.Root()
	if strings.TrimSpace(root.Title) != "" {
		d.Title = root.Title
	}
	d.Meta.Version = 1
	if d.Meta.LastEditedAt.IsZero() {
		d.Meta.LastEditedAt = now
	}
	d.Meta.LastOpenedAt = now
}

func (d Document) Root() Node {
	for _, node := range d.Nodes {
		if node.Kind == NodeKindRoot {
			return node
		}
	}
	return Node{}
}

func (d Document) NodeMap() map[string]Node {
	result := make(map[string]Node, len(d.Nodes))
	for _, node := range d.Nodes {
		result[node.ID] = node
	}
	return result
}

func (d Document) ChildrenOf(parentID string) []Node {
	children := make([]Node, 0)
	for _, node := range d.Nodes {
		if node.ParentID == parentID {
			children = append(children, node)
		}
	}

	slices.SortFunc(children, func(a, b Node) int {
		if a.Order > 0 && b.Order > 0 && a.Order != b.Order {
			return a.Order - b.Order
		}
		return compareNodesByPosition(a, b)
	})

	return children
}

func compareNodesByPosition(a, b Node) int {
	switch {
	case a.Position.Y < b.Position.Y:
		return -1
	case a.Position.Y > b.Position.Y:
		return 1
	case a.Position.X < b.Position.X:
		return -1
	case a.Position.X > b.Position.X:
		return 1
	default:
		return strings.Compare(a.ID, b.ID)
	}
}

func isValidArrowDirection(direction ArrowDirection) bool {
	switch direction {
	case "", ArrowDirectionNone, ArrowDirectionForward, ArrowDirectionBackward, ArrowDirectionBoth:
		return true
	default:
		return false
	}
}
