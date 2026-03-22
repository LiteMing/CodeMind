package mindmap

import (
	"bufio"
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
)

type lineMode string

type stackEntry struct {
	depth  int
	nodeID string
}

const (
	modeTree      lineMode = "tree"
	modeFloating  lineMode = "floating"
	modeRelations lineMode = "relations"
)

var priorityPrefixPattern = regexp.MustCompile(`^\[(P[0-3])\]\s+`)

func ExportMarkdown(doc Document) string {
	var builder strings.Builder
	root := doc.Root()

	builder.WriteString("# ")
	builder.WriteString(root.Title)
	builder.WriteString("\n\n")
	writeChildrenMarkdown(&builder, doc, root.ID, 0)

	floating := make([]Node, 0)
	for _, node := range doc.Nodes {
		if node.Kind == NodeKindFloating {
			floating = append(floating, node)
		}
	}

	slices.SortFunc(floating, func(a, b Node) int {
		switch {
		case a.Position.Y < b.Position.Y:
			return -1
		case a.Position.Y > b.Position.Y:
			return 1
		default:
			return strings.Compare(a.ID, b.ID)
		}
	})

	if len(floating) > 0 {
		builder.WriteString("\n## Floating Nodes\n\n")
		for _, node := range floating {
			writeMarkdownLine(&builder, 0, node)
			writeChildrenMarkdown(&builder, doc, node.ID, 1)
		}
	}

	if len(doc.Relations) > 0 {
		builder.WriteString("\n## Relations\n\n")
		nodeByID := doc.NodeMap()
		for _, edge := range doc.Relations {
			source := nodeByID[edge.SourceID]
			target := nodeByID[edge.TargetID]
			line := fmt.Sprintf("- %s -> %s", source.Title, target.Title)
			if strings.TrimSpace(edge.Label) != "" {
				line += " : " + strings.TrimSpace(edge.Label)
			}
			builder.WriteString(line)
			builder.WriteString("\n")
		}
	}

	return strings.TrimSpace(builder.String()) + "\n"
}

func writeChildrenMarkdown(builder *strings.Builder, doc Document, parentID string, depth int) {
	for _, child := range doc.ChildrenOf(parentID) {
		writeMarkdownLine(builder, depth, child)
		writeChildrenMarkdown(builder, doc, child.ID, depth+1)
	}
}

func writeMarkdownLine(builder *strings.Builder, depth int, node Node) {
	builder.WriteString(strings.Repeat("  ", depth))
	builder.WriteString("- ")
	if node.Priority != PriorityNone {
		builder.WriteString("[")
		builder.WriteString(string(node.Priority))
		builder.WriteString("] ")
	}
	builder.WriteString(node.Title)
	builder.WriteString("\n")
}

func ImportMarkdown(content string) Document {
	return importIndentedContent(content, true)
}

func ImportPlainText(content string) Document {
	return importIndentedContent(content, false)
}

func importIndentedContent(content string, markdown bool) Document {
	now := time.Now().UTC()
	doc := NewDefaultDocument()
	doc.ID = "default"
	doc.Meta.LastOpenedAt = now
	doc.Meta.LastEditedAt = now

	lines := scanNormalizedLines(content)
	if len(lines) == 0 {
		return doc
	}

	root := doc.Root()
	mode := modeTree
	stack := []stackEntry{{depth: 0, nodeID: root.ID}}
	titleToID := map[string]string{
		strings.ToLower(strings.TrimSpace(root.Title)): root.ID,
	}
	plainTextRootAssigned := false

	for _, rawLine := range lines {
		line := strings.TrimSpace(rawLine)
		if line == "" {
			continue
		}

		if markdown && strings.HasPrefix(line, "# ") {
			root.Title = strings.TrimSpace(strings.TrimPrefix(line, "# "))
			doc.Title = root.Title
			titleToID[strings.ToLower(root.Title)] = root.ID
			stack = []stackEntry{{depth: 0, nodeID: root.ID}}
			mode = modeTree
			continue
		}

		if markdown && strings.HasPrefix(line, "## ") {
			section := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(line, "## ")))
			switch section {
			case "floating nodes":
				mode = modeFloating
				stack = nil
				continue
			case "relations":
				mode = modeRelations
				stack = nil
				continue
			default:
				mode = modeTree
				node := newImportedNode(strings.TrimSpace(strings.TrimPrefix(line, "## ")), root.ID, NodeKindTopic, nextChildPosition(doc, root.ID))
				doc.Nodes = append(doc.Nodes, node)
				titleToID[strings.ToLower(node.Title)] = node.ID
				stack = []stackEntry{
					{depth: 0, nodeID: root.ID},
					{depth: 1, nodeID: node.ID},
				}
				continue
			}
		}

		if mode == modeRelations {
			parseRelationLine(&doc, line, titleToID)
			continue
		}

		depth, title := extractDepthAndTitle(rawLine, markdown)
		if title == "" {
			continue
		}

		priority, cleanTitle := splitPriority(title)
		title = cleanTitle

		if !markdown && !plainTextRootAssigned {
			root.Title = title
			doc.Title = title
			titleToID[strings.ToLower(root.Title)] = root.ID
			stack = []stackEntry{{depth: 0, nodeID: root.ID}}
			plainTextRootAssigned = true
			continue
		}

		parentID := root.ID
		nodeKind := NodeKindTopic
		position := Position{}

		if mode == modeFloating {
			if depth == 0 {
				parentID = ""
				nodeKind = NodeKindFloating
				position = nextFloatingPosition(doc)
			} else {
				parentID = findParentIDForDepth(stack, depth)
				position = nextChildPosition(doc, parentID)
			}
		} else {
			if depth > 0 {
				parentID = findParentIDForDepth(stack, depth)
			}
			position = nextChildPosition(doc, parentID)
		}

		node := newImportedNode(title, parentID, nodeKind, position)
		node.Priority = priority

		doc.Nodes = append(doc.Nodes, node)
		titleToID[strings.ToLower(node.Title)] = node.ID
		if mode == modeFloating && depth == 0 {
			stack = []stackEntry{{depth: 0, nodeID: node.ID}}
		} else {
			stack = appendNodeToStack(stack, depth, node.ID)
		}
	}

	for index := range doc.Nodes {
		if doc.Nodes[index].Kind == NodeKindRoot {
			doc.Nodes[index].Title = root.Title
			break
		}
	}

	_ = doc.Validate()
	return doc
}

func scanNormalizedLines(content string) []string {
	normalized := strings.ReplaceAll(content, "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "\r", "\n")

	lines := make([]string, 0)
	scanner := bufio.NewScanner(strings.NewReader(normalized))
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}
	return lines
}

func extractDepthAndTitle(line string, markdown bool) (int, string) {
	trimmedLeft := strings.TrimLeft(line, " \t")
	depth := measureIndentDepth(line[:len(line)-len(trimmedLeft)])

	title := strings.TrimSpace(trimmedLeft)
	title = stripListMarker(title)

	if markdown && strings.HasPrefix(title, "#") {
		title = strings.TrimLeft(title, "#")
		title = strings.TrimSpace(title)
	}

	return depth, title
}

func splitPriority(title string) (Priority, string) {
	match := priorityPrefixPattern.FindStringSubmatch(title)
	if len(match) == 2 {
		return Priority(match[1]), strings.TrimSpace(priorityPrefixPattern.ReplaceAllString(title, ""))
	}
	return PriorityNone, strings.TrimSpace(title)
}

func parseRelationLine(doc *Document, line string, titleToID map[string]string) {
	trimmed := strings.TrimSpace(strings.TrimPrefix(line, "- "))
	parts := strings.SplitN(trimmed, "->", 2)
	if len(parts) != 2 {
		return
	}

	sourceTitle := strings.ToLower(strings.TrimSpace(parts[0]))
	targetPart := strings.TrimSpace(parts[1])
	label := ""
	if strings.Contains(targetPart, " : ") {
		targetSegments := strings.SplitN(targetPart, " : ", 2)
		targetPart = strings.TrimSpace(targetSegments[0])
		label = strings.TrimSpace(targetSegments[1])
	}
	targetTitle := strings.ToLower(strings.TrimSpace(targetPart))

	sourceID, sourceOK := titleToID[sourceTitle]
	targetID, targetOK := titleToID[targetTitle]
	if !sourceOK || !targetOK || sourceID == targetID {
		return
	}

	doc.Relations = append(doc.Relations, RelationEdge{
		ID:        NewID("rel"),
		SourceID:  sourceID,
		TargetID:  targetID,
		Label:     label,
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	})
}

func measureIndentDepth(indent string) int {
	width := 0
	for _, char := range indent {
		if char == '\t' {
			width += 2
			continue
		}
		width++
	}
	return width / 2
}

func stripListMarker(title string) string {
	switch {
	case strings.HasPrefix(title, "- "):
		return strings.TrimSpace(strings.TrimPrefix(title, "- "))
	case strings.HasPrefix(title, "* "):
		return strings.TrimSpace(strings.TrimPrefix(title, "* "))
	case strings.HasPrefix(title, "+ "):
		return strings.TrimSpace(strings.TrimPrefix(title, "+ "))
	}

	parts := strings.SplitN(title, ". ", 2)
	if len(parts) == 2 {
		if _, err := strconv.Atoi(parts[0]); err == nil {
			return strings.TrimSpace(parts[1])
		}
	}

	return title
}

func findParentIDForDepth(stack []stackEntry, depth int) string {
	if len(stack) == 0 {
		return "root"
	}

	targetDepth := depth
	if targetDepth < 0 {
		targetDepth = 0
	}

	for index := len(stack) - 1; index >= 0; index-- {
		entry := stack[index]
		if entry.depth == targetDepth || entry.depth < targetDepth {
			return entry.nodeID
		}
	}

	return stack[0].nodeID
}

func appendNodeToStack(stack []stackEntry, depth int, nodeID string) []stackEntry {
	for len(stack) > 0 && stack[len(stack)-1].depth >= depth+1 {
		stack = stack[:len(stack)-1]
	}
	stack = append(stack, stackEntry{depth: depth + 1, nodeID: nodeID})
	return stack
}

func newImportedNode(title string, parentID string, kind NodeKind, position Position) Node {
	now := time.Now().UTC()
	return Node{
		ID:        NewID("node"),
		ParentID:  parentID,
		Kind:      kind,
		Title:     strings.TrimSpace(title),
		Position:  position,
		CreatedAt: now,
		UpdatedAt: now,
	}
}

func nextChildPosition(doc Document, parentID string) Position {
	parentMap := doc.NodeMap()
	parent, ok := parentMap[parentID]
	if !ok {
		return Position{X: 820, Y: 320}
	}

	children := doc.ChildrenOf(parentID)
	if len(children) == 0 {
		return Position{X: parent.Position.X + 280, Y: parent.Position.Y}
	}

	last := children[len(children)-1]
	return Position{X: parent.Position.X + 280, Y: last.Position.Y + 96}
}

func nextFloatingPosition(doc Document) Position {
	floating := make([]Node, 0)
	root := doc.Root()
	for _, node := range doc.Nodes {
		if node.Kind == NodeKindFloating {
			floating = append(floating, node)
		}
	}
	if len(floating) == 0 {
		return Position{X: root.Position.X - 140, Y: root.Position.Y + 180}
	}

	slices.SortFunc(floating, func(a, b Node) int {
		switch {
		case a.Position.Y < b.Position.Y:
			return -1
		case a.Position.Y > b.Position.Y:
			return 1
		default:
			return strings.Compare(a.ID, b.ID)
		}
	})

	last := floating[len(floating)-1]
	return Position{X: last.Position.X + 36, Y: last.Position.Y + 96}
}
