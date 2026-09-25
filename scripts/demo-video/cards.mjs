// The demo video's overlays as HTML in the app's own type and palette (DESIGN.md): scene captions and
// the title-card text. Each renders to a transparent 1920×1080 PNG that compose.mjs lays over a clip.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./rig.mjs";

const font = (pkg, file) =>
  fs.readFileSync(path.join(ROOT, "node_modules", "@fontsource-variable", pkg, "files", file)).toString("base64");
const wordmark = fs.readFileSync(path.join(ROOT, "src", "logo", "solenoidwordmark.svg")).toString("base64");

const HEAD = `<meta charset="utf-8"><style>
@font-face { font-family: "AHN"; font-weight: 200 800; src: url(data:font/woff2;base64,${font("atkinson-hyperlegible-next", "atkinson-hyperlegible-next-latin-wght-normal.woff2")}) format("woff2"); }
@font-face { font-family: "AHM"; font-weight: 200 800; src: url(data:font/woff2;base64,${font("atkinson-hyperlegible-mono", "atkinson-hyperlegible-mono-latin-wght-normal.woff2")}) format("woff2"); }
html, body { margin: 0; width: 1280px; height: 720px; background: transparent; overflow: hidden; }
body { font-family: "AHN", system-ui, sans-serif; color: #f3f4f5; -webkit-font-smoothing: antialiased; }
.mark { background: #f5b914; -webkit-mask: url(data:image/svg+xml;base64,${wordmark}) center / contain no-repeat; mask: url(data:image/svg+xml;base64,${wordmark}) center / contain no-repeat; margin: 0 auto; }
.center { position: absolute; left: 0; right: 0; text-align: center; }
</style>`;

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

// The app's floating-chrome recipe with a heavier border and lift, so a caption never reads as a card on the canvas.
export const captionHtml = ([title, body]) => `${HEAD}<style>
.cap { position: absolute; left: 24px; bottom: 30px; max-width: 540px; padding: 12px 18px 14px; background: #1e1e1e;
  border: 2px solid #6b6e72; border-radius: 10px; box-shadow: 0 6px 22px rgba(0,0,0,.55), 0 1px 4px rgba(0,0,0,.4); }
.cap__title { font-weight: 600; font-size: 11.5px; line-height: 1.3; letter-spacing: .08em; text-transform: uppercase; color: #f5b914; margin-bottom: 5px; }
.cap__body { font-size: 17px; line-height: 1.35; text-wrap-style: balance; }
</style><div class="cap"><div class="cap__title">${esc(title)}</div><div class="cap__body">${esc(body)}</div></div>`;

export const introMarkHtml = (eyebrow) => `${HEAD}${eyebrow ? `<div class="center" style="top:208px;font-weight:600;font-size:15px;letter-spacing:.14em;text-transform:uppercase;color:#b8bdc3">${esc(eyebrow)}</div>` : ""}<div class="center" style="top:250px"><div class="mark" style="width:560px;height:104px"></div></div>`;
export const introLineHtml = (line) => `${HEAD}<div class="center" style="top:388px;font-size:27px;font-weight:500">${esc(line)}</div>`;

export const outroHtml = ({ lead, sub, url }) => `${HEAD}
<div class="center" style="top:178px"><div class="mark" style="width:380px;height:70px"></div></div>
<div class="center" style="top:292px;font-size:30px;font-weight:600">${esc(lead)}</div>
<div class="center" style="top:342px;font-size:19px;color:#b8bdc3">${esc(sub)}</div>
<div class="center" style="top:410px;font-family:AHM,monospace;font-size:21px;color:#f5b914;letter-spacing:.02em">${esc(url)}</div>`;

// Labels over the side-by-side panels of a stills scene; `at` is each label's left edge and the top, in CSS px.
export const panelLabelsHtml = (labels, at) => `${HEAD}<style>
.lab { position: absolute; font-weight: 600; font-size: 12px; letter-spacing: .1em; text-transform: uppercase; color: #b8bdc3; }
</style>${labels.map((l, i) => `<div class="lab" style="left:${at.x[i]}px;top:${at.y}px">${esc(l)}</div>`).join("")}`;

// The fast-forward badge over a sped-up span of a scene: two chevrons and the rate, in the caption's chrome.
export const fastBadgeHtml = (rate) => `${HEAD}<style>
.ff { position: absolute; left: 24px; top: 70px; display: flex; align-items: center; gap: 7px; padding: 6px 12px 6px 10px;
  background: #1e1e1e; border: 2px solid #6b6e72; border-radius: 999px; box-shadow: 0 4px 14px rgba(0,0,0,.45);
  font-weight: 600; font-size: 15px; color: #f5b914; letter-spacing: .02em; }
</style><div class="ff"><svg width="18" height="12" viewBox="0 0 18 12"><path d="M1 1l7 5-7 5zM9 1l7 5-7 5z" fill="#f5b914"/></svg>${rate}×</div>`;
