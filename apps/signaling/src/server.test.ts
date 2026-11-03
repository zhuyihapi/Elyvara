import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as createTlsServer } from "node:https";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { startSignaling } from "./server.js";

type Message = { type: string; code?: string; peerId: string; roomId: string; token: string; ownerPeerId: string; sharingPeerId: string | null; shareVersion: number; fromPeerId: string; generation: number };
async function fixture(options: { tls?: { cert: Buffer; key: Buffer }; tickMs?: number; pendingTtlMs?: number } = {}) {
  const server = options.tls ? createTlsServer(options.tls) : createServer();
  const service = startSignaling(server, options);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const url = `${options.tls ? "wss" : "ws"}://127.0.0.1:${address.port}/ws`;
  const clients: WebSocket[] = [];
  async function connect() {
    const ws = new WebSocket(url, { ca: options.tls?.cert }); clients.push(ws);
    const messages: Message[] = [];
    ws.on("error", () => {});
    ws.on("message", data => messages.push(JSON.parse(data.toString()) as Message));
    const next = async (type: string): Promise<Message> => {
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const index = messages.findIndex(m => m.type === type);
        if (index !== -1) return messages.splice(index, 1)[0]!;
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      throw new Error(`Missing ${type}`);
    };
    const ready = await next("session.ready");
    return { ws, id: ready.peerId, next, clear: () => { messages.length = 0; }, send: (payload: unknown) => ws.send(JSON.stringify({ v: 1, messageId: randomUUID(), payload })) };
  }
  return { connect, url, async close() { for (const c of clients) c.terminate(); service.close(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}

test("room authorization, admission, scoped forwarding, share lease and owner transfer", async () => {
  const f = await fixture();
  try {
    const a = await f.connect(); const b = await f.connect(); const outside = await f.connect();
    a.send({ type: "room.create", nickname: "A" }); const invite = await a.next("room.created"); await a.next("room.snapshot");
    b.send({ type: "room.join", roomId: invite.roomId, token: "0".repeat(32), nickname: "B" }); assert.equal((await b.next("error")).code, "INVALID_INVITE");
    b.send({ type: "room.join", roomId: invite.roomId, token: invite.token, nickname: "B" }); await b.next("room.pending"); await a.next("room.joinRequested");
    b.send({ type: "rtc.candidate", targetPeerId: a.id, generation: 0, candidate: null }); assert.equal((await b.next("error")).code, "NOT_JOINED");
    a.send({ type: "room.admit", peerId: b.id, allow: true }); await b.next("room.joined"); await b.next("room.snapshot"); await a.next("room.snapshot");
    outside.send({ type: "room.create", nickname: "C" }); await outside.next("room.created");
    a.send({ type: "rtc.candidate", targetPeerId: outside.id, generation: 0, candidate: null }); assert.equal((await a.next("error")).code, "PEER_NOT_FOUND");
    a.send({ type: "rtc.description", targetPeerId: b.id, generation: 2, description: { type: "offer", sdp: "test-sdp" } });
    const forwarded = await b.next("rtc.description"); assert.equal(forwarded.fromPeerId, a.id); assert.equal(forwarded.generation, 2);
    a.send({ type: "share.request" }); const share = await a.next("room.snapshot"); await b.next("room.snapshot"); assert.equal(share.sharingPeerId, a.id);
    b.send({ type: "share.request" }); assert.equal((await b.next("error")).code, "SHARE_BUSY");
    a.send({ type: "share.stopped", version: share.shareVersion - 1 }); assert.equal((await a.next("error")).code, "STALE_SHARE");
    a.send({ type: "room.leave" }); await a.next("room.left"); const after = await b.next("room.snapshot"); assert.equal(after.ownerPeerId, b.id); assert.equal(after.sharingPeerId, null);
    a.send({ type: "room.join", roomId: invite.roomId, token: invite.token, nickname: "A" }); await a.next("room.pending"); await b.next("room.joinRequested");
    b.send({ type: "room.admit", peerId: a.id, allow: false }); assert.equal((await a.next("error")).code, "JOIN_REJECTED");
  } finally { await f.close(); }
});

test("capacity is four and admission is owner-only", async () => {
  const f = await fixture();
  try {
    const owner = await f.connect(); owner.send({ type: "room.create", nickname: "Owner" }); const invite = await owner.next("room.created"); await owner.next("room.snapshot");
    for (let i = 0; i < 3; i++) {
      const p = await f.connect(); p.send({ type: "room.join", roomId: invite.roomId, token: invite.token, nickname: "Member" }); await p.next("room.pending"); await owner.next("room.joinRequested");
      owner.send({ type: "room.admit", peerId: p.id, allow: true }); await p.next("room.joined"); await owner.next("room.snapshot");
      p.send({ type: "room.admit", peerId: owner.id, allow: true }); assert.equal((await p.next("error")).code, "FORBIDDEN");
    }
    const fifth = await f.connect(); fifth.send({ type: "room.join", roomId: invite.roomId, token: invite.token, nickname: "Fifth" }); assert.equal((await fifth.next("error")).code, "ROOM_FULL");
  } finally { await f.close(); }
});

test("malformed data and spoofed sender fields are rejected", async () => {
  const f = await fixture();
  try {
    const p = await f.connect(); p.ws.send("{"); assert.equal((await p.next("error")).code, "INVALID_MESSAGE");
    p.ws.send(JSON.stringify({ v: 1, messageId: randomUUID(), senderPeerId: randomUUID(), payload: { type: "ping" } })); assert.equal((await p.next("error")).code, "INVALID_MESSAGE");
    p.send({ type: "ping" }); assert.equal((await p.next("pong")).type, "pong");
  } finally { await f.close(); }
});

test("rate and payload limits close abusive connections", async () => {
  const f = await fixture();
  try {
    const p = await f.connect(); const rateClosed = new Promise<number>(resolve => p.ws.once("close", resolve));
    for (let i = 0; i < 45; i++) p.send({ type: "ping" });
    assert.equal(await rateClosed, 1008);
    const large = await f.connect(); const sizeClosed = new Promise<number>(resolve => large.ws.once("close", resolve));
    large.ws.send("x".repeat(65537)); assert.equal(await sizeClosed, 1009);
  } finally { await f.close(); }
});

test("pending joins time out and browser origins are rejected", async () => {
  const f = await fixture({ tickMs: 10, pendingTtlMs: 20 });
  try {
    const a = await f.connect(); const b = await f.connect();
    a.send({ type: "room.create", nickname: "A" }); const invite = await a.next("room.created");
    b.send({ type: "room.join", roomId: invite.roomId, token: invite.token, nickname: "B" }); await b.next("room.pending");
    assert.equal((await b.next("error")).code, "JOIN_TIMEOUT");
    const browser = new WebSocket(f.url, { origin: "https://example.invalid" });
    const status = await new Promise<number>(resolve => {
      browser.on("error", () => {});
      browser.on("unexpected-response", (_req, res) => { res.resume(); resolve(res.statusCode ?? 0); browser.terminate(); });
    });
    assert.equal(status, 403);
  } finally { await f.close(); }
});

test("WSS performs certificate verification with an explicitly trusted test CA", async () => {
  const dir = mkdtempSync(join(tmpdir(), "elyvara-tls-"));
  try {
    execFileSync(process.env.OPENSSL_BIN ?? "openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"), "-subj", "/CN=Elyvara test", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
    const f = await fixture({ tls: { cert: readFileSync(join(dir, "cert.pem")), key: readFileSync(join(dir, "key.pem")) } });
    try {
      const rejected = new WebSocket(f.url);
      const failure = await new Promise<Error>(resolve => rejected.once("error", resolve));
      assert.match(failure.message, /self.signed|certificate/i);
      const trusted = await f.connect(); trusted.send({ type: "room.create", nickname: "TLS" });
      assert.equal((await trusted.next("room.created")).type, "room.created");
    } finally { await f.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
