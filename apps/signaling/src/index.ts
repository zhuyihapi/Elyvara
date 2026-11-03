import { readFileSync } from "node:fs";
import { createServer as http } from "node:http";
import { createServer as https } from "node:https";
import { startSignaling } from "./server.js";
const port = Number(process.env.PORT ?? "8080");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
const host = process.env.HOST ?? "127.0.0.1";
const cert = process.env.TLS_CERT;
const key = process.env.TLS_KEY;
if (Boolean(cert) !== Boolean(key)) throw new Error("Configure TLS_CERT and TLS_KEY together");
if (!cert && !["127.0.0.1", "::1"].includes(host)) throw new Error("Public listeners require TLS");
const server = cert && key ? https({ cert: readFileSync(cert), key: readFileSync(key), minVersion: "TLSv1.2" }) : http();
const service = startSignaling(server);
server.listen(port, host, () => console.log(`Signaling listening on port ${port}; TLS=${Boolean(cert)}`));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  service.close(); server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
});
