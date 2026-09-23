// [[C62]] paletteAllOrNone

export function categoryColorIndex(values: readonly (string | null | undefined)[]): Map<string, number> {
  const index = new Map<string, number>();
  for (const v of values) {
    if (v === null || v === undefined) continue;
    const key = String(v);
    if (!index.has(key)) index.set(key, index.size);
  }
  return index;
}
