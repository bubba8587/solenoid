// Launch the string-editor: kill any running instance on port 5599, start a FRESH
// server (so the latest code is always served), wait until it answers, then pop the
// browser window open. Not idempotent by design — every run gives a new instance.
// Usage: node tools/string-editor/up.mjs
import { spawn, execSync } from "node:child_process";
import { openSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 5599;
const URL_ = `http://localhost:${PORT}`;
const LOG = join(tmpdir(), "solenoid-string-editor.log");
const TIMEOUT_MS = 30_000;

async function answers() {
  try {
    const r = await fetch(URL_, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

// Kill whatever is listening on PORT, regardless of how it was started.
function killOnPort() {
  try {
    if (process.platform === "win32") {
      const out = execSync("netstat -ano", { encoding: "utf8" });
      const pids = new Set();
      for (const line of out.split("\n")) {
        if (!line.includes(`:${PORT}`)) continue;
        if (!/LISTENING/i.test(line)) continue;
        const pid = line.trim().split(/\s+/).pop();
        if (/^\d+$/.test(pid) && pid !== "0") pids.add(pid);
      }
      for (const pid of pids) {
        try { execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" }); } catch {}
      }
    } else {
      try { execSync(`lsof -ti tcp:${PORT} | xargs kill`, { stdio: "ignore", shell: "/bin/sh" }); } catch {}
    }
  } catch {
    // no matching listener / tool missing — nothing to kill
  }
}

// 1. Kill any existing instance, then wait until the port stops answering.
killOnPort();
{
  const t0 = Date.now();
  while (Date.now() - t0 < 5_000) {
    if (!(await answers())) break;
    await new Promise((r) => setTimeout(r, 200));
  }
}

// Dependencies guard.
if (!existsSync(join(HERE, "node_modules"))) {
  console.error(`dependencies missing — run first:  cd tools/string-editor && npm install`);
  process.exit(1);
}

// 2. Start the server fresh, detached.
const log = openSync(LOG, "a");
const child = spawn("node server.mjs", { cwd: HERE, shell: true, detached: true, stdio: ["ignore", log, log] });
child.unref();

// 3. Wait until it answers.
const t0 = Date.now();
let ok = false;
while (Date.now() - t0 < TIMEOUT_MS) {
  if (await answers()) { ok = true; break; }
  await new Promise((r) => setTimeout(r, 400));
}

if (!ok) {
  console.error(`string-editor did not answer within ${TIMEOUT_MS / 1000}s — log tail (${LOG}):`);
  try { console.error(readFileSync(LOG, "utf8").split("\n").slice(-25).join("\n")); } catch {}
  process.exit(1);
}

// 4. Open a browser window (best effort).
try {
  let cmd, args;
  if (process.platform === "win32") { cmd = "cmd"; args = ["/c", "start", "", URL_]; }
  else if (process.platform === "darwin") { cmd = "open"; args = [URL_]; }
  else { cmd = "xdg-open"; args = [URL_]; }
  const opener = spawn(cmd, args, { detached: true, stdio: "ignore" });
  opener.unref();
} catch {
  // headless / no browser — the URL is printed below regardless
}

console.log(`up: ${URL_} (pid ${child.pid}, log ${LOG})`);
process.exit(0);
