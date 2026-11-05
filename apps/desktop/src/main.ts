import { app, BrowserWindow, protocol, session } from "electron";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { bindSignaling } from "./signaling.js";

const page = "elyvara://app/";
protocol.registerSchemesAsPrivileged([{ scheme: "elyvara", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const assets = new Map([
  ["/", "../renderer/index.html"],
  ["/style.css", "../renderer/style.css"],
  ["/client/index.js", "./renderer/index.js"],
  ["/client/mesh.js", "./renderer/mesh.js"],
  ["/client/metrics.js", "./renderer/metrics.js"],
]);

export const desktopReady = app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  protocol.handle("elyvara", async request => {
    const url = new URL(request.url);
    const file = url.hostname === "app" && request.method === "GET" ? assets.get(url.pathname) : undefined;
    if (!file) return new Response(null, { status: 404 });
    const mime = file.endsWith(".html") ? "text/html" : file.endsWith(".css") ? "text/css" : "text/javascript";
    try {
      const data = await readFile(new URL(file, import.meta.url));
      return new Response(new Uint8Array(data), { headers: { "Content-Type": mime + "; charset=utf-8" } });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
  return createDesktopWindow(!process.env.ELYVARA_SMOKE_PORT);
});

export async function createDesktopWindow(show: boolean) {
  const window = new BrowserWindow({
    width: 960,
    height: 640,
    show,
    webPreferences: {
      backgroundThrottling: show,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      preload: fileURLToPath(new URL("./preload.cjs", import.meta.url)),
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  bindSignaling(window, page);
  await window.loadURL(page);
  return window;
}
void desktopReady.catch(() => {
  console.error("Desktop startup failed.");
  app.exit(1);
});
app.on("window-all-closed", () => app.quit());
