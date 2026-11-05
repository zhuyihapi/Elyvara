import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import electron from "electron";

const reservation = createServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const { port } = reservation.address();
await new Promise((done, reject) => reservation.close(error => error ? reject(error) : done()));
const binary = process.platform === "win32" ? "signaling.exe" : "signaling";
const server = spawn(resolve("dist/signaling", binary), [], {
  env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), TLS_CERT: "", TLS_KEY: "" },
  stdio: "inherit",
  windowsHide: true,
});
try {
  await once(server, "spawn");
  let ready = false;
  for (let i = 0; i < 50; i++) {
    if (server.exitCode !== null) break;
    try { ready = (await fetch("http://127.0.0.1:" + port + "/healthz", { signal: AbortSignal.timeout(500) })).ok; } catch { /* Wait for listener. */ }
    if (ready) break;
    await delay(100);
  }
  if (!ready) throw new Error("Go signaling did not become ready");
  const env = { ...process.env, ELYVARA_SMOKE_PORT: String(port) };
  delete env.ELECTRON_RUN_AS_NODE;
  const desktop = spawn(electron, ["scripts/mesh-smoke-main.mjs"], { stdio: "inherit", env, windowsHide: true });
  const [code] = await once(desktop, "exit");
  process.exitCode = code ?? 1;
} finally {
  if (server.pid && server.exitCode === null && server.signalCode === null) {
    const stopped = once(server, "exit");
    server.kill();
    await stopped;
  }
}
