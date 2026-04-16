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

type Node struct {
	ID        string    `json:"id"`
	ParentID  string    `json:"parentId,omitempty"`
	Kind      NodeKind  `json:"kind"`
	Title     string    `json:"title"`
	Note      string    `json:"note,omitempty"`
	Priority  Priority  `json:"priority,omitempty"`
	Color     NodeColor `json:"color,omitempty"`
	Collapsed bool      `json:"collapsed,omitempty"`
	Width     float64   `json:"width,omitempty"`
	Height    float64   `json:"height,omitempty"`
	Position  Position  `json:"position"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
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
			LastEditedAt: now,
			LastOpenedAt: now,
		},
	}
}

func (d *Document) Validate() error {
	if strings.TrimSpace(d.ID) == "" {
		return errors.New("document id is required")
	}
	if len(d.Nodes) == 0 {
		return errors.New("document must contain at least one node")
	}

	rootCount := 0
	nodeByID := make(map[string]Node, len(d.Nodes))
	for _, node := range d.Nodes {
		if strings.TrimSpace(node.ID) == "" {
			return errors.New("node id is required")
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
		nodeByID[node.ID] = node
	}

	if rootCount != 1 {
		return errors.New("document must contain exactly one root node")
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

	for _, edge := range d.Relations {
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
		if region.Width <= 0 || region.Height <= 0 {
			return fmt.Errorf("region %s must have positive width and height", region.ID)
		}
	}

	return nil
}

func (d *Document) PrepareForSave(now time.Time) {
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
	d.Meta.LastEditedAt = now
	if d.Meta.LastOpenedAt.IsZero() {
		d.Meta.LastOpenedAt = now
	}
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
	})

	return children
}

func isValidArrowDirection(direction ArrowDirection) bool {
	switch direction {
	case "", ArrowDirectionNone, ArrowDirectionForward, ArrowDirectionBackward, ArrowDirectionBoth:
		return true
	default:
		return false
	}
}
