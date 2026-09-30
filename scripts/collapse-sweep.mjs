// Sweeps every catalog card through window.__solenoidCollapseSweep() (collapseSweep.ts): mounts it, measures each
// socket expanded and collapsed against the collapsed-card rules and React Flow's cable bounds, and prints every
// card that breaks one. Writes nothing. Needs the dev server on :1420.
//   node scripts/collapse-sweep.mjs [type…] [--json out.json]
import fs from "node:fs";
import puppeteer from "puppeteer-core";
import { browserPath } from "./browser.mjs";

const args = process.argv.slice(2);
const jsonAt = args.indexOf("--json");
const jsonOut = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : null;
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
  const rows = await page.evaluate((only) => window.__solenoidCollapseSweep(only), only);
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(rows, null, 1));
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
