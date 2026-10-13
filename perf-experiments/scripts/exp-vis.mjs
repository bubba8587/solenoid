// Screenshot the live app at given zooms with CSS override A vs B (or none), diff, save crops.
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import { PNG } from "pngjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [out, cssB, zooms = "1,2.5", seed = "personal-finance"] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: "/opt/pw-browsers/chromium", headless: true, args: ["--no-sandbox", "--window-size=1600,1000"] });
const page = await b.newPage();
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: Number(process.env.DPR || 1) });
await page.goto("http://localhost:1420", { waitUntil: "networkidle2" });
await page.waitForSelector(".solenoid-node"); await sleep(3000);
await page.evaluate(async (id) => { const { clearAndLoadSeed } = await import("/src/graph/seeds.ts"); await clearAndLoadSeed(id); }, seed);
await sleep(5000);
const tag = await page.addStyleTag({ content: "/**/" });
for (const z of zooms.split(",").map(Number)) {
  // center on the first grouped card
  await page.evaluate(async (z) => {
    const { devRfStores } = await import("/src/graph/flow/devRfStores.ts");
    const st = [...devRfStores][0].getState();
    const el = document.querySelector(".solenoid-node--grouped")?.closest(".react-flow__node");
    const n = st.nodeLookup.get(el?.dataset.id);
    const p = n.internals.positionAbsolute, w = n.measured.width, h = n.measured.height;
    await st.panZoom.setViewport({ x: Math.round(800 - (p.x + w) * z), y: Math.round(500 - (p.y + h) * z), zoom: z });
  }, z);
  await sleep(1200);
  const shots = [];
  for (const css of ["/**/", cssB]) {
    await page.evaluate((el, c) => { el.textContent = c; }, tag, css);
    await sleep(700);
    shots.push(await page.screenshot({ encoding: "binary" }));
  }
  const [A, B] = shots.map((s) => PNG.sync.read(Buffer.from(s)));
  let n = 0, big = 0, max = 0;
  for (let i = 0; i < A.data.length; i += 4) { const d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2])); if (d) n++; if (d > 8) big++; max = Math.max(max, d); }
  fs.writeFileSync(`${out}-A-z${z}.png`, Buffer.from(shots[0])); fs.writeFileSync(`${out}-B-z${z}.png`, Buffer.from(shots[1]));
  console.log(`zoom ${z}: ${n} px differ, ${big} by >8, max ${max}`);
}
await page.evaluate((el) => { el.textContent = "/**/"; }, tag);
await b.close();
