// Screenshot pass over every Chart op and the options each op reads. Loads the
// chart-showcase seed and re-feeds ONE frame-fed Chart node (plus the list-fed radar)
// per variant, so the ops that no seed carries still get a real render. The op comes
// from the card's own two selects — the component holds `op` in React state, so an
// external write would repaint the previous figure.
//
//   node scripts/chart-contact-sheet.mjs        (dev server on :1420)
//   OUT=<dir> HEADLESS=1 node scripts/chart-contact-sheet.mjs
import puppeteer from "puppeteer-core";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const CHROME = process.env.CHROME ??
  `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe`;
const OUT = process.env.OUT ?? path.resolve("chart-shots");
const SEED = "chart-showcase";
const ZOOM = 1.6;
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

// The seed's frame-fed Chart node ("Bars + line (composed)", wired to the "Series frame"
// FrameInput) is the universal stand-in: repoint the frame, pick the op. "Profile (radar)"
// is fed a plain LIST, the only way to get a single-series radar. Node ids are minted per
// load, so every label resolves to an id after each seed.
const FRAME_LABEL = "Bars + line (composed)";
const FRAME_SRC_LABEL = "Series frame";
const LIST_LABEL = "Profile (radar)";
let ids = {};

const FRAMES = {
  cart: [
    { name: "Month", type: "string", values: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"] },
    { name: "Sales", type: "number", values: [120, 145, 98, 160, 132, 178] },
    { name: "Target", type: "number", values: [130, 130, 140, 140, 150, 150] },
  ],
  pie: [
    { name: "Region", type: "string", values: ["North", "South", "East", "West"] },
    { name: "Share", type: "number", values: [38, 27, 21, 14] },
  ],
  // Radar reads a frame TRANSPOSED: the number columns are the spokes, each row a polygon.
  // Price against Weight is the case `radarscale` exists for.
  radar: [
    { name: "Laptop", type: "string", values: ["Apex 14", "Nimbus 15", "Vertex 13"] },
    { name: "Speed", type: "number", values: [86, 74, 92] },
    { name: "Price", type: "number", values: [1499, 1099, 1799] },
    { name: "Battery", type: "number", values: [11, 14, 9] },
    { name: "Weight", type: "number", values: [1.4, 1.8, 1.2] },
  ],
  // Bubble takes the first three NUMBER columns as x / y / size.
  bubble: [
    { name: "Spend", type: "number", values: [12, 25, 38, 47, 60, 72] },
    { name: "Return", type: "number", values: [18, 32, 29, 55, 48, 70] },
    { name: "Reach", type: "number", values: [40, 90, 60, 140, 75, 110] },
  ],
};

const SHOTS = [
  { op: "column",    fam: "Cartesian",    variant: "base",           frame: "cart",   options: "" },
  { op: "column",    fam: "Cartesian",    variant: "title",          frame: "cart",   options: "title=Monthly sales" },
  { op: "bar",       fam: "Cartesian",    variant: "base",           frame: "cart",   options: "" },
  { op: "line",      fam: "Cartesian",    variant: "base",           frame: "cart",   options: "" },
  { op: "line",      fam: "Cartesian",    variant: "marker",         frame: "cart",   options: "marker=on;linewidth=3" },
  { op: "area",      fam: "Cartesian",    variant: "base",           frame: "cart",   options: "" },
  { op: "scatter",   fam: "Cartesian",    variant: "base",           frame: "cart",   options: "" },
  { op: "pie",       fam: "Categorical",  variant: "base",           frame: "pie",    options: "" },
  { op: "pie",       fam: "Categorical",  variant: "labels-outside", frame: "pie",    options: "pielabels=outside" },
  { op: "pie",       fam: "Categorical",  variant: "labels-inside",  frame: "pie",    options: "pielabels=inside" },
  { op: "pie",       fam: "Categorical",  variant: "labels-off",     frame: "pie",    options: "pielabels=off" },
  { op: "pie",       fam: "Categorical",  variant: "title",          frame: "pie",    options: "title=Regional share" },
  { op: "radar",     fam: "Categorical",  variant: "multi-axis",     frame: "radar",  options: "radarscale=axis" },
  { op: "radar",     fam: "Categorical",  variant: "multi-shared",   frame: "radar",  options: "radarscale=shared" },
  { op: "radar",     fam: "Categorical",  variant: "multi-color",    frame: "radar",  options: "radarscale=axis;color=#e2557b" },
  { op: "radar",     fam: "Categorical",  variant: "single-base",    list: true,      options: "" },
  { op: "radar",     fam: "Categorical",  variant: "single-color",   list: true,      options: "color=#e2557b" },
  { op: "radialbar", fam: "Categorical",  variant: "base",           frame: "pie",    options: "" },
  { op: "funnel",    fam: "Categorical",  variant: "base",           frame: "pie",    options: "" },
  { op: "composed",  fam: "Multi-series", variant: "base",           frame: "cart",   options: "" },
  { op: "composed",  fam: "Multi-series", variant: "marker",         frame: "cart",   options: "marker=on;linewidth=3" },
  { op: "composed",  fam: "Multi-series", variant: "title",          frame: "cart",   options: "title=Sales vs target" },
  { op: "bubble",    fam: "Multi-series", variant: "base",           frame: "bubble", options: "" },
];

/** The card's two selects: [0] the family filter, [1] the op. Hover first — LazySelect
 *  keeps its option list out of the DOM until the pointer arrives. */
async function pickSelect(page, nodeId, index, value) {
  const at = (nodeId, index) => {
    const card = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`);
    const s = [...(card?.querySelectorAll(".solenoid-node__field-row select") ?? [])][index];
    if (!s) return null;
    const r = s.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };
  for (let attempt = 0; ; attempt++) {
    const pt = await page.evaluate(at, nodeId, index);
    if (!pt) throw new Error(`no select #${index} on ${nodeId}`);
    await page.mouse.move(pt.x, pt.y);
    await wait(200);
    const has = await page.evaluate((nodeId, index, value) => {
      const card = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`);
      const s = [...(card?.querySelectorAll(".solenoid-node__field-row select") ?? [])][index];
      return !!s && [...s.options].some((o) => o.value === value);
    }, nodeId, index, value);
    if (has) break;
    if (attempt >= 2) throw new Error(`select #${index} on ${nodeId} never offered "${value}"`);
  }
  const h = await page.evaluateHandle((nodeId, index) => {
    const card = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`);
    return [...(card?.querySelectorAll(".solenoid-node__field-row select") ?? [])][index];
  }, nodeId, index);
  await h.select(value);
  await h.dispose();
  await wait(350);
}

async function seedDoc(page) {
  await page.waitForFunction(() => !!window.__spike, { timeout: 30000 });
  await page.evaluate((id) => window.__spike.seed(id), SEED);
  await page.waitForFunction(() => window.__spike.revealPhase() === "idle", { timeout: 30000 });
  await wait(1200);
  ids = await page.evaluate((chart, src, list) => {
    const ns = window.__spike.positions();
    const find = (label, type) => ns.find((n) => n.label === label && n.type === type)?.id ?? null;
    return { chart: find(chart, "ChartNode"), src: find(src, "FrameInputNode"), list: find(list, "ChartNode") };
  }, FRAME_LABEL, FRAME_SRC_LABEL, LIST_LABEL);
  if (!ids.chart || !ids.src || !ids.list) throw new Error(`seed nodes not found: ${JSON.stringify(ids)}`);
}

async function shoot(page, shot, theme) {
  const nodeId = shot.list ? ids.list : ids.chart;
  const label = shot.list ? LIST_LABEL : FRAME_LABEL;
  // Frame the card before touching its selects — the hover that arms a LazySelect is a real
  // mouse move, so the select has to be on screen.
  await page.evaluate((label, k) => window.__spike.zoomNode(label, k, 200, 160), label, ZOOM);
  await wait(500);
  if (!shot.list) {
    await page.evaluate((id, text) => window.__spike.patch(id, { frameText: text }),
      ids.src, JSON.stringify(FRAMES[shot.frame]));
  }
  await pickSelect(page, nodeId, 0, shot.fam);
  await pickSelect(page, nodeId, 1, shot.op);
  await page.evaluate((id, options) =>
    window.__spike.patch(id, { stringLiterals: options ? { options } : {} }), nodeId, shot.options);
  await wait(300);
  await page.evaluate((label, k) => window.__spike.zoomNode(label, k, 200, 160), label, ZOOM);
  await wait(500);
  await page.mouse.move(6, 6); // hover styling must not land in the frame
  await wait(250);

  const clip = await page.evaluate((nodeId) => {
    const card = document.querySelector(`.react-flow__node[data-id="${nodeId}"] .solenoid-node`);
    if (!card) return null;
    const r = card.getBoundingClientRect();
    const pad = 10;
    return { x: Math.max(0, Math.round(r.x - pad)), y: Math.max(0, Math.round(r.y - pad)),
             width: Math.round(r.width + pad * 2), height: Math.round(r.height + pad * 2) };
  }, nodeId);
  if (!clip || clip.width < 40) throw new Error(`no card rect for ${nodeId}`);

  const file = `${shot.op}--${shot.variant}--${theme}.png`;
  await page.screenshot({ path: path.join(OUT, file), clip });
  return file;
}

await mkdir(OUT, { recursive: true });
const browser = await puppeteer.launch({
  headless: process.env.HEADLESS === "1",
  executablePath: CHROME,
  args: ["--window-size=1600,1000"],
  defaultViewport: { width: 1600, height: 1000 },
});
const lines = [];
let made = 0, failed = 0;
try {
  const page = await browser.newPage();
  await page.goto("http://localhost:1420", { waitUntil: "load" });

  for (const theme of ["dark", "light"]) {
    await page.evaluate((mode) =>
      localStorage.setItem("solenoid.theme", JSON.stringify({ accent: "gold", mode })), theme);
    await page.reload({ waitUntil: "load" });
    await seedDoc(page);

    for (const shot of SHOTS) {
      const src = shot.list ? "list (5 values)" : `frame:${shot.frame}`;
      let file = null;
      for (let tries = 0; tries < 3 && !file; tries++) {
        try {
          file = await shoot(page, shot, theme);
        } catch (err) {
          // An HMR reload from a peer agent's save kills the context mid-run.
          console.log(`  retry ${shot.op}/${shot.variant}/${theme}: ${err.message}`);
          await wait(1500);
          try { await seedDoc(page); } catch { /* the reload may still be in flight */ }
        }
      }
      if (file) {
        made++;
        lines.push(`${file}    data=${src}    options="${shot.options}"`);
        console.log(`${made}. ${file}`);
      } else {
        failed++;
        lines.push(`MISSING ${shot.op}--${shot.variant}--${theme}.png    data=${src}    options="${shot.options}"`);
        console.log(`FAILED ${shot.op}/${shot.variant}/${theme}`);
      }
    }
  }
} finally {
  await browser.close();
}

const frameSpec = Object.entries(FRAMES).map(([k, cols]) =>
  `  frame:${k}  ` + cols.map((c) => `${c.name}(${c.type}) ${c.values.join(",")}`).join(" | ")).join("\n");
await writeFile(path.join(OUT, "notes.txt"),
  `Chart op + option screenshot pass — seed "${SEED}", zoom ${ZOOM}, natural pixels.\n` +
  `${made} rendered, ${failed} missing.\n\nTHE FEED FRAMES\n${frameSpec}\n\n${lines.join("\n")}\n`, "utf8");
console.log(`\n${made} PNGs in ${OUT} (${failed} missing) — notes.txt written`);
process.exitCode = failed === 0 ? 0 : 1;
