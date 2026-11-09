// [[C120]] linearWork, [[C130]] rustCore
// A card's box draws a big list or frame as a chip and its first rows, so a read inside `previewed` gets the first
// rows the core keeps and any other read gets the whole (graph-core.md § Direct calls).

let depth = 0;
const previews = new WeakMap<object, { total: number; width?: number; load: () => unknown; whole?: unknown }>();

/** `read()`, its reads of a card's shown fields answering a big list by its first rows. */
export function previewed<T>(read: () => T): T {
  depth++;
  try { return read(); } finally { depth--; }
}

export function isPreviewing(): boolean {
  return depth > 0;
}

/** `rows` are the first of a `total`-item list (a table `width` wide) that `load` reads whole. */
export function markPreview(rows: object, total: number, width: number | undefined, load: () => unknown): void {
  if (!previews.has(rows)) previews.set(rows, { total, width, load });
}

/** A list's length, a preview's whole list's. */
export function listLength(v: readonly unknown[]): number {
  return previews.get(v)?.total ?? v.length;
}

/** A frame's row count, a preview's whole frame's. */
export function frameRows(f: { columns: { values: readonly unknown[] }[] }): number {
  return previews.get(f)?.total ?? f.columns.reduce((m, c) => Math.max(m, c.values.length), 0);
}

/** A table's width, a preview's whole table's. */
export function tableWidth(v: readonly unknown[]): number {
  return previews.get(v)?.width ?? ((v[0] as unknown[] | undefined)?.length ?? 0);
}

/** The whole list or frame a preview stands for, read once; any other value as it is. */
export function fullList<T>(v: T): T {
  const p = v !== null && typeof v === "object" ? previews.get(v) : undefined;
  if (!p) return v;
  const whole = (p.whole ??= p.load());
  return (whole !== null && typeof whole === "object" ? whole : v) as T;
}
