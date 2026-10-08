// Measures what one frame of panning and zooming costs at each zoom level, from a Chrome trace.
// Loads a seed, then at every zoom drags the empty canvas and turns the wheel, and sums trace time
// by phase (script, style, layout, paint, raster, gpu). Needs the dev server on :1420.
//   node scripts/zoom-perf-probe.mjs [seed] [--throttle=4] [--zooms=1,0.5,0.25,0.1] [--size=1600x1000]
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
        traceConfig: { includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "toplevel", "cc", "gpu", "viz", "blink"] },
      });
      const t0 = Date.now();
      await fn();
      const wall = Date.now() - t0;
      await client.send("Tracing.end");
      await done;
      client.removeAllListeners("Tracing.dataCollected");
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
      console.log(`zoom ${z}: ${await layerCount()}`);
      const panR = await traceRun(async () => {
        // Empty spot: the top-left corner just under the chrome.
        const x0 = 40, y0 = H - 120;
        await page.mouse.move(x0, y0);
        await page.mouse.down();
        for (let i = 1; i <= FRAMES; i++) {
          await page.mouse.move(x0 + (i % 20) * 6, y0 - (i % 20) * 3);
          await sleep(16);
        }
        await page.mouse.up();
        await sleep(300);
      });
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
