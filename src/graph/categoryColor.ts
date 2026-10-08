// [[B14]] oneDesignSystem

export function categoryColorIndex(values: readonly (string | null | undefined)[]): Map<string, number> {
  const index = new Map<string, number>();
  for (const v of values) {
    if (v === null || v === undefined) continue;
    const key = String(v);
    if (!index.has(key)) index.set(key, index.size);
  }
  return index;
}

const indexBySource = new WeakMap<object, Map<string, number>>();

/** `categoryColorIndex` of a value that never changes in place (a column's values, a table), worked out once per value. */
export function categoryColorIndexOf(source: object, values: () => readonly (string | null | undefined)[]): Map<string, number> {
  let index = indexBySource.get(source);
  if (!index) { index = categoryColorIndex(values()); indexBySource.set(source, index); }
  return index;
}
