// Phone pan probe: in phone emulation (mobile UA, touch, coarse pointer, DPR 2.625, CPU throttled), finger-pans the canvas
// from empty canvas and from a card, and reports the pan layer's state and layer count mid-pan, the trace cost, and flicker:
// every composited frame is captured and a frame whose drawn content drops well below its neighbours' (a card blinking out,
// an unrastered tile) is counted. `--off` neutralizes the pan layer for an A/B (react-flow-surface-contract § Drag performance).
// Needs the dev server on :1420.
//   node scripts/mobile-pan-probe.mjs [seed] [--zooms=0.25,0.1] [--throttle=4] [--off] [--frames=dir]
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import { browserPath } from "./browser.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const SEED = args.find((a) => !a.startsWith("--")) ?? "personal-finance";
const ZOOMS = opt("zooms", "0.25,0.1").split(",").map(Number);
const THROTTLE = Number(opt("throttle", "4"));
const OFF = args.includes("--off");
const FRAME_DIR = opt("frames", "");
const W = 412, H = 915, DPR = 2.625;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PHASES = {
  script: ["FunctionCall", "EventDispatch", "RunMicrotasks", "FireAnimationFrame", "TimerFire"],
  paint: ["Paint"],
  layerize: ["Layerize", "Commit"],
  raster: ["RasterTask"],
};

async function main() {
  const browser = await puppeteer.launch({
    executablePath: browserPath(), headless: true,
    args: [`--window-size=${W},${H}`, ...(process.getuid?.() === 0 ? ["--no-sandbox"] : [])],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36",
      { mobile: true, platform: "Android", platformVersion: "15", architecture: "", model: "Pixel 9", brands: [{ brand: "Chromium", version: "140" }] },
    );
    await page.setViewport({ width: W, height: H, isMobile: true, hasTouch: true, deviceScaleFactor: DPR });
    page.setDefaultTimeout(120000);
    await page.evaluateOnNewDocument(() => {
      const orig = window.matchMedia.bind(window);
      window.matchMedia = (q) => /pointer:\s*coarse/.test(q)
        ? { matches: true, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } }
        : orig(q);
    });
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await page.goto("http://localhost:1420", { waitUntil: "networkidle2" });
    await page.waitForSelector(".solenoid-node");
    await sleep(3000);
    await page.evaluate(async (id) => { const { clearAndLoadSeed } = await import("/src/graph/seeds.ts"); await clearAndLoadSeed(id); }, SEED);
    await sleep(5000);
    if (OFF) await page.addStyleTag({ content: ".react-flow__viewport.sol-pan-layer { translate: none !important; }" });
    const mobile = await page.evaluate(() => document.documentElement.classList.contains("is-mobile"));
    const client = await page.target().createCDPSession();
    await client.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
    let layers = [];
    client.on("LayerTree.layerTreeDidChange", (e) => { if (e.layers) layers = e.layers; });
    await client.send("LayerTree.enable");
    console.log(`seed ${SEED}, phone model ${mobile ? "on" : "OFF"}, ${W}x${H}@${DPR}, cpu x${THROTTLE}, pan layer ${OFF ? "NEUTRALIZED" : "live"}`);

    const setZoom = (z) => page.evaluate(async (z) => {
      const { devRfStores } = await import("/src/graph/flow/devRfStores.ts");
      const st = [...devRfStores][0].getState();
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const n of st.nodeLookup.values()) {
        if (n.hidden) continue;
        const p = n.internals.positionAbsolute, w = n.measured?.width ?? 0, h = n.measured?.height ?? 0;
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + w); y1 = Math.max(y1, p.y + h);
      }
      await st.panZoom.setViewport({ x: st.width / 2 - ((x0 + x1) / 2) * z + 0.37, y: st.height / 2 - ((y0 + y1) / 2) * z + 0.61, zoom: z });
    }, z);

    const startSpot = (onCard) => page.evaluate((onCard) => {
      for (let y = 300; y < innerHeight - 200; y += 23) for (let x = 40; x < innerWidth - 40; x += 19) {
        const el = document.elementFromPoint(x, y);
        if (!el) continue;
        if (!onCard && el.classList.contains("react-flow__pane")) return { x, y };
        if (onCard) {
          const card = el.closest(".react-flow__node");
          if (card && !card.classList.contains("selected") && !el.closest("button, select, input, textarea, .react-flow__handle, [data-socket-key]")) return { x, y };
        }
      }
      return null;
    }, onCard);

    // Captures every composited frame and scores how much is drawn in the canvas band (non-background pixels).
    const screencast = async (fn) => {
      const frames = [];
      const onFrame = async (f) => { frames.push(f.data); try { await client.send("Page.screencastFrameAck", { sessionId: f.sessionId }); } catch {} };
      client.on("Page.screencastFrame", onFrame);
      await client.send("Page.startScreencast", { format: "png", everyNthFrame: 1, maxWidth: W, maxHeight: H });
      await fn();
      await sleep(400);
      await client.send("Page.stopScreencast");
      client.off("Page.screencastFrame", onFrame);
      return frames;
    };

    const tracePan = async (fn) => {
      const chunks = [];
      const onData = (d) => chunks.push(...d.value);
      client.on("Tracing.dataCollected", onData);
      const done = new Promise((r) => client.once("Tracing.tracingComplete", r));
      await client.send("Tracing.start", { transferMode: "ReportEvents", traceConfig: { includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "toplevel", "cc"] } });
      await fn();
      await client.send("Tracing.end");
      await done;
      client.off("Tracing.dataCollected", onData);
      const sum = Object.fromEntries(Object.keys(PHASES).map((k) => [k, 0]));
      for (const e of chunks) if (e.ph === "X" && e.dur) for (const [k, names] of Object.entries(PHASES)) if (names.includes(e.name)) sum[k] += e.dur / 1000;
      return sum;
    };

    let mid = null;
    const drag = async (x0, y0, steps = 40) => {
      await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0, id: 0 }] });
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + Math.sin(t * Math.PI * 2) * 90, y: y0 - Math.sin(t * Math.PI) * 140, id: 0 }] });
        if (i === Math.floor(steps / 2)) mid = { promoted: await page.evaluate(() => document.querySelector(".react-flow__viewport")?.classList.contains("sol-pan-layer")), layers: layers.length };
        await sleep(16);
      }
      await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await sleep(200);
    };

    const { PNG } = await import("pngjs").catch(() => ({ PNG: null }));
    const drawnMass = (b64) => {
      if (!PNG) return null;
      const png = PNG.sync.read(Buffer.from(b64, "base64"));
      const { width, height, data } = png;
      const y0 = Math.floor(height * 0.15), y1 = Math.floor(height * 0.85);
      // The background is the band's most common color: a single sampled pixel misreads whenever a cable crosses it.
      const counts = new Map();
      for (let y = y0; y < y1; y += 8) for (let x = 0; x < width; x += 8) { const i = (y * width + x) * 4; const k = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]; counts.set(k, (counts.get(k) ?? 0) + 1); }
      const mode = [...counts].sort((a, b) => b[1] - a[1])[0][0];
      const bg = [(mode >> 16) & 255, (mode >> 8) & 255, mode & 255];
      let n = 0;
      for (let y = y0; y < y1; y += 2) for (let x = 0; x < width; x += 2) {
        const i = (y * width + x) * 4;
        if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 24) n++;
      }
      return n;
    };

    for (const z of ZOOMS) {
      for (const onCard of [false, true]) {
        await setZoom(z);
        await sleep(1500);
        const spot = await startSpot(onCard);
        if (!spot) { console.log(`zoom ${z} ${onCard ? "card" : "pane"}: no start spot`); continue; }
        const cost = await tracePan(() => drag(spot.x, spot.y));
        await setZoom(z);
        await sleep(1200);
        const frames = await screencast(() => drag(spot.x, spot.y));
        const mass = frames.map(drawnMass).filter((m) => m !== null);
        let dips = 0, worst = 1;
        for (let i = 1; i < mass.length - 1; i++) {
          const ref = Math.min(mass[i - 1], mass[i + 1]);
          if (ref > 0) { const r = mass[i] / ref; worst = Math.min(worst, r); if (r < 0.85) dips++; }
        }
        if (FRAME_DIR) {
          fs.mkdirSync(FRAME_DIR, { recursive: true });
          frames.forEach((f, i) => fs.writeFileSync(`${FRAME_DIR}/z${z}-${onCard ? "card" : "pane"}-${String(i).padStart(3, "0")}.png`, Buffer.from(f, "base64")));
        }
        const f = (v) => Math.round(v);
        console.log(`zoom ${z} from ${onCard ? "card" : "pane"}: mid-pan ${JSON.stringify(mid)}; script ${f(cost.script)} paint ${f(cost.paint)} layerize ${f(cost.layerize)} raster ${f(cost.raster)}; ${frames.length} frames, flicker dips ${PNG ? dips : "n/a (no pngjs)"}, worst frame ${PNG ? worst.toFixed(2) : "n/a"} of its neighbours`);
      }
    }
    if (errs.length) console.log("page errors:", errs.slice(0, 5));
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
