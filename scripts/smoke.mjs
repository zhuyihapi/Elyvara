import { spawn } from "node:child_process";
import electron from "electron";
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ["scripts/smoke-main.mjs"], { stdio: "inherit", windowsHide: true, env });
child.on("error", () => process.exit(1));
child.on("exit", (code) => process.exit(code ?? 1));
