// Cuts the recorded clips into .dev/video/solenoid-demo.mp4 (and -silent.mp4): captions over each scene, title cards
// over blurred backdrops, crossfades between, and the synthesized soundtrack (music.mjs).
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import puppeteer from "puppeteer-core";
import { browserPath } from "../browser.mjs";
import { OUT, FFMPEG, FPS, VIEW } from "./rig.mjs";
import { SCENES } from "./scenes.mjs";
import { captionHtml, introMarkHtml, introLineHtml, outroHtml, panelLabelsHtml } from "./cards.mjs";
import { writeMusic } from "./music.mjs";

export const ORDER = [
  "build", "types", "units", "formula", "functions", "equation", "tables", "charts",
  "obs-look", "palettes", "obs-property", "import-pair", "sol-import", "sol-write", "obs-open",
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
fs.rmSync(segs, { recursive: true, force: true }); // a scene dropped from ORDER leaves no stale segment
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
for (const name of ORDER) if (SCENES[name].caption) await png(captionHtml(SCENES[name].caption), `cap-${name}.png`);
// Side-by-side panels for a stills scene: Solenoid left, Obsidian right, in 1920×1080 px.
const PANEL = { w: 936, h: 527, x: [16, 968], y: 236 };
const LABEL = { sol: "Solenoid", obs: "Obsidian" };
for (const order of [["sol", "obs"], ["obs", "sol"]]) {
  await png(panelLabelsHtml(order.map((k) => LABEL[k]), { x: PANEL.x.map((x) => x / VIEW.scale), y: (PANEL.y - 34) / VIEW.scale }), `panel-labels-${order.join("-")}.png`);
}
await png(introMarkHtml(), "intro-mark.png");
await png(introLineHtml(TAGLINE), "intro-line.png");
await png(outroHtml(OUTRO), "outro.png");
await browser.close();

// A stills scene (`states`) becomes a clip: each state's two shots side by side, crossfaded, under a slow push-in.
const STILL_XF = 0.7;
function stillsClip(name) {
  const scene = SCENES[name], dir = path.join(clips, name), n = scene.states.length, d = scene.hold + STILL_XF;
  const [left, right] = scene.panels ?? ["sol", "obs"];
  const frames = [];
  for (let i = 0; i < n; i++) {
    const k = String(i).padStart(2, "0"), out = path.join(dir, `${k}-pair.mp4`);
    ff([
      "-f", "lavfi", "-i", `color=c=0x0d0d0f:s=1920x1080:r=${FPS}:d=${d}`,
      "-loop", "1", "-i", path.join(dir, `${k}-${left}.png`), "-loop", "1", "-i", path.join(dir, `${k}-${right}.png`),
      "-loop", "1", "-i", path.join(cards, `panel-labels-${left}-${right}.png`),
      "-filter_complex",
      `[1:v]scale=${PANEL.w}:${PANEL.h},pad=iw+2:ih+2:1:1:color=0x3a3a3a[a];[2:v]scale=${PANEL.w}:${PANEL.h},pad=iw+2:ih+2:1:1:color=0x3a3a3a[b];` +
        `[0:v][a]overlay=${PANEL.x[0] - 1}:${PANEL.y - 1}[t];[t][b]overlay=${PANEL.x[1] - 1}:${PANEL.y - 1}[u];[u][3:v]overlay,format=yuv420p`,
      "-t", String(d), ...ENC, out,
    ]);
    frames.push(out);
  }
  let graph = frames.map((_, i) => `[${i}:v]settb=AVTB,setpts=PTS-STARTPTS,fps=${FPS}[s${i}]`).join(";"), prev = "s0";
  for (let i = 1; i < n; i++) {
    graph += `;[${prev}][s${i}]xfade=transition=fade:duration=${STILL_XF}:offset=${(i * scene.hold).toFixed(3)}[m${i}]`;
    prev = `m${i}`;
  }
  const total = n * scene.hold + STILL_XF;
  graph += `;[${prev}]scale=w='trunc(1920*(1+0.035*t/${total.toFixed(2)})/2)*2':h=-2:eval=frame,crop=1920:1080,format=yuv420p[out]`;
  ff([...frames.flatMap((f) => ["-i", f]), "-filter_complex", graph, "-map", "[out]", "-t", total.toFixed(3), ...ENC, path.join(clips, `${name}.mp4`)]);
  fs.writeFileSync(path.join(clips, `${name}.json`), JSON.stringify({ duration: total }));
}
for (const name of ORDER) if (SCENES[name].states) stillsClip(name);

const backdrop = "gblur=sigma=11,eq=brightness=-0.1:saturation=0.85,vignette=angle=0.35";
const parts = [];

{
  const out = path.join(segs, "00-intro.mp4");
  ff([
    "-i", path.join(clips, "intro.mp4"),
    "-loop", "1", "-i", path.join(cards, "intro-mark.png"),
    "-loop", "1", "-i", path.join(cards, "intro-line.png"),
    "-filter_complex",
    // The title card is whole from the first frame: players and link previews show frame zero before play.
    `[0:v]${backdrop}[bg];[bg][1:v]overlay[a];[a][2:v]overlay,format=yuv420p`,
    "-t", String(INTRO_S), ...ENC, out,
  ]);
  parts.push({ file: out, dur: INTRO_S });
}

// A scene's `zoom`/`unzoom` marks push the frame in on a rect and back out, eased over ZOOM_S each way.
const ZOOM_S = 0.7;
function zoomFilter(name) {
  const marks = JSON.parse(fs.readFileSync(path.join(clips, `${name}.json`), "utf8")).marks ?? {};
  if (!marks.zoom) return "";
  const { t: t0, x, y, w, h } = marks.zoom, t1 = marks.unzoom?.t ?? 1e9;
  const Z = Math.min(1920 / w, 1080 / h, 2.2), cx = (x + w / 2) * 2, cy = (y + h / 2) * 2;
  const u = `if(lt(it,${t0}),0,if(lt(it,${t0 + ZOOM_S}),(it-${t0})/${ZOOM_S},if(lt(it,${t1}),1,if(lt(it,${t1 + ZOOM_S}),1-(it-${t1})/${ZOOM_S},0))))`;
  // zoompan snaps its window to whole input pixels: doubling the frame first halves that step.
  return `scale=3840:2160:flags=lanczos,zoompan=z='1+${(Z - 1).toFixed(4)}*(0.5-0.5*cos(PI*${u}))':d=1:s=1920x1080:fps=${FPS}:` +
    `x='max(0,min(iw-iw/zoom,${cx}-iw/zoom/2))':y='max(0,min(ih-ih/zoom,${cy}-ih/zoom/2))',`;
}

ORDER.forEach((name, i) => {
  const dur = clipDur(name);
  const out = path.join(segs, `${String(i + 1).padStart(2, "0")}-${name}.mp4`);
  const capIn = XF + 0.15, capOut = dur - XF - 0.55;
  if (!SCENES[name].caption) {
    ff(["-i", path.join(clips, `${name}.mp4`), "-vf", `${zoomFilter(name)}setsar=1,format=yuv420p`, "-t", dur.toFixed(3), ...ENC, out]);
    parts.push({ file: out, dur });
    return;
  }
  ff([
    "-i", path.join(clips, `${name}.mp4`),
    "-loop", "1", "-i", path.join(cards, `cap-${name}.png`),
    "-filter_complex",
    `[0:v]${zoomFilter(name)}setsar=1[v];` +
      `[1:v]format=rgba,fade=t=in:st=${capIn}:d=0.45:alpha=1,fade=t=out:st=${capOut}:d=0.45:alpha=1[c];` +
      `[v][c]overlay=shortest=1,format=yuv420p`,
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
const cut = path.join(OUT, "cut.mp4");
ff([
  ...inputs, "-filter_complex", graph, "-map", "[vout]",
  "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p", cut,
]);
// The poster is frame zero, the title card; each mp4 also carries it as cover art for players that show one.
const poster = path.join(OUT, "solenoid-demo-poster.png");
ff(["-i", cut, "-frames:v", "1", poster]);
const withCover = (extra, out) => ff([
  "-i", cut, ...extra, "-i", poster,
  "-map", "0:v", ...(extra.length ? ["-map", "[a]"] : []), "-map", `${extra.length ? 2 : 1}:v`,
  "-c:v:0", "copy", "-c:v:1", "png", "-disposition:v:1", "attached_pic",
  ...(extra.length ? ["-c:a", "aac", "-b:a", "192k"] : []), "-movflags", "+faststart", out,
]);
withCover([], silent);
console.log(`silent cut: ${total.toFixed(1)} s → ${path.relative(process.cwd(), silent)}`);
fs.writeFileSync(path.join(OUT, "cut.json"), JSON.stringify({ total, parts: parts.map((p) => ({ file: path.basename(p.file), dur: p.dur })) }, null, 1));

const music = path.join(OUT, "music.wav");
writeMusic(total, music, { arpFrom: INTRO_S - XF });
{
  const final = path.join(OUT, "solenoid-demo.mp4");
  withCover([
    "-i", music,
    "-filter_complex", `[1:a]atrim=0:${total.toFixed(3)},loudnorm=I=-17:TP=-2:LRA=11,aresample=48000,afade=t=in:st=0:d=1.2,afade=t=out:st=${(total - 2.6).toFixed(3)}:d=2.6[a]`,
  ], final);
  fs.rmSync(cut);
  console.log(`with music → ${path.relative(process.cwd(), final)}`);
}
