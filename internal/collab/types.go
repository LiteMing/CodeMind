package collab

import "code-mind/internal/store"

const (
	DefaultAddress = "127.0.0.1:34118"
	WSPath         = "/ws"

	CloseAuthFailed   = 4001
	CloseTokenRevoked = 4002
	CloseForbidden    = 4003
	CloseRoomFull     = 4004
)

type Message struct {
	Type        string         `json:"type"`
	MapID       string         `json:"mapId,omitempty"`
	Token       string         `json:"token,omitempty"`
	Operation   string         `json:"operation,omitempty"`
	NodeID      string         `json:"nodeId,omitempty"`
	SeqNum      uint64         `json:"seqNum,omitempty"`
	Payload     map[string]any `json:"payload,omitempty"`
	Error       string         `json:"error,omitempty"`
	AccessLevel string         `json:"accessLevel,omitempty"`
	DisplayName string         `json:"displayName,omitempty"`
}

type Session struct {
	TokenID     string
	Secret      string
	MapID       string
	AccessLevel string
	DisplayName string
}

func sessionFromToken(secret string, token *store.Token) Session {
	return Session{
		TokenID:     token.ID,
		Secret:      secret,
		MapID:       token.MapID,
		AccessLevel: token.AccessLevel,
		DisplayName: token.DisplayName,
	}
}

func isWriteMessage(msg Message) bool {
	switch msg.Type {
	case "create", "update", "delete", "operation", "batch", "import_fragment":
		return true
	default:
		return false
	}
}
