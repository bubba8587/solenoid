// The demo recorder's browser rig: launch, screencast capture, and a hand that moves, clicks, drags and types.
// How it works and why: .claude/skills/demo-video/SKILL.md.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { browserPath } from "../browser.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(here, "..", "..");
export const OUT = path.join(ROOT, ".dev", "video");
export const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
export const FPS = 30;
export const VIEW = { width: 1280, height: 720, scale: 1.5 }; // 1920×1080 frames
const KIT = fs.readFileSync(path.join(here, "kit.js"), "utf8");

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch(url) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "solenoid-demo-"));
  const browser = await puppeteer.launch({
    executablePath: browserPath(),
    headless: true,
    userDataDir: profile,
    args: [
      `--window-size=${VIEW.width},${VIEW.height}`,
      `--force-device-scale-factor=${VIEW.scale}`,
      "--force-color-profile=srgb",
      "--hide-scrollbars",
      "--mute-audio",
      "--font-render-hinting=none",
      ...(process.env.NO_SANDBOX ? ["--no-sandbox"] : []),
    ],
    defaultViewport: { width: VIEW.width, height: VIEW.height, deviceScaleFactor: VIEW.scale },
  });
  const page = (await browser.pages())[0] ?? (await browser.newPage());
  page.on("pageerror", (e) => console.log("  pageerror:", e.message.slice(0, 160)));
  // Spline cables with flow beads, as in the README shots; no minimap, so the captions have the bottom strip.
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem("solenoid.cableShape", "spline");
    localStorage.setItem("solenoid.cableFlow", "1");
    localStorage.setItem("solenoid.settings", JSON.stringify({ minimapPosition: "hide" }));
  });
  await page.goto(url, { waitUntil: "networkidle2", timeout: 180000 });
  await page.waitForSelector(".react-flow__renderer", { timeout: 60000 });
  await sleep(2500);
  await injectKit(page);
  return { browser, page, profile };
}

export async function injectKit(page) {
  await injectCursor(page);
  await page.evaluate(() => window.__demo.mods());
}

/** The painted pointer, click ring and keycaps alone, for a page that isn't Solenoid (an Obsidian window). */
export const injectCursor = (page) => page.evaluate(KIT);

export const demo = (page, fn, ...args) => page.evaluate(fn, ...args);

export class Recorder {
  constructor(page) { this.page = page; }
  async start(dir) {
    this.dir = dir;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    this.frames = [];
    this.marks = {};
    this.cdp = await this.page.createCDPSession();
    this.cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
      const file = `f${String(this.frames.length).padStart(5, "0")}.jpg`;
      fs.writeFileSync(path.join(dir, file), Buffer.from(data, "base64"));
      this.frames.push({ file, t: metadata.timestamp });
      this.cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    });
    this.t0 = Date.now() / 1000;
    await this.cdp.send("Page.startScreencast", {
      format: "jpeg", quality: 92, maxWidth: VIEW.width * VIEW.scale, maxHeight: VIEW.height * VIEW.scale, everyNthFrame: 1,
    });
  }
  mark(name) { this.marks[name] = Date.now() / 1000 - this.t0; }
  /** A timed note for compose.mjs, such as a zoom's target rect in frame px. */
  at(name, data) { this.marks[name] = { t: Date.now() / 1000 - this.t0, ...data }; }
  async stop() {
    const t1 = Date.now() / 1000;
    await this.cdp.send("Page.stopScreencast");
    await sleep(250);
    await this.cdp.detach();
    const meta = { t0: this.t0, duration: t1 - this.t0, marks: this.marks, frames: this.frames };
    fs.writeFileSync(path.join(this.dir, "frames.json"), JSON.stringify(meta, null, 1));
    return meta;
  }
}

/** Each frame holds until the next one's compositor timestamp, then the clip is resampled to FPS. */
export function encodeClip(dir, out) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "frames.json"), "utf8"));
  const fr = meta.frames.filter((f) => f.t >= meta.t0 - 1);
  if (!fr.length) throw new Error(`no frames in ${dir}`);
  const lines = ["ffconcat version 1.0"];
  for (let i = 0; i < fr.length; i++) {
    const start = i === 0 ? meta.t0 : fr[i].t;
    const next = i + 1 < fr.length ? fr[i + 1].t : meta.t0 + meta.duration;
    lines.push(`file '${fr[i].file}'`, `duration ${Math.max(0.001, next - start).toFixed(6)}`);
  }
  lines.push(`file '${fr[fr.length - 1].file}'`);
  fs.writeFileSync(path.join(dir, "list.ffconcat"), lines.join("\n"));
  const r = spawnSync(FFMPEG, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "concat", "-safe", "0", "-i", path.join(dir, "list.ffconcat"),
    "-vf", `fps=${FPS},format=yuv420p`, "-c:v", "libx264", "-preset", "medium", "-crf", "12",
    "-t", meta.duration.toFixed(3), out,
  ], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`ffmpeg failed for ${dir}`);
  return meta;
}

// Minimum-jerk timing along a gently bowed path, the way a person moves a pointer to a target.
const minJerk = (t) => t * t * t * (10 - 15 * t + 6 * t * t);
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

export class Hand {
  constructor(page) {
    this.page = page;
    this.x = VIEW.width * 0.62;
    this.y = VIEW.height * 0.62;
  }
  async show(x = this.x, y = this.y) {
    this.x = x; this.y = y;
    await this.page.mouse.move(x, y);
    await demo(this.page, () => window.__demo.cursor(true));
  }
  async hide() { await demo(this.page, () => window.__demo.cursor(false)); }
  async move(x, y, { ms, bow = 1 } = {}) {
    const x0 = this.x, y0 = this.y;
    const d = Math.hypot(x - x0, y - y0);
    if (d < 0.5) return;
    ms ??= Math.round(Math.min(950, Math.max(300, 230 + d * 0.7)));
    const nx = -(y - y0) / d, ny = (x - x0) / d;
    const bend = Math.min(48, d * 0.1) * (rand() < 0.5 ? -1 : 1) * bow;
    const c1 = [x0 + (x - x0) * 0.3 + nx * bend, y0 + (y - y0) * 0.3 + ny * bend];
    const c2 = [x0 + (x - x0) * 0.72 + nx * bend * 0.5, y0 + (y - y0) * 0.72 + ny * bend * 0.5];
    const steps = Math.max(2, Math.round(ms / 16));
    const t0 = Date.now();
    for (let i = 1; i <= steps; i++) {
      const s = minJerk(i / steps), u = 1 - s;
      const px = u * u * u * x0 + 3 * u * u * s * c1[0] + 3 * u * s * s * c2[0] + s * s * s * x;
      const py = u * u * u * y0 + 3 * u * u * s * c1[1] + 3 * u * s * s * c2[1] + s * s * s * y;
      await this.page.mouse.move(px, py);
      const wait = t0 + (ms * i) / steps - Date.now();
      if (wait > 0) await sleep(wait);
    }
    this.x = x; this.y = y;
  }
  async moveTo(pt, opts) { await this.move(pt.cx ?? pt.x, pt.cy ?? pt.y, opts); }
  async click(pt, { pause = 90 } = {}) {
    if (pt) await this.moveTo(pt);
    await sleep(pause);
    await this.page.mouse.down();
    await sleep(75);
    await this.page.mouse.up();
  }
  async drag(from, to, { ms, hover = 220 } = {}) {
    await this.moveTo(from);
    await sleep(120);
    await this.page.mouse.down();
    await sleep(90);
    await this.moveTo(to, { ms: ms ?? undefined, bow: 0.6 });
    await sleep(hover);
    await this.page.mouse.up();
  }
  async type(text, { cps = 11 } = {}) {
    for (const ch of text) {
      await this.page.keyboard.type(ch);
      await sleep((1000 / cps) * (0.6 + rand() * 0.8));
    }
  }
  async press(key, cap) {
    if (cap) await demo(this.page, (c) => window.__demo.showKeys(c), Array.isArray(cap) ? cap : [cap]);
    await this.page.keyboard.press(key);
  }
  async chord(mod, key, cap) {
    if (cap) await demo(this.page, (c) => window.__demo.showKeys(c), cap);
    await this.page.keyboard.down(mod);
    await this.page.keyboard.press(key);
    await this.page.keyboard.up(mod);
  }
}
