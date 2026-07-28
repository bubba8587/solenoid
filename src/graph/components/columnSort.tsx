import { useState } from "react";

// ─── Visual-only column sort (the value popups) ─────────────────────────────────
// A view control, NOT a transform: it reorders the RENDERED rows and touches
// nothing else. The underlying grid keeps its order, so Copy / CSV / Save / the
// node's own value are byte-for-byte what they were before you clicked, and the
// graph never recomputes. That is the whole contract — anything that needs a real
// sort has the Sort / Sort Frame verbs, which produce a new value.
//
// Because the data doesn't move, every consumer of a row index must keep using the
// SOURCE index: `sortedOrder` returns source indices in display order, so a render
// maps `order.map((srcRow) => …)` and passes `srcRow` to edits, drafts and the row
// number. An editable grid (the frame/matrix editors) stays correct under a sort
// for exactly that reason — the cell you type into is the row you were looking at.
//
// The sort applies to the rows ON SCREEN. A grid past its visible cap is already
// truncated ("first 1,000" in the header) before it reaches here, so sorting a
// capped view orders that window, not the whole table.

export type SortDir = "asc" | "desc";
/** The active sort keys in PRIORITY order — `[0]` is primary, each later key breaks
 *  the ties the ones before it leave. Empty = unsorted. */
export type ColumnSort = ReadonlyArray<{ col: number; dir: SortDir }>;

/** This column's direction, or null when it isn't part of the sort. */
export function sortDirOf(sort: ColumnSort, col: number): SortDir | null {
  return sort.find((k) => k.col === col)?.dir ?? null;
}

/**
 * The click cycle, as a pure step: what the sort becomes when `col`'s header is
 * clicked. Per column it runs unsorted → asc → desc → unsorted.
 *
 * MULTI-COLUMN, Excel's model: keys accumulate, priority is the order they were
 * ADDED. Sort Category, then Name → Category then Name. Clear Category → just Name.
 * Add Category back and it lands at the END of the list, so now it's Name then
 * Category. A column changing direction keeps its place in the order; only clearing
 * and re-adding moves it. That's the whole rule, and it means the priority you get is
 * the priority you built, in the order you built it.
 */
export function nextSort(sort: ColumnSort, col: number): ColumnSort {
  const i = sort.findIndex((k) => k.col === col);
  if (i < 0) return [...sort, { col, dir: "asc" }];                          // new key, lowest priority
  if (sort[i].dir === "asc") {
    return sort.map((k, j) => (j === i ? { col, dir: "desc" as SortDir } : k)); // keeps its place
  }
  return sort.filter((_, j) => j !== i);                                     // desc → cleared
}

/**
 * Click-cycle state for one grid, over `nextSort` (which owns the cycle rule).
 *
 * `resetKey` identifies WHICH grid is on screen — the popup's state object, a cube's
 * drill level. When it changes the sort drops, because a column index means nothing
 * across two different tables: keeping it would silently sort a new value by whatever
 * sat in slot 2. Reset-on-key-change during render is React's own pattern for this;
 * an effect would render the new grid once in the old grid's order first.
 */
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

/**
 * The sort under a structural column change, described as an old→new index map:
 * `fn` returns a column's new index, or null for a removed column — that key drops
 * and the surviving keys keep their relative priority. Without this, removing a
 * sorted column would leave its key pointing at whichever column slid into the
 * index (a silent sort by the wrong data).
 */
export function remapSort(sort: ColumnSort, fn: (col: number) => number | null): ColumnSort {
  const next: Array<{ col: number; dir: SortDir }> = [];
  for (const k of sort) {
    const col = fn(k.col);
    if (col !== null) next.push({ col, dir: k.dir });
  }
  return next;
}

/** A cell reduced to something comparable. `null` = nothing to sort on (blank, or a
 *  container cell in a cube) — those sink to the bottom in BOTH directions, the way
 *  a spreadsheet keeps blanks last rather than letting them lead a descending sort. */
export type SortKey = string | number | null;

/** Basic alphanumeric reading of a cell: a number (or numeric-looking text, commas
 *  and spaces stripped so a formatted "1,234" still sorts numerically) compares as a
 *  number; everything else compares as text. A nested frame/cube/list has no sensible
 *  scalar reading, so it sorts as blank. */
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
  // Type tier FIRST — all numbers before all text (ascending). Comparing a mixed
  // pair as text while number pairs compare numerically is intransitive (numeric
  // -2 < -1 but textual "-1…" < "-2…"), and an intransitive comparator lets
  // Array.sort emit cycles like -2 after -1. The tier makes the order total.
  const an = typeof a === "number";
  if (an !== (typeof b === "number")) return an ? -1 : 1;
  if (an) return (a as number) - (b as number);
  // Textual: natural-ish text order, so "item2" precedes "item10".
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/**
 * Source row indices in display order. Identity (`0..rowCount-1`) when unsorted, so
 * a caller can map through it unconditionally.
 *
 * Each key is consulted in priority order and the first one that separates two rows
 * decides; rows equal on every key keep their source order (the index tie-break makes
 * that explicit rather than leaning on sort stability). Blanks stay last in both
 * directions — the descending pass reverses the comparison of PRESENT values only.
 */
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

/**
 * The sort STATE — a tiny chevron overlaid on the right edge of a column header, and
 * nothing at all while the column is unsorted. It is an indicator, not a control: the
 * header cell itself is the click target (`sortTriggerProps`), so there is no button
 * here to aim at and no resting glyph on every column.
 *
 * Absolutely positioned, so it never adds to the column's width (the header cell is
 * what sizes a column here), on a translucent pad so it stays legible where it lands
 * on top of a long name.
 */
export function SortIndicator({ dir, onCycle, label }: {
  dir: SortDir | null;
  /** Set on a header whose own content fills the cell — the FRAME editor, where the
   *  name field leaves no reliable margin to tap on a phone. That makes the chevron a
   *  real control: always drawn (a muted double chevron while unsorted, so there is
   *  something to aim at) and clickable in its own right. Everywhere else the header
   *  cell is the target and this stays a passive indicator. */
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

/**
 * Spread onto an interactive control INSIDE a sortable header — the frame editor's
 * column-name field, its type toggle. The header cell itself is the click target, so
 * without this, typing a name or cycling a column type would also re-sort the table
 * under the cursor. Any control added inside a header needs it.
 */
export const stopSortTrigger = { onClick: (e: { stopPropagation: () => void }) => e.stopPropagation() };
