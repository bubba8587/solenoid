// [[C100]] chartIsAValue: the US Map legend's height, apart from the outlines so a card can size itself without loading them.

/** How many lines the legend wraps onto at `width`: a swatch, a gap and the label at about 5.6 px a character. */
export function legendLines(cats: readonly string[] | undefined, hasRange: boolean, width: number, fscale = 1): number {
  if (!cats || cats.length === 0) return hasRange ? 1 : 0;
  let lines = 1, x = 0;
  for (const c of cats) {
    const w = (Math.max(1, (c || "(blank)").length) * 5.6 + 18) * fscale;
    if (x > 0 && x + w > width) { lines++; x = 0; }
    x += w;
  }
  return lines;
}
