import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { app } from "electron";

async function until(description, check, timeout = 15000) {
  const deadline = Date.now() + timeout;
  do {
    if (await check()) return;
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error(description);
}

const { desktopReady, createDesktopWindow } = await import("../dist/apps/desktop/src/main.js");
const timeout = setTimeout(() => app.exit(1), 90000);
async function verify() {
  const first = await desktopReady;
  const windows = [first];
  for (let i = 0; i < 3; i++) windows.push(await createDesktopWindow(false));
  const [host, ...guests] = windows.map((window, index) => {
    const run = expression => window.webContents.executeJavaScript(expression);
    return {
      run,
      connect: () => run(`document.querySelector("#endpoint").value = ${JSON.stringify("ws://127.0.0.1:" + process.env.ELYVARA_SMOKE_PORT + "/ws")}; document.querySelector("#nickname").value = "Peer ${index}"; document.querySelector("#connect").click();`),
    };
  });
  await Promise.all([host, ...guests].map(async peer => {
    await peer.connect();
    await until("Signaling session was not established", () => peer.run('document.querySelector("#signal-status").textContent === "信令已连接"'));
  }));
  await host.run('document.querySelector("#create").click()');
  await until("Host did not receive the invite", () => host.run('Boolean(document.querySelector("#invite").value)'));
  const invite = await host.run('document.querySelector("#invite").value');
  for (const guest of guests) {
    await guest.run(`document.querySelector("#invite").value = ${JSON.stringify(invite)}; document.querySelector("#join").click();`);
    await until("Host did not receive join request", () => host.run('Boolean(document.querySelector("#requests button"))'));
    await host.run('document.querySelector("#requests button").click()');
    await until("Guest did not join", () => guest.run('document.querySelector("#room-status").textContent.includes("已入房")'));
  }
  await until("Six peer pairs did not establish host candidate paths", async () =>
    (await Promise.all([host, ...guests].map(peer => peer.run(
      'document.querySelectorAll("#members article").length === 3 && [...document.querySelectorAll("#members article p")].every(el => el.textContent.includes("connected · host → host"))',
    )))).every(Boolean), 25000);
  await host.run('document.querySelector("#stream").click()');
  await until("Synthetic video did not reach all three guests", async () =>
    (await Promise.all(guests.map(peer => peer.run('[...document.querySelectorAll("#members video")].some(video => video.videoWidth === 640 && video.currentTime > 0)')))).every(Boolean), 20000);
  const exported = await host.run(`(async () => {
    const create = URL.createObjectURL;
    const click = HTMLAnchorElement.prototype.click;
    let capture;
    URL.createObjectURL = blob => { capture = blob.text(); return create(blob); };
    HTMLAnchorElement.prototype.click = function () { if (!this.download) click.call(this); };
    try { document.querySelector("#export").click(); return await capture; }
    finally { URL.createObjectURL = create; HTMLAnchorElement.prototype.click = click; }
  })()`);
  const report = JSON.parse(exported);
  assert.equal(report.peers.length, 3);
  assert.equal(report.proxyPath, "unknown");
  assert(report.peers.every(peer => peer.path?.local === "host"));
  assert(!/roomId|peerId|token|nickname|127\.0\.0\.1|sdp|Peer 0/.test(exported));
  await host.run('document.querySelector("#stream").click()');
  await guests[0].run('document.querySelector("#leave").click()');
  await until("Peer departure was not reflected", () => host.run('document.querySelectorAll("#members article").length === 2'));
  await until("Departing peer did not clear its room", () => guests[0].run('document.querySelector("#room-status").textContent === "未加入房间"'));
  assert.equal(await guests[0].run('document.querySelectorAll("#members article").length'), 0);
  console.log("Mesh smoke passed: four Electron clients, six host paths, synthetic video to three receivers, redacted export and leave cleanup.");
}
verify().then(() => {
  clearTimeout(timeout);
  app.exit(0);
}).catch(error => {
  console.error(error);
  clearTimeout(timeout);
  app.exit(1);
});
