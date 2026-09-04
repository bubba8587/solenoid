// Does Tidy converge? Presses T on a seed twice (answering the confirm with Enter) and
// diffs every node's model position between the two runs. Also pins the modal guard:
// the confirm's Enter must not open the Command Palette behind it.
//
//   node scripts/tidy-drift-probe.mjs [seed-id ...]     (dev server on :1420)
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME ??
  `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe`;
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const SEEDS = process.argv.length > 2 ? process.argv.slice(2) : ["getting-started", "table-verbs", "unit-flow"];
const TOL = 0.5;

const browser = await puppeteer.launch({
  headless: true,
  executablePath: CHROME,
  args: ["--window-size=1600,1000"],
  defaultViewport: { width: 1600, height: 1000 },
});
let failures = 0;
try {
  const page = await browser.newPage();
  await page.goto("http://localhost:1420", { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__spike, { timeout: 20000 });

  const tidy = async () => {
    await page.mouse.click(30, 960); await wait(100);           // focus the pane, clear selection
    await page.keyboard.press("t"); await wait(300);
    const confirm = await page.evaluate(() => !!document.querySelector(".solenoid-confirm__overlay"));
    if (confirm) { await page.keyboard.press("Enter"); await wait(200); }
    const paletteOpen = await page.evaluate(() => !!document.querySelector("[class*='solenoid-cmdpalette']"));
    await wait(3000);
    return { confirm, paletteOpen };
  };
  const positions = () => page.evaluate(() => Object.fromEntries(window.__spike.positions().map((p) => [p.id, [p.x, p.y, p.label]])));

  for (const seed of SEEDS) {
    await page.evaluate((id) => window.__spike.seed(id), seed);
    await page.waitForFunction(() => window.__spike.revealPhase() === "idle", { timeout: 20000 });
    await wait(1200);
    const first = await tidy();
    const a = await positions();
    const second = await tidy();
    const b = await positions();
    const moved = [];
    for (const [id, [x, y, label]] of Object.entries(a)) {
      const q = b[id];
      if (!q) continue;
      const dx = q[0] - x, dy = q[1] - y;
      if (Math.abs(dx) > TOL || Math.abs(dy) > TOL) moved.push(`${label}: ${dx.toFixed(1)},${dy.toFixed(1)}`);
    }
    const guardOk = !first.paletteOpen && !second.paletteOpen;
    console.log(`${seed}: confirm=${first.confirm} palette-after-Enter=${first.paletteOpen || second.paletteOpen} drift=${moved.length ? moved.length + " node(s)" : "none"}`);
    for (const m of moved) console.log("  " + m);
    if (moved.length || !guardOk) failures++;
  }
  console.log(failures === 0 ? "CLEAN: Tidy is a fixed point on re-run and the confirm's Enter stays in the modal" : `${failures} seed(s) with drift or a leaked Enter`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  await browser.close();
}
