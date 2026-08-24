# C5 — correlated list outputs become ONE frame output

**Rule (author, 2026-08-24; CLAUDE.md "Node design").** Lists that are index-aligned leave a
node as one frame, never as parallel list sockets. Audit (2026-08-24) found nine nodes;
seven are list-shaped by nature and convert here. Three are scalar nodes that merely
broadcast over lists (IM Unpack, Triangle Solver, Quadratic Roots) — HELD for the author
(a one-row frame for a scalar input is the wrong shape); list them in the digest, change
nothing.

**Read first.** `docs/value-semantics.md` (figure datum row; a wired blank in → blank frame
out); `docs/socket-reference.md` (frame rung); `.claude/skills/add-node/SKILL.md`
§ Persistence (output-socket changes on an existing class: an old save's cable to the
removed key drops on load — confirm it is silent); `docs/code-comments.md`. Precedent for a
node that emits a frame from parallel arrays: `FrameFromListsNode` (`nodes/frame.ts:1466`)
and `frameFromColumns` / `FrameValue` construction in `src/graph/frame.ts`.

**Backlog:** nothing to delete; digest line + delete this file when done.

## The seven (file:line = class; convert each)

| Node (catalog) | Class | Today's outputs → frame columns |
|---|---|---|
| Decompose (`nodeCatalog.ts:618`) | `nodes/stats.ts:1191` `DecomposeNode` | `trend`, `seasonal`, `residual` → frame `Trend, Seasonal, Residual` (number). B0.4 adds an STL `method` op to this card — coordinate: whoever lands second rebases. |
| Forecast (ETS) (`:617`) | `stats.ts:1086` `EtsForecastNode` | `forecast`, `interval` → frame `Forecast, Interval`; `detected` stays a scalar `numOut`. |
| Group Lists (`:559`) | `nodes/list.ts:2160` `GroupByNode` | `keys` (adoptive), `values` → frame `Key, Value` — the key column's type follows the input list's element family (string/number/date/logical); see how `FrameFromListsNode` types its columns. |
| Find Peaks (`:530`) | `list.ts:2410` `FindPeaksNode` | `positions`, `values` → frame `Position, Height`. |
| Outliers (`:528`) | `list.ts:552` `OutliersNode` | `flags`, `clean` → frame `Value, Outlier` (`Value` = the cleaned list with nulls at flagged rows, `Outlier` logical). Keep the input's element family for `Value` if it isn't number-only — check `data()`. |
| Point Plotter (`:203`) | `nodes/control.ts:333` `PointPlotterNode` | `x`, `y` → frame `X, Y`. |
| Curve (`:204`) | `control.ts:421` `CurveNode` | `values`, `xs` → frame `X, Value` (X first: it is the axis). |

## Design (decided)

- One output socket `result` = `frameOut("<noun>")` per node (labels: "Parts", "Forecast",
  "Groups", "Peaks", "Result", "Points", "Curve"); the old keys are deleted (no alias, no
  shim — pre-alpha rule). Column names are the old socket labels, Title Case, no units in
  the name (units ride the column via `unitColumn` where the input carried one — see how
  `FrameFromListsNode` carries units; if the node's inputs are unit-aware today, keep it).
- `data()` builds a `FrameValue` with `frameFromColumns`-style construction; blank/error
  handling unchanged (a whole-input error → SolError; a wired blank datum → null frame).
- Component: `FrameDisplay` (the frame-node components in `FrameNodes.tsx`) replaces the
  per-output `ResultDisplay` rows; collapsed card shows the frame chip.
- `passthrough`: none of the seven forwards an input unchanged, so no decl; if `GroupByNode`
  declared one for `keys`, delete it and check `passthroughOutputMutable.test.ts`.
- Seeds: `grep -l "<type>" src/graph/seedGraphs/*.json` per node; every cable from an old
  key is rewired — to a Chart directly where the consumer plotted two of them (the new
  multi-series Chart takes the frame), or through Get Column where a single list is needed.
  `seeds.test.ts` + `cubesSeed`/`reportShowcaseSeed` must stay green.
- Copy: catalog descriptions name the frame's columns in one clause ("…as a frame with
  Trend, Seasonal and Residual columns"); `socketDocs` for removed keys deleted; run
  `uiCopy.test.ts`. `docs/node-coverage.md` lines for these nodes updated if they name the
  outputs.
- Formula surface: unaffected (these nodes' formulas, where any, already return matrices/
  lists on their own registrations — verify with `formulaNodeCoverage.test.ts`).

## Steps

1. One node per commit, smallest first (Point Plotter, Curve, Find Peaks, Outliers, Group
   Lists, Forecast, Decompose). Per node: tests first (the node's existing test file:
   assert `result` is a FrameValue with the named columns and the same numbers the old
   outputs carried), class, component, seeds, copy; `tsc` + node tests + `seeds.test.ts` +
   `persistenceSweep` + `socketReference` + `uiCopy`; commit by pathspec.
2. Decompose last, after B0.4 has landed (or coordinate with Agent 4 if B0.4 is mid-flight).
3. Digest: one line per node + the three held-out names.

## Done when

- Seven commits, full suite + `tsc` green; digest; this file deleted.
- Author eyeball at http://localhost:1420: Decompose → Chart shows three series with a
  legend from one cable; Point Plotter → Chart scatter from one cable; Outliers popup shows
  the Outlier column; the three held-out nodes are unchanged.
