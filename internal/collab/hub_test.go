package collab

import "testing"

func TestHubRejectsTwentyFirstClient(t *testing.T) {
	hub := NewHub()
	for i := 0; i < MaxClientsPerRoom; i++ {
		if !hub.Join("map1", &Client{}) {
			t.Fatalf("client %d should be accepted", i)
		}
	}
	if hub.Join("map1", &Client{}) {
		t.Fatal("21st client should be rejected")
	}
	if got := hub.Count("map1"); got != MaxClientsPerRoom {
		t.Fatalf("expected %d clients, got %d", MaxClientsPerRoom, got)
	}
}

func TestHubBroadcastIsolationByMapID(t *testing.T) {
	hub := NewHub()
	sender := &Client{}
	sameRoom := &Client{send: make(chan Message, 1)}
	otherRoom := &Client{send: make(chan Message, 1)}

	hub.Join("map1", sender)
	hub.Join("map1", sameRoom)
	hub.Join("map2", otherRoom)
	hub.Broadcast("map1", sender, Message{Type: "update"})

	select {
	case msg := <-sameRoom.send:
		if msg.Type != "update" {
			t.Fatalf("expected update, got %s", msg.Type)
		}
	default:
		t.Fatal("same room client should receive broadcast")
	}

	select {
	case <-otherRoom.send:
		t.Fatal("other room client should not receive broadcast")
	default:
	}
}
