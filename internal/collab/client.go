package collab

import (
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait  = 10 * time.Second
	pongWait   = 10 * time.Second
	pingPeriod = 30 * time.Second
)

type Client struct {
	conn    *websocket.Conn
	hub     *Hub
	session Session
	send    chan Message
	done    chan struct{}
}

func NewClient(conn *websocket.Conn, hub *Hub, session Session) *Client {
	return &Client{
		conn:    conn,
		hub:     hub,
		session: session,
		send:    make(chan Message, 32),
		done:    make(chan struct{}),
	}
}

func (c *Client) Run() {
	go c.writeLoop()
	c.readLoop()
}

func (c *Client) Send(msg Message) {
	select {
	case c.send <- msg:
	default:
	}
}

func (c *Client) close() {
	select {
	case <-c.done:
		return
	default:
		close(c.done)
		c.hub.Leave(c.session.MapID, c)
		_ = c.conn.Close()
	}
}

func (c *Client) readLoop() {
	defer c.close()
	_ = c.conn.SetReadDeadline(time.Now().Add(pingPeriod + pongWait))
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(pingPeriod + pongWait))
	})

	for {
		var msg Message
		if err := c.conn.ReadJSON(&msg); err != nil {
			return
		}
		if isWriteMessage(msg) && c.session.AccessLevel == "viewer" {
			c.Send(Message{Type: "error", Error: "insufficient access level"})
			continue
		}
		if msg.MapID == "" {
			msg.MapID = c.session.MapID
		}
		c.hub.Broadcast(c.session.MapID, c, msg)
	}
}

func (c *Client) writeLoop() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.close()
	}()

	for {
		select {
		case msg := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteJSON(msg); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		case <-c.done:
			return
		}
	}
}
