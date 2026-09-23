// Starts the Vite dev server detached and exits once it answers, so the launching task finishes.
// Idempotent. Spawns `node <vite bin>` directly, never `npm run dev` through a shell: on Windows
// cmd.exe tied the server to the caller's console, so its Ctrl-C killed the server too.
//   node scripts/dev-up.mjs [--port N] [extra vite args…]      stop with: pkill -f '[v]ite'
import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const passthrough = process.argv.slice(2);
const portIdx = passthrough.findIndex((a) => a === "--port");
const port = portIdx >= 0 ? Number(passthrough[portIdx + 1]) : 1420;

const URL_ = `http://localhost:${port}`;
const LOG = join(tmpdir(), "solenoid-dev.log");
const TIMEOUT_MS = 60_000;
const VITE_BIN = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));

async function up() {
  try {
    const r = await fetch(URL_, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

if (await up()) {
  console.log(`already up: ${URL_}`);
  process.exit(0);
}

const log = openSync(LOG, "a");
const child = spawn(process.execPath, [VITE_BIN, ...passthrough], {
  detached: true,
  windowsHide: true,
  stdio: ["ignore", log, log],
});
child.unref();

const t0 = Date.now();
while (Date.now() - t0 < TIMEOUT_MS) {
  if (await up()) {
    console.log(`up: ${URL_} (pid ${child.pid}, log ${LOG})`);
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 500));
}
console.error(`dev server did not answer within ${TIMEOUT_MS / 1000}s — log tail (${LOG}):`);
const { readFileSync } = await import("node:fs");
try { console.error(readFileSync(LOG, "utf8").split("\n").slice(-25).join("\n")); } catch {}
process.exit(1);
