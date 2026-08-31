// Probe: open the Function Reference's Socket Types tab and screenshot it.
import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const OUT = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--window-size=1700,1100"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1700, height: 1100 });
  page.setDefaultTimeout(120000);
  const logs = [];
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto("http://localhost:1420", { waitUntil: "networkidle2" });
  await page.waitForSelector(".solenoid-node");
  await sleep(3000);
  await page.keyboard.down("Control");
  await page.keyboard.press("/");
  await page.keyboard.up("Control");
  await sleep(800);
  const tabs = await page.$$(".solenoid-fr button, .fr-tabs button, button");
  for (const t of tabs) {
    const txt = await t.evaluate((el) => el.textContent || "");
    if (txt.trim() === "Socket Types") { await t.click(); break; }
  }
  await sleep(800);
  await page.screenshot({ path: path.join(OUT, "fr-sockets.png") });
  if (logs.length) console.log(logs.join("\n"));
} finally {
  await browser.close();
}
