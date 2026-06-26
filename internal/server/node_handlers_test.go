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

func TestHandleNodesGet_ReturnsNodes(t *testing.T) {
	server := newTestServer(t)
	handler := server.Handler()

	// Create a map first
	createReq := httptest.NewRequest(http.MethodPost, "/api/maps", strings.NewReader(`{"title":"Test Map"}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRes := httptest.NewRecorder()
	handler.ServeHTTP(createRes, createReq)

	if createRes.Code != http.StatusCreated {
		t.Fatalf("expected 201 on create map, got %d: %s", createRes.Code, createRes.Body.String())
	}

	var doc mindmap.Document
	if err := json.Unmarshal(createRes.Body.Bytes(), &doc); err != nil {
		t.Fatalf("failed to decode created document: %v", err)
	}

	// GET nodes
	req := httptest.NewRequest(http.MethodGet, "/api/maps/"+doc.ID+"/nodes", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", res.Code, res.Body.String())
	}

	var nodes []mindmap.Node
	if err := json.Unmarshal(res.Body.Bytes(), &nodes); err != nil {
		t.Fatalf("failed to decode nodes: %v", err)
	}
	if len(nodes) == 0 {
		t.Fatal("expected at least one node (root)")
	}

	// Verify root node is present
	foundRoot := false
	for _, n := range nodes {
		if n.Kind == mindmap.NodeKindRoot {
			foundRoot = true
			break
		}
	}
	if !foundRoot {
		t.Fatal("expected root node in response")
	}
}

func TestHandleNodesGet_Returns404ForNonExistentMap(t *testing.T) {
	handler := newTestHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/api/maps/nonexistent-map/nodes", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", res.Code, res.Body.String())
	}
}

func TestHandleNodesPost_CreatesNodeWithAutoCompletedFields(t *testing.T) {
	server := newTestServer(t)
	handler := server.Handler()

	// Create a map
	createReq := httptest.NewRequest(http.MethodPost, "/api/maps", strings.NewReader(`{"title":"Test Map"}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRes := httptest.NewRecorder()
	handler.ServeHTTP(createRes, createReq)

	var doc mindmap.Document
	if err := json.Unmarshal(createRes.Body.Bytes(), &doc); err != nil {
		t.Fatalf("failed to decode created document: %v", err)
	}

	// Find root node ID
	rootID := ""
	for _, n := range doc.Nodes {
		if n.Kind == mindmap.NodeKindRoot {
			rootID = n.ID
			break
		}
	}
	if rootID == "" {
		t.Fatal("no root node found")
	}

	beforeCreate := time.Now().UTC()

	// POST to create a node
	body := `{"parentId":"` + rootID + `","title":"Child Node"}`
	req := httptest.NewRequest(http.MethodPost, "/api/maps/"+doc.ID+"/nodes", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", res.Code, res.Body.String())
	}

	var created mindmap.Node
	if err := json.Unmarshal(res.Body.Bytes(), &created); err != nil {
		t.Fatalf("failed to decode created node: %v", err)
	}

	// Verify auto-completed fields
	if !strings.HasPrefix(created.ID, "node-") {
		t.Fatalf("expected id to start with 'node-', got %q", created.ID)
	}
	if created.Kind != mindmap.NodeKindTopic {
		t.Fatalf("expected default kind 'topic', got %q", created.Kind)
	}
	if created.ParentID != rootID {
		t.Fatalf("expected parentId %q, got %q", rootID, created.ParentID)
	}
	if created.Title != "Child Node" {
		t.Fatalf("expected title 'Child Node', got %q", created.Title)
	}
	if created.CreatedAt.Before(beforeCreate) {
		t.Fatalf("expected createdAt to be recent, got %v", created.CreatedAt)
	}
	if created.UpdatedAt.Before(beforeCreate) {
		t.Fatalf("expected updatedAt to be recent, got %v", created.UpdatedAt)
	}
	// Position should be calculated (X = parent.X + 280)
	if created.Position.X == 0 && created.Position.Y == 0 {
		t.Fatal("expected position to be auto-calculated, got zero position")
	}
}

func TestHandleNodesPost_Returns400ForMissingParentId(t *testing.T) {
	server := newTestServer(t)
	handler := server.Handler()

	// Create a map
	createReq := httptest.NewRequest(http.MethodPost, "/api/maps", strings.NewReader(`{"title":"Test Map"}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRes := httptest.NewRecorder()
	handler.ServeHTTP(createRes, createReq)

	var doc mindmap.Document
	if err := json.Unmarshal(createRes.Body.Bytes(), &doc); err != nil {
		t.Fatalf("failed to decode created document: %v", err)
	}

	// POST without parentId
	body := `{"title":"Orphan Node"}`
	req := httptest.NewRequest(http.MethodPost, "/api/maps/"+doc.ID+"/nodes", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", res.Code, res.Body.String())
	}
	if !strings.Contains(res.Body.String(), "parentId is required") {
		t.Fatalf("expected error about parentId, got %s", res.Body.String())
	}
}

func TestHandleNodesPost_Returns400ForMissingTitle(t *testing.T) {
	server := newTestServer(t)
	handler := server.Handler()

	// Create a map
	createReq := httptest.NewRequest(http.MethodPost, "/api/maps", strings.NewReader(`{"title":"Test Map"}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRes := httptest.NewRecorder()
	handler.ServeHTTP(createRes, createReq)

	var doc mindmap.Document
	if err := json.Unmarshal(createRes.Body.Bytes(), &doc); err != nil {
		t.Fatalf("failed to decode created document: %v", err)
	}

	// POST without title
	body := `{"parentId":"root"}`
	req := httptest.NewRequest(http.MethodPost, "/api/maps/"+doc.ID+"/nodes", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", res.Code, res.Body.String())
	}
	if !strings.Contains(res.Body.String(), "title is required") {
		t.Fatalf("expected error about title, got %s", res.Body.String())
	}
}

func TestHandleNodesPost_Returns400ForInvalidKind(t *testing.T) {
	server := newTestServer(t)
	handler := server.Handler()

	// Create a map
	createReq := httptest.NewRequest(http.MethodPost, "/api/maps", strings.NewReader(`{"title":"Test Map"}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRes := httptest.NewRecorder()
	handler.ServeHTTP(createRes, createReq)

	var doc mindmap.Document
	if err := json.Unmarshal(createRes.Body.Bytes(), &doc); err != nil {
		t.Fatalf("failed to decode created document: %v", err)
	}

	// POST with invalid kind
	body := `{"parentId":"root","title":"Bad Kind","kind":"invalid"}`
	req := httptest.NewRequest(http.MethodPost, "/api/maps/"+doc.ID+"/nodes", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", res.Code, res.Body.String())
	}
	if !strings.Contains(res.Body.String(), "invalid node kind") {
		t.Fatalf("expected error about invalid kind, got %s", res.Body.String())
	}
}

func TestHandleNodesPost_Returns404ForNonExistentMap(t *testing.T) {
	handler := newTestHandler(t)

	body := `{"parentId":"root","title":"Test"}`
	req := httptest.NewRequest(http.MethodPost, "/api/maps/nonexistent/nodes", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", res.Code, res.Body.String())
	}
}

func TestHandleNodesPost_Returns400ForNonExistentParent(t *testing.T) {
	server := newTestServer(t)
	handler := server.Handler()

	// Create a map
	createReq := httptest.NewRequest(http.MethodPost, "/api/maps", strings.NewReader(`{"title":"Test Map"}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRes := httptest.NewRecorder()
	handler.ServeHTTP(createRes, createReq)

	var doc mindmap.Document
	if err := json.Unmarshal(createRes.Body.Bytes(), &doc); err != nil {
		t.Fatalf("failed to decode created document: %v", err)
	}

	// POST with non-existent parentId
	body := `{"parentId":"nonexistent-parent","title":"Orphan"}`
	req := httptest.NewRequest(http.MethodPost, "/api/maps/"+doc.ID+"/nodes", strings.NewReader(body))
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

func TestHandleNodeByIDGet_ReturnsNodeWithAncestorsAndChildren(t *testing.T) {
	server := newTestServer(t)
	handler := server.Handler()

	// Create a map
	createReq := httptest.NewRequest(http.MethodPost, "/api/maps", strings.NewReader(`{"title":"Test Map"}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRes := httptest.NewRecorder()
	handler.ServeHTTP(createRes, createReq)

	var doc mindmap.Document
	if err := json.Unmarshal(createRes.Body.Bytes(), &doc); err != nil {
		t.Fatalf("failed to decode created document: %v", err)
	}

	rootID := ""
	for _, n := range doc.Nodes {
		if n.Kind == mindmap.NodeKindRoot {
			rootID = n.ID
			break
		}
	}

	// Create a child node under root
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

	// Create a grandchild under childA
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

	// GET the childA node by ID
	req = httptest.NewRequest(http.MethodGet, "/api/maps/"+doc.ID+"/nodes/"+childA.ID, nil)
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", res.Code, res.Body.String())
	}

	var detail struct {
		Node      mindmap.Node   `json:"node"`
		Ancestors []mindmap.Node `json:"ancestors"`
		Children  []mindmap.Node `json:"children"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &detail); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	// Verify node
	if detail.Node.ID != childA.ID {
		t.Fatalf("expected node ID %q, got %q", childA.ID, detail.Node.ID)
	}

	// Verify ancestors (should contain root)
	if len(detail.Ancestors) != 1 {
		t.Fatalf("expected 1 ancestor, got %d", len(detail.Ancestors))
	}
	if detail.Ancestors[0].ID != rootID {
		t.Fatalf("expected ancestor to be root %q, got %q", rootID, detail.Ancestors[0].ID)
	}

	// Verify children (should contain grandchild)
	if len(detail.Children) != 1 {
		t.Fatalf("expected 1 child, got %d", len(detail.Children))
	}
	if detail.Children[0].ID != grandchild.ID {
		t.Fatalf("expected child to be grandchild %q, got %q", grandchild.ID, detail.Children[0].ID)
	}
}

func TestHandleNodeByIDGet_Returns404ForNonExistentNode(t *testing.T) {
	server := newTestServer(t)
	handler := server.Handler()

	// Create a map
	createReq := httptest.NewRequest(http.MethodPost, "/api/maps", strings.NewReader(`{"title":"Test Map"}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRes := httptest.NewRecorder()
	handler.ServeHTTP(createRes, createReq)

	var doc mindmap.Document
	json.Unmarshal(createRes.Body.Bytes(), &doc)

	// GET a non-existent node
	req := httptest.NewRequest(http.MethodGet, "/api/maps/"+doc.ID+"/nodes/nonexistent-node", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", res.Code, res.Body.String())
	}
}

func TestHandleNodeByIDPatch_UpdatesOnlySpecifiedFields(t *testing.T) {
	server := newTestServer(t)
	handler := server.Handler()

	// Create a map
	createReq := httptest.NewRequest(http.MethodPost, "/api/maps", strings.NewReader(`{"title":"Test Map"}`))
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

	// Create a node
	body := `{"parentId":"` + rootID + `","title":"Original Title","note":"Original Note"}`
	req := httptest.NewRequest(http.MethodPost, "/api/maps/"+doc.ID+"/nodes", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	var created mindmap.Node
	json.Unmarshal(res.Body.Bytes(), &created)

	time.Sleep(10 * time.Millisecond) // Ensure updatedAt changes

	// PATCH only the title
	patchBody := `{"title":"Updated Title"}`
	req = httptest.NewRequest(http.MethodPatch, "/api/maps/"+doc.ID+"/nodes/"+created.ID, strings.NewReader(patchBody))
	req.Header.Set("Content-Type", "application/json")
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", res.Code, res.Body.String())
	}

	var updated mindmap.Node
	json.Unmarshal(res.Body.Bytes(), &updated)

	// Title should be updated
	if updated.Title != "Updated Title" {
		t.Fatalf("expected title 'Updated Title', got %q", updated.Title)
	}

	// Note should be preserved
	if updated.Note != "Original Note" {
		t.Fatalf("expected note 'Original Note', got %q", updated.Note)
	}

	// ID, ParentID, Kind should be unchanged
	if updated.ID != created.ID {
		t.Fatalf("expected ID %q, got %q", created.ID, updated.ID)
	}
	if updated.ParentID != created.ParentID {
		t.Fatalf("expected parentId %q, got %q", created.ParentID, updated.ParentID)
	}
	if updated.Kind != created.Kind {
		t.Fatalf("expected kind %q, got %q", created.Kind, updated.Kind)
	}

	// UpdatedAt should be newer
	if !updated.UpdatedAt.After(created.UpdatedAt) {
		t.Fatalf("expected updatedAt to be newer, got %v vs %v", updated.UpdatedAt, created.UpdatedAt)
	}
}

func TestHandleNodeByIDPatch_PreservesUnspecifiedFields(t *testing.T) {
	server := newTestServer(t)
	handler := server.Handler()

	// Create a map
	createReq := httptest.NewRequest(http.MethodPost, "/api/maps", strings.NewReader(`{"title":"Test Map"}`))
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

	// Create a node with priority and color
	body := `{"parentId":"` + rootID + `","title":"Node","priority":"P1","color":"#ff0000"}`
	req := httptest.NewRequest(http.MethodPost, "/api/maps/"+doc.ID+"/nodes", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	var created mindmap.Node
	json.Unmarshal(res.Body.Bytes(), &created)

	// PATCH only collapsed field
	patchBody := `{"collapsed":true}`
	req = httptest.NewRequest(http.MethodPatch, "/api/maps/"+doc.ID+"/nodes/"+created.ID, strings.NewReader(patchBody))
	req.Header.Set("Content-Type", "application/json")
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", res.Code, res.Body.String())
	}

	var updated mindmap.Node
	json.Unmarshal(res.Body.Bytes(), &updated)

	// All original fields should be preserved
	if updated.Title != "Node" {
		t.Fatalf("expected title 'Node', got %q", updated.Title)
	}
	if updated.Priority != mindmap.Priority1 {
		t.Fatalf("expected priority P1, got %q", updated.Priority)
	}
	if string(updated.Color) != "#ff0000" {
		t.Fatalf("expected color '#ff0000', got %q", updated.Color)
	}
	if !updated.Collapsed {
		t.Fatal("expected collapsed to be true")
	}
	// Position should be unchanged
	if updated.Position != created.Position {
		t.Fatalf("expected position %v, got %v", created.Position, updated.Position)
	}
	// CreatedAt should be unchanged
	if !updated.CreatedAt.Equal(created.CreatedAt) {
		t.Fatalf("expected createdAt %v, got %v", created.CreatedAt, updated.CreatedAt)
	}
}

func TestHandleNodeByIDPatch_Returns404ForNonExistentNode(t *testing.T) {
	server := newTestServer(t)
	handler := server.Handler()

	// Create a map
	createReq := httptest.NewRequest(http.MethodPost, "/api/maps", strings.NewReader(`{"title":"Test Map"}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRes := httptest.NewRecorder()
	handler.ServeHTTP(createRes, createReq)

	var doc mindmap.Document
	json.Unmarshal(createRes.Body.Bytes(), &doc)

	// PATCH a non-existent node
	patchBody := `{"title":"Updated"}`
	req := httptest.NewRequest(http.MethodPatch, "/api/maps/"+doc.ID+"/nodes/nonexistent-node", strings.NewReader(patchBody))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", res.Code, res.Body.String())
	}
}

func TestHandleNodeByIDDelete_CascadeTrueRemovesNodeAndDescendants(t *testing.T) {
	server := newTestServer(t)
	handler := server.Handler()

	// Create a map
	createReq := httptest.NewRequest(http.MethodPost, "/api/maps", strings.NewReader(`{"title":"Test Map"}`))
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

	// Create parent -> child -> grandchild
	body := `{"parentId":"` + rootID + `","title":"Parent"}`
	req := httptest.NewRequest(http.MethodPost, "/api/maps/"+doc.ID+"/nodes", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	var parent mindmap.Node
	json.Unmarshal(res.Body.Bytes(), &parent)

	body = `{"parentId":"` + parent.ID + `","title":"Child"}`
	req = httptest.NewRequest(http.MethodPost, "/api/maps/"+doc.ID+"/nodes", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	var child mindmap.Node
	json.Unmarshal(res.Body.Bytes(), &child)

	body = `{"parentId":"` + child.ID + `","title":"Grandchild"}`
	req = httptest.NewRequest(http.MethodPost, "/api/maps/"+doc.ID+"/nodes", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	// DELETE parent with cascade=true (default)
	req = httptest.NewRequest(http.MethodDelete, "/api/maps/"+doc.ID+"/nodes/"+parent.ID, nil)
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", res.Code, res.Body.String())
	}

	var deleteResp map[string]interface{}
	json.Unmarshal(res.Body.Bytes(), &deleteResp)

	if deleteResp["status"] != "deleted" {
		t.Fatalf("expected status 'deleted', got %v", deleteResp["status"])
	}
	// Should delete parent + child + grandchild = 3
	if deleteResp["deletedCount"].(float64) != 3 {
		t.Fatalf("expected deletedCount 3, got %v", deleteResp["deletedCount"])
	}

	// Verify nodes are gone
	req = httptest.NewRequest(http.MethodGet, "/api/maps/"+doc.ID+"/nodes", nil)
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	var nodes []mindmap.Node
	json.Unmarshal(res.Body.Bytes(), &nodes)

	for _, n := range nodes {
		if n.ID == parent.ID || n.ID == child.ID {
			t.Fatalf("expected node %q to be deleted", n.ID)
		}
	}
}

func TestHandleNodeByIDDelete_CascadeFalseReparentsChildren(t *testing.T) {
	server := newTestServer(t)
	handler := server.Handler()

	// Create a map
	createReq := httptest.NewRequest(http.MethodPost, "/api/maps", strings.NewReader(`{"title":"Test Map"}`))
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

	// Create parent -> child1, child2
	body := `{"parentId":"` + rootID + `","title":"Parent"}`
	req := httptest.NewRequest(http.MethodPost, "/api/maps/"+doc.ID+"/nodes", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	var parent mindmap.Node
	json.Unmarshal(res.Body.Bytes(), &parent)

	body = `{"parentId":"` + parent.ID + `","title":"Child 1"}`
	req = httptest.NewRequest(http.MethodPost, "/api/maps/"+doc.ID+"/nodes", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	var child1 mindmap.Node
	json.Unmarshal(res.Body.Bytes(), &child1)

	body = `{"parentId":"` + parent.ID + `","title":"Child 2"}`
	req = httptest.NewRequest(http.MethodPost, "/api/maps/"+doc.ID+"/nodes", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	var child2 mindmap.Node
	json.Unmarshal(res.Body.Bytes(), &child2)

	// DELETE parent with cascade=false
	req = httptest.NewRequest(http.MethodDelete, "/api/maps/"+doc.ID+"/nodes/"+parent.ID+"?cascade=false", nil)
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", res.Code, res.Body.String())
	}

	var deleteResp map[string]interface{}
	json.Unmarshal(res.Body.Bytes(), &deleteResp)

	if deleteResp["status"] != "deleted" {
		t.Fatalf("expected status 'deleted', got %v", deleteResp["status"])
	}
	if deleteResp["deletedCount"].(float64) != 1 {
		t.Fatalf("expected deletedCount 1, got %v", deleteResp["deletedCount"])
	}

	// Verify children are re-parented to root
	req = httptest.NewRequest(http.MethodGet, "/api/maps/"+doc.ID+"/nodes", nil)
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	var nodes []mindmap.Node
	json.Unmarshal(res.Body.Bytes(), &nodes)

	for _, n := range nodes {
		if n.ID == child1.ID || n.ID == child2.ID {
			if n.ParentID != rootID {
				t.Fatalf("expected child %q to be re-parented to root %q, got %q", n.ID, rootID, n.ParentID)
			}
		}
		if n.ID == parent.ID {
			t.Fatal("expected parent node to be deleted")
		}
	}
}

func TestHandleNodeByIDDelete_Returns400ForRootNode(t *testing.T) {
	server := newTestServer(t)
	handler := server.Handler()

	// Create a map
	createReq := httptest.NewRequest(http.MethodPost, "/api/maps", strings.NewReader(`{"title":"Test Map"}`))
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

	// Try to DELETE root node
	req := httptest.NewRequest(http.MethodDelete, "/api/maps/"+doc.ID+"/nodes/"+rootID, nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", res.Code, res.Body.String())
	}
	if !strings.Contains(res.Body.String(), "cannot delete root node") {
		t.Fatalf("expected error about root node, got %s", res.Body.String())
	}
}

func TestHandleNodeByIDDelete_PrunesRelationsReferencingDeletedNode(t *testing.T) {
	server := newTestServer(t)
	handler := server.Handler()

	doc := mindmap.NewDefaultDocument()
	doc.ID = "relation-delete"
	now := time.Now().UTC()
	doc.Nodes = append(doc.Nodes,
		mindmap.Node{ID: "node-a", ParentID: "root", Kind: mindmap.NodeKindTopic, Title: "A", Position: mindmap.Position{X: 1100, Y: 280}, CreatedAt: now, UpdatedAt: now},
		mindmap.Node{ID: "node-b", ParentID: "root", Kind: mindmap.NodeKindTopic, Title: "B", Position: mindmap.Position{X: 1100, Y: 380}, CreatedAt: now, UpdatedAt: now},
		mindmap.Node{ID: "node-c", ParentID: "root", Kind: mindmap.NodeKindTopic, Title: "C", Position: mindmap.Position{X: 1100, Y: 480}, CreatedAt: now, UpdatedAt: now},
	)
	doc.Relations = append(doc.Relations,
		mindmap.RelationEdge{ID: "rel-ab", SourceID: "node-a", TargetID: "node-b", Label: "blocked", CreatedAt: now, UpdatedAt: now},
		mindmap.RelationEdge{
			ID:        "rel-ac",
			SourceID:  "node-a",
			TargetID:  "node-c",
			Branches:  []mindmap.RelationBranch{{TargetID: "node-b"}},
			CreatedAt: now,
			UpdatedAt: now,
		},
	)
	if err := server.store.Save(doc); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/maps/relation-delete/nodes/node-b", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", res.Code, res.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/maps/relation-delete", nil)
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	var loaded mindmap.Document
	if err := json.Unmarshal(res.Body.Bytes(), &loaded); err != nil {
		t.Fatalf("failed to decode loaded document: %v", err)
	}
	if len(loaded.Relations) != 1 {
		t.Fatalf("expected dangling relation to be removed, got %d relation(s)", len(loaded.Relations))
	}
	if loaded.Relations[0].ID != "rel-ac" {
		t.Fatalf("expected surviving relation rel-ac, got %q", loaded.Relations[0].ID)
	}
	if len(loaded.Relations[0].Branches) != 0 {
		t.Fatalf("expected dangling branch target to be removed, got %+v", loaded.Relations[0].Branches)
	}
}

func TestHandleNodesGet_CompactOmitsPositionAndTimestamps(t *testing.T) {
	server := newTestServer(t)
	handler := server.Handler()

	// Create a map
	createReq := httptest.NewRequest(http.MethodPost, "/api/maps", strings.NewReader(`{"title":"Test Map"}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRes := httptest.NewRecorder()
	handler.ServeHTTP(createRes, createReq)

	var doc mindmap.Document
	if err := json.Unmarshal(createRes.Body.Bytes(), &doc); err != nil {
		t.Fatalf("failed to decode created document: %v", err)
	}

	rootID := ""
	for _, n := range doc.Nodes {
		if n.Kind == mindmap.NodeKindRoot {
			rootID = n.ID
			break
		}
	}

	// Create a child node
	body := `{"parentId":"` + rootID + `","title":"Child Node","priority":"P1"}`
	req := httptest.NewRequest(http.MethodPost, "/api/maps/"+doc.ID+"/nodes", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d", res.Code)
	}

	// GET nodes with compact=true
	req = httptest.NewRequest(http.MethodGet, "/api/maps/"+doc.ID+"/nodes?compact=true", nil)
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", res.Code, res.Body.String())
	}

	// Parse as raw JSON to check field presence
	var nodes []map[string]interface{}
	if err := json.Unmarshal(res.Body.Bytes(), &nodes); err != nil {
		t.Fatalf("failed to decode compact nodes: %v", err)
	}

	if len(nodes) < 2 {
		t.Fatalf("expected at least 2 nodes, got %d", len(nodes))
	}

	for _, n := range nodes {
		// position, createdAt, updatedAt should be absent
		if _, ok := n["position"]; ok {
			t.Fatalf("compact node should not have 'position' field, got %v", n)
		}
		if _, ok := n["createdAt"]; ok {
			t.Fatalf("compact node should not have 'createdAt' field, got %v", n)
		}
		if _, ok := n["updatedAt"]; ok {
			t.Fatalf("compact node should not have 'updatedAt' field, got %v", n)
		}

		// "topic" kind should be omitted
		if kind, ok := n["kind"]; ok {
			if kind == "topic" {
				t.Fatalf("compact node should omit 'topic' kind, got %v", n)
			}
		}

		// id and title should still be present
		if _, ok := n["id"]; !ok {
			t.Fatalf("compact node should have 'id' field")
		}
		if _, ok := n["title"]; !ok {
			t.Fatalf("compact node should have 'title' field")
		}
	}

	// Verify the root node has kind "root" (non-default, should be present)
	foundRoot := false
	for _, n := range nodes {
		if n["kind"] == "root" {
			foundRoot = true
			break
		}
	}
	if !foundRoot {
		t.Fatal("expected root node to retain 'root' kind in compact mode")
	}
}

func TestHandleNodesGet_CompactFalseReturnsFullResponse(t *testing.T) {
	server := newTestServer(t)
	handler := server.Handler()

	// Create a map
	createReq := httptest.NewRequest(http.MethodPost, "/api/maps", strings.NewReader(`{"title":"Test Map"}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRes := httptest.NewRecorder()
	handler.ServeHTTP(createRes, createReq)

	var doc mindmap.Document
	json.Unmarshal(createRes.Body.Bytes(), &doc)

	// GET nodes without compact (default behavior)
	req := httptest.NewRequest(http.MethodGet, "/api/maps/"+doc.ID+"/nodes", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	var nodes []map[string]interface{}
	json.Unmarshal(res.Body.Bytes(), &nodes)

	// Full response should have position, createdAt, updatedAt
	for _, n := range nodes {
		if _, ok := n["position"]; !ok {
			t.Fatalf("full node should have 'position' field")
		}
		if _, ok := n["createdAt"]; !ok {
			t.Fatalf("full node should have 'createdAt' field")
		}
		if _, ok := n["updatedAt"]; !ok {
			t.Fatalf("full node should have 'updatedAt' field")
		}
	}
}

func TestHandleNodeTree_CompactOmitsPositionAndTimestamps(t *testing.T) {
	server := newTestServer(t)
	handler := server.Handler()

	// Create a map
	createReq := httptest.NewRequest(http.MethodPost, "/api/maps", strings.NewReader(`{"title":"Test Map"}`))
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

	// Create a child
	body := `{"parentId":"` + rootID + `","title":"Child"}`
	req := httptest.NewRequest(http.MethodPost, "/api/maps/"+doc.ID+"/nodes", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	// GET tree with compact=true
	req = httptest.NewRequest(http.MethodGet, "/api/maps/"+doc.ID+"/tree?compact=true", nil)
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", res.Code, res.Body.String())
	}

	var tree map[string]interface{}
	if err := json.Unmarshal(res.Body.Bytes(), &tree); err != nil {
		t.Fatalf("failed to decode compact tree: %v", err)
	}

	// Root should not have position/timestamps
	if _, ok := tree["position"]; ok {
		t.Fatal("compact tree root should not have 'position'")
	}
	if _, ok := tree["createdAt"]; ok {
		t.Fatal("compact tree root should not have 'createdAt'")
	}
	if _, ok := tree["updatedAt"]; ok {
		t.Fatal("compact tree root should not have 'updatedAt'")
	}

	// Root kind should be "root" (non-default)
	if tree["kind"] != "root" {
		t.Fatalf("expected root kind 'root', got %v", tree["kind"])
	}

	// Check children
	children, ok := tree["children"].([]interface{})
	if !ok || len(children) == 0 {
		t.Fatal("expected at least one child in compact tree")
	}

	child := children[0].(map[string]interface{})
	if _, ok := child["position"]; ok {
		t.Fatal("compact tree child should not have 'position'")
	}
	if _, ok := child["createdAt"]; ok {
		t.Fatal("compact tree child should not have 'createdAt'")
	}
	// "topic" kind should be omitted
	if kind, ok := child["kind"]; ok && kind == "topic" {
		t.Fatal("compact tree child should omit 'topic' kind")
	}
}

func TestHandleNodeByIDGet_CompactOmitsPositionAndTimestamps(t *testing.T) {
	server := newTestServer(t)
	handler := server.Handler()

	// Create a map
	createReq := httptest.NewRequest(http.MethodPost, "/api/maps", strings.NewReader(`{"title":"Test Map"}`))
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

	// Create parent -> child
	body := `{"parentId":"` + rootID + `","title":"Parent"}`
	req := httptest.NewRequest(http.MethodPost, "/api/maps/"+doc.ID+"/nodes", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	var parent mindmap.Node
	json.Unmarshal(res.Body.Bytes(), &parent)

	body = `{"parentId":"` + parent.ID + `","title":"Child"}`
	req = httptest.NewRequest(http.MethodPost, "/api/maps/"+doc.ID+"/nodes", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	// GET node detail with compact=true
	req = httptest.NewRequest(http.MethodGet, "/api/maps/"+doc.ID+"/nodes/"+parent.ID+"?compact=true", nil)
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", res.Code, res.Body.String())
	}

	var detail map[string]interface{}
	json.Unmarshal(res.Body.Bytes(), &detail)

	// Check the node field
	node := detail["node"].(map[string]interface{})
	if _, ok := node["position"]; ok {
		t.Fatal("compact node detail should not have 'position'")
	}
	if _, ok := node["createdAt"]; ok {
		t.Fatal("compact node detail should not have 'createdAt'")
	}
	if _, ok := node["updatedAt"]; ok {
		t.Fatal("compact node detail should not have 'updatedAt'")
	}

	// Check ancestors
	ancestors := detail["ancestors"].([]interface{})
	if len(ancestors) == 0 {
		t.Fatal("expected at least one ancestor")
	}
	ancestor := ancestors[0].(map[string]interface{})
	if _, ok := ancestor["position"]; ok {
		t.Fatal("compact ancestor should not have 'position'")
	}
	if _, ok := ancestor["createdAt"]; ok {
		t.Fatal("compact ancestor should not have 'createdAt'")
	}

	// Check children
	children := detail["children"].([]interface{})
	if len(children) == 0 {
		t.Fatal("expected at least one child")
	}
	child := children[0].(map[string]interface{})
	if _, ok := child["position"]; ok {
		t.Fatal("compact child should not have 'position'")
	}
	if _, ok := child["createdAt"]; ok {
		t.Fatal("compact child should not have 'createdAt'")
	}
}
