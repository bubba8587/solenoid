// Per-card DOM census for the backlog "Per-card CSS conversion" sweep, STEP 1.
// Drives the running Vite dev server (port 1420) with system Edge headless and calls
// the in-app hook window.__solenoidCardCensus() (census.ts), which mounts one card of
// every catalog node type, walks its DOM, and splits each element into "carries a value
// or a handler" vs "paint only" (a decorative div/svg step 2 could move to CSS). Prints a
// per-card table (biggest paint-only cards first) plus the aggregate paint-only class
// histogram — the step-2 conversion targets. Pure measurement; nothing is written.
//
//   node scripts/card-css-census.mjs
import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const URL = "http://localhost:1420";

const main = async () => {
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--window-size=1700,1100"] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1700, height: 1100 });
    page.setDefaultTimeout(300000);
    page.on("pageerror", (e) => console.error(`[pageerror] ${e.message}`));

    await page.goto(URL, { waitUntil: "networkidle2" });
    await page.waitForFunction(() => typeof window.__solenoidCardCensus === "function", { timeout: 60000 });
    await page.waitForSelector(".solenoid-node", { timeout: 60000 });
    await new Promise((r) => setTimeout(r, 3000));

    const { rows, paintTotals } = await page.evaluate(() => window.__solenoidCardCensus());

    rows.sort((a, b) => b.paintOnly - a.paintOnly);
    const sum = (k) => rows.reduce((t, r) => t + r[k], 0);

    console.log(`\nPer-card DOM census — ${rows.length} card types measured on the live dev page`);
    console.log(`Totals across all cards: ${sum("total")} elements, ${sum("valueOrHandler")} carry a value/handler, ${sum("paintOnly")} paint-only`);
    console.log(`(charts/popups mount recharts lazily, so figure interiors are under-counted — this is the CHROME census)\n`);

    console.log("Top 30 cards by paint-only element count:");
    console.log("paint  value  total  root                              type");
    for (const r of rows.slice(0, 30)) {
      console.log(
        `${String(r.paintOnly).padStart(5)}  ${String(r.valueOrHandler).padStart(5)}  ${String(r.total).padStart(5)}  ${String(r.root).padEnd(32)}  ${r.type}`,
      );
    }

    const paints = Object.entries(paintTotals).sort((a, b) => b[1] - a[1]);
    console.log(`\nPaint-only elements by class, across all cards (top 30 of ${paints.length}) — the step-2 targets:`);
    console.log("count  tag.class");
    for (const [k, n] of paints.slice(0, 30)) console.log(`${String(n).padStart(5)}  ${k}`);

    console.log("\nJSON:", JSON.stringify({ rows, paintTotals }));
  } finally {
    await browser.close();
  }
};
main().catch((e) => { console.error(e); process.exit(1); });
