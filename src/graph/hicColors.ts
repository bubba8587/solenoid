// [[C62]] paletteAllOrNone, [[C42]] htmlInCanvasRenderer

function channels(n: number): { r: number; g: number; b: number } {
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Perceived luminance 0..1 (Rec. 709 weights). */
function perceivedLuminance(n: number): number {
  const { r, g, b } = channels(n);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export function isLight(n: number): boolean {
  return perceivedLuminance(n) > 0.55;
}

export function pickTextColor(bg: number): number {
  return isLight(bg) ? 0x1b1f27 : 0xf3f5f8;
}
