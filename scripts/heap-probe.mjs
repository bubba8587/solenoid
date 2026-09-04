// Memory heap-snapshot investigation (1.4-plan.md § F5). Agent-run MEASUREMENT, not a
// build: where do the retained bytes of a "light app" actually live, and does anything
// leak across teardown/rebuild (reload) or per-doc-tab growth (repeated seeding)?
//
// Drives the real dev-server page via CDP: forces GC (HeapProfiler.collectGarbage),
// reads page.metrics() (JS heap + DOM Nodes + listeners), and on the big seed diffs a
// full heap snapshot's top retainers (grouped self_size) between the first and last
// reload cycle to name WHERE the bytes are (detached DOM clones? atlas? RF internals?).
//
// Run your own dev server from the worktree first, NOT :1420:
//   npm run dev -- --port 5199 --strictPort false
//   node scripts/heap-probe.mjs            # PORT=5199 by default
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME ??
  `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe`;
const PORT = process.env.PORT ?? "5199";
const URL = process.env.URL ?? `http://localhost:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const BIG = process.env.BIG ?? "chart-showcase";
const CYCLES = Number(process.env.CYCLES ?? 5);
const fmtMB = (b) => (b / 1048576).toFixed(1);

let client;
async function gc() {
  // Two passes: the first frees, the second collects what the first made unreachable.
  await client.send("HeapProfiler.collectGarbage");
  await client.send("HeapProfiler.collectGarbage");
  await wait(300);
}
async function settle(page) {
  await page.waitForFunction(() => window.__spike?.revealPhase() === "idle", { timeout: 25000 });
  await wait(1200);
}
async function measure(page, label) {
  await gc();
  const m = await page.metrics();
  const row = {
    label,
    heapMB: +fmtMB(m.JSHeapUsedSize),
    nodes: m.Nodes,
    listeners: m.JSEventListeners,
    docs: m.Documents,
    frames: m.Frames,
    layout: m.LayoutObjects,
  };
  console.log(`  ${label.padEnd(26)} heap=${row.heapMB}MB  DOM=${row.nodes}  listeners=${row.listeners}  layoutObj=${row.layout}`);
  return row;
}

// Full heap snapshot → self_size grouped so the top retainers are named.
async function snapshotRetainers(page) {
  const chunks = [];
  const onChunk = (p) => chunks.push(p.chunk);
  client.on("HeapProfiler.addHeapSnapshotChunk", onChunk);
  await client.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false, captureNumericValue: false });
  client.off("HeapProfiler.addHeapSnapshotChunk", onChunk);
  const snap = JSON.parse(chunks.join(""));
  const fields = snap.snapshot.meta.node_fields;
  const typeEnum = snap.snapshot.meta.node_types[0];
  const F = fields.length;
  const ti = fields.indexOf("type"), ni = fields.indexOf("name"), si = fields.indexOf("self_size");
  const nodes = snap.nodes, strings = snap.strings;
  const bySize = new Map();
  let detached = 0, total = 0;
  for (let i = 0; i < nodes.length; i += F) {
    const type = typeEnum[nodes[i + ti]];
    const name = strings[nodes[i + ni]] ?? "";
    const size = nodes[i + si];
    total += size;
    if (name.startsWith("Detached")) detached += size;
    // Object/native nodes carry a meaningful ctor/name; primitives group by type.
    const key = (type === "object" || type === "native") ? `${type}:${name || "(anon)"}` : type;
    bySize.set(key, (bySize.get(key) || 0) + size);
  }
  const top = [...bySize.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
    .map(([k, v]) => ({ k, mb: +fmtMB(v) }));
  return { totalMB: +fmtMB(total), detachedMB: +fmtMB(detached), top };
}

const browser = await puppeteer.launch({
  headless: true,
  executablePath: CHROME,
  args: ["--window-size=1600,1000"],
  defaultViewport: { width: 1600, height: 1000 },
});
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  client = await page.target().createCDPSession();
  await client.send("HeapProfiler.enable");
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__spike, { timeout: 25000 });
  await settle(page);

  const rows = [];
  console.log(`\n== Phase A: baselines (after settle + GC) ==`);
  rows.push(await measure(page, "getting-started (default)"));
  for (const seed of ["personal-finance", "power-features", BIG]) {
    await page.evaluate((id) => window.__spike.seed(id), seed);
    await settle(page);
    rows.push(await measure(page, `seed: ${seed}`));
  }

  console.log(`\n== Phase B: reload-cycle leak probe on ${BIG} (Ctrl+Shift+L = full teardown+rebuild, no tab growth) ==`);
  await page.evaluate((id) => window.__spike.seed(id), BIG);
  await settle(page);
  const cyc = [];
  let firstSnap, lastSnap;
  for (let i = 1; i <= CYCLES; i++) {
    await page.keyboard.down("Control"); await page.keyboard.down("Shift");
    await page.keyboard.press("KeyL");
    await page.keyboard.up("Shift"); await page.keyboard.up("Control");
    await wait(700);
    await settle(page);
    const r = await measure(page, `reload #${i}`);
    cyc.push(r);
    if (i === 1) firstSnap = await snapshotRetainers(page);
    if (i === CYCLES) lastSnap = await snapshotRetainers(page);
  }

  console.log(`\n== Phase C: per-doc-tab growth (seed ${BIG} x${CYCLES}, each adds a tab) ==`);
  await page.evaluate((id) => window.__spike.seed("getting-started"), "getting-started");
  await settle(page);
  const tab = [];
  for (let i = 1; i <= CYCLES; i++) {
    await page.evaluate((id) => window.__spike.seed(id), "power-features");
    await settle(page);
    tab.push(await measure(page, `tab #${i} (power-features)`));
  }

  // ---- report ----
  const growth = (arr) => ({
    heap: +(arr[arr.length - 1].heapMB - arr[0].heapMB).toFixed(1),
    nodes: arr[arr.length - 1].nodes - arr[0].nodes,
    listeners: arr[arr.length - 1].listeners - arr[0].listeners,
  });
  console.log(`\n===== SUMMARY =====`);
  console.log("Baselines:", JSON.stringify(rows, null, 0));
  console.log(`Reload-cycle growth (#1→#${CYCLES}):`, JSON.stringify(growth(cyc)));
  console.log("Reload cycles:", JSON.stringify(cyc.map((r) => ({ n: r.label, heap: r.heapMB, dom: r.nodes, lis: r.listeners }))));
  console.log(`Tab growth (#1→#${CYCLES}):`, JSON.stringify(growth(tab)));
  console.log("Tab cycles:", JSON.stringify(tab.map((r) => ({ n: r.label, heap: r.heapMB, dom: r.nodes, lis: r.listeners }))));
  console.log(`\nHeap snapshot ${BIG} reload #1: total=${firstSnap.totalMB}MB detached=${firstSnap.detachedMB}MB`);
  console.log("  top retainers:", JSON.stringify(firstSnap.top));
  console.log(`Heap snapshot ${BIG} reload #${CYCLES}: total=${lastSnap.totalMB}MB detached=${lastSnap.detachedMB}MB`);
  console.log("  top retainers:", JSON.stringify(lastSnap.top));
} finally {
  await browser.close();
}
