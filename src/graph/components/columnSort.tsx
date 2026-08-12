import { useState } from "react";

// A view control, NOT a transform: it reorders RENDERED rows only. Because the
// data doesn't move, every consumer of a row index must keep using the SOURCE
// index — `sortedOrder` returns source indices in display order.

export type SortDir = "asc" | "desc";
/** The active sort keys in PRIORITY order — `[0]` is primary, each later key breaks
 *  the ties the ones before it leave. Empty = unsorted. */
export type ColumnSort = ReadonlyArray<{ col: number; dir: SortDir }>;

/** This column's direction, or null when it isn't part of the sort. */
export function sortDirOf(sort: ColumnSort, col: number): SortDir | null {
  return sort.find((k) => k.col === col)?.dir ?? null;
}

/** The click cycle: unsorted → asc → desc → unsorted. MULTI-COLUMN (Excel's
 *  model): priority is the order keys were ADDED, and changing a column's
 *  direction keeps its place. */
export function nextSort(sort: ColumnSort, col: number): ColumnSort {
  const i = sort.findIndex((k) => k.col === col);
  if (i < 0) return [...sort, { col, dir: "asc" }];
  if (sort[i].dir === "asc") {
    return sort.map((k, j) => (j === i ? { col, dir: "desc" as SortDir } : k));
  }
  return sort.filter((_, j) => j !== i);
}

/** Click-cycle state for one grid. `resetKey` identifies WHICH grid is on screen;
 *  when it changes the sort drops, during RENDER — an effect would render the new
 *  grid once in the old grid's order first. */
export function useColumnSort(resetKey?: unknown): {
  sort: ColumnSort;
  cycle: (col: number) => void;
  /** Apply an old→new column-index map (see `remapSort`) — call on any structural
   *  column change so a key can't re-attach to whatever slides into its index. */
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

/** The sort under a structural column change: `fn` returns a column's new index or
 *  null (dropped); surviving keys keep their relative priority. */
export function remapSort(sort: ColumnSort, fn: (col: number) => number | null): ColumnSort {
  const next: Array<{ col: number; dir: SortDir }> = [];
  for (const k of sort) {
    const col = fn(k.col);
    if (col !== null) next.push({ col, dir: k.dir });
  }
  return next;
}

/** A cell reduced to something comparable; `null` = nothing to sort on, and those
 *  sink to the bottom in BOTH directions (a spreadsheet keeps blanks last). */
export type SortKey = string | number | null;

/** Alphanumeric reading of a cell: a number — or numeric-looking text, so a
 *  formatted "1,234" still sorts numerically — else text; a container sorts blank. */
export function sortKeyOf(v: unknown): SortKey {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return null;
    const n = Number(t.replace(/[,\s]/g, ""));
    return Number.isFinite(n) ? n : t;
  }
  // A SolError sorts by its code, so the failures group together.
  const code = (v as { code?: unknown }).code;
  if (typeof code === "string") return code;
  return null; // frame / cube / array cell — nothing scalar to sort on
}

function compareKeys(a: SortKey, b: SortKey): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1; // blanks last
  // Type tier FIRST — all numbers before all text: comparing a mixed pair as text
  // while numeric pairs compare numerically is intransitive, and an intransitive
  // comparator lets Array.sort emit cycles.
  const an = typeof a === "number";
  if (an !== (typeof b === "number")) return an ? -1 : 1;
  if (an) return (a as number) - (b as number);
  // Textual: natural-ish text order, so "item2" precedes "item10".
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/** Source row indices in display order — identity when unsorted, so a caller can
 *  map through it unconditionally. Rows equal on every key keep their source order
 *  by an explicit index tie-break, not by sort stability. */
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
        if (a === b) continue;         // both blank on this key — let the next one decide
        return a === null ? 1 : -1;    // blanks last regardless of direction
      }
      const c = compareKeys(a, b);
      if (c !== 0) return dir === "asc" ? c : -c;
    }
    return ra - rb;
  });
}

/** The sort STATE — an indicator, not a control: the header cell itself is the
 *  click target, and this is absolutely positioned so it adds no column width. */
export function SortIndicator({ dir, onCycle, label }: {
  dir: SortDir | null;
  /** Set on a header whose own content fills the cell (the frame editor, with no
   *  reliable margin to tap): the chevron becomes a real control, always drawn. */
  onCycle?: () => void;
  label?: string;
}) {
  if (!dir && !onCycle) return null;
  const glyph = (
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
  );
  const cls = `table-popup__sort${dir ? "" : " table-popup__sort--off"}`;
  if (!onCycle) return <span className={cls} aria-hidden="true">{glyph}</span>;
  return (
    <button
      type="button"
      className={`${cls} table-popup__sort--btn`}
      aria-label={`Sort ${label ?? "column"}`}
      onClick={(e) => { e.stopPropagation(); onCycle(); }}
    >
      {glyph}
    </button>
  );
}

/** Spread onto ANY interactive control inside a sortable header — the header cell
 *  is the click target, so without it the control also re-sorts the table. */
export const stopSortTrigger = { onClick: (e: { stopPropagation: () => void }) => e.stopPropagation() };
