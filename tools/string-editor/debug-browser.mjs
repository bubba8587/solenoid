#!/usr/bin/env node
// Launches Chrome/Edge with remote debugging on, so the string editor can attach
// to a real tab (scrape source "live") instead of loading the app fresh.
//
// Chrome 136+ ignores --remote-debugging-port when the browser runs on its DEFAULT
// user-data-dir, so we launch a SEPARATE debug profile and seed it with the real
// profile's Local Storage for localhost:1420 — which is where the autosaved
// document lives (documentStore.ts). The debug profile persists between runs, so
// work done in it is kept; --reseed re-copies from the real profile.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = Number(process.env.SOLENOID_CDP_PORT ?? 9222);
const APP_URL = process.env.SOLENOID_APP_URL ?? "http://localhost:1420";
const RESEED = process.argv.includes("--reseed");
const ORIGIN_KEY = "localhost_1420";

const BROWSERS = [
  { name: "Chrome", exe: "C:/Program Files/Google/Chrome/Application/chrome.exe", data: "Google/Chrome/User Data" },
  { name: "Chrome", exe: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", data: "Google/Chrome/User Data" },
  { name: "Edge", exe: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", data: "Microsoft/Edge/User Data" },
  { name: "Edge", exe: "C:/Program Files/Microsoft/Edge/Application/msedge.exe", data: "Microsoft/Edge/User Data" },
];

const die = (msg) => { console.error(msg); process.exit(1); };

async function reachable() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(1500) });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

const already = await reachable();
if (already) {
  console.log(`already debugging: ${already.Browser} on port ${PORT}`);
  console.log(`open ${APP_URL} in it, then hit Rescan in the string editor`);
  process.exit(0);
}

const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
const browser = BROWSERS.find((b) => fs.existsSync(b.exe));
if (!browser) die("no Chrome or Edge found; set SOLENOID_BROWSER to a chromium exe");

const userData = path.join(local, ...browser.data.split("/"));
const debugDir = path.join(local, "solenoid-cdp-profile");

// Which of the real profiles has the app's localStorage? Prefer the one whose
// leveldb actually mentions the app origin.
function leveldbOf(profile) {
  return path.join(userData, profile, "Local Storage", "leveldb");
}
function hasOrigin(dir) {
  if (!fs.existsSync(dir)) return false;
  for (const f of fs.readdirSync(dir)) {
    if (!/\.(ldb|log)$/.test(f) && f !== "MANIFEST-000001") continue;
    try {
      if (fs.readFileSync(path.join(dir, f)).includes(ORIGIN_KEY)) return true;
    } catch { /* locked file, ignore */ }
  }
  return false;
}
const profiles = fs.existsSync(userData)
  ? ["Default", ...fs.readdirSync(userData).filter((d) => /^Profile \d+$/.test(d))]
  : [];
const source = profiles.find((p) => hasOrigin(leveldbOf(p)));

const seedTarget = path.join(debugDir, "Default", "Local Storage", "leveldb");
if (source && (RESEED || !fs.existsSync(seedTarget))) {
  fs.mkdirSync(seedTarget, { recursive: true });
  let copied = 0;
  for (const f of fs.readdirSync(leveldbOf(source))) {
    if (f === "LOCK") continue;
    try { fs.copyFileSync(path.join(leveldbOf(source), f), path.join(seedTarget, f)); copied++; }
    catch { /* held open by the running browser; leveldb recovers from the rest */ }
  }
  console.log(`seeded debug profile from "${source}" (${copied} files)`);
} else if (!source) {
  console.log("note: no saved document found in your browser profile — the debug window starts empty");
}

const child = spawn(browser.exe, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${debugDir}`,
  "--no-first-run",
  "--no-default-browser-check",
  APP_URL,
], { detached: true, stdio: "ignore" });
child.unref();

const deadline = Date.now() + 30000;
let info = null;
while (Date.now() < deadline && !(info = await reachable())) {
  await new Promise((r) => setTimeout(r, 300));
}
if (!info) die(`browser did not expose port ${PORT} within 30s`);

console.log(`debugging: ${info.Browser} on port ${PORT}`);
console.log(`profile: ${debugDir}`);
console.log(`app: ${APP_URL} — now hit Rescan in the string editor (header should read "live tab")`);
