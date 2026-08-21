// Start the string-editor server DETACHED and exit only once it actually answers —
// so the launching task finishes instead of living forever as "running".
// Usage: node tools/string-editor/up.mjs   (idempotent: an already-up server is a no-op)
// Stop it later with: pkill -f '[s]erver.mjs'
import { spawn } from "node:child_process";
import { openSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const URL_ = "http://localhost:5599";
const LOG = join(tmpdir(), "solenoid-string-editor.log");
const TIMEOUT_MS = 30_000;

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

if (!existsSync(join(HERE, "node_modules"))) {
  console.error(`dependencies missing — run first:  cd tools/string-editor && npm install`);
  process.exit(1);
}

const log = openSync(LOG, "a");
const child = spawn("node server.mjs", { cwd: HERE, shell: true, detached: true, stdio: ["ignore", log, log] });
child.unref();

const t0 = Date.now();
while (Date.now() - t0 < TIMEOUT_MS) {
  if (await up()) {
    console.log(`up: ${URL_} (pid ${child.pid}, log ${LOG})`);
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 400));
}
console.error(`string-editor did not answer within ${TIMEOUT_MS / 1000}s — log tail (${LOG}):`);
const { readFileSync } = await import("node:fs");
try { console.error(readFileSync(LOG, "utf8").split("\n").slice(-25).join("\n")); } catch {}
process.exit(1);
