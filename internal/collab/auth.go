package collab

import (
	"errors"
	"time"

	"code-mind/internal/store"
	"github.com/gorilla/websocket"
)

var ErrAuthRequired = errors.New("authentication required")

type Authenticator struct {
	TokenStore *store.TokenStore
}

func (a Authenticator) Validate(secret string) (Session, error) {
	if secret == "" || a.TokenStore == nil {
		return Session{}, ErrAuthRequired
	}
	token, err := a.TokenStore.Validate(secret)
	if err != nil {
		return Session{}, err
	}
	return sessionFromToken(secret, token), nil
}

func (a Authenticator) AuthenticateConn(conn *websocket.Conn, queryToken string) (Session, error) {
	if queryToken != "" {
		return a.Validate(queryToken)
	}

	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	var msg Message
	if err := conn.ReadJSON(&msg); err != nil {
		return Session{}, err
	}
	_ = conn.SetReadDeadline(time.Time{})
	if msg.Type != "auth" {
		return Session{}, ErrAuthRequired
	}
	return a.Validate(msg.Token)
}
