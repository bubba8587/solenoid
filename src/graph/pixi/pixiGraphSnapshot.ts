// Snapshot the LIVE rete graph into a plain, Pixi-friendly model — node cards
// (world rect + kind colour + scraped title/value + socket world positions) and
// cables (socket-to-socket ends + angle hints). Reads the editor/area singletons
// and the mounted DOM (geometry + text), like nodeScene.ts. Impure and defensive:
// every read is guarded so a half-built graph yields a partial snapshot, never a
// throw (the Pixi overlay must never crash the app beneath it).

import { getArea, getEditor } from "../process";
import { nodeKindOf } from "../nodes/kind";
import { NODE_KIND_ACCENTS } from "../nodes/shared";
import { parseColor, mixSrgb, type RGBA } from "../cssColor";
import { cableAngleStore } from "../cableAngleStore";
import { pickTextColor } from "./pixiColors";
import { SOCKET_COLORS } from "../sockets";
import { socketGlyphKind, COMBO_PAIRS, type GlyphKind } from "./pixiSocketGlyph";
import { standoffStore, anchorPoint, type Box } from "../standoffs";

export interface SnapSocket {
  key: string; side: "input" | "output"; x: number; y: number;
  kind: GlyphKind; color: number; color2: number | null; // type glyph + colour(s)
}
/** A positioned text run scraped from the real card (world coords, top-left).
 *  `boxed` runs are editable inputs → drawn with a field box; w/h are the run's
 *  element size (world units), used to size that box. */
export interface SnapText {
  text: string; x: number; y: number; w: number; h: number;
  size: number; color: number; mono: boolean; bold: boolean; isTitle: boolean; boxed: boolean; chevron: boolean;
  letterSpacing: number; // px (titles track at ~0.8px); 0 when "normal"
  boxFill: number | null;   // for boxed runs: the input's real fill (neutral, not accent)
  boxBorder: number | null; // and its real border colour
  align: "left" | "right" | "center"; // text-align within the box (display values right-align)
}
/** A slider control (track + thumb); `frac` is the value position 0..1. */
export interface SnapSlider { x: number; y: number; w: number; h: number; frac: number }
export interface SnapCheckbox { x: number; y: number; size: number; checked: boolean }
/** A chart/visual captured as serialized SVG, drawn as a GPU texture. */
export interface SnapImage { x: number; y: number; w: number; h: number; svg: string }
/** A generic "render this DOM box" decoration — buttons, pills, badges, swatches,
 *  dividers, quoted fields: a rounded rect (real bg/border/radius) + optional text. */
export interface SnapBox {
  x: number; y: number; w: number; h: number; radius: number;
  fill: number | null; border: number | null; borderW: number;
  text: string; textColor: number; textSize: number;
}
export interface SnapNode {
  id: string;
  x: number; y: number; w: number; h: number; headerH: number;
  accent: number; // 0xRRGGBB — the node-kind accent (header tint / field strokes)
  body: number;   // 0xRRGGBB
  headerColor: number; // the real (accent-TINTED, not saturated) header background
  border: number;      // the real card border colour (grouped nodes adopt the group hue)
  borderAlpha: number; // and its alpha (DOM uses ~0.78, not a hard outline)
  texts: SnapText[]; // every text run the real card shows, at its real position
  sliders: SnapSlider[];
  checkboxes: SnapCheckbox[];
  decorations: SnapBox[];
  images: SnapImage[];
  isConduit: boolean;
  hasChevron: boolean; // header shows a collapse chevron (false for --no-chevron nodes)
  rotation: number; // radians (conduit body rotation; 0 otherwise)
  selected: boolean;
  sockets: SnapSocket[];
}
export interface SnapCable {
  id: string;
  source: string; sourceOutput: string;
  target: string; targetInput: string;
  sx: number; sy: number; ex: number; ey: number;
  sourceAngleDeg: number | null;
  targetAngleDeg: number | null;
  color: number; // source socket's data-type colour (0xRRGGBB) — matches the DOM cable hue
}
export interface SnapGroup {
  id: string; x: number; y: number; w: number; h: number; headerH: number;
  label: string; color: number; border: number;
}
export interface SnapStandoff { ax: number; ay: number; bx: number; by: number; locked: boolean }
export interface GraphSnapshot {
  nodes: SnapNode[];
  groups: SnapGroup[];
  cables: SnapCable[];
  standoffs: SnapStandoff[];
  transform: { k: number; x: number; y: number };
}

const FALLBACK_BODY = 0x1b1e25;

function hexToNum(hex: string): number {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return Number.isFinite(n) ? n : 0x7a8296;
}
function rgbaToNum(css: string | null | undefined): number | null {
  if (!css) return null;
  const c = parseColor(css);
  return c ? ((c.r & 255) << 16) | ((c.g & 255) << 8) | (c.b & 255) : null;
}
/** Alpha-composite a (possibly translucent) foreground over an opaque base and
 *  return a packed 0xRRGGBB. Pixi fills are opaque, so any alpha must be baked in. */
function flatten(fg: RGBA, base: RGBA): number {
  const f = fg.a >= 0.999 ? fg : mixSrgb(base, fg, fg.a);
  return ((Math.round(f.r) & 255) << 16) | ((Math.round(f.g) & 255) << 8) | (Math.round(f.b) & 255);
}
const _sockColorCache = new Map<string, number>();
function cssToNum(raw: string | null | undefined): number | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  return s.startsWith("#") ? hexToNum(s) : rgbaToNum(s);
}
/** Socket colour by dataType — SOCKET_COLORS gives a `var(--sock-x)` expr; resolve
 *  it off the document root once and cache. Falls back to neutral gray. */
function resolveSockColor(dataType: string | undefined): number {
  if (!dataType) return 0x7a8296;
  const expr = (SOCKET_COLORS as Record<string, string>)[dataType];
  if (!expr) return 0x7a8296;
  const m = /var\((--[^),]+)\)/.exec(expr);
  if (!m) return cssToNum(expr) ?? 0x7a8296;
  const name = m[1];
  const cached = _sockColorCache.get(name);
  if (cached !== undefined) return cached;
  let n = 0x7a8296;
  try { n = cssToNum(getComputedStyle(document.documentElement).getPropertyValue(name)) ?? 0x7a8296; } catch { /* default */ }
  _sockColorCache.set(name, n);
  return n;
}

// Curated set of text-bearing elements in a card; `input` reads .value, `select`
// reads the chosen option (and gets a dropdown chevron).
const TEXT_SELECTORS: { sel: string; title?: boolean; input?: boolean; select?: boolean }[] = [
  { sel: ".solenoid-node__label-display", title: true },
  { sel: ".solenoid-node__io-label" },
  { sel: ".solenoid-node__display-value" },
  { sel: ".solenoid-node__output-value" },
  { sel: ".solenoid-node__inline-input", input: true },
  { sel: ".solenoid-node__value-input", input: true },
  { sel: ".solenoid-node__op-select", select: true },
];
// Markdown block tags for Notes (their text uses plain tags, not node classes).
const NOTE_SELECTORS: { sel: string; title?: boolean; input?: boolean; select?: boolean }[] = [
  { sel: "h1", title: true }, { sel: "h2", title: true }, { sel: "h3" },
  { sel: "p" }, { sel: "li" }, { sel: "blockquote" }, { sel: "code" },
];

/** Scrape every meaningful text run in a card with its world position, font size,
 *  colour, and mono-ness — so the Pixi card reproduces the real text layout
 *  (multi-output rows, inputs, labels), not a single hardcoded title+value. */
function scrapeTextRuns(card: HTMLElement, elRect: DOMRect, viewX: number, viewY: number, k: number, selectors = TEXT_SELECTORS): SnapText[] {
  const runs: SnapText[] = [];
  const pushRun = (te: HTMLElement, raw: string, title?: boolean, input?: boolean, select?: boolean) => {
    let text = raw.trim();
    if (!text) return;
    const r = te.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return; // hidden
    const cs = getComputedStyle(te);
    const tt = cs.textTransform;
    if (tt === "uppercase") text = text.toUpperCase();
    else if (tt === "lowercase") text = text.toLowerCase();
    else if (tt === "capitalize") text = text.replace(/\b\w/g, (c) => c.toUpperCase());
    const ls = parseFloat(cs.letterSpacing); // "normal" → NaN
    // A run is "boxed" if it's an input/select OR its element paints a real box
    // (a Display value is a bordered surface, not a bare run). Capture the real
    // neutral fill/border — never the warm kind accent.
    const boxBw = parseFloat(cs.borderTopWidth) || 0;
    const bgC = parseColor(cs.backgroundColor);
    const hasBox = (bgC != null && bgC.a > 0.04) || boxBw > 0;
    const boxed = !!input || !!select || hasBox;
    const ta = cs.textAlign;
    const align: "left" | "right" | "center" = ta === "right" || ta === "end" ? "right" : ta === "center" ? "center" : "left";
    runs.push({
      text,
      x: viewX + (r.left - elRect.left) / k, y: viewY + (r.top - elRect.top) / k,
      w: r.width / k, h: r.height / k,
      size: parseFloat(cs.fontSize) || 13,
      color: rgbaToNum(cs.color) ?? 0x9aa3b2,
      mono: /mono/i.test(cs.fontFamily),
      bold: (parseFloat(cs.fontWeight) || 400) >= 600,
      isTitle: !!title, boxed, chevron: !!select,
      letterSpacing: (Number.isFinite(ls) ? ls : 0) / k,
      boxFill: boxed && bgC && bgC.a > 0.04 ? rgbaToNum(cs.backgroundColor) : null,
      boxBorder: boxed && boxBw > 0 ? rgbaToNum(cs.borderTopColor) : null,
      align,
    });
  };
  for (const { sel, title, input, select } of selectors) {
    for (const te of card.querySelectorAll<HTMLElement>(sel)) {
      // A table/frame value display concatenates into one run if read whole — emit
      // each cell at its own position instead (matches the DOM grid layout).
      if (!input && !select) {
        const table = te.querySelector("table");
        if (table) {
          for (const cell of table.querySelectorAll<HTMLElement>("td, th")) pushRun(cell, cell.textContent ?? "");
          continue;
        }
      }
      const raw = select ? ((te as HTMLSelectElement).selectedOptions?.[0]?.text ?? (te as HTMLSelectElement).value)
        : input ? (te as HTMLInputElement).value : (te.textContent ?? "");
      pushRun(te, raw, title, input, select);
    }
  }
  return runs;
}

/** Slider controls (range inputs) → track + thumb position. */
function scrapeSliders(card: HTMLElement, elRect: DOMRect, viewX: number, viewY: number, k: number): SnapSlider[] {
  const out: SnapSlider[] = [];
  for (const el of card.querySelectorAll<HTMLInputElement>(".solenoid-slider__range, input[type=range]")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const min = parseFloat(el.min || "0"), max = parseFloat(el.max || "100"), val = parseFloat(el.value || "0");
    const frac = max > min ? Math.min(1, Math.max(0, (val - min) / (max - min))) : 0.5;
    out.push({ x: viewX + (r.left - elRect.left) / k, y: viewY + (r.top - elRect.top) / k, w: r.width / k, h: r.height / k, frac });
  }
  return out;
}

// Small chrome elements rendered generically as a box (+ text). Disjoint from the
// TEXT_SELECTORS so nothing double-renders.
const DECO_SELECTORS = [
  ".solenoid-node__add-input", ".solenoid-node__add-row", ".solenoid-node__row-remove",
  ".solenoid-node__recalc-btn", ".solenoid-node__input-pill", ".solenoid-node__output-pill",
  ".solenoid-node__corner-badge", ".solenoid-node__corner-lock", ".solenoid-node__quoted",
  ".solenoid-node__section-divider", ".solenoid-swatchgrid__opt", ".solenoid-note__swatch",
  // Segmented toggles + Format-Controller chrome (Cast / FC nodes).
  ".solenoid-seg button", ".solenoid-fc__segbtn", ".solenoid-fc__toggle",
  ".solenoid-fc__arrow", ".solenoid-fc__digits", ".solenoid-fc__pattern",
  // Catch any remaining buttons generically (dedup'd against the above).
  "button",
];
function toNumA(css: string): { num: number; a: number } | null {
  const c = parseColor(css);
  return c ? { num: ((c.r & 255) << 16) | ((c.g & 255) << 8) | (c.b & 255), a: c.a ?? 1 } : null;
}
function readBox(el: HTMLElement, elRect: DOMRect, viewX: number, viewY: number, k: number): SnapBox | null {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 1) return null;
  const cs = getComputedStyle(el);
  if (cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity || "1") < 0.05) return null;
  const bg = toNumA(cs.backgroundColor);
  const bw = parseFloat(cs.borderTopWidth) || 0;
  const bd = bw > 0 ? toNumA(cs.borderTopColor) : null;
  const tx = toNumA(cs.color);
  return {
    x: viewX + (r.left - elRect.left) / k, y: viewY + (r.top - elRect.top) / k,
    w: r.width / k, h: r.height / k, radius: (parseFloat(cs.borderTopLeftRadius) || 0) / k,
    fill: bg && bg.a > 0.04 ? bg.num : null,
    border: bd && bd.a > 0.04 ? bd.num : null, borderW: bw,
    text: (el.textContent ?? "").trim().slice(0, 12),
    textColor: tx ? tx.num : 0x9aa3b2, textSize: parseFloat(cs.fontSize) || 11,
  };
}
function scrapeDecorations(card: HTMLElement, elRect: DOMRect, viewX: number, viewY: number, k: number): SnapBox[] {
  const out: SnapBox[] = [];
  const seen = new Set<Element>();
  for (const sel of DECO_SELECTORS) {
    for (const el of card.querySelectorAll<HTMLElement>(sel)) {
      if (seen.has(el)) continue;
      seen.add(el);
      const b = readBox(el, elRect, viewX, viewY, k);
      if (b) out.push(b);
    }
  }
  // Generic colour cells: the Heatmap (and inline swatch grids) paint a grid of
  // class-less <div>s with an inline `background` colour — no selector catches
  // them. Grab small leaf elements that set a background inline, skipping chart
  // and control containers (they own their own render path).
  for (const el of card.querySelectorAll<HTMLElement>('[style*="background"]')) {
    if (seen.has(el)) continue;
    if (el.querySelector("svg, canvas, input, select, .recharts-surface")) continue;
    const inline = el.style.background || el.style.backgroundColor;
    if (!inline) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.width > 80 || r.height > 80) continue;
    seen.add(el);
    const b = readBox(el, elRect, viewX, viewY, k);
    if (b && b.fill != null) out.push(b);
  }
  return out;
}

/** Chart visuals (recharts SVG) → serialized SVG string + rect, drawn as a texture. */
function scrapeImages(card: HTMLElement, elRect: DOMRect, viewX: number, viewY: number, k: number): SnapImage[] {
  const out: SnapImage[] = [];
  for (const svg of card.querySelectorAll<SVGElement>(".recharts-surface")) {
    const r = svg.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    try {
      const clone = svg.cloneNode(true) as SVGElement;
      // Render at WORLD size with a viewBox so the DOM overlay scales it crisply at
      // any zoom (it sits in a container scaled by the camera). Preserve the chart's
      // own viewBox if it has one (recharts gauges use a 160-unit space, not px).
      if (!clone.getAttribute("viewBox")) clone.setAttribute("viewBox", `0 0 ${Math.round(r.width)} ${Math.round(r.height)}`);
      clone.setAttribute("width", String(r.width / k));
      clone.setAttribute("height", String(r.height / k));
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      out.push({
        x: viewX + (r.left - elRect.left) / k, y: viewY + (r.top - elRect.top) / k,
        w: r.width / k, h: r.height / k, svg: new XMLSerializer().serializeToString(clone),
      });
    } catch { /* skip an unserializable chart */ }
  }
  return out;
}

/** Checkbox controls → box + checked state. */
function scrapeCheckboxes(card: HTMLElement, elRect: DOMRect, viewX: number, viewY: number, k: number): SnapCheckbox[] {
  const out: SnapCheckbox[] = [];
  for (const el of card.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    out.push({ x: viewX + (r.left - elRect.left) / k, y: viewY + (r.top - elRect.top) / k, size: Math.min(r.width, r.height) / k, checked: el.checked });
  }
  return out;
}

/** Theme-faithful card colours sampled from a real mounted node (the DOM is still
 *  behind the overlay), so the synthetic scene + canvas background match the live
 *  theme instead of being hardcoded dark. Falls back to a dark default. */
export function readThemeColors(): { body: number; title: number; value: number } {
  try {
    const card = document.querySelector<HTMLElement>(".solenoid-node");
    if (card) {
      const body = rgbaToNum(getComputedStyle(card).backgroundColor) ?? FALLBACK_BODY;
      const t = card.querySelector<HTMLElement>(".solenoid-node__label-display");
      const v = card.querySelector<HTMLElement>(".solenoid-node__display-value");
      const title = (t && rgbaToNum(getComputedStyle(t).color)) ?? pickTextColor(body);
      const value = (v && rgbaToNum(getComputedStyle(v).color)) ?? pickTextColor(body);
      return { body, title, value };
    }
  } catch { /* fall through to default */ }
  return { body: FALLBACK_BODY, title: 0xf3f5f8, value: 0xcfd6e4 };
}

/** Read the current graph + transform, or null if the editor/area aren't ready. */
export function snapshotGraph(): GraphSnapshot | null {
  const area = getArea();
  const editor = getEditor();
  if (!area || !editor) return null;
  const t = area.area?.transform ?? { k: 1, x: 0, y: 0 };
  const k = t.k > 0 ? t.k : 1;

  _sockColorCache.clear(); // re-resolve CSS vars (theme may have changed since last open)
  // The canvas background a card composites over — translucent fills (a Note's
  // 30%-alpha tint) must be flattened onto it or they render far too saturated.
  const canvasEl = document.querySelector(".solenoid-canvas") ?? document.body;
  const canvasRGBA = parseColor(getComputedStyle(canvasEl).backgroundColor) ?? { r: 14, g: 16, b: 20, a: 1 };
  const nodes: SnapNode[] = [];
  const groups: SnapGroup[] = [];
  // nodeId → side → socketKey → world point, for cable lookup.
  const lookup = new Map<string, { input: Map<string, SnapSocket>; output: Map<string, SnapSocket> }>();
  let bodyColor: number | null = null;

  for (const node of editor.getNodes()) {
    try {
      const view = area.nodeViews.get(node.id);
      const el = view?.element;
      if (!view || !el) continue;

      // Group containers render as translucent background rects behind cards.
      const groupEl = el.querySelector<HTMLElement>(".solenoid-group")
        ?? (el.classList.contains("solenoid-group") ? el : null);
      if (groupEl) {
        const gw = groupEl.offsetWidth, gh = groupEl.offsetHeight;
        if (gw > 0 && gh > 0) {
          const gHeader = groupEl.querySelector<HTMLElement>(".solenoid-group__header");
          const headerH = gHeader && gHeader.offsetHeight > 0 ? gHeader.offsetHeight : 34;
          const color = (gHeader ? rgbaToNum(getComputedStyle(gHeader).backgroundColor) : null) ?? 0x8a93a6;
          const border = (gHeader ? rgbaToNum(getComputedStyle(gHeader).borderTopColor) : null) ?? color;
          // The group label CSS uppercases the title — apply it so the GPU label matches.
          let label = (node as { label?: string }).label || "";
          const gLabelEl = groupEl.querySelector<HTMLElement>(".solenoid-group__label");
          const gtt = gLabelEl ? getComputedStyle(gLabelEl).textTransform : "none";
          if (gtt === "uppercase") label = label.toUpperCase();
          else if (gtt === "lowercase") label = label.toLowerCase();
          else if (gtt === "capitalize") label = label.replace(/\b\w/g, (c) => c.toUpperCase());
          groups.push({ id: node.id, x: view.position.x, y: view.position.y, w: gw, h: gh, headerH, label, color, border });
        }
        continue;
      }

      // Any node-like root: a regular node, a Note, or a Conduit (skip nothing).
      const ROOT_SEL = ".solenoid-node, .solenoid-note, .solenoid-conduit";
      const card = el.querySelector<HTMLElement>(ROOT_SEL)
        ?? (el.matches(ROOT_SEL) ? el : null);
      if (!card) continue;
      // A collapsed group hides its members via visibility:hidden (they keep layout
      // but don't paint). The DOM shows nothing, so neither should the GPU scene —
      // and skipping here drops their cables too (the lookup entry is never built).
      if (getComputedStyle(card).visibility === "hidden") continue;

      const w = card.offsetWidth, h = card.offsetHeight;
      if (w <= 0 || h <= 0) continue;
      // Flatten the (possibly translucent) fill onto the canvas — a Note tints at
      // 30% alpha; dropping the alpha and filling opaque looks far too saturated.
      const ownRGBA = parseColor(getComputedStyle(card).backgroundColor);
      const ownBg = ownRGBA ? flatten(ownRGBA, canvasRGBA) : FALLBACK_BODY;
      if (bodyColor == null && card.classList.contains("solenoid-node")) bodyColor = ownBg;
      // Notes/conduits have no node header; only nodes get the tinted header band.
      const headerEl = card.querySelector<HTMLElement>(".solenoid-node__header");
      const headerH = headerEl && headerEl.offsetHeight > 0 ? headerEl.offsetHeight : 0;
      const headerRGBA = headerEl ? parseColor(getComputedStyle(headerEl).backgroundColor) : null;
      // The header composites over the card body, not the canvas.
      const headerColor = headerRGBA ? flatten(headerRGBA, ownRGBA ?? canvasRGBA) : ownBg;

      const accent = hexToNum(NODE_KIND_ACCENTS[nodeKindOf(node)] ?? "#7a8296");

      // Real card border — grouped nodes adopt the group hue at ~0.78 alpha, so it
      // is NOT the kind accent. Capture colour AND alpha (a hard outline reads heavy).
      const cardCs = getComputedStyle(card);
      const bc = parseColor(cardCs.borderTopColor || cardCs.borderColor || "");
      const borderW = parseFloat(cardCs.borderTopWidth || "1") || 1;
      const border = bc ? ((bc.r & 255) << 16) | ((bc.g & 255) << 8) | (bc.b & 255) : accent;
      const borderAlpha = bc && borderW > 0 ? bc.a : 0;

      // Socket world positions, scraped from the dots and un-scaled into world space.
      const elRect = el.getBoundingClientRect();
      const isNode = card.classList.contains("solenoid-node");
      const texts = scrapeTextRuns(card, elRect, view.position.x, view.position.y, k, isNode ? TEXT_SELECTORS : NOTE_SELECTORS);
      if (isNode && headerH > 0) {
        // Fall back to the node label as a header title run if none was scraped.
        // Only when the card actually HAS a header band — headerless nodes (the
        // Format Controller) would otherwise get a phantom title over their content.
        if (!texts.some((t) => t.isTitle)) {
          const label = (node as { label?: string }).label;
          if (label) texts.push({ text: label, x: view.position.x + 9, y: view.position.y + 6, w: 0, h: 0, size: 13, color: 0xf3f5f8, mono: false, isTitle: true, boxed: false, chevron: false, bold: true, letterSpacing: 0, boxFill: null, boxBorder: null, align: "left" });
        }
      } else if (!texts.length) {
        // Note / conduit — show its raw content (their text uses other classes).
        const raw = (card.textContent ?? "").trim();
        if (raw) texts.push({ text: raw.slice(0, 120), x: view.position.x + 9, y: view.position.y + 7, w: 0, h: 0, size: 12, color: 0xcfd6e4, mono: false, isTitle: false, boxed: false, chevron: false, bold: false, letterSpacing: 0, boxFill: null, boxBorder: null, align: "left" });
      }
      const inputs = (node as { inputs?: Record<string, { socket?: { dataType?: string } }> }).inputs ?? {};
      const outputs = (node as { outputs?: Record<string, { socket?: { dataType?: string } }> }).outputs ?? {};
      const sockEls = el.querySelectorAll<HTMLElement>("[data-socket-key][data-socket-side]");
      const sockets: SnapSocket[] = [];
      const byKey = { input: new Map<string, SnapSocket>(), output: new Map<string, SnapSocket>() };
      for (const se of sockEls) {
        const key = se.getAttribute("data-socket-key");
        const sideAttr = se.getAttribute("data-socket-side");
        if (!key || (sideAttr !== "input" && sideAttr !== "output")) continue;
        const r = se.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const dataType = (sideAttr === "input" ? inputs[key]?.socket : outputs[key]?.socket)?.dataType;
        const kind = socketGlyphKind(dataType);
        let color = resolveSockColor(dataType), color2: number | null = null;
        if (kind === "split" && dataType && COMBO_PAIRS[dataType]) {
          color = resolveSockColor(COMBO_PAIRS[dataType][0]);
          color2 = resolveSockColor(COMBO_PAIRS[dataType][1]);
        }
        const s: SnapSocket = {
          key,
          side: sideAttr,
          x: view.position.x + (cx - elRect.left) / k,
          y: view.position.y + (cy - elRect.top) / k,
          kind, color, color2,
        };
        sockets.push(s);
        byKey[sideAttr].set(key, s);
      }
      lookup.set(node.id, byKey);

      // A Conduit's view.position is the node-view origin, but its body floats at a
      // body-relative offset (and is rotated), so view.position is NOT where it paints
      // — the GPU frame drew detached from its own sockets/cables. Use the conduit
      // element's true rect so the frame centres on its sockets.
      let nx = view.position.x, ny = view.position.y, nw = w, nh = h;
      if (card.classList.contains("solenoid-conduit")) {
        const cr = card.getBoundingClientRect();
        nx = view.position.x + (cr.left - elRect.left) / k;
        ny = view.position.y + (cr.top - elRect.top) / k;
        nw = cr.width / k; nh = cr.height / k;
      }

      nodes.push({
        id: node.id,
        x: nx, y: ny, w: nw, h: nh, headerH,
        accent, body: isNode ? (bodyColor ?? ownBg) : ownBg, headerColor, border, borderAlpha,
        texts,
        sliders: isNode ? scrapeSliders(card, elRect, view.position.x, view.position.y, k) : [],
        checkboxes: isNode ? scrapeCheckboxes(card, elRect, view.position.x, view.position.y, k) : [],
        decorations: scrapeDecorations(card, elRect, view.position.x, view.position.y, k),
        images: isNode ? scrapeImages(card, elRect, view.position.x, view.position.y, k) : [],
        isConduit: card.classList.contains("solenoid-conduit"),
        hasChevron: headerH > 0 && !card.classList.contains("solenoid-node--no-chevron"),
        rotation: (((node as { angle?: number }).angle ?? 0) * Math.PI) / 180,
        selected: !!(node as { selected?: boolean }).selected,
        sockets,
      });
    } catch { /* skip a node that won't read; keep the rest */ }
  }

  const cables: SnapCable[] = [];
  try {
    for (const conn of editor.getConnections()) {
      const src = lookup.get(conn.source)?.output.get(conn.sourceOutput);
      const tgt = lookup.get(conn.target)?.input.get(conn.targetInput);
      if (!src || !tgt) continue;
      cables.push({
        id: conn.id,
        source: conn.source, sourceOutput: conn.sourceOutput,
        target: conn.target, targetInput: conn.targetInput,
        sx: src.x, sy: src.y, ex: tgt.x, ey: tgt.y,
        sourceAngleDeg: cableAngleStore.get(conn.source, conn.sourceOutput),
        targetAngleDeg: cableAngleStore.get(conn.target, conn.targetInput),
        color: src.color,
      });
    }
  } catch { /* connections unavailable — render nodes only */ }

  // Standoffs — data-driven (not DOM): bar between the two ends' anchor points.
  const standoffs: SnapStandoff[] = [];
  try {
    const boxOf = new Map<string, Box>();
    for (const n of nodes) boxOf.set(n.id, { x: n.x, y: n.y, w: n.w, h: n.h });
    for (const grp of groups) boxOf.set(grp.id, { x: grp.x, y: grp.y, w: grp.w, h: grp.h });
    for (const s of standoffStore.all()) {
      const ba = boxOf.get(s.a.nodeId), bb = boxOf.get(s.b.nodeId);
      if (!ba || !bb) continue;
      const pa = anchorPoint(ba, s.a.anchor), pb = anchorPoint(bb, s.b.anchor);
      standoffs.push({ ax: pa.x, ay: pa.y, bx: pb.x, by: pb.y, locked: !!s.locked });
    }
  } catch { /* standoffs unavailable — render the rest */ }

  return { nodes, groups, cables, standoffs, transform: { k, x: t.x, y: t.y } };
}
