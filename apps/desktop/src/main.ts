import { app, BrowserWindow, session } from "electron";
import { fileURLToPath } from "node:url";

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const window = new BrowserWindow({
    width: 960,
    height: 640,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  await window.loadFile(fileURLToPath(new URL("../renderer/index.html", import.meta.url)));
}).catch(() => {
  console.error("Desktop startup failed.");
  app.exit(1);
});
app.on("window-all-closed", () => app.quit());
