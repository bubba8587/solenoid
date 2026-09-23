// [[C62]] paletteAllOrNone
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

/** A hex as HSL: hue in degrees, saturation and lightness 0..1. */
export function hexToHsl(hex: string): [number, number, number] {
  const t = parseHex(hex);
  return t ? rgbToHsl(...t) : [0, 0, 0];
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

const LIGHT_VALUE_DROP = 0.045;
export function themeAccent(hex: string, mode: "dark" | "light"): string {
  if (mode !== "light") return hex;
  const t = parseHex(hex);
  if (!t) return hex;
  const [h, s, v] = rgbToHsv(...t);
  return hsvToHex(h, s, Math.max(0, v - LIGHT_VALUE_DROP));
}

export function darkenAccent(hex: string): string {
  const t = parseHex(hex);
  if (!t) return hex;
  const [h, s, v] = rgbToHsv(...t);
  return hsvToHex(h, s, Math.max(0, v - 0.07));
}

const RING_VALUE_DROP = 0.23;
export function socketRingShade(hex: string): string {
  const t = parseHex(hex);
  if (!t) return hex;
  const [h, s, v] = rgbToHsv(...t);
  return hsvToHex(h, s, Math.max(0, v - RING_VALUE_DROP));
}

// ── Palette slots ────────────────────────────────────────────────────────────
export const PALETTE = {
  gray:      "#8a8f98",
  amber:     "#d9742b",
  blue:      "#3173e0",
  teal:      "#4fc89a",
  purple:    "#c05dd1",
  green:     "#00b862",
  gold:      "#f5b914",
  lime:      "#c8e040",
  pink:      "#de7cb0",
  sky:       "#56b4e9",
  vermilion: "#e0473a",
  violet:    "#7b64ed",
} as const;

export type PaletteSlot = keyof typeof PALETTE;

export const COLOR_PALETTE: PaletteSlot[] = [
  "gold", "green", "amber", "blue", "lime", "purple",
  "gray", "vermilion", "violet", "pink", "sky", "teal",
];

const ARRAY_VALUE_SCALE = 0.85;
export function socketArrayShade(hex: string): string {
  const t = parseHex(hex);
  if (!t) return hex;
  const [h, s, v] = rgbToHsv(...t);
  return hsvToHex(h, s, v * ARRAY_VALUE_SCALE);
}
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
  { var: "--sock-logical",     slot: "purple",    kind: "scalar" },
  { var: "--sock-logicallist", slot: "purple",    kind: "array" },
  { var: "--sock-logicaltable",slot: "purple",    kind: "matrix" },
  { var: "--sock-table",       slot: "gold",      kind: "matrix" },
  { var: "--sock-frame",       slot: "violet",    kind: "scalar" },
  { var: "--sock-cube",        slot: "violet",    kind: "scalar" },
  { var: "--sock-lambda",      slot: "green",     kind: "scalar" },
  { var: "--sock-chart",       slot: "green",     kind: "scalar" },
  { var: "--sock-any",         slot: "gray",      kind: "scalar" },
];

function isPaletteSlot(s: string): s is PaletteSlot {
  return Object.prototype.hasOwnProperty.call(PALETTE, s);
}

const SOCKET_VAR_BY_NAME = new Map(SOCKET_VARS.map((s) => [s.var, s]));

export function socketVarHex(expr: string, mode: "dark" | "light"): string {
  if (expr.startsWith("#")) return expr;
  const m = /--[a-z0-9-]+/i.exec(expr);
  const spec = m ? SOCKET_VAR_BY_NAME.get(m[0]) : undefined;
  if (!spec) return resolveColor("gray");
  const base = themeAccent(resolveColor(spec.slot), mode);
  return spec.kind === "array" ? socketArrayShade(base)
    : spec.kind === "matrix" ? socketMatrixShade(base)
    : base;
}

// ── Built-in palettes ────────────────────────────────────────────────────────
export type PaletteName = "Default" | "Muted" | "Colorblind-safe" | "Solarized" | "Equinox" | "Orchard" | "Blueprint";

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

const OI = {
  orange: "#e69f00", sky: "#56b4e9", green: "#009e73", yellow: "#f0e442",
  blue: "#0072b2", vermilion: "#d55e00", purple: "#cc79a7",
} as const;
const COLORBLIND: Record<PaletteSlot, string> = {
  gray:      "#999999",
  gold:      OI.orange,
  lime:      OI.yellow,
  pink:      OI.purple,
  sky:       OI.sky,
  vermilion: OI.vermilion,
  violet:    OI.blue,
  green:     OI.green,
  amber:     OI.orange,
  blue:      OI.blue,
  teal:      OI.sky,
  purple:    OI.purple,
};

const SOL = {
  yellow: "#b58900", orange: "#cb4b16", red: "#dc322f", magenta: "#d33682",
  violet: "#6c71c4", blue: "#268bd2", cyan: "#2aa198", green: "#859900",
} as const;
const SOLARIZED: Record<PaletteSlot, string> = {
  gray:      "#93a1a1",
  vermilion: SOL.red,
  amber:     SOL.orange,
  gold:      "#d9a521",
  lime:      SOL.green,
  green:     "#5e9e4a",
  teal:      SOL.cyan,
  sky:       "#5fa8d8",
  blue:      SOL.blue,
  violet:    SOL.violet,
  purple:    "#9156a8",
  pink:      SOL.magenta,
};

const EQUINOX_GRAY = "#8a8f98";
const EQUINOX: Record<PaletteSlot, string> = Object.fromEntries(
  COLOR_PALETTE.map((slot) => [slot, EQUINOX_GRAY]),
) as Record<PaletteSlot, string>;

const PEAR = {
  pearFill: "#649117", pearBright: "#b8d532",
  blossomFill: "#d5537f",
  honey: "#9c6f0e", honeyBright: "#d99a17",
  quiet: "#8b8269", danger: "#bb4029",
} as const;
const ORCHARD: Record<PaletteSlot, string> = {
  gold:      PEAR.honeyBright,
  amber:     PEAR.honey,
  lime:      PEAR.pearBright,
  green:     PEAR.pearFill,
  pink:      PEAR.blossomFill,
  vermilion: PEAR.danger,
  gray:      PEAR.quiet,
  teal:      "#4f9080",
  sky:       "#5f9bb5",
  blue:      "#4a739f",
  violet:    "#7a6bab",
  purple:    "#9b5f95",
};

const BLUEPRINT: Record<PaletteSlot, string> = {
  gold:      "#e8b84b",
  amber:     "#e08a4f",
  lime:      "#b9d05a",
  green:     "#5fc08a",
  teal:      "#4fbcb4",
  sky:       "#7fc6e8",
  blue:      "#4f8fd0",
  violet:    "#8a8fe0",
  purple:    "#b18ede",
  pink:      "#e58fa8",
  vermilion: "#e2604f",
  gray:      "#9aa8bd",
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

/** A hand-kept mirror of App.css's two `:root` ramps; keep them in step, since no test can read the stylesheet. */
export const DEFAULT_CHROME: { dark: Record<ChromeKey, string>; light: Record<ChromeKey, string> } = {
  dark: {
    appBg: "#141414", canvasBg: "#0b0b0b", canvasDot: "#2a2a2a",
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

const ORCHARD_CHROME: PaletteChrome = {
  dark: {
    appBg: "#17160c",
    canvasBg: "#111007",
    canvasDot: "#363320",
    surface: "#1f1d12",
    surfaceSunken: "#17160c",
    surfaceRaised: "#2a2718",
    border: "#363320",
    borderStrong: "#4c472c",
    borderSubtle: "#2b2818",
    text: "#f0ead8",
    textBright: "#fdf8ea",
    textDim: "#aaa287",
    textMuted: "#857d63",
  },
  light: {
    appBg: "#ede7d7",
    canvasBg: "#f4efe3",
    canvasDot: "#e2dac6",
    surface: "#fffdf7",
    surfaceSunken: "#ffffff",
    surfaceRaised: "#ede7d7",
    border: "#cdc3a7",
    borderStrong: "#b8ab87",
    borderSubtle: "#e2dac6",
    text: "#2b2517",
    textBright: "#191308",
    textDim: "#6d6450",
    textMuted: "#8b8269",
  },
};

const MUTED_CHROME: PaletteChrome = {
  dark: {
    appBg: "#1b1c20", canvasBg: "#131417", canvasDot: "#303338",
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

const CVD_CHROME: PaletteChrome = {
  dark: {
    appBg: "#131313", canvasBg: "#080808", canvasDot: "#2e2e2e",
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

// Solarized's near-3:1 body contrast is its identity: do not raise these tones ([[C62]] paletteAllOrNone).
const BASE = {
  b03: "#002b36", b02: "#073642", b01: "#586e75", b00: "#657b83",
  b0: "#839496", b1: "#93a1a1", b2: "#eee8d5", b3: "#fdf6e3",
} as const;
const SOLARIZED_CHROME: PaletteChrome = {
  dark: {
    appBg: "#03303b",
    canvasBg: BASE.b03,
    canvasDot: BASE.b02,
    surface: BASE.b02,
    surfaceSunken: "#03303b",
    surfaceRaised: "#113d48",
    border: "#234a54", borderStrong: "#34555e", borderSubtle: "#17414c",
    text: BASE.b1,
    textBright: BASE.b2,
    textDim: BASE.b0,
    textMuted: BASE.b00,
  },
  light: {
    appBg: "#e7e2d1", canvasBg: BASE.b2, canvasDot: "#dad4bf",
    surface: BASE.b3,
    surfaceSunken: "#fffcf0",
    surfaceRaised: BASE.b2,
    border: "#d1d1c4", borderStrong: "#c1c5bb", borderSubtle: "#dedbcc",
    text: BASE.b01,
    textBright: BASE.b02,
    textDim: BASE.b00,
    textMuted: BASE.b0,
  },
};

const EQUINOX_CHROME: PaletteChrome = {
  dark: {
    appBg: "#141414", canvasBg: "#0b0b0b", canvasDot: "#2a2a2a",
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

const BLUEPRINT_CHROME: PaletteChrome = {
  dark: {
    appBg: "#10273f", canvasBg: "#0a1e34",
    canvasDot: "#1e3f60",
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
export const BUILTIN_CHROME: Record<PaletteName, PaletteChrome> = {
  "Default": NO_CHROME,
  "Muted": MUTED_CHROME,
  "Colorblind-safe": CVD_CHROME,
  "Solarized": SOLARIZED_CHROME,
  "Equinox": EQUINOX_CHROME,
  "Orchard": ORCHARD_CHROME,
  "Blueprint": BLUEPRINT_CHROME,
};

// ── Accent-adaptive chrome ──────────────────────────────────────────────────────
export const CHROME_HOME: Partial<Record<PaletteName, PaletteSlot>> = {
  Orchard: "green",
  Blueprint: "blue",
};

/** WCAG relative luminance, 0..1. */
function relLum(hex: string): number {
  const t = parseHex(hex);
  if (!t) return 0;
  const lin = t.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

/** Hex → OKLCh [L, C, h°]; gray inputs give C≈0 with a meaningless hue. */
export function hexToOklch(hex: string): [number, number, number] {
  const t = parseHex(hex);
  if (!t) return [0, 0, 0];
  const [r, g, b] = t.map((c) => srgbToLinear(c / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), (Math.atan2(B, A) * 180) / Math.PI];
}

/** OKLCh → linear-sRGB triple, unclamped (callers gamut-check). */
function oklchToLinear(L: number, C: number, h: number): [number, number, number] {
  const A = C * Math.cos((h * Math.PI) / 180);
  const B = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

function oklchToHex(L: number, C: number, h: number): string {
  let rgb = oklchToLinear(L, C, h);
  if (rgb.some((c) => c < -1e-4 || c > 1 + 1e-4)) {
    let lo = 0, hi = C;
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      const cand = oklchToLinear(L, mid, h);
      if (cand.some((c) => c < -1e-4 || c > 1 + 1e-4)) hi = mid; else lo = mid;
    }
    rgb = oklchToLinear(L, lo, h);
  }
  const to = (c: number) => Math.round(Math.min(1, Math.max(0, linearToSrgb(c))) * 255).toString(16).padStart(2, "0");
  return `#${rgb.map(to).join("")}`;
}

const ADAPT_MIN_CHROMA = 0.05;

function rotateHueKeepLum(hex: string, delta: number): string {
  const [, C, h] = hexToOklch(hex);
  const target = relLum(hex);
  let lo = 0, hi = 1;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (relLum(oklchToHex(mid, C, h + delta)) < target) lo = mid; else hi = mid;
  }
  return oklchToHex((lo + hi) / 2, C, h + delta);
}

export function adaptChrome(ramp: ChromeRamp, homeHex: string, accentHex: string): ChromeRamp {
  if (!parseHex(homeHex) || !parseHex(accentHex)) return ramp;
  const [, accChroma, accHue] = hexToOklch(accentHex);
  if (accChroma < ADAPT_MIN_CHROMA) return ramp;
  const delta = (((accHue - hexToOklch(homeHex)[2]) % 360) + 360) % 360;
  if (delta < 0.5 || delta > 359.5) return ramp;
  const out: ChromeRamp = {};
  for (const key of CHROME_KEYS) {
    const v = ramp[key];
    if (isHex(v)) out[key] = rotateHueKeepLum(v, delta);
  }
  return out;
}

// ── Chrome derivation ─────────────────────────────────────────────────────────
export const DERIVED_CHROME_VARS = [
  "--overlay-border", "--btn-hover",
  "--gauge-track", "--cable-selected", "--wordmark-color",
  "--shadow-card", "--shadow-pop", "--overlay-shadow",
] as const;

/** Per-channel sRGB blend: t=0 is `a`, t=1 is `b`. */
function mixHex(a: string, b: string, t: number): string {
  const x = parseHex(a), y = parseHex(b);
  if (!x || !y) return a;
  const to = (i: number) => Math.round(x[i] + (y[i] - x[i]) * t).toString(16).padStart(2, "0");
  return `#${to(0)}${to(1)}${to(2)}`;
}

export function chromeCssVars(ramp: ChromeRamp, mode: "dark" | "light"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { var: name, key } of CHROME_VARS) {
    const v = ramp[key];
    if (isHex(v)) out[name] = v;
  }
  const { surface, surfaceSunken, borderStrong, text, textBright, textMuted } = ramp;
  if (!isHex(surface) || !isHex(text)) return out;
  if (isHex(borderStrong)) out["--overlay-border"] = mixHex(borderStrong, text, 0.08);
  if (isHex(surfaceSunken)) out["--btn-hover"] = mixHex(surfaceSunken, text, 0.08);
  if (isHex(borderStrong) && isHex(textMuted)) out["--gauge-track"] = mixHex(borderStrong, textMuted, 0.35);
  out["--cable-selected"] = mode === "dark" ? (isHex(textBright) ? textBright : text) : text;
  if (mode === "light") {
    out["--wordmark-color"] = text;
    out["--shadow-card"] = `0 1px 2px ${hexToRgba(text, 0.1)}`;
    out["--shadow-pop"] = `0 4px 14px ${hexToRgba(text, 0.07)}`;
    out["--overlay-shadow"] = `0 4px 14px ${hexToRgba(text, 0.1)}, 0 1px 4px ${hexToRgba(text, 0.06)}`;
  }
  return out;
}

// ── Active palette state ──────────────────────────────────────────────────────
export type PaletteChoice = PaletteName | "Custom";

const LS_KEY = "solenoid.palette";
const LS_CUSTOM_KEY = "solenoid.palette.custom";
const LS_CUSTOM_CHROME_KEY = "solenoid.palette.custom.chrome";
let _appBase: PaletteChoice = "Default";
let _customMap: Record<PaletteSlot, string> = { ...PALETTE };
let _customChrome: PaletteChrome = { dark: { ...DEFAULT_CHROME.dark }, light: { ...DEFAULT_CHROME.light } };
let _docBase: PaletteName | null = null;
let _docOverrides: Partial<Record<PaletteSlot, string>> = {};
let _effective: Record<PaletteSlot, string> = { ...PALETTE };
let _effectiveChrome: PaletteChrome = NO_CHROME;

function baseMapFor(choice: PaletteChoice): Record<PaletteSlot, string> {
  return choice === "Custom" ? _customMap : (BUILTIN_PALETTES[choice] ?? BUILTIN_PALETTES.Default);
}

function baseChromeFor(choice: PaletteChoice): PaletteChrome {
  return choice === "Custom" ? _customChrome : (BUILTIN_CHROME[choice] ?? NO_CHROME);
}

let _reportBase: PaletteName | null = null;
let _reportOverrides: Partial<Record<PaletteSlot, string>> = {};
let _reportEffective: Record<PaletteSlot, string> = { ...PALETTE };

const { notify: notifyPalette, subscribe: subscribePalette, version: paletteVersion } = createNotifier();
const { notify: notifyReportPalette, subscribe: subscribeReportPalette, version: reportPaletteVersion } = createNotifier();

function recompute() {
  const base = _docBase ? (BUILTIN_PALETTES[_docBase] ?? BUILTIN_PALETTES.Default) : baseMapFor(_appBase);
  _effective = { ...base, ..._docOverrides };
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

function mergeChrome(base: ChromeRamp, patch: ChromeRamp | undefined): ChromeRamp {
  const out: ChromeRamp = { ...base };
  for (const key of CHROME_KEYS) {
    if (isHex(patch?.[key])) out[key] = patch[key];
  }
  return out;
}

function chromeFromTemplate(name: PaletteName): PaletteChrome {
  const t = BUILTIN_CHROME[name] ?? NO_CHROME;
  return { dark: mergeChrome(DEFAULT_CHROME.dark, t.dark), light: mergeChrome(DEFAULT_CHROME.light, t.light) };
}

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
  activeBase: (): PaletteChoice => _appBase,
  effectiveBase: (): PaletteChoice => _docBase ?? _appBase,
  setActiveBase(name: PaletteChoice) {
    if ((name !== "Custom" && !(name in BUILTIN_PALETTES)) || name === _appBase) return;
    _appBase = name;
    recompute();
    recomputeReport();
    persist();
    notifyPalette();
    notifyReportPalette();
  },
  chrome: (): PaletteChrome => ({ dark: { ..._effectiveChrome.dark }, light: { ..._effectiveChrome.light } }),
  chromeHomeHex(): string | null {
    const base = _docBase ?? _appBase;
    if (base === "Custom") return null;
    const slot = CHROME_HOME[base];
    return slot ? BUILTIN_PALETTES[base][slot] : null;
  },
  customMap: (): Record<PaletteSlot, string> => ({ ..._customMap }),
  customChrome: (): PaletteChrome => ({ dark: { ..._customChrome.dark }, light: { ..._customChrome.light } }),
  setCustomSlot(slot: PaletteSlot, hex: string) {
    if (!isPaletteSlot(slot) || !isHex(hex) || _customMap[slot] === hex) return;
    _customMap = { ..._customMap, [slot]: hex };
    afterCustomEdit();
  },
  loadCustomTemplate(name: PaletteName) {
    if (!(name in BUILTIN_PALETTES)) return;
    _customMap = { ...BUILTIN_PALETTES[name] };
    _customChrome = chromeFromTemplate(name);
    afterCustomEdit();
  },
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
  setDocPalette(p?: { base?: string; overrides?: Record<string, string> } | null) {
    _docBase = p?.base && p.base in BUILTIN_PALETTES ? (p.base as PaletteName) : null;
    _docOverrides = {};
    if (p?.overrides) {
      for (const [k, v] of Object.entries(p.overrides)) {
        if (isPaletteSlot(k) && isHex(v)) _docOverrides[k] = v;
      }
    }
    recompute();
    recomputeReport();
    notifyPalette();
    notifyReportPalette();
  },
  docPalette(): { base?: PaletteName; overrides?: Record<string, string> } | undefined {
    const hasOverrides = Object.keys(_docOverrides).length > 0;
    if (!_docBase && !hasOverrides) return undefined;
    const out: { base?: PaletteName; overrides?: Record<string, string> } = {};
    if (_docBase) out.base = _docBase;
    if (hasOverrides) out.overrides = { ..._docOverrides };
    return out;
  },
};

export const reportPaletteStore = {
  subscribe: subscribeReportPalette,
  version: reportPaletteVersion,
  resolve(slot: string): string {
    return NEUTRAL_HEX[slot] ?? (isPaletteSlot(slot) ? _reportEffective[slot] : undefined) ?? _reportEffective.gray;
  },
  setReportPalette(p?: { base?: string; overrides?: Record<string, string> } | null) {
    _reportBase = p?.base && p.base in BUILTIN_PALETTES ? (p.base as PaletteName) : null;
    _reportOverrides = {};
    if (p?.overrides) {
      for (const [k, v] of Object.entries(p.overrides)) {
        if (isPaletteSlot(k) && isHex(v)) _reportOverrides[k] = v;
      }
    }
    recomputeReport();
    notifyReportPalette();
  },
  reportPalette(): { base?: PaletteName; overrides?: Record<string, string> } | undefined {
    const hasOverrides = Object.keys(_reportOverrides).length > 0;
    if (!_reportBase && !hasOverrides) return undefined;
    const out: { base?: PaletteName; overrides?: Record<string, string> } = {};
    if (_reportBase) out.base = _reportBase;
    if (hasOverrides) out.overrides = { ..._reportOverrides };
    return out;
  },
};

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
  notifyPalette();
}

// ── Neutral shades (the gray swatch's 3-way cycle) ────────────────────────────
export const NEUTRAL_WHITE = "neutral-white";
export const NEUTRAL_DARK = "neutral-dark";
// Null prototype, so a stray stored slot like "constructor" reads as undefined.
export const NEUTRAL_HEX: Record<string, string> = Object.assign(Object.create(null) as Record<string, string>, {
  [NEUTRAL_WHITE]: "#f3f4f6",
  [NEUTRAL_DARK]: "#3a3d42",
});
export const NEUTRAL_CYCLE = [NEUTRAL_WHITE, "gray", NEUTRAL_DARK] as const;
export function isNeutralShade(slot: string): boolean {
  return slot === NEUTRAL_WHITE || slot === NEUTRAL_DARK;
}
export function nextNeutral(current: string | undefined): string {
  const i = NEUTRAL_CYCLE.indexOf(current as (typeof NEUTRAL_CYCLE)[number]);
  return i === -1 ? "gray" : NEUTRAL_CYCLE[(i + 1) % NEUTRAL_CYCLE.length];
}

// ── Sequential height ramp (Surface / Contour / Vector Field) ────────────────
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
export function heightRampColor(t: number): [number, number, number] {
  const stops = rampStops();
  const u = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(u));
  const f = u - i, a = stops[i], b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

// Total on purpose: a stray slot falls back to gray rather than crashing a render.
export function resolveColor(slot: string): string {
  return NEUTRAL_HEX[slot] ?? (isPaletteSlot(slot) ? _effective[slot] : undefined) ?? _effective.gray;
}
