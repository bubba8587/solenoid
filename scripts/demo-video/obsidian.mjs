// The Obsidian half of the demo: a private Obsidian on its own display with a fresh demo-vault copy, filmed whole
// so its Settings window floats over the main one. How and why: .claude/skills/demo-video/SKILL.md.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import puppeteer from "puppeteer-core";
import { ROOT, FFMPEG, FPS, VIEW, sleep } from "./rig.mjs";

const DISPLAY = process.env.DEMO_DISPLAY ?? ":8";
const PORT = Number(process.env.DEMO_OBSIDIAN_PORT ?? 9334);
const OBSIDIAN = process.env.OBSIDIAN ?? "/opt/Obsidian/obsidian";
const RIG = path.join(os.tmpdir(), "solenoid-demo-obsidian");
const PROFILE = path.join(RIG, "profile");
// Obsidian names a vault after its folder: the vault switcher and obsidian:// links show this name.
export const VAULT = path.join(RIG, "Demo vault");

const W = VIEW.width * VIEW.scale, H = VIEW.height * VIEW.scale;
const bracket = (s) => `[${s[0]}]${s.slice(1)}`; // keeps pgrep/pkill -f off its own command line
const alive = (pattern) => spawnSync("pgrep", ["-f", bracket(pattern)]).status === 0;
const detach = (cmd, args, env = {}) => spawn(cmd, args, { detached: true, stdio: "ignore", env: { ...process.env, ...env } }).unref();
async function answers() {
  try { return (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok; } catch { return false; }
}

/** The demo vault as a first-time user has it: plugin installed, its look off, no snippet, no saved layout. */
export function resetVault() {
  fs.rmSync(VAULT, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, "demo-vault"), VAULT, { recursive: true });
  const cfg = path.join(VAULT, ".obsidian");
  fs.rmSync(path.join(cfg, "workspace.json"), { force: true });
  fs.writeFileSync(path.join(cfg, "appearance.json"), JSON.stringify({ theme: "obsidian", enabledCssSnippets: [] }, null, 2));
  fs.writeFileSync(path.join(cfg, "community-plugins.json"), JSON.stringify(["solenoid-properties"], null, 2));
  const build = path.join(ROOT, "obsidian-plugin", "dist");
  if (!fs.existsSync(path.join(build, "main.js"))) throw new Error("no plugin build: run `npm run plugin:build`");
  const plugin = path.join(cfg, "plugins", "solenoid-properties");
  fs.cpSync(build, plugin, { recursive: true });
  fs.writeFileSync(path.join(plugin, "data.json"), JSON.stringify({ look: false }));
}

export async function obsidianDown() {
  spawnSync("pkill", ["-f", bracket(`remote-debugging-port=${PORT}`)]);
  for (let i = 0; i < 20 && (await answers()); i++) await sleep(250);
}

/** A fresh Obsidian on the vault, its window filling the virtual screen at the video's scale. */
export async function obsidianUp() {
  await obsidianDown();
  if (!alive(`Xvfb ${DISPLAY}`)) {
    detach("Xvfb", [DISPLAY, "-screen", "0", `${W}x${H}x24`, "-nolisten", "tcp"]);
    await sleep(1000);
  }
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.mkdirSync(PROFILE, { recursive: true });
  fs.writeFileSync(path.join(PROFILE, "obsidian.json"), JSON.stringify({ vaults: { d3m0v4u17: { path: VAULT, ts: Date.now(), open: true } } }));
  detach(OBSIDIAN, [
    "--no-sandbox", `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`, `--force-device-scale-factor=${VIEW.scale}`,
  ], { DISPLAY, GTK_THEME: "Adwaita:dark" }); // with no compositor, a window's resize border shows the GTK background
  for (let i = 0; i < 80 && !(await answers()); i++) await sleep(250);
  if (!(await answers())) throw new Error(`Obsidian never answered on port ${PORT} (OBSIDIAN=${OBSIDIAN})`);
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null });
  let page;
  for (let i = 0; i < 80 && !page; i++) {
    page = (await browser.pages()).find((p) => p.url().startsWith("app://"));
    if (!page) await sleep(250);
  }
  await page.waitForFunction(() => !!window.app?.workspace?.layoutReady, { timeout: 60000 });
  await page.evaluate(async (w, h) => {
    const { plugins } = window.app;
    if (!plugins.isEnabled?.() && plugins.setEnable) await plugins.setEnable(true);
    if (!plugins.enabledPlugins.has("solenoid-properties")) await plugins.enablePluginAndSave("solenoid-properties").catch(() => {});
    for (const btn of document.querySelectorAll(".modal-container button")) if (/trust/i.test(btn.textContent ?? "")) btn.click();
    document.querySelectorAll(".modal-container .modal-close-button").forEach((x) => x.click());
    window.electron.remote.getCurrentWindow().setBounds({ x: 0, y: 0, width: w, height: h });
  }, VIEW.width, VIEW.height);
  await sleep(1500);
  // Trusting the vault's plugins opens Settings on a first run.
  for (const p of await browser.pages()) if (p !== page) await p.evaluate(() => window.close()).catch(() => {});
  await sleep(500);
  return { browser, page };
}

/** Where the main window sits, in CSS px at the video's scale: the whole screen by default, or the left share of a
 *  split scene. `top` raises it over a Solenoid window that shares the display. */
export async function placeWindow(page, { x = 0, y = 0, width = VIEW.width, height = VIEW.height, top = false } = {}) {
  await page.evaluate((b, raise) => {
    const w = window.electron.remote.getCurrentWindow();
    w.setBounds(b);
    if (raise) w.moveTop();
  }, { x, y, width, height }, top);
  await sleep(500);
}

/** Obsidian down to the note: both sidebars collapsed, no ribbon, no status bar. */
export async function noteOnly(page) {
  await page.evaluate(() => {
    const app = window.app;
    app.workspace.leftSplit.collapse();
    app.workspace.rightSplit.collapse();
    app.vault.setConfig("showRibbon", false);
    if (!document.getElementById("__demo-quiet")) {
      const st = Object.assign(document.createElement("style"), { id: "__demo-quiet" });
      st.textContent = ".status-bar { display: none !important; }";
      document.head.appendChild(st);
    }
  });
  await sleep(300);
}

/** The window whose title matches, once it has opened. */
export async function obsidianWindow(browser, title, timeout = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    for (const p of await browser.pages()) {
      const t = await p.title().catch(() => "");
      if (title.test(t)) return p;
    }
    await sleep(100);
  }
  throw new Error(`no Obsidian window titled ${title}`);
}

/** Where a window's page sits on the screen, in CSS px: its frameless border is split evenly around it. */
export const windowOrigin = (page) => page.evaluate(() => ({
  x: screenX + (outerWidth - innerWidth) / 2,
  y: screenY + (outerHeight - innerHeight) / 2,
}));

/** One frame of the virtual screen, windows and all. */
export function grabScreen(file) {
  const r = spawnSync(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", "-f", "x11grab", "-draw_mouse", "0", "-video_size", `${W}x${H}`, "-i", `${DISPLAY}+0,0`, "-frames:v", "1", file]);
  if (r.status !== 0) throw new Error(`x11grab still failed: ${r.stderr}`);
}

/** Records the whole virtual screen from start() to stop(), then trims the lead-in off at the act's first mark. */
export class ScreenRecorder {
  async start(file) {
    this.raw = file.replace(/\.mp4$/, ".raw.mp4");
    this.out = file;
    this.proc = spawn(FFMPEG, [
      "-y", "-hide_banner", "-loglevel", "info",
      "-f", "x11grab", "-draw_mouse", "0", "-framerate", String(FPS), "-video_size", `${W}x${H}`, "-i", `${DISPLAY}+0,0`,
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "8", "-pix_fmt", "yuv420p", this.raw,
    ], { stdio: ["pipe", "ignore", "pipe"] });
    this.log = "";
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`x11grab never started:\n${this.log.slice(-600)}`)), 10000);
      this.proc.stderr.on("data", (d) => {
        this.log += d;
        if (!this.t0 && /frame=\s*\d+/.test(this.log)) { this.t0 = Date.now() / 1000; clearTimeout(timer); resolve(); }
      });
      this.proc.on("exit", () => { clearTimeout(timer); if (!this.t0) reject(new Error(`x11grab exited:\n${this.log.slice(-600)}`)); });
    });
    this.lead = 0;
  }
  /** The act starts here: everything before it is cut. */
  begin() { this.lead = Date.now() / 1000 - this.t0; this.marks = {}; }
  /** A timed note for compose.mjs, as `Recorder.at` writes one: a zoom's target rect in screen px. */
  at(name, data) { this.marks[name] = { t: Date.now() / 1000 - this.t0 - this.lead, ...data }; }
  async stop() {
    const t1 = Date.now() / 1000;
    const done = new Promise((r) => this.proc.on("exit", r));
    this.proc.stdin.write("q");
    await done;
    const duration = t1 - this.t0 - this.lead;
    const r = spawnSync(FFMPEG, [
      "-y", "-hide_banner", "-loglevel", "error", "-ss", this.lead.toFixed(3), "-i", this.raw,
      "-vf", `fps=${FPS},format=yuv420p`, "-c:v", "libx264", "-preset", "medium", "-crf", "12", "-t", duration.toFixed(3), this.out,
    ], { stdio: "inherit" });
    if (r.status !== 0) throw new Error(`ffmpeg failed trimming ${this.raw}`);
    fs.rmSync(this.raw, { force: true });
    return { duration, marks: this.marks };
  }
}

/** Gives the Solenoid page the demo vault as its file system (the FsProvider seam) and hands its obsidian:// links to
 *  `onOpen`, as the OS would hand them to Obsidian. */
export async function bridgeVault(page, { onOpen } = {}) {
  await page.exposeFunction("__demoFs", vaultFs());
  await page.exposeFunction("__demoOpen", (url) => onOpen?.(url));
  await page.evaluate(async (vault) => {
    const F = await import("/src/graph/fileBridge.ts");
    const call = (op, ...args) => window.__demoFs(op, args);
    const b64 = (u8) => {
      let s = "";
      for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
      return btoa(s);
    };
    F.setFsProvider({
      readTextFile: (p) => call("readTextFile", p),
      readDir: (p) => call("readDir", p),
      writeTextFile: (p, c) => call("writeTextFile", p, c),
      rename: (a, b) => call("rename", a, b),
      mkdir: (p, r) => call("mkdir", p, r),
      exists: (p) => call("exists", p),
      stat: (p) => call("stat", p),
      join: (...parts) => call("join", ...parts),
      dirname: (p) => call("dirname", p),
      readBinary: async (p) => Uint8Array.from(atob(await call("readBinary", p)), (c) => c.charCodeAt(0)),
      writeBinary: (p, bytes) => call("writeBinary", p, b64(bytes)),
    });
    const S = await import("/src/graph/settingsStore.ts");
    S.settingsStore.set("obsidianVault", vault);
    const open = window.open.bind(window);
    window.open = (url, ...rest) => (String(url).startsWith("obsidian://") ? (void window.__demoOpen(String(url)), null) : open(url, ...rest));
  }, VAULT);
}

/** Solenoid's file access, bridged to Node's fs and fenced to the vault, for a browser build (the FsProvider seam). */
export function vaultFs() {
  const inside = (p) => {
    const r = path.resolve(p);
    if (r !== VAULT && !r.startsWith(VAULT + path.sep)) throw new Error(`outside the demo vault: ${p}`);
    return r;
  };
  return async (op, args) => {
    switch (op) {
      case "readTextFile": return fs.readFileSync(inside(args[0]), "utf8");
      case "readDir": return fs.readdirSync(inside(args[0]), { withFileTypes: true }).map((d) => ({ name: d.name, isDirectory: d.isDirectory(), isFile: d.isFile() }));
      case "writeTextFile": fs.writeFileSync(inside(args[0]), args[1]); return null;
      case "rename": fs.renameSync(inside(args[0]), inside(args[1])); return null;
      case "mkdir": fs.mkdirSync(inside(args[0]), { recursive: !!args[1] }); return null;
      case "exists": return fs.existsSync(inside(args[0]));
      case "stat": { const s = fs.statSync(inside(args[0])); return { mtimeMs: s.mtimeMs, birthtimeMs: s.birthtimeMs }; }
      case "join": return path.join(...args);
      case "dirname": return path.dirname(args[0]);
      case "readBinary": return fs.readFileSync(inside(args[0])).toString("base64");
      case "writeBinary": fs.writeFileSync(inside(args[0]), Buffer.from(args[1], "base64")); return null;
      default: throw new Error(`unknown fs op ${op}`);
    }
  };
}
