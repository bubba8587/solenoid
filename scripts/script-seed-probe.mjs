// Probe: load the script-tour seed on the running dev server, screenshot it,
// dump Display readouts + Script errors, and measure the field grip geometry.
import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const URL = "http://localhost:1420";
const OUT = path.dirname(fileURLToPath(import.meta.url));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--window-size=1700,1100"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1700, height: 1100 });
  page.setDefaultTimeout(120000);
  const logs = [];
  page.on("console", (m) => { if (m.type() === "error") logs.push(`[console.error] ${m.text()}`); });
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

  await page.goto(URL, { waitUntil: "networkidle2" });
  await page.waitForFunction(() => typeof window.__solenoidTuneSeed === "function");
  await page.waitForSelector(".solenoid-node");
  await sleep(4000);

  await page.evaluate((sid) => window.__solenoidTuneSeed(sid), "script-tour");
  await sleep(2000);

  // Chrome-aware fit (the nav pill's Fit button).
  const fitBtn = await page.$('[title*="Fit"], [aria-label*="Fit"]');
  if (fitBtn) { await fitBtn.click(); await sleep(800); }

  await page.screenshot({ path: path.join(OUT, "seed-overview.png") });

  // Display readouts + script errors, by card title.
  const readouts = await page.evaluate(() => {
    const out = [];
    for (const card of document.querySelectorAll(".solenoid-node")) {
      const title = card.querySelector(".solenoid-node__label-display, .solenoid-node__label")?.textContent?.trim();
      const err = card.querySelector(".solenoid-expr__error")?.textContent?.trim();
      const val = card.querySelector(".solenoid-node__value, .solenoid-node__result, .solenoid-display__value")?.textContent?.trim();
      const body = err ? undefined : undefined;
      out.push({ title, err, val, text: err ? card.textContent?.trim().slice(0, 200) : undefined });
    }
    return out;
  });
  console.log(JSON.stringify(readouts, null, 1));

  // Grip geometry on the first Script card.
  const geo = await page.evaluate(() => {
    const field = document.querySelector(".solenoid-script__field");
    if (!field) return null;
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
    return {
      field: r(field),
      editor: r(field.querySelector(".sol-js-editor")),
      ta: r(field.querySelector(".sol-js-editor__ta")),
      grip: r(field.querySelector(".solenoid-field-resize")),
      expand: r(field.querySelector(".solenoid-expr__expand")),
    };
  });
  console.log("GEO", JSON.stringify(geo, null, 1));

  // Close-up of the pi Script card, at 4x device pixels so the grip is judgeable.
  await page.setViewport({ width: 1700, height: 1100, deviceScaleFactor: 4 });
  await sleep(500);
  const cards = await page.$$(".solenoid-node");
  for (const c of cards) {
    const t = await c.evaluate((el) => el.textContent || "");
    if (t.includes("Monte Carlo")) { await c.screenshot({ path: path.join(OUT, "script-card.png") }); break; }
  }

  if (logs.length) console.log("--- page errors ---\n" + [...new Set(logs)].join("\n"));
} finally {
  await browser.close();
}
