package collab

import (
	"path/filepath"
	"testing"

	"code-mind/internal/store"
)

func TestAuthenticatorRejectsMissingToken(t *testing.T) {
	auth := Authenticator{}
	if _, err := auth.Validate(""); err == nil {
		t.Fatal("expected missing token to fail")
	}
}

func TestAuthenticatorReturnsSessionForValidToken(t *testing.T) {
	dir := t.TempDir()
	tokens, err := store.NewTokenStore(filepath.Join(dir, "tokens.json"))
	if err != nil {
		t.Fatal(err)
	}
	token, err := tokens.Create("map1", "viewer", "Alice", nil)
	if err != nil {
		t.Fatal(err)
	}

	session, err := (Authenticator{TokenStore: tokens}).Validate(token.Secret)
	if err != nil {
		t.Fatal(err)
	}
	if session.MapID != "map1" || session.AccessLevel != "viewer" || session.DisplayName != "Alice" {
		t.Fatalf("unexpected session: %+v", session)
	}
}

func TestViewerWriteMessageDetection(t *testing.T) {
	writes := []string{"create", "update", "delete", "operation", "batch", "import_fragment"}
	for _, typ := range writes {
		if !isWriteMessage(Message{Type: typ}) {
			t.Fatalf("%s should be write message", typ)
		}
	}
	if isWriteMessage(Message{Type: "presence"}) {
		t.Fatal("presence should not be write message")
	}
}
