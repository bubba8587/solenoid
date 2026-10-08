// Sweeps every catalog card through window.__solenoidCollapseSweep() (collapseSweep.ts): mounts it, measures each
// socket expanded and collapsed against the collapsed-card rules and React Flow's cable bounds, and prints every
// card that breaks one. Writes nothing. Needs the dev server on :1420.
//   node scripts/collapse-sweep.mjs [type…] [--wired] [--empty] [--json out.json]
// --wired adds a pass with a cable into every input; --empty lists the cards whose collapsed body shows nothing.
import fs from "node:fs";
import puppeteer from "puppeteer-core";
import { browserPath } from "./browser.mjs";

const args = process.argv.slice(2);
const jsonAt = args.indexOf("--json");
const jsonOut = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : null;
const wiredAt = args.indexOf("--wired");
const wired = wiredAt >= 0 ? !!args.splice(wiredAt, 1) : false;
const emptyAt = args.indexOf("--empty");
const listEmpty = emptyAt >= 0 ? !!args.splice(emptyAt, 1) : false;
const only = args.length ? args : undefined;

const browser = await puppeteer.launch({ executablePath: browserPath(), headless: true, protocolTimeout: 0, args: ["--no-sandbox", "--window-size=1700,1100"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1700, height: 1100 });
  page.setDefaultTimeout(900000);
  page.on("pageerror", (e) => console.error(`[pageerror] ${e.message}`));
  await page.goto("http://localhost:1420", { waitUntil: "networkidle2" });
  await page.waitForFunction(() => typeof window.__solenoidCollapseSweep === "function", { timeout: 60000 });
  await page.waitForSelector(".solenoid-node", { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 3000));
  if (wired) await page.evaluate(() => { window.__sweepWired = true; });
  const rows = await page.evaluate((only) => window.__solenoidCollapseSweep(only), only);
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(rows, null, 1));
  if (listEmpty) {
    const empty = rows.filter((r) => !r.shows);
    console.log(`${empty.length} cards show nothing collapsed:`);
    for (const r of empty) console.log(`  ${r.type}  (${r.inputs} in, ${r.outputs} out)`);
    console.log("");
  }
  const bad = rows.filter((r) => r.expanded.length || r.collapsed.length || (r.wired ?? []).length);
  console.log(`${rows.length} cards swept, ${bad.length} break a rule\n`);
  for (const r of bad) {
    console.log(`${r.type}  (${r.inputs} in, ${r.outputs} out)`);
    for (const m of r.expanded) console.log(`   expanded:  ${m}`);
    for (const m of r.collapsed) console.log(`   collapsed: ${m}`);
    for (const m of r.wired ?? []) console.log(`   wired:     ${m}`);
  }
} finally {
  await browser.close();
}
