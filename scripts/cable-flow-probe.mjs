// Prices the animated cable beads: loads a seed, then traces the same idle window and the same canvas drag with the
// beads off and on, and prints main-thread time by phase per second. Needs the dev server on :1420.
//   node scripts/cable-flow-probe.mjs [seed] [--secs=3] [--throttle=1] [--size=1600x1000] [--css=<raw css>]
//   env PAINTS=1 (what painted, by layer)
import puppeteer from "puppeteer-core";
import { browserPath } from "./browser.mjs";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const SEED = args.find((a) => !a.startsWith("--")) ?? "garden-dashboard";
const SECS = Number(opt("secs", "3"));
const THROTTLE = Number(opt("throttle", "1"));
const [W, H] = opt("size", "1600x1000").split("x").map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PHASES = {
  script: ["FunctionCall", "EvaluateScript", "TimerFire", "FireAnimationFrame", "EventDispatch", "RunMicrotasks"],
  style: ["UpdateLayoutTree", "RecalculateStyles"],
  layout: ["Layout", "UpdateLayerTree"],
  prepaint: ["PrePaint"],
  paint: ["Paint", "PaintImage"],
  layerize: ["Layerize", "Commit"],
  raster: ["RasterTask", "Rasterize", "GpuRasterization"],
};

function summarize(events) {
  const main = new Set();
  for (const e of events) if (e.name === "thread_name" && e.args?.name === "CrRendererMain") main.add(`${e.pid}:${e.tid}`);
  const out = Object.fromEntries(Object.keys(PHASES).map((k) => [k, 0]));
  let task = 0;
  for (const e of events) {
    if (e.ph !== "X" || !e.dur) continue;
    for (const [k, names] of Object.entries(PHASES)) if (names.includes(e.name)) out[k] += e.dur / 1000;
    if (e.name === "RunTask" && main.has(`${e.pid}:${e.tid}`)) task += e.dur / 1000;
  }
  return { ...out, mainTask: task };
}

const browser = await puppeteer.launch({
  executablePath: browserPath(), headless: true,
  args: [`--window-size=${W},${H}`, ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []), "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  page.setDefaultTimeout(120000);
  await page.goto("http://localhost:1420", { waitUntil: "networkidle2" });
  await page.waitForSelector(".solenoid-node");
  await sleep(2000);
  await page.evaluate(async (id) => { const { clearAndLoadSeed } = await import("/src/graph/seeds.ts"); await clearAndLoadSeed(id); }, SEED);
  await sleep(4000);
  await page.click(".solenoid-nav__btn--fit").catch(() => {});
  await sleep(1000);
  const css = opt("css", "");
  if (css) await page.addStyleTag({ content: css });
  const client = await page.target().createCDPSession();
  let layers = [];
  client.on("LayerTree.layerTreeDidChange", (e) => { if (e.layers) layers = e.layers; });
  await client.send("LayerTree.enable");
  await client.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  const info = await page.evaluate(() => ({ nodes: document.querySelectorAll(".react-flow__node").length, edges: document.querySelectorAll(".react-flow__edge").length }));

  const trace = async (fn) => {
    const chunks = [];
    client.on("Tracing.dataCollected", (d) => chunks.push(...d.value));
    const done = new Promise((r) => client.once("Tracing.tracingComplete", r));
    await client.send("Tracing.start", { transferMode: "ReportEvents", traceConfig: { includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "toplevel", "cc", "blink", ...(process.env.INVAL ? ["disabled-by-default-devtools.timeline.invalidationTracking"] : [])] } });
    const t0 = Date.now();
    await fn();
    const wall = (Date.now() - t0) / 1000;
    await client.send("Tracing.end");
    await done;
    client.removeAllListeners("Tracing.dataCollected");
    if (process.env.PAINTS) {
      const m = new Map();
      for (const e of chunks) if (e.ph === "X" && (e.name === "Paint" || e.name === "RasterTask")) { const d = e.args?.data ?? {}; const k = `${e.name} layer=${d.layerId ?? ""} clip=${JSON.stringify(d.clip ?? "").slice(0, 60)}`; const v = m.get(k) ?? [0, 0]; v[0]++; v[1] += e.dur / 1000; m.set(k, v); }
      console.log([...m].sort((a, b) => b[1][1] - a[1][1]).slice(0, 8).map(([k, [n, t]]) => `      ${n}x ${t.toFixed(0)}ms\t${k}`).join("\n"));
    }
    if (process.env.INVAL) {
      const inv = new Map();
      for (const e of chunks) if (/Invalidat/.test(e.name)) { const d = e.args?.data ?? {}; const k = `${e.name} ${d.nodeName ?? ""} ${d.reason ?? ""}`.slice(0, 120); inv.set(k, (inv.get(k) ?? 0) + 1); }
      console.log([...inv].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => `      ${n}\t${k}`).join("\n"));
    }
    const s = summarize(chunks);
    return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v / wall]));
  };
  const fmt = (r) => Object.entries(r).map(([k, v]) => `${k} ${v.toFixed(0)}`).join("  ");
  const setFlow = (on) => page.evaluate(async (v) => { const { cableFlowStore } = await import("/src/graph/cableFlowStore.ts"); if (cableFlowStore.get() !== v) cableFlowStore.toggle(); }, on);
  const drag = async () => {
    const x0 = 40, y0 = H - 120;
    await page.mouse.move(x0, y0); await page.mouse.down();
    for (let i = 1; i <= 90; i++) { await page.mouse.move(x0 + (i % 20) * 6, y0 - (i % 20) * 3); await sleep(16); }
    await page.mouse.up();
  };

  console.log(`seed ${SEED}: ${info.nodes} nodes, ${info.edges} edges; cpu x${THROTTLE}; ${W}x${H}; ms of work per second`);
  for (const on of [false, true]) {
    await setFlow(on);
    await sleep(800);
    if (on && process.env.PROTO) await page.evaluate(readFileSync(process.env.PROTO, "utf8"));
    if (on && process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
    const beads = await page.evaluate(() => document.querySelectorAll(".solenoid-cable-flow").length);
    console.log(`beads ${on ? "on " : "off"} (${beads} animated paths; ${layers.length} layers, ${layers.filter((l) => l.drawsContent).length} drawn)`);
    console.log(`  idle: ${fmt(await trace(() => sleep(SECS * 1000)))}`);
    console.log(`  pan : ${fmt(await trace(drag))}`);
  }
  await setFlow(false);
} finally {
  await browser.close();
}
