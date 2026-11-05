# M0 deployment

Target: user-designated Ubuntu 24.04 server. Preserve existing SSH/tunnel and unrelated services. Installation and activation require task authorization; configuration examples do not imply live deployment. No server IPs, private keys or invitation tokens belong in Git.

## Signaling

Build with Go 1.27. Run `go -C apps/signaling test ./...`. On a POSIX shell, build the Linux amd64 binary with `CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go -C apps/signaling build -o ../../dist/elyvara-signaling .`. Install it as `/opt/elyvara/releases/<commit>/elyvara-signaling`, link `/opt/elyvara/current`, and install the systemd unit and `deploy/signaling.env.example` as `/etc/elyvara/signaling.env`.

Place a valid fullchain/key under `/etc/elyvara/tls/` (root-owned, private key mode 0600). The unit loads them as systemd credentials and grants only privileged-port binding capability. It binds dual-stack `::` port 443; verify both families on the target kernel. Never set NODE_TLS_REJECT_UNAUTHORIZED=0 or accept arbitrary certificates. No TLS files means the public unit must remain stopped. For local development, `npm run start:signaling` binds loopback HTTP port 8080 only.

A domain is optional. A trusted IP-address certificate can cover the stable public IPv4/IPv6. Let's Encrypt supports short-lived IP certificates; renewal must be automated and followed by a service restart to reload credentials. Certbot 5.4+ supports IP HTTP-01 webroot issuance; this needs TCP80 reachable during issuance/renewal and a challenge responder. The existing 443 rule does not automatically make HTTP-01 work. Do not silently agree to CA terms, request certificates or open TCP80; prepare and confirm certificate provisioning first. See [official guidance](https://letsencrypt.org/2026/03/11/shorter-certs-certbot). Alternatively provision a trusted certificate through an explicitly agreed process.

Check `systemd-analyze verify deploy/elyvara-signaling.service`, install and `systemctl daemon-reload`, then `systemctl enable --now elyvara-signaling` only once credentials exist. Validate `https://<IPv4>/healthz` and `https://[<IPv6>]/healthz` with normal certificate validation; run real room workflow over WSS from the home probe host, not the company Windows machine. A TCP connection test is not WSS acceptance.

## STUN only

Use Ubuntu's maintained `coturn` package. Check no preexisting Coturn instance/config needs preserving; mask its default service before package installation so a default TURN instance cannot start. Install `deploy/stun.conf` as `/etc/elyvara/stun.conf` and the dedicated unit, then `systemctl daemon-reload && systemctl enable --now elyvara-stun`.

`stun-only` disables all TURN processing. Do not combine `no-udp-relay` with `no-tcp-relay`: Coturn 4.6.1 rejects that combination before startup; those transport switches are not a substitute for STUN-only mode. Only UDP3478 is intended; no TCP3478/5349 or relay range. This is address discovery, not a media fallback. Verify the installed version accepts every option before activation; inspect actual listeners and test a real Binding transaction and denied/ignored Allocate request, from the home host over IPv4 and IPv6. A denied allocation is useful evidence alongside the active config, not proof about every possible request.

Raw Coturn application output is discarded by this initial privacy-preserving unit, while systemd still reports service state/failures. Do not enable verbose peer-address logging by default. Observe service resource use and cloud traffic; STUN is public UDP and needs bounded usage/monitoring. Do not enable RFC5780 or legacy amplification features unless separately justified. Current scope makes no exact NAT-type classification claim.

## Network and rollback

Allow inbound TCP443 and UDP3478 for configured address families in cloud and host rules. Keep existing SSH access. No media relay ports. Record proxy mode independently; successful direct-style requests do not exclude a transparent proxy. Bandwidth/real-friend tests belong to M0.5.

Stopping either dedicated unit affects only Elyvara: `systemctl disable --now elyvara-signaling elyvara-stun`. Do not unmask/start the default Coturn service as rollback. Keep previous release, update `current` to its explicit commit and restart only the signaling unit when reverting a code release. Rooms are in-memory and lost on restart; communicate this before maintenance. Never remove unrelated firewall rules or services.
