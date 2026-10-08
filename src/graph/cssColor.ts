// [[B14]] oneDesignSystem

export interface RGBA { r: number; g: number; b: number; a: number }

const clamp255 = (n: number) => (n < 0 ? 0 : n > 255 ? 255 : n);
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

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
  const cm = /^color\(\s*srgb\s+([^)]+)\)$/i.exec(s);
  if (cm) {
    const parts = cm[1].split(/[/\s]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const ch = (p: string) => p.endsWith("%") ? parseFloat(p) / 100 : parseFloat(p);
    // Round: the serialized floats are truncated, so a bare multiply lands a byte low.
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
  if (![r, g, b, a].every(Number.isFinite)) return null;
  return { r, g, b, a };
}
