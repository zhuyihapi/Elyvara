package main

import (
	"bytes"
	"encoding/json"
	"regexp"
	"strings"
	"unicode/utf8"
)

var uuid = regexp.MustCompile(`(?i)^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$`)
var tokenPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)

type object map[string]json.RawMessage

func (o object) has(keys ...string) bool {
	if len(o) != len(keys) {
		return false
	}
	for _, key := range keys {
		if _, ok := o[key]; !ok {
			return false
		}
	}
	return true
}

func (o object) text(key string) (string, bool) {
	var value string
	raw := o[key]
	return valueAfter(raw, &value)
}

func valueAfter(raw json.RawMessage, value *string) (string, bool) {
	if len(raw) == 0 || raw[0] != '"' || json.Unmarshal(raw, value) != nil {
		return "", false
	}
	return *value, true
}

func (o object) integer(key string, max int) (int, bool) {
	var value float64
	raw := o[key]
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) || json.Unmarshal(raw, &value) != nil || value < 0 || value > float64(max) || value != float64(int(value)) {
		return 0, false
	}
	return int(value), true
}

type request struct {
	ID, Kind, Nickname, Room, Token, Peer string
	Allow                                 bool
	Version, Generation                   int
	RTC                                   json.RawMessage
}

func parse(data []byte) (request, bool) {
	var r request
	var envelope, payload object
	if json.Unmarshal(data, &envelope) != nil || !envelope.has("v", "messageId", "payload") {
		return r, false
	}
	v, ok := envelope.integer("v", 1)
	r.ID, _ = envelope.text("messageId")
	if !ok || v != 1 || !uuid.MatchString(r.ID) || json.Unmarshal(envelope["payload"], &payload) != nil {
		return r, false
	}
	r.Kind, _ = payload.text("type")
	switch r.Kind {
	case "ping", "room.leave", "share.request":
		return r, payload.has("type")
	case "room.create", "room.join":
		r.Nickname, _ = payload.text("nickname")
		r.Nickname = strings.Trim(r.Nickname, "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
		if n := utf8.RuneCountInString(r.Nickname); n == 0 || n > 40 {
			return r, false
		}
		if r.Kind == "room.create" {
			return r, payload.has("type", "nickname")
		}
		r.Room, _ = payload.text("roomId")
		r.Token, _ = payload.text("token")
		return r, payload.has("type", "nickname", "roomId", "token") && uuid.MatchString(r.Room) && tokenPattern.MatchString(r.Token)
	case "room.admit":
		r.Peer, _ = payload.text("peerId")
		raw := string(payload["allow"])
		r.Allow = raw == "true"
		return r, payload.has("type", "peerId", "allow") && uuid.MatchString(r.Peer) && (raw == "true" || raw == "false")
	case "share.stopped":
		r.Version, ok = payload.integer("version", 9007199254740991)
		return r, ok && payload.has("type", "version")
	case "rtc.description", "rtc.candidate":
		r.Peer, _ = payload.text("targetPeerId")
		r.Generation, ok = payload.integer("generation", 1000000)
		field := strings.TrimPrefix(r.Kind, "rtc.")
		r.RTC = payload[field]
		return r, ok && uuid.MatchString(r.Peer) && payload.has("type", "targetPeerId", "generation", field) && validRTC(field, r.RTC)
	}
	return r, false
}

func validRTC(field string, data json.RawMessage) bool {
	if field == "candidate" && string(data) == "null" {
		return true
	}
	var o object
	if json.Unmarshal(data, &o) != nil {
		return false
	}
	if field == "description" {
		kind, _ := o.text("type")
		sdp, _ := o.text("sdp")
		return o.has("type", "sdp") && (kind == "offer" || kind == "answer") && sdp != "" && utf8.RuneCountInString(sdp) <= 48000
	}
	candidate, ok := o.text("candidate")
	mid, midOK := o.text("sdpMid")
	_, indexOK := o.integer("sdpMLineIndex", 255)
	return o.has("candidate", "sdpMid", "sdpMLineIndex") && ok && utf8.RuneCountInString(candidate) <= 4096 &&
		(string(o["sdpMid"]) == "null" || midOK && utf8.RuneCountInString(mid) <= 256) &&
		(string(o["sdpMLineIndex"]) == "null" || indexOK)
}
