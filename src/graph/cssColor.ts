// A canvas can't evaluate `color-mix()` or `var(--…)`, so the renderer computes them here.
// Keep this DOM-free — var() resolution needs getComputedStyle and stays the caller's job.

export interface RGBA { r: number; g: number; b: number; a: number }

const clamp255 = (n: number) => (n < 0 ? 0 : n > 255 ? 255 : n);
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Parse a hex or `rgb()`/`rgba()` color to RGBA (0–255, a 0–1); null for anything else,
 *  which the caller must resolve first. */
export function parseColor(input: string): RGBA | null {
  const s = input.trim();
  if (s.startsWith("#")) return parseHex(s);
  const m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) {
    const parts = m[1].split(/[,/\s]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const r = clamp255(parseFloat(parts[0]));
    const g = clamp255(parseFloat(parts[1]));
    const b = clamp255(parseFloat(parts[2]));
    let a = 1;
    if (parts[3] != null) a = parts[3].endsWith("%") ? clamp01(parseFloat(parts[3]) / 100) : clamp01(parseFloat(parts[3]));
    if (![r, g, b, a].every(Number.isFinite)) return null;
    return { r, g, b, a };
  }
  // Chrome serializes any color-mix() result as `color(srgb …)`, so this MUST parse or
  // header tints and group-tinted borders fall back to a flat body fill.
  const cm = /^color\(\s*srgb\s+([^)]+)\)$/i.exec(s);
  if (cm) {
    const parts = cm[1].split(/[/\s]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const ch = (p: string) => p.endsWith("%") ? parseFloat(p) / 100 : parseFloat(p);
    // ROUND: the serialized floats are truncated, so a bare multiply lands a byte low.
    const r = clamp255(Math.round(ch(parts[0]) * 255));
    const g = clamp255(Math.round(ch(parts[1]) * 255));
    const b = clamp255(Math.round(ch(parts[2]) * 255));
    let a = 1;
    if (parts[3] != null) a = parts[3].endsWith("%") ? clamp01(parseFloat(parts[3]) / 100) : clamp01(parseFloat(parts[3]));
    if (![r, g, b, a].every(Number.isFinite)) return null;
    return { r, g, b, a };
  }
  return null;
}

function parseHex(s: string): RGBA | null {
  let h = s.slice(1);
  if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6 && h.length !== 8) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  if (![r, g, b].every(Number.isFinite)) return null;
  return { r, g, b, a };
}

/** Serialize RGBA back to a canvas-ready `rgba()` string. */
export function toCss(c: RGBA): string {
  const r = Math.round(clamp255(c.r)), g = Math.round(clamp255(c.g)), b = Math.round(clamp255(c.b));
  return `rgba(${r}, ${g}, ${b}, ${clamp01(c.a)})`;
}

/** Mix two colors in sRGB by weight `t` of `b`, matching `color-mix(in srgb, …)`: a
 *  component lerp of the GAMMA-ENCODED channels, not linear-light. */
export function mixSrgb(a: RGBA, b: RGBA, t: number): RGBA {
  const u = clamp01(t);
  const v = 1 - u;
  return {
    r: a.r * v + b.r * u,
    g: a.g * v + b.g * u,
    b: a.b * v + b.b * u,
    a: a.a * v + b.a * u,
  };
}

/** The cable flow tint — `color-mix(in srgb, base P%, #fff)`; white-ish if unparseable. */
export function flowTint(base: string, basePercent: number): string {
  const c = parseColor(base) ?? { r: 200, g: 200, b: 200, a: 1 };
  const white: RGBA = { r: 255, g: 255, b: 255, a: 1 };
  // base P% means weight (1 − P/100) toward white.
  return toCss(mixSrgb(c, white, 1 - clamp01(basePercent / 100)));
}
