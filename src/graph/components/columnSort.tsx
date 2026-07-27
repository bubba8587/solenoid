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
export type ColumnSort = { col: number; dir: SortDir } | null;

/** Click-cycle state for one grid: unsorted → asc → desc → unsorted. Switching to a
 *  different column starts that column at asc.
 *
 *  `resetKey` identifies WHICH grid is on screen — the popup's state object, a cube's
 *  drill level. When it changes the sort drops, because a column index means nothing
 *  across two different tables: keeping it would silently sort a new value by whatever
 *  sat in slot 2. Reset-on-key-change during render is React's own pattern for this;
 *  an effect would render the new grid once in the old grid's order first. */
export function useColumnSort(resetKey?: unknown): {
  sort: ColumnSort;
  cycle: (col: number) => void;
} {
  const [sort, setSort] = useState<ColumnSort>(null);
  const [seenKey, setSeenKey] = useState(resetKey);
  if (resetKey !== seenKey) {
    setSeenKey(resetKey);
    setSort(null);
  }
  return {
    sort,
    cycle: (col) =>
      setSort((s) =>
        s?.col !== col ? { col, dir: "asc" } : s.dir === "asc" ? { col, dir: "desc" } : null,
      ),
  };
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
  if (typeof a === "number" && typeof b === "number") return a - b;
  // Mixed or textual: natural-ish text order, so "item2" precedes "item10".
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/**
 * Source row indices in display order. Identity (`0..rowCount-1`) when unsorted, so
 * a caller can map through it unconditionally.
 *
 * Blanks stay last in both directions — the descending pass reverses the comparison
 * of PRESENT values only. Ties keep source order (the index tie-break makes that
 * explicit rather than leaning on sort stability).
 */
export function sortedOrder(
  rowCount: number,
  sort: ColumnSort,
  keyAt: (row: number, col: number) => SortKey,
): number[] {
  const order = Array.from({ length: rowCount }, (_, i) => i);
  if (!sort) return order;
  const { col, dir } = sort;
  return order.sort((ra, rb) => {
    const a = keyAt(ra, col);
    const b = keyAt(rb, col);
    if (a === null || b === null) {
      if (a === b) return ra - rb;
      return a === null ? 1 : -1; // blanks last regardless of direction
    }
    const c = compareKeys(a, b);
    return c !== 0 ? (dir === "asc" ? c : -c) : ra - rb;
  });
}

/**
 * The sort control: a tiny chevron OVERLAID on the right edge of a column header.
 * Absolutely positioned, so it never adds to the column's width (the header cell is
 * what sizes a column here), on a translucent pad so it stays legible over a long
 * name it may sit on top of. Unsorted shows both chevrons faintly — the affordance;
 * a set direction shows that one chevron alone, in the surface's accent.
 */
export function SortChevron({
  dir,
  onClick,
  label,
}: {
  /** null = this column isn't the sorted one. */
  dir: SortDir | null;
  onClick: () => void;
  /** Column name for the tooltip / accessible name. */
  label: string;
}) {
  const next = dir === null ? "ascending" : dir === "asc" ? "descending" : "unsorted";
  return (
    <button
      type="button"
      className={`table-popup__sort${dir ? " table-popup__sort--on" : ""}`}
      title={`Sort ${label} — ${next}`}
      aria-label={`Sort ${label} ${next}`}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      // The header input (frame editor) sits under this button; don't let a click
      // through to focus it, and don't start a drag on the popup.
      onPointerDown={(e) => e.stopPropagation()}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor"
           strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {dir !== "desc" && <polyline points={dir === "asc" ? "2,6.5 5,3 8,6.5" : "2,4 5,1.5 8,4"} />}
        {dir !== "asc" && <polyline points={dir === "desc" ? "2,3.5 5,7 8,3.5" : "2,6 5,8.5 8,6"} />}
      </svg>
    </button>
  );
}
