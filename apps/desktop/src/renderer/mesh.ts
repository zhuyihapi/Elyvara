type Send = (message: Record<string, unknown>) => Promise<boolean>;
type Pending = { generation: number; candidate: RTCIceCandidateInit | null };
export type Link = {
  id: string;
  initiator: boolean;
  generation: number;
  retries: number;
  pc?: RTCPeerConnection;
  sender?: RTCRtpSender;
  remote?: MediaStream;
  state: string;
  pending: Pending[];
  queue: Promise<void>;
  queued: number;
  timer?: number;
};

export class Mesh {
  readonly links = new Map<string, Link>();
  private track: MediaStreamTrack | null = null;
  constructor(private readonly own: string, private readonly stun: string, private readonly send: Send, private readonly change: () => void) {}

  sync(ids: string[]) {
    for (const [id, link] of this.links) {
      if (!ids.includes(id)) { this.close(link); this.links.delete(id); }
    }
    for (const id of ids) {
      if (id === this.own || this.links.has(id)) continue;
      const link: Link = { id, initiator: this.own < id, generation: -1, retries: 0, state: "waiting", pending: [], queue: Promise.resolve(), queued: 0 };
      this.links.set(id, link);
      if (link.initiator) this.enqueue(link, () => this.offer(link));
    }
    this.change();
  }

  private alive(link: Link, pc?: RTCPeerConnection) {
    return this.links.get(link.id) === link && (!pc || link.pc === pc);
  }

  private enqueue(link: Link, run: () => Promise<void>) {
    if (link.queued >= 64) return;
    link.queued++;
    link.queue = link.queue.then(async () => {
      if (this.alive(link)) await run();
    }).catch(() => {
      if (this.alive(link)) { link.state = "failed"; this.retry(link); this.change(); }
    }).finally(() => { link.queued--; });
  }

  private close(link: Link) {
    clearTimeout(link.timer);
    link.timer = undefined;
    const pc = link.pc;
    link.pc = undefined;
    link.sender = undefined;
    link.remote = undefined;
    pc?.close();
  }

  closeAll() {
    for (const link of this.links.values()) this.close(link);
    this.links.clear();
  }

  private retry(link: Link, delay = 1500) {
    if (!link.initiator || link.retries >= 2 || link.timer !== undefined) return;
    link.timer = window.setTimeout(() => {
      link.timer = undefined;
      if (!this.alive(link) || link.pc?.connectionState === "connected") return;
      link.retries++;
      this.enqueue(link, () => this.offer(link));
    }, delay);
  }

  private create(link: Link, generation: number) {
    this.close(link);
    link.generation = generation;
    link.pending = link.pending.filter(item => item.generation >= generation);
    const pc = new RTCPeerConnection({ iceServers: this.stun ? [{ urls: this.stun }] : [] });
    link.pc = pc;
    link.state = "connecting";
    pc.onicecandidate = ({ candidate }) => {
      if (!this.alive(link, pc)) return;
      const value = candidate ? { candidate: candidate.candidate, sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex } : null;
      void this.send({ type: "rtc.candidate", targetPeerId: link.id, generation, candidate: value });
    };
    pc.onconnectionstatechange = () => {
      if (!this.alive(link, pc)) return;
      link.state = pc.connectionState;
      if (link.state === "connected") { clearTimeout(link.timer); link.timer = undefined; }
      if (link.state === "failed") this.retry(link);
      if (link.state === "disconnected") this.retry(link, 8000);
      this.change();
    };
    pc.onicegatheringstatechange = () => { if (this.alive(link, pc)) this.change(); };
    pc.ontrack = ({ track, streams }) => {
      if (!this.alive(link, pc) || track.kind !== "video") return;
      link.remote = streams[0] ?? new MediaStream([track]);
      this.change();
    };
    this.change();
    return pc;
  }

  private async offer(link: Link) {
    const pc = this.create(link, link.generation + 1);
    link.sender = pc.addTransceiver("video", { direction: "sendrecv" }).sender;
    await link.sender.replaceTrack(this.track);
    await pc.setLocalDescription(await pc.createOffer());
    await this.description(link, pc);
    this.retry(link, 12000);
  }

  private async description(link: Link, pc: RTCPeerConnection) {
    const description = pc.localDescription;
    if (!description || !this.alive(link, pc)) return;
    if (!await this.send({ type: "rtc.description", targetPeerId: link.id, generation: link.generation, description: { type: description.type, sdp: description.sdp } })) throw new Error("Signaling unavailable");
  }

  private async addCandidate(pc: RTCPeerConnection, candidate: RTCIceCandidateInit | null) {
    try { await pc.addIceCandidate(candidate ?? undefined); } catch { /* Invalid or obsolete individual candidates do not discard the connection. */ }
  }

  receive(id: string, generation: number, description: RTCSessionDescriptionInit | undefined, candidate: RTCIceCandidateInit | null | undefined) {
    const link = this.links.get(id);
    if (!link) return;
    this.enqueue(link, async () => {
      if (generation < link.generation) return;
      if (!description) {
        if (candidate === undefined || generation > link.generation + 3) return;
        if (generation === link.generation && link.pc?.remoteDescription) await this.addCandidate(link.pc, candidate);
        else if (link.pending.length < 64) link.pending.push({ generation, candidate });
        return;
      }
      if (description.type === "offer" && (link.initiator || generation <= link.generation)) return;
      if (description.type === "answer" && (!link.initiator || generation !== link.generation || link.pc?.signalingState !== "have-local-offer")) return;
      const pc = description.type === "offer" ? this.create(link, generation) : link.pc;
      if (!pc) return;
      await pc.setRemoteDescription(description);
      if (!this.alive(link, pc)) return;
      const early = link.pending.filter(item => item.generation === generation);
      link.pending = link.pending.filter(item => item.generation > generation);
      for (const item of early) await this.addCandidate(pc, item.candidate);
      if (description.type === "offer") {
        const transceiver = pc.getTransceivers().find(item => item.receiver.track.kind === "video");
        if (!transceiver) throw new Error("Missing test transceiver");
        transceiver.direction = "sendrecv";
        link.sender = transceiver.sender;
        await link.sender.replaceTrack(this.track);
        await pc.setLocalDescription(await pc.createAnswer());
        await this.description(link, pc);
      }
    });
  }

  setTrack(track: MediaStreamTrack | null) {
    this.track = track;
    for (const link of this.links.values()) this.enqueue(link, async () => {
      await link.sender?.replaceTrack(this.track);
    });
  }

  rejectRelay(link: Link) {
    this.close(link);
    link.state = "relay-rejected";
    this.change();
  }
}
