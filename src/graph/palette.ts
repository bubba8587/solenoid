import { createNotifier, createToggleStore } from "./storeKit";

// ── Color helpers ────────────────────────────────────────────────────────────
function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  const v = max;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return [h * 60, s, v];
}

function hsvToHex(h: number, s: number, v: number): string {
  h = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r1, g1, b1] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r1)}${to(g1)}${to(b1)}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2, d = max - min;
  let h = 0, s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (n: number) => Math.round(Math.min(1, Math.max(0, n + m)) * 255).toString(16).padStart(2, "0");
  return `#${to(r1)}${to(g1)}${to(b1)}`;
}

export function hexToRgba(hex: string, alpha: number): string {
  const t = parseHex(hex);
  if (!t) return `rgba(139,124,246,${alpha})`;
  return `rgba(${t[0]},${t[1]},${t[2]},${alpha})`;
}

// Readable text/icon color for a solid fill of `hex`, BAKED rather than computed
// per call — a node card asks for its ink on every render.
const _inkCache = new Map<string, string>();

export function contrastInk(hex: string): string {
  const hit = _inkCache.get(hex);
  if (hit !== undefined) return hit;
  const ink = computeInk(hex);
  _inkCache.set(hex, ink);
  return ink;
}

function computeInk(hex: string): string {
  const t = parseHex(hex);
  if (!t) return "#fff";
  const lum = (0.299 * t[0] + 0.587 * t[1] + 0.114 * t[2]) / 255;
  return lum > 0.62 ? "#1a1a1a" : "#fff";
}

/** Pre-bake ink for every ACTIVE-palette slot in BOTH themes — `themeAccent`
 *  darkens in light mode, so the modes can land on opposite sides of the
 *  contrast threshold. */
function bakeInks(map: Record<PaletteSlot, string>): void {
  for (const slot of COLOR_PALETTE) {
    const raw = map[slot];
    if (!raw) continue;
    for (const mode of ["dark", "light"] as const) {
      const themed = themeAccent(raw, mode);
      if (!_inkCache.has(themed)) _inkCache.set(themed, computeInk(themed));
    }
    if (!_inkCache.has(raw)) _inkCache.set(raw, computeInk(raw));
  }
}

// Light-mode accent darkening, applied BEFORE the array/matrix shades derive so
// the drop compounds exactly once; the caller passes the mode because palette
// can't import appThemeStore (cycle).
const LIGHT_VALUE_DROP = 0.045;
export function themeAccent(hex: string, mode: "dark" | "light"): string {
  if (mode !== "light") return hex;
  const t = parseHex(hex);
  if (!t) return hex;
  const [h, s, v] = rgbToHsv(...t);
  return hsvToHex(h, s, Math.max(0, v - LIGHT_VALUE_DROP));
}

// A distinctly darker accent shade, for light-mode outside borders.
export function darkenAccent(hex: string): string {
  const t = parseHex(hex);
  if (!t) return hex;
  const [h, s, v] = rgbToHsv(...t);
  return hsvToHex(h, s, Math.max(0, v - 0.07));
}

// The socket glyph's ring: a FIXED HSV value drop off the glyph's OWN fill, so
// every glyph gets the same border-to-fill contrast whatever its lightness.
const RING_VALUE_DROP = 0.23;
export function socketRingShade(hex: string): string {
  const t = parseHex(hex);
  if (!t) return hex;
  const [h, s, v] = rgbToHsv(...t);
  return hsvToHex(h, s, Math.max(0, v - RING_VALUE_DROP));
}

// ── Palette: named slots, the single source of truth for every accent ─────────
// A stored color is a palette SLOT ID — never a raw hex and never an index (the
// swatch order changes, the id is stable) — resolved at render time by
// resolveColor. Ids are OPAQUE: `green` need not be green-hued.
export const PALETTE = {
  gray:      "#8a8f98", // --sock-any
  amber:     "#d9742b", // (input kind only — no socket family)
  blue:      "#3173e0", // (math kind)
  teal:      "#4fc89a", // (convert kind)
  purple:    "#c05dd1", // (logic kind)
  green:     "#00b862", // --sock-lambda
  gold:      "#f5b914", // --sock-number
  lime:      "#c8e040", // --sock-string
  pink:      "#de7cb0", // --sock-date
  sky:       "#56b4e9", // --sock-complex
  vermilion: "#e0473a", // the semantic ERROR red; drives --sol-error
  violet:    "#7b64ed", // --sock-frame
} as const;

export type PaletteSlot = keyof typeof PALETTE;

// Swatch-picker order, ALSO the categorical chart-series order — gray sits at
// slot 7 so the first six series colors stay vivid.
export const COLOR_PALETTE: PaletteSlot[] = [
  "gold", "green", "amber", "blue", "lime", "purple",
  "gray", "vermilion", "violet", "pink", "sky", "teal",
];

// appTheme writes every --sock-* var from these slots on each apply, so App.css
// does not define them.
const ARRAY_VALUE_SCALE = 0.85;
export function socketArrayShade(hex: string): string {
  const t = parseHex(hex);
  if (!t) return hex;
  const [h, s, v] = rgbToHsv(...t);
  return hsvToHex(h, s, v * ARRAY_VALUE_SCALE);
}
// The hue shift is what separates a 2-D socket from its scalar; S/V only keep it
// in the same weight class.
const MATRIX_HUE_SHIFT = -11;
const MATRIX_SAT_GAIN = 1.18;
const MATRIX_VALUE_SCALE = 0.92;
export function socketMatrixShade(hex: string): string {
  const t = parseHex(hex);
  if (!t) return hex;
  const [h, s, v] = rgbToHsv(...t);
  return hsvToHex(h + MATRIX_HUE_SHIFT, Math.min(1, s * MATRIX_SAT_GAIN), v * MATRIX_VALUE_SCALE);
}

export type SocketVarKind = "scalar" | "array" | "matrix";
export const SOCKET_VARS: { var: string; slot: PaletteSlot; kind: SocketVarKind }[] = [
  { var: "--sock-number",      slot: "gold",      kind: "scalar" },
  { var: "--sock-list",        slot: "gold",      kind: "array" },
  { var: "--sock-string",      slot: "lime",      kind: "scalar" },
  { var: "--sock-strlist",     slot: "lime",      kind: "array" },
  { var: "--sock-strtable",    slot: "lime",      kind: "matrix" },
  { var: "--sock-date",        slot: "pink",      kind: "scalar" },
  { var: "--sock-datelist",    slot: "pink",      kind: "array" },
  { var: "--sock-datetable",   slot: "pink",      kind: "matrix" },
  { var: "--sock-complex",     slot: "sky",       kind: "scalar" },
  { var: "--sock-complexlist", slot: "sky",       kind: "array" },
  { var: "--sock-complextable",slot: "sky",       kind: "matrix" },
  { var: "--sock-logical",     slot: "purple",    kind: "scalar" }, // boolean — matches the logic node-kind
  { var: "--sock-logicallist", slot: "purple",    kind: "array" },
  { var: "--sock-logicaltable",slot: "purple",    kind: "matrix" },
  { var: "--sock-table",       slot: "gold",      kind: "matrix" }, // numeric matrix — the grid glyph distinguishes it from numlist
  { var: "--sock-frame",       slot: "violet",    kind: "scalar" },
  { var: "--sock-cube",        slot: "violet",    kind: "scalar" }, // shares the frame's violet — distinguished by its hexagon glyph
  { var: "--sock-lambda",      slot: "green",     kind: "scalar" },
  { var: "--sock-chart",       slot: "green",     kind: "scalar" }, // OBJECT/"Special" family with lambda — shares its green, distinguished by glyph
  { var: "--sock-any",         slot: "gray",      kind: "scalar" },
];

function isPaletteSlot(s: string): s is PaletteSlot {
  return Object.prototype.hasOwnProperty.call(PALETTE, s);
}

// ── Built-in palettes (the app switcher picks among these) ────────────────────
export type PaletteName = "Default" | "Muted" | "Colorblind-safe" | "Solarized" | "Equinox" | "Orchard";

// Default hues at ~0.62 of their saturation, lightness nudged toward mid.
const MUTED: Record<PaletteSlot, string> = {
  gray:      "#8a8f98",
  amber:     "#ba8551",
  blue:      "#6991d4",
  teal:      "#65a2ac",
  purple:    "#a772bb",
  green:     "#27a58a",
  gold:      "#cba743",
  lime:      "#b3c25f",
  pink:      "#c988aa",
  sky:       "#6faacc",
  vermilion: "#c87a5d",
  violet:    "#9479d1",
};

// Okabe–Ito CVD-safe set: the 8 SOCKET slots each take a UNIQUE OI color (the
// type system stays separable); the 4 node-kind-only slots reuse the matching one.
const OI = {
  orange: "#e69f00", sky: "#56b4e9", green: "#009e73", yellow: "#f0e442",
  blue: "#0072b2", vermilion: "#d55e00", purple: "#cc79a7",
} as const;
const COLORBLIND: Record<PaletteSlot, string> = {
  // 8 socket slots — one unique OI color each
  gray:      "#999999",      // any        (neutral; OI has no gray)
  gold:      OI.orange,      // number      (golden → orange)
  lime:      OI.yellow,      // string      (yellow-green → yellow)
  pink:      OI.purple,      // date        (reddish purple)
  sky:       OI.sky,         // complex
  vermilion: OI.vermilion,   // table
  violet:    OI.blue,        // frame
  green:     OI.green,       // lambda      (bluish green)
  // 4 node-kind-only slots — reuse the matching OI color (distinct among themselves)
  amber:     OI.orange,      // input + TABLE socket — reuses number's orange (CVD only)
  blue:      OI.blue,        // math   ↔ frame-socket blue
  teal:      OI.sky,         // convert ↔ complex-socket sky
  purple:    OI.purple,      // logic  ↔ date-socket reddish-purple
};

// Solarized ships 8 accents, so the extra slots take base1 gray + 3 hues blended
// into its hue gaps; every slot stays a DISTINCT color.
const SOL = {
  yellow: "#b58900", orange: "#cb4b16", red: "#dc322f", magenta: "#d33682",
  violet: "#6c71c4", blue: "#268bd2", cyan: "#2aa198", green: "#859900",
} as const;
const SOLARIZED: Record<PaletteSlot, string> = {
  gray:      "#93a1a1",   // any      (Solarized base1)
  vermilion: SOL.red,     // table
  amber:     SOL.orange,  // input
  gold:      "#d9a521",   // number   (brightened off Solarized yellow #b58900)
  lime:      SOL.green,   // string   (olive yellow-green)
  green:     "#5e9e4a",   // lambda   (blended leafy green — keeps it off teal/olive)
  teal:      SOL.cyan,    // convert
  sky:       "#5fa8d8",   // complex  (blended light azure — keeps it off cyan/blue)
  blue:      SOL.blue,    // math
  violet:    SOL.violet,  // frame
  purple:    "#9156a8",   // logic    (blended muted purple — keeps it off violet/magenta)
  pink:      SOL.magenta, // date
};

// Equinox: every slot the SAME gray — type is told apart by socket SHAPE alone.
// This also neutralizes the error red (vermilion drives --sol-error), by design.
const EQUINOX_GRAY = "#8a8f98";
const EQUINOX: Record<PaletteSlot, string> = Object.fromEntries(
  COLOR_PALETTE.map((slot) => [slot, EQUINOX_GRAY]),
) as Record<PaletteSlot, string>;

// Orchard: lifted from the Pear design system (bubba8587/pear, DESIGN.md front
// matter) — a warm cream ground under orchard hues. Pear is a deliberately warm-only
// system (pear green, blossom pink, honey gold, a warm quiet gray, one brick danger)
// and ships NO cool hue at all, so the four cold slots are blended into its gaps at
// Pear's own saturation/value band — the same technique Solarized uses for the accents
// it doesn't ship. Orchard is also the first palette to author a CANVAS ground; see
// BUILTIN_CANVAS below, which lifts Pear's four ground tokens verbatim.
const PEAR = {
  pearFill: "#649117", pearBright: "#b8d532",
  blossomFill: "#d5537f",
  honey: "#9c6f0e", honeyBright: "#d99a17",
  quiet: "#8b8269", danger: "#bb4029",
} as const;
const ORCHARD: Record<PaletteSlot, string> = {
  gold:      PEAR.honeyBright, // number   (honey-bright)
  amber:     PEAR.honey,       // input    (honey — Pear's own darker half of the money pair)
  lime:      PEAR.pearBright,  // string   (pear-bright, the fruit skin)
  green:     PEAR.pearFill,    // lambda   (pear-fill, the brand green)
  pink:      PEAR.blossomFill, // date     (blossom-fill, the romance pink)
  vermilion: PEAR.danger,      // error    (danger — the only red Pear allows)
  gray:      PEAR.quiet,       // any      (quiet, a warm gray)
  // Blended — Pear has no cool hue to lift. Held at its band (S ~.40–.56, V ~.62–.71)
  // so they read as the same family rather than imported from a cold system.
  teal:      "#4f9080",        // convert  (sage, between the pear green and the blues)
  sky:       "#5f9bb5",        // complex  (dusty sky)
  blue:      "#4a739f",        // math     (denim)
  violet:    "#7a6bab",        // frame    (dusty periwinkle)
  purple:    "#9b5f95",        // logic    (muted orchid — clear of both violet and blossom)
};

export const BUILTIN_PALETTES: Record<PaletteName, Record<PaletteSlot, string>> = {
  "Default": { ...PALETTE },
  "Muted": MUTED,
  "Colorblind-safe": COLORBLIND,
  "Solarized": SOLARIZED,
  "Equinox": EQUINOX,
  "Orchard": ORCHARD,
};

export const PALETTE_NAMES = Object.keys(BUILTIN_PALETTES) as PaletteName[];

// ── The canvas ground a palette may author ────────────────────────────────────
// The graph background and its dot grid, per theme mode. These are NOT palette
// slots: nothing stores them on a node and resolveColor never returns one — they
// go straight to --canvas-bg / --canvas-dot, which appTheme writes on every apply.
// That's also why they're a PARALLEL map rather than four more entries in the slot
// record: the slot record is the accent vocabulary a card can point at, and adding
// per-mode ground colors to it would make every slot consumer (chart series, the
// swatch grid, the height ramp, doc overrides) have to skip them.
//
// A palette declaring NOTHING here keeps App.css's neutral ground — appTheme removes
// the inline property for every key it isn't given, so the cascade answers instead of
// the last palette's value sticking. Only Orchard declares one today, deliberately:
// every other palette recolors the graph and leaves the workbench alone.
export type CanvasKey = "bgDark" | "dotDark" | "bgLight" | "dotLight";
export const CANVAS_KEYS: CanvasKey[] = ["bgDark", "dotDark", "bgLight", "dotLight"];
export type CanvasColors = Partial<Record<CanvasKey, string>>;

/** The neutral ground, mirroring App.css's --canvas-bg / --canvas-dot in both
 *  ramps. Not written to the DOM (the stylesheet already carries it) — it's the
 *  seed the custom-palette editor's canvas wells start from, so an author edits
 *  away from what they can see rather than from an empty well. */
export const DEFAULT_CANVAS: Record<CanvasKey, string> = {
  bgDark: "#0e0e0e", dotDark: "#2a2a2a",
  bgLight: "#eef1f5", dotLight: "#d3d9e1",
};

// Orchard's four are Pear tokens verbatim: dark-bg / dark-border and bg / border.
// Pear's `border` (not `border-strong`) is the light dot — its contrast against the
// cream ground lands in the same range as the default pair's.
export const BUILTIN_CANVAS: Record<PaletteName, CanvasColors> = {
  "Default": {},
  "Muted": {},
  "Colorblind-safe": {},
  "Solarized": {},
  "Equinox": {},
  "Orchard": { bgDark: "#141309", dotDark: "#363320", bgLight: "#f4efe3", dotLight: "#e2dac6" },
};

const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);

// ── Active palette state ──────────────────────────────────────────────────────
// Effective = BUILTIN[docBase ?? appBase] + the open doc's per-slot overrides, so
// a doc pin wins over the persisted app choice and never mutates it. Only the APP
// base may be "Custom" (a user-authored map); doc/report bases are built-in names.
export type PaletteChoice = PaletteName | "Custom";

const LS_KEY = "solenoid.palette";
const LS_CUSTOM_KEY = "solenoid.palette.custom";
const LS_CUSTOM_CANVAS_KEY = "solenoid.palette.custom.canvas";
let _appBase: PaletteChoice = "Default";
let _customMap: Record<PaletteSlot, string> = { ...PALETTE };
// The custom palette's ground is always COMPLETE (seeded from DEFAULT_CANVAS), unlike
// a built-in's, which declares only what it means to override. So picking Custom always
// pins a ground — one that starts pixel-identical to App.css's, and that the editor can
// show in a well.
let _customCanvas: Record<CanvasKey, string> = { ...DEFAULT_CANVAS };
let _docBase: PaletteName | null = null;
let _docOverrides: Partial<Record<PaletteSlot, string>> = {};
let _effective: Record<PaletteSlot, string> = { ...PALETTE };
let _effectiveCanvas: CanvasColors = {};

/** The slot→hex map for a base choice (Custom resolves to the user map). */
function baseMapFor(choice: PaletteChoice): Record<PaletteSlot, string> {
  return choice === "Custom" ? _customMap : (BUILTIN_PALETTES[choice] ?? BUILTIN_PALETTES.Default);
}

/** The canvas ground for a base choice — `{}` when that palette declares none. */
function baseCanvasFor(choice: PaletteChoice): CanvasColors {
  return choice === "Custom" ? _customCanvas : (BUILTIN_CANVAS[choice] ?? {});
}

// REPORT/EXPORT-only override — a PARALLEL map, deliberately separate from
// `_effective`: a brand override for an export must NOT retint the live canvas.
let _reportBase: PaletteName | null = null;
let _reportOverrides: Partial<Record<PaletteSlot, string>> = {};
let _reportEffective: Record<PaletteSlot, string> = { ...PALETTE };

const { notify: notifyPalette, subscribe: subscribePalette, version: paletteVersion } = createNotifier();
// Separate notifier from the canvas one so a report-only change never wakes
// canvas-only subscribers, and vice versa.
const { notify: notifyReportPalette, subscribe: subscribeReportPalette, version: reportPaletteVersion } = createNotifier();

function recompute() {
  const base = _docBase ? (BUILTIN_PALETTES[_docBase] ?? BUILTIN_PALETTES.Default) : baseMapFor(_appBase);
  _effective = { ...base, ..._docOverrides };
  // A doc pin picks the ground too — the whole point of pinning is that the doc
  // looks the same wherever it's opened. Doc `overrides` stay slot-only.
  _effectiveCanvas = _docBase ? (BUILTIN_CANVAS[_docBase] ?? {}) : baseCanvasFor(_appBase);
  bakeInks(_effective);
}

function recomputeReport() {
  _reportEffective = { ...baseMapFor(_reportBase ?? _docBase ?? _appBase), ..._reportOverrides };
}

function persist() {
  try { localStorage.setItem(LS_KEY, _appBase); } catch { /* private mode / quota */ }
}

function persistCustom() {
  try {
    localStorage.setItem(LS_CUSTOM_KEY, JSON.stringify(_customMap));
    localStorage.setItem(LS_CUSTOM_CANVAS_KEY, JSON.stringify(_customCanvas));
  } catch { /* private mode / quota */ }
}

// Recompute + notify both palettes after a custom-map edit, but only when it's
// actually on screen (Custom active AND no doc pin overriding it).
function afterCustomEdit() {
  persistCustom();
  if (_appBase === "Custom" && !_docBase) {
    recompute();
    recomputeReport();
    notifyPalette();
    notifyReportPalette();
  }
}

export const paletteStore = {
  subscribe: subscribePalette,
  version: paletteVersion,
  names: () => PALETTE_NAMES,
  /** The app-wide switcher choice (what the picker shows selected) — a built-in or "Custom". */
  activeBase: (): PaletteChoice => _appBase,
  /** The base actually in effect for the open doc (doc pin wins over app choice). */
  effectiveBase: (): PaletteChoice => _docBase ?? _appBase,
  /** App-wide palette switcher — persisted, retints every open doc not pinned. */
  setActiveBase(name: PaletteChoice) {
    if ((name !== "Custom" && !(name in BUILTIN_PALETTES)) || name === _appBase) return;
    _appBase = name;
    recompute();
    recomputeReport(); // the report palette's base fallback chain includes appBase
    persist();
    notifyPalette();
    notifyReportPalette();
  },
  /** The active palette's canvas ground — `{}` when it authors none, in which case
   *  appTheme clears the vars and App.css's neutral ground answers. */
  canvasColors: (): CanvasColors => ({ ..._effectiveCanvas }),
  /** The user's editable custom palette (F-1) — a full slot→hex map. */
  customMap: (): Record<PaletteSlot, string> => ({ ..._customMap }),
  /** The custom palette's canvas ground — always complete (see _customCanvas). */
  customCanvas: (): Record<CanvasKey, string> => ({ ..._customCanvas }),
  /** Edit one slot of the custom palette; retints live when Custom is the active base. */
  setCustomSlot(slot: PaletteSlot, hex: string) {
    if (!isPaletteSlot(slot) || !isHex(hex) || _customMap[slot] === hex) return;
    _customMap = { ..._customMap, [slot]: hex };
    afterCustomEdit();
  },
  /** Seed the custom palette from a built-in template (the editor's "Load template").
   *  A template that authors no ground seeds the neutral one, so loading it CLEARS a
   *  previously-authored custom ground rather than leaving the old one behind. */
  loadCustomTemplate(name: PaletteName) {
    if (!(name in BUILTIN_PALETTES)) return;
    _customMap = { ...BUILTIN_PALETTES[name] };
    _customCanvas = { ...DEFAULT_CANVAS, ...BUILTIN_CANVAS[name] };
    afterCustomEdit();
  },
  /** Commit a whole custom map at once (the editor's Save — draft edits apply here
   *  in one go, so the app retints once instead of live on every drag tick). */
  setCustomMap(map: Record<PaletteSlot, string>, canvas?: CanvasColors) {
    const next: Record<PaletteSlot, string> = { ..._customMap };
    for (const slot of COLOR_PALETTE) {
      if (isHex(map[slot])) next[slot] = map[slot];
    }
    _customMap = next;
    if (canvas) {
      const nextCanvas: Record<CanvasKey, string> = { ..._customCanvas };
      for (const key of CANVAS_KEYS) {
        const v = canvas[key];
        if (isHex(v)) nextCanvas[key] = v;
      }
      _customCanvas = nextCanvas;
    }
    afterCustomEdit();
  },
  /** Apply the open document's palette declaration (on graph load). Null clears it. */
  setDocPalette(p?: { base?: string; overrides?: Record<string, string> } | null) {
    _docBase = p?.base && p.base in BUILTIN_PALETTES ? (p.base as PaletteName) : null;
    _docOverrides = {};
    if (p?.overrides) {
      for (const [k, v] of Object.entries(p.overrides)) {
        if (isPaletteSlot(k) && typeof v === "string") _docOverrides[k] = v;
      }
    }
    recompute();
    recomputeReport(); // ditto — falls back through docBase too
    notifyPalette();
    notifyReportPalette();
  },
  /** The open doc's palette block for serialization (undefined when it declares none). */
  docPalette(): { base?: PaletteName; overrides?: Record<string, string> } | undefined {
    const hasOverrides = Object.keys(_docOverrides).length > 0;
    if (!_docBase && !hasOverrides) return undefined;
    const out: { base?: PaletteName; overrides?: Record<string, string> } = {};
    if (_docBase) out.base = _docBase;
    if (hasOverrides) out.overrides = { ..._docOverrides };
    return out;
  },
};

/** The REPORT/EXPORT-only palette — a colors-only brand override scoped to export
 *  surfaces, never the canvas; mirrors the canvas palette when undeclared. */
export const reportPaletteStore = {
  subscribe: subscribeReportPalette,
  version: reportPaletteVersion,
  /** Resolve a stored slot id through the REPORT palette (not the canvas one). */
  resolve(slot: string): string {
    return NEUTRAL_HEX[slot] ?? (isPaletteSlot(slot) ? _reportEffective[slot] : undefined) ?? _reportEffective.gray;
  },
  /** Apply the open document's report-palette declaration (on graph load). Null clears it. */
  setReportPalette(p?: { base?: string; overrides?: Record<string, string> } | null) {
    _reportBase = p?.base && p.base in BUILTIN_PALETTES ? (p.base as PaletteName) : null;
    _reportOverrides = {};
    if (p?.overrides) {
      for (const [k, v] of Object.entries(p.overrides)) {
        if (isPaletteSlot(k) && typeof v === "string") _reportOverrides[k] = v;
      }
    }
    recomputeReport();
    notifyReportPalette();
  },
  /** The open doc's report-palette block for serialization (undefined when it declares none). */
  reportPalette(): { base?: PaletteName; overrides?: Record<string, string> } | undefined {
    const hasOverrides = Object.keys(_reportOverrides).length > 0;
    if (!_reportBase && !hasOverrides) return undefined;
    const out: { base?: PaletteName; overrides?: Record<string, string> } = {};
    if (_reportBase) out.base = _reportBase;
    if (hasOverrides) out.overrides = { ..._reportOverrides };
    return out;
  },
};

/** The custom-palette editor modal open flag (F-1). */
export const paletteEditorPanel = createToggleStore();

/** Read the persisted app palette choice and apply it. Call once at startup. */
export function initPalette() {
  try {
    const raw = localStorage.getItem(LS_CUSTOM_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const m: Record<PaletteSlot, string> = { ...PALETTE };
      for (const slot of COLOR_PALETTE) {
        if (isHex(parsed?.[slot])) m[slot] = parsed[slot];
      }
      _customMap = m;
    }
  } catch { /* ignore malformed custom map */ }
  try {
    const raw = localStorage.getItem(LS_CUSTOM_CANVAS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const c: Record<CanvasKey, string> = { ...DEFAULT_CANVAS };
      for (const key of CANVAS_KEYS) {
        if (isHex(parsed?.[key])) c[key] = parsed[key];
      }
      _customCanvas = c;
    }
  } catch { /* ignore malformed custom ground */ }
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v === "Custom" || (v && v in BUILTIN_PALETTES)) _appBase = v as PaletteChoice;
  } catch { /* ignore */ }
  recompute();
  // Notify so subscribers sync to a persisted non-Default palette at startup.
  notifyPalette();
}

// ── Neutral shades (the gray swatch's 3-way cycle) ────────────────────────────
// `gray` is a real palette SLOT; the two extremes are FIXED neutrals carried as
// sentinel slot ids so a card can store and serialize them like any color.
export const NEUTRAL_WHITE = "neutral-white";
export const NEUTRAL_DARK = "neutral-dark";
// Null-prototype so a stray stored slot like "constructor" reads as undefined
// rather than returning a function.
export const NEUTRAL_HEX: Record<string, string> = Object.assign(Object.create(null) as Record<string, string>, {
  [NEUTRAL_WHITE]: "#f3f4f6", // near-white (a hair off pure white so it reads as a swatch)
  [NEUTRAL_DARK]: "#3a3d42",  // much darker gray
});
// Cycle order matches the split disc: upper-left white, middle gray, bottom-right dark.
export const NEUTRAL_CYCLE = [NEUTRAL_WHITE, "gray", NEUTRAL_DARK] as const;
export function isNeutralShade(slot: string): boolean {
  return slot === NEUTRAL_WHITE || slot === NEUTRAL_DARK;
}
/** The gray swatch's next value: gray→dark→white→gray; any real color → gray (home). */
export function nextNeutral(current: string | undefined): string {
  const i = NEUTRAL_CYCLE.indexOf(current as (typeof NEUTRAL_CYCLE)[number]);
  return i === -1 ? "gray" : NEUTRAL_CYCLE[(i + 1) % NEUTRAL_CYCLE.length];
}

// ── Sequential height ramp (Surface / Contour / Vector Field) ────────────────
// Lightness is FORCED onto a monotonic dark→light ladder so the ramp reads as
// height under any palette; memoized per palette version (thousands of calls a draw).
const RAMP_SLOTS: PaletteSlot[] = ["violet", "blue", "teal", "green", "gold"];
const RAMP_L = [0.26, 0.38, 0.5, 0.62, 0.78];
let _ramp: Array<[number, number, number]> | null = null;
let _rampVer = -1;
function rampStops(): Array<[number, number, number]> {
  if (_ramp && _rampVer === paletteVersion()) return _ramp;
  _rampVer = paletteVersion();
  _ramp = RAMP_SLOTS.map((slot, i) => {
    const t = parseHex(resolveColor(slot)) ?? [138, 143, 152];
    const [h, s] = rgbToHsl(...t);
    return parseHex(hslToHex(h, s, RAMP_L[i])) ?? t;
  });
  return _ramp;
}
/** Palette-derived sequential colormap: t ∈ [0,1] → [r,g,b]. */
export function heightRampColor(t: number): [number, number, number] {
  const stops = rampStops();
  const u = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(u));
  const f = u - i, a = stops[i], b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

// The one boundary where slot → hex happens; total by design so a stray value
// never crashes a render (falls back to gray), NOT a back-compat path.
export function resolveColor(slot: string): string {
  return NEUTRAL_HEX[slot] ?? (isPaletteSlot(slot) ? _effective[slot] : undefined) ?? _effective.gray;
}
