import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { clientMessage } from "../../../packages/protocol/src/index.js";

type Peer = { id: string; ws: WebSocket; nickname: string; room?: Room; pending?: Room; pendingAt: number; alive: boolean; count: number; window: number };
type Room = { id: string; token: string; owner: string; peers: Map<string, Peer>; pending: Map<string, Peer>; share: string | null; version: number; emptyAt: number | null };
export function startSignaling(server: Server, options: { tickMs?: number; roomTtlMs?: number; pendingTtlMs?: number } = {}) {
  const rooms = new Map<string, Room>();
  const peers = new Set<Peer>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false });
  function send(p: Peer, type: string, data: Record<string, unknown> = {}) {
    if (p.ws.readyState !== WebSocket.OPEN) return;
    if (p.ws.bufferedAmount > 262144) { p.ws.close(1013, "Slow receiver"); return; }
    p.ws.send(JSON.stringify({ v: 1, type, ...data }));
  }
  const error = (p: Peer, code: string, messageId?: string) => send(p, "error", { code, messageId });
  function snapshot(r: Room) {
    for (const p of r.peers.values()) send(p, "room.snapshot", { roomId: r.id, ownerPeerId: r.owner, peers: [...r.peers.values()].map(p => ({ peerId: p.id, nickname: p.nickname })), sharingPeerId: r.share, shareVersion: r.version });
  }
  function leave(p: Peer) {
    if (p.pending) { p.pending.pending.delete(p.id); p.pending = undefined; }
    const r = p.room;
    if (!r) return;
    p.room = undefined; r.peers.delete(p.id);
    if (r.share === p.id) { r.share = null; r.version++; }
    if (r.owner === p.id) {
      r.owner = r.peers.keys().next().value ?? "";
      for (const pending of r.pending.values()) { pending.pending = undefined; error(pending, "OWNER_CHANGED"); }
      r.pending.clear();
    }
    if (!r.peers.size) r.emptyAt = Date.now();
    else snapshot(r);
  }
  server.on("request", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "GET" && req.url === "/healthz") { res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"status":"ok","protocolVersion":1}'); }
    else { res.writeHead(404); res.end(); }
  });
  server.on("upgrade", (req, socket, head) => {
    if (req.url !== "/ws" || req.headers.origin || peers.size >= 32) { socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws));
  });
  wss.on("connection", (ws: WebSocket) => {
    const p: Peer = { id: randomUUID(), ws, nickname: "", pendingAt: 0, alive: true, count: 0, window: Date.now() };
    peers.add(p); send(p, "session.ready", { peerId: p.id });
    ws.on("error", () => { /* Never log raw connection data. */ });
    ws.on("pong", () => { p.alive = true; });
    ws.on("close", () => { leave(p); peers.delete(p); });
    ws.on("message", (raw, binary) => {
      if (Date.now() - p.window >= 1000) { p.window = Date.now(); p.count = 0; }
      if (++p.count > 40) { ws.close(1008, "Rate limit"); return; }
      if (binary) { error(p, "INVALID_MESSAGE"); return; }
      let data: unknown;
      try { data = JSON.parse(raw.toString()); } catch { error(p, "INVALID_MESSAGE"); return; }
      const parsed = clientMessage.safeParse(data);
      if (!parsed.success) { error(p, "INVALID_MESSAGE"); return; }
      const { messageId, payload: m } = parsed.data;
      const fail = (code: string) => error(p, code, messageId);
      if (m.type === "ping") { send(p, "pong", { messageId }); return; }
      if (m.type === "room.leave") { leave(p); send(p, "room.left", { messageId }); return; }
      if (m.type === "room.create") {
        if (p.room || p.pending) return fail("ALREADY_JOINED");
        if (rooms.size >= 32) return fail("SERVER_FULL");
        const r: Room = { id: randomUUID(), token: randomBytes(16).toString("hex"), owner: p.id, peers: new Map([[p.id, p]]), pending: new Map(), share: null, version: 0, emptyAt: null };
        p.nickname = m.nickname; p.room = r; rooms.set(r.id, r);
        send(p, "room.created", { messageId, roomId: r.id, token: r.token }); snapshot(r); return;
      }
      if (m.type === "room.join") {
        if (p.room || p.pending) return fail("ALREADY_JOINED");
        const r = rooms.get(m.roomId);
        if (!r || !r.peers.size || !timingSafeEqual(Buffer.from(r.token), Buffer.from(m.token))) return fail("INVALID_INVITE");
        if (r.peers.size >= 4) return fail("ROOM_FULL");
        if (r.pending.size >= 16) return fail("PENDING_FULL");
        p.nickname = m.nickname; p.pending = r; p.pendingAt = Date.now(); r.pending.set(p.id, p);
        send(p, "room.pending", { messageId, roomId: r.id });
        send(r.peers.get(r.owner)!, "room.joinRequested", { peerId: p.id, nickname: p.nickname }); return;
      }
      const r = p.room;
      if (!r) return fail("NOT_JOINED");
      if (m.type === "room.admit") {
        if (r.owner !== p.id) return fail("FORBIDDEN");
        const candidate = r.pending.get(m.peerId);
        if (!candidate) return fail("PEER_NOT_FOUND");
        r.pending.delete(candidate.id); candidate.pending = undefined;
        if (!m.allow) { error(candidate, "JOIN_REJECTED"); return; }
        if (r.peers.size >= 4) { error(candidate, "ROOM_FULL"); return; }
        candidate.room = r; r.peers.set(candidate.id, candidate);
        send(candidate, "room.joined", { roomId: r.id }); snapshot(r); return;
      }
      if (m.type === "share.request") {
        if (r.share && r.share !== p.id) return fail("SHARE_BUSY");
        if (!r.share) { r.share = p.id; r.version++; }
        snapshot(r); return;
      }
      if (m.type === "share.stopped") {
        if (r.share !== p.id || m.version !== r.version) return fail("STALE_SHARE");
        r.share = null; r.version++; snapshot(r); return;
      }
      const target = r.peers.get(m.targetPeerId);
      if (!target || target === p) return fail("PEER_NOT_FOUND");
      send(target, m.type, { roomId: r.id, fromPeerId: p.id, generation: m.generation, ...(m.type === "rtc.description" ? { description: m.description } : { candidate: m.candidate }) });
    });
  });
  const timer = setInterval(() => {
    const now = Date.now();
    for (const r of rooms.values()) if (r.emptyAt !== null && now - r.emptyAt >= (options.roomTtlMs ?? 600000)) rooms.delete(r.id);
    for (const p of peers) {
      if (p.pending && now - p.pendingAt >= (options.pendingTtlMs ?? 60000)) { p.pending.pending.delete(p.id); p.pending = undefined; error(p, "JOIN_TIMEOUT"); }
      if (!p.alive) p.ws.terminate(); else { p.alive = false; p.ws.ping(); }
    }
  }, options.tickMs ?? 15000);
  timer.unref();
  return { close() { clearInterval(timer); for (const p of peers) p.ws.terminate(); wss.close(); } };
}
