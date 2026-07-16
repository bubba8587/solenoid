// Scene builders for the Pixi renderer — a SYNTHETIC stress scene (N grid cards,
// the perf ceiling) and a LIVE scene (the real rete graph, faithful cards + real
// cable routing). Both expose one SpikeScene shape so the camera/interaction code
// in the component is shared. `pixi` is the dynamically-imported module passed in
// (so nothing here forces a static bundle import); `typeof import` types are
// erased at build, so we keep full typing for free.

import type { Container, Graphics, Text, BitmapText } from "pixi.js";
import { NODE_KIND_ACCENTS, type NodeKind } from "../nodes/shared";
import { cardParts, cardsBounds, rectIntersects, wrapText, CARD } from "./pixiCardLayout";
import { CardPicker, type PickRect } from "./pixiPicker";
import { cablePolyline } from "./pixiCableGeom";
import { pointPolylineDistance } from "../cableHitTest";
import { mix, insetShade, pickTextColor } from "./pixiColors";
import type { CableShape } from "../cableShape";
import type { GraphSnapshot, SnapSocket, SnapText, SnapSlider, SnapCheckbox, SnapBox, SnapImage } from "./pixiGraphSnapshot";
import type { Bounds } from "./pixiCamera";

type PixiModule = typeof import("pixi.js");
export type TextMode = "bitmap" | "text";

/** MSDF font family names (the loaded atlas faces), or "Arial" → Pixi's dynamic
 *  bitmap-font fallback when the atlas didn't load. Sans for titles, mono for values. */
export interface Fonts { sans: string; mono: string; sansBold: string; monoBold: string }
export const FALLBACK_FONTS: Fonts = { sans: "Arial", mono: "Arial", sansBold: "Arial", monoBold: "Arial" };

export interface CardHandle {
  id: string;
  x: number; y: number; w: number; h: number;
  container: Container;
  sockets: SnapSocket[];
  selG?: Graphics;
  /** Detail objects (text + socket dots) hidden at low zoom by the LOD step. */
  detail: (Text | BitmapText | Graphics)[];
  /** The title label, so the floating editor can update it in place after a rename. */
  titleText?: Text | BitmapText;
}

export interface SpikeScene {
  world: Container;
  picker: CardPicker;
  cards: Map<string, CardHandle>;
  bounds: Bounds;
  nodeCount: number;
  cableCount: number;
  redrawCables(): void;
  moveCard(id: string, wx: number, wy: number): void;
  setSelected(ids: Set<string>): void;
  /** LOD: when `simple`, hide per-card text + socket dots (the heavy part) so
   *  zoomed-out frames draw only the body quads. Idempotent; cheap toggle. */
  setLod(simple: boolean): void;
  /** Frustum cull: hide cards whose world rect is outside `view`. Pass null to
   *  show all (cull off). Operates at the card level; composes with setLod. */
  cull(view: { minX: number; minY: number; maxX: number; maxY: number } | null): void;
  /** Toggle the cable layer — to isolate node vs cable cost when benchmarking. */
  setCablesVisible(v: boolean): void;
  /** Add a cable between two (live, mutable) sockets and redraw. No-op in the
   *  synthetic scene. Used by interactive socket-drag wiring. */
  addCable(src: SnapSocket, tgt: SnapSocket, id?: string): void;
  /** Remove cards (and any cables touching them) from the scene, rebuild the
   *  picker, redraw. The editor write is the caller's job. */
  removeCards(ids: Set<string>): void;
  /** Nearest cable id within `tol` world units of a point, or null. */
  pickCable(wx: number, wy: number, tol: number): string | null;
  /** Highlight a cable (null clears) and redraw. */
  selectCable(id: string | null): void;
  /** Drop a cable from the scene by id and redraw (editor write is the caller's). */
  removeCable(id: string): void;
  destroy(): void;
}

function rebuildPicker(picker: CardPicker, cards: Map<string, CardHandle>): void {
  let o = 0; const rects: PickRect[] = [];
  for (const h of cards.values()) rects.push({ id: h.id, x: h.x, y: h.y, w: h.w, h: h.h, order: o++ });
  picker.build(rects);
}

function makeCull(cards: Map<string, CardHandle>): (view: { minX: number; minY: number; maxX: number; maxY: number } | null) => void {
  return (view) => {
    if (!view) { for (const h of cards.values()) h.container.visible = true; return; }
    for (const h of cards.values()) h.container.visible = rectIntersects(h, view);
  };
}

/** World-scale below which a card's text is illegible anyway → drop it (LOD). */
export const LOD_SIMPLE_BELOW = 0.35;

function makeSetLod(cards: Map<string, CardHandle>): (simple: boolean) => void {
  let current: boolean | null = null;
  return (simple: boolean) => {
    if (simple === current) return;
    current = simple;
    for (const h of cards.values()) for (const d of h.detail) d.visible = !simple;
  };
}

const BODY = 0x1b1e25;
const CABLE_COLOR = 0x6f7d93;
const KINDS: NodeKind[] = ["input", "math", "logic", "list", "string", "date", "table", "frame", "display"];

// CSS font stacks matching the real cards — used by the canvas-Text fallback so
// non-ASCII glyphs (×, →, π, ≤, €…) render via the real Atkinson font + the same
// system fallback the DOM uses. The MSDF atlas is ASCII-only.
const CSS_SANS = '"Atkinson Hyperlegible Next Variable", "Atkinson Hyperlegible Next", system-ui, sans-serif';
const CSS_MONO = '"Atkinson Hyperlegible Mono Variable", "Atkinson Hyperlegible Mono", ui-monospace, monospace';
const NON_ASCII = /[^\x00-\x7E]/;

function makeLabel(pixi: PixiModule, text: string, size: number, fill: number, mode: TextMode, family: string, letterSpacing = 0, mono = false, bold = false): Text | BitmapText {
  if (mode === "text") {
    // A per-label texture — the slow path, here only so the two can be A/B'd.
    return new pixi.Text({ text, style: { fontFamily: "Arial", fontSize: size, fill, letterSpacing } });
  }
  if (NON_ASCII.test(text)) {
    // The MSDF atlas is ASCII-only — a glyph it lacks (×, →, π) would silently
    // drop. Render these few runs as canvas Text in the REAL font so they match
    // the DOM exactly (incl. its own system fallback). resolution 2 keeps it sharp.
    const t = new pixi.Text({ text, style: { fontFamily: mono ? CSS_MONO : CSS_SANS, fontSize: size, fill, fontWeight: bold ? "600" : "400", letterSpacing } });
    t.resolution = 2;
    return t;
  }
  // BitmapText with the MSDF atlas family → crisp at any zoom, one batched draw.
  // If `family` isn't a loaded atlas (e.g. "Arial"), Pixi auto-makes a dynamic
  // bitmap font instead — the graceful fallback, so text never disappears.
  return new pixi.BitmapText({ text, style: { fontFamily: family, fontSize: size, fill, letterSpacing } });
}

export interface ThemeColors { body: number; title: number; value: number }
const DARK_THEME: ThemeColors = { body: BODY, title: 0xf3f5f8, value: 0xcfd6e4 };

interface CardSpec {
  id: string; x: number; y: number; w: number; h: number; headerH: number;
  accent: number; body: number; headerColor: number; border: number; borderAlpha: number;
  texts: SnapText[];
  sliders: SnapSlider[];
  checkboxes: SnapCheckbox[];
  decorations: SnapBox[];
  images: SnapImage[];
  isConduit: boolean;
  hasChevron: boolean;
  rotation: number;
  sockets: SnapSocket[];
  withSelection: boolean;
}

function buildCardContainer(pixi: PixiModule, spec: CardSpec, textMode: TextMode, fonts: Fonts): CardHandle {
  const c = new pixi.Container();
  c.x = spec.x; c.y = spec.y;
  const parts = cardParts(spec.w, spec.h, spec.headerH);

  const detail: (Text | BitmapText | Graphics)[] = [];
  let titleText: Text | BitmapText | undefined;

  // Conduit: a rotated square body (node.angle) around the element centre; the
  // sockets stay at their scraped (already-rotated) world positions.
  if (spec.isConduit) {
    const sz = Math.min(spec.w, spec.h) * 0.62;
    const bodyG = new pixi.Graphics();
    // The conduit body is TRANSPARENT in the DOM (cables route through it; you see
    // the lane sockets + toolbar, not a filled card). Drawing it as a solid box made
    // it a black square occluding the cables. Draw only a faint frame — no fill — so
    // the cables show through and the sockets below read as the lanes.
    bodyG.roundRect(-sz / 2, -sz / 2, sz, sz, 4).stroke({ width: 1.5, color: spec.border, alpha: 0.5 });
    bodyG.x = spec.w / 2; bodyG.y = spec.h / 2; bodyG.rotation = spec.rotation;
    c.addChild(bodyG); detail.push(bodyG);
    for (const s of spec.sockets) {
      const dots = new pixi.Graphics();
      drawSocketGlyph(dots, s, s.x - spec.x, s.y - spec.y, CARD.socketRadius, spec.body);
      c.addChild(dots); detail.push(dots);
    }
    return { id: spec.id, x: spec.x, y: spec.y, w: spec.w, h: spec.h, container: c, sockets: spec.sockets, detail };
  }

  // Body = surface; header = the accent-TINTED surface (not a saturated bar);
  // the border carries the accent/group hue — matching the real card, which has
  // NO drop shadow and NO header divider (just the tint), so neither is drawn.
  const g = new pixi.Graphics();
  g.roundRect(0, 0, spec.w, spec.h, parts.radius).fill(spec.body);
  if (spec.headerH > 0) {
    g.roundRect(0, 0, parts.header.w, parts.header.h, 6).fill(spec.headerColor);
    // The kind accent shows as a 2px bar on the header's LEFT edge (DOM:
    // header border-left), clipped to the rounded top-left corner.
    g.rect(0, 2, 2, spec.headerH - 2).fill(spec.accent);
    // Collapse chevron — only on collapsible nodes (--no-chevron nodes omit it).
    if (spec.hasChevron) {
      const chCol = spec.texts.find((t) => t.isTitle)?.color ?? 0x9aa3b2;
      const chx = 9, chy = spec.headerH / 2;
      g.moveTo(chx - 3, chy - 1.5).lineTo(chx, chy + 1.5).lineTo(chx + 3, chy - 1.5).stroke({ width: 1.3, color: chCol, alpha: 0.55 });
    }
  }
  // Card border: real colour (grouped nodes adopt the group hue) at its real alpha,
  // inset by half the 2px width so the stroke sits inside the rounded rect.
  g.roundRect(1, 1, spec.w - 2, spec.h - 2, parts.radius).stroke({ width: 2, color: spec.border, alpha: spec.borderAlpha || 0.78 });
  c.addChild(g);

  // Field boxes behind editable inputs (so Number/Text/Slider read like the card).
  // Use the input's REAL fill/border (a neutral near-black box with a gray edge),
  // not the warm kind accent, which over-saturated the boxes.
  const fields = new pixi.Graphics();
  let hasField = false;
  for (const run of spec.texts) {
    if (!run.boxed || run.w <= 0 || run.h <= 0) continue;
    const bx = fields.roundRect(run.x - spec.x - 2, run.y - spec.y - 1, run.w + 4, run.h + 2, 3)
      .fill(run.boxFill ?? insetShade(spec.body));
    if (run.boxBorder != null) bx.stroke({ width: 1, color: run.boxBorder, alpha: 0.9 });
    else bx.stroke({ width: 1, color: spec.accent, alpha: 0.2 });
    if (run.chevron) { // dropdown caret at the box's right edge
      const cx = run.x - spec.x + run.w - 7, cy = run.y - spec.y + run.h / 2;
      fields.poly([cx - 3, cy - 1.5, cx + 3, cy - 1.5, cx, cy + 2]).fill({ color: run.color, alpha: 0.65 });
    }
    hasField = true;
  }
  // Slider controls — track + filled portion + thumb.
  for (const sl of spec.sliders) {
    const tx = sl.x - spec.x, ty = sl.y - spec.y + sl.h / 2;
    fields.roundRect(tx, ty - 2, sl.w, 4, 2).fill(insetShade(spec.body)).stroke({ width: 1, color: spec.accent, alpha: 0.3 });
    if (sl.frac > 0) fields.roundRect(tx, ty - 2, sl.w * sl.frac, 4, 2).fill({ color: spec.accent, alpha: 0.7 });
    fields.circle(tx + sl.w * sl.frac, ty, 5).fill(0xffffff).stroke({ width: 1.5, color: spec.accent, alpha: 0.9 });
    hasField = true;
  }
  // Checkboxes — box + (when checked) accent fill + checkmark.
  for (const cb of spec.checkboxes) {
    const x = cb.x - spec.x, y = cb.y - spec.y, sz = cb.size;
    fields.roundRect(x, y, sz, sz, 2).fill(insetShade(spec.body)).stroke({ width: 1, color: spec.accent, alpha: 0.45 });
    if (cb.checked) {
      fields.roundRect(x, y, sz, sz, 2).fill({ color: spec.accent, alpha: 0.85 });
      fields.moveTo(x + sz * 0.24, y + sz * 0.52).lineTo(x + sz * 0.43, y + sz * 0.72).lineTo(x + sz * 0.76, y + sz * 0.28).stroke({ width: 1.4, color: 0xffffff, alpha: 0.95 });
    }
    hasField = true;
  }
  if (hasField) { c.addChild(fields); detail.push(fields); }

  // Generic chrome boxes — buttons / pills / badges / dividers / quoted fields,
  // drawn from their real bg/border/radius + centered label.
  for (const d of spec.decorations) {
    const x = d.x - spec.x, y = d.y - spec.y;
    if (d.fill != null || d.border != null) {
      const dg = new pixi.Graphics();
      dg.roundRect(x, y, d.w, d.h, Math.min(d.radius, d.h / 2));
      if (d.fill != null) dg.fill(d.fill);
      if (d.border != null) dg.stroke({ width: Math.max(1, d.borderW), color: d.border, alpha: 0.85 });
      c.addChild(dg); detail.push(dg);
    }
    if (d.text) {
      const tl = makeLabel(pixi, clip(d.text, 12), Math.min(d.textSize, 13), d.textColor, textMode, fonts.sans);
      const tw = d.text.length * d.textSize * 0.55;
      tl.x = x + Math.max(2, (d.w - tw) / 2);
      tl.y = y + Math.max(0, (d.h - d.textSize) / 2 - 1);
      c.addChild(tl); detail.push(tl);
    }
  }

  // Chart visuals are NOT drawn here — rasterizing the SVG to a GPU texture at the
  // capture size then stretching to world size looked like a tiny blurry thumbnail.
  // They render as crisp live DOM in a camera-synced overlay (RendererSpike), the
  // hybrid the renderer decision calls for: GPU for the bulk, DOM for what needs it.

  // Every scraped text run at its real position. Tall runs (wrapped values, note
  // paragraphs) word-wrap across the lines their real height allows.
  for (const run of spec.texts) {
    const maxChars = run.w > 8 ? Math.max(4, Math.floor(run.w / (run.size * 0.52))) : 34;
    const fam = run.mono ? (run.bold ? fonts.monoBold : fonts.mono) : (run.bold ? fonts.sansBold : fonts.sans);
    const lineH = run.size * 1.3;
    const maxLines = run.h > run.size * 1.7 ? Math.max(1, Math.floor(run.h / lineH)) : 1;
    const lines = maxLines > 1 ? wrapText(run.text, maxChars).slice(0, maxLines) : [clip(run.text, maxChars)];
    const y0 = run.y - spec.y; // the run element's top edge
    // Horizontal alignment within the run's box — a Display value right-aligns
    // (anchored to the box's right edge, inside its padding); inputs/labels left.
    const pad = run.boxed ? 6 : 0;
    const ax = run.align === "right" ? 1 : run.align === "center" ? 0.5 : 0;
    const x = run.align === "right" ? run.x - spec.x + run.w - pad
      : run.align === "center" ? run.x - spec.x + run.w / 2
      : run.x - spec.x + pad;
    // A single-line run is vertically CENTRED on its element box — the DOM glyph
    // sits centred in its line box, and the MSDF metrics differ from the element
    // height, so top-anchoring drifts. Multi-line runs anchor at top and stack.
    const center = lines.length === 1 && run.h > run.size * 0.5;
    lines.forEach((line, i) => {
      const lbl = makeLabel(pixi, line, run.size, run.color, textMode, fam, run.letterSpacing, run.mono, run.bold);
      lbl.x = x;
      if (center) { lbl.anchor.set(ax, 0.5); lbl.y = y0 + run.h / 2; }
      else { lbl.anchor.set(ax, 0); lbl.y = y0 + i * lineH; }
      c.addChild(lbl); detail.push(lbl);
      if (run.isTitle && i === 0 && !titleText) titleText = lbl;
    });
  }

  // Socket glyphs (local coords = world socket − card origin), shaped + coloured
  // by type like the real sockets (circle scalar / square list / split combo /
  // grid 2-D / hexagon cube).
  if (spec.sockets.length) {
    const dots = new pixi.Graphics();
    for (const s of spec.sockets) drawSocketGlyph(dots, s, s.x - spec.x, s.y - spec.y, CARD.socketRadius, spec.body);
    c.addChild(dots); detail.push(dots);
  }

  let selG: Graphics | undefined;
  if (spec.withSelection) {
    selG = new pixi.Graphics();
    // The real selection ring is a lightened node accent, not a fixed blue.
    selG.roundRect(-2, -2, spec.w + 4, spec.h + 4, parts.radius + 2).stroke({ width: 2, color: mix(spec.accent, 0xffffff, 0.35), alpha: 0.95 });
    selG.visible = false;
    c.addChild(selG);
  }

  return { id: spec.id, x: spec.x, y: spec.y, w: spec.w, h: spec.h, container: c, sockets: spec.sockets, selG, detail, titleText };
}

// Use ASCII "..." (the MSDF atlas is ASCII-only; the … glyph would be missing).
function clip(s: string, n: number): string { return s.length > n ? s.slice(0, n - 2) + ".." : s; }

// Draw a socket's type glyph into a shared Graphics at (lx, ly), radius r, with a
// 2px inset ring in `ring` (the surface colour) — matching the real socket dots.
function drawSocketGlyph(g: Graphics, s: SnapSocket, lx: number, ly: number, r: number, ring: number): void {
  const ringStroke = { width: 1.5, color: ring, alpha: 1 };
  switch (s.kind) {
    case "square":
      g.roundRect(lx - r, ly - r, 2 * r, 2 * r, 2).fill(s.color);
      g.roundRect(lx - r + 1, ly - r + 1, 2 * r - 2, 2 * r - 2, 1.5).stroke(ringStroke);
      break;
    case "split": // bicolor split square (upper-left / lower-right triangles)
      g.poly([lx - r, ly + r, lx - r, ly - r, lx + r, ly - r]).fill(s.color);
      g.poly([lx - r, ly + r, lx + r, ly + r, lx + r, ly - r]).fill(s.color2 ?? s.color);
      g.roundRect(lx - r + 1, ly - r + 1, 2 * r - 2, 2 * r - 2, 1.5).stroke(ringStroke);
      break;
    case "grid": // 2-D matrix: square + a 2×2 cross
      g.roundRect(lx - r, ly - r, 2 * r, 2 * r, 2).fill(s.color);
      g.moveTo(lx, ly - r + 1.5).lineTo(lx, ly + r - 1.5).moveTo(lx - r + 1.5, ly).lineTo(lx + r - 1.5, ly)
        .stroke({ width: 1, color: ring, alpha: 0.8 });
      g.roundRect(lx - r + 1, ly - r + 1, 2 * r - 2, 2 * r - 2, 1.5).stroke(ringStroke);
      break;
    case "frame": // Frame: sheet with a header — solid band + one column divider
      g.roundRect(lx - r, ly - r, 2 * r, 2 * r, 2).fill(s.color);
      g.rect(lx - r + 2.5, ly - r + 2.5, 2 * r - 5, 2.1).fill({ color: ring, alpha: 0.8 });
      g.moveTo(lx, ly - r + 5.7).lineTo(lx, ly + r - 2.5).stroke({ width: 1, color: ring, alpha: 0.8 });
      g.roundRect(lx - r + 1, ly - r + 1, 2 * r - 2, 2 * r - 2, 1.5).stroke(ringStroke);
      break;
    case "ring": // trueany: hollow circle — border only, no fill
      g.circle(lx, ly, r - 1.25).stroke({ width: 2, color: s.color, alpha: 1 });
      break;
    case "hex": { // cube: hexagon
      const pts: number[] = [];
      for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i - Math.PI / 6; pts.push(lx + r * Math.cos(a), ly + r * Math.sin(a)); }
      g.poly(pts).fill(s.color);
      break;
    }
    default: // circle scalar
      g.circle(lx, ly, r).fill(s.color);
      g.circle(lx, ly, r - 1).stroke(ringStroke);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Synthetic stress scene
// ─────────────────────────────────────────────────────────────────────────────
export function buildSyntheticScene(pixi: PixiModule, count: number, textMode: TextMode, theme: ThemeColors = DARK_THEME, fonts: Fonts = FALLBACK_FONTS): SpikeScene {
  const world = new pixi.Container();
  const cableLayer = new pixi.Graphics();
  const cardLayer = new pixi.Container();
  world.addChild(cableLayer, cardLayer);

  const cols = Math.ceil(Math.sqrt(count));
  const GAP_X = 240, GAP_Y = 150;
  const W = CARD.defaultWidth, H = CARD.headerH + 44;
  const cards = new Map<string, CardHandle>();
  const picker = new CardPicker();
  const pickRects: PickRect[] = [];

  for (let i = 0; i < count; i++) {
    const x = (i % cols) * GAP_X, y = Math.floor(i / cols) * GAP_Y;
    const kind = KINDS[i % KINDS.length];
    const accent = hex(NODE_KIND_ACCENTS[kind]);
    // One output (right-mid) + one input (left-mid) socket.
    const sockets: SnapSocket[] = [
      { key: "in", side: "input", x: x, y: y + H / 2, kind: "circle", color: 0x9aa3b2, color2: null },
      { key: "out", side: "output", x: x + W, y: y + H / 2, kind: "circle", color: accent, color2: null },
    ];
    const texts: SnapText[] = [
      { text: `${kind} ${i}`, x: x + CARD.bodyPad, y: y + CARD.titleTop, w: 0, h: 0, size: 13, color: theme.title, mono: false, bold: true, isTitle: true, boxed: false, chevron: false, letterSpacing: 0, boxFill: null, boxBorder: null, align: "left" },
      { text: `= ${(i * 7.3).toFixed(2)}`, x: x + CARD.bodyPad, y: y + CARD.headerH + CARD.valueTopInBody, w: 0, h: 0, size: 14, color: theme.value, mono: true, bold: false, isTitle: false, boxed: false, chevron: false, letterSpacing: 0, boxFill: null, boxBorder: null, align: "left" },
    ];
    const handle = buildCardContainer(pixi, {
      id: `n${i}`, x, y, w: W, h: H, headerH: CARD.headerH,
      accent, body: theme.body, headerColor: mix(theme.body, accent, 0.18), border: accent, borderAlpha: 0.78, texts, sliders: [], checkboxes: [], decorations: [], images: [], isConduit: false, hasChevron: true, rotation: 0, sockets, withSelection: false,
    }, textMode, fonts);
    cardLayer.addChild(handle.container);
    cards.set(handle.id, handle);
    pickRects.push({ id: handle.id, x, y, w: W, h: H, order: i });
  }
  picker.build(pickRects);

  // Cheap inline-bezier cables (perf ceiling — NOT the real router) i→i+1, i→i+cols.
  const links: [string, string][] = [];
  for (let i = 0; i < count; i++) {
    if (i + 1 < count && (i + 1) % cols !== 0) links.push([`n${i}`, `n${i + 1}`]);
    if (i + cols < count) links.push([`n${i}`, `n${i + cols}`]);
  }
  const redrawCables = () => {
    cableLayer.clear();
    for (const [a, b] of links) {
      const ca = cards.get(a), cb = cards.get(b);
      if (!ca || !cb) continue;
      const sx = ca.x + ca.w, sy = ca.y + ca.h / 2;
      const ex = cb.x, ey = cb.y + cb.h / 2;
      const dx = Math.max(40, Math.abs(ex - sx) / 2);
      cableLayer.moveTo(sx, sy).bezierCurveTo(sx + dx, sy, ex - dx, ey, ex, ey);
    }
    cableLayer.stroke({ width: 2, color: CABLE_COLOR, alpha: 0.55 });
  };
  redrawCables();

  return {
    world, picker, cards, nodeCount: count, cableCount: links.length,
    bounds: cardsBounds([...cards.values()]),
    redrawCables,
    moveCard(id, wx, wy) {
      const h = cards.get(id); if (!h) return;
      h.x = wx; h.y = wy; h.container.position.set(wx, wy);
      picker.update({ id, x: wx, y: wy, w: h.w, h: h.h, order: 0 });
      redrawCables();
    },
    setSelected() { /* synthetic scene has no selection */ },
    setLod: makeSetLod(cards),
    cull: makeCull(cards),
    setCablesVisible(v) { cableLayer.visible = v; },
    addCable() { /* synthetic: no interactive wiring */ },
    removeCards(ids) {
      for (const id of ids) { const h = cards.get(id); if (h) { h.container.destroy(); cards.delete(id); } }
      rebuildPicker(picker, cards); redrawCables();
    },
    pickCable() { return null; },
    selectCable() { /* synthetic: no cable selection */ },
    removeCable() { /* synthetic: no cable selection */ },
    destroy() { world.destroy({ children: true }); },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Live scene — the real graph, faithful cards + real cable routing
// ─────────────────────────────────────────────────────────────────────────────
export function buildLiveScene(pixi: PixiModule, snap: GraphSnapshot, shape: CableShape, textMode: TextMode, fonts: Fonts = FALLBACK_FONTS): SpikeScene {
  const world = new pixi.Container();
  const standoffLayer = new pixi.Graphics();
  const groupLayer = new pixi.Container();
  const cableLayer = new pixi.Graphics();
  const cardLayer = new pixi.Container();
  world.addChild(standoffLayer, groupLayer, cableLayer, cardLayer);

  // Standoffs — pale thick bars + caps, at the very back (below groups), like the app.
  for (const so of snap.standoffs) {
    standoffLayer.moveTo(so.ax, so.ay).lineTo(so.bx, so.by)
      .stroke({ width: 9, color: 0x8a93a6, alpha: so.locked ? 0.5 : 0.32, cap: "round" });
    standoffLayer.circle(so.ax, so.ay, 4.5).fill({ color: 0x8a93a6, alpha: 0.6 });
    standoffLayer.circle(so.bx, so.by, 4.5).fill({ color: 0x8a93a6, alpha: 0.6 });
  }

  // Groups — translucent body + SOLID colour header bar + coloured border + label,
  // behind cables (matching the real group: 11px radius, ~34px header).
  for (const grp of snap.groups) {
    const g = new pixi.Graphics();
    g.roundRect(grp.x, grp.y, grp.w, grp.h, 11).fill({ color: grp.color, alpha: 0.1 }).stroke({ width: 2, color: grp.border, alpha: 0.7 });
    g.roundRect(grp.x, grp.y, grp.w, grp.headerH, 11).fill(grp.color);
    g.rect(grp.x, grp.y + grp.headerH - 6, grp.w, 6).fill(grp.color); // square off the header's rounded bottom
    groupLayer.addChild(g);
    // header chevron
    const gchy = grp.y + grp.headerH / 2;
    g.moveTo(grp.x + 10, gchy - 2).lineTo(grp.x + 13, gchy + 1.5).lineTo(grp.x + 16, gchy - 2).stroke({ width: 1.4, color: pickTextColor(grp.color), alpha: 0.6 });
    if (grp.label) {
      const lbl = makeLabel(pixi, clip(grp.label, 40), 14, pickTextColor(grp.color), textMode, fonts.sans);
      lbl.x = grp.x + 26; lbl.y = grp.y + (grp.headerH - 14) / 2; groupLayer.addChild(lbl);
    }
  }

  const cards = new Map<string, CardHandle>();
  const picker = new CardPicker();
  const pickRects: PickRect[] = [];
  // Index sockets by id so cables reference the SAME mutable socket objects the
  // cards hold — moving a card mutates its sockets, and a redraw reflects it.
  const socketIndex = new Map<string, SnapSocket>();

  snap.nodes.forEach((n, i) => {
    for (const s of n.sockets) socketIndex.set(`${n.id}::${s.side}::${s.key}`, s);
    const handle = buildCardContainer(pixi, {
      id: n.id, x: n.x, y: n.y, w: n.w, h: n.h, headerH: n.headerH,
      accent: n.accent, body: n.body, headerColor: n.headerColor, border: n.border, borderAlpha: n.borderAlpha, texts: n.texts, sliders: n.sliders, checkboxes: n.checkboxes, decorations: n.decorations, images: n.images, isConduit: n.isConduit, hasChevron: n.hasChevron, rotation: n.rotation, sockets: n.sockets, withSelection: true,
    }, textMode, fonts);
    if (n.selected && handle.selG) handle.selG.visible = true;
    cardLayer.addChild(handle.container);
    cards.set(n.id, handle);
    pickRects.push({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h, order: i });
  });
  picker.build(pickRects);

  // Cables reference the SAME mutable socket objects the cards hold, by exact
  // node+side+key identity — so moving a card mutates its sockets and a redraw
  // follows. (Falls back to the snapshot's absolute ends if a socket is missing.)
  interface CableEnd { id: string; src: SnapSocket; tgt: SnapSocket; sourceAngleDeg: number | null; targetAngleDeg: number | null }
  const cableEnds: CableEnd[] = snap.cables.map((c) => ({
    id: c.id,
    src: socketIndex.get(`${c.source}::output::${c.sourceOutput}`) ?? { key: c.sourceOutput, side: "output" as const, x: c.sx, y: c.sy, kind: "circle" as const, color: 0x6f7d93, color2: null },
    tgt: socketIndex.get(`${c.target}::input::${c.targetInput}`) ?? { key: c.targetInput, side: "input" as const, x: c.ex, y: c.ey, kind: "circle" as const, color: 0x6f7d93, color2: null },
    sourceAngleDeg: c.sourceAngleDeg, targetAngleDeg: c.targetAngleDeg,
  }));
  let selectedCable: string | null = null;
  let newCableSeq = 0;
  const cablePts = (c: CableEnd) => cablePolyline(shape, {
    sx: c.src.x, sy: c.src.y, ex: c.tgt.x, ey: c.tgt.y,
    sourceAngleDeg: c.sourceAngleDeg, targetAngleDeg: c.targetAngleDeg,
  });

  const redrawCables = () => {
    cableLayer.clear();
    // Per-cable stroke so each takes its SOURCE socket's type colour, like the app.
    for (const c of cableEnds) {
      const pts = cablePts(c);
      if (pts.length < 2) continue;
      cableLayer.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) cableLayer.lineTo(pts[i].x, pts[i].y);
      const sel = c.id === selectedCable;
      cableLayer.stroke({ width: sel ? 3.5 : 2, color: sel ? 0x4d8dff : (c.src.color ?? CABLE_COLOR), alpha: sel ? 1 : 0.75 });
    }
  };
  redrawCables();

  return {
    world, picker, cards, nodeCount: snap.nodes.length, cableCount: cableEnds.length,
    bounds: cardsBounds([...cards.values()]),
    redrawCables,
    moveCard(id, wx, wy) {
      const h = cards.get(id); if (!h) return;
      const dx = wx - h.x, dy = wy - h.y;
      h.x = wx; h.y = wy; h.container.position.set(wx, wy);
      for (const s of h.sockets) { s.x += dx; s.y += dy; } // sockets ride the card
      picker.update({ id, x: wx, y: wy, w: h.w, h: h.h, order: 0 });
      redrawCables();
    },
    setSelected(ids) {
      for (const [id, h] of cards) if (h.selG) h.selG.visible = ids.has(id);
    },
    setLod: makeSetLod(cards),
    cull: makeCull(cards),
    setCablesVisible(v) { cableLayer.visible = v; },
    addCable(src, tgt, id) { cableEnds.push({ id: id ?? `new:${newCableSeq++}`, src, tgt, sourceAngleDeg: null, targetAngleDeg: null }); redrawCables(); },
    removeCards(ids) {
      const dead = new Set<SnapSocket>();
      for (const id of ids) { const h = cards.get(id); if (!h) continue; for (const s of h.sockets) dead.add(s); h.container.destroy(); cards.delete(id); }
      for (let i = cableEnds.length - 1; i >= 0; i--) if (dead.has(cableEnds[i].src) || dead.has(cableEnds[i].tgt)) cableEnds.splice(i, 1);
      rebuildPicker(picker, cards); redrawCables();
    },
    pickCable(wx, wy, tol) {
      let best: string | null = null, bestD = tol;
      for (const c of cableEnds) {
        const pts = cablePts(c);
        if (pts.length < 2) continue;
        const d = pointPolylineDistance({ x: wx, y: wy }, pts);
        if (d < bestD) { bestD = d; best = c.id; }
      }
      return best;
    },
    selectCable(id) { selectedCable = id; redrawCables(); },
    removeCable(id) {
      const i = cableEnds.findIndex((c) => c.id === id);
      if (i >= 0) cableEnds.splice(i, 1);
      if (selectedCable === id) selectedCable = null;
      redrawCables();
    },
    destroy() { world.destroy({ children: true }); },
  };
}

function hex(h: string): number {
  const n = parseInt(h.replace("#", ""), 16);
  return Number.isFinite(n) ? n : 0x7a8296;
}
