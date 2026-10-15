// [[C100]] chartIsAValue
// A string's width in the app's own fonts, from their glyph metrics (textWidths.gen.ts): the fonts are bundled, so a
// label's width is fixed by them and needs no canvas, which also holds in tests and off-screen exports.
import { KERN_WEIGHTS, MONO_ADVANCE, SANS_ADVANCE, SANS_KERN, SANS_WEIGHTS, TEXT_CHARS } from "./textWidths.gen";

const N = TEXT_CHARS.length;
const index = new Map([...TEXT_CHARS].map((c, i) => [c, i]));
const kernTables = SANS_KERN.map((flat) => {
  const m = new Map<number, number>();
  for (let k = 0; k < flat.length; k += 2) m.set(flat[k], flat[k + 1]);
  return m;
});
// A character the table lacks (another script, an emoji) takes a lowercase n's advance, about an average letter.
const FALLBACK = index.get("n")!;

/** Where `weight` sits between two of the given weights: the pair's indices and the share of the upper one. */
function between(weights: readonly number[], weight: number): [number, number, number] {
  if (weight <= weights[0]) return [0, 0, 0];
  for (let i = 1; i < weights.length; i++) {
    if (weight <= weights[i]) return [i - 1, i, (weight - weights[i - 1]) / (weights[i] - weights[i - 1])];
  }
  return [weights.length - 1, weights.length - 1, 0];
}

function sansUnits(s: string, weight: number): number {
  const [a, b, t] = between(SANS_WEIGHTS, weight);
  const [ka, kb, kt] = between(KERN_WEIGHTS, weight);
  let units = 0, prev = -1;
  for (const ch of s) {
    let i = index.get(ch) ?? FALLBACK;
    if (SANS_ADVANCE[a][i] < 0) i = FALLBACK;
    units += SANS_ADVANCE[a][i] * (1 - t) + SANS_ADVANCE[b][i] * t;
    if (prev >= 0) units += (kernTables[ka].get(prev * N + i) ?? 0) * (1 - kt) + (kernTables[kb].get(prev * N + i) ?? 0) * kt;
    prev = i;
  }
  return units;
}

export type TextFont = { px: number; weight?: number; mono?: boolean };

/** The width in pixels of `s` set in the app's sans (or mono) at `px` and `weight`. */
export function textWidth(s: string, font: TextFont): number {
  const units = font.mono ? [...s].length * MONO_ADVANCE : sansUnits(s, font.weight ?? 400);
  return (units / 1000) * font.px;
}
