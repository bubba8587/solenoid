// Probes undo position fidelity: on the getting-started seed, Ctrl+A, ArrowRight, a zoom change, Ctrl+Z,
// then compares model positions with the baseline. The zoom step matters because the FC re-dock after
// the restore re-measures at the current camera. Node ids change on rebuild, so same-labeled nodes
// compare as position multisets. Needs the dev server on :1420.
//   node scripts/undo-drift-probe.mjs
import puppeteer from "puppeteer-core";
import { browserPath } from "./browser.mjs";

const CHROME = browserPath();
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

const browser = await puppeteer.launch({
  headless: true,
  executablePath: CHROME,
  args: ["--window-size=1600,1000"],
  defaultViewport: { width: 1600, height: 1000 },
});
try {
  const page = await browser.newPage();
  await page.goto("http://localhost:1420", { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__spike, { timeout: 20000 });
  await page.evaluate(() => window.__spike.seed("getting-started"));
  await page.waitForFunction(() => window.__spike.revealPhase() === "idle", { timeout: 20000 });
  await wait(1200);

  const read = () => page.evaluate(() => window.__spike.positions());
  const baseline = await read();

  await page.mouse.click(800, 500);
  await page.keyboard.down("Control"); await page.keyboard.press("KeyA"); await page.keyboard.up("Control");
  await wait(100);
  await page.keyboard.press("ArrowRight");
  await wait(800); // past flowHistory's 400 ms coalesce

  await page.evaluate(() => window.__spike.zoomNode("Format", 1.37));
  await wait(200);

  await page.keyboard.down("Control"); await page.keyboard.press("KeyZ"); await page.keyboard.up("Control");
  await wait(1500);
  const restored = await read();

  const groups = (rows) => {
    const m = new Map();
    for (const r of rows) {
      const k = `${r.type}|${r.label}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(`${r.x},${r.y}`);
    }
    for (const v of m.values()) v.sort();
    return m;
  };
  const b = groups(baseline), r = groups(restored);
  let drift = 0;
  for (const [k, basePos] of b) {
    const rePos = r.get(k) ?? [];
    if (JSON.stringify(basePos) !== JSON.stringify(rePos)) {
      drift++;
      console.log(`DRIFT ${k} base=[${basePos}] restored=[${rePos}]`);
    }
  }
  console.log(`${baseline.length} nodes in ${b.size} groups`);
  console.log(drift === 0 ? "CLEAN: undo restored every position exactly" : `${drift} group(s) drifted`);
  process.exitCode = drift === 0 ? 0 : 1;
} finally {
  await browser.close();
}
