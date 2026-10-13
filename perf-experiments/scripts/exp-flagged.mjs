// Census, in the live app (phone or desktop emulation), of elements that can make a card kMayBeClippedByCullRect:
// self-painting layers (positioned / transform / opacity<1 / filter / clip-path / mask / will-change / isolation / contain paint)
// that also clip their contents (overflow != visible, clip-path, contain paint). Per Chromium PaintLayerPainter::Paint.
import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const phone = process.argv[2] === "phone";
const b = await puppeteer.launch({ executablePath: "/opt/pw-browsers/chromium", headless: true, args: ["--no-sandbox", "--window-size=1600,1000"] });
const page = await b.newPage();
if (phone) {
  await page.setUserAgent("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36", { mobile: true, platform: "Android", platformVersion: "15", architecture: "", model: "Pixel 9", brands: [{ brand: "Chromium", version: "140" }] });
  await page.setViewport({ width: 412, height: 915, isMobile: true, hasTouch: true, deviceScaleFactor: 2.625 });
  await page.evaluateOnNewDocument(() => { const o = window.matchMedia.bind(window); window.matchMedia = (q) => /pointer:\s*coarse/.test(q) ? { matches: true, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } } : o(q); });
} else await page.setViewport({ width: 1600, height: 1000 });
await page.goto("http://localhost:1420", { waitUntil: "networkidle2" });
await page.waitForSelector(".solenoid-node"); await sleep(3000);
await page.evaluate(async () => { const { clearAndLoadSeed } = await import("/src/graph/seeds.ts"); await clearAndLoadSeed("personal-finance"); });
await sleep(5000);
console.log(await page.evaluate(() => {
  const layered = (cs) => cs.position !== "static" || cs.transform !== "none" || parseFloat(cs.opacity) < 1 || cs.filter !== "none" || cs.clipPath !== "none" || (cs.mask && cs.mask !== "none") || (cs.webkitMask && cs.webkitMask !== "none") || cs.willChange !== "auto" || cs.isolation === "isolate" || /paint|strict|content/.test(cs.contain);
  const clips = (cs) => cs.overflowX !== "visible" || cs.overflowY !== "visible" || cs.clipPath !== "none" || /paint|strict|content/.test(cs.contain);
  const m = new Map(); let cards = new Set();
  const visit = (el, pseudo) => {
    const cs = getComputedStyle(el, pseudo);
    if (pseudo && cs.content === "none") return;
    if (cs.display === "none" || cs.visibility === "hidden") return;
    if (!layered(cs) || !clips(cs)) return;
    const cls = typeof el.className === "string" ? el.className : el.className?.baseVal ?? "";
    const k = `${el.tagName.toLowerCase()}${pseudo ?? ""}.${cls.split(" ").filter((c) => !/--/.test(c)).slice(0, 2).join(".")} [pos=${cs.position} ovf=${cs.overflow} clip=${cs.clipPath.slice(0, 20)} op=${cs.opacity} tf=${cs.transform === "none" ? "-" : "y"}]`;
    m.set(k, (m.get(k) ?? 0) + 1);
    cards.add(el.closest(".react-flow__node"));
  };
  for (const el of document.querySelectorAll(".react-flow__node, .react-flow__node *")) { visit(el, null); visit(el, "::before"); visit(el, "::after"); }
  const visibleCards = [...document.querySelectorAll(".react-flow__node")].filter((n) => getComputedStyle(n).visibility !== "hidden").length;
  return `${cards.size} of ${visibleCards} visible cards hold at least one\n` + [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n}\t${k}`).join("\n");
}));
await b.close();
