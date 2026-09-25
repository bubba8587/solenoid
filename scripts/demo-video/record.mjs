// [[B3]] sameNodeEverywhere
// Records scenes into .dev/video/clips: Solenoid scenes against the dev server on :1420 in headless Chromium,
// `app: "obsidian"` scenes on obsidian.mjs's rig, `app: "both"` stills of both apps, and `app: "split"` scenes with
// Obsidian and a Solenoid window side by side on the rig's display. `node scripts/demo-video/record.mjs [cut|scene…]`:
// a cut's name (cuts.mjs) films its scenes, and no names films every scene.
import fs from "node:fs";
import path from "node:path";
import { launch, launchWindow, injectKit, injectCursor, Recorder, Hand, encodeClip, demo, sleep, OUT, VIEW } from "./rig.mjs";
import { resetVault, obsidianUp, obsidianWindow, windowOrigin, placeWindow, ScreenRecorder, bridgeVault, grabScreen, VAULT } from "./obsidian.mjs";
import { SCENES } from "./scenes.mjs";
import { CUTS, cutScenes } from "./cuts.mjs";

const APP_URL = process.env.URL ?? "http://localhost:1420";
const wanted = process.argv.slice(2).flatMap((a) => (CUTS[a] ? cutScenes(CUTS[a]) : [a]));
const names = wanted.length ? wanted : Object.keys(SCENES);
for (const n of names) if (!SCENES[n]) throw new Error(`unknown scene "${n}"; have ${Object.keys(SCENES).join(", ")}`);
const inObsidian = (n) => SCENES[n].app === "obsidian";
const inBoth = (n) => SCENES[n].app === "both";
const inSplit = (n) => SCENES[n].app === "split";

// A split scene: Obsidian on the left 768 px of the 1920 px display at the video's scale, Solenoid on the rest at 1.2,
// which fits its toolbar. The seam and scales map a point from one window to the other.
const SEAM = 768;
const SOL_SCALE = 1.2;
const OBS_LEFT = { x: 0, y: 0, width: SEAM / VIEW.scale, height: VIEW.height };
const SOL_RIGHT = { x: Math.round(SEAM / SOL_SCALE), y: 0, width: Math.round((1920 - SEAM) / SOL_SCALE), height: Math.round(1080 / SOL_SCALE) };

fs.mkdirSync(path.join(OUT, "clips"), { recursive: true });

// A cut's first scene starts from a fresh copy of the demo vault; a later scene recorded alone keeps the vault it left.
if (names.some((n) => SCENES[n].fresh) || !fs.existsSync(VAULT)) resetVault();
const obsidian = names.some((n) => inObsidian(n) || inBoth(n) || inSplit(n)) ? await obsidianUp() : null;
if (obsidian) await injectCursor(obsidian.page);

/** Open in Obsidian goes where the OS would send an obsidian:// link: to the rig, which opens the note. */
const openInRig = async (url) => {
  const file = new URL(url).searchParams.get("file");
  if (obsidian && file) await obsidian.page.evaluate((f) => window.app.workspace.openLinkText(f, "", false), file);
};

const solenoid = names.some((n) => !inObsidian(n) && !inSplit(n)) ? await launch(APP_URL) : null;
if (solenoid && names.some((n) => SCENES[n].vault)) await bridgeVault(solenoid.page, { onOpen: openInRig });

const solWindow = names.some(inSplit) ? await launchWindow(APP_URL, { display: process.env.DEMO_DISPLAY ?? ":8", bounds: SOL_RIGHT, scale: SOL_SCALE }) : null;
if (solWindow) {
  await bridgeVault(solWindow.page, { onOpen: openInRig });
  // Drawn at the Obsidian window's size, so the pointer doesn't change size crossing the seam.
  await demo(solWindow.page, (s) => window.__demo.overlayScale(s), VIEW.scale / SOL_SCALE);
}

function solenoidContext(page, hand, rec) {
  const ctx = {
    page, hand, rec, sleep,
    async doc(graph, name) {
      await demo(page, async (g, n) => {
        const D = await import("/src/graph/documentStore.ts");
        await D.documentStore.importAsDocument(g, n);
      }, graph, name);
      await sleep(1800);
      await injectKit(page);
    },
    async example(seedId) {
      await demo(page, async (id) => {
        const D = await import("/src/graph/documentStore.ts");
        await D.documentStore.newFromTemplate(id);
      }, seedId);
      await sleep(3500);
      await injectKit(page);
    },
    currentDoc: () => demo(page, async () => (await import("/src/graph/documentStore.ts")).documentStore.currentName()),
    bounds: (labels) => demo(page, (l) => window.__demo.bounds(l), labels),
    async cameraOn(labels, opts = {}) {
      const b = Array.isArray(labels) ? await ctx.bounds(labels) : labels;
      return demo(page, (bb, o) => window.__demo.cameraFor(bb, o), b, opts);
    },
    async frame(labels, opts) { await demo(page, (c) => window.__demo.setCamera(c), await ctx.cameraOn(labels, opts)); await sleep(300); },
    async fly(labels, opts, ms = 1400) { await demo(page, (c, t) => window.__demo.fly(c, t), await ctx.cameraOn(labels, opts), ms); },
    drift: (d, ms) => demo(page, (dd, t) => window.__demo.drift(dd, t), d, ms),
    toScreen: (x, y) => demo(page, (a, b) => window.__demo.toScreen(a, b), x, y),
    node: (label) => demo(page, (l) => window.__demo.nodeRect(l), label),
    socket: (label, key, side) => demo(page, (l, k, s) => window.__demo.handle(l, k, s), label, key, side),
    within: (label, sel, text) => demo(page, (l, s, t) => window.__demo.within(l, s, t), label, sel, text),
    find: (sel, text) => demo(page, (s, t) => window.__demo.find(s, t), sel, text),
    demo: (fn, ...args) => demo(page, fn, ...args),
    async box(target, pad) {
      const r = typeof target === "string" ? await ctx.node(target) : target;
      await demo(page, (rr, p) => window.__demo.box(rr, p), r, pad);
    },
    clearBoxes: () => demo(page, () => window.__demo.clearBoxes()),
    socketRow: (label, key, side) => demo(page, (l, k, s) => window.__demo.socketRow(l, k, s), label, key, side),
    async row(labels, gap) { await demo(page, (l, g) => window.__demo.row(l, g), labels, gap); await sleep(400); },
    chip: (label) => demo(page, (l) => window.__demo.chip(l), label),
    cableMid: (...a) => demo(page, (...b) => window.__demo.cableMid(...b), ...a),
    // The socket legend is one overlay across documents; its × and ? buttons flip it.
    async legend(open) {
      const btn = await page.$(`.solenoid-legend button[title="${open ? "Show" : "Hide"} socket legend"]`);
      if (btn) { await btn.click(); await sleep(300); }
    },
    async openReport(label, { dock = false, tab } = {}) {
      await demo(page, async (l) => {
        const n = await window.__demo.byLabel(l);
        const R = await import("/src/graph/reportStore.ts");
        R.reportStore.open(n.id);
      }, label);
      await sleep(900);
      if (dock) { await page.click('[aria-label="Dock report to the right"]'); await sleep(700); }
      if (tab) {
        await demo(page, (t) => [...document.querySelectorAll(".report-viewtoggle__seg")].find((b) => b.textContent.trim() === t)?.click(), tab);
        await sleep(900);
      }
    },
  };
  return ctx;
}

function obsidianContext(hand) {
  const { browser, page } = obsidian;
  let offset = { x: 0, y: 0 };
  const ctx = {
    app: "obsidian", browser, page, hand, sleep,
    obs: (fn, ...args) => page.evaluate(fn, ...args),
    box: (r, pad, pg = page) => pg.evaluate((rr, p) => window.__demo.box(rr, p), r, pad),
    clearBoxes: (pg = page) => pg.evaluate(() => window.__demo.clearBoxes()),
    /** The pointer crosses into a window Obsidian just opened, at the same spot on the screen. */
    async enterWindow(title) {
      const win = await obsidianWindow(browser, title);
      await injectCursor(win);
      const [m, o] = [await windowOrigin(page), await windowOrigin(win)];
      offset = { x: o.x - m.x, y: o.y - m.y };
      const inner = new Hand(win);
      await hand.hide();
      await inner.show(hand.x - offset.x, hand.y - offset.y);
      return { win, hand: inner };
    },
    /** Back to the main window, once the other one has closed. */
    async leaveWindow(inner) {
      await hand.show(inner.x + offset.x, inner.y + offset.y);
    },
  };
  return ctx;
}

function splitContext(rec) {
  const hands = { obs: new Hand(obsidian.page), sol: new Hand(solWindow.page) };
  const geo = { obs: { x0: 0, k: VIEW.scale }, sol: { x0: SEAM, k: SOL_SCALE } };
  const toScreen = (app, x, y) => ({ x: geo[app].x0 + x * geo[app].k, y: y * geo[app].k });
  const fromScreen = (app, p) => ({ x: (p.x - geo[app].x0) / geo[app].k, y: p.y / geo[app].k });
  const ptOf = (pt) => ({ x: pt.cx ?? pt.x, y: pt.cy ?? pt.y });
  let active = null;
  return {
    app: "split", rec, sleep,
    obs: obsidianContext(hands.obs),
    sol: solenoidContext(solWindow.page, hands.sol, rec),
    /** The pointer in `app`'s window. From the other window it travels to the seam on the way to `toward` and
     *  carries on from the same spot, so it reads as one pointer. */
    async hand(app, toward) {
      const next = hands[app];
      if (active === app) return next;
      if (active === null) {
        const p = toward ? ptOf(toward) : { x: next.x, y: next.y };
        await next.show(p.x, p.y);
        active = app;
        return next;
      }
      const cur = hands[active];
      const a = toScreen(active, cur.x, cur.y);
      const b = toward ? toScreen(app, ptOf(toward).x, ptOf(toward).y) : { x: SEAM + (app === "sol" ? 80 : -80), y: a.y };
      const f = Math.max(0, Math.min(1, (SEAM - a.x) / ((b.x - a.x) || 1)));
      const y = a.y + (b.y - a.y) * f;
      const out = fromScreen(active, { x: SEAM + (active === "obs" ? -2 : 2), y });
      await cur.move(out.x, out.y, { bow: 0.25 });
      await cur.hide();
      const inn = fromScreen(app, { x: SEAM + (app === "obs" ? -2 : 2), y });
      await next.show(inn.x, inn.y);
      active = app;
      return next;
    },
    /** Hides the pointer wherever it is. */
    async noHand() { for (const h of Object.values(hands)) await h.hide(); active = null; },
    /** A rect in a window's CSS px, as screen px for a zoom mark. */
    screenRect(app, r) { const p = toScreen(app, r.x, r.y); return { x: p.x, y: p.y, w: r.w * geo[app].k, h: r.h * geo[app].k }; },
  };
}

for (const name of names) {
  const scene = SCENES[name];
  console.log(`● ${name}`);
  const out = path.join(OUT, "clips", `${name}.mp4`);
  let meta;
  if (inBoth(name) || (inObsidian(name) && scene.states)) {
    // A stills scene: matched shots per state, which compose.mjs lays side by side (or full frame) and crossfades.
    const dir = path.join(OUT, "clips", name);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    await placeWindow(obsidian.page, { top: true });
    const ctx = inBoth(name)
      ? { sol: solenoidContext(solenoid.page, new Hand(solenoid.page), null), obs: obsidianContext(new Hand(obsidian.page)), sleep }
      : obsidianContext(new Hand(obsidian.page));
    if (solenoid) await demo(solenoid.page, () => window.__demo.cursor(false));
    await scene.setup(ctx);
    for (const [i, state] of scene.states.entries()) {
      await scene.apply(ctx, state);
      await sleep(1200);
      const n = String(i).padStart(2, "0");
      if (inBoth(name)) await solenoid.page.screenshot({ path: path.join(dir, `${n}-sol.png`) });
      grabScreen(path.join(dir, `${n}-obs.png`));
    }
    await scene.teardown?.(ctx);
    meta = { duration: scene.states.length * scene.hold };
  } else if (inObsidian(name)) {
    await placeWindow(obsidian.page, { top: true });
    const hand = new Hand(obsidian.page);
    const ctx = obsidianContext(hand);
    await hand.hide();
    await scene.setup(ctx);
    await sleep(600);
    const rec = new ScreenRecorder();
    await rec.start(out);
    rec.begin();
    ctx.rec = rec;
    await scene.act(ctx);
    meta = await rec.stop();
    await scene.teardown?.(ctx);
  } else if (inSplit(name)) {
    await placeWindow(obsidian.page, OBS_LEFT);
    const rec = new ScreenRecorder();
    const ctx = splitContext(rec);
    await ctx.noHand();
    await scene.setup(ctx);
    await sleep(600);
    await rec.start(out);
    rec.begin();
    await scene.act(ctx);
    meta = await rec.stop();
    await scene.teardown?.(ctx);
  } else {
    const { page } = solenoid;
    const hand = new Hand(page);
    const rec = new Recorder(page);
    const ctx = solenoidContext(page, hand, rec);
    await demo(page, () => window.__demo.cursor(false));
    await scene.setup(ctx);
    await sleep(600);
    const dir = path.join(OUT, "raw", name);
    await rec.start(dir);
    await scene.act(ctx);
    meta = await rec.stop();
    await scene.teardown?.(ctx);
    encodeClip(dir, out);
  }
  fs.writeFileSync(path.join(OUT, "clips", `${name}.json`), JSON.stringify({ duration: meta.duration, marks: meta.marks ?? {} }, null, 1));
  console.log(`  ${meta.duration.toFixed(1)} s → ${path.relative(process.cwd(), out)}`);
}
await solenoid?.browser.close();
await solWindow?.browser.close();
obsidian?.browser.disconnect();
