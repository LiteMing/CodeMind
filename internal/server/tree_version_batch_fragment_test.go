package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"code-mind/internal/mindmap"
)

// --- Tree Handler Tests ---

func TestHandleNodeTree_ReturnsNestedStructure(t *testing.T) {
	server := newTestServer(t)
	handler := withTestRevisionHeaders(server.Handler())

	// Create a map
	createReq := httptest.NewRequest(http.MethodPost, "/api/maps", strings.NewReader(`{"title":"Tree Test"}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRes := httptest.NewRecorder()
	handler.ServeHTTP(createRes, createReq)

	var doc mindmap.Document
	if err := json.Unmarshal(createRes.Body.Bytes(), &doc); err != nil {
		t.Fatalf("failed to decode document: %v", err)
	}

	rootID := ""
	for _, n := range doc.Nodes {
		if n.Kind == mindmap.NodeKindRoot {
			rootID = n.ID
			break
		}
	}

	// Create child A under root
	body := `{"parentId":"` + rootID + `","title":"Child A"}`
	req := httptest.NewRequest(http.MethodPost, "/api/maps/"+doc.ID+"/nodes", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", res.Code, res.Body.String())
	}
	var childA mindmap.Node
	json.Unmarshal(res.Body.Bytes(), &childA)

	// Create child B under root
	body = `{"parentId":"` + rootID + `","title":"Child B"}`
	req = httptest.NewRequest(http.MethodPost, "/api/maps/"+doc.ID+"/nodes", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", res.Code, res.Body.String())
	}
	var childB mindmap.Node
	json.Unmarshal(res.Body.Bytes(), &childB)

	// Create grandchild under child A
	body = `{"parentId":"` + childA.ID + `","title":"Grandchild"}`
	req = httptest.NewRequest(http.MethodPost, "/api/maps/"+doc.ID+"/nodes", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", res.Code, res.Body.String())
	}
	var grandchild mindmap.Node
	json.Unmarshal(res.Body.Bytes(), &grandchild)

	// GET /tree
	req = httptest.NewRequest(http.MethodGet, "/api/maps/"+doc.ID+"/tree", nil)
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", res.Code, res.Body.String())
	}

	var tree TreeNode
	if err := json.Unmarshal(res.Body.Bytes(), &tree); err != nil {
		t.Fatalf("failed to decode tree: %v", err)
	}

	// Root should be the tree root
	if tree.Kind != mindmap.NodeKindRoot {
		t.Fatalf("expected root kind, got %q", tree.Kind)
	}
	if tree.ID != rootID {
		t.Fatalf("expected root ID %q, got %q", rootID, tree.ID)
	}

	// Root should have 2 children
	if len(tree.Children) != 2 {
		t.Fatalf("expected 2 children of root, got %d", len(tree.Children))
	}

	// Find childA in tree children
	var treeChildA *TreeNode
	for i := range tree.Children {
		if tree.Children[i].ID == childA.ID {
			treeChildA = &tree.Children[i]
			break
		}
	}
	if treeChildA == nil {
		t.Fatal("childA not found in tree children")
	}

	// childA should have 1 child (grandchild)
	if len(treeChildA.Children) != 1 {
		t.Fatalf("expected 1 child of childA, got %d", len(treeChildA.Children))
	}
	if treeChildA.Children[0].ID != grandchild.ID {
		t.Fatalf("expected grandchild ID %q, got %q", grandchild.ID, treeChildA.Children[0].ID)
	}

	// childB should have 0 children
	var treeChildB *TreeNode
	for i := range tree.Children {
		if tree.Children[i].ID == childB.ID {
			treeChildB = &tree.Children[i]
			break
		}
	}
	if treeChildB == nil {
		t.Fatal("childB not found in tree children")
	}
	if len(treeChildB.Children) != 0 {
		t.Fatalf("expected 0 children of childB, got %d", len(treeChildB.Children))
	}
}

func TestHandleNodeTree_AllNodesAppearExactlyOnce(t *testing.T) {
	server := newTestServer(t)
	handler := withTestRevisionHeaders(server.Handler())

	// Create a map with some nodes
	createReq := httptest.NewRequest(http.MethodPost, "/api/maps", strings.NewReader(`{"title":"Tree Count"}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRes := httptest.NewRecorder()
	handler.ServeHTTP(createRes, createReq)

	var doc mindmap.Document
	json.Unmarshal(createRes.Body.Bytes(), &doc)

	rootID := ""
	for _, n := range doc.Nodes {
		if n.Kind == mindmap.NodeKindRoot {
			rootID = n.ID
			break
		}
	}

	// Create 3 children under root
	for i := 0; i < 3; i++ {
		body := `{"parentId":"` + rootID + `","title":"Child"}`
		req := httptest.NewRequest(http.MethodPost, "/api/maps/"+doc.ID+"/nodes", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
	}

	// GET flat nodes to count
	req := httptest.NewRequest(http.MethodGet, "/api/maps/"+doc.ID+"/nodes", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	var flatNodes []mindmap.Node
	json.Unmarshal(res.Body.Bytes(), &flatNodes)

	// GET tree
	req = httptest.NewRequest(http.MethodGet, "/api/maps/"+doc.ID+"/tree", nil)
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	var tree TreeNode
	json.Unmarshal(res.Body.Bytes(), &tree)

	// Count nodes in tree
	treeCount := countTreeNodes(tree)
	if treeCount != len(flatNodes) {
		t.Fatalf("expected %d nodes in tree, got %d", len(flatNodes), treeCount)
	}
}

func TestHandleNodeTree_Returns404ForNonExistentMap(t *testing.T) {
	handler := newTestHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/api/maps/nonexistent/tree", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", res.Code, res.Body.String())
	}
}

// --- Version Handler Tests ---

func TestHandleMapVersion_ReturnsCorrectValues(t *testing.T) {
	server := newTestServer(t)
	handler := withTestRevisionHeaders(server.Handler())

	// Create a map
	createReq := httptest.NewRequest(http.MethodPost, "/api/maps", strings.NewReader(`{"title":"Version Test"}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRes := httptest.NewRecorder()
	handler.ServeHTTP(createRes, createReq)

	var doc mindmap.Document
	json.Unmarshal(createRes.Body.Bytes(), &doc)

	rootID := ""
	for _, n := range doc.Nodes {
		if n.Kind == mindmap.NodeKindRoot {
			rootID = n.ID
			break
		}
	}

	// Add a node
	body := `{"parentId":"` + rootID + `","title":"Extra Node"}`
	req := httptest.NewRequest(http.MethodPost, "/api/maps/"+doc.ID+"/nodes", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	// GET /version
	req = httptest.NewRequest(http.MethodGet, "/api/maps/"+doc.ID+"/version", nil)
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", res.Code, res.Body.String())
	}

	var version mapVersionResponse
	if err := json.Unmarshal(res.Body.Bytes(), &version); err != nil {
		t.Fatalf("failed to decode version: %v", err)
	}

	// Should have 2 nodes (root + extra)
	if version.NodeCount != 2 {
		t.Fatalf("expected nodeCount 2, got %d", version.NodeCount)
	}

	// lastEditedAt should not be zero
	if version.LastEditedAt.IsZero() {
		t.Fatal("expected non-zero lastEditedAt")
	}
}

func TestHandleMapVersion_Returns404ForNonExistentMap(t *testing.T) {
	handler := newTestHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/api/maps/nonexistent/version", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", res.Code, res.Body.String())
	}
}

// --- Batch Handler Tests ---

func TestHandleNodeBatch_SuccessfulOperations(t *testing.T) {
	server := newTestServer(t)
	handler := withTestRevisionHeaders(server.Handler())

	// Create a map
	createReq := httptest.NewRequest(http.MethodPost, "/api/maps", strings.NewReader(`{"title":"Batch Test"}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRes := httptest.NewRecorder()
	handler.ServeHTTP(createRes, createReq)

	var doc mindmap.Document
	json.Unmarshal(createRes.Body.Bytes(), &doc)

	rootID := ""
	for _, n := range doc.Nodes {
		if n.Kind == mindmap.NodeKindRoot {
			rootID = n.ID
			break
		}
	}

	// Batch: create two nodes
	batchBody := `{"operations":[` +
		`{"action":"create","payload":{"parentId":"` + rootID + `","title":"Batch Child 1"}},` +
		`{"action":"create","payload":{"parentId":"` + rootID + `","title":"Batch Child 2"}}` +
		`]}`
	req := httptest.NewRequest(http.MethodPost, "/api/maps/"+doc.ID+"/batch", strings.NewReader(batchBody))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", res.Code, res.Body.String())
	}

	var batchResp batchResponse
	if err := json.Unmarshal(res.Body.Bytes(), &batchResp); err != nil {
		t.Fatalf("failed to decode batch response: %v", err)
	}

	if len(batchResp.Results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(batchResp.Results))
	}
	if batchResp.Results[0].Title != "Batch Child 1" {
		t.Fatalf("expected first result title 'Batch Child 1', got %q", batchResp.Results[0].Title)
	}
	if batchResp.Results[1].Title != "Batch Child 2" {
		t.Fatalf("expected second result title 'Batch Child 2', got %q", batchResp.Results[1].Title)
	}

	// Verify nodes exist
	req = httptest.NewRequest(http.MethodGet, "/api/maps/"+doc.ID+"/nodes", nil)
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	var nodes []mindmap.Node
	json.Unmarshal(res.Body.Bytes(), &nodes)
	if len(nodes) != 3 { // root + 2 created
		t.Fatalf("expected 3 nodes, got %d", len(nodes))
	}
}

func TestHandleNodeBatch_AtomicityOnFailure(t *testing.T) {
	server := newTestServer(t)
	handler := withTestRevisionHeaders(server.Handler())

	// Create a map
	createReq := httptest.NewRequest(http.MethodPost, "/api/maps", strings.NewReader(`{"title":"Batch Atomic"}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRes := httptest.NewRecorder()
	handler.ServeHTTP(createRes, createReq)

	var doc mindmap.Document
	json.Unmarshal(createRes.Body.Bytes(), &doc)

	rootID := ""
	for _, n := range doc.Nodes {
		if n.Kind == mindmap.NodeKindRoot {
			rootID = n.ID
			break
		}
	}

	// Batch: first op valid, second op invalid (non-existent parent)
	batchBody := `{"operations":[` +
		`{"action":"create","payload":{"parentId":"` + rootID + `","title":"Valid Node"}},` +
		`{"action":"create","payload":{"parentId":"nonexistent","title":"Invalid Node"}}` +
		`]}`
	req := httptest.NewRequest(http.MethodPost, "/api/maps/"+doc.ID+"/batch", strings.NewReader(batchBody))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", res.Code, res.Body.String())
	}

	// Verify no nodes were created (atomicity)
	req = httptest.NewRequest(http.MethodGet, "/api/maps/"+doc.ID+"/nodes", nil)
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	var nodes []mindmap.Node
	json.Unmarshal(res.Body.Bytes(), &nodes)
	if len(nodes) != 1 { // only root
		t.Fatalf("expected 1 node (root only, atomicity), got %d", len(nodes))
	}
}

func TestHandleNodeBatch_UpdateAndDelete(t *testing.T) {
	server := newTestServer(t)
	handler := withTestRevisionHeaders(server.Handler())

	// Create a map
	createReq := httptest.NewRequest(http.MethodPost, "/api/maps", strings.NewReader(`{"title":"Batch UD"}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRes := httptest.NewRecorder()
	handler.ServeHTTP(createRes, createReq)

	var doc mindmap.Document
	json.Unmarshal(createRes.Body.Bytes(), &doc)

	rootID := ""
	for _, n := range doc.Nodes {
		if n.Kind == mindmap.NodeKindRoot {
			rootID = n.ID
			break
		}
	}

	// Create a node first
	body := `{"parentId":"` + rootID + `","title":"To Update"}`
	req := httptest.NewRequest(http.MethodPost, "/api/maps/"+doc.ID+"/nodes", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	var created mindmap.Node
	json.Unmarshal(res.Body.Bytes(), &created)

	// Create another node to delete
	body = `{"parentId":"` + rootID + `","title":"To Delete"}`
	req = httptest.NewRequest(http.MethodPost, "/api/maps/"+doc.ID+"/nodes", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	var toDelete mindmap.Node
	json.Unmarshal(res.Body.Bytes(), &toDelete)

	// Batch: update first, delete second
	batchBody := `{"operations":[` +
		`{"action":"update","nodeId":"` + created.ID + `","payload":{"title":"Updated Title"}},` +
		`{"action":"delete","nodeId":"` + toDelete.ID + `","payload":{"cascade":true}}` +
		`]}`
	req = httptest.NewRequest(http.MethodPost, "/api/maps/"+doc.ID+"/batch", strings.NewReader(batchBody))
	req.Header.Set("Content-Type", "application/json")
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", res.Code, res.Body.String())
	}

	var batchResp batchResponse
	json.Unmarshal(res.Body.Bytes(), &batchResp)

	// Should have 1 result (the updated node)
	if len(batchResp.Results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(batchResp.Results))
	}
	if batchResp.Results[0].Title != "Updated Title" {
		t.Fatalf("expected updated title, got %q", batchResp.Results[0].Title)
	}
	if batchResp.DeletedCount != 1 {
		t.Fatalf("expected deletedCount 1, got %d", batchResp.DeletedCount)
	}

	// Verify state
	req = httptest.NewRequest(http.MethodGet, "/api/maps/"+doc.ID+"/nodes", nil)
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	var nodes []mindmap.Node
	json.Unmarshal(res.Body.Bytes(), &nodes)
	// root + updated node = 2
	if len(nodes) != 2 {
		t.Fatalf("expected 2 nodes, got %d", len(nodes))
	}
}

func TestHandleNodeBatch_DeletePrunesDanglingRelations(t *testing.T) {
	server := newTestServer(t)
	handler := withTestRevisionHeaders(server.Handler())

	doc := mindmap.NewDefaultDocument()
	doc.ID = "batch-relation-delete"
	now := doc.Meta.LastEditedAt
	doc.Nodes = append(doc.Nodes,
		mindmap.Node{ID: "node-a", ParentID: "root", Kind: mindmap.NodeKindTopic, Title: "A", Position: mindmap.Position{X: 1100, Y: 280}, CreatedAt: now, UpdatedAt: now},
		mindmap.Node{ID: "node-b", ParentID: "root", Kind: mindmap.NodeKindTopic, Title: "B", Position: mindmap.Position{X: 1100, Y: 380}, CreatedAt: now, UpdatedAt: now},
	)
	doc.Relations = append(doc.Relations, mindmap.RelationEdge{
		ID:        "rel-ab",
		SourceID:  "node-a",
		TargetID:  "node-b",
		CreatedAt: now,
		UpdatedAt: now,
	})
	if err := server.store.Save(doc); err != nil {
		t.Fatal(err)
	}

	batchBody := `{"operations":[{"action":"delete","nodeId":"node-b","payload":{"cascade":true}}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/maps/batch-relation-delete/batch", strings.NewReader(batchBody))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", res.Code, res.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/maps/batch-relation-delete", nil)
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	var loaded mindmap.Document
	if err := json.Unmarshal(res.Body.Bytes(), &loaded); err != nil {
		t.Fatalf("failed to decode loaded document: %v", err)
	}
	if len(loaded.Relations) != 0 {
		t.Fatalf("expected relations to be pruned, got %+v", loaded.Relations)
	}
}

func TestHandleNodeBatch_Returns404ForNonExistentMap(t *testing.T) {
	handler := newTestHandler(t)

	batchBody := `{"operations":[{"action":"create","payload":{"parentId":"root","title":"X"}}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/maps/nonexistent/batch", strings.NewReader(batchBody))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", res.Code, res.Body.String())
	}
}

// --- Import Fragment Handler Tests ---

func TestHandleImportFragment_CreatesNodesRecursively(t *testing.T) {
	server := newTestServer(t)
	handler := withTestRevisionHeaders(server.Handler())

	// Create a map
	createReq := httptest.NewRequest(http.MethodPost, "/api/maps", strings.NewReader(`{"title":"Fragment Test"}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRes := httptest.NewRecorder()
	handler.ServeHTTP(createRes, createReq)

	var doc mindmap.Document
	json.Unmarshal(createRes.Body.Bytes(), &doc)

	// Import a fragment with nested children (parentId omitted = defaults to root)
	fragBody := `{"nodes":[{"title":"Parent","children":[{"title":"Child 1"},{"title":"Child 2","children":[{"title":"Grandchild"}]}]}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/maps/"+doc.ID+"/import-fragment", strings.NewReader(fragBody))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", res.Code, res.Body.String())
	}

	var created []mindmap.Node
	if err := json.Unmarshal(res.Body.Bytes(), &created); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	// Should create 4 nodes: Parent, Child 1, Child 2, Grandchild
	if len(created) != 4 {
		t.Fatalf("expected 4 created nodes, got %d", len(created))
	}

	// Verify all have IDs and timestamps
	for _, n := range created {
		if !strings.HasPrefix(n.ID, "node-") {
			t.Fatalf("expected node ID prefix 'node-', got %q", n.ID)
		}
		if n.CreatedAt.IsZero() {
			t.Fatalf("expected non-zero createdAt for node %q", n.ID)
		}
		if n.Kind != mindmap.NodeKindTopic {
			t.Fatalf("expected kind 'topic', got %q for node %q", n.Kind, n.ID)
		}
	}

	// Verify parent-child relationships
	parentNode := created[0]
	if parentNode.Title != "Parent" {
		t.Fatalf("expected first node title 'Parent', got %q", parentNode.Title)
	}

	// Child 1 and Child 2 should have parentNode as parent
	child1 := created[1]
	child2 := created[2]
	if child1.ParentID != parentNode.ID {
		t.Fatalf("expected child1 parentId %q, got %q", parentNode.ID, child1.ParentID)
	}
	if child2.ParentID != parentNode.ID {
		t.Fatalf("expected child2 parentId %q, got %q", parentNode.ID, child2.ParentID)
	}

	// Grandchild should have child2 as parent
	grandchild := created[3]
	if grandchild.ParentID != child2.ID {
		t.Fatalf("expected grandchild parentId %q, got %q", child2.ID, grandchild.ParentID)
	}
}

func TestHandleImportFragment_DefaultsParentIdToRoot(t *testing.T) {
	server := newTestServer(t)
	handler := withTestRevisionHeaders(server.Handler())

	// Create a map
	createReq := httptest.NewRequest(http.MethodPost, "/api/maps", strings.NewReader(`{"title":"Fragment Root"}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRes := httptest.NewRecorder()
	handler.ServeHTTP(createRes, createReq)

	var doc mindmap.Document
	json.Unmarshal(createRes.Body.Bytes(), &doc)

	rootID := ""
	for _, n := range doc.Nodes {
		if n.Kind == mindmap.NodeKindRoot {
			rootID = n.ID
			break
		}
	}

	// Import without parentId
	fragBody := `{"nodes":[{"title":"Orphan Node"}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/maps/"+doc.ID+"/import-fragment", strings.NewReader(fragBody))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", res.Code, res.Body.String())
	}

	var created []mindmap.Node
	json.Unmarshal(res.Body.Bytes(), &created)

	if len(created) != 1 {
		t.Fatalf("expected 1 node, got %d", len(created))
	}
	if created[0].ParentID != rootID {
		t.Fatalf("expected parentId to default to root %q, got %q", rootID, created[0].ParentID)
	}
}

func TestHandleImportFragment_Returns400ForInvalidParentId(t *testing.T) {
	server := newTestServer(t)
	handler := withTestRevisionHeaders(server.Handler())

	// Create a map
	createReq := httptest.NewRequest(http.MethodPost, "/api/maps", strings.NewReader(`{"title":"Fragment Invalid"}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRes := httptest.NewRecorder()
	handler.ServeHTTP(createRes, createReq)

	var doc mindmap.Document
	json.Unmarshal(createRes.Body.Bytes(), &doc)

	// Import with non-existent parentId
	fragBody := `{"nodes":[{"title":"Bad Parent","parentId":"nonexistent-id"}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/maps/"+doc.ID+"/import-fragment", strings.NewReader(fragBody))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", res.Code, res.Body.String())
	}
	if !strings.Contains(res.Body.String(), "not found") {
		t.Fatalf("expected error about parent not found, got %s", res.Body.String())
	}
}

func TestHandleImportFragment_Returns404ForNonExistentMap(t *testing.T) {
	handler := newTestHandler(t)

	fragBody := `{"nodes":[{"title":"Test"}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/maps/nonexistent/import-fragment", strings.NewReader(fragBody))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", res.Code, res.Body.String())
	}
}

// --- Helper ---

func countTreeNodes(tree TreeNode) int {
	count := 1
	for _, child := range tree.Children {
		count += countTreeNodes(child)
	}
	return count
}
