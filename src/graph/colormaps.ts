// [[C96]] chartOptionsAreMatplotlib
// matplotlib's colormaps by their matplotlib names, sampled at even steps and interpolated linearly in RGB.
// `_r` reverses a map, as in matplotlib. The default (no cmap) is the palette's own ramp, which lives in palette.ts.

export type ColormapFamily = "Perceptual" | "Sequential" | "Diverging";

const MAPS: Record<string, { family: ColormapFamily; stops: string[] }> = {
  viridis: { family: "Perceptual", stops: ["#440154", "#482878", "#3e4989", "#31688e", "#26828e", "#1f9e89", "#35b779", "#6ece58", "#b5de2b", "#fde725"] },
  plasma:  { family: "Perceptual", stops: ["#0d0887", "#46039f", "#7201a8", "#9c179e", "#bd3786", "#d8576b", "#ed7953", "#fb9f3a", "#fdca26", "#f0f921"] },
  inferno: { family: "Perceptual", stops: ["#000004", "#1b0c41", "#4a0c6b", "#781c6d", "#a52c60", "#cf4446", "#ed6925", "#fb9b06", "#f7d13d", "#fcffa4"] },
  magma:   { family: "Perceptual", stops: ["#000004", "#180f3d", "#440f76", "#721f81", "#9e2f7f", "#cd4071", "#f1605d", "#fd9668", "#feca8d", "#fcfdbf"] },
  cividis: { family: "Perceptual", stops: ["#00224e", "#123570", "#3b496c", "#575d6d", "#707173", "#8a8779", "#a69d75", "#c4b56c", "#e4cf5b", "#fee838"] },
  turbo:   { family: "Perceptual", stops: ["#30123b", "#4145ab", "#4675ed", "#39a2fc", "#1bcfd4", "#24eca6", "#61fc6c", "#a4fc3b", "#d1e834", "#f3c63a", "#fe9b2d", "#f36315", "#d93806", "#b11901", "#7a0402"] },
  Blues:   { family: "Sequential", stops: ["#f7fbff", "#deebf7", "#c6dbef", "#9ecae1", "#6baed6", "#4292c6", "#2171b5", "#08519c", "#08306b"] },
  Greens:  { family: "Sequential", stops: ["#f7fcf5", "#e5f5e0", "#c7e9c0", "#a1d99b", "#74c476", "#41ab5d", "#238b45", "#006d2c", "#00441b"] },
  Reds:    { family: "Sequential", stops: ["#fff5f0", "#fee0d2", "#fcbba1", "#fc9272", "#fb6a4a", "#ef3b2c", "#cb181d", "#a50f15", "#67000d"] },
  Oranges: { family: "Sequential", stops: ["#fff5eb", "#fee6ce", "#fdd0a2", "#fdae6b", "#fd8d3c", "#f16913", "#d94801", "#a63603", "#7f2704"] },
  Purples: { family: "Sequential", stops: ["#fcfbfd", "#efedf5", "#dadaeb", "#bcbddc", "#9e9ac8", "#807dba", "#6a51a3", "#54278f", "#3f007d"] },
  Greys:   { family: "Sequential", stops: ["#ffffff", "#f0f0f0", "#d9d9d9", "#bdbdbd", "#969696", "#737373", "#525252", "#252525", "#000000"] },
  YlOrRd:  { family: "Sequential", stops: ["#ffffcc", "#ffeda0", "#fed976", "#feb24c", "#fd8d3c", "#fc4e2a", "#e31a1c", "#bd0026", "#800026"] },
  YlGnBu:  { family: "Sequential", stops: ["#ffffd9", "#edf8b1", "#c7e9b4", "#7fcdbb", "#41b6c4", "#1d91c0", "#225ea8", "#253494", "#081d58"] },
  coolwarm: { family: "Diverging", stops: ["#3b4cc0", "#688aef", "#99baff", "#c9d8ef", "#edd1c2", "#f7a789", "#e36a53", "#b40426"] },
  RdBu:    { family: "Diverging", stops: ["#67001f", "#b2182b", "#d6604d", "#f4a582", "#fddbc7", "#f7f7f7", "#d1e5f0", "#92c5de", "#4393c3", "#2166ac", "#053061"] },
  RdYlBu:  { family: "Diverging", stops: ["#a50026", "#d73027", "#f46d43", "#fdae61", "#fee090", "#ffffbf", "#e0f3f8", "#abd9e9", "#74add1", "#4575b4", "#313695"] },
  RdYlGn:  { family: "Diverging", stops: ["#a50026", "#d73027", "#f46d43", "#fdae61", "#fee08b", "#ffffbf", "#d9ef8b", "#a6d96a", "#66bd63", "#1a9850", "#006837"] },
  PiYG:    { family: "Diverging", stops: ["#8e0152", "#c51b7d", "#de77ae", "#f1b6da", "#fde0ef", "#f7f7f7", "#e6f5d0", "#b8e186", "#7fbc41", "#4d9221", "#276419"] },
  BrBG:    { family: "Diverging", stops: ["#543005", "#8c510a", "#bf812d", "#dfc27d", "#f6e8c3", "#f5f5f5", "#c7eae5", "#80cdc1", "#35978f", "#01665e", "#003c30"] },
  Spectral: { family: "Diverging", stops: ["#9e0142", "#d53e4f", "#f46d43", "#fdae61", "#fee08b", "#ffffbf", "#e6f598", "#abdda4", "#66c2a5", "#3288bd", "#5e4fa2"] },
};

const BY_LOWER = new Map(Object.keys(MAPS).map((k) => [k.toLowerCase(), k]));

/** Every map in listing order, each with its reversed twin, for the Chart Builder. */
export const COLORMAP_LIST: readonly { name: string; family: ColormapFamily }[] =
  Object.entries(MAPS).map(([name, m]) => ({ name, family: m.family }));

/** The canonical spelling of a cmap name (`rdbu_R` → `RdBu_r`), or undefined when matplotlib has no such map here. */
export function normalizeCmap(text: string): string | undefined {
  const s = text.trim();
  const reversed = /_r$/i.test(s);
  const base = BY_LOWER.get((reversed ? s.slice(0, -2) : s).toLowerCase());
  return base === undefined ? undefined : reversed ? `${base}_r` : base;
}

const hexRgb = (h: string): [number, number, number] =>
  [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const RGB = new Map(Object.entries(MAPS).map(([k, m]) => [k, m.stops.map(hexRgb)]));

/** The color at `t` (0..1, clamped) on a named map, or null for an unknown name. */
export function colormapRgb(name: string, t: number): [number, number, number] | null {
  const canon = normalizeCmap(name);
  if (!canon) return null;
  const reversed = canon.endsWith("_r");
  const stops = RGB.get(reversed ? canon.slice(0, -2) : canon);
  if (!stops) return null;
  const c = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0.5));
  const u = (reversed ? 1 - c : c) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(u));
  const f = u - i, a = stops[i], b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export interface HeatScale {
  lo: number;
  hi: number;
  center?: number;
  /** A value's place on the colormap, 0..1, clamped. */
  t: (v: number) => number;
}

/** seaborn's heatmap scale: `vmin`/`vmax` pin the ends (else the data's range); `center` puts that value at the
 *  map's midpoint with one color step per unit on both sides, so the ends reach as far as the farther side does. */
export function heatScale(dataLo: number, dataHi: number, o: { vmin?: number; vmax?: number; center?: number }): HeatScale {
  let lo = o.vmin ?? dataLo, hi = o.vmax ?? dataHi;
  if (lo > hi) [lo, hi] = [hi, lo];
  if (o.center !== undefined) {
    const c = o.center;
    const r = Math.max(Math.abs(hi - c), Math.abs(c - lo));
    if (o.vmin === undefined) lo = c - r;
    if (o.vmax === undefined) hi = c + r;
    const half = Math.max(Math.abs(hi - c), Math.abs(c - lo));
    return { lo, hi, center: c, t: (v) => (half > 0 ? Math.max(0, Math.min(1, 0.5 + (v - c) / (2 * half))) : 0.5) };
  }
  const span = hi - lo;
  return { lo, hi, t: (v) => (span > 0 ? Math.max(0, Math.min(1, (v - lo) / span)) : 0.5) };
}
