// Seed geometry tuner. Drives the running Vite dev server (port 1420) with
// system Edge headless, calls the in-app hook window.__solenoidTuneSeed(id)
// (seedTune.ts) for each seed — which loads it, runs the real per-group tidy →
// autofit, then a whole-canvas Tidy (the same pass as pressing T), all with
// painted DOM sizes — then patches the returned geometry (node x/y, group
// width/height) back into src/graph/seedGraphs/<id>.json IN PLACE. Ids,
// structure, and every other field are untouched; this is not a re-export
// (serializeGraph would rewrite ids to names).
//
//   node scripts/tune-seeds.mjs             # all seeds
//   node scripts/tune-seeds.mjs cubes pivot-tables   # a subset
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

// Defaults hit the main checkout's dev server with system Edge; a worktree tunes its
// OWN edited seeds by pointing URL at its own dev server (and CHROME at any Chromium).
const EDGE = process.env.CHROME ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const URL = process.env.URL ?? "http://localhost:1420";
const seedsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "graph", "seedGraphs");

const main = async () => {
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--window-size=1700,1100"] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1700, height: 1100 });
    page.setDefaultTimeout(300000);
    const logs = [];
    page.on("console", (m) => { if (m.type() === "error") logs.push(`[console.error] ${m.text()}`); });
    page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

    await page.goto(URL, { waitUntil: "networkidle2" });
    await page.waitForFunction(() => typeof window.__solenoidTuneSeed === "function", { timeout: 60000 });
    // Let the startup seed load (cinematic reveal on a fresh profile) finish
    // before the first tune replaces the graph mid-load.
    await page.waitForSelector(".solenoid-node", { timeout: 60000 });
    await new Promise((r) => setTimeout(r, 4000));

    const all = await page.evaluate(() => window.__solenoidSeedIds());
    const wanted = process.argv.slice(2);
    const ids = wanted.length ? wanted : all;
    for (const id of wanted) if (!all.includes(id)) throw new Error(`unknown seed "${id}" (have: ${all.join(", ")})`);

    // Tune everything FIRST, write files at the END: the seed JSONs are
    // Vite-watched imports, so writing one mid-run triggers an HMR full reload
    // that destroys the page's execution context.
    const results = new Map();
    for (const id of ids) {
      process.stdout.write(`tuning ${id} ... `);
      results.set(id, await page.evaluate((sid) => window.__solenoidTuneSeed(sid), id));
      console.log("done");
    }

    if (logs.length) {
      console.log("--- page errors during the run ---");
      console.log([...new Set(logs)].join("\n"));
    }

    for (const [id, geom] of results) {
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
    await browser.close();
  }
};

main().catch((e) => { console.error(e); process.exit(1); });
