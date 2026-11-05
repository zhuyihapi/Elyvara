import { cp, mkdir } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const target = new URL("dist/apps/desktop/renderer/", root);
await mkdir(target, { recursive: true });
await cp(new URL("apps/desktop/renderer/", root), target, { recursive: true });
await cp(new URL("apps/desktop/src/preload.cjs", root), new URL("dist/apps/desktop/src/preload.cjs", root));
