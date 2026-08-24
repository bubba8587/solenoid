# B6 — Table popup: per-column summary footer + column profile

**Goal.** The frame Table popup gets (1) a sticky bottom summary row per column —
count / sum / avg / min / max for number columns, count + distinct for the rest — and
(2) a per-column profile readout: valid / error / empty counts as a slim three-segment
bar plus distinct (and min / max / mean for numbers). Computed over the WHOLE dataset,
never the visible 1,000-row slice. Read-only display; nothing edits the frame.

**Read first.** `DESIGN.md` §Quiet Accent Rule (~150-160), §Status colors (~144-148),
§Accent-Mix Ladder (~173-180), §Typography (~190-196); `docs/code-comments.md`.
UI strings: no sentences — single muted words (`sum`, `avg`, `distinct`).

**Backlog line to delete when done:** `docs/backlog.md` B6.

## Where it is

- `src/graph/components/TablePopup.tsx` (1051 lines, one component at `:127`).
  - Data: `state.data: Cell[][]` (`Cell = number|string|boolean|null|SolError`,
    `src/graph/tablePopupStore.ts:9`), `state.columnTypes` (`:37`), `isFramePopup =
    !!state.columnTypes` (`:246`), `colTypeAt(c)` (`:218`).
  - Read-only frame popup: typed cells are `state.data[r][c]`. Editable popup: `grid`
    is TEXT; typed values come from `buildFrameColumns()` (`:456-479`). Computed
    columns: `(liveComputed ?? state.computedCells)?.[r]?.[c]` (`:828`).
  - Sort: `sortOrder` over the whole dataset (`:360-367`); `visibleOrder` slice for
    render only. Summary reads ALL rows, so it ignores both.
  - Precedent for an extra band inside the table: the format row, an extra `<tbody
    className="table-popup__fmtbody">` at `:747-792` (`th.table-popup__corner` +
    one `td.table-popup__fmtcell` per column). Mirror it as a `<tfoot>`.
  - `<thead>` `:633-746`; main `<tbody>` `:793-871`; toolbar footer `:980-1048`.
- CSS: `src/graph/components/TablePopup.css` — `__fmtcell` (`:302`, sunken bg +
  `border-bottom: 1px solid var(--border-strong)`), `thead th` sticky (`:41`,
  z-index 2), `__fmtbody th.__corner` sticky-left z-index 3 (`:92`). No `tfoot` rule
  exists yet.
- Aggregation kernels (rete-free, safe in a component):
  `forAggregate(values)` → `{error}|{nums}` at `src/graph/valueKinds.ts:155-168`;
  `aggregate(op, nums)` at `src/graph/nodes/statsOps.ts:26` (ops `:11-14`).
- Profile precedent: `describeFrame` at `src/graph/frameVerbs.ts:1810-1852` — its
  per-column body (present / blank / distinct-key encoding / number stats) is what the
  popup needs, but it takes a `FrameValue` the popup never has.
- `isSolError` `src/graph/errorValue.ts:88`; `isMissing` `src/graph/valueKinds.ts:5-9`.
- `CubePopup.tsx` shares the CSS only (hand-rolled grid, `:183-215`). OUT of scope.

## Steps

1. **Factor the kernel.** In `frameVerbs.ts`, extract the per-column body of
   `describeFrame` into `export function describeColumn(values: readonly unknown[],
   type: ColumnType | undefined): ColumnProfile` returning `{ count, blank, error,
   distinct, mean?, std?, min?, q25?, median?, q75?, max? }` (numbers only for number
   columns). `describeFrame` calls it — output byte-identical (run
   `npx vitest run src/graph/frameVerbs` and any `describe` corpus test before/after).
   Errors: `describeFrame` counts errors as present; keep that, and ADD `error` as its
   own count (present = valid + error). Add `describeColumn` unit tests beside the
   existing `describeFrame` tests (blank / error / distinct / number stats / a string
   column gets no mean).
2. **Summary values in the popup.** A plain function (not a hook — it sits below the
   early return at `:211`) `columnSummaries()` that builds per-column typed value arrays:
   read-only → `state.data` columns; editable → `buildFrameColumns()`; computed →
   the computed cells. Per column call `describeColumn`; for number columns also
   `aggregate("sum", nums)`. Memoize only if the popup visibly lags on a 50k-row frame
   (measure with `console.time` once, then remove it).
3. **Markup.** A `<tfoot className="table-popup__sumfoot">` after the main tbody with
   two rows:
   - profile row: `th.table-popup__corner` + per column a `td.table-popup__profcell`
     holding a 3-segment bar (`div.table-popup__profbar` with three spans sized by
     valid/error/empty share; colors: valid = `var(--text-dim)`-mixed neutral, error =
     Danger Red, empty = transparent with a hairline) and the text `n distinct`.
   - summary row: `td.table-popup__sumcell` with, for number columns, a mono stack
     `sum · avg · min · max` (label = muted 11px word, value = mono, 4 short lines);
     for others `count`. Skip the whole tfoot when `!isFramePopup`.
   - Frame popups only; the `vertical` list layout gets nothing.
4. **CSS.** `tfoot td/th { position: sticky; bottom: 0; z-index: 2 }`, corner sticky-left
   `z-index: 3` (copy the `__fmtbody` pattern), sunken bg, `border-top: 1px solid
   var(--border-strong)`. No accent color; error segment uses the status red token only.
5. **Sort/edit interplay.** Confirm: sorting does not change the summary; editing a cell
   in the editable popup updates it on commit (it recomputes from `grid` on render —
   verify it does not thrash typing: it must not run on every keystroke of the draft;
   if the popup re-renders per keystroke already, that is existing behavior — note
   it, do not fix).

## Tests

- `describeColumn` unit tests (step 1).
- No component render tests (vitest env is `node`). Logic only.

## Author eyeball list (put in the final message)

Open any frame popup (e.g. the Personal Finance seed): footer stays pinned while
scrolling; sort a column, footer unchanged; a column with an error cell shows the red
segment; the editable Table Input popup updates the footer after Enter.

## Done when

- `tsc` + full vitest green; digest line; B6 backlog line deleted; this file deleted.
