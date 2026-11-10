// [[B14]] oneDesignSystem, [[palette-and-theme#Each palette, drawn]]
// Draws one SVG per built-in palette into tree/specs/canvas/palettes/, from palette.ts itself: Default's slots and the
// palette's side by side, with each slot's move drawn in OKLab (hue and chroma, then lightness), its workbench ramp in both modes, and for an accent-adaptive palette the
// ramp under every accent with its tint band. Rerun after a palette rule changes:
//   node scripts/vite-run.mjs scripts/palette-diagrams.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  PALETTE_NAMES, PALETTE_RECIPES, COLOR_PALETTE, BUILTIN_PALETTES, BUILTIN_CHROME, DEFAULT_CHROME, CHROME_HOME,
  CHROME_TINT_BAND, CHROME_KEYS, adaptChrome, bandChroma, hexToOklch, themeAccent,
  type PaletteName, type ChromeKey, type TintBand,
} from "../src/graph/palette";
import { colormapRgb } from "../src/graph/colormaps";

const OUT = "tree/specs/canvas/palettes";
const W = 960, PAD = 24, SW = (W - 2 * PAD) / 12;
const INK = "#1d1f23", DIM = "#5d636b", RULE = "#d9dbe0";
type Mode = "dark" | "light";
const MODES: Mode[] = ["dark", "light"];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const text = (x: number, y: number, s: string, o: { size?: number; fill?: string; weight?: number; anchor?: string } = {}) =>
  `<text x="${x}" y="${y}" font-size="${o.size ?? 11}" fill="${o.fill ?? INK}" font-weight="${o.weight ?? 400}" text-anchor="${o.anchor ?? "start"}">${esc(s)}</text>`;
const rect = (x: number, y: number, w: number, h: number, fill: string, extra = "") =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`;

const CHROME_NOTE: Record<PaletteName, string> = {
  "Default": "Default's own neutral ramp, which every palette without one of its own wears.",
  "Muted": "Authored: a soft, barely warm charcoal, its light ramp a step lower in contrast.",
  "Colorblind-safe": "Authored: fully achromatic and a step crisper, so the Okabe-Ito hues carry the type signal.",
  "Solarized": "Solarized's base03 to base3 ladder in its canonical roles; the canvas deepened to a fixed step.",
  "Equinox": "Default's ramp with its blue cast removed, polarized 30% toward black and white.",
  "Orchard": "Earth-tone neutrals: a warm olive-brown dark, a cream light. Follows the accent's hue.",
  "Blueprint": "Prussian blue dark, whiteprint light. Follows the accent's hue.",
  "Neon": "Default's ramp polarized 50%: grounds toward the mode's pole, inks toward the other.",
  "Dawn and Dusk": "Default's lightness at each key; grounds take plasma's dusk (dark) or sunrise (light) hue, inks the other end.",
};

function chromeOf(name: PaletteName, mode: Mode): Record<ChromeKey, string> {
  const own = BUILTIN_CHROME[name][mode] as Record<ChromeKey, string>;
  return Object.keys(own).length ? own : DEFAULT_CHROME[mode];
}

/** A small card on its canvas, wearing the ramp and the accent: what the ramp looks like in use. */
function mock(x: number, y: number, w: number, h: number, r: Record<ChromeKey, string>, accent: string): string {
  const cw = w * 0.62, ch = h * 0.64, cx = x + (w - cw) / 2, cy = y + (h - ch) / 2, hb = ch * 0.24;
  return [
    rect(x, y, w, h, r.canvasBg, `rx="4"`),
    rect(cx, cy, cw, ch, r.surface, `rx="3" stroke="${r.border}"`),
    rect(cx, cy, cw, hb, accent, `rx="3" fill-opacity="0.45"`),
    rect(cx, cy, cw, 2, accent),
    rect(cx + 6, cy + hb + ch * 0.16, cw * 0.55, 3, r.text, `rx="1.5"`),
    rect(cx + 6, cy + hb + ch * 0.34, cw * 0.4, 3, r.textDim, `rx="1.5"`),
    rect(cx + 6, cy + hb + ch * 0.52, cw * 0.7, ch * 0.16, r.surfaceSunken, `rx="2" stroke="${r.borderStrong}" stroke-width="0.6"`),
  ].join("");
}

const ab = (hex: string): [number, number] => {
  const [, c, h] = hexToOklch(hex);
  return [c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)];
};
/** One arrow style per move, in order: the last move is ink, an earlier one a dashed gray. */
const MOVE_STYLE = [`stroke="${DIM}" stroke-dasharray="3 2"`, `stroke="${INK}"`];
const moveStyle = (i: number, n: number) => MOVE_STYLE[i === n - 1 ? 1 : 0];
const arrow = (x1: number, y1: number, x2: number, y2: number, style: string) => {
  if (Math.hypot(x2 - x1, y2 - y1) < 3) return "";
  const head = style.includes("dasharray") ? "headDim" : "head";
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${style} stroke-width="1.1" marker-end="url(#${head})"/>`;
};
/** Words wrapped onto lines of at most `max` characters. */
function wrap(s: string, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of s.split(" ")) {
    if (line && line.length + 1 + word.length > max) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  return line ? [...lines, line] : lines;
}
/** What each palette's moves lean toward, marked on the plane: a slot of its own, or plasma's dusk. */
function target(name: PaletteName): { hex: string; label: string } | null {
  if (name === "Orchard") return { hex: BUILTIN_PALETTES.Orchard.lime, label: "lime: what every color leans toward" };
  if (name === "Blueprint") return { hex: BUILTIN_PALETTES.Blueprint.blue, label: "blue: what every color leans toward" };
  if (name === "Dawn and Dusk") {
    const [r, g, b] = colormapRgb("plasma", 0.4)!;
    return { hex: `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`, label: "dusk: what every color is tinted toward" };
  }
  return null;
}

/** Default's slots above the palette's, a column per slot, under the sentence that says how one becomes the other. */
function swatches(name: PaletteName, y0: number): [string, number] {
  let y = y0, out = text(PAD, y, "FROM DEFAULT", { size: 10, weight: 700, fill: DIM });
  for (const line of wrap(PALETTE_RECIPES[name].says, 120)) { y += 17; out += text(PAD, y, line, { size: 12, weight: 600 }); }
  y += 12;
  const from = BUILTIN_PALETTES.Default, to = BUILTIN_PALETTES[name];
  const same = name === "Default";
  COLOR_PALETTE.forEach((slot, j) => {
    const x = PAD + j * SW;
    if (!same) {
      out += rect(x + 8, y, SW - 16, 18, from[slot], `rx="3"`);
      out += text(x + SW / 2, y + 30, "↓", { size: 11, fill: DIM, anchor: "middle" });
    }
    const ty = same ? y : y + 36;
    out += rect(x + 1, ty, SW - 2, 34, to[slot], `rx="3"`);
    out += text(x + SW / 2, ty + 46, slot, { size: 9, fill: DIM, anchor: "middle" });
    out += text(x + SW / 2, ty + 57, to[slot], { size: 8, fill: DIM, anchor: "middle" });
  });
  return [out, y + (same ? 64 : 100)];
}

/** Where each slot moves, one arrow per move: on the OKLab a/b plane (hue and how colorful), and in lightness. */
function moves(name: PaletteName, y0: number): [string, number] {
  const from = BUILTIN_PALETTES.Default;
  const steps = PALETTE_RECIPES[name].moves;
  const path = (slot: (typeof COLOR_PALETTE)[number]) => [from[slot], ...steps.map((m) => m.slots[slot])];
  let out = "", y = y0;
  if (steps.length) {
    out += text(PAD, y + 4, "Each ring is a Default color, each dot the palette's; the arrows are the moves between, in order:", { size: 10, fill: DIM });
    let lx = PAD;
    steps.forEach((m, i) => {
      const label = `${i + 1}. ${m.does}`;
      out += `<line x1="${lx}" y1="${y + 18}" x2="${lx + 26}" y2="${y + 18}" ${moveStyle(i, steps.length)} stroke-width="1.1" marker-end="url(#${i === steps.length - 1 ? "head" : "headDim"})"/>`;
      out += text(lx + 32, y + 21, label, { size: 10, weight: 600 });
      lx += 32 + label.length * 6 + 24;
    });
    y += 30;
  }
  const S = 420, cx = PAD + S / 2, cy = y + 18 + S / 2, R = S / 2 - 14, MAXC = 0.24;
  out += text(PAD, y + 10, "HUE AND COLORFULNESS: angle is hue, distance out is chroma", { size: 9, fill: DIM });
  out += rect(PAD, y + 18, S, S, "#ffffff", `stroke="${RULE}"`);
  for (let i = 0; i < 72; i++) {
    const a0 = (i * 5 * Math.PI) / 180, a1 = ((i + 1) * 5 * Math.PI) / 180;
    out += `<path d="M${cx + R * Math.cos(a0)},${cy - R * Math.sin(a0)} A${R},${R} 0 0 0 ${cx + R * Math.cos(a1)},${cy - R * Math.sin(a1)}" stroke="oklch(0.75 0.13 ${i * 5 + 2.5})" stroke-width="5" fill="none"/>`;
  }
  for (const c of [0.1, 0.2]) out += `<circle cx="${cx}" cy="${cy}" r="${(c / MAXC) * R}" fill="none" stroke="${RULE}" stroke-dasharray="3 3"/>`;
  out += `<circle cx="${cx}" cy="${cy}" r="1.5" fill="${DIM}"/>` + text(cx + 4, cy + 12, "gray", { size: 8, fill: DIM });
  const pt = (hex: string): [number, number] => { const [a, b] = ab(hex); return [cx + (a / MAXC) * R, cy - (b / MAXC) * R]; };
  const aim = target(name);
  if (aim) {
    const [x, y2] = pt(aim.hex);
    out += `<circle cx="${x}" cy="${y2}" r="10" fill="none" stroke="${INK}" stroke-width="1" stroke-dasharray="2 2"/>`;
    out += `<path d="M${x - 4},${y2} L${x + 4},${y2} M${x},${y2 - 4} L${x},${y2 + 4}" stroke="${INK}" stroke-width="1.2"/>`;
  }
  // Lightness, a column per slot.
  const lx = PAD + S + 24, lw = W - PAD - lx, top = y + 18, h = S;
  const ly = (L: number) => top + h - 10 - ((L - 0.3) / 0.7) * (h - 20);
  out += text(lx, y + 10, "LIGHTNESS: up is lighter", { size: 9, fill: DIM });
  out += rect(lx, top, lw, h, "#ffffff", `stroke="${RULE}"`);
  for (const L of [0.4, 0.6, 0.8, 1]) {
    out += `<line x1="${lx}" x2="${lx + lw}" y1="${ly(L)}" y2="${ly(L)}" stroke="${RULE}" stroke-dasharray="3 3"/>`;
    out += text(lx + 3, ly(L) - 2, L.toFixed(1), { size: 8, fill: DIM });
  }
  const cw = (lw - 24) / 12;
  COLOR_PALETTE.forEach((slot, j) => {
    const p = path(slot);
    const planar = p.map(pt);
    const x = lx + 24 + cw * j + cw / 2;
    const ys = p.map((hex) => ly(hexToOklch(hex)[0]));
    for (let i = 0; i < steps.length; i++) {
      out += arrow(planar[i][0], planar[i][1], planar[i + 1][0], planar[i + 1][1], moveStyle(i, steps.length));
      out += arrow(x, ys[i], x, ys[i + 1], moveStyle(i, steps.length));
    }
    for (let i = 1; i < p.length - 1; i++) {
      out += `<circle cx="${planar[i][0]}" cy="${planar[i][1]}" r="2.5" fill="${p[i]}" stroke="${DIM}" stroke-width="0.5"/>`;
      out += `<circle cx="${x}" cy="${ys[i]}" r="2.5" fill="${p[i]}" stroke="${DIM}" stroke-width="0.5"/>`;
    }
    const last = p.length - 1;
    if (steps.length) {
      out += `<circle cx="${planar[0][0]}" cy="${planar[0][1]}" r="4.5" fill="none" stroke="${p[0]}" stroke-width="2"/>`;
      out += `<circle cx="${x}" cy="${ys[0]}" r="4.5" fill="none" stroke="${p[0]}" stroke-width="2"/>`;
    }
    out += `<circle cx="${planar[last][0]}" cy="${planar[last][1]}" r="5" fill="${p[last]}" stroke="${INK}" stroke-width="0.6"/>`;
    out += `<circle cx="${x}" cy="${ys[last]}" r="5" fill="${p[last]}" stroke="${INK}" stroke-width="0.6"/>`;
    out += text(x, top + h + 12, slot, { size: 8, fill: DIM, anchor: "middle" });
  });
  let ny = top + h + 20;
  if (aim) { out += text(PAD, top + h + 14, `⊕ ${aim.label}`, { size: 9, fill: DIM }); }
  return [out, ny];
}

function ramps(name: PaletteName, y0: number): [string, number] {
  let y = y0 + 22, out = text(PAD, y0 + 12, "WORKBENCH RAMP", { size: 10, weight: 700, fill: DIM });
  out += text(PAD, y + 4, CHROME_NOTE[name], { size: 11, fill: DIM });
  y += 14;
  const home = CHROME_HOME[name];
  const accentSlot = home ?? "gold";
  const kw = (W - 2 * PAD - 150) / CHROME_KEYS.length;
  for (const mode of MODES) {
    const r = chromeOf(name, mode);
    out += text(PAD, y + 12, mode, { size: 10, weight: 600, fill: DIM });
    CHROME_KEYS.forEach((k, j) => {
      const x = PAD + 40 + j * kw;
      out += rect(x, y, kw - 2, 30, r[k], `rx="2" stroke="${RULE}" stroke-width="0.6"`);
      out += text(x + (kw - 2) / 2, y + 41, k.replace(/^(surface|border|text)/, (m) => m[0]).replace(/Bg$/, ""), { size: 7.5, fill: DIM, anchor: "middle" });
    });
    out += mock(W - PAD - 100, y - 6, 100, 56, r, themeAccent(BUILTIN_PALETTES[name][accentSlot], mode));
    y += 60;
  }
  return [out, y];
}

function bandPlot(band: TintBand | undefined, name: PaletteName, mode: Mode, x: number, y: number, w: number, h: number): string {
  let out = text(x, y - 4, band ? `tint band: center ${band.center}°, flat ${band.flat}°, fall ${band.fall}°, floor ${band.floor}` : "no tint band: full tint at every hue", { size: 9, fill: DIM });
  out += text(x + w, y - 4, "chroma kept (of authored), by the OK hue the ground lands on; dots are the accents", { size: 9, fill: DIM, anchor: "end" });
  out += rect(x, y, w, h, "#ffffff", `stroke="${RULE}"`);
  const home = CHROME_HOME[name]!;
  const ramp = BUILTIN_CHROME[name][mode] as Record<ChromeKey, string>;
  const rampHue = hexToOklch(ramp.surfaceRaised)[2];
  const homeHue = hexToOklch(BUILTIN_PALETTES[name][home])[2];
  const share = (hue: number) => (band ? bandChroma(band, hue) / bandChroma(band, rampHue) : 1);
  const px = (hue: number) => x + ((((hue % 360) + 360) % 360) / 360) * w;
  const py = (v: number) => y + h - 8 - (v * (h - 18));
  out += rect(x, y + h - 4, w, 4, "url(#hues)");
  for (const v of [1, 0.5]) {
    out += `<line x1="${x}" x2="${x + w}" y1="${py(v)}" y2="${py(v)}" stroke="${RULE}" stroke-dasharray="3 3"/>`;
    out += text(x + 3, py(v) - 2, `${v * 100}%`, { size: 8, fill: DIM });
  }
  let d = "";
  for (let i = 0; i <= 180; i++) {
    const hue = i * 2;
    d += `${i ? "L" : "M"}${px(hue).toFixed(1)},${py(share(hue)).toFixed(1)}`;
  }
  out += `<path d="${d}" fill="none" stroke="${INK}" stroke-width="1.2"/>`;
  for (const slot of COLOR_PALETTE) {
    const [, c, h] = hexToOklch(BUILTIN_PALETTES[name][slot]);
    if (c < 0.05) continue;
    const lands = rampHue + (h - homeHue);
    out += `<circle cx="${px(lands)}" cy="${py(share(lands))}" r="4" fill="${BUILTIN_PALETTES[name][slot]}" stroke="${INK}" stroke-width="0.6"/>`;
  }
  return out;
}

function adaptive(name: PaletteName, y0: number): [string, number] {
  if (!CHROME_HOME[name]) return ["", y0];
  let y = y0 + 22, out = text(PAD, y0 + 12, "FOLLOWING THE ACCENT", { size: 10, weight: 700, fill: DIM });
  out += text(PAD, y + 4, `The ramp turns by the accent's OK hue minus ${CHROME_HOME[name]}'s, holding each key's luminance; a tint band scales its chroma by where it lands.`, { size: 11, fill: DIM });
  y += 14;
  const home = BUILTIN_PALETTES[name][CHROME_HOME[name]!];
  for (const mode of MODES) {
    const band = CHROME_TINT_BAND[name]?.[mode];
    out += text(PAD, y + 12, mode, { size: 10, weight: 600, fill: DIM });
    COLOR_PALETTE.forEach((slot, j) => {
      const accent = BUILTIN_PALETTES[name][slot];
      const r = adaptChrome(BUILTIN_CHROME[name][mode], home, accent, band) as Record<ChromeKey, string>;
      out += mock(PAD + j * SW + 1, y + 16, SW - 2, 48, r, themeAccent(accent, mode));
      out += text(PAD + j * SW + SW / 2, y + 76, slot, { size: 9, fill: DIM, anchor: "middle" });
    });
    y += 96;
    out += bandPlot(band, name, mode, PAD, y, W - 2 * PAD, 80);
    y += 92;
  }
  return [out, y];
}

function plasma(name: PaletteName, y0: number): [string, number] {
  if (name !== "Dawn and Dusk") return ["", y0];
  let out = text(PAD, y0 + 12, "PLASMA, WHERE THE PALETTE SAMPLES IT", { size: 10, weight: 700, fill: DIM });
  const x = PAD, y = y0 + 22, w = W - 2 * PAD;
  out += rect(x, y, w, 22, "url(#plasma)");
  for (const [t, label] of [[0.4, "0.4 dusk: the dark ground and the slots' tint"], [0.8, "0.8 sunrise: the light ground"], [0.92, "0.92 dawn: the dark ink"]] as const) {
    out += rect(x + t * w - 1, y - 4, 2, 30, INK);
    out += text(x + t * w, y + 40 + (t === 0.92 ? 12 : 0), label, { size: 9, fill: DIM, anchor: t > 0.7 ? "end" : "middle" });
  }
  return [out, y + 60];
}

/** Every palette's diagram, by its path in the repository. */
export function paletteDiagrams(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of PALETTE_NAMES) {
    let body = text(PAD, 34, name, { size: 20, weight: 700 });
    let y = 50;
    for (const part of [swatches, moves, ramps, adaptive, plasma]) {
      const [svg, ny] = part(name, y + 8);
      body += svg;
      y = ny;
    }
    const stops = (n: number, color: (t: number) => string) =>
      Array.from({ length: n + 1 }, (_, i) => `<stop offset="${i / n}" stop-color="${color(i / n)}"/>`).join("");
    const defs = `<defs><marker id="head" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="${INK}"/></marker><marker id="headDim" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="${DIM}"/></marker><linearGradient id="hues">${stops(24, (t) => `oklch(0.75 0.12 ${t * 360})`)}</linearGradient>` +
      `<linearGradient id="plasma">${stops(32, (t) => { const [r, g, b] = colormapRgb("plasma", t)!; return `rgb(${r},${g},${b})`; })}</linearGradient></defs>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${y + PAD}" viewBox="0 0 ${W} ${y + PAD}" font-family="system-ui, -apple-system, Segoe UI, sans-serif">${defs}${rect(0, 0, W, y + PAD, "#f7f7f5")}${body}</svg>\n`;
    out[`${OUT}/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.svg`] = svg;
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  mkdirSync(OUT, { recursive: true });
  for (const [file, svg] of Object.entries(paletteDiagrams())) {
    writeFileSync(file, svg);
    console.log(file);
  }
}
