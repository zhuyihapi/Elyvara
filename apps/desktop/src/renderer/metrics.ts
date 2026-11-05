export type Path = { local: string; remote: string; family: string; transport: string; relay: boolean };
export type Sample = { at: number; pair?: string; sent?: number; received?: number; rttMs?: number; path?: Path; stun: boolean };
export function readSample(stats: RTCStatsReport): Sample {
  const sample: Sample = { at: performance.now(), stun: false };
  let selected: string | undefined;
  stats.forEach(report => {
    if (report.type === "transport" && typeof report.selectedCandidatePairId === "string") selected = report.selectedCandidatePairId;
    if (report.type === "local-candidate" && report.candidateType === "srflx") sample.stun = true;
  });
  const pair = selected ? stats.get(selected) : undefined;
  if (!pair) return sample;
  sample.pair = selected;
  const local = stats.get(pair.localCandidateId);
  const remote = stats.get(pair.remoteCandidateId);
  sample.sent = typeof pair.bytesSent === "number" ? pair.bytesSent : undefined;
  sample.received = typeof pair.bytesReceived === "number" ? pair.bytesReceived : undefined;
  sample.rttMs = typeof pair.currentRoundTripTime === "number" ? Math.round(pair.currentRoundTripTime * 1000) : undefined;
  if (local && remote) {
    const kinds = ["host", "srflx", "prflx", "relay"];
    const kind = (value: string) => kinds.includes(value) ? value : "unknown";
    const address = typeof local.address === "string" ? local.address : "";
    sample.path = {
      local: kind(local.candidateType), remote: kind(remote.candidateType),
      family: address.includes(":") ? "IPv6" : /^\d+(\.\d+){3}$/.test(address) ? "IPv4" : "unknown",
      transport: ["udp", "tcp"].includes(local.protocol) ? local.protocol : "unknown",
      relay: local.candidateType === "relay" || remote.candidateType === "relay",
    };
  }
  return sample;
}
export function kbps(current?: number, previous?: number, elapsed?: number) {
  if (current === undefined || previous === undefined || !elapsed || elapsed <= 0 || current < previous) return undefined;
  return Math.round((current - previous) * 8 / elapsed);
}
