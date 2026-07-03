# Bundle 06 — Execution substrate: sketch mode, calc-mode integration, engine scale

**Source:** scope-features #24 (IN), backlog's "engine execution contract" design-session
note, `v1.1-plan.md` WS-E. **Depends on:** bundle 03 (compile/fuse) — sketch mode and the
CSV reader both ride the fused engine.

## #24 — Approximate-first: preview on a sample, exact on demand (IN)

**Exact current state:** `src/graph/calcModeStore.ts` (63 lines) — `export type CalcMode
= "auto" | "manual"` (line 16), only two modes exist today. Persisted to `localStorage`
under `"solenoid.calcMode"` (line 18); `readMode()` (21-24) only recognizes `"manual"`
else defaults `"auto"` — this literal check must be extended for the new mode. API on
the singleton (33-62): `mode()`, `isManual()`, `dirty()`, `subscribe`, `version`
(useSyncExternalStore-compatible), `setMode(m): boolean`, `markDirty()`, `clearDirty()`.

**StatusBar chip (the required footer affordance's exact insertion point):**
`src/graph/StatusBar.tsx` lines 74-123. Gated by `manual = calcModeStore.isManual()`
(78) and `calcDirty = calcModeStore.dirty()` (79), rendered `{manual && (...)}` (105).
Dirty state: `<button className="solenoid-statusbar__calc solenoid-statusbar__calc--dirty"
onClick={() => void requestRecalc()}>Calculate</button>` (107-114); clean state: `<span
className="solenoid-statusbar__calc">Manual</span>` (116-122). `requestRecalc` imported
from `./process` (line 2). CSS: `StatusBar.css:78` (`.solenoid-statusbar__calc`), `:95`
(dirty variant). **Add the sketch-mode chip as a sibling `<span>`/`<button>` right after
this block**, still inside `.solenoid-statusbar`, before the zoom readout at line 124.

**`FrameValue.__totalRows`** (`frame.ts:47-61`) — set ONLY on a head-N preview
(line 55, doc comment: "the TRUE total row count... absent on a full frame"); paired
with `__ref` (line 60). Set in `frameBackend.ts:78` (`if (p.truncated) f.__totalRows =
p.rowCount`). Consumed in `FrameChip.tsx:64,70,87`. **No existing `≈`/approximate-count
badge or sample-UI anywhere** (confirmed via repo-wide grep) — this is brand-new UI; the
exact-count chip above is the closest analog to extend, not replace.

**`FrameBackend` seam** (`frameBackend.ts:117-142`) — no existing sample/row-limit param
beyond `preview(handle, n)` (line 130, head-only, not random sampling — both
`JsFrameBackend.preview`, 200-202, and `PolarsBackend.preview`, 248-250 via
`ipcInvoke("engine_preview", {handle, n})`). `CARD_PREVIEW_ROWS = 100` (line 71) is the
default used by `collectPreview` (86-96). **Sketch mode needs a new backend method (e.g.
`sample(handle, n)`) or a sampling option on `preview`/`apply`** — nothing to reuse here
directly, this is new seam surface.

**Build:**
1. Add a third calc mode to `calcModeStore.ts`'s `CalcMode` union (line 16) and
   `readMode()`'s literal check (21-24): `"sketch"`.
2. Add a `FrameBackend.sample(handle, n)` method (or a sampling flag on `apply`) —
   deterministic sample (e.g. 10k rows) via the Polars backend; JS oracle can just
   `.slice`.
3. Wire sketch mode's verb execution through the sample path while active.
4. **Required footer affordance** (author's explicit condition): add the sketch-mode
   chip in `StatusBar.tsx` right after the existing Calculate-chip block (~line 123),
   showing "≈ approximate" while sketch mode is active.
5. F9 (`requestRecalc`, imported at `StatusBar.tsx:2`) already forces exact recompute —
   reuse it unchanged; sketch mode never intercepts F9.
6. Aggregates must scale up from the sample **visibly** — extend the `__totalRows`
   pattern (frame.ts:55, set at frameBackend.ts:78) so a sketch-mode aggregate result
   carries a `≈` marker + the extrapolated total, never presenting a sample number as if
   exact.

## #23 — Persistent compute cache — DEFERRED, not built here

NOT part of this bundle's build scope. Flag to the author for a fresh IN/OUT before
touching it.

## WS-E — Engine scale niceties (from `v1.1-plan.md`, folded in here)

- **Lazy-plan fusion** — bundle 03's own deliverable (see `verb_group_by` rewrite +
  accumulate-not-collect there); don't build it twice.
- **Direct CSV→Polars reader.** Current JS parse path (to bypass): `src/graph/csv.ts` —
  `parseCsvRows(text, opts)` (line 24, wraps Papa Parse) and `parseCsvLine` (39). Call
  sites doing JS-parse-then-build-frame today: `src/graph/nodes/connection.ts:22`
  (`csvToFrame(text)`, lines 21-26, the CSV File/Web Source connection path, calls
  `frameFromCells`); `src/graph/frame.ts:277` (Table/Frame Input literal editors);
  `src/graph/nodes/matrix.ts:123`. **Build:** a native Rust CSV→Polars reader
  (e.g. a new `engine_read_csv` IPC command) that bypasses `csv.ts`'s Papa Parse + the JS
  type-inference step entirely for the connection-node path — wire it in as an
  alternative to `csvToFrame` for desktop, keeping the JS path for web.
- **Formula engine re-audit + native-math deletion.** Audit is DONE
  (`formulajs-vs-native-audit.md`). Outstanding cleanup: `src/graph/excelFunctions.ts`
  lines 26-30 (comment, not 26-29): *"Still NOT done (the larger, coordinated
  migration): a blanket Formula.js→SolError mapping at the dispatch boundary for the
  LIBRARY half; registering the rest of the 'internal' families; routing the NODES
  through the same seam; and deleting the redundant native math once a 'formulajs'
  family is flipped."* `FAMILY_BACKING` table: lines 84-99 (not 85-98), 14 entries keyed
  by `FuncFamily` (65-79) — `arithmetic`/`scalar-math`/`finance`/`text`→formulajs;
  `rounding`/`combinatorics`/`complex`→verify; `statistics`/`distributions`/
  `finance-iterative`/`datetime`/`lookup`/`matrix`/`units`→internal. **Build:** for each
  `formulajs`-verdict family, route its nodes through the Formula.js seam and delete the
  matching hand-rolled implementation — pure hygiene, no correctness change, safe any
  time, doesn't block on anything else in this bundle.

## Exit criteria

Sketch mode exists as a third `CalcMode` with the footer chip shipped (not optional) in
`StatusBar.tsx`; F9 still forces exact via the unchanged `requestRecalc`; aggregate
results in sketch mode carry a visible `≈` + extrapolated total; a native
`engine_read_csv` path lands for desktop CSV import; the `formulajs`-backed native-math
duplication is deleted per the `FAMILY_BACKING` table. #23 stays untouched pending a
fresh author verdict.
