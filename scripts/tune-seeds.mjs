// Tunes seed geometry: for each seed, calls window.__solenoidTuneSeed(id) on the running dev server
// (per-group tidy, autofit, then a whole-canvas Tidy, with painted DOM sizes) and patches only node x/y
// and group width/height back into src/graph/seedGraphs/<id>.json, leaving ids and every other field.
// URL and CHROME point a worktree at its own server and browser; NO_SANDBOX=1 allows running as root.
//   node scripts/tune-seeds.mjs                     # all seeds
//   node scripts/tune-seeds.mjs cubes table-verbs   # a subset
// WORKERS sets how many browsers tune at once (default: up to 4, one per core).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { browserPath } from "./browser.mjs";

const EDGE = browserPath();
const URL = process.env.URL ?? "http://localhost:1420";
const NO_SANDBOX = process.env.NO_SANDBOX === "1" || process.env.NO_SANDBOX === "true";
const seedsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "graph", "seedGraphs");

/** One browser per worker, so the tunes run on separate cores; each worker pulls seeds off the shared queue. */
const WORKERS = Math.max(1, Number(process.env.WORKERS ?? Math.min(4, os.availableParallelism())));

async function openTuner(logs) {
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--window-size=1700,1100", ...(NO_SANDBOX ? ["--no-sandbox", "--disable-setuid-sandbox"] : [])] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1700, height: 1100 });
  page.setDefaultTimeout(300000);
  page.on("console", (m) => { if (m.type() === "error") logs.push(`[console.error] ${m.text()}`); });
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(URL, { waitUntil: "networkidle2" });
  // The first tune waits out the startup seed's pass itself.
  await page.waitForFunction(() => typeof window.__solenoidTuneSeed === "function" && !!document.querySelector(".solenoid-node"), { timeout: 60000, polling: 50 });
  return { browser, page };
}

const main = async () => {
  const logs = [];
  // A seed's id is its file's name, so every browser can open at once.
  const all = fs.readdirSync(seedsDir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
  const wanted = process.argv.slice(2);
  const ids = wanted.length ? wanted : all;
  for (const id of wanted) if (!all.includes(id)) throw new Error(`unknown seed "${id}" (have: ${all.join(", ")})`);
  const tuners = await Promise.all(Array.from({ length: Math.min(WORKERS, ids.length) }, () => openTuner(logs)));
  try {

    // Write files only at the end: the seeds are Vite-watched, so a mid-run write reloads the page.
    const results = new Map();
    // Biggest first, so the long tunes start early instead of finishing alone at the end.
    const weight = (id) => fs.statSync(path.join(seedsDir, `${id}.json`)).size;
    const queue = [...ids].sort((a, b) => weight(b) - weight(a));
    await Promise.all(tuners.map(async ({ page }) => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        results.set(id, await page.evaluate((sid) => window.__solenoidTuneSeed(sid), id));
        console.log(`tuned ${id}`);
      }
    }));

    if (logs.length) {
      console.log("--- page errors during the run ---");
      console.log([...new Set(logs)].join("\n"));
    }

    for (const id of ids) {
      const geom = results.get(id);
      const file = path.join(seedsDir, `${id}.json`);
      const seed = JSON.parse(fs.readFileSync(file, "utf8"));
      let moved = 0, resized = 0, missing = 0;
      for (const node of seed.nodes) {
        const g = geom[node.id];
        if (!g) { missing++; continue; }
        if (node.x !== g.x || node.y !== g.y) { node.x = g.x; node.y = g.y; moved++; }
        if (node.type === "GroupNode" && g.width !== undefined && g.height !== undefined) {
          if (node.init.width !== g.width || node.init.height !== g.height) {
            node.init.width = g.width;
            node.init.height = g.height;
            resized++;
          }
        }
      }
      if (moved || resized) fs.writeFileSync(file, JSON.stringify(seed, null, 2) + "\n");
      console.log(`${id}: ${moved} moved, ${resized} groups resized${missing ? `, ${missing} not mapped` : ""}${moved || resized ? "" : " (unchanged)"}`);
    }
  } finally {
    await Promise.all(tuners.map((t) => t.browser.close()));
  }
};

main().catch((e) => { console.error(e); process.exit(1); });
