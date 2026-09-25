// Cuts the recorded clips into .dev/video/solenoid-demo.mp4 (and -silent.mp4): captions over each scene, title cards
// over blurred backdrops, crossfades between, and the synthesized soundtrack (music.mjs).
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import puppeteer from "puppeteer-core";
import { browserPath } from "../browser.mjs";
import { OUT, FFMPEG, FPS, VIEW } from "./rig.mjs";
import { SCENES } from "./scenes.mjs";
import { captionHtml, introMarkHtml, introLineHtml, outroHtml } from "./cards.mjs";
import { writeMusic } from "./music.mjs";

export const ORDER = [
  "build", "types", "units", "formula", "triangle", "tables", "charts",
  "obs-look", "obs-property", "sol-import", "sol-write", "obs-open",
];
const TAGLINE = "Your workbooks, now in node-graph form.";
const OUTRO = {
  lead: "Free and open source.",
  sub: "Runs in the browser, or as a desktop app on Windows and Linux.",
  url: "solenoid-ngc.vercel.app",
};
const XF = 0.5; // crossfade between segments, s
const INTRO_S = 4.6;
const OUTRO_S = 5.6;

const clips = path.join(OUT, "clips");
const cards = path.join(OUT, "cards");
const segs = path.join(OUT, "segments");
for (const d of [cards, segs]) fs.mkdirSync(d, { recursive: true });

function ff(args) {
  const r = spawnSync(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${args.join(" ").slice(0, 200)}`);
}
const clipDur = (name) => JSON.parse(fs.readFileSync(path.join(clips, `${name}.json`), "utf8")).duration;
const ENC = ["-r", String(FPS), "-c:v", "libx264", "-preset", "medium", "-crf", "12", "-pix_fmt", "yuv420p"];

const browser = await puppeteer.launch({
  executablePath: browserPath(),
  headless: true,
  args: ["--force-color-profile=srgb", "--font-render-hinting=none", ...(process.env.NO_SANDBOX ? ["--no-sandbox"] : [])],
  defaultViewport: { width: VIEW.width, height: VIEW.height, deviceScaleFactor: VIEW.scale },
});
const page = await browser.newPage();
async function png(html, file) {
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(cards, file), omitBackground: true });
}
for (const name of ORDER) await png(captionHtml(SCENES[name].caption), `cap-${name}.png`);
await png(introMarkHtml(), "intro-mark.png");
await png(introLineHtml(TAGLINE), "intro-line.png");
await png(outroHtml(OUTRO), "outro.png");
await browser.close();

const backdrop = "gblur=sigma=11,eq=brightness=-0.1:saturation=0.85,vignette=angle=0.35";
const parts = [];

{
  const out = path.join(segs, "00-intro.mp4");
  ff([
    "-i", path.join(clips, "intro.mp4"),
    "-loop", "1", "-i", path.join(cards, "intro-mark.png"),
    "-loop", "1", "-i", path.join(cards, "intro-line.png"),
    "-filter_complex",
    `[0:v]${backdrop},fade=t=in:st=0:d=0.7[bg];` +
      `[1:v]format=rgba,fade=t=in:st=0.45:d=0.9:alpha=1[m];` +
      `[2:v]format=rgba,fade=t=in:st=1.3:d=0.9:alpha=1[l];` +
      `[bg][m]overlay[a];[a][l]overlay,format=yuv420p`,
    "-t", String(INTRO_S), ...ENC, out,
  ]);
  parts.push({ file: out, dur: INTRO_S });
}

ORDER.forEach((name, i) => {
  const dur = clipDur(name);
  const out = path.join(segs, `${String(i + 1).padStart(2, "0")}-${name}.mp4`);
  const capIn = XF + 0.15, capOut = dur - XF - 0.55;
  ff([
    "-i", path.join(clips, `${name}.mp4`),
    "-loop", "1", "-i", path.join(cards, `cap-${name}.png`),
    "-filter_complex",
    `[1:v]format=rgba,fade=t=in:st=${capIn}:d=0.45:alpha=1,fade=t=out:st=${capOut}:d=0.45:alpha=1[c];` +
      `[0:v][c]overlay=shortest=1,format=yuv420p`,
    "-t", dur.toFixed(3), ...ENC, out,
  ]);
  parts.push({ file: out, dur });
});

{
  const out = path.join(segs, "99-outro.mp4");
  ff([
    "-i", path.join(clips, "outro.mp4"),
    "-loop", "1", "-i", path.join(cards, "outro.png"),
    "-filter_complex",
    `[0:v]${backdrop}[bg];[1:v]format=rgba,fade=t=in:st=${XF + 0.2}:d=0.9:alpha=1[t];` +
      `[bg][t]overlay,fade=t=out:st=${OUTRO_S - 0.9}:d=0.9,format=yuv420p`,
    "-t", String(OUTRO_S), ...ENC, out,
  ]);
  parts.push({ file: out, dur: OUTRO_S });
}

const inputs = parts.flatMap((p) => ["-i", p.file]);
let graph = parts.map((_, i) => `[${i}:v]settb=AVTB,setpts=PTS-STARTPTS,fps=${FPS}[v${i}]`).join(";");
let prev = "v0", offset = 0;
for (let i = 1; i < parts.length; i++) {
  offset += parts[i - 1].dur - XF;
  const next = i === parts.length - 1 ? "vout" : `x${i}`;
  graph += `;[${prev}][v${i}]xfade=transition=fade:duration=${XF}:offset=${offset.toFixed(3)}[${next}]`;
  prev = next;
}
const total = offset + parts[parts.length - 1].dur;
const silent = path.join(OUT, "solenoid-demo-silent.mp4");
ff([
  ...inputs, "-filter_complex", graph, "-map", "[vout]",
  "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p", "-movflags", "+faststart", silent,
]);
console.log(`silent cut: ${total.toFixed(1)} s → ${path.relative(process.cwd(), silent)}`);
fs.writeFileSync(path.join(OUT, "cut.json"), JSON.stringify({ total, parts: parts.map((p) => ({ file: path.basename(p.file), dur: p.dur })) }, null, 1));

const music = path.join(OUT, "music.wav");
writeMusic(total, music, { arpFrom: INTRO_S - XF });
{
  const final = path.join(OUT, "solenoid-demo.mp4");
  ff([
    "-i", silent, "-i", music,
    "-filter_complex", `[1:a]atrim=0:${total.toFixed(3)},loudnorm=I=-17:TP=-2:LRA=11,aresample=48000,afade=t=in:st=0:d=1.2,afade=t=out:st=${(total - 2.6).toFixed(3)}:d=2.6[a]`,
    "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", final,
  ]);
  console.log(`with music → ${path.relative(process.cwd(), final)}`);
}
