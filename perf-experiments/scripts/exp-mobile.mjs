// Phone pan probe: in phone emulation (mobile UA, touch, coarse pointer, DPR 2.625, CPU throttled), finger-pans the canvas in four
// long strokes from empty canvas and from a card, and reports the pan layer's state and layer count mid-pan, the trace cost, and flicker:
// the three longest main-thread tasks with what they spent their time on (the hitches); every composited frame is captured and a frame whose drawn content drops well below its neighbours' (a card blinking out,
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
    if (process.env.NOEDGES) await page.evaluateOnNewDocument(() => { window.__noEdges = true; });
    const INJECT = process.env.CSS || "";
    if (INJECT) await page.evaluateOnNewDocument((c) => { document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = c; document.head.append(s); }); }, INJECT);
    if (args.includes("--nohold")) await page.evaluateOnNewDocument(() => { window.__noPanHold = true; });
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    const PROD = process.env.BASE;
    await page.goto(PROD ? `${PROD}/?seed=${SEED}` : "http://localhost:1420", { waitUntil: "networkidle2" });
    await page.waitForSelector(".solenoid-node");
    await sleep(3000);
    if (!PROD) await page.evaluate(async (id) => { const { clearAndLoadSeed } = await import("/src/graph/seeds.ts"); await clearAndLoadSeed(id); }, SEED);
    await sleep(5000);
    if (OFF) await page.addStyleTag({ content: ".react-flow__viewport.sol-pan-layer { translate: none !important; }" });
    const mobile = await page.evaluate(() => document.documentElement.classList.contains("is-mobile"));
    const client = await page.target().createCDPSession();
    await client.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
    let layers = [];
    client.on("LayerTree.layerTreeDidChange", (e) => { if (e.layers) layers = e.layers; });
    await client.send("LayerTree.enable");
    console.log(`seed ${SEED}, phone model ${mobile ? "on" : "OFF"}, ${W}x${H}@${DPR}, cpu x${THROTTLE}, pan layer ${OFF ? "NEUTRALIZED" : "live"}`);

    const scaleNow = () => page.evaluate(() => Number(/scale\(([\d.]+)\)/.exec(document.querySelector(".react-flow__viewport").style.transform)?.[1] ?? 1));
    // Production has no dev hooks: zoom with the on-screen buttons until the scale matches.
    const prodZoom = async (z) => {
      for (let i = 0; i < 60; i++) {
        const k = await scaleNow();
        if (Math.abs(k - z) < 0.001) return;
        await page.evaluate((sel) => document.querySelector(sel)?.click(), k < z ? ".solenoid-nav__btn--zoomin" : ".solenoid-nav__btn--zoomout");
        await sleep(120);
      }
    };
    const setZoom = PROD ? async (z) => { await prodZoom(z); console.log("prod scale now", await scaleNow()); } : (z) => page.evaluate(async (z) => {
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
      await client.send("Tracing.start", { transferMode: "ReportEvents", traceConfig: { includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "toplevel", "cc", "blink", ...(process.env.INVAL ? ["disabled-by-default-devtools.timeline.invalidationTracking"] : [])] } });
      if (process.env.PROFILE) { await client.send("Profiler.enable"); await client.send("Profiler.setSamplingInterval", { interval: 200 }); await client.send("Profiler.start"); }
      await fn();
      if (process.env.PROFILE) {
        const { profile } = await client.send("Profiler.stop");
        const byId = new Map(profile.nodes.map((n) => [n.id, n])); const parent = new Map();
        for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
        const dt = new Map(); for (let i = 0; i < profile.samples.length; i++) dt.set(profile.samples[i], (dt.get(profile.samples[i]) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000);
        const key = (n) => `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").slice(-2).join("/").split("?")[0]}:${n.callFrame.lineNumber}`;
        const self = new Map(), incl = new Map();
        for (const [id, t] of dt) { const n = byId.get(id); self.set(key(n), (self.get(key(n)) ?? 0) + t); const seen = new Set(); for (let c = id; c != null; c = parent.get(c)) { const k = key(byId.get(c)); if (seen.has(k)) continue; seen.add(k); incl.set(k, (incl.get(k) ?? 0) + t); } }
        const skip = /\(root\)|\(program\)|\(idle\)|\(garbage/;
        console.log("SELF:\n" + [...self].filter(([k]) => !skip.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, t]) => `  ${t.toFixed(0)}\t${k}`).join("\n"));
        console.log("INCL:\n" + [...incl].filter(([k]) => !skip.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 50).map(([k, t]) => `  ${t.toFixed(0)}\t${k}`).join("\n"));
      }
      await client.send("Tracing.end");
      await done;
      client.off("Tracing.dataCollected", onData);
      if (process.env.PAC) {
        const lz = chunks.filter((e) => e.name === "Layerize" && e.ph === "X");
        const full = chunks.filter((e) => e.name === "PaintArtifactCompositor::Update" && e.ph === "X");
        console.log(`PAC: Layerize ${lz.length} (${lz.reduce((a, e) => a + e.dur / 1000, 0).toFixed(0)} ms), full Update ${full.length} (${full.reduce((a, e) => a + e.dur / 1000, 0).toFixed(0)} ms)`);
      }
      if (process.env.INVAL) {
        const inv = new Map();
        for (const e of chunks) if (/Invalidation/.test(e.name)) { const d = e.args?.data ?? {}; const k = `${e.name} | ${d.nodeName ?? ""} | ${d.reason ?? ""}`.slice(0, 150); inv.set(k, (inv.get(k) ?? 0) + 1); }
        console.log("INVALIDATIONS:\n" + [...inv].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, n]) => `  ${n}\t${k}`).join("\n"));
        const paints = chunks.filter((e) => e.name === "Paint" && e.ph === "X");
        console.log(`Paint events: ${paints.length}, total ${paints.reduce((a, e) => a + e.dur / 1000, 0).toFixed(0)} ms; by layer id: ${JSON.stringify(Object.entries(paints.reduce((m, e) => { const k = e.args?.data?.layerId ?? "?"; m[k] = (m[k] ?? 0) + 1; return m; }, {})).slice(0, 8))}`);
      }
      const sum = Object.fromEntries(Object.keys(PHASES).map((k) => [k, 0]));
      // The worst frames: the longest main-thread tasks, each with what it spent its time on.
      const tasks = chunks.filter((e) => e.ph === "X" && e.name === "RunTask" && e.dur > 0).sort((a, b) => b.dur - a.dur).slice(0, 3);
      sum.worst = tasks.map((t) => {
        const inside = chunks.filter((e) => e.ph === "X" && e.tid === t.tid && e.ts >= t.ts && e.ts + (e.dur ?? 0) <= t.ts + t.dur && e !== t);
        const by = {}; for (const e of inside) if (/^(Paint|Layerize|Commit|PrePaint|UpdateLayoutTree|Layout|FunctionCall|EventDispatch|CullRectUpdate)$/.test(e.name)) by[e.name] = (by[e.name] ?? 0) + e.dur / 1000;
        return `${(t.dur / 1000).toFixed(0)}ms[${Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(", ")}]`;
      }).join(" ");
      sum.worstTask = 0;
      for (const e of chunks) if (e.ph === "X" && e.name === "RunTask" && e.dur && e.args?.src_func !== "Idle") sum.worstTask = Math.max(sum.worstTask, e.dur / 1000);
      const rasterByFrame = [];
      for (const e of chunks) if (e.ph === "X" && e.name === "RasterTask" && e.dur) rasterByFrame.push([e.ts, e.dur / 1000]);
      rasterByFrame.sort((a, b) => a[0] - b[0]);
      let burst = 0, burstStart = -1e18; sum.worstRasterBurst = 0;
      for (const [ts, d] of rasterByFrame) { if (ts - burstStart > 16000) { burstStart = ts; burst = 0; } burst += d; sum.worstRasterBurst = Math.max(sum.worstRasterBurst, burst); }
      for (const e of chunks) if (e.ph === "X" && e.dur) for (const [k, names] of Object.entries(PHASES)) if (names.includes(e.name)) sum[k] += e.dur / 1000;
      return sum;
    };

    let mid = null;
    // Several long strokes, each across most of the screen, so the pan runs well past the layer's pre-rastered margin.
    // Long strokes across most of the screen, so the pan runs well past the region the browser keeps painted around the screen.
    const drag = async (x0, y0, steps = 40) => {
      for (let stroke = 0; stroke < 4; stroke++) {
        const fx = stroke === 0 ? x0 : W * 0.85, fy = stroke === 0 ? y0 : H * 0.7, dx = -W * 0.7, dy = -H * 0.4;
        await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: fx, y: fy, id: 0 }] });
        for (let i = 1; i <= steps; i++) {
          await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: fx + (dx * i) / steps, y: fy + (dy * i) / steps, id: 0 }] });
          if (stroke === 0 && i === Math.floor(steps / 2)) mid = { promoted: await page.evaluate(() => document.querySelector(".react-flow__viewport")?.classList.contains("sol-pan-layer")), layers: layers.length };
          await sleep(16);
        }
        await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await sleep(60);
      }
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
      for (const onCard of process.env.PANE_ONLY ? [false] : [false, true]) {
        await setZoom(z);
        await sleep(1500);
        const spot = await startSpot(onCard);
        if (!spot) { console.log(`zoom ${z} ${onCard ? "card" : "pane"}: no start spot`); continue; }
        const cost = await tracePan(() => drag(spot.x, spot.y));
        const frames = process.env.NO_SHOTS ? [] : (await setZoom(z), await sleep(1200), await screencast(() => drag(spot.x, spot.y)));
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
        if (process.env.CSV) { console.log(`CSV,${z},${f(cost.paint)},${f(cost.layerize)},${f(cost.raster)},${f(cost.script)},${f(Math.max(...[0]))}`); continue; }
        console.log(`zoom ${z} from ${onCard ? "card" : "pane"}: mid-pan ${JSON.stringify(mid)}; script ${f(cost.script)} paint ${f(cost.paint)} layerize ${f(cost.layerize)} raster ${f(cost.raster)}; worst tasks ${cost.worst}; worst main task ${f(cost.worstTask)} ms, worst 16 ms raster burst ${f(cost.worstRasterBurst)} ms; ${frames.length} frames, flicker dips ${PNG ? dips : "n/a (no pngjs)"}, worst frame ${PNG ? worst.toFixed(2) : "n/a"} of its neighbours`);
      }
    }
    if (errs.length) console.log("page errors:", errs.slice(0, 5));
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
