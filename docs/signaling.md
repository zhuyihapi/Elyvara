# M0 signaling contract

Transport: native-client WebSocket `/ws`; loopback `ws://` for development, verified `wss://` for public deployment. Browser Origin headers are rejected in this initial native-only service. `GET /healthz` returns `{ "status": "ok", "protocolVersion": 1 }`; no room inventory or diagnostics are public.

The authoritative client schema is `packages/protocol/src/index.ts`. Every client message is `{ "v": 1, "messageId": "<uuid>", "payload": { "type": "..." } }`. Unknown fields are rejected, including self-reported sender identity. IDs are UUIDs; nicknames are trimmed, 1–40 characters. Invitation tokens are 128-bit random hex values, returned only to the creator, never in snapshots or logs. Never put tokens in URL query strings.

| Command | Payload fields | Outcome |
| --- | --- | --- |
| room.create | nickname | room.created with roomId/token, then room.snapshot |
| room.join | roomId, token, nickname | room.pending; owner receives room.joinRequested |
| room.admit | peerId, allow | Owner only; approval sends room.joined and snapshots; rejection JOIN_REJECTED |
| room.leave | none | room.left, remaining peers receive snapshot |
| share.request | none | Single owner lease in snapshot; competing request SHARE_BUSY |
| share.stopped | version | Sharer only, exact shareVersion; otherwise STALE_SHARE |
| rtc.description | targetPeerId, generation, description: {type: offer/answer, sdp} | Routed only to admitted member in same room |
| rtc.candidate | targetPeerId, generation, candidate: null or {candidate,sdpMid,sdpMLineIndex} | Same membership checks; null is end-of-candidates |
| ping | none | pong with messageId |

Server messages have `v:1,type`. Errors carry `code` and valid request `messageId` when available, without echoing sensitive payload. RTC output includes authenticated `fromPeerId`, roomId, generation and description/candidate. Clients must implement collision resolution, queue early candidates, reject stale generations and create fresh connections after reconnect (M0.4); server does not interpret SDP or certify generation correctness. There is no transparent session resume.

Snapshots contain roomId, ownerPeerId, peers [{peerId,nickname}], sharingPeerId and shareVersion. Initial owner is creator; on owner departure, earliest remaining admitted member becomes owner and pending joins are cancelled (OWNER_CHANGED). Sharer departure releases lease and increments version. No automatic capture resume.

Stable errors: INVALID_MESSAGE, NOT_JOINED, ALREADY_JOINED, INVALID_INVITE, SERVER_FULL, ROOM_FULL, PENDING_FULL, FORBIDDEN, PEER_NOT_FOUND, JOIN_REJECTED, OWNER_CHANGED, JOIN_TIMEOUT, SHARE_BUSY, STALE_SHARE. Validate against these codes rather than parsing prose. room.admit approval success is observed through snapshot; denial/invalid requests through error, not a generic RPC ack.

Limits: 32 concurrent sessions/rooms, 4 admitted members per room, 16 pending requests, 64KiB message limit, 40 messages/second/session, 256KiB outgoing backlog, 60-second pending timeout, 10-minute empty-room TTL. Empty-room invitations become unusable immediately. Native WebSocket ping/pong cleans dead sessions in approximately 30 seconds. State is memory-only and lost on restart. No persistent users, media storage, TURN or relay.

The public listener requires TLS. HTTP loopback is intentionally not publicly reachable. TLS authenticates the server, while invites and owner approval authorize room access. This does not claim independently verified end-to-end participant identity against malicious signaling.
