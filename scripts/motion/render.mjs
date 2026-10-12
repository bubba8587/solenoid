// [[C121]]
// Renders a motion clip with the three.js player in headless Chromium (software WebGL), frames piped straight
// into ffmpeg. The capture must be exported first (export.py → pieces.json).
//   node scripts/motion/render.mjs <capture dir> <clip> [--out file.mp4] [--samples 16] [--scale 100]
//        [--fps n] [--frames a-b] [--stills t1,t2,… --stills-out dir] [--check]
// Look at a draft first: --scale 50 --samples 2 (about 0.3 s a frame).
// <clip> is a module in scripts/motion/clips/ (order-total). --stills writes PNGs at those times (seconds)
// instead of a video. --check prints the rest check and renders the last frame flat (orthographic, no effects)
// beside the app's own shot of that state: <capture>/check.png (app | player | diff ×4).
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { browserPath } from "../browser.mjs";

const argv = process.argv.slice(2);
const pos = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const [capDir, clip] = pos;
if (!capDir || !clip) { console.error("usage: node scripts/motion/render.mjs <capture dir> <clip> [--out file.mp4] [--samples n] [--scale pct] [--frames a-b] [--stills t1,t2 --stills-out dir] [--check]"); process.exit(2); }
const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const scale = Number(opt("--scale", 100)) / 100;
const W = Math.round(1920 * scale), H = Math.round(1080 * scale);

// ---- a static server: the player, three, and the capture ----
const MIME = { ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".png": "image/png", ".html": "text/html" };
const mounts = [["/three/", join(ROOT, "node_modules", "three")], ["/motion/", HERE], ["/cap/", resolve(capDir)]];
const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  if (url === "/favicon.ico") { res.writeHead(204); res.end(); return; }
  if (url === "/") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000;overflow:hidden}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
<script type="module">
import { createPlayer } from "/motion/player.js";
import * as clip from "/motion/clips/${clip}.js";
const player = await createPlayer({ capUrl: "/cap", width: ${W}, height: ${H} });
const c = clip.setup(player);
window.motion = { player, clip, c, ready: true };
</script>`);
    return;
  }
  for (const [pre, dir] of mounts) {
    if (!url.startsWith(pre)) continue;
    const file = join(dir, url.slice(pre.length));
    if (!file.startsWith(dir) || !existsSync(file)) break;
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
    return;
  }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await puppeteer.launch({
  executablePath: browserPath(), headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", `--window-size=${W},${H}`, "--hide-scrollbars"],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log(`[${m.type()}] ${m.text()}`); });
await page.goto(base, { waitUntil: "load" });
await page.waitForFunction(() => window.motion?.ready, { timeout: 120_000 });
const clipTiming = await page.evaluate(() => ({ fps: window.motion.clip.fps, duration: window.motion.clip.duration }));
const duration = clipTiming.duration, fps = Number(opt("--fps", clipTiming.fps));
const last = Math.round(duration * fps);
const samples = Number(opt("--samples", 16));
const shoot = async (t) => {
  await page.evaluate((t, samples, fps) => { const m = window.motion; m.player.frame(m.c.pose, t, { samples, shutter: 0.5 / fps }); }, t, samples, fps);
  return page.screenshot({ type: "png", clip: { x: 0, y: 0, width: W, height: H }, optimizeForSpeed: true });
};

try {
  if (argv.includes("--check")) {
    const t = last / fps;
    const rest = await page.evaluate((t) => window.motion.c.restError(t), t);
    console.log(`rest check: worst piece ${rest.worst.toExponential(2)} from its rest place at the last frame (state ${rest.state})`);
    const result = await page.evaluate(async (t, state) => {
      const { player, c } = window.motion;
      const ref = player.data.reference;
      const shotFile = player.data.states.find((s) => s.name === state).reference;
      const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = `/cap/${shotFile}`; });
      const { w, h, rgba } = player.flat(c.pose, t, ref, ref.scale);
      const cv = document.createElement("canvas"); cv.width = w * 3; cv.height = h;
      const g = cv.getContext("2d");
      g.drawImage(img, 0, 0);
      const a = g.getImageData(0, 0, w, h).data;
      g.putImageData(new ImageData(rgba, w, h), w, 0);
      const d = new Uint8ClampedArray(rgba.length);
      let sum = 0, off = 0;
      for (let k = 0; k < rgba.length; k += 4) {
        let m = 0;
        for (let j = 0; j < 3; j++) { const e = Math.abs(a[k + j] - rgba[k + j]); sum += e; m = Math.max(m, e); d[k + j] = Math.min(255, e * 4); }
        d[k + 3] = 255; if (m > 16) off++;
      }
      g.putImageData(new ImageData(d, w, h), 2 * w, 0);
      return { url: cv.toDataURL("image/png"), mean: sum / (w * h * 3), off: off / (w * h) };
    }, t, rest.state);
    const file = join(resolve(capDir), "check.png");
    writeFileSync(file, Buffer.from(result.url.split(",")[1], "base64"));
    console.log(`last frame vs app (${rest.state}): mean ${result.mean.toFixed(2)}/255, off >16: ${(result.off * 100).toFixed(2)}% → ${file}`);
  } else if (argv.includes("--stills")) {
    const dir = resolve(opt("--stills-out", join(capDir, "stills")));
    mkdirSync(dir, { recursive: true });
    for (const t of opt("--stills").split(",").map(Number)) {
      const t0 = Date.now();
      writeFileSync(join(dir, `t${t.toFixed(2)}.png`), await shoot(t));
      console.log(`t=${t}s in ${Date.now() - t0} ms`);
    }
  } else {
    const [a, b] = (opt("--frames") ?? `0-${last}`).split("-").map(Number);
    const out = resolve(opt("--out", join(capDir, `${clip}.mp4`)));
    const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { stdio: ["pipe", "inherit", "inherit"] });
    const t0 = Date.now();
    for (let f = a; f <= b; f++) {
      const png = await shoot(f / fps);
      if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once("drain", r));
      if ((f - a) % 30 === 0) console.log(`frame ${f}/${b}  ${((Date.now() - t0) / (f - a + 1) / 1000).toFixed(2)} s/frame`);
    }
    ff.stdin.end();
    await new Promise((r) => ff.on("close", r));
    console.log(`→ ${out} (${b - a + 1} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
} finally {
  await browser.close();
  server.close();
}
