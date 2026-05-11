package server

import "code-mind/internal/mindmap"

// childGapY is the vertical gap between sibling nodes when auto-calculating position.
// The requirements specify 96px (distinct from the existing defaultBranchGapY = 100).
const childGapY = 96

// calculateChildPosition computes the position for a new child node based on
// the parent node and its existing siblings.
//
// Rules:
//   - X is always parent.X + 280px (defaultBranchGapX)
//   - If no siblings exist, Y equals the parent's Y
//   - If siblings exist, Y equals the maximum sibling Y + 96px
func calculateChildPosition(parent mindmap.Node, siblings []mindmap.Node) mindmap.Position {
	baseX := parent.Position.X + defaultBranchGapX

	if len(siblings) == 0 {
		return mindmap.Position{X: baseX, Y: parent.Position.Y}
	}

	maxY := siblings[0].Position.Y
	for _, s := range siblings[1:] {
		if s.Position.Y > maxY {
			maxY = s.Position.Y
		}
	}

	return mindmap.Position{X: baseX, Y: maxY + childGapY}
}
