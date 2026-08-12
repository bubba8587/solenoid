// Tiny color helpers for the Pixi renderer — luminance + a readable-text pick,
// so card text contrasts its background in BOTH themes (the hardcoded white text
// vanished on the light theme's white card body). Pure → unit-testable.

export function channels(n: number): { r: number; g: number; b: number } {
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Perceived luminance 0..1 (Rec. 709 weights). */
export function perceivedLuminance(n: number): number {
  const { r, g, b } = channels(n);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export function isLight(n: number): boolean {
  return perceivedLuminance(n) > 0.55;
}

/** A readable near-black / near-white text color for a given background. */
export function pickTextColor(bg: number): number {
  return isLight(bg) ? 0x1b1f27 : 0xf3f5f8;
}

/** Linear blend a→b by t (0..1). */
export function mix(a: number, b: number, t: number): number {
  const ca = channels(a), cb = channels(b);
  const m = (x: number, y: number) => Math.round(x + (y - x) * t);
  return (m(ca.r, cb.r) << 16) | (m(ca.g, cb.g) << 8) | m(ca.b, cb.b);
}

/** A subtle "inset box" shade for the value area — nudges the body toward its
 *  contrast color by a small amount so the value reads as a field, not flat. */
export function insetShade(bg: number): number {
  const t = pickTextColor(bg);
  const a = channels(bg), b = channels(t);
  const mix = (x: number, y: number) => Math.round(x + (y - x) * 0.1);
  return (mix(a.r, b.r) << 16) | (mix(a.g, b.g) << 8) | mix(a.b, b.b);
}
