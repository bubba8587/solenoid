// Probe: toggle the dev copy-edit freeze (Ctrl+Alt+E), click a string, screenshot.
import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const OUT = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--window-size=1500,1000"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 1000 });
  page.setDefaultTimeout(120000);
  const logs = [];
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto("http://localhost:1420", { waitUntil: "networkidle2" });
  await page.waitForSelector(".solenoid-node");
  await sleep(3000);

  await page.keyboard.down("Control");
  await page.keyboard.down("Alt");
  await page.keyboard.press("e");
  await page.keyboard.up("Alt");
  await page.keyboard.up("Control");
  await sleep(400);
  const frozen = await page.$(".sol-copyedit-badge");
  console.log("freeze badge:", !!frozen);

  // Click the menu bar's "Data" entry to start an edit.
  const target = await page.evaluateHandle(() => {
    for (const el of document.querySelectorAll(".solenoid-menubar *")) {
      if (el.textContent?.trim() === "Data" && el.children.length === 0) return el;
    }
    return null;
  });
  if (target && target.asElement()) {
    const box = await target.asElement().boundingBox();
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
  await sleep(400);
  const editing = await page.evaluate(() => {
    const el = document.querySelector(".sol-copyedit-editing");
    return el ? { text: el.textContent, editable: el.getAttribute("contenteditable") } : null;
  });
  console.log("editing:", JSON.stringify(editing));
  // Check the app did NOT react (no menu opened).
  const menuOpen = await page.evaluate(() => !!document.querySelector(".solenoid-menubar__dropdown, [class*=menubar-dropdown], [class*=menu-open]"));
  console.log("app menu opened (should be false):", menuOpen);
  await page.screenshot({ path: path.join(OUT, "copyedit-freeze.png") });

  await page.keyboard.press("Escape"); // revert edit
  await page.keyboard.press("Escape"); // exit freeze
  await sleep(200);
  console.log("badge after exit (should be false):", !!(await page.$(".sol-copyedit-badge")));
  if (logs.length) console.log(logs.join("\n"));
} finally {
  await browser.close();
}
