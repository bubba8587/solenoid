// The marketing images (README shots, link-preview cards, the GitHub social card) shot from the real app, so a UI
// change is one rerun away from fresh pictures. Shots and cards are declared in scripts/site-shots/shots.mjs.
// Starts the dev server if it is down. Each shot opens its graph as the only document of a fresh profile.
//   node scripts/site-shots.mjs [name…]        every shot then every card, or only the named ones
//   node scripts/site-shots.mjs --labels <seed|graph.json>   print each card's and group's label, for framing
// Raw captures land in .dev/site-shots/; each shot or card with `out` is also written there (repo-relative).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { browserPath } from "./browser.mjs";
import { expand } from "./shot-graph-expand.mjs";
import { SHOTS, CARDS } from "./site-shots/shots.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = join(ROOT, ".dev", "site-shots");
const APP = "http://localhost:1420";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(RAW, { recursive: true });

// The overlays a picture of the work never wants: the socket legend, the minimap, transient toasts.
const HIDE = [".solenoid-legend", ".solenoid-minimap", ".solenoid-toast", ".solenoid-toasts"];

function loadGraph(src) {
  const seedFile = join(ROOT, "src", "graph", "seedGraphs", `${src}.json`);
  const file = existsSync(seedFile) ? seedFile : join(ROOT, "scripts", "site-shots", src);
  const raw = JSON.parse(readFileSync(file, "utf8"));
  return expand(raw);
}

async function openGraph(browser, shot) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  // `zoom` is browser zoom: the same output pixels with a smaller CSS viewport, so the chrome reads larger.
  const [w, h] = shot.size ?? [1440, 900];
  const zoom = shot.zoom ?? 1;
  await page.setViewport({ width: Math.round(w / zoom), height: Math.round(h / zoom), deviceScaleFactor: (shot.dpr ?? 2) * zoom });
  page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message}`));
  const graph = loadGraph(shot.graph);
  const doc = { id: "shot", name: shot.title ?? graph.label ?? "Untitled", graph, updatedAt: Date.now() };
  await page.evaluateOnNewDocument((doc, theme, palette) => {
    if (sessionStorage.getItem("shot-seeded")) return;
    sessionStorage.setItem("shot-seeded", "1");
    localStorage.clear();
    localStorage.setItem("solenoid.docs.index.a", JSON.stringify({ seq: 1, currentId: doc.id, docs: [{ id: doc.id, name: doc.name, updatedAt: doc.updatedAt }] }));
    localStorage.setItem(`solenoid.docs.doc.${doc.id}.a`, JSON.stringify({ seq: 2, doc }));
    localStorage.setItem("solenoid.theme", JSON.stringify({ accent: "gold", mode: theme }));
    if (palette) localStorage.setItem("solenoid.palette", palette);
  }, doc, shot.theme ?? "dark", shot.palette ?? null);
  await page.goto(APP, { waitUntil: "networkidle2", timeout: 90_000 });
  await page.waitForSelector(".solenoid-node", { timeout: 30_000 });
  await page.waitForFunction(() => window.__spike?.revealPhase?.() === "idle", { timeout: 30_000 }).catch(() => {});
  await sleep(shot.settle ?? 2500);
  return { ctx, page };
}

/** Every card's and group's class, id, canvas box and label: what `frame.labels` matches against. */
async function labels(page) {
  return page.evaluate(async () => {
    const { getEditor, getView } = await import("/src/graph/process.ts");
    const vw = getView(), k = vw.transform.k;
    return getEditor().getNodes().map((n) => {
      const r = vw.nodeElement(n.id)?.getBoundingClientRect();
      const p = vw.position(n.id) ?? { x: 0, y: 0 };
      const box = r ? `${Math.round(p.x)},${Math.round(p.y)} ${Math.round(r.width / k)}x${Math.round(r.height / k)}` : "";
      return `${n.constructor.name.padEnd(22)} ${n.id.padEnd(18)} ${box.padEnd(20)} ${n.label ?? ""}`;
    });
  });
}

/** Puts the matched cards in the middle of the canvas at zoom `k`, or at the zoom that fits them inside `pad`. */
async function frameCards(page, f) {
  return page.evaluate(async (f) => {
    const { getEditor, getView } = await import("/src/graph/process.ts");
    const ed = getEditor(), vw = getView();
    const want = (f.labels ?? []).map((l) => l.toLowerCase());
    const nodes = ed.getNodes().filter((n) => {
      const l = String(n.label ?? "").toLowerCase();
      return !want.length || want.some((w) => (w.startsWith("=") ? l === w.slice(1) : l.includes(w)) || n.id === w);
    });
    if (!nodes.length) return { error: `no card matches ${JSON.stringify(f.labels)}` };
    const k0 = vw.transform.k;
    const box = { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity };
    for (const n of nodes) {
      const p = vw.position(n.id), el = vw.nodeElement(n.id);
      if (!p || !el) continue;
      const r = el.getBoundingClientRect();
      box.l = Math.min(box.l, p.x); box.t = Math.min(box.t, p.y);
      box.r = Math.max(box.r, p.x + r.width / k0); box.b = Math.max(box.b, p.y + r.height / k0);
    }
    // The canvas runs under the header and the status bar; frame inside the band between them.
    const r0 = vw.container.getBoundingClientRect();
    const top = document.querySelector(".solenoid-header")?.getBoundingClientRect().bottom ?? r0.top;
    const bottom = document.querySelector(".solenoid-statusbar")?.getBoundingClientRect().top ?? r0.bottom;
    const c = { left: r0.left, top, width: r0.width, height: bottom - top };
    const pad = f.pad ?? 48;
    // The canvas's own floating controls sit in the band's top corners; keep the cards below them.
    c.top += f.clearTop ?? 52; c.height -= f.clearTop ?? 52;
    const fit = Math.min((c.width - 2 * pad) / (box.r - box.l), (c.height - 2 * pad) / (box.b - box.t));
    const k = f.k ?? Math.min(fit, f.maxK ?? 1.25);
    const [ax, ay] = f.anchor ?? [0.5, 0.5];
    const [dx, dy] = f.offset ?? [0, 0];
    const x = c.left - r0.left + pad + (c.width - 2 * pad) * ax - (box.l + (box.r - box.l) * ax) * k + dx;
    const y = c.top - r0.top + pad + (c.height - 2 * pad) * ay - (box.t + (box.b - box.t) * ay) * k + dy;
    await vw.setCamera({ x, y, k });
    return { matched: nodes.length, k: Math.round(k * 100) / 100 };
  }, f);
}

async function runSteps(page, steps = []) {
  for (const s of steps) {
    if (s.click) await page.click(s.click);
    else if (s.clickText) {
      const ok = await page.evaluate(({ sel, text }) => {
        const el = [...document.querySelectorAll(sel)].find((e) => e.textContent?.trim().includes(text));
        el?.click();
        return !!el;
      }, s.clickText);
      if (!ok) throw new Error(`no ${s.clickText.sel} reading "${s.clickText.text}"`);
    }
    else if (s.popup) {
      const chips = await page.$$(s.chip ?? ".solenoid-array-chip--frame");
      if (!chips[s.popup - 1]) throw new Error(`no chip #${s.popup} (found ${chips.length})`);
      await chips[s.popup - 1].click();
    }
    else if (s.press) await page.keyboard.press(s.press);
    else if (s.eval) await page.evaluate(s.eval);
    await sleep(s.wait ?? 700);
  }
}

async function clipFor(page, shot) {
  if (!shot.crop || shot.crop === "app") return undefined;
  return page.evaluate((crop, pad) => {
    const rect = (el) => el?.getBoundingClientRect();
    let r;
    if (crop === "canvas") {
      const f = rect(document.querySelector(".react-flow"));
      const top = rect(document.querySelector(".solenoid-header"))?.bottom ?? f.top;
      const bottom = rect(document.querySelector(".solenoid-statusbar"))?.top ?? f.bottom;
      r = { x: f.left, y: top, width: f.width, height: bottom - top };
    }
    else if (crop === "popup") r = rect(document.querySelector(".table-popup") ?? document.querySelector("[role=dialog]"));
    else if (crop === "nodes") {
      const rs = [...document.querySelectorAll(".react-flow__node")].map(rect)
        .filter((x) => x.right > 0 && x.bottom > 0 && x.left < innerWidth && x.top < innerHeight);
      const l = Math.max(0, Math.min(...rs.map((x) => x.left)) - pad), t = Math.max(0, Math.min(...rs.map((x) => x.top)) - pad);
      r = { x: l, y: t, width: Math.min(innerWidth, Math.max(...rs.map((x) => x.right)) + pad) - l, height: Math.min(innerHeight, Math.max(...rs.map((x) => x.bottom)) + pad) - t };
    } else if (Array.isArray(crop)) r = { x: crop[0], y: crop[1], width: crop[2], height: crop[3] };
    return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
  }, shot.crop, shot.cropPad ?? 32) ?? undefined;
}

async function runShot(browser, shot) {
  const { ctx, page } = await openGraph(browser, shot);
  try {
    await page.addStyleTag({ content: `${[...HIDE, ...(shot.hide ?? [])].join(",")} { display: none !important; }` });
    if (shot.css) await page.addStyleTag({ content: shot.css });
    if (shot.fitGroups) {
      // A hand-placed graph gives its groups rough boxes; wrap each around its painted members as the app's group fit does.
      await page.evaluate(async () => {
        const { getEditor, getView } = await import("/src/graph/process.ts");
        const { autofitGroupWithHistory } = await import("/src/graph/groupLogic.ts");
        for (const g of getEditor().getNodes().filter((n) => n.constructor.name === "GroupNode")) {
          await autofitGroupWithHistory(getEditor(), getView(), g);
        }
      });
      await sleep(600);
    }
    if (shot.preSteps) await runSteps(page, shot.preSteps);
    if (shot.frame) {
      const res = await frameCards(page, shot.frame);
      if (res.error) throw new Error(res.error);
      console.log(`  framed ${res.matched} cards at k=${res.k}`);
      await sleep(900);
    }
    await runSteps(page, shot.steps);
    await sleep(600);
    const path = join(RAW, `${shot.name}.png`);
    await page.screenshot({ path, clip: await clipFor(page, shot) });
    if (shot.out) writeFileSync(join(ROOT, shot.out), readFileSync(path));
    console.log(`  saved ${shot.out ?? path}`);
  } finally {
    await ctx.close();
  }
}

/** A card is HTML laid out around raw shots (`shot("name")` gives a data URL), rendered in the app's own fonts. */
async function runCard(browser, card) {
  const page = await browser.newPage();
  try {
    const [w, h] = card.size;
    await page.setViewport({ width: w, height: h, deviceScaleFactor: card.dpr ?? 2 });
    const shot = (name) => `data:image/png;base64,${readFileSync(join(RAW, `${name}.png`)).toString("base64")}`;
    const asset = (p) => `data:image/svg+xml;base64,${readFileSync(join(ROOT, p)).toString("base64")}`;
    await page.goto(`${APP}/favicon.svg`);
    await page.setContent(`<!doctype html><html><head><base href="${APP}/">
      <link rel="stylesheet" href="/node_modules/@fontsource-variable/atkinson-hyperlegible-next/index.css">
      <link rel="stylesheet" href="/node_modules/@fontsource-variable/atkinson-hyperlegible-mono/index.css">
      <style>html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;font-family:"Atkinson Hyperlegible Next Variable",sans-serif}</style>
      </head><body>${card.html({ shot, asset, w, h })}</body></html>`, { waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);
    await sleep(300);
    const path = join(RAW, `${card.name}.png`);
    await page.screenshot({ path });
    if (card.out) writeFileSync(join(ROOT, card.out), readFileSync(path));
    console.log(`  saved ${card.out ?? path}`);
  } finally {
    await page.close();
  }
}

const argv = process.argv.slice(2);
execFileSync(process.execPath, [join(ROOT, "scripts", "dev-up.mjs")], { stdio: "inherit" });
const browser = await puppeteer.launch({ executablePath: browserPath(), headless: true, args: ["--no-sandbox"] });
try {
  if (argv[0] === "--labels") {
    const { ctx, page } = await openGraph(browser, { graph: argv[1] });
    for (const l of await labels(page)) console.log(l);
    await ctx.close();
  } else {
    const pick = (list) => (argv.length ? list.filter((s) => argv.includes(s.name)) : list);
    for (const shot of pick(SHOTS)) { console.log(`shot ${shot.name}`); await runShot(browser, shot); }
    for (const card of pick(CARDS)) { console.log(`card ${card.name}`); await runCard(browser, card); }
  }
} finally {
  await browser.close();
}
