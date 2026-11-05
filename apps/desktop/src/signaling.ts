import { ipcMain } from "electron";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { WebSocket } from "ws";
import { networkInterfaces } from "node:os";
import { clientMessage } from "../../../packages/protocol/src/index.js";

type Handler = (event: IpcMainInvokeEvent, value: unknown) => unknown;
const routes = new Map<string, Map<number, Handler>>();

function register(channel: string, sender: number, handler: Handler) {
  let windows = routes.get(channel);
  if (!windows) {
    windows = new Map();
    routes.set(channel, windows);
    ipcMain.handle(channel, (event, value) => routes.get(channel)?.get(event.sender.id)?.(event, value));
  }
  windows.set(sender, handler);
}

export function bindSignaling(window: BrowserWindow, page: string) {
  const sender = window.webContents.id;
  let socket: WebSocket | undefined;
  const notify = (event: unknown) => {
    if (!window.isDestroyed()) window.webContents.send("signal:event", event);
  };
  const validate = (event: IpcMainInvokeEvent) => {
    if (event.sender !== window.webContents || event.senderFrame?.url !== page ||
      event.senderFrame !== window.webContents.mainFrame) throw new Error("Untrusted sender");
  };
  const disconnect = () => {
    const current = socket;
    socket = undefined;
    current?.terminate();
  };
  register("signal:connect", sender, (event, raw) => {
    validate(event);
    if (typeof raw !== "string" || raw.length > 512) return false;
    let url: URL;
    try { url = new URL(raw); } catch { return false; }
    const loopback = ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
    if ((url.protocol !== "wss:" && !(url.protocol === "ws:" && loopback)) ||
        url.pathname !== "/ws" || url.username || url.password || url.search || url.hash) return false;
    disconnect();
    const current = new WebSocket(url, { handshakeTimeout: 8000, maxPayload: 65536, perMessageDeflate: false });
    socket = current;
    current.on("open", () => { if (socket === current) notify({ state: "open" }); });
    void window.webContents.session.resolveProxy(url.href).then(value => {
      if (socket !== current) return;
      const hint = /^(PROXY|HTTPS?|SOCKS\d?)\s/i.test(value) ? "proxy-configured" : value === "DIRECT" ? "direct-setting" : "unknown";
      const virtualAdapter = Object.keys(networkInterfaces()).some(name => /clash|mihomo|wintun|wireguard|\btun\b/i.test(name));
      notify({ state: "proxy", hint, virtualAdapter });
    }).catch(() => { if (socket === current) notify({ state: "proxy", hint: "unknown" }); });
    current.on("message", (data, binary) => {
      if (socket !== current || binary) return;
      try { notify({ message: JSON.parse(data.toString()) }); } catch { current.close(1007); }
    });
    current.on("error", () => { if (socket === current) notify({ state: "failed" }); });
    current.on("close", () => {
      if (socket !== current) return;
      socket = undefined;
      notify({ state: "closed" });
    });
    return true;
  });
  register("signal:disconnect", sender, event => { validate(event); disconnect(); });
  register("signal:send", sender, (event, value) => {
    validate(event);
    const result = clientMessage.safeParse(value);
    if (!result.success || socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > 262144) return false;
    const body = JSON.stringify(result.data);
    if (Buffer.byteLength(body) > 65536) return false;
    socket.send(body);
    return true;
  });
  window.once("closed", () => {
    disconnect();
    for (const windows of routes.values()) windows.delete(sender);
  });
}
