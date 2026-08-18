// Gallery tiling: the masonry placement rule from the CSSWG masonry explainer
// (`definite-first pack` — each item goes into the track with the smallest
// running position; ties take the leftmost), i.e. the Pinterest algorithm.
// Native CSS masonry is still flag-gated in Chromium, so the placement runs
// here; the column plan justifies track width to fill the container instead of
// a fixed track band.

export interface MasonryPlan {
  count: number;
  colWidth: number;
}

export interface MasonryPacked {
  /** Per item: column index and top offset. */
  slots: { col: number; y: number }[];
  /** Height of the tallest packed column (the container height). */
  height: number;
}

/** Column count and justified track width for a container `width`. Tracks aim
 *  at `ideal`, compress no further than `min` before dropping a column, and a
 *  track never exceeds `max` (a lone card must not stretch to a full-width
 *  stack). Never more tracks than `items`, so a short gallery's tracks widen
 *  to fill instead of leaving phantom columns. */
export function planColumns(
  width: number,
  gap: number,
  { ideal, min, max, items }: { ideal: number; min: number; max: number; items: number },
): MasonryPlan {
  if (width <= 0 || items <= 0) return { count: Math.max(1, items > 0 ? 1 : 0), colWidth: ideal };
  let count = Math.max(1, Math.round((width + gap) / (ideal + gap)));
  count = Math.min(count, Math.max(1, items));
  while (count > 1 && (width - (count - 1) * gap) / count < min) count--;
  const colWidth = Math.min(max, (width - (count - 1) * gap) / count);
  return { count, colWidth };
}

/** Pack items (in order) into `count` columns: each into the column whose
 *  running height is smallest, leftmost on ties. */
export function packMasonry(heights: number[], count: number, gap: number): MasonryPacked {
  const cols = Math.max(1, count);
  const running = new Array<number>(cols).fill(0);
  const slots = heights.map((h) => {
    let col = 0;
    for (let c = 1; c < cols; c++) if (running[c] < running[col]) col = c;
    const y = running[col];
    running[col] = y + h + gap;
    return { col, y };
  });
  const height = Math.max(0, ...running.map((r) => (r > 0 ? r - gap : 0)));
  return { slots, height };
}
