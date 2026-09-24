// [[C59]] byteStringOrder (a UI list keeps natural order)
import { useState } from "react";
import { decimalFromText } from "../valueKinds";

// A view control, not a transform: every consumer of a row index keeps using the source index, and `sortedOrder` returns source indices in display order.

export type SortDir = "asc" | "desc";
/** Priority order: `[0]` is primary and each later key breaks the ties before it; empty is unsorted. */
export type ColumnSort = ReadonlyArray<{ col: number; dir: SortDir }>;

export function sortDirOf(sort: ColumnSort, col: number): SortDir | null {
  return sort.find((k) => k.col === col)?.dir ?? null;
}

export function nextSort(sort: ColumnSort, col: number): ColumnSort {
  const i = sort.findIndex((k) => k.col === col);
  if (i < 0) return [...sort, { col, dir: "asc" }];
  if (sort[i].dir === "asc") {
    return sort.map((k, j) => (j === i ? { col, dir: "desc" } : k));
  }
  return sort.filter((_, j) => j !== i);
}

/** When `resetKey` changes the sort drops during render; an effect would first render the new grid in the old grid's order. */
export function useColumnSort(resetKey?: unknown): {
  sort: ColumnSort;
  cycle: (col: number) => void;
  /** Call on any structural column change, so a key can't re-attach to whatever slides into its index. */
  remap: (fn: (col: number) => number | null) => void;
  clear: () => void;
} {
  const [sort, setSort] = useState<ColumnSort>([]);
  const [seenKey, setSeenKey] = useState(resetKey);
  if (resetKey !== seenKey) {
    setSeenKey(resetKey);
    setSort([]);
  }
  return {
    sort,
    cycle: (col) => setSort((s) => nextSort(s, col)),
    remap: (fn) => setSort((s) => remapSort(s, fn)),
    clear: () => setSort([]),
  };
}

/** `fn` returns a column's new index, or null when it was dropped. */
export function remapSort(sort: ColumnSort, fn: (col: number) => number | null): ColumnSort {
  const next: Array<{ col: number; dir: SortDir }> = [];
  for (const k of sort) {
    const col = fn(k.col);
    if (col !== null) next.push({ col, dir: k.dir });
  }
  return next;
}

/** `null` is nothing to sort on, and sinks to the bottom in both directions. */
export type SortKey = string | number | null;

export function sortKeyOf(v: unknown): SortKey {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return null;
    const n = decimalFromText(t);
    return Number.isFinite(n) ? n : t;
  }
  const code = (v as { code?: unknown }).code;
  if (typeof code === "string") return code;
  return null;
}

function compareKeys(a: SortKey, b: SortKey): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  // Type tier first: comparing a mixed pair as text while numeric pairs compare as numbers is intransitive, and Array.sort then emits cycles.
  const an = typeof a === "number";
  if (an !== (typeof b === "number")) return an ? -1 : 1;
  if (an) return a - (b as number);
  // A UI list keeps natural order ([[C59]] byteStringOrder), so "item2" precedes "item10".
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/** Identity when unsorted; rows equal on every key keep source order by an explicit index tie-break, not by sort stability. */
export function sortedOrder(
  rowCount: number,
  sort: ColumnSort,
  keyAt: (row: number, col: number) => SortKey,
): number[] {
  const order = Array.from({ length: rowCount }, (_, i) => i);
  if (sort.length === 0) return order;
  return order.sort((ra, rb) => {
    for (const { col, dir } of sort) {
      const a = keyAt(ra, col);
      const b = keyAt(rb, col);
      if (a === null || b === null) {
        if (a === b) continue;
        return a === null ? 1 : -1;
      }
      const c = compareKeys(a, b);
      if (c !== 0) return dir === "asc" ? c : -c;
    }
    return ra - rb;
  });
}

export function SortButton({ dir, onCycle, label }: {
  dir: SortDir | null;
  onCycle: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      className={`table-popup__sort${dir ? "" : " table-popup__sort--off"}`}
      aria-label={`Sort ${label ?? "column"}`}
      onClick={(e) => { e.stopPropagation(); onCycle(); }}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor"
           strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {dir === null ? (
          <>
            <polyline points="2,4 5,1.5 8,4" />
            <polyline points="2,6 5,8.5 8,6" />
          </>
        ) : (
          <polyline points={dir === "asc" ? "2,6.5 5,3 8,6.5" : "2,3.5 5,7 8,3.5"} />
        )}
      </svg>
    </button>
  );
}
