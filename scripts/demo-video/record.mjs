// [[B3]] sameNodeEverywhere
// Records the scenes, one clip each, into .dev/video/clips: Solenoid scenes against the dev server on :1420, `app:
// "obsidian"` scenes on obsidian.mjs's rig. `node scripts/demo-video/record.mjs [scene…]`, all scenes when none are named.
import fs from "node:fs";
import path from "node:path";
import { launch, injectKit, injectCursor, Recorder, Hand, encodeClip, demo, sleep, OUT } from "./rig.mjs";
import { resetVault, obsidianUp, obsidianWindow, windowOrigin, ScreenRecorder, bridgeVault, VAULT } from "./obsidian.mjs";
import { SCENES } from "./scenes.mjs";

const APP_URL = process.env.URL ?? "http://localhost:1420";
const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : Object.keys(SCENES);
for (const n of names) if (!SCENES[n]) throw new Error(`unknown scene "${n}"; have ${Object.keys(SCENES).join(", ")}`);
const inObsidian = (n) => SCENES[n].app === "obsidian";

fs.mkdirSync(path.join(OUT, "clips"), { recursive: true });

// The round trip starts from a fresh copy of the demo vault; a later scene recorded alone keeps the vault it left.
if (names.includes("obs-look") || !fs.existsSync(VAULT)) resetVault();
const obsidian = names.some(inObsidian) ? await obsidianUp() : null;
if (obsidian) await injectCursor(obsidian.page);

const solenoid = names.some((n) => !inObsidian(n)) ? await launch(APP_URL) : null;
if (solenoid && names.some((n) => SCENES[n].vault)) {
  // Open in Obsidian goes where the OS would send an obsidian:// link: to the rig, which opens the note.
  await bridgeVault(solenoid.page, {
    onOpen: async (url) => {
      const file = new URL(url).searchParams.get("file");
      if (obsidian && file) await obsidian.page.evaluate((f) => window.app.workspace.openLinkText(f, "", false), file);
    },
  });
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

for (const name of names) {
  const scene = SCENES[name];
  console.log(`● ${name}`);
  const out = path.join(OUT, "clips", `${name}.mp4`);
  let meta;
  if (inObsidian(name)) {
    const hand = new Hand(obsidian.page);
    const ctx = obsidianContext(hand);
    await hand.hide();
    await scene.setup(ctx);
    await sleep(600);
    const rec = new ScreenRecorder();
    await rec.start(out);
    rec.begin();
    await scene.act(ctx);
    meta = await rec.stop();
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
    encodeClip(dir, out);
  }
  fs.writeFileSync(path.join(OUT, "clips", `${name}.json`), JSON.stringify({ duration: meta.duration, marks: meta.marks ?? {} }, null, 1));
  console.log(`  ${meta.duration.toFixed(1)} s → ${path.relative(process.cwd(), out)}`);
}
await solenoid?.browser.close();
obsidian?.browser.disconnect();
