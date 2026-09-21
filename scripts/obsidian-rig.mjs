// [[C107]] obsidianPlugin
// A second, private Obsidian to check the plugin and the vault look against the real thing
// (specs/obsidian-plugin.md § Verifying against real Obsidian). It runs on its own X display with
// its own profile and a COPY of the demo vault, so the author's Obsidian is never touched. Linux.
//
//   npm run plugin:rig -- up                       start it (idempotent) and wait until it answers
//   npm run plugin:rig -- sync                     copy the vault's config + plugin build in, reload the plugin
//   npm run plugin:rig -- shot <note> <out.png>    open a note and screenshot the window
//        [--light] [--reading] [--scroll <px>] [--clip x,y,w,h] [--scale 2] [--popout] [--settings]
//   npm run plugin:rig -- eval '<js>'              run JS in the app window (`app` is in scope), print the result
//   npm run plugin:rig -- down                     stop everything it started
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const RIG = path.join(os.tmpdir(), "solenoid-obsidian-rig");
const VAULT = path.join(RIG, "vault");
const PROFILE = path.join(RIG, "profile");
const DISPLAY = process.env.RIG_DISPLAY ?? ":7";
const PORT = Number(process.env.RIG_PORT ?? 9333);
const OBSIDIAN = process.env.OBSIDIAN ?? "/opt/Obsidian/obsidian";
// `pkill -f` matches its own shell on a plain pattern; the bracket keeps it off itself.
const bracket = (s) => `[${s[0]}]${s.slice(1)}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const detach = (cmd, args, env = {}) => spawn(cmd, args, { detached: true, stdio: "ignore", env: { ...process.env, ...env } }).unref();
const alive = (pattern) => spawnSync("pgrep", ["-f", bracket(pattern)]).status === 0;

async function answers() {
  try { return (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok; } catch { return false; }
}

function copyVault() {
  fs.rmSync(VAULT, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, "demo-vault"), VAULT, { recursive: true });
  // The author's own pane layout is theirs; the rig opens one clean pane.
  fs.rmSync(path.join(VAULT, ".obsidian", "workspace.json"), { force: true });
}

async function up() {
  if (await answers()) return console.log(`rig: already up on ${DISPLAY}, port ${PORT}`);
  fs.mkdirSync(PROFILE, { recursive: true });
  copyVault();
  fs.writeFileSync(path.join(PROFILE, "obsidian.json"), JSON.stringify({ vaults: { a1b2c3d4e5f60718: { path: VAULT, ts: Date.now(), open: true } } }));
  if (!alive(`Xephyr ${DISPLAY}`)) {
    detach("Xephyr", [DISPLAY, "-screen", "1500x950", "-ac", "-nolisten", "tcp"]);
    await sleep(1200);
    detach("metacity", [], { DISPLAY });
  }
  detach(OBSIDIAN, ["--no-sandbox", `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`], { DISPLAY });
  for (let i = 0; i < 60 && !(await answers()); i++) await sleep(500);
  if (!(await answers())) throw new Error("rig: Obsidian never answered on the debugging port");
  await withApp(async (page) => {
    await page.evaluate(async () => {
      const { plugins } = window.app;
      if (!plugins.isEnabled?.() && plugins.setEnable) await plugins.setEnable(true);
      if (!plugins.enabledPlugins.has("solenoid-properties")) await plugins.enablePluginAndSave("solenoid-properties").catch(() => {});
      // A first open asks whether to trust the vault; the answer is already yes.
      for (const btn of document.querySelectorAll(".modal-container button")) if (/trust/i.test(btn.textContent ?? "")) btn.click();
      document.querySelectorAll(".modal-container .modal-close-button").forEach((x) => x.click());
      try { window.electron.remote.getCurrentWindow().setBounds({ x: 0, y: 0, width: 1480, height: 920 }); } catch { /* no remote: the window keeps its size */ }
    });
  });
  console.log(`rig: up on ${DISPLAY}, port ${PORT}, vault ${VAULT}`);
}

async function withApp(fn) {
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null });
  try {
    const page = (await browser.pages()).find((p) => p.url().startsWith("app://"));
    if (!page) throw new Error("rig: no Obsidian window");
    await page.waitForFunction(() => !!window.app?.workspace?.layoutReady, { timeout: 30000 });
    return await fn(page, browser);
  } finally {
    await browser.disconnect();
  }
}

async function sync() {
  const from = path.join(ROOT, "demo-vault", ".obsidian");
  for (const rel of ["snippets", "appearance.json", "types.json", path.join("plugins", "solenoid-properties")]) {
    const src = path.join(from, rel);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(VAULT, ".obsidian", rel), { recursive: true, force: true });
  }
  await withApp((page) => page.evaluate(async () => {
    const { plugins, customCss } = window.app;
    await plugins.disablePlugin("solenoid-properties");
    await plugins.enablePlugin("solenoid-properties");
    customCss.requestLoadSnippets?.();
    // A reload unmounts every chip, and Obsidian does not redraw a note that is already open.
    window.app.workspace.iterateAllLeaves((leaf) => { void leaf.rebuildView?.(); });
  }));
  console.log("rig: synced, plugin reloaded");
}

function flags(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const key = a.slice(2);
    out[key] = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : true;
  }
  return out;
}

async function shot(args) {
  const f = flags(args);
  const [note, out] = f._;
  if (!note || !out) throw new Error("rig: shot <note> <out.png>");
  await withApp(async (page, browser) => {
    const size = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    if (f.scale) await page.setViewport({ ...size, deviceScaleFactor: Number(f.scale) });
    await page.evaluate(async (note, light, reading, popout, settings) => {
      const app = window.app;
      app.changeTheme?.(light ? "moonstone" : "obsidian");
      const file = app.vault.getAbstractFileByPath(note);
      if (!file) throw new Error(`no such note: ${note}`);
      const leaf = popout ? app.workspace.openPopoutLeaf() : app.workspace.getLeaf(false);
      await leaf.openFile(file, { state: { mode: reading ? "preview" : "source", source: false } });
      if (settings) { app.setting.open(); app.setting.openTabById("solenoid-properties"); }
    }, note, !!f.light, !!f.reading, !!f.popout, !!f.settings);
    await sleep(2200);
    if (f.scroll) {
      await page.evaluate((y) => {
        const view = window.app.workspace.getMostRecentLeaf().view.containerEl;
        for (const el of view.querySelectorAll(".markdown-preview-view, .cm-scroller")) el.scrollTo(0, y);
      }, Number(f.scroll));
      await sleep(900);
    }
    // Settings and a popped-out note are windows of their own: shoot the newest other page.
    const pages = await browser.pages();
    const target = f.popout || f.settings ? pages.filter((p) => p !== page).at(-1) ?? page : page;
    const clip = typeof f.clip === "string" ? (([x, y, width, height]) => ({ x, y, width, height }))(f.clip.split(",").map(Number)) : undefined;
    await target.screenshot({ path: path.resolve(out), clip });
    if (f.scale) await page.setViewport(null).catch(() => {});
  });
  console.log(`rig: wrote ${out}`);
}

async function evaluate(js) {
  const result = await withApp((page) => page.evaluate((src) => {
    const app = window.app;
    return Promise.resolve(eval(src)).then((v) => (v === undefined ? null : JSON.parse(JSON.stringify(v))));
  }, js));
  console.log(JSON.stringify(result, null, 1));
}

function down() {
  spawnSync("pkill", ["-f", bracket(`user-data-dir=${PROFILE}`)]);
  spawnSync("pkill", ["-f", bracket(`Xephyr ${DISPLAY}`)]);
  console.log("rig: down");
}

const [cmd, ...rest] = process.argv.slice(2);
const run = { up, sync, shot: () => shot(rest), eval: () => evaluate(rest.join(" ")), down };
if (!run[cmd]) {
  console.error("usage: obsidian-rig.mjs up | sync | shot <note> <out.png> [flags] | eval '<js>' | down");
  process.exit(1);
}
await run[cmd]();
