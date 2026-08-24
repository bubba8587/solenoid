# C4 — grids take a plain Z matrix + optional Xs / Ys (bordered format retired)

**Goal (author, 2026-08-24).** Grid Interpolate takes a plain Z table plus optional `Xs` and
`Ys` coordinate lists; when an axis is unwired it is the 1-based index. Nobody builds a
bordered grid by hand any more. The same three inputs go on Surface / Contour (they read
the identical format), so there is ONE convention: coordinates ride beside the matrix,
never inside it. The bordered format is deleted, not kept as a second path.

**Read first.** `docs/value-semantics.md:154-173` (shape rows: an unwired axis is the
index; a WIRED blank axis propagates → empty result); `docs/rules.md` unitGranularity
(matrix carries one unit); `.claude/skills/add-node/SKILL.md` § Persistence (socket
changes on an existing class); `docs/code-comments.md`.

**Backlog:** nothing to delete. Digest line + delete this file when done.

## Where it is

- Grid Interpolate = `InterpolateNode` grid mode, `src/graph/nodes/stats.ts:842-935`:
  sockets in `_rebuildSockets` `:870-877` (`grid` `tableIn("Bordered grid")`, `result`
  `tableOut("Filled grid")`), `dataGrid` `:918-934`, `socketDocs.grid` `:846`. Mode switch
  `components/InterpolateNode.tsx:23` `applyInterpolateMode` (drops cables first).
- Kernel `fillBorderedGrid(table, forecast)` `src/graph/nodes/mathUtils.ts:441-…`: peels
  row 0 / col 0 into `colXs` / `rowYs`, fills the interior `Z`, re-borders on output
  (`out[0][0] = null`). `interpolateLinear` beside it.
- Formula `INTERPOLATE` `src/graph/excelFunctions.ts:1745-1762`: grid mode is dispatched on
  a rank-2 first arg, `(bordered_table [, forecast])`.
- Surface / Contour = `SurfaceNode` `src/graph/nodes/visual.ts:641-700`: `grid`
  `tableIn("Bordered grid")` `:660`, `levels` `:663`; `data()` `:676` calls
  `parseBorderedGrid` `:610-628` (drops rows/cols whose axis coordinate is non-finite);
  payloads `ContourPayload` / `SurfacePayload` (`chartValue.ts:52-58`, and the surface
  one above it) already carry `xs`, `ys`, `z` separately — the bordered form was only ever
  the SOCKET encoding.
- `HISTOGRAM2D` formula `excelFunctions.ts:469`, `:1908` returns `histogram2dGrid`
  (bordered) — `src/graph/nodes/visualOps.ts` `histogram2dGrid`. The Histogram node's 2-D
  mode does NOT use it (it builds the contour payload from `histogram2d` directly).
- Catalog copy naming the format: `nodeCatalog.ts:277` (Surface), `:620` (INTERPOLATE),
  `SURFACE_VIEW_OP_META` `visual.ts:632-635`.
- Tests on the format: `nodes/stats.test.ts` (17 hits), `nodes/visual.test.ts` (7),
  `frameVerbs.test.ts` (3), `nodes/matrixUnitPolicy.test.ts` (2). Seeds: only
  `seedGraphs/null-and-logical.json` (`:532` an Interpolate card; check its mode — if it is
  list mode nothing changes).

## Design (decided)

- Shared helper `gridAxes(z: unknown, xs: unknown, ys: unknown): { xs: number[]; ys:
  number[]; z: (number | null)[][] } | SolError | null` in `nodes/mathUtils.ts`: `z` →
  rectangular `(number|null)[][]` (per-cell error / non-finite → null, today's rule); `xs`
  UNWIRED (`undefined`) → `1..cols`; WIRED blank (`null`) → return `null` (shape propagates);
  a list → must have exactly `cols` finite numbers, else `#SHAPE!` "Xs has N values for M
  columns"; same for `ys` vs rows. Non-finite entries in a wired axis are `#VALUE!` (the
  old parse silently dropped those lines — a real error now, one loud message).
- `fillGrid(z, xs, ys, forecast)` replaces `fillBorderedGrid`: same algorithm over
  `colXs`/`rowYs`/`Z` (it already separates them internally at `:449-452`), returns the
  plain filled `Z`. Delete `fillBorderedGrid` and `parseBorderedGrid`; nothing else may
  re-introduce a bordered reader.
- `InterpolateNode` grid mode sockets: `z` `tableIn("Table")`, `xs` `numListIn("Xs")`, `ys`
  `numListIn("Ys")`; output `tableOut("Filled")`. `socketDocs`: `xs` "One coordinate per
  column; unwired means 1, 2, 3…", `ys` likewise per row. Unit carry unchanged
  (`carryMatrixUnit` on `z`).
- `SurfaceNode`: `z` `tableIn("Table")`, `xs`, `ys` same; `data()` → `gridAxes` → payload.
  Row/col order is the list order (no sorting — today's behaviour).
- Formula `INTERPOLATE` grid arm becomes `INTERPOLATE(table, xs?, ys?, forecast?)` where
  `xs`/`ys` may be omitted (index) — but the list arm is `(ys, xs, new_xs)` on the same
  name, so keep the rank dispatch: a MATRIX first arg → grid arm, then `xs`, `ys`,
  `forecast` positional; `INTERPOLATE(table)` and `INTERPOLATE(table, , , FALSE)` both
  legal. Update `formulaSignatures.ts` hint and the divergence note if one exists.
- `HISTOGRAM2D` returns the plain count matrix (no border); its edges are dropped from the
  formula surface — the node's 2-D mode is the figure, and a user who wants edges wires the
  node. Note the change in `docs/python-r-gap.md` where the 2-D histogram is recorded.
- Copy: catalog `:277` and `:620` and the two `SURFACE_VIEW_OP_META` descriptions drop the
  "bordered / first row X, first column Y" wording: "over a table with optional Xs and Ys;
  unwired axes count 1, 2, 3…". `uiCopy.test.ts`.
- `frameHints` for the new `z` inputs: none (they are tables, not frames — check
  `frameHint.test.ts` only requires hints on FRAME inputs).

## Steps

1. `gridAxes` + `fillGrid` with tests in `nodes/stats.test.ts` (port every bordered case:
   strip the border into xs/ys/z and assert the same interior) + the new cases: unwired
   axes = index, wired-blank axis → null, length mismatch → `#SHAPE!`, non-finite axis
   entry → `#VALUE!`.
2. Node sockets + `applyInterpolateMode` (existing cable-drop path covers the swap);
   `wiredNull.test.ts` "Grid Interpolate — wired blank by role" (xs blank → null result;
   unwired → index).
3. Surface/Contour on the same helper; `visual.test.ts` ports (`parseBorderedGrid` cases →
   `gridAxes`); persistence sweep (socket keys changed → old saves' cables to `grid` drop on
   load; confirm the loader's missing-socket behaviour is silent, not a throw).
4. Formula arm + `HISTOGRAM2D` plain matrix; `formulaTier3`, `formulaNodeCoverage`,
   `formulaSignatures` tests.
5. Copy + docs (`python-r-gap.md`); seed check; full suite. Two commits minimum (kernel +
   Interpolate; Surface + formula).

## Done when

- Tests + full suite + `tsc` green; `grep -rn bordered src/` is empty outside git history;
  digest line; this file deleted.
- Author eyeball at http://localhost:1420: Table Input (3×3 with holes) → Grid Interpolate
  with nothing on Xs/Ys fills the holes; wire a 3-item list into Xs and the fill changes
  accordingly; Surface from the same table draws with 1,2,3 axes; the formula
  `INTERPOLATE(table)` in an Expression matches the node.
