// Starts the Vite dev server detached and exits once it answers, so the launching task finishes.
// Idempotent. Spawns `node <vite bin>` directly, never `npm run dev` through a shell: on Windows
// cmd.exe tied the server to the caller's console, so its Ctrl-C killed the server too.
//   node scripts/dev-up.mjs [--port N | --port=N] [extra vite args…]      stop with: pkill -f '[v]ite'
import { spawn } from "node:child_process";
import { openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const passthrough = process.argv.slice(2);
const portIdx = passthrough.findIndex((a) => a === "--port" || a.startsWith("--port="));
const portArg = portIdx < 0 ? null : passthrough[portIdx] === "--port" ? passthrough[portIdx + 1] : passthrough[portIdx].slice("--port=".length);
const port = portArg ? Number(portArg) : 1420;

const URL_ = `http://localhost:${port}`;
const LOG = join(tmpdir(), "solenoid-dev.log");
const TIMEOUT_MS = 60_000;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const VITE_BIN = join(ROOT, "node_modules/vite/bin/vite.js");

function failWithLogTail(why) {
  console.error(`${why} — log tail (${LOG}):`);
  try { console.error(readFileSync(LOG, "utf8").split("\n").slice(-25).join("\n")); } catch {}
  process.exit(1);
}

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
  cwd: ROOT,
  detached: true,
  windowsHide: true,
  stdio: ["ignore", log, log],
});
child.unref();
// strictPort makes Vite exit at once when the port is taken, so there is nothing to wait for.
child.on("exit", (code) => failWithLogTail(`dev server exited early (code ${code})`));

const t0 = Date.now();
while (Date.now() - t0 < TIMEOUT_MS) {
  if (await up()) {
    console.log(`up: ${URL_} (pid ${child.pid}, log ${LOG})`);
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 500));
}
failWithLogTail(`dev server did not answer within ${TIMEOUT_MS / 1000}s`);
