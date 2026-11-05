package main

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"slices"
	"time"
)

type message map[string]any

type peer struct {
	id, nickname  string
	room, pending *room
	pendingAt     time.Time
	output        chan []byte
	stop          func()
}

type room struct {
	id, token string
	members   []*peer
	pending   map[string]*peer
	sharer    *peer
	version   int
	emptyAt   time.Time
}

func identifier() string {
	var data [16]byte
	rand.Read(data[:])
	data[6] = data[6]&15 | 64
	data[8] = data[8]&63 | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", data[:4], data[4:6], data[6:8], data[8:10], data[10:])
}

func (p *peer) send(kind string, body message) {
	body["v"], body["type"] = 1, kind
	data, err := json.Marshal(body)
	if err != nil {
		p.stop()
		return
	}
	select {
	case p.output <- data:
	default:
		p.stop()
	}
}

func (p *peer) fail(code, id string) {
	body := message{"code": code}
	if id != "" {
		body["messageId"] = id
	}
	p.send("error", body)
}

func (r *room) snapshot() {
	members := make([]message, 0, len(r.members))
	for _, p := range r.members {
		members = append(members, message{"peerId": p.id, "nickname": p.nickname})
	}
	var sharing any
	if r.sharer != nil {
		sharing = r.sharer.id
	}
	for _, p := range r.members {
		p.send("room.snapshot", message{"roomId": r.id, "ownerPeerId": r.members[0].id, "peers": members, "sharingPeerId": sharing, "shareVersion": r.version})
	}
}

func (p *peer) leave() {
	if p.pending != nil {
		delete(p.pending.pending, p.id)
		p.pending = nil
	}
	r := p.room
	if r == nil {
		return
	}
	owner := r.members[0] == p
	p.room = nil
	r.members = slices.DeleteFunc(r.members, func(member *peer) bool { return member == p })
	if r.sharer == p {
		r.sharer = nil
		r.version++
	}
	if owner {
		for _, pending := range r.pending {
			pending.pending = nil
			pending.fail("OWNER_CHANGED", "")
		}
		clear(r.pending)
	}
	if len(r.members) == 0 {
		r.emptyAt = time.Now()
		return
	}
	r.snapshot()
}

func (s *service) handle(p *peer, q request) {
	fail := func(code string) { p.fail(code, q.ID) }
	switch q.Kind {
	case "ping":
		p.send("pong", message{"messageId": q.ID})
	case "room.leave":
		p.leave()
		p.send("room.left", message{"messageId": q.ID})
	case "room.create":
		if p.room != nil || p.pending != nil {
			fail("ALREADY_JOINED")
			return
		}
		if len(s.rooms) >= 32 {
			fail("SERVER_FULL")
			return
		}
		var key [16]byte
		rand.Read(key[:])
		r := &room{id: identifier(), token: hex.EncodeToString(key[:]), members: []*peer{p}, pending: make(map[string]*peer)}
		p.room, p.nickname = r, q.Nickname
		s.rooms[r.id] = r
		p.send("room.created", message{"messageId": q.ID, "roomId": r.id, "token": r.token})
		r.snapshot()
	case "room.join":
		if p.room != nil || p.pending != nil {
			fail("ALREADY_JOINED")
			return
		}
		r := s.rooms[q.Room]
		if r == nil || len(r.members) == 0 || subtle.ConstantTimeCompare([]byte(q.Token), []byte(r.token)) != 1 {
			fail("INVALID_INVITE")
			return
		}
		if len(r.members) >= 4 {
			fail("ROOM_FULL")
			return
		}
		if len(r.pending) >= 16 {
			fail("PENDING_FULL")
			return
		}
		p.pending, p.pendingAt, p.nickname = r, time.Now(), q.Nickname
		r.pending[p.id] = p
		p.send("room.pending", message{"messageId": q.ID, "roomId": r.id})
		r.members[0].send("room.joinRequested", message{"peerId": p.id, "nickname": p.nickname})
	default:
		r := p.room
		if r == nil {
			fail("NOT_JOINED")
			return
		}
		switch q.Kind {
		case "room.admit":
			if r.members[0] != p {
				fail("FORBIDDEN")
				return
			}
			candidate := r.pending[q.Peer]
			if candidate == nil {
				fail("PEER_NOT_FOUND")
				return
			}
			delete(r.pending, candidate.id)
			candidate.pending = nil
			if !q.Allow {
				candidate.fail("JOIN_REJECTED", "")
				return
			}
			if len(r.members) >= 4 {
				candidate.fail("ROOM_FULL", "")
				return
			}
			candidate.room = r
			r.members = append(r.members, candidate)
			candidate.send("room.joined", message{"roomId": r.id})
			r.snapshot()
		case "share.request":
			if r.sharer != nil && r.sharer != p {
				fail("SHARE_BUSY")
				return
			}
			if r.sharer == nil {
				r.sharer = p
				r.version++
			}
			r.snapshot()
		case "share.stopped":
			if r.sharer != p || q.Version != r.version {
				fail("STALE_SHARE")
				return
			}
			r.sharer = nil
			r.version++
			r.snapshot()
		case "rtc.description", "rtc.candidate":
			for _, target := range r.members {
				if target != p && target.id == q.Peer {
					field := q.Kind[4:]
					target.send(q.Kind, message{"roomId": r.id, "fromPeerId": p.id, "generation": q.Generation, field: q.RTC})
					return
				}
			}
			fail("PEER_NOT_FOUND")
		}
	}
}

func (s *service) sweep(now time.Time) {
	for id, r := range s.rooms {
		if !r.emptyAt.IsZero() && now.Sub(r.emptyAt) >= 10*time.Minute {
			delete(s.rooms, id)
			continue
		}
		for id, p := range r.pending {
			if now.Sub(p.pendingAt) >= time.Minute {
				delete(r.pending, id)
				p.pending = nil
				p.fail("JOIN_TIMEOUT", "")
			}
		}
	}
}
