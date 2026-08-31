// Probe: load the report-showcase seed, open the Report overlay, screenshot it.
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
  await page.waitForFunction(() => typeof window.__solenoidTuneSeed === "function");
  await page.waitForSelector(".solenoid-node");
  await sleep(3500);
  await page.evaluate((sid) => window.__solenoidTuneSeed(sid), "report-showcase");
  await sleep(2500);
  const openBtn = await page.$(".solenoid-report__open");
  if (openBtn) await openBtn.click();
  await sleep(1200);
  const embed = await page.evaluate(() => {
    const bar = [...document.querySelectorAll(".solenoid-ref-embed__title")].map((e) => e.textContent);
    const body = document.querySelector(".report-embed__body")?.textContent?.slice(0, 80);
    return { bars: bar, body };
  });
  console.log("embed:", JSON.stringify(embed));
  await page.screenshot({ path: path.join(OUT, "report-embed.png") });
  if (logs.length) console.log(logs.join("\n"));
} finally {
  await browser.close();
}
