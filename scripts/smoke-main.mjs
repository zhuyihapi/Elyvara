import assert from "node:assert/strict";
import { app } from "electron";
const timeout = setTimeout(() => { console.error("Desktop smoke timed out."); app.exit(1); }, 15000);
app.on("web-contents-created", (_event, contents) => {
  contents.once("did-finish-load", async () => {
    try {
      const prefs = contents.getLastWebPreferences();
      assert.equal(prefs.contextIsolation, true);
      assert.equal(prefs.sandbox, true);
      assert.equal(prefs.nodeIntegration, false);
      const result = await contents.executeJavaScript("({ title: document.title, node: typeof process, require: typeof require, csp: !!document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]') })");
      assert.deepEqual(result, { title: "Elyvara", node: "undefined", require: "undefined", csp: true });
      assert.equal(await contents.executeJavaScript("typeof window.elyvara?.connect"), "function");
      assert.equal(await contents.executeJavaScript("document.querySelector('#create').disabled"), true);
      console.log("Desktop smoke passed: local renderer loaded; isolation, sandbox, CSP and absent renderer Node verified.");
      clearTimeout(timeout);
      app.exit(0);
    } catch (error) {
      console.error(error);
      clearTimeout(timeout);
      app.exit(1);
    }
  });
});
await import("../dist/apps/desktop/src/main.js");
