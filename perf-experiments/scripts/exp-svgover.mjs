import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: "/opt/pw-browsers/chromium", headless: true, args: ["--no-sandbox", "--window-size=1600,1000"] });
const page = await b.newPage();
await page.setViewport({ width: 1600, height: 1000 });
await page.goto("http://localhost:1420", { waitUntil: "networkidle2" });
await page.waitForSelector(".solenoid-node"); await sleep(3000);
await page.evaluate(async () => { const { clearAndLoadSeed } = await import("/src/graph/seeds.ts"); await clearAndLoadSeed("personal-finance"); });
await sleep(5000);
console.log(await page.evaluate(() => {
  const m = new Map();
  for (const svg of document.querySelectorAll(".react-flow__node svg")) {
    if (svg.ownerSVGElement) continue;
    const cs = getComputedStyle(svg);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.overflow === "visible") continue;
    const layered = cs.position !== "static" || cs.transform !== "none" || parseFloat(cs.opacity) < 1;
    if (!layered) continue;
    // does any child's rendered box extend past the svg's box?
    const r = svg.getBoundingClientRect(); let over = 0;
    for (const c of svg.querySelectorAll("*")) { const cr = c.getBoundingClientRect(); if (!cr.width && !cr.height) continue; over = Math.max(over, r.left - cr.left, r.top - cr.top, cr.right - r.right, cr.bottom - r.bottom); }
    const cls = svg.getAttribute("class") ?? ""; const parent = svg.parentElement?.className?.toString().split(" ")[0] ?? "";
    const k = `svg.${cls.split(" ").slice(0, 2).join(".")} in ${parent} pos=${cs.position} tf=${cs.transform !== "none"} overflowBy=${over > 0.5 ? over.toFixed(1) + "px" : "none"}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n}\t${k}`).join("\n");
}));
await b.close();
