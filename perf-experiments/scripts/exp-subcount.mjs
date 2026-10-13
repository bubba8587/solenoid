import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: "/opt/pw-browsers/chromium", headless: true, args: ["--no-sandbox", "--window-size=1600,1000"] });
const page = await b.newPage();
if (process.argv[2] === "phone") {
  await page.setUserAgent("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36", { mobile: true, platform: "Android", platformVersion: "15", architecture: "", model: "Pixel 9", brands: [{ brand: "Chromium", version: "140" }] });
  await page.setViewport({ width: 412, height: 915, isMobile: true, hasTouch: true, deviceScaleFactor: 2.625 });
} else await page.setViewport({ width: 1600, height: 1000 });
await page.goto("http://localhost:1420", { waitUntil: "networkidle2" });
await page.waitForSelector(".solenoid-node"); await sleep(3000);
await page.evaluate(async () => { const { clearAndLoadSeed } = await import("/src/graph/seeds.ts"); await clearAndLoadSeed("personal-finance"); });
await sleep(5000);
console.log(await page.evaluate(async () => {
  const { devRfStores } = await import("/src/graph/flow/devRfStores.ts");
  const store = [...devRfStores][0];
  const orig = Set.prototype.forEach; let biggest = 0;
  Set.prototype.forEach = function (cb, t) { if (this.size > biggest) biggest = this.size; return orig.call(this, cb, t); };
  const t0 = store.getState().transform;
  store.setState({ transform: [t0[0] + 1, t0[1], t0[2]] });
  Set.prototype.forEach = orig;
  store.setState({ transform: t0 });
  return { minimap: document.querySelectorAll(".react-flow__minimap-node").length, resize: document.querySelectorAll(".react-flow__resize-control").length, listeners: biggest, nodes: store.getState().nodeLookup.size, edges: store.getState().edgeLookup.size, handles: document.querySelectorAll(".react-flow__handle").length };
}));
await b.close();
