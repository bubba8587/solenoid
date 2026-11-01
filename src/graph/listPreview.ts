// [[C120]] linearWork, [[C130]] rustCore
// A card's box draws a big list as a chip and its first rows, so a list a card body on the core made isn't taken whole
// to draw it: a read made inside `previewed` (the standard boxes', `standardNode.tsx`) gets the first rows the core
// keeps for the box, tagged with the list's length and how to take the whole of it; any other read gets the whole list.
// The chip counts by `listLength`; the popup, a copy and an inline list take `fullList` (graph-core.md § Direct calls).

let depth = 0;
const previews = new WeakMap<object, { total: number; load: () => unknown; whole?: unknown[] }>();

/** `read()`, its reads of a card's shown fields answering a big list by its first rows. */
export function previewed<T>(read: () => T): T {
  depth++;
  try { return read(); } finally { depth--; }
}

export function isPreviewing(): boolean {
  return depth > 0;
}

/** `rows` are the first of a `total`-item list that `load` reads whole. */
export function markPreview(rows: object, total: number, load: () => unknown): void {
  if (!previews.has(rows)) previews.set(rows, { total, load });
}

/** A list's length, a preview's whole list's. */
export function listLength(v: readonly unknown[]): number {
  return previews.get(v)?.total ?? v.length;
}

/** The whole list a preview stands for, read once; any other value as it is. */
export function fullList<T>(v: T): T {
  const p = v !== null && typeof v === "object" ? previews.get(v) : undefined;
  if (!p) return v;
  const whole = (p.whole ??= p.load() as unknown[]);
  return (Array.isArray(whole) ? whole : v) as T;
}
