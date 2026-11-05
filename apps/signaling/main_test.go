package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestRooms(t *testing.T) {
	service := newService()
	server := httptest.NewTLSServer(service)
	t.Cleanup(server.Close)
	t.Cleanup(service.close)
	url := "wss" + strings.TrimPrefix(server.URL, "https") + "/ws"
	if conn, _, err := websocket.DefaultDialer.Dial(url, nil); err == nil {
		conn.Close()
		t.Fatal("an untrusted test certificate was accepted")
	}
	dialer := websocket.Dialer{TLSClientConfig: server.Client().Transport.(*http.Transport).TLSClientConfig}
	connect := func() (*websocket.Conn, string) {
		c, _, err := dialer.Dial(url, nil)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { c.Close() })
		return c, receive(t, c, "session.ready")["peerId"].(string)
	}
	a, aid := connect()
	b, bid := connect()
	outsider, oid := connect()
	send(t, a, message{"type": "room.create", "nickname": "Host"})
	invite := receive(t, a, "room.created")
	receive(t, a, "room.snapshot")
	send(t, b, message{"type": "room.join", "roomId": invite["roomId"], "token": strings.Repeat("0", 32), "nickname": "Guest"})
	expectError(t, b, "INVALID_INVITE")
	send(t, b, message{"type": "room.join", "roomId": invite["roomId"], "token": invite["token"], "nickname": "Guest"})
	receive(t, b, "room.pending")
	receive(t, a, "room.joinRequested")
	send(t, b, message{"type": "share.request"})
	expectError(t, b, "NOT_JOINED")
	send(t, a, message{"type": "room.admit", "peerId": bid, "allow": true})
	receive(t, b, "room.joined")
	receive(t, b, "room.snapshot")
	receive(t, a, "room.snapshot")
	send(t, outsider, message{"type": "room.create", "nickname": "Outsider"})
	receive(t, outsider, "room.created")
	send(t, a, message{"type": "rtc.candidate", "targetPeerId": oid, "generation": 1, "candidate": nil})
	expectError(t, a, "PEER_NOT_FOUND")
	send(t, a, message{"type": "rtc.candidate", "targetPeerId": bid, "generation": 1, "candidate": nil})
	if receive(t, b, "rtc.candidate")["fromPeerId"] != aid {
		t.Fatal("incorrect sender")
	}
	send(t, a, message{"type": "share.request"})
	lease := receive(t, a, "room.snapshot")
	receive(t, b, "room.snapshot")
	send(t, b, message{"type": "share.request"})
	expectError(t, b, "SHARE_BUSY")
	send(t, a, message{"type": "share.stopped", "version": lease["shareVersion"].(float64) - 1})
	expectError(t, a, "STALE_SHARE")
	send(t, a, message{"type": "room.leave"})
	receive(t, a, "room.left")
	after := receive(t, b, "room.snapshot")
	if after["ownerPeerId"] != bid || after["sharingPeerId"] != nil {
		t.Fatal("incorrect owner or share state after departure")
	}
}

func TestLimits(t *testing.T) {
	s := newService()
	server := httptest.NewServer(s)
	defer server.Close()
	defer s.close()
	url := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws"
	if c, r, err := websocket.DefaultDialer.Dial(url, http.Header{"Origin": []string{"https://example.invalid"}}); err == nil || r == nil || r.StatusCode != 403 {
		if c != nil {
			c.Close()
		}
		t.Fatal("browser origin should be refused")
	}
	for _, tc := range []struct{ size, code int }{{65537, 1009}, {0, 1008}} {
		c, _, err := websocket.DefaultDialer.Dial(url, nil)
		if err != nil {
			t.Fatal(err)
		}
		receive(t, c, "session.ready")
		if tc.size > 0 {
			c.WriteMessage(websocket.TextMessage, []byte(strings.Repeat("x", tc.size)))
		} else {
			for i := 0; i < 40; i++ {
				send(t, c, message{"type": "ping"})
				receive(t, c, "pong")
			}
			send(t, c, message{"type": "ping"})
		}
		c.SetReadDeadline(time.Now().Add(2 * time.Second))
		for {
			if _, _, err := c.ReadMessage(); err != nil {
				if !websocket.IsCloseError(err, tc.code) {
					t.Fatal(err)
				}
				break
			}
		}
		c.Close()
	}
}

func send(t *testing.T, c *websocket.Conn, payload message) {
	t.Helper()
	if err := c.WriteJSON(message{"v": 1, "messageId": identifier(), "payload": payload}); err != nil {
		t.Fatal(err)
	}
}
func receive(t *testing.T, c *websocket.Conn, kind string) message {
	t.Helper()
	c.SetReadDeadline(time.Now().Add(2 * time.Second))
	var m message
	if err := c.ReadJSON(&m); err != nil {
		t.Fatal(err)
	}
	if m["type"] != kind {
		t.Fatalf("got %v, expected %s", m["type"], kind)
	}
	return m
}
func expectError(t *testing.T, c *websocket.Conn, code string) {
	t.Helper()
	if m := receive(t, c, "error"); m["code"] != code {
		t.Fatalf("got %v, expected %s", m["code"], code)
	}
}

func TestRoomExpiryAndCapacity(t *testing.T) {
	s := newService()
	makePeer := func() *peer {
		return &peer{id: identifier(), output: make(chan []byte, 32), stop: func() {}}
	}
	owner := makePeer()
	s.handle(owner, request{Kind: "room.create", Nickname: "Owner"})
	room := owner.room
	join := func(p *peer) {
		s.handle(p, request{Kind: "room.join", Room: room.id, Token: room.token, Nickname: "Guest"})
	}
	pending := makePeer()
	join(pending)
	s.sweep(pending.pendingAt.Add(time.Minute))
	if pending.pending != nil || len(room.pending) != 0 {
		t.Fatal("expired request retained")
	}
	for i := 0; i < 3; i++ {
		p := makePeer()
		join(p)
		s.handle(owner, request{Kind: "room.admit", Peer: p.id, Allow: true})
		if p.room != room {
			t.Fatal("valid guest was not admitted")
		}
	}
	extra := makePeer()
	join(extra)
	var result message
	if err := json.Unmarshal(<-extra.output, &result); err != nil || result["code"] != "ROOM_FULL" {
		t.Fatalf("expected ROOM_FULL, got %v", result)
	}
	for len(room.members) > 0 {
		room.members[0].leave()
	}
	s.sweep(room.emptyAt.Add(10 * time.Minute))
	if _, ok := s.rooms[room.id]; ok {
		t.Fatal("empty room retained")
	}
}

func TestProtocol(t *testing.T) {
	raw, err := os.ReadFile("../../packages/protocol/fixtures/v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Valid   bool
		Message json.RawMessage
	}
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	for i, fixture := range fixtures {
		if _, ok := parse(fixture.Message); ok != fixture.Valid {
			t.Errorf("fixture %d: valid=%v, want %v", i, ok, fixture.Valid)
		}
	}
	for _, tc := range []struct {
		payload string
		valid   bool
	}{
		{`{"type":"room.create","nickname":"  房主 "}`, true},
		{`{"type":"room.create","nickname":null}`, false},
		{`{"type":"room.admit","peerId":"00000000-0000-0000-0000-000000000000","allow":null}`, false},
		{`{"type":"ping","senderPeerId":"spoof"}`, false},
		{`{"type":"share.stopped","version":1.0}`, true},
		{`{"type":"share.stopped","version":null}`, false},
		{`{"type":"rtc.candidate","targetPeerId":"00000000-0000-0000-0000-000000000000","generation":0,"candidate":null}`, true},
		{`{"type":"rtc.candidate","targetPeerId":"00000000-0000-0000-0000-000000000000","generation":0,"candidate":{"candidate":"","sdpMid":null}}`, false},
	} {
		data, _ := json.Marshal(message{"v": 1, "messageId": identifier(), "payload": json.RawMessage(tc.payload)})
		if _, ok := parse(data); ok != tc.valid {
			t.Errorf("valid=%v for %s, want %v", ok, tc.payload, tc.valid)
		}
	}
}
