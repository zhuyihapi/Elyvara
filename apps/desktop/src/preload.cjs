// Sandboxed Electron preloads use the restricted CommonJS loader.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("elyvara", {
  connect: url => ipcRenderer.invoke("signal:connect", url),
  disconnect: () => ipcRenderer.invoke("signal:disconnect"),
  send: message => ipcRenderer.invoke("signal:send", message),
  onSignal: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("signal:event", listener);
    return () => ipcRenderer.removeListener("signal:event", listener);
  },
});
