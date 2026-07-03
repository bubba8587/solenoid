import { createNotifier } from "./storeKit";

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

// Readable text/icon color (#fff or near-black) for a solid fill of `hex`.
export function contrastInk(hex: string): string {
  const t = parseHex(hex);
  if (!t) return "#fff";
  const lum = (0.299 * t[0] + 0.587 * t[1] + 0.114 * t[2]) / 255;
  return lum > 0.62 ? "#1a1a1a" : "#fff";
}

// Saturated accents tuned for a dark canvas glow a little on white. In light
// mode nudge them slightly darker (HSV value only, −0.06) so they read as solid.
// Caller passes the current mode (palette can't import appThemeStore — that'd be
// a cycle, since appTheme imports the helpers above).
export function themeAccent(hex: string, mode: "dark" | "light"): string {
  if (mode !== "light") return hex;
  const t = parseHex(hex);
  if (!t) return hex;
  const [h, s, v] = rgbToHsv(...t);
  return hsvToHex(h, s, Math.max(0, v - 0.06));
}

// A distinctly darker shade of an accent, for light-mode outside borders so a
// node/group reads as framed in its own color rather than a neutral gray.
export function darkenAccent(hex: string): string {
  const t = parseHex(hex);
  if (!t) return hex;
  const [h, s, v] = rgbToHsv(...t);
  return hsvToHex(h, s, Math.max(0, v - 0.07));
}

// ── Palette: named slots, the single source of truth for every accent ─────────
// A stored color (a Note, a Group, the app accent) is a palette SLOT ID, never a
// raw hex. Everything resolves the slot to a hex at render time via resolveColor,
// so retuning a color here retints the whole app and nothing can drift out of
// sync. Slot ids are OPAQUE keys — never assume `green` is actually green-hued;
// a future user palette is just a different slot→hex map under the same ids, so
// honoring that means treating the name as a lookup key, not a claim about hue.
// (This is also why we store the slot, not a palette INDEX: the swatch order can
// change, but the id is stable.)
// Default slots are backfit to the (well-liked) scalar SOCKET colors where a socket
// family maps to a slot — so the socket dots, cables and legend are literally the
// palette (one source of truth) and a palette switch retints them too. See
// SOCKET_SCALAR_SLOTS below. The socket-family slots ARE these hexes (one source of
// truth); gold/lime/sky stayed, the rest were hue/sat-tuned (2026-06-30) — chiefly to
// pull date-pink redward so it no longer reads like boolean-purple.
export const PALETTE = {
  gray:      "#8a8f98", // --sock-any
  amber:     "#d9742b", // (input kind only — no socket family) — nudged more orange
  blue:      "#3173e0", // (math kind) — nudged deeper (darker / more saturated)
  teal:      "#4fc89a", // (convert kind) — pushed into green (jade), away from sky blue
  purple:    "#c05dd1", // (logic kind) — nudged slightly redder, stays violet-purple
  green:     "#00b862", // --sock-lambda — purer/yellower green, away from the jade teal
  gold:      "#f5b914", // --sock-number
  lime:      "#c8e040", // --sock-string
  pink:      "#de7cb0", // --sock-date
  sky:       "#56b4e9", // --sock-complex
  vermilion: "#e95c3c", // --sock-table — nudged redder
  violet:    "#7b64ed", // --sock-frame — nudged a little bluer
} as const;

export type PaletteSlot = keyof typeof PALETTE;

// Order the swatch picker shows the slots in (hue families grouped loosely).
export const COLOR_PALETTE: PaletteSlot[] = [
  "gray", "amber", "blue", "teal", "purple", "green",
  "gold", "lime", "pink", "sky", "vermilion", "violet",
];

// EVERY socket color is derived from a palette slot — so sockets are built entirely
// from the palette (one source of truth) and a palette switch retints the whole
// socket family. appTheme writes these --sock-* vars on every apply (see SOCKET_VARS),
// so App.css no longer defines them.
//   - scalar: the slot color itself (mode-shifted via themeAccent).
//   - array (a list of the scalar): a darker sibling — RGB-multiply ×0.8. Reproduces
//     the old hand-tuned arrays closely for most families (string's was a deliberate
//     extra-dark olive; it comes out a touch brighter now — accepted).
//   - matrix (a 2-D grid): a punchier, slightly hue-shifted sibling — +6° hue, L ×0.86.
// number's MATRIX is the Table socket, which is its own scalar (vermilion), not a
// derived shade of number — hence --sock-table is a scalar mapping.
const ARRAY_DARKEN = 0.8;
export function socketArrayShade(hex: string): string {
  const t = parseHex(hex);
  if (!t) return hex;
  return `#${t.map((c) => Math.round(Math.min(255, Math.max(0, c * ARRAY_DARKEN))).toString(16).padStart(2, "0")).join("")}`;
}
export function socketMatrixShade(hex: string): string {
  const t = parseHex(hex);
  if (!t) return hex;
  const [h, s, l] = rgbToHsl(...t);
  return hslToHex(h + 6, Math.min(1, s * 0.99), l * 0.86);
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
  { var: "--sock-table",       slot: "vermilion", kind: "scalar" }, // numeric matrix (own color)
  { var: "--sock-frame",       slot: "violet",    kind: "scalar" },
  { var: "--sock-cube",        slot: "violet",    kind: "scalar" }, // recursive container — shares the frame's violet (distinguished by its hexagon glyph, not colour)
  { var: "--sock-lambda",      slot: "green",     kind: "scalar" },
  { var: "--sock-chart",       slot: "blue",      kind: "scalar" }, // the object family's other member — shares the math node-kind's blue (distinguished by context/glyph, not colour; no socket slot left unclaimed, same doubling-up precedent as cube/frame)
  { var: "--sock-any",         slot: "gray",      kind: "scalar" },
];

function isPaletteSlot(s: string): s is PaletteSlot {
  return Object.prototype.hasOwnProperty.call(PALETTE, s);
}

// ── Built-in palettes (the app switcher picks among these) ────────────────────
// Each is a full slot→hex map. "Default" is the canonical PALETTE above; the
// alternates recolor every slot. Because everything stores a slot id and resolves
// through the active map, switching the base retints the WHOLE app (notes, groups,
// the accent AND node-kind headers). Author a new palette by adding an entry here.
//   - Muted: Default hues at lower saturation — a calmer canvas.
//   - Colorblind-safe: the Okabe–Ito CVD-safe set mapped onto the slots (see map comment).
//   - Solarized: Ethan Schoonover's Solarized accent set mapped onto the slots — a warm,
//     vintage character distinct from Muted's desaturation (see map comment).
export type PaletteName = "Default" | "Muted" | "Colorblind-safe" | "Solarized";

// Default hues at ~0.62 of their saturation (an earlier pass at ~0.5 washed out),
// lightness nudged slightly toward mid so nothing glares or muddies. Calmer than
// Default without going gray.
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

// Derived from the Okabe–Ito 8-colour qualitative palette — the established CVD-safe
// set (https://jfly.uni-koeln.de/color/), distinguishable under protan/deutan/tritan.
// Rather than home-grow 12 distinct hues (impossible under CVD), we lean on the proven
// set and accept slots doubling up: the 8 SOCKET slots each get a UNIQUE Okabe–Ito
// colour (so the type system stays fully separable), and the 4 node-kind-only slots
// (amber/blue/teal/purple) reuse the matching OI colour — they're still mutually
// distinct (orange / blue / sky / reddish-purple) and only coincide with a socket
// colour, a different UI role. Okabe–Ito has no neutral, so gray keeps #999999.
//   OI: orange #E69F00 · sky #56B4E9 · green #009E73 · yellow #F0E442 ·
//       blue #0072B2 · vermilion #D55E00 · reddish-purple #CC79A7 (black dropped — dark canvas).
const OI = {
  orange: "#e69f00", sky: "#56b4e9", green: "#009e73", yellow: "#f0e442",
  blue: "#0072b2", vermilion: "#d55e00", purple: "#cc79a7",
} as const;
const COLORBLIND: Record<PaletteSlot, string> = {
  // 8 socket slots — one unique OI colour each
  gray:      "#999999",      // any        (neutral; OI has no gray)
  gold:      OI.orange,      // number      (golden → orange)
  lime:      OI.yellow,      // string      (yellow-green → yellow)
  pink:      OI.purple,      // date        (reddish purple)
  sky:       OI.sky,         // complex
  vermilion: OI.vermilion,   // table
  violet:    OI.blue,        // frame
  green:     OI.green,       // lambda      (bluish green)
  // 4 node-kind-only slots — reuse the matching OI colour (distinct among themselves)
  amber:     OI.orange,      // input  ↔ number-socket orange
  blue:      OI.blue,        // math   ↔ frame-socket blue
  teal:      OI.sky,         // convert ↔ complex-socket sky
  purple:    OI.purple,      // logic  ↔ date-socket reddish-purple
};

// Solarized accent set (https://ethanschoonover.com/solarized/) — proven legible on
// dark backgrounds (it's a dark-theme staple). UNLIKE Colorblind, every slot here is a
// DISTINCT colour (the author wants slots doubling up ONLY where CVD forces it). Solarized
// ships 8 accents, so the extra slots get base1 gray + 3 hues blended into Solarized's hue
// gaps (leafy green ~100°, light azure ~200°, muted purple ~285°) at its sat/lightness band,
// so all 12 read apart. Slot ids are opaque (hue need not match the name): `lime` carries
// Solarized green (olive), `green` a leafier green, `purple` the blended purple.
const SOL = {
  yellow: "#b58900", orange: "#cb4b16", red: "#dc322f", magenta: "#d33682",
  violet: "#6c71c4", blue: "#268bd2", cyan: "#2aa198", green: "#859900",
} as const;
const SOLARIZED: Record<PaletteSlot, string> = {
  gray:      "#93a1a1",   // any      (Solarized base1)
  vermilion: SOL.red,     // table
  amber:     SOL.orange,  // input
  gold:      "#d9a521",   // number   (brightened — Solarized yellow #b58900 read too dark/dull)
  lime:      SOL.green,   // string   (olive yellow-green)
  green:     "#5e9e4a",   // lambda   (blended leafy green — keeps it off teal/olive)
  teal:      SOL.cyan,    // convert
  sky:       "#5fa8d8",   // complex  (blended light azure — keeps it off cyan/blue)
  blue:      SOL.blue,    // math
  violet:    SOL.violet,  // frame
  purple:    "#9156a8",   // logic    (blended muted purple — keeps it off violet/magenta)
  pink:      SOL.magenta, // date
};

export const BUILTIN_PALETTES: Record<PaletteName, Record<PaletteSlot, string>> = {
  "Default": { ...PALETTE },
  "Muted": MUTED,
  "Colorblind-safe": COLORBLIND,
  "Solarized": SOLARIZED,
};

export const PALETTE_NAMES = Object.keys(BUILTIN_PALETTES) as PaletteName[];

// ── Active palette state ──────────────────────────────────────────────────────
// The effective palette is BUILTIN[docBase ?? appBase] with the open document's
// per-slot overrides layered on top:
//   - appBase: the app-wide switcher choice, persisted to localStorage (like dark
//     mode). Set by the AppToolbar palette picker.
//   - docBase / docOverrides: the OPEN document's own palette declaration, read
//     from its saved JSON `palette` block (no editor UI yet — hand/seed-authored).
//     They affect only that document and never touch the persisted app choice.
// Stored colors are slot ids; this is the map they resolve through. A module
// singleton (like appThemeStore) so it's readable from Rete's separate React root.
const LS_KEY = "solenoid.palette";
let _appBase: PaletteName = "Default";
let _docBase: PaletteName | null = null;
let _docOverrides: Partial<Record<PaletteSlot, string>> = {};
let _effective: Record<PaletteSlot, string> = { ...PALETTE };

const { notify: notifyPalette, subscribe: subscribePalette, version: paletteVersion } = createNotifier();

function recompute() {
  const base = BUILTIN_PALETTES[_docBase ?? _appBase] ?? BUILTIN_PALETTES.Default;
  _effective = { ...base, ..._docOverrides };
}

function persist() {
  try { localStorage.setItem(LS_KEY, _appBase); } catch { /* private mode / quota */ }
}

export const paletteStore = {
  subscribe: subscribePalette,
  version: paletteVersion,
  names: () => PALETTE_NAMES,
  /** The app-wide switcher choice (what the picker shows selected). */
  activeBase: () => _appBase,
  /** The base actually in effect for the open doc (doc pin wins over app choice). */
  effectiveBase: () => _docBase ?? _appBase,
  /** App-wide palette switcher — persisted, retints every open doc not pinned. */
  setActiveBase(name: PaletteName) {
    if (!(name in BUILTIN_PALETTES) || name === _appBase) return;
    _appBase = name;
    recompute();
    persist();
    notifyPalette();
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
    notifyPalette();
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

/** Read the persisted app palette choice and apply it. Call once at startup. */
export function initPalette() {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v && v in BUILTIN_PALETTES) _appBase = v as PaletteName;
  } catch { /* ignore */ }
  recompute();
  // Notify so subscribers (NODE_KIND_ACCENTS refresh, appTheme re-apply) sync to a
  // persisted non-Default palette at startup, not just on the first later change.
  notifyPalette();
}

// Resolve a stored color slot id to a hex through the ACTIVE palette — the one
// boundary where slot → hex happens. Anything that isn't a known slot falls back
// to gray; this is a total function so a stray value never crashes a render, NOT a
// back-compat path (a pre-token save's raw hex resolves to gray until re-picked).
export function resolveColor(slot: string): string {
  return (isPaletteSlot(slot) ? _effective[slot] : undefined) ?? _effective.gray;
}
