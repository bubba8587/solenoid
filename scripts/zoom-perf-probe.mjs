// Measures what panning and wheel-zooming cost at each zoom level, from a Chrome trace: loads a seed, then at every
// zoom drags the empty canvas and turns the wheel, sums trace time by phase, and counts compositor layers mid-pan
// (react-flow-surface-contract § Drag performance). Needs the dev server on :1420.
//   node scripts/zoom-perf-probe.mjs [seed] [--zooms=1,0.25,0.1] [--frames=60] [--nozoom=1] [--throttle=1] [--size=1600x1000]
//     [--ko=shadow,text,...|<raw css>]   knock a style out to price it (KNOCKOUTS below; commas separate entries)
//   env PROFILE=1 (JS self/inclusive time), PAINTS=1 (paint and layerize events), INVAL=1 (what invalidated)
import puppeteer from "puppeteer-core";
import { browserPath } from "./browser.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const SEED = args.find((a) => !a.startsWith("--")) ?? "personal-finance";
const THROTTLE = Number(opt("throttle", "1"));
const ZOOMS = opt("zooms", "1,0.5,0.25,0.15,0.1").split(",").map(Number);
const [W, H] = opt("size", "1600x1000").split("x").map(Number);
const FRAMES = Number(opt("frames", "60"));
const KNOCKOUTS = {
  none: "",
  shadow: ".react-flow__viewport *, .react-flow__viewport *::before, .react-flow__viewport *::after { box-shadow: none !important; }",
  filter: ".react-flow__viewport *, .react-flow__viewport *::before, .react-flow__viewport *::after { filter: none !important; }",
  radius: ".react-flow__viewport *, .react-flow__viewport *::before, .react-flow__viewport *::after { border-radius: 0 !important; }",
  text: ".react-flow__viewport *, .react-flow__viewport *::before, .react-flow__viewport *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; }",
  edges: ".react-flow__edges, .react-flow__viewport-portal { display: none !important; }",
  svg: ".react-flow__nodes svg { display: none !important; }",
  canvas: ".react-flow__nodes canvas { display: none !important; }",
  opacity: ".react-flow__viewport *, .react-flow__viewport *::before, .react-flow__viewport *::after { opacity: 1 !important; }",
  bg: ".react-flow__nodes *, .react-flow__nodes *::before, .react-flow__nodes *::after { background: none !important; }",
  border: ".react-flow__nodes *, .react-flow__nodes *::before, .react-flow__nodes *::after { border-color: transparent !important; outline: none !important; }",
  clip: ".react-flow__nodes * { overflow: visible !important; clip-path: none !important; }",
  nodes: ".react-flow__nodes { display: none !important; }",
  chrome: ".solenoid-statusbar, .solenoid-menubar, .react-flow__panel, .solenoid-hud-stack, header { display: none !important; }",
};
const KO = opt("ko", "none").split(",");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PHASES = {
  script: ["FunctionCall", "EvaluateScript", "v8.compile", "TimerFire", "FireAnimationFrame", "EventDispatch", "RunMicrotasks"],
  style: ["UpdateLayoutTree", "RecalculateStyles", "ParseAuthorStyleSheet"],
  layout: ["Layout", "UpdateLayerTree"],
  prepaint: ["PrePaint"],
  paint: ["Paint", "PaintImage"],
  layerize: ["Layerize", "Commit"],
  raster: ["RasterTask", "Rasterize", "ImageDecodeTask", "GpuRasterization"],
  gpu: ["GPUTask", "Gpu::CommandBufferStub", "DrawFrame"],
};

function summarize(events) {
  const mainTid = new Map();
  for (const e of events) if (e.name === "thread_name" && e.args?.name === "CrRendererMain") mainTid.set(`${e.pid}:${e.tid}`, true);
  const out = Object.fromEntries(Object.keys(PHASES).map((k) => [k, 0]));
  let task = 0, frames = 0;
  for (const e of events) {
    if (e.ph !== "X" || !e.dur) continue;
    for (const [k, names] of Object.entries(PHASES)) if (names.includes(e.name)) out[k] += e.dur / 1000;
    if (e.name === "RunTask" && mainTid.has(`${e.pid}:${e.tid}`)) task += e.dur / 1000;
  }
  for (const e of events) if (e.name === "DrawFrame" || e.name === "BeginMainThreadFrame") frames++;
  return { ...out, mainTask: task };
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: browserPath(), headless: true,
    args: [`--window-size=${W},${H}`, ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []), "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    page.setDefaultTimeout(120000);
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await page.goto("http://localhost:1420", { waitUntil: "networkidle2" });
    await page.waitForSelector(".solenoid-node");
    await sleep(3000);
    await page.evaluate(async (id) => {
      const { clearAndLoadSeed } = await import("/src/graph/seeds.ts");
      await clearAndLoadSeed(id);
    }, SEED);
    await sleep(4000);
    const client = await page.target().createCDPSession();
    const koCss = KO.map((k) => KNOCKOUTS[k] ?? k).join("\n");
    if (koCss) await page.addStyleTag({ content: koCss });
    await sleep(500);
    await client.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });

    const info = await page.evaluate(() => ({
      nodes: document.querySelectorAll(".react-flow__node").length,
      edges: document.querySelectorAll(".react-flow__edge").length,
      dom: document.querySelectorAll("*").length,
    }));
    console.log(`[ko ${KO.join(",")}] seed ${SEED}: ${info.nodes} nodes, ${info.edges} edges, ${info.dom} DOM elements; cpu x${THROTTLE}; ${W}x${H}`);

    const setZoom = (zoom) => page.evaluate(async (z) => {
      const { devRfStores } = await import("/src/graph/flow/devRfStores.ts");
      const store = [...devRfStores][0];
      const st = store.getState();
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of st.nodeLookup.values()) {
        const p = n.internals.positionAbsolute, w = n.measured?.width ?? 0, h = n.measured?.height ?? 0;
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x + w); maxY = Math.max(maxY, p.y + h);
      }
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      await st.panZoom.setViewport({ x: st.width / 2 - cx * z, y: st.height / 2 - cy * z, zoom: z });
      return { onScreen: [...st.nodeLookup.values()].length };
    }, zoom);

    const traceRun = async (fn) => {
      const chunks = [];
      client.on("Tracing.dataCollected", (d) => chunks.push(...d.value));
      const done = new Promise((r) => client.once("Tracing.tracingComplete", r));
      await client.send("Tracing.start", {
        transferMode: "ReportEvents",
        traceConfig: { includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "toplevel", "cc", "gpu", "viz", "blink", ...(process.env.INVAL ? ["disabled-by-default-devtools.timeline.invalidationTracking"] : [])] },
      });
      const t0 = Date.now();
      if (process.env.PROFILE) { await client.send("Profiler.enable"); await client.send("Profiler.setSamplingInterval", { interval: 100 }); await client.send("Profiler.start"); }
      await fn();
      if (process.env.PROFILE) {
        const { profile } = await client.send("Profiler.stop");
        const self = new Map(); const byId = new Map(profile.nodes.map((n) => [n.id, n]));
        const dt = new Map(); for (let i = 0; i < profile.samples.length; i++) dt.set(profile.samples[i], (dt.get(profile.samples[i]) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000);
        // inclusive time per function too
        const parent = new Map(); for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
        const incl = new Map();
        for (const [id, t] of dt) {
          const n = byId.get(id); const f = n.callFrame; const k = `${f.functionName || "(anon)"} ${f.url.split("/").slice(-2).join("/").split("?")[0]}:${f.lineNumber}`;
          self.set(k, (self.get(k) ?? 0) + t);
          const seen = new Set(); for (let cur = id; cur != null; cur = parent.get(cur)) { const cf = byId.get(cur).callFrame; const kk = `${cf.functionName || "(anon)"} ${cf.url.split("/").slice(-2).join("/").split("?")[0]}:${cf.lineNumber}`; if (seen.has(kk)) continue; seen.add(kk); incl.set(kk, (incl.get(kk) ?? 0) + t); }
        }
        console.log("  SELF:\n" + [...self].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, t]) => `    ${t.toFixed(0)}ms\t${k}`).join("\n"));
        console.log("  INCL:\n" + [...incl].sort((a, b) => b[1] - a[1]).slice(0, 45).map(([k, t]) => `    ${t.toFixed(0)}ms\t${k}`).join("\n"));
      }
      const wall = Date.now() - t0;
      await client.send("Tracing.end");
      await done;
      client.removeAllListeners("Tracing.dataCollected");
      if (process.env.PAINTS) {
        const m = new Map();
        for (const e of chunks) if ((e.name === "Paint" || e.name === "PaintImage" || e.name === "Layerize" || e.name === "UpdateLayer" || e.name === "Commit" || e.name === "PrePaint") && e.ph === "X") { const d = e.args?.data ?? {}; const k = `${e.name} node=${d.nodeId ?? ""} layer=${d.layerId ?? ""}`; const v = m.get(k) ?? [0, 0]; v[0]++; v[1] += e.dur / 1000; m.set(k, v); }
        console.log([...m].sort((a, b) => b[1][1] - a[1][1]).slice(0, 12).map(([k, [n, t]]) => `    ${n}x ${t.toFixed(0)}ms\t${k}`).join("\n"));
        const sub = new Map();
        for (const e of chunks) if (e.cat?.includes("blink") && e.ph === "X" && e.dur) { const v = sub.get(e.name) ?? 0; sub.set(e.name, v + e.dur / 1000); }
        console.log([...sub].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, t]) => `    ${t.toFixed(0)}ms\t${k}`).join("\n"));
      }
      if (process.env.INVAL) {
        const inv = new Map();
        for (const e of chunks) if (/Invalidation/.test(e.name)) { const d = e.args?.data ?? {}; const k = `${e.name} ${d.nodeName ?? ""} ${d.reason ?? ""}`.slice(0, 140); inv.set(k, (inv.get(k) ?? 0) + 1); }
        console.log([...inv].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, n]) => `    ${n}\t${k}`).join("\n"));
      }
      return { ...summarize(chunks), wall };
    };

    let layers = [];
    client.on("LayerTree.layerTreeDidChange", (e) => { if (e.layers) layers = e.layers; });
    await client.send("LayerTree.enable");
    const layerCount = async () => {
      await sleep(400);
      const drawn = layers.filter((l) => l.drawsContent);
      const area = drawn.reduce((a, l) => a + l.width * l.height, 0);
      return `${layers.length} layers (${drawn.length} drawn, ${(area / 1e6).toFixed(1)} Mpx)`;
    };
    const fmt = (r) => Object.entries(r).map(([k, v]) => `${k} ${Math.round(v)}`).join("  ");
    for (const z of ZOOMS) {
      await setZoom(z);
      await sleep(1500);
      if (opt("nopan", "")) {
        await setZoom(z); await sleep(800);
        // Zoom snaps to 0.1 steps, so notches go up, up, down, down: each pair crosses one step boundary.
        await page.evaluate(async () => {
          const { devRfStores } = await import("/src/graph/flow/devRfStores.ts");
          const store = [...devRfStores][0]; let last = store.getState().transform[2]; window.__zoomSteps = 0;
          store.subscribe((st) => { if (st.transform[2] !== last) { last = st.transform[2]; window.__zoomSteps++; } });
        });
        const zr = await traceRun(async () => { for (let i = 0; i < FRAMES; i++) { await page.mouse.move(W / 2, H / 2); await page.mouse.wheel({ deltaY: i % 4 < 2 ? -100 : 100 }); await sleep(60); } await sleep(300); });
        const steps = await page.evaluate(() => window.__zoomSteps);
        console.log(`  zoom (${steps} steps): ${fmt(zr)}  | per step: main ${(zr.mainTask / steps).toFixed(1)}  paint ${(zr.paint / steps).toFixed(1)}  raster ${(zr.raster / steps).toFixed(1)}`); continue;
      }
      console.log(`zoom ${z}: ${await layerCount()}`);
      let midPan = null;
      const panR = await traceRun(async () => {
        // Empty spot: the top-left corner just under the chrome.
        const x0 = 40, y0 = H - 120;
        await page.mouse.move(x0, y0);
        await page.mouse.down();
        for (let i = 1; i <= FRAMES; i++) {
          await page.mouse.move(x0 + (i % 20) * 6, y0 - (i % 20) * 3);
          await sleep(16);
          if (i === 30) midPan = { promoted: await page.evaluate(() => document.querySelector(".react-flow__viewport")?.classList.contains("sol-pan-layer")), layers: layers.length, drawn: layers.filter((l) => l.drawsContent).length };
        }
        await page.mouse.up();
        await sleep(300);
      });
      console.log(`  mid-pan: ${JSON.stringify(midPan)}`);
      if (opt("nozoom", "")) { console.log(`  pan : ${fmt(panR)}`); continue; }
      await setZoom(z);
      await sleep(800);
      const zoomR = await traceRun(async () => {
        for (let i = 0; i < FRAMES; i++) {
          await page.mouse.move(W / 2, H / 2);
          await page.mouse.wheel({ deltaY: i % 2 ? 4 : -4 });
          await sleep(16);
        }
        await sleep(300);
      });
      console.log(`  pan : ${fmt(panR)}\n  zoom: ${fmt(zoomR)}`);
    }
    if (errs.length) console.log("page errors:", errs.slice(0, 5));
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
