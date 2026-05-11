package server

import (
	"testing"

	"code-mind/internal/mindmap"
)

func TestCalculateChildPosition_NoSiblings(t *testing.T) {
	parent := mindmap.Node{
		Position: mindmap.Position{X: 100, Y: 200},
	}

	pos := calculateChildPosition(parent, nil)

	wantX := 100.0 + defaultBranchGapX
	wantY := 200.0
	if pos.X != wantX {
		t.Errorf("X = %v, want %v", pos.X, wantX)
	}
	if pos.Y != wantY {
		t.Errorf("Y = %v, want %v", pos.Y, wantY)
	}
}

func TestCalculateChildPosition_WithSiblings(t *testing.T) {
	parent := mindmap.Node{
		Position: mindmap.Position{X: 100, Y: 200},
	}
	siblings := []mindmap.Node{
		{Position: mindmap.Position{X: 380, Y: 200}},
		{Position: mindmap.Position{X: 380, Y: 296}},
		{Position: mindmap.Position{X: 380, Y: 392}},
	}

	pos := calculateChildPosition(parent, siblings)

	wantX := 100.0 + defaultBranchGapX
	wantY := 392.0 + childGapY // 392 + 96 = 488
	if pos.X != wantX {
		t.Errorf("X = %v, want %v", pos.X, wantX)
	}
	if pos.Y != wantY {
		t.Errorf("Y = %v, want %v", pos.Y, wantY)
	}
}

func TestCalculateChildPosition_SiblingsUnordered(t *testing.T) {
	parent := mindmap.Node{
		Position: mindmap.Position{X: 50, Y: 100},
	}
	siblings := []mindmap.Node{
		{Position: mindmap.Position{X: 330, Y: 300}},
		{Position: mindmap.Position{X: 330, Y: 500}}, // max Y
		{Position: mindmap.Position{X: 330, Y: 200}},
	}

	pos := calculateChildPosition(parent, siblings)

	wantX := 50.0 + defaultBranchGapX
	wantY := 500.0 + childGapY // 500 + 96 = 596
	if pos.X != wantX {
		t.Errorf("X = %v, want %v", pos.X, wantX)
	}
	if pos.Y != wantY {
		t.Errorf("Y = %v, want %v", pos.Y, wantY)
	}
}

func TestCalculateChildPosition_SingleSibling(t *testing.T) {
	parent := mindmap.Node{
		Position: mindmap.Position{X: 0, Y: 0},
	}
	siblings := []mindmap.Node{
		{Position: mindmap.Position{X: 280, Y: 0}},
	}

	pos := calculateChildPosition(parent, siblings)

	wantX := 0.0 + defaultBranchGapX
	wantY := 0.0 + childGapY // 0 + 96 = 96
	if pos.X != wantX {
		t.Errorf("X = %v, want %v", pos.X, wantX)
	}
	if pos.Y != wantY {
		t.Errorf("Y = %v, want %v", pos.Y, wantY)
	}
}
