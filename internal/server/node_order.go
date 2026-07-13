package server

import (
	"errors"
	"fmt"
	"slices"
	"strings"

	"code-mind/internal/mindmap"
)

func insertNodeWithOrder(nodes []mindmap.Node, node mindmap.Node, requestedOrder *int) ([]mindmap.Node, error) {
	if node.ParentID == "" {
		if requestedOrder != nil && *requestedOrder != 0 {
			return nil, errors.New("a node without a parent must use order 0")
		}
		node.Order = 0
		return append(nodes, node), nil
	}

	siblingCount := 0
	for _, sibling := range nodes {
		if sibling.ParentID == node.ParentID {
			siblingCount++
		}
	}
	targetOrder := siblingCount + 1
	if requestedOrder != nil {
		targetOrder = *requestedOrder
	}
	if targetOrder < 1 || targetOrder > siblingCount+1 {
		return nil, fmt.Errorf("order must be between 1 and %d", siblingCount+1)
	}

	for index := range nodes {
		if nodes[index].ParentID == node.ParentID && nodes[index].Order >= targetOrder {
			nodes[index].Order++
		}
	}
	node.Order = targetOrder
	return append(nodes, node), nil
}

func moveNodeWithOrder(nodes []mindmap.Node, nodeIndex int, targetParentID string, requestedOrder *int) error {
	node := nodes[nodeIndex]
	if node.Kind == mindmap.NodeKindRoot {
		return errors.New("root node cannot be moved or reordered")
	}
	if targetParentID == node.ParentID && requestedOrder == nil {
		return nil
	}
	if targetParentID == "" && node.Kind != mindmap.NodeKindFloating {
		return errors.New("only floating nodes may omit parentId")
	}
	if targetParentID != "" {
		parentIndex := -1
		for index := range nodes {
			if nodes[index].ID == targetParentID {
				parentIndex = index
				break
			}
		}
		if parentIndex == -1 {
			return fmt.Errorf("parent node %q not found", targetParentID)
		}
		if targetParentID == node.ID || parentChainContains(nodes, targetParentID, node.ID) {
			return errors.New("node cannot be moved under itself or one of its descendants")
		}
	}

	oldParentID := node.ParentID
	oldOrder := node.Order
	for index := range nodes {
		if index != nodeIndex && nodes[index].ParentID == oldParentID && nodes[index].Order > oldOrder {
			nodes[index].Order--
		}
	}

	nodes[nodeIndex].ParentID = targetParentID
	nodes[nodeIndex].Order = 0
	if targetParentID == "" {
		if requestedOrder != nil && *requestedOrder != 0 {
			return errors.New("a node without a parent must use order 0")
		}
		return nil
	}

	siblingCount := 0
	for index := range nodes {
		if index != nodeIndex && nodes[index].ParentID == targetParentID {
			siblingCount++
		}
	}
	targetOrder := siblingCount + 1
	if requestedOrder != nil {
		targetOrder = *requestedOrder
	}
	if targetOrder < 1 || targetOrder > siblingCount+1 {
		return fmt.Errorf("order must be between 1 and %d", siblingCount+1)
	}
	for index := range nodes {
		if index != nodeIndex && nodes[index].ParentID == targetParentID && nodes[index].Order >= targetOrder {
			nodes[index].Order++
		}
	}
	nodes[nodeIndex].Order = targetOrder
	return nil
}

func parentChainContains(nodes []mindmap.Node, startID string, targetID string) bool {
	parentByID := make(map[string]string, len(nodes))
	for _, node := range nodes {
		parentByID[node.ID] = node.ParentID
	}
	visited := make(map[string]struct{})
	currentID := startID
	for currentID != "" {
		if currentID == targetID {
			return true
		}
		if _, exists := visited[currentID]; exists {
			return true
		}
		visited[currentID] = struct{}{}
		currentID = parentByID[currentID]
	}
	return false
}

func deleteNodeWithOrder(nodes []mindmap.Node, nodeID string, cascade bool) (int, []mindmap.Node, error) {
	var target mindmap.Node
	found := false
	for _, node := range nodes {
		if node.ID == nodeID {
			target = node
			found = true
			break
		}
	}
	if !found {
		return 0, nil, fmt.Errorf("node %q not found", nodeID)
	}
	if target.Kind == mindmap.NodeKindRoot {
		return 0, nil, errors.New("cannot delete root node")
	}

	if cascade {
		toDelete := collectDescendantsFromSlice(nodes, nodeID)
		toDelete[nodeID] = true
		remaining := make([]mindmap.Node, 0, len(nodes)-len(toDelete))
		for _, node := range nodes {
			if !toDelete[node.ID] {
				remaining = append(remaining, node)
			}
		}
		reindexSiblingGroup(remaining, target.ParentID)
		return len(toDelete), remaining, nil
	}

	directChildren := orderedChildrenFromSlice(nodes, nodeID)
	if target.ParentID == "" {
		remaining := make([]mindmap.Node, 0, len(nodes)-1)
		for _, node := range nodes {
			if node.ID == target.ID {
				continue
			}
			if node.ParentID == target.ID {
				node.ParentID = ""
				node.Kind = mindmap.NodeKindFloating
				node.Order = 0
			}
			remaining = append(remaining, node)
		}
		return 1, remaining, nil
	}
	parentChildren := orderedChildrenFromSlice(nodes, target.ParentID)
	sequence := make([]string, 0, len(parentChildren)-1+len(directChildren))
	for _, sibling := range parentChildren {
		if sibling.ID == target.ID {
			for _, child := range directChildren {
				sequence = append(sequence, child.ID)
			}
			continue
		}
		sequence = append(sequence, sibling.ID)
	}

	remaining := make([]mindmap.Node, 0, len(nodes)-1)
	for _, node := range nodes {
		if node.ID == target.ID {
			continue
		}
		if node.ParentID == target.ID {
			node.ParentID = target.ParentID
		}
		remaining = append(remaining, node)
	}
	orderByID := make(map[string]int, len(sequence))
	for index, id := range sequence {
		orderByID[id] = index + 1
	}
	for index := range remaining {
		if order, exists := orderByID[remaining[index].ID]; exists {
			remaining[index].Order = order
		}
	}
	return 1, remaining, nil
}

func orderedChildrenFromSlice(nodes []mindmap.Node, parentID string) []mindmap.Node {
	children := make([]mindmap.Node, 0)
	for _, node := range nodes {
		if node.ParentID == parentID {
			children = append(children, node)
		}
	}
	slices.SortFunc(children, func(left, right mindmap.Node) int {
		if left.Order != right.Order {
			return left.Order - right.Order
		}
		switch {
		case left.Position.Y < right.Position.Y:
			return -1
		case left.Position.Y > right.Position.Y:
			return 1
		case left.Position.X < right.Position.X:
			return -1
		case left.Position.X > right.Position.X:
			return 1
		default:
			return strings.Compare(left.ID, right.ID)
		}
	})
	return children
}

func reindexSiblingGroup(nodes []mindmap.Node, parentID string) {
	children := orderedChildrenFromSlice(nodes, parentID)
	orderByID := make(map[string]int, len(children))
	for index, child := range children {
		orderByID[child.ID] = index + 1
	}
	for index := range nodes {
		if order, exists := orderByID[nodes[index].ID]; exists {
			nodes[index].Order = order
		}
	}
}
