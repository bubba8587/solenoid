// Static-page pan cost: slide the viewport 1px per frame, sum Paint/PrePaint/Layerize/Raster from a trace, per variant (JS mutation).
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [snap, variantsFile, mode = "pan"] = process.argv.slice(2);
const html = fs.readFileSync(snap, "utf8");
const variants = JSON.parse(fs.readFileSync(variantsFile, "utf8"));
const W = Number(process.env.W || 1600), H = Number(process.env.H || 1000), DPR = Number(process.env.DPR || 1);
const b = await puppeteer.launch({ executablePath: "/opt/pw-browsers/chromium", headless: true, args: ["--no-sandbox", `--window-size=${W},${H}`] });
for (const [name, js] of Object.entries(variants)) {
  const rows = [];
  for (let rep = 0; rep < Number(process.env.REPS || 2); rep++) {
    const page = await b.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: DPR });
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate((js) => new Function(js)(), js);
    await sleep(600);
    const c = await page.target().createCDPSession();
    const chunks = [];
    c.on("Tracing.dataCollected", (d) => chunks.push(...d.value));
    const done = new Promise((r) => c.once("Tracing.tracingComplete", r));
    await c.send("Tracing.start", { transferMode: "ReportEvents", traceConfig: { includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "blink", "cc"] } });
    await page.evaluate(async (mode) => {
      const vp = document.querySelector(".react-flow__viewport");
      const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(vp.style.transform);
      const [x, y, k] = [+m[1], +m[2], +m[3]];
      for (let i = 0; i < 60; i++) {
        if (mode === "poke") { let d = document.getElementById("poke"); if (!d) { d = document.createElement("div"); d.id = "poke"; d.style.cssText = "position:fixed;left:0;top:0;width:4px;height:4px;z-index:99999"; document.body.append(d); } d.style.background = i % 2 ? "red" : "blue"; }
        else if (mode === "pan") vp.style.transform = `translate(${x + (i % 20) * 3}px, ${y + (i % 20) * 2}px) scale(${k})`;
        else vp.style.transform = `translate(${x}px, ${y}px) scale(${k * (i % 2 ? 1.1 : 1)})`;
        await new Promise((r) => requestAnimationFrame(r));
      }
    }, mode);
    await c.send("Tracing.end"); await done;
    const sum = (n) => chunks.filter((e) => e.name === n && e.ph === "X").reduce((a, e) => a + e.dur / 1000, 0);
    rows.push({ paint: sum("Paint"), prepaint: sum("PrePaint"), layerize: sum("Layerize"), raster: sum("RasterTask"), style: sum("UpdateLayoutTree"), layout: sum("Layout") });
    await page.close();
  }
  const stat = (k) => { const v = rows.map((r) => r[k]).sort((a, b) => a - b); return `${v[Math.floor(v.length / 2)].toFixed(0).padStart(4)} [${v[0].toFixed(0)}-${v[v.length - 1].toFixed(0)}]`; };
  console.log(`${name.padEnd(40)} paint ${stat("paint")}  layerize ${stat("layerize")}  raster ${stat("raster")}`);
}
await b.close();
