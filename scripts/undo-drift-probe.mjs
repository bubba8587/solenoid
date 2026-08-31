// Undo position-fidelity smoke (backlog 2026-08-27: "undo of a nudge leaves one node
// 1px off"). Loads the getting-started seed on the REAL dev-server page, Ctrl+A →
// ArrowRight → zoom change → Ctrl+Z, then diffs model positions against the pre-nudge
// baseline. The zoom step matters: the post-restore FC re-dock re-measures at the
// CURRENT camera, which is what flipped an un-quantized .5 rounding boundary
// (fcDocking.ts computeDockedCanvasPos — the half-px offset snap is the fix this pins).
// Node ids change across a loadGraph rebuild, so groups of same-labeled nodes compare
// as position multisets.
//
//   node scripts/undo-drift-probe.mjs        (dev server on :1420)
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME ??
  `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe`;
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
  await wait(1200); // load RAFs + FC re-dock + history baseline settle

  const read = () => page.evaluate(() => window.__spike.positions());
  const baseline = await read();

  await page.mouse.click(800, 500);
  await page.keyboard.down("Control"); await page.keyboard.press("KeyA"); await page.keyboard.up("Control");
  await wait(100);
  await page.keyboard.press("ArrowRight");
  await wait(800); // past flowHistory's 400ms coalesce

  await page.evaluate(() => window.__spike.zoomNode("Format", 1.37));
  await wait(200);

  await page.keyboard.down("Control"); await page.keyboard.press("KeyZ"); await page.keyboard.up("Control");
  await wait(1500); // restore + RAFs + re-dock
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
