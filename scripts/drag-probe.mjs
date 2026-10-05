// Counts which React components render while a card is dragged, to keep drags off the render path.
// Starts the dev server if it is down; the graph opens as the only document of a fresh profile.
//   node scripts/drag-probe.mjs <graph.json> [card|group|handles|label:<text>] [--hover] [--out file.png]
// card: the first visible card; group: a group by its header; handles: the card with the most sockets;
// label:<text>: the first card whose text holds <text>. --hover also fires the cable-hover store six
// times before the drag, as crossing cables does. Prints the drag time and the render count per
// component over a 30-step drag (only fibers React reprocessed, the check React DevTools uses), then
// screenshots the canvas mid-drag. A drag should render the dragged card's cables, React Flow's own
// wrappers and nothing else ([[react-flow-surface-contract]] § Drag performance).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { browserPath } from "./browser.mjs";

const argv = process.argv.slice(2);
const opt = { file: null, pick: "card", hover: false, out: join(tmpdir(), "solenoid-drag.png") };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--hover") opt.hover = true;
  else if (a === "--out") opt.out = argv[++i];
  else if (!opt.file) opt.file = a;
  else opt.pick = a;
}
if (!opt.file) { console.error("usage: node scripts/drag-probe.mjs <graph.json> [card|group|handles|label:<text>] [--hover] [--out file.png]"); process.exit(2); }

const raw = JSON.parse(readFileSync(opt.file, "utf8"));
const graph = raw.graph ?? raw;
execFileSync(process.execPath, [new URL("./dev-up.mjs", import.meta.url).pathname], { stdio: "inherit" });

const browser = await puppeteer.launch({ executablePath: browserPath(), headless: true, args: ["--no-sandbox", "--window-size=1600,1000"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
  const doc = { id: "probe", name: "Probe", graph: { v: 2, ...graph }, updatedAt: Date.now() };
  await page.evaluateOnNewDocument((doc) => {
    if (!sessionStorage.getItem("probe-seeded")) {
      sessionStorage.setItem("probe-seeded", "1");
      localStorage.clear();
      localStorage.setItem("solenoid.docs.index.a", JSON.stringify({ seq: 1, currentId: doc.id, docs: [{ id: doc.id, name: doc.name, updatedAt: doc.updatedAt }] }));
      localStorage.setItem(`solenoid.docs.doc.${doc.id}.a`, JSON.stringify({ seq: 2, doc }));
    }
    // A stand-in DevTools hook: React calls onCommitFiberRoot after every commit.
    const counts = new Map();
    window.__renders = counts;
    window.__counting = false;
    const nameOf = (t) => (t && (t.displayName || t.name)) || (t && t.render && (t.render.displayName || t.render.name)) || (t && t.type && nameOf(t.type)) || null;
    const walk = (f) => {
      while (f) {
        // PerformedWork (flag 1) on a function, class, forwardRef or memo fiber: it rendered in this commit.
        if ([0, 1, 11, 14, 15].includes(f.tag) && (f.flags & 1)) {
          const n = nameOf(f.type) ?? `anonymous (tag ${f.tag})`;
          counts.set(n, (counts.get(n) ?? 0) + 1);
        }
        // A child list shared with the previous tree was skipped this commit; its stale flags don't count.
        if (f.child && !(f.alternate && f.alternate.child === f.child)) walk(f.child);
        f = f.sibling;
      }
    };
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true, renderers: new Map(), inject() { return 1; }, checkDCE() {},
      onScheduleFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
      onCommitFiberRoot(_id, root) { if (window.__counting) walk(root.current); },
    };
  }, doc);
  await page.goto("http://localhost:1420", { waitUntil: "networkidle2", timeout: 90_000 });
  await page.waitForSelector(".react-flow__node", { timeout: 30_000 });
  await page.click(".solenoid-nav__btn--fit").catch(() => {});
  await new Promise((r) => setTimeout(r, 2500));

  const target = await page.evaluate((pick) => {
    const vis = [...document.querySelectorAll(".react-flow__node")]
      .map((n) => ({ n, r: n.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 20 && r.top > 60 && r.left > 60 && r.bottom < innerHeight - 60 && r.right < innerWidth - 60);
    const isGroup = (n) => !!n.querySelector(".solenoid-group");
    const cards = vis.filter(({ n }) => !isGroup(n));
    const cand = pick === "group" ? vis.filter(({ n }) => isGroup(n))
      : pick === "handles" ? cards.sort((a, b) => b.n.querySelectorAll(".react-flow__handle").length - a.n.querySelectorAll(".react-flow__handle").length)
      : pick.startsWith("label:") ? cards.filter(({ n }) => (n.innerText || "").toLowerCase().includes(pick.slice(6).toLowerCase()))
      : cards;
    if (!cand.length) return null;
    const { n, r: box } = cand[0];
    const r = (pick === "group" && n.querySelector(".solenoid-group__header")?.getBoundingClientRect()) || box;
    return { x: r.left + Math.min(40, r.width / 2), y: r.top + Math.min(8, r.height / 2), label: (n.innerText || "").split("\n")[0], total: vis.length };
  }, opt.pick);
  if (!target) throw new Error(`nothing on screen matches "${opt.pick}"`);
  console.log(`dragging "${target.label}"`);

  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await page.mouse.move(target.x + 3, target.y + 3);
  await page.evaluate(() => { window.__renders.clear(); window.__counting = true; });
  if (opt.hover) {
    await page.evaluate(async () => {
      const { socketHighlightStore } = await import("/src/graph/cableState.ts");
      for (let i = 0; i < 6; i++) {
        socketHighlightStore.setCableHover([`probe${i}::x`]);
        await new Promise((r) => setTimeout(r, 30));
        socketHighlightStore.setCableHover([]);
        await new Promise((r) => setTimeout(r, 30));
      }
    });
  }
  const t0 = Date.now();
  for (let i = 1; i <= 30; i++) await page.mouse.move(target.x + 3 + i * 6, target.y + 3 + i * 3);
  const ms = Date.now() - t0;
  await page.evaluate(() => { window.__counting = false; });
  await page.screenshot({ path: opt.out });
  await page.mouse.up();

  const counts = await page.evaluate(() => [...window.__renders.entries()].sort((a, b) => b[1] - a[1]));
  console.log(`30 steps in ${ms} ms`);
  for (const [n, c] of counts) console.log(String(c).padStart(6), n);
  console.log(`saved ${opt.out}`);
} finally {
  await browser.close();
}
