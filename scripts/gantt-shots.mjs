// Gantt figure screenshotter — the author's eyeball tool. Drives the running Vite dev server
// (port 1420) with system Edge, loads each Gantt seed via the in-app hook
// window.__solenoidTuneSeed(id), and writes PNGs to .dev/shots/gantt/ in BOTH themes (toggled
// through the app's own moon/sun button, since the theme store re-applies its saved mode):
//   <seed>-<theme>-canvas.png     the whole canvas
//   <seed>-<theme>-display-N.png  each on-canvas Gantt/Calendar figure
//   <seed>-<theme>-popup.png      the first chart chip expanded
//
// Seeds are auto-detected (any seed JSON with a GanttNode); pass ids to limit the set.
//   node scripts/gantt-shots.mjs                         # all Gantt seeds, both themes
//   node scripts/gantt-shots.mjs product-launch-gantt    # one seed
//   URL=http://localhost:1421 CHROME=<chromium> node scripts/gantt-shots.mjs   # a worktree's own server
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const EDGE = process.env.CHROME ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const URL = process.env.URL ?? "http://localhost:1420";
const NO_SANDBOX = process.env.NO_SANDBOX === "1" || process.env.NO_SANDBOX === "true";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const seedsDir = path.join(root, "src", "graph", "seedGraphs");
const outDir = path.join(root, ".dev", "shots", "gantt");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ganttSeeds() {
  return fs
    .readdirSync(seedsDir)
    .filter((f) => f.endsWith(".json") && fs.readFileSync(path.join(seedsDir, f), "utf8").includes("GanttNode"))
    .map((f) => f.replace(/\.json$/, ""));
}

async function currentTheme(page) {
  return page.evaluate(() => document.documentElement.getAttribute("data-theme") || "dark");
}
async function ensureTheme(page, want) {
  for (let i = 0; i < 3 && (await currentTheme(page)) !== want; i++) {
    const btn = await page.$('[aria-label="Toggle light and dark theme"]');
    if (!btn) break;
    await btn.click();
    await sleep(450);
  }
  return (await currentTheme(page)) === want;
}

async function shotSeed(page, seed) {
  await page.evaluate((id) => window.__solenoidTuneSeed(id), seed);
  await sleep(3000);
  const fit = await page.$(".react-flow__controls-fitview");
  if (fit) { await fit.click(); await sleep(800); }

  for (const theme of ["dark", "light"]) {
    if (!(await ensureTheme(page, theme))) console.log(`  ! could not switch to ${theme}`);
    await sleep(400);
    await page.screenshot({ path: path.join(outDir, `${seed}-${theme}-canvas.png`) });

    // Each on-canvas figure (Gantt timeline and/or calendar) as a Display shot.
    const figures = await page.$$(".solenoid-gantt");
    for (let i = 0; i < figures.length; i++) {
      try { await figures[i].screenshot({ path: path.join(outDir, `${seed}-${theme}-display-${i + 1}.png`) }); } catch { /* off-screen */ }
    }

    // Expand the first chart chip into the popup.
    const box = await page.evaluate(() => {
      const chip = document.querySelector(".solenoid-array-chip--chart");
      if (!chip) return null;
      const r = chip.getBoundingClientRect();
      return r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    });
    if (box) {
      await page.mouse.click(box.x, box.y);
      await sleep(1100);
      const pop = await page.$(".sol-popup");
      if (pop) {
        await sleep(400);
        await pop.screenshot({ path: path.join(outDir, `${seed}-${theme}-popup.png`) });
        const close = await page.$(".sol-popup__close");
        if (close) { await close.click(); await sleep(400); }
      } else {
        console.log(`  ! popup did not open (${theme})`);
      }
    }
  }
}

const main = async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const seeds = process.argv.slice(2).length ? process.argv.slice(2) : ganttSeeds();
  if (!seeds.length) { console.log("No Gantt seeds found."); return; }
  console.log(`Gantt seeds: ${seeds.join(", ")}`);

  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: false,
    args: ["--window-size=1700,1150", ...(NO_SANDBOX ? ["--no-sandbox", "--disable-setuid-sandbox"] : [])],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1700, height: 1100 });
    page.setDefaultTimeout(120000);
    const logs = [];
    page.on("console", (m) => { if (m.type() === "error") logs.push(`[console.error] ${m.text()}`); });
    page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

    await page.goto(URL, { waitUntil: "networkidle2" });
    await page.waitForFunction(() => typeof window.__solenoidTuneSeed === "function", { timeout: 60000 });
    await page.waitForSelector(".solenoid-node", { timeout: 60000 });
    await sleep(3500);

    for (const seed of seeds) {
      console.log(`• ${seed}`);
      try { await shotSeed(page, seed); } catch (e) { console.log(`  ! ${seed}: ${e.message}`); }
    }
    if (logs.length) console.log("Page logs:\n" + logs.join("\n"));
    console.log(`\nPNGs → ${path.relative(root, outDir)}`);
  } finally {
    await browser.close();
  }
};
main().catch((e) => { console.error(e); process.exit(1); });
