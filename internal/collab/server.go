package collab

import (
	"context"
	"net/http"

	"code-mind/internal/store"
	"github.com/gorilla/websocket"
)

type Server struct {
	addr   string
	http   *http.Server
	hub    *Hub
	auth   Authenticator
	upgrad websocket.Upgrader
}

func NewServer(addr string, tokenStore *store.TokenStore) *Server {
	if addr == "" {
		addr = DefaultAddress
	}
	s := &Server{
		addr: addr,
		hub:  NewHub(),
		auth: Authenticator{TokenStore: tokenStore},
		upgrad: websocket.Upgrader{
			CheckOrigin: func(*http.Request) bool { return true },
		},
	}
	mux := http.NewServeMux()
	mux.HandleFunc(WSPath, s.handleWS)
	s.http = &http.Server{Addr: addr, Handler: mux}
	return s
}

func (s *Server) ListenAndServe() error {
	return s.http.ListenAndServe()
}

func (s *Server) Shutdown(ctx context.Context) error {
	return s.http.Shutdown(ctx)
}

func (s *Server) Hub() *Hub {
	return s.hub
}

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := s.upgrad.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	session, err := s.auth.AuthenticateConn(conn, r.URL.Query().Get("token"))
	if err != nil {
		_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(CloseAuthFailed, "authentication failed"), deadline())
		_ = conn.Close()
		return
	}

	mapID := r.URL.Query().Get("mapId")
	if mapID == "" {
		mapID = session.MapID
	}
	if mapID == "" || (session.MapID != "" && session.MapID != mapID && session.AccessLevel != "owner") {
		_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(CloseForbidden, "map access denied"), deadline())
		_ = conn.Close()
		return
	}
	session.MapID = mapID

	client := NewClient(conn, s.hub, session)
	if !s.hub.Join(mapID, client) {
		_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(CloseRoomFull, "room full"), deadline())
		_ = conn.Close()
		return
	}

	client.Send(Message{Type: "ready", MapID: mapID, AccessLevel: session.AccessLevel, DisplayName: session.DisplayName})
	client.Run()
}
