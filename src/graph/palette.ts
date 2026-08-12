import { createNotifier, createToggleStore } from "./storeKit";

// ── Color helpers ────────────────────────────────────────────────────────────
function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);

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
export type PaletteName = "Default" | "Muted" | "Colorblind-safe" | "Solarized" | "Equinox" | "Orchard" | "Blueprint";

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

// Blueprint: a cyanotype drafting table. The reason it fits Solenoid rather than being
// a skin — the canvas already draws a 24px dot grid, and on a prussian ground that grid
// stops being decoration and reads as what it has always looked like, drafting paper.
// The slots are colored pencils on that paper: chalky, mid-value pigments that hold up
// both on deep blue and on the whiteprint light mode. No blue-on-blue for the cold
// slots — `blue` and `sky` stay clearly separated from the ground by value.
const BLUEPRINT: Record<PaletteSlot, string> = {
  gold:      "#e8b84b", // number
  amber:     "#e08a4f", // input
  lime:      "#b9d05a", // string
  green:     "#5fc08a", // lambda
  teal:      "#4fbcb4", // convert
  sky:       "#7fc6e8", // complex  (the blueprint's own hue, pulled pale)
  blue:      "#4f8fd0", // math
  violet:    "#8a8fe0", // frame
  purple:    "#b18ede", // logic
  pink:      "#e58fa8", // date
  vermilion: "#e2604f", // error
  gray:      "#9aa8bd", // any      (a blue-tinted neutral, at home on the ground)
};

export const BUILTIN_PALETTES: Record<PaletteName, Record<PaletteSlot, string>> = {
  "Default": { ...PALETTE },
  "Muted": MUTED,
  "Colorblind-safe": COLORBLIND,
  "Solarized": SOLARIZED,
  "Equinox": EQUINOX,
  "Orchard": ORCHARD,
  "Blueprint": BLUEPRINT,
};

export const PALETTE_NAMES = Object.keys(BUILTIN_PALETTES) as PaletteName[];

// ── The chrome ramp a palette may author ──────────────────────────────────────
// The canvas ground plus the neutral workbench around it — surfaces, borders, ink —
// per theme mode. These are NOT palette slots: nothing stores one on a node and
// resolveColor never returns one. They go straight to the App.css neutral tokens,
// which appTheme writes on every apply. That's also why they're a PARALLEL map
// rather than more entries in the slot record: the slot record is the accent
// vocabulary a card can point at, and per-mode neutrals in it would make every slot
// consumer (chart series, the swatch grid, the height ramp, doc overrides) skip them.
//
// A palette declaring NOTHING here keeps App.css's neutral ramps — appTheme removes
// the inline property for every var it isn't given, so the cascade answers instead of
// the last palette's value sticking. Authoring a ramp is opt-in and rare: recoloring
// the graph is what a palette does, recoloring the workbench is a separate claim, and
// only Orchard makes it (D35).
//
// The 13 keys are the ones a warm palette actually has to move. The rest of the neutral
// chrome DERIVES from them (see chromeCssVars) — either through App.css's own var()
// chains (--btn-bg → --surface-sunken, --panel-border → --border) or through the mixes
// below, so an author tunes one ramp instead of forty tokens.
export type ChromeKey =
  | "appBg" | "canvasBg" | "canvasDot"
  | "surface" | "surfaceSunken" | "surfaceRaised"
  | "border" | "borderStrong" | "borderSubtle"
  | "text" | "textBright" | "textDim" | "textMuted";
export type ChromeRamp = Partial<Record<ChromeKey, string>>;
export type PaletteChrome = { dark: ChromeRamp; light: ChromeRamp };

export const CHROME_VARS: { var: string; key: ChromeKey }[] = [
  { var: "--app-bg",          key: "appBg" },
  { var: "--canvas-bg",       key: "canvasBg" },
  { var: "--canvas-dot",      key: "canvasDot" },
  { var: "--surface",         key: "surface" },
  { var: "--surface-sunken",  key: "surfaceSunken" },
  { var: "--surface-raised",  key: "surfaceRaised" },
  { var: "--border",          key: "border" },
  { var: "--border-strong",   key: "borderStrong" },
  { var: "--border-subtle",   key: "borderSubtle" },
  { var: "--text",            key: "text" },
  { var: "--text-bright",     key: "textBright" },
  { var: "--text-dim",        key: "textDim" },
  { var: "--text-muted",      key: "textMuted" },
];
export const CHROME_KEYS: ChromeKey[] = CHROME_VARS.map((v) => v.key);

/** The neutral ramps, mirroring App.css's two `:root` blocks. Not written to the DOM
 *  (the stylesheet already carries them) — this is the seed the custom-palette
 *  editor's chrome wells start from, so an author edits away from what they can see
 *  rather than from an empty well. Keep in sync with App.css; `chrome.test.ts` can't
 *  read a stylesheet, so this pair is a hand-held mirror. */
export const DEFAULT_CHROME: { dark: Record<ChromeKey, string>; light: Record<ChromeKey, string> } = {
  dark: {
    appBg: "#141414", canvasBg: "#0e0e0e", canvasDot: "#2a2a2a",
    surface: "#1e1e1e", surfaceSunken: "#141414", surfaceRaised: "#262626",
    border: "#2d2d2d", borderStrong: "#3a3a3a", borderSubtle: "#2a2a2a",
    text: "#e8e8e8", textBright: "#f3f4f5", textDim: "#9aa0a6", textMuted: "#80868e",
  },
  light: {
    appBg: "#f4f5f7", canvasBg: "#eef1f5", canvasDot: "#d3d9e1",
    surface: "#fbfcfd", surfaceSunken: "#ffffff", surfaceRaised: "#eef1f5",
    border: "#ccd2da", borderStrong: "#b2bac4", borderSubtle: "#dfe3e9",
    text: "#1b1e23", textBright: "#0d0f12", textDim: "#5b636b", textMuted: "#6a717b",
  },
};

// Orchard's ramp is Pear's neutrals, mapped onto Solenoid's roles rather than copied
// position-for-position — the two systems disagree about one thing. Pear sinks its
// fields (a sunken fill on a card); Solenoid's light theme makes the FIELD the
// brightest layer so a number box reads as a familiar input (DESIGN.md §2). So in
// light: Pear white → sunken, Pear surface → surface, Pear surface-sunken → raised.
// Where Pear ships no token (surfaceRaised/borderSubtle/textBright in dark, borderStrong
// in light) the value is a step off the nearest Pear one, held in its band.
const ORCHARD_CHROME: PaletteChrome = {
  dark: {
    appBg: "#17160c",         // dark-surface-sunken (the frame, a step off the canvas)
    canvasBg: "#141309",      // dark-bg
    canvasDot: "#363320",     // dark-border
    surface: "#1f1d12",       // dark-surface
    surfaceSunken: "#17160c", // dark-surface-sunken
    surfaceRaised: "#2a2718", // (a step up from surface)
    border: "#363320",        // dark-border
    borderStrong: "#4c472c",  // dark-border-strong
    borderSubtle: "#2b2818",  // (between surface and border)
    text: "#f0ead8",          // dark-text
    textBright: "#fdf8ea",    // (a step brighter than text)
    textDim: "#aaa287",       // dark-text-dim
    textMuted: "#857d63",     // dark-text-muted
  },
  light: {
    appBg: "#ede7d7",         // surface-sunken (a deeper cream behind the canvas)
    canvasBg: "#f4efe3",      // bg — the warm cream ground
    canvasDot: "#e2dac6",     // border
    surface: "#fffdf7",       // surface
    surfaceSunken: "#ffffff", // white — the field stays the brightest layer
    surfaceRaised: "#ede7d7", // surface-sunken (hover/selected fill inside chrome)
    border: "#cdc3a7",        // border-strong
    borderStrong: "#b8ab87",  // (a step darker — Pear's ramp stops one short)
    borderSubtle: "#e2dac6",  // border
    text: "#2b2517",          // text
    textBright: "#191308",    // (a step darker than text)
    textDim: "#6d6450",       // text-dim
    textMuted: "#8b8269",     // text-muted
  },
};

// Muted's brief is a calmer canvas, so its chrome lifts off near-black onto a soft
// charcoal and pulls the light ramp's contrast in a step. Barely-warm neutrals; the
// point is lower glare, not a hue.
const MUTED_CHROME: PaletteChrome = {
  dark: {
    appBg: "#1b1c20", canvasBg: "#16171a", canvasDot: "#303338",
    surface: "#232529", surfaceSunken: "#1a1b1f", surfaceRaised: "#2b2e33",
    border: "#34373d", borderStrong: "#43474e", borderSubtle: "#2d3035",
    text: "#dfe1e5", textBright: "#f0f1f3", textDim: "#a2a7ae", textMuted: "#8b9098",
  },
  light: {
    appBg: "#f1f2f5", canvasBg: "#eceef1", canvasDot: "#d6dae0",
    surface: "#fafbfc", surfaceSunken: "#ffffff", surfaceRaised: "#eceef1",
    border: "#cdd2d9", borderStrong: "#b3b9c2", borderSubtle: "#dfe2e7",
    text: "#24272c", textBright: "#14161a", textDim: "#5d626a", textMuted: "#6b7079",
  },
};

// Colorblind-safe leans the other way: the Okabe–Ito hues carry the ENTIRE type
// signal here, so the chrome goes fully achromatic (no blue cast to compete with a
// blue socket) and a step crisper than Default, widening the gap between chrome and
// content.
const CVD_CHROME: PaletteChrome = {
  dark: {
    appBg: "#131313", canvasBg: "#0a0a0a", canvasDot: "#2e2e2e",
    surface: "#1c1c1c", surfaceSunken: "#121212", surfaceRaised: "#292929",
    border: "#333333", borderStrong: "#4a4a4a", borderSubtle: "#272727",
    text: "#f2f2f2", textBright: "#ffffff", textDim: "#ababab", textMuted: "#949494",
  },
  light: {
    appBg: "#f0f0f0", canvasBg: "#e8e8e8", canvasDot: "#cfcfcf",
    surface: "#fcfcfc", surfaceSunken: "#ffffff", surfaceRaised: "#ebebeb",
    border: "#c2c2c2", borderStrong: "#a0a0a0", borderSubtle: "#dadada",
    text: "#121212", textBright: "#000000", textDim: "#4d4d4d", textMuted: "#5e5e5e",
  },
};

// Solarized ships a base ramp as famous as its accents (base03…base3, a fixed
// lightness ladder on one blue-green ground), and until now the palette used only
// half the system. This is that ladder in its canonical role assignment: background,
// background highlight, then the content tones in Solarized's own order. Border tiers
// are blends up the base02→base01 gap, the one place Solarized leaves open.
//
// Solarized's body pairings sit near 3:1 — that low contrast IS the design, and D35
// scopes the AA requirement to Default and Colorblind-safe precisely so a lifted
// system can be itself here. Do not "fix" these tones upward; a Solarized that clears
// 4.5:1 everywhere is a different palette wearing the name.
const BASE = {
  b03: "#002b36", b02: "#073642", b01: "#586e75", b00: "#657b83",
  b0: "#839496", b1: "#93a1a1", b2: "#eee8d5", b3: "#fdf6e3",
} as const;
const SOLARIZED_CHROME: PaletteChrome = {
  dark: {
    appBg: "#03303b",
    canvasBg: BASE.b03,       // background
    canvasDot: BASE.b02,      // background highlight — the grid IS Solarized's own step
    surface: BASE.b02,        // background highlight — a card
    surfaceSunken: "#03303b",
    surfaceRaised: "#113d48",
    border: "#234a54", borderStrong: "#34555e", borderSubtle: "#17414c",
    text: BASE.b1,            // emphasized content
    textBright: BASE.b2,
    textDim: BASE.b0,         // primary content
    textMuted: BASE.b00,      // secondary content
  },
  light: {
    appBg: "#e7e2d1", canvasBg: BASE.b2, canvasDot: "#dad4bf",
    surface: BASE.b3,         // background — the paper
    surfaceSunken: "#fffcf0", // (a hair above base3 — the field stays brightest)
    surfaceRaised: BASE.b2,   // background highlight
    border: "#d1d1c4", borderStrong: "#c1c5bb", borderSubtle: "#dedbcc",
    text: BASE.b01,           // emphasized content
    textBright: BASE.b02,
    textDim: BASE.b00,        // primary content
    textMuted: BASE.b0,       // secondary content
  },
};

// Equinox tells type apart by socket SHAPE alone, so its chrome drops the last of
// the color: Default's light ramp carries a blue cast (#eef1f5 / #ccd2da / #1b1e23),
// which is a hue the palette has otherwise renounced. Same contrast as Default,
// fully achromatic.
const EQUINOX_CHROME: PaletteChrome = {
  dark: {
    appBg: "#141414", canvasBg: "#0e0e0e", canvasDot: "#2a2a2a",
    surface: "#1e1e1e", surfaceSunken: "#141414", surfaceRaised: "#262626",
    border: "#2d2d2d", borderStrong: "#3a3a3a", borderSubtle: "#272727",
    text: "#e8e8e8", textBright: "#f4f4f4", textDim: "#a0a0a0", textMuted: "#878787",
  },
  light: {
    appBg: "#f4f4f4", canvasBg: "#ededed", canvasDot: "#d5d5d5",
    surface: "#fbfbfb", surfaceSunken: "#ffffff", surfaceRaised: "#ededed",
    border: "#d0d0d0", borderStrong: "#b6b6b6", borderSubtle: "#e2e2e2",
    text: "#1e1e1e", textBright: "#0f0f0f", textDim: "#616161", textMuted: "#6f6f6f",
  },
};

// Blueprint's two grounds are the two ways the drawing has always been reproduced:
// dark is the cyanotype itself (white lines bitten into prussian blue), light is the
// whiteprint that replaced it (blue linework on cool paper). Both stay COOL end to end
// — that is what keeps Blueprint and Orchard from being the same idea twice.
const BLUEPRINT_CHROME: PaletteChrome = {
  dark: {
    appBg: "#10273f", canvasBg: "#0d2137",
    canvasDot: "#1e3f60",     // the grid line, a clear step off the ground
    surface: "#16304b", surfaceSunken: "#102843", surfaceRaised: "#1e3d5c",
    border: "#274a6d", borderStrong: "#375f85", borderSubtle: "#1f4062",
    text: "#e3ecf5", textBright: "#ffffff", textDim: "#a7bdd4", textMuted: "#8ba4bf",
  },
  light: {
    appBg: "#eff2f6", canvasBg: "#e8edf3", canvasDot: "#c3d2e2",
    surface: "#fbfcfe", surfaceSunken: "#ffffff", surfaceRaised: "#e6ecf3",
    border: "#c2ced8", borderStrong: "#a4b4c6", borderSubtle: "#dae1ea",
    text: "#16283c", textBright: "#0a1826", textDim: "#4e6379", textMuted: "#5d7288",
  },
};

const NO_CHROME: PaletteChrome = { dark: {}, light: {} };
// Default authors nothing: it IS App.css's ramp, and duplicating it here would be two
// copies of one truth. Every other built-in authors a COMPLETE ramp in both modes —
// a partial one derives nothing (see chromeCssVars), so half a ramp is worse than none.
export const BUILTIN_CHROME: Record<PaletteName, PaletteChrome> = {
  "Default": NO_CHROME,
  "Muted": MUTED_CHROME,
  "Colorblind-safe": CVD_CHROME,
  "Solarized": SOLARIZED_CHROME,
  "Equinox": EQUINOX_CHROME,
  "Orchard": ORCHARD_CHROME,
  "Blueprint": BLUEPRINT_CHROME,
};

// ── Chrome derivation ─────────────────────────────────────────────────────────
// The neutral tokens App.css spells as literals rather than var() chains, rebuilt
// from the authored ramp. Every one is a mix between two ramp colors at a fixed
// step, so a palette moves 13 values and the whole workbench follows. Listed
// separately because appTheme must CLEAR them, not just skip them, when a palette
// authors no ramp.
//
// The mix steps are calibrated by running the DEFAULT ramp through them and comparing
// against App.css's own hand-tuned literals — a step that reproduces those within a
// shade or two also behaves on a ramp nobody has eyeballed. Retune a step by redoing
// that comparison, not by nudging until one palette looks right.
export const DERIVED_CHROME_VARS = [
  "--panel-bg", "--overlay-bg", "--overlay-border", "--btn-hover",
  "--gauge-track", "--cable-selected", "--wordmark-color",
  "--shadow-card", "--shadow-pop", "--overlay-shadow",
] as const;

/** Linear sRGB-space blend: t=0 is `a`, t=1 is `b`. */
function mixHex(a: string, b: string, t: number): string {
  const x = parseHex(a), y = parseHex(b);
  if (!x || !y) return a;
  const to = (i: number) => Math.round(x[i] + (y[i] - x[i]) * t).toString(16).padStart(2, "0");
  return `#${to(0)}${to(1)}${to(2)}`;
}

/**
 * The full var→value map an authored ramp produces: the 13 tokens themselves plus
 * the derived ones. Empty for an unauthored ramp, which is how appTheme knows to
 * clear every chrome var and let App.css answer.
 */
export function chromeCssVars(ramp: ChromeRamp, mode: "dark" | "light"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { var: name, key } of CHROME_VARS) {
    const v = ramp[key];
    if (isHex(v)) out[name] = v;
  }
  const { surface, surfaceSunken, borderStrong, text, textBright, textMuted } = ramp;
  if (!isHex(surface) || !isHex(text)) return out; // a partial ramp derives nothing
  // Panels and floating overlays are the surface at near-opacity — the overlay reads
  // above a busy graph, so it sits a step more opaque than a panel.
  out["--panel-bg"] = hexToRgba(surface, 0.92);
  out["--overlay-bg"] = hexToRgba(surface, 0.97);
  // Overlay chrome is defined by its border rather than floated by a big shadow, so
  // its edge steps past --border-strong toward the ink.
  if (isHex(borderStrong)) out["--overlay-border"] = mixHex(borderStrong, text, 0.08);
  // A button's hover lift is its own sunken fill nudged toward the ink — the same
  // step in both modes, since "toward the ink" already flips direction with the theme.
  if (isHex(surfaceSunken)) out["--btn-hover"] = mixHex(surfaceSunken, text, 0.08);
  // The gauge's unfilled arc must clear the card body: a step stronger than a border,
  // short of a muted label.
  if (isHex(borderStrong) && isHex(textMuted)) out["--gauge-track"] = mixHex(borderStrong, textMuted, 0.35);
  // The selected cable takes the ink's contrast pole so it pops off the graph.
  out["--cable-selected"] = mode === "dark" ? (isHex(textBright) ? textBright : text) : text;
  // Dark mode tints the wordmark with the live accent (App.css) — leave that alone;
  // light mode's dark neutral becomes the ramp's ink.
  if (mode === "light") {
    out["--wordmark-color"] = text;
    // Shadows tint from the ink rather than a fixed blue-black, so a warm ramp casts
    // a warm shadow. Dark mode keeps App.css's black: on a dark ground the shadow is
    // absence of light, not a hue.
    out["--shadow-card"] = `0 1px 2px ${hexToRgba(text, 0.1)}`;
    out["--shadow-pop"] = `0 4px 14px ${hexToRgba(text, 0.12)}`;
    out["--overlay-shadow"] = `0 4px 14px ${hexToRgba(text, 0.16)}, 0 1px 4px ${hexToRgba(text, 0.1)}`;
  }
  return out;
}

// ── Active palette state ──────────────────────────────────────────────────────
// Effective = BUILTIN[docBase ?? appBase] + the open doc's per-slot overrides, so
// a doc pin wins over the persisted app choice and never mutates it. Only the APP
// base may be "Custom" (a user-authored map); doc/report bases are built-in names.
export type PaletteChoice = PaletteName | "Custom";

const LS_KEY = "solenoid.palette";
const LS_CUSTOM_KEY = "solenoid.palette.custom";
const LS_CUSTOM_CHROME_KEY = "solenoid.palette.custom.chrome";
let _appBase: PaletteChoice = "Default";
let _customMap: Record<PaletteSlot, string> = { ...PALETTE };
// The custom palette's chrome is always COMPLETE (seeded from DEFAULT_CHROME), unlike
// a built-in's, which declares only what it means to override. So picking Custom always
// pins a ramp — one that starts pixel-identical to App.css's, and that the editor can
// show in a well.
let _customChrome: PaletteChrome = { dark: { ...DEFAULT_CHROME.dark }, light: { ...DEFAULT_CHROME.light } };
let _docBase: PaletteName | null = null;
let _docOverrides: Partial<Record<PaletteSlot, string>> = {};
let _effective: Record<PaletteSlot, string> = { ...PALETTE };
let _effectiveChrome: PaletteChrome = NO_CHROME;

/** The slot→hex map for a base choice (Custom resolves to the user map). */
function baseMapFor(choice: PaletteChoice): Record<PaletteSlot, string> {
  return choice === "Custom" ? _customMap : (BUILTIN_PALETTES[choice] ?? BUILTIN_PALETTES.Default);
}

/** The chrome ramp for a base choice — empty when that palette authors none. */
function baseChromeFor(choice: PaletteChoice): PaletteChrome {
  return choice === "Custom" ? _customChrome : (BUILTIN_CHROME[choice] ?? NO_CHROME);
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
  // A doc pin picks the chrome too — the whole point of pinning is that the doc looks
  // the same wherever it's opened. Doc `overrides` stay slot-only.
  _effectiveChrome = _docBase ? (BUILTIN_CHROME[_docBase] ?? NO_CHROME) : baseChromeFor(_appBase);
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
    localStorage.setItem(LS_CUSTOM_CHROME_KEY, JSON.stringify(_customChrome));
  } catch { /* private mode / quota */ }
}

/** A complete ramp: `base` with every valid hex in `patch` laid over it. */
function mergeChrome(base: ChromeRamp, patch: ChromeRamp | undefined): ChromeRamp {
  const out: ChromeRamp = { ...base };
  for (const key of CHROME_KEYS) {
    if (isHex(patch?.[key])) out[key] = patch[key];
  }
  return out;
}

/** The custom palette's ramp when seeded from a template — the neutral ramps under
 *  whatever that template authors, so a groundless template lands back on neutral. */
function chromeFromTemplate(name: PaletteName): PaletteChrome {
  const t = BUILTIN_CHROME[name] ?? NO_CHROME;
  return { dark: mergeChrome(DEFAULT_CHROME.dark, t.dark), light: mergeChrome(DEFAULT_CHROME.light, t.light) };
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
  /** The active palette's chrome ramp — empty when it authors none, in which case
   *  appTheme clears the vars and App.css's neutral ramps answer. */
  chrome: (): PaletteChrome => ({ dark: { ..._effectiveChrome.dark }, light: { ..._effectiveChrome.light } }),
  /** The user's editable custom palette (F-1) — a full slot→hex map. */
  customMap: (): Record<PaletteSlot, string> => ({ ..._customMap }),
  /** The custom palette's chrome ramp — always complete (see _customChrome). */
  customChrome: (): PaletteChrome => ({ dark: { ..._customChrome.dark }, light: { ..._customChrome.light } }),
  /** Edit one slot of the custom palette; retints live when Custom is the active base. */
  setCustomSlot(slot: PaletteSlot, hex: string) {
    if (!isPaletteSlot(slot) || !isHex(hex) || _customMap[slot] === hex) return;
    _customMap = { ..._customMap, [slot]: hex };
    afterCustomEdit();
  },
  /** Seed the custom palette from a built-in template (the editor's "Load template").
   *  A template that authors no chrome seeds the neutral ramps, so loading it CLEARS a
   *  previously-authored custom chrome rather than leaving the old one behind. */
  loadCustomTemplate(name: PaletteName) {
    if (!(name in BUILTIN_PALETTES)) return;
    _customMap = { ...BUILTIN_PALETTES[name] };
    _customChrome = chromeFromTemplate(name);
    afterCustomEdit();
  },
  /** Commit a whole custom map at once (the editor's Save — draft edits apply here
   *  in one go, so the app retints once instead of live on every drag tick). */
  setCustomMap(map: Record<PaletteSlot, string>, chrome?: PaletteChrome) {
    const next: Record<PaletteSlot, string> = { ..._customMap };
    for (const slot of COLOR_PALETTE) {
      if (isHex(map[slot])) next[slot] = map[slot];
    }
    _customMap = next;
    if (chrome) {
      _customChrome = {
        dark: mergeChrome(_customChrome.dark, chrome.dark),
        light: mergeChrome(_customChrome.light, chrome.light),
      };
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
    const raw = localStorage.getItem(LS_CUSTOM_CHROME_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PaletteChrome>;
      _customChrome = {
        dark: mergeChrome(DEFAULT_CHROME.dark, parsed?.dark),
        light: mergeChrome(DEFAULT_CHROME.light, parsed?.light),
      };
    }
  } catch { /* ignore malformed custom chrome */ }
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
