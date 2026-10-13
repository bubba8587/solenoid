import puppeteer from "puppeteer-core";
import fs from "node:fs";
const html = fs.readFileSync(process.argv[2], "utf8");
const b = await puppeteer.launch({ executablePath: "/opt/pw-browsers/chromium", headless: true, args: ["--no-sandbox", "--window-size=1600,1000"] });
const page = await b.newPage();
await page.setViewport({ width: 1600, height: 1000 });
await page.setContent(html, { waitUntil: "load" });
console.log(await page.evaluate(() => {
  const e = [...document.querySelectorAll(".react-flow__node .solenoid-node__display-value:not(.solenoid-table-display)")].find((x) => x.clientHeight > 0);
  const st = (el) => { const cs = getComputedStyle(el); return ["display","position","overflow","transform","opacity","will-change","contain","z-index","isolation","filter","mix-blend-mode","text-overflow","white-space","font-variant-numeric","font-feature-settings","text-rendering","-webkit-font-smoothing","line-height","height"].map((p) => `${p}=${cs.getPropertyValue(p)}`).join("; "); };
  return [e.outerHTML.slice(0, 400), "BOX: " + st(e), ...[...e.querySelectorAll("*")].map((c) => "CHILD " + c.tagName + ": " + st(c)), "PARENT " + e.parentElement.className + ": " + st(e.parentElement), "card classes: " + e.closest(".solenoid-node")?.className].join("\n");
}));
await b.close();
