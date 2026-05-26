package collab

import "sync"

const MaxClientsPerRoom = 20

type Hub struct {
	mu    sync.RWMutex
	rooms map[string]map[*Client]struct{}
}

func NewHub() *Hub {
	return &Hub{rooms: make(map[string]map[*Client]struct{})}
}

func (h *Hub) Join(mapID string, client *Client) bool {
	h.mu.Lock()
	defer h.mu.Unlock()

	room := h.rooms[mapID]
	if room == nil {
		room = make(map[*Client]struct{})
		h.rooms[mapID] = room
	}
	if len(room) >= MaxClientsPerRoom {
		return false
	}
	room[client] = struct{}{}
	return true
}

func (h *Hub) Leave(mapID string, client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	room := h.rooms[mapID]
	if room == nil {
		return
	}
	delete(room, client)
	if len(room) == 0 {
		delete(h.rooms, mapID)
	}
}

func (h *Hub) Broadcast(mapID string, sender *Client, msg Message) {
	h.mu.RLock()
	room := h.rooms[mapID]
	clients := make([]*Client, 0, len(room))
	for client := range room {
		if client != sender {
			clients = append(clients, client)
		}
	}
	h.mu.RUnlock()

	for _, client := range clients {
		client.Send(msg)
	}
}

func (h *Hub) Count(mapID string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.rooms[mapID])
}
