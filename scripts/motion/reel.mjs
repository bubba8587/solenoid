// [[C121]]
// Cuts rendered motion clips into one reel: each clip crossfades into the next, and the reel closes on the
// Solenoid wordmark (the demo video's own card, cards.mjs) fading in over the canvas color.
//   node scripts/motion/reel.mjs <out.mp4> <clip.mp4>… [--fade 0.5] [--end 2.6]
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { browserPath } from "../browser.mjs";
import { introMarkHtml } from "../demo-video/cards.mjs";

const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? Number(argv[argv.indexOf(k) + 1]) : d);
const files = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
const [out, ...clips] = files;
if (!out || !clips.length) { console.error("usage: node scripts/motion/reel.mjs <out.mp4> <clip.mp4>… [--fade s] [--end s]"); process.exit(2); }
const FADE = opt("--fade", 0.5), END = opt("--end", 2.6);
const probe = (f) => {
  const [w, h, rate, dur] = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate:format=duration", "-of", "csv=p=0:s=,", f], { encoding: "utf8" }).trim().split(/[\n,]/);
  const [n, d] = rate.split("/").map(Number);
  return { w: +w, h: +h, fps: n / d, dur: +dur };
};
const info = clips.map(probe);
const { w: W, h: H, fps: FPS } = info[0];

// the wordmark, transparent, at the reel's size
const dir = mkdtempSync(join(tmpdir(), "reel-"));
const mark = join(dir, "mark.png");
const browser = await puppeteer.launch({ executablePath: browserPath(), headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: W / 1280 });
await page.setContent(introMarkHtml(null));
await page.screenshot({ path: mark, omitBackground: true });
await browser.close();

// clips chained by xfade, then the end card: canvas color with the mark fading in
const inputs = clips.flatMap((f) => ["-i", f]);
inputs.push("-f", "lavfi", "-t", String(END + FADE), "-i", `color=c=0x0b0b0b:s=${W}x${H}:r=${FPS}`, "-loop", "1", "-t", String(END + FADE), "-i", mark);
const n = clips.length;
let graph = clips.map((_, i) => `[${i}:v]fps=${FPS},format=yuv420p,setsar=1[v${i}];`).join("");
graph += `[${n + 1}:v]format=rgba,fade=t=in:st=${FADE + 0.2}:d=0.8:alpha=1[m];[${n}:v][m]overlay=(W-w)/2:(H-h)/2,format=yuv420p,setsar=1[v${n}];`;
let prev = "v0", t = info[0].dur;
for (let i = 1; i <= n; i++) {
  const label = i === n ? "out" : `x${i}`;
  graph += `[${prev}][v${i}]xfade=transition=fade:duration=${FADE}:offset=${(t - FADE).toFixed(3)}[${label}];`;
  t += (i < n ? info[i].dur : END + FADE) - FADE;
  prev = label;
}
writeFileSync(join(dir, "graph.txt"), graph.replace(/;$/, ""));
execFileSync("ffmpeg", ["-y", "-v", "error", ...inputs, "-filter_complex_script", join(dir, "graph.txt"), "-map", "[out]", "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { stdio: "inherit" });
console.log(`→ ${out} (${t.toFixed(1)} s, ${n} clips)`);
