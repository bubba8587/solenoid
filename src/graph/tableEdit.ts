// [[C28]] literalsIffEditable
// The structural edits of the table editors: rows and columns inserted or deleted anywhere (table-popup § The grid).

/** `items` placed before index `at`. */
export function insertAt<T>(arr: readonly T[], at: number, items: readonly T[]): T[] {
  const i = Math.max(0, Math.min(at, arr.length));
  return [...arr.slice(0, i), ...items, ...arr.slice(i)];
}

/** `arr` without the indices in `drop`. */
export function removeAt<T>(arr: readonly T[], drop: ReadonlySet<number>): T[] {
  return arr.filter((_, i) => !drop.has(i));
}

/** Where an index lands after `count` items are inserted at `at`. */
export const shiftForInsert = (i: number, at: number, count: number): number => (i >= at ? i + count : i);

/** Where an index lands after `drop` is removed, or null when it was removed. */
export function shiftForRemove(i: number, drop: ReadonlySet<number>): number | null {
  if (drop.has(i)) return null;
  let below = 0;
  for (const d of drop) if (d < i) below++;
  return i - below;
}

/** A sparse per-column record (the footer statistic) carried through an insert or a removal. */
export function remapKeys<V>(rec: Readonly<Record<number, V>>, move: (i: number) => number | null): Record<number, V> {
  const out: Record<number, V> = {};
  for (const [k, v] of Object.entries(rec)) {
    const to = move(Number(k));
    if (to !== null) out[to] = v;
  }
  return out;
}

/** Every row with `count` blank columns placed before column `at`. */
export function insertGridCols<T>(grid: readonly (readonly T[])[], at: number, count: number, blank: T): T[][] {
  const fill = Array.from({ length: count }, () => blank);
  return grid.map((row) => insertAt(row, at, fill));
}

/** Every row without the columns in `drop`. */
export function removeGridCols<T>(grid: readonly (readonly T[])[], drop: ReadonlySet<number>): T[][] {
  return grid.map((row) => removeAt(row, drop));
}

/** A selection of rows or columns: the indices between an anchor and the last one picked. */
export interface AxisSelection { axis: "row" | "col"; indices: number[]; anchor: number }

/** Picks index `i`, or extends from the anchor to it over `order` (the rows as shown, so a sorted grid selects what it shows). */
export function pickIndex(prev: AxisSelection | null, axis: "row" | "col", i: number, extend: boolean, order: readonly number[]): AxisSelection {
  if (!extend || !prev || prev.axis !== axis) return { axis, indices: [i], anchor: i };
  const a = order.indexOf(prev.anchor), b = order.indexOf(i);
  if (a < 0 || b < 0) return { axis, indices: [i], anchor: i };
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return { axis, indices: order.slice(lo, hi + 1), anchor: prev.anchor };
}
