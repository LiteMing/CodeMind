package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"code-mind/internal/mindmap"
)

func TestNodeCRUDPersistsBindingsAndExplicitOrder(t *testing.T) {
	handler := withTestRevisionHeaders(newTestServer(t).Handler())
	doc := createSemanticsTestMap(t, handler)

	first := createSemanticsTestNode(t, handler, doc.ID, `{"parentId":"root","title":"First"}`)
	second := createSemanticsTestNode(t, handler, doc.ID, `{"parentId":"root","order":1,"title":"Second","bindings":[{"id":"binding-file","type":"file","path":"frontend\\src\\app.ts"}]}`)
	if second.Order != 1 || second.Bindings[0].Path != "frontend/src/app.ts" {
		t.Fatalf("created second = order %d, bindings %#v", second.Order, second.Bindings)
	}

	patch := `{"order":1,"bindings":[{"id":"binding-symbol","type":"symbol","path":"internal/server/maps.go","symbol":"Server.handleMaps"}]}`
	req := httptest.NewRequest(http.MethodPatch, "/api/maps/"+doc.ID+"/nodes/"+first.ID, strings.NewReader(patch))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", res.Code, res.Body.String())
	}
	var updated mindmap.Node
	if err := json.Unmarshal(res.Body.Bytes(), &updated); err != nil {
		t.Fatal(err)
	}
	if updated.Order != 1 || len(updated.Bindings) != 1 || updated.Bindings[0].ID != "binding-symbol" {
		t.Fatalf("updated node = %#v", updated)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/maps/"+doc.ID+"/tree?compact=true", nil)
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", res.Code, res.Body.String())
	}
	var tree compactTreeNode
	if err := json.Unmarshal(res.Body.Bytes(), &tree); err != nil {
		t.Fatal(err)
	}
	if len(tree.Children) != 2 || tree.Children[0].ID != first.ID || tree.Children[1].ID != second.ID {
		t.Fatalf("compact tree children = %#v", tree.Children)
	}
	if tree.Children[0].Order != 1 || tree.Children[1].Order != 2 || len(tree.Children[0].Bindings) != 1 {
		t.Fatalf("compact contract missing order/bindings: %#v", tree.Children)
	}
}

func TestNodeCRUDRejectsInvalidOrDuplicateBindings(t *testing.T) {
	handler := withTestRevisionHeaders(newTestServer(t).Handler())
	doc := createSemanticsTestMap(t, handler)

	createSemanticsTestNode(t, handler, doc.ID, `{"parentId":"root","title":"First","bindings":[{"id":"shared","type":"directory","path":"frontend"}]}`)

	tests := []string{
		`{"parentId":"root","title":"Duplicate","bindings":[{"id":"shared","type":"file","path":"main.go"}]}`,
		`{"parentId":"root","title":"Traversal","bindings":[{"id":"traversal","type":"file","path":"src/../secret"}]}`,
		`{"parentId":"root","title":"Bad Symbol","bindings":[{"id":"symbol","type":"symbol","path":"main.go"}]}`,
	}
	for _, body := range tests {
		req := httptest.NewRequest(http.MethodPost, "/api/maps/"+doc.ID+"/nodes", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != http.StatusBadRequest {
			t.Fatalf("body %s: expected 400, got %d: %s", body, res.Code, res.Body.String())
		}
	}
}

func TestDeleteWithoutCascadePromotesChildrenAtDeletedOrder(t *testing.T) {
	handler := withTestRevisionHeaders(newTestServer(t).Handler())
	doc := createSemanticsTestMap(t, handler)
	a := createSemanticsTestNode(t, handler, doc.ID, `{"parentId":"root","title":"A"}`)
	b := createSemanticsTestNode(t, handler, doc.ID, `{"parentId":"root","title":"B"}`)
	c := createSemanticsTestNode(t, handler, doc.ID, `{"parentId":"root","title":"C"}`)
	b1 := createSemanticsTestNode(t, handler, doc.ID, `{"parentId":"`+b.ID+`","title":"B1"}`)
	b2 := createSemanticsTestNode(t, handler, doc.ID, `{"parentId":"`+b.ID+`","title":"B2"}`)

	req := httptest.NewRequest(http.MethodDelete, "/api/maps/"+doc.ID+"/nodes/"+b.ID+"?cascade=false", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", res.Code, res.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/maps/"+doc.ID+"/tree", nil)
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	var tree TreeNode
	if err := json.Unmarshal(res.Body.Bytes(), &tree); err != nil {
		t.Fatal(err)
	}
	want := []string{a.ID, b1.ID, b2.ID, c.ID}
	if len(tree.Children) != len(want) {
		t.Fatalf("children = %#v", tree.Children)
	}
	for index, nodeID := range want {
		if tree.Children[index].ID != nodeID || tree.Children[index].Order != index+1 {
			t.Fatalf("child %d = %s/order %d, want %s/order %d", index, tree.Children[index].ID, tree.Children[index].Order, nodeID, index+1)
		}
	}
}

func TestDeleteParentlessFloatingWithoutCascadePromotesChildrenAsFloating(t *testing.T) {
	now := time.Now().UTC()
	nodes := []mindmap.Node{
		{ID: "root", Kind: mindmap.NodeKindRoot, Title: "Root", CreatedAt: now, UpdatedAt: now},
		{ID: "floating", Kind: mindmap.NodeKindFloating, Title: "Floating", CreatedAt: now, UpdatedAt: now},
		{ID: "child-a", ParentID: "floating", Kind: mindmap.NodeKindTopic, Order: 1, Title: "A", CreatedAt: now, UpdatedAt: now},
		{ID: "child-b", ParentID: "floating", Kind: mindmap.NodeKindTopic, Order: 2, Title: "B", CreatedAt: now, UpdatedAt: now},
	}

	deleted, remaining, err := deleteNodeWithOrder(nodes, "floating", false)
	if err != nil {
		t.Fatal(err)
	}
	if deleted != 1 || len(remaining) != 3 {
		t.Fatalf("deleted=%d remaining=%#v", deleted, remaining)
	}
	for _, node := range remaining {
		if node.ID == "root" {
			continue
		}
		if node.ParentID != "" || node.Kind != mindmap.NodeKindFloating || node.Order != 0 {
			t.Fatalf("promoted node = %#v", node)
		}
	}
}

func TestImportFragmentPersistsNestedOrderAndBindings(t *testing.T) {
	handler := withTestRevisionHeaders(newTestServer(t).Handler())
	doc := createSemanticsTestMap(t, handler)
	body := `{"nodes":[{"title":"Parent","bindings":[{"id":"dir","type":"directory","path":"internal"}],"children":[{"title":"Second","order":2},{"title":"First","order":1,"bindings":[{"id":"file","type":"file","path":"internal\\server\\maps.go"}]}]}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/maps/"+doc.ID+"/import-fragment", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", res.Code, res.Body.String())
	}
	var created []mindmap.Node
	if err := json.Unmarshal(res.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if len(created) != 3 || created[0].Order != 1 || len(created[0].Bindings) != 1 {
		t.Fatalf("created = %#v", created)
	}
	if created[1].Title != "First" || created[1].Order != 1 || created[2].Title != "Second" || created[2].Order != 2 {
		t.Fatalf("nested created order = %#v", created)
	}
	if created[1].Bindings[0].Path != "internal/server/maps.go" {
		t.Fatalf("normalized fragment binding = %#v", created[1].Bindings)
	}
}

func createSemanticsTestMap(t *testing.T, handler http.Handler) mindmap.Document {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/maps", strings.NewReader(`{"title":"Semantics"}`))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", res.Code, res.Body.String())
	}
	var doc mindmap.Document
	if err := json.Unmarshal(res.Body.Bytes(), &doc); err != nil {
		t.Fatal(err)
	}
	return doc
}

func createSemanticsTestNode(t *testing.T, handler http.Handler, mapID string, body string) mindmap.Node {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/maps/"+mapID+"/nodes", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", res.Code, res.Body.String())
	}
	var node mindmap.Node
	if err := json.Unmarshal(res.Body.Bytes(), &node); err != nil {
		t.Fatal(err)
	}
	return node
}
