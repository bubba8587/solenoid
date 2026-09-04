// Categorical color assignment for the Chip text style (B2.2): each distinct string value
// gets a palette INDEX by first appearance. Pure and order-deterministic — the same value
// resolves to the same index wherever it sits in `values`, so a chip keeps its color when
// rows are reordered for display. The index maps to the shared chart palette
// (components/chartCore.useSeriesColors, mod its length) at render time; charts color by
// position, this dedupes by category so a column of repeats reads as categories.

/** Distinct string values → first-appearance index (0, 1, 2, …). `null`/`undefined` cells
 *  don't take a slot. A scalar (one value) yields `{value: 0}`. */
export function categoryColorIndex(values: readonly (string | null | undefined)[]): Map<string, number> {
  const index = new Map<string, number>();
  for (const v of values) {
    if (v === null || v === undefined) continue;
    const key = String(v);
    if (!index.has(key)) index.set(key, index.size);
  }
  return index;
}
