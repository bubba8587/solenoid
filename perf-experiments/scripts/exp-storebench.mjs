// Times React Flow store transform updates (what every pan frame does), isolating the per-subscriber selector cost.
import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const phone = process.argv[2] !== "desktop";
const b = await puppeteer.launch({ executablePath: "/opt/pw-browsers/chromium", headless: true, args: ["--no-sandbox", "--window-size=1600,1000"] });
const page = await b.newPage();
if (phone) {
  await page.setUserAgent("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36", { mobile: true, platform: "Android", platformVersion: "15", architecture: "", model: "Pixel 9", brands: [{ brand: "Chromium", version: "140" }] });
  await page.setViewport({ width: 412, height: 915, isMobile: true, hasTouch: true, deviceScaleFactor: 2.625 });
} else await page.setViewport({ width: 1600, height: 1000 });
await page.goto("http://localhost:1420", { waitUntil: "networkidle2" });
await page.waitForSelector(".solenoid-node"); await sleep(3000);
await page.evaluate(async () => { const { clearAndLoadSeed } = await import("/src/graph/seeds.ts"); await clearAndLoadSeed("personal-finance"); });
await sleep(5000);
const client = await page.target().createCDPSession();
await client.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.THROTTLE || 4) });
for (let rep = 0; rep < 5; rep++) {
  const r = await page.evaluate(async () => {
    const { devRfStores } = await import("/src/graph/flow/devRfStores.ts");
    const store = [...devRfStores][0];
    const t0 = store.getState().transform;
    const n = 100;
    const start = performance.now();
    for (let i = 0; i < n; i++) store.setState({ transform: [t0[0] + (i % 10), t0[1], t0[2]] });
    const syncMs = performance.now() - start;
    store.setState({ transform: t0 });
    return { perUpdate: syncMs / n, listeners: null };
  });
  console.log(`rep ${rep}: ${r.perUpdate.toFixed(2)} ms per store transform update (synchronous listener work)`);
}
await b.close();
