import { Mesh } from "./mesh.js";
import type { Link } from "./mesh.js";
import { kbps, readSample } from "./metrics.js";
import type { Sample } from "./metrics.js";

type RecordValue = Record<string, unknown>;
type Member = { peerId: string; nickname: string };
type SignalAPI = {
  connect(url: string): Promise<boolean>;
  disconnect(): Promise<void>;
  send(message: unknown): Promise<boolean>;
  onSignal(callback: (value: unknown) => void): () => void;
};
const api = (window as Window & { elyvara?: SignalAPI }).elyvara;
if (!api) throw new Error("Signaling bridge unavailable");
const bridge = api;
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const endpoint = byId<HTMLInputElement>("endpoint");
const stun = byId<HTMLInputElement>("stun");
const nickname = byId<HTMLInputElement>("nickname");
const invitation = byId<HTMLTextAreaElement>("invite");
const status = byId("signal-status");
const members = byId("members");
const requests = byId("requests");
const create = byId<HTMLButtonElement>("create");
const join = byId<HTMLButtonElement>("join");
const streamButton = byId<HTMLButtonElement>("stream");
const leave = byId<HTMLButtonElement>("leave");
const disconnect = byId<HTMLButtonElement>("disconnect");
const connect = byId<HTMLButtonElement>("connect");
const proxy = byId("proxy-status");
const probeButton = byId<HTMLButtonElement>("probe");
const stunStatus = byId("stun-status");
const ownRoom = byId("room-status");
const records = new Map<string, { label: HTMLHeadingElement; stats: HTMLParagraphElement; video: HTMLVideoElement; card: HTMLElement }>();
const samples = new Map<string, { pc: RTCPeerConnection; sample: Sample }>();
const report = new Map<string, RecordValue>();
let peerId = "";
let roomId = "";
let stunUri = "";
let mesh: Mesh | undefined;
let source: MediaStream | undefined;
let drawTimer: number | undefined;
let signalState = "idle";
let proxyHint = "unknown";
let virtualAdapterHint = false;
let collecting = false;
let pendingRoom = false;
let stunProbe: RTCPeerConnection | undefined;
let probeResult = "not-run";
let connectTimer: number | undefined;

function stunAddress() {
  const uri = stun.value.trim();
  if (!uri) return "";
  const match = /^stun:(?:[a-z\d.-]+|\[[a-f\d:]+\])(?::(\d{1,5}))?$/i.exec(uri);
  if (!match || (match[1] && (Number(match[1]) < 1 || Number(match[1]) > 65535))) return undefined;
  return uri;
}

function object(value: unknown): RecordValue | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : undefined;
}
function id(value: unknown): value is string {
  return typeof value === "string" && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value);
}
function say(message: string) { status.textContent = message; }
function controls() {
  create.disabled = join.disabled = !peerId || Boolean(roomId) || pendingRoom;
  streamButton.disabled = !roomId;
  leave.disabled = !roomId && !pendingRoom;
  disconnect.disabled = signalState === "idle";
  connect.disabled = signalState === "connecting";
}
async function send(payload: RecordValue) {
  try {
    const sent = await bridge.send({ v: 1, messageId: crypto.randomUUID(), payload });
    if (!sent) say("信令未发送，请检查连接或消息长度。");
    return sent;
  } catch { say("信令不可用。"); return false; }
}
function stopStream() {
  clearInterval(drawTimer);
  drawTimer = undefined;
  mesh?.setTrack(null);
  source?.getTracks().forEach(track => track.stop());
  source = undefined;
  streamButton.textContent = "发送测试图案";
}
function clearRoom() {
  stopStream();
  mesh?.closeAll();
  mesh = undefined;
  roomId = "";
  pendingRoom = false;
  invitation.value = "";
  members.replaceChildren();
  requests.replaceChildren();
  records.clear();
  samples.clear();
  report.clear();
  ownRoom.textContent = "未加入房间";
  controls();
}
function connectionChanged() {
  for (const [id, link] of mesh?.links ?? []) {
    const card = records.get(id);
    if (!card) continue;
    if (card.video.srcObject !== (link.remote ?? null)) card.video.srcObject = link.remote ?? null;
    if (!link.pc || samples.get(id)?.pc !== link.pc) {
      samples.delete(id);
      card.stats.textContent = `状态 ${link.state}，路径待确认`;
      report.set(id, { state: link.state, proxyPath: "unknown" });
    }
  }
}
function snapshot(message: RecordValue) {
  if (!id(message.roomId) || !id(message.ownerPeerId) || !Array.isArray(message.peers) || message.peers.length > 4) return;
  const list: Member[] = [];
  for (const item of message.peers as unknown[]) {
    const member = object(item);
    if (!member || !id(member.peerId) || typeof member.nickname !== "string" || member.nickname.length > 80) return;
    if (list.some(known => known.peerId === member.peerId)) return;
    list.push({ peerId: member.peerId, nickname: member.nickname });
  }
  if (!list.some(member => member.peerId === peerId) || (roomId && roomId !== message.roomId)) return;
  roomId = message.roomId;
  pendingRoom = false;
  ownRoom.textContent = `已入房 ${list.length}/4 · ${message.ownerPeerId === peerId ? "房主" : "成员"}`;
  if (message.ownerPeerId !== peerId) requests.replaceChildren();
  for (const [id, view] of records) {
    if (!list.some(member => member.peerId === id)) {
      view.card.remove(); records.delete(id); samples.delete(id); report.delete(id);
    }
  }
  for (const member of list) {
    if (member.peerId === peerId) continue;
    let view = records.get(member.peerId);
    if (!view) {
      const card = document.createElement("article");
      const label = document.createElement("h3");
      const stats = document.createElement("p");
      const video = document.createElement("video");
      video.autoplay = true; video.muted = true; video.playsInline = true;
      card.append(label, stats, video);
      members.append(card);
      view = { label, stats, video, card };
      records.set(member.peerId, view);
    }
    view.label.textContent = member.nickname;
  }
  mesh ??= new Mesh(peerId, stunUri, send, connectionChanged);
  mesh.sync(list.map(member => member.peerId));
  controls();
}
function incoming(value: unknown) {
  const m = object(value);
  if (!m || m.v !== 1 || typeof m.type !== "string") return;
  switch (m.type) {
    case "session.ready":
      if (id(m.peerId)) { clearTimeout(connectTimer); peerId = m.peerId; signalState = "ready"; say("信令已连接"); controls(); }
      break;
    case "room.created":
      if (id(m.roomId) && typeof m.token === "string" && /^[a-f0-9]{32}$/.test(m.token)) {
        invitation.value = JSON.stringify({ roomId: m.roomId, token: m.token });
        say("房间已创建，可复制邀请信息");
      }
      break;
    case "room.pending": pendingRoom = true; say("等待房主审批"); controls(); break;
    case "room.joined": say("已通过审批"); break;
    case "room.left": clearRoom(); say("已退出房间"); break;
    case "room.snapshot": snapshot(m); break;
    case "room.joinRequested": {
      if (!id(m.peerId) || typeof m.nickname !== "string" || m.nickname.length > 80 || requests.childElementCount >= 16) break;
      const requested = m.peerId;
      const row = document.createElement("p");
      row.textContent = `${m.nickname} 申请加入 `;
      for (const allow of [true, false]) {
        const button = document.createElement("button");
        button.textContent = allow ? "同意" : "拒绝";
        button.onclick = async () => { if (await send({ type: "room.admit", peerId: requested, allow })) row.remove(); };
        row.append(button);
      }
      requests.append(row);
      window.setTimeout(() => row.remove(), 60000);
      break;
    }
    case "error": {
      const codes: Record<string, string> = { INVALID_INVITE: "邀请无效", ROOM_FULL: "房间已满", JOIN_REJECTED: "房主拒绝了加入请求", JOIN_TIMEOUT: "审批超时", OWNER_CHANGED: "房主已更换，请重新申请", SERVER_FULL: "服务器已满", PENDING_FULL: "审批队列已满" };
      say(typeof m.code === "string" ? codes[m.code] ?? "服务器拒绝了请求" : "服务器拒绝了请求");
      if (!roomId) { pendingRoom = false; controls(); }
      break;
    }
    case "rtc.description":
    case "rtc.candidate": {
      if (m.roomId !== roomId || !id(m.fromPeerId) || typeof m.generation !== "number" || !Number.isInteger(m.generation) || m.generation < 0 || m.generation > 1000000) break;
      const d = object(m.description);
      const c = object(m.candidate);
      if (m.type === "rtc.description" && d && (d.type === "offer" || d.type === "answer") && typeof d.sdp === "string" && d.sdp.length <= 48000) {
        mesh?.receive(m.fromPeerId, m.generation, { type: d.type, sdp: d.sdp }, undefined);
      }
      if (m.type === "rtc.candidate" && m.candidate === null) mesh?.receive(m.fromPeerId, m.generation, undefined, null);
      if (m.type === "rtc.candidate" && c && typeof c.candidate === "string" && c.candidate.length <= 4096 &&
        (c.sdpMid === null || typeof c.sdpMid === "string") && (c.sdpMLineIndex === null || typeof c.sdpMLineIndex === "number")) {
        mesh?.receive(m.fromPeerId, m.generation, undefined, { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex });
      }
      break;
    }
  }
}
const unsubscribe = bridge.onSignal(value => {
  const event = object(value);
  if (!event) return;
  if (event.state === "open") say("WebSocket 已打开，等待会话确认");
  if (event.state === "closed" || event.state === "failed") {
    clearTimeout(connectTimer);
    const failed = event.state === "failed" || signalState === "failed";
    signalState = failed ? "failed" : "idle";
    peerId = ""; clearRoom();
    say(failed ? "信令连接失败，请检查地址、证书和网络后重连。" : "信令已断开，请重新连接并加入房间。");
  }
  if (event.state === "proxy") {
    proxyHint = ["proxy-configured", "direct-setting"].includes(String(event.hint)) ? String(event.hint) : "unknown";
    virtualAdapterHint = event.virtualAdapter === true;
    proxy.textContent = `代理设置线索 ${proxyHint}；虚拟网卡线索 ${virtualAdapterHint ? "有" : "未发现"}；实际出口未知`;
  }
  if ("message" in event) incoming(event.message);
});
connect.onclick = async () => {
  const uri = stunAddress();
  if (uri === undefined) {
    say("请输入单个 STUN 地址，例如 stun:host:3478。"); return;
  }
  clearTimeout(connectTimer);
  peerId = ""; signalState = "connecting"; clearRoom();
  stunUri = uri; controls(); say("正在连接信令…");
  try {
    await bridge.disconnect();
    if (signalState !== "connecting") return;
    if (!await bridge.connect(endpoint.value.trim())) { signalState = "idle"; controls(); say("地址应为 wss://…/ws 或本机回环 ws://…/ws。"); }
    else if (signalState === "connecting") connectTimer = window.setTimeout(() => {
      signalState = "failed"; controls(); say("等待信令会话超时，请重试。"); void bridge.disconnect();
    }, 10000);
  } catch { signalState = "idle"; controls(); say("连接未启动。"); }
};
disconnect.onclick = async () => {
  clearTimeout(connectTimer);
  peerId = ""; signalState = "idle"; clearRoom(); await bridge.disconnect(); say("已断开信令");
};
probeButton.onclick = async () => {
  const uri = stunAddress();
  if (!uri) { stunStatus.textContent = "请输入有效的 STUN 地址。"; return; }
  probeButton.disabled = true;
  stun.disabled = true;
  probeResult = "running";
  stunStatus.textContent = "正在检查 STUN…";
  let deadline: number | undefined;
  try {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: uri }] });
    stunProbe = pc;
    pc.createDataChannel("stun-probe");
    const observed = new Promise<boolean>(resolve => {
      deadline = window.setTimeout(() => resolve(false), 8000);
      pc.onicecandidate = event => {
        if (event.candidate?.type === "srflx") resolve(true);
        else if (!event.candidate) resolve(false);
      };
    });
    await pc.setLocalDescription(await pc.createOffer());
    const found = await observed;
    probeResult = found ? "srflx-observed" : "srflx-not-observed";
    stunStatus.textContent = found ? "已观察到服务器反射候选（srflx）。" : "未观察到 srflx，具体原因待确认。";
  } catch {
    probeResult = "failed";
    stunStatus.textContent = "STUN 检查未完成。";
  } finally {
    clearTimeout(deadline);
    stunProbe?.close();
    stunProbe = undefined;
    probeButton.disabled = false;
    stun.disabled = false;
  }
};
stun.oninput = () => {
  probeResult = "not-run";
  stunStatus.textContent = "STUN 地址已变更，请重新检查。";
};
create.onclick = async () => {
  if (!nickname.value.trim()) { say("请输入昵称"); return; }
  pendingRoom = true; controls();
  if (!await send({ type: "room.create", nickname: nickname.value })) { pendingRoom = false; controls(); }
};
join.onclick = async () => {
  if (!nickname.value.trim()) { say("请输入昵称"); return; }
  try {
    const invite = object(JSON.parse(invitation.value));
    if (!invite || !id(invite.roomId) || typeof invite.token !== "string" || !/^[a-f0-9]{32}$/.test(invite.token)) throw new Error("Invalid invite");
    pendingRoom = true; controls();
    if (!await send({ type: "room.join", nickname: nickname.value, roomId: invite.roomId, token: invite.token })) { pendingRoom = false; controls(); }
  } catch { say("请粘贴完整邀请信息"); }
};
leave.onclick = () => { void send({ type: "room.leave" }); };
streamButton.onclick = () => {
  if (source) { stopStream(); return; }
  const canvas = document.createElement("canvas");
  canvas.width = 640; canvas.height = 360;
  const ctx = canvas.getContext("2d");
  if (!ctx || !mesh) return;
  const draw = () => {
    ctx.fillStyle = "#102e52"; ctx.fillRect(0, 0, 640, 360);
    ctx.fillStyle = "#59dbad"; ctx.fillRect((performance.now() / 8) % 560, 230, 80, 70);
    ctx.fillStyle = "#ffffff"; ctx.font = "32px sans-serif"; ctx.fillText("Elyvara M0", 24, 70);
    ctx.font = "20px monospace"; ctx.fillText(new Date().toISOString(), 24, 120);
  };
  draw(); drawTimer = window.setInterval(draw, 67);
  source = canvas.captureStream(15);
  mesh.setTrack(source.getVideoTracks()[0] ?? null);
  streamButton.textContent = "停止测试图案";
};
async function measure(link: Link) {
  const pc = link.pc;
  if (!pc) return;
  const sample = readSample(await pc.getStats());
  if (link.pc !== pc || mesh?.links.get(link.id) !== link) return;
  const earlier = samples.get(link.id);
  const previous = earlier?.pc === pc && earlier.sample.pair === sample.pair ? earlier.sample : undefined;
  const elapsed = previous ? sample.at - previous.at : undefined;
  const out = kbps(sample.sent, previous?.sent, elapsed);
  const into = kbps(sample.received, previous?.received, elapsed);
  samples.set(link.id, { pc, sample });
  const view = records.get(link.id);
  if (sample.path?.relay) {
    mesh?.rejectRelay(link);
    report.set(link.id, { state: "relay-rejected", proxyPath: "unknown" });
    if (view) view.stats.textContent = "检测到中继候选，已关闭连接。";
    return;
  }
  const path = sample.path ? `${sample.path.local} → ${sample.path.remote} · ${sample.path.family} · ${sample.path.transport}` : "路径待确认";
  const stunState = sample.stun ? "已发现 srflx" : stunUri ? "尚未发现 srflx" : "未配置";
  report.set(link.id, { state: link.state, path: sample.path ?? null, sendKbps: out ?? null, receiveKbps: into ?? null, rttMs: sample.rttMs ?? null, stun: stunState, proxyPath: "unknown" });
  if (view) view.stats.textContent = `${link.state} · ${path} · STUN ${stunState} · 上行 ${out ?? "未知"} / 下行 ${into ?? "未知"} kbps · RTT ${sample.rttMs ?? "未知"} ms`;
}
const timer = window.setInterval(async () => {
  if (collecting) return;
  collecting = true;
  try { await Promise.allSettled([...(mesh?.links.values() ?? [])].map(measure)); }
  finally { collecting = false; }
}, 1000);
byId<HTMLButtonElement>("export").onclick = () => {
  const output = { version: 1, signalState, proxyHint, virtualAdapterHint, proxyPath: "unknown", stunProbe: probeResult, peers: [...report.values()].map((item, index) => ({ member: index + 1, ...item })) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(output, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url; a.download = "elyvara-diagnostics.json"; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
window.addEventListener("pagehide", () => { unsubscribe(); clearInterval(timer); clearTimeout(connectTimer); stunProbe?.close(); clearRoom(); }, { once: true });
controls();
