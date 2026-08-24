# C2 — the base Chart renders multiple series from a frame

**Goal (author, 2026-08-24).** A frame wired into Chart's Data with a label column plus n
numeric columns draws n series on shared axes, named from the column headers, with a legend
when n > 1. Today `ChartNode.data()` keeps column 1 and silently drops the rest. Composed
and Bubble stop needing their own `Series` matrix socket: the frame IS the series set, and
the socket is deleted (one card, fewer inputs — the node-combining rule).

**Read first.** `docs/value-semantics.md:168-169` (figure datum / presentation rows);
`DESIGN.md` §2 colors (`:129-132`, `:157`, `:169` Nearest-Accent) and §7; `docs/code-comments.md`;
the `dataviz` skill is NOT loaded here — the palette is the app's own (`chartCore.ts:16-19`).

**Backlog:** add nothing; this is an author ask. Digest line + delete this file when done.

## Where it is

- Value: `src/graph/chartValue.ts:154-171` `ChartValue` (`values` `:158`, `matrix` `:161`
  with the comment "composed = each COLUMN a series; bubble = each ROW an [x, y, size]
  point", `labels` `:164`, `options` `:168`). No series-name or legend field exists.
- Producer: `src/graph/nodes/visual.ts:130-176` `ChartNode.data()`; the drop is `:140-146`
  (`cols[0]` → labels, `cols[1]` → values, rest discarded). `rawInputs` `:103-104` + `:122-124`
  keeps Data uncoerced (a wired list must stay a list) — keep it. `socketDocs` `:91-95`
  ("From two columns, the first supplies the axis labels and the second the values" — the
  sentence that changes), `frameHints` `:111-116` (2-column example; `frameHint.test.ts:34-56`
  requires an entry, content is free). Op tables `ChartOp` `:67-70`, `CHART_OP_META` `:73-85`,
  `CHART_MATRIX_OPS` `:88`; card family-switch cable drop `components/ChartNode.tsx:19-30`.
- Renderer: `src/graph/components/chartRender.tsx` — `ChartView` `:69-242`, every cartesian
  branch binds one `dataKey="v"` over `toSeries()` rows (`chartCore.ts:50-59`); the
  multi-series prior art is `ComposedView` `:344-369` (row objects keyed `c0…cN`, one child
  per column, colors from `useSeriesColors()` `chartCore.ts:36-39`, palette `:16-19`).
  Color rule `:105` `opts?.color || viz`. Tooltips `:10-65` are all single-value
  (`payload[0]`). **No `Legend` anywhere in `src/`** (`chartRender.tsx:3` import list).
- Card mirror: `components/ChartNode.tsx:50-56` rebuilds a ChartValue from cached node
  fields — it must carry the new field too. Other consumers pass the whole value through
  (`chartView.tsx:91-147`, `ChartPopup.tsx:69-97`, `DisplayNode.tsx`, `CompositeNode.tsx:32`,
  `inlineRefDisplay.tsx:152-163`); Report HTML export scrapes the live `<svg>`
  (`canvasCapture.ts:100-117`) so it needs nothing.
- Options: `src/graph/nodes/chartOptions.ts:4-17` (single `color`, no legend/stacked);
  Chart Builder visibility `:143-155`, renderer-reads comment `:116-126`.
- Tests: `chartValue.test.ts:61-73` (the 2-column rule), `nodes/visual.test.ts:19-38`
  (strict `toEqual` on the emitted object — an UNDEFINED new key passes; a defined one
  needs the fixture updated), `errorValue.test.ts:87-97` (figure sink), `kind.test.ts:28-64`
  (Chart's DOM weight calibrates the html-in-canvas threshold — a Legend adds DOM; re-run).
- Seeds feeding a Chart a real frame: `getting-started.json:468` (2 cols, safe),
  `decision-matrix.json:117` (2 cols, safe), `live-market-data.json:22,68` (DataFeed frames
  at runtime — check `nodes/dataFeed.ts` output arity; if a feed can be >2 columns, the
  seed needs a Select Columns in front or the change is the intended one). Composed/Bubble
  showcase: `chart-showcase.json:193,203` wire `TableInputNode matrix` → `series`.

## Design (decided)

- `ChartValue` gains `series?: { name: string; values: (number | null)[] }[]`, set ONLY when
  a frame supplies ≥ 2 numeric columns after the label column (n ≥ 2). `values` stays the
  FIRST series so every existing consumer keeps working unchanged; `labels` unchanged.
  Column detection: label column = column 0 when its type is not `number` (string/date/
  logical) — otherwise there is no label column and EVERY numeric column is a series
  (positional x). Non-numeric columns after the first are skipped, not errors.
- Renderer: when `series` has ≥ 2 entries and the op is column/bar/line/area/scatter/radar,
  build rows `{ i, s0…sN }` (the ComposedView pattern), emit one child per series in the
  op's shape, colors from `useSeriesColors()` (Options `color` applies to single-series
  only; with n ≥ 2 the palette wins — say so in the Chart Builder comment `:116-126`), and
  a recharts `<Legend>` under the plot: small (`fontsize` token), neutral text, no accent,
  series name = column header. Tooltip lists every series' value for the hovered index
  (extend `ChartTooltip`, keep `tipValue`). pie / radialbar / funnel stay single-series
  (first series). Bar (horizontal) groups per label like column.
- Composed reads `series`: series 0 bars, the rest lines (today's matrix rule, now over
  named columns). Bubble reads the frame's first three numeric columns as x/y/size. Then
  DELETE the `series` input socket and `CHART_MATRIX_OPS`' socket-swap logic
  (`dropInputCables` before `removeInput` on load isn't needed — the socket is gone from
  the class; an old save's cable to it loads as a dangling cable and is dropped by the
  loader; confirm with `persistence.test.ts`'s missing-socket case, or add one). Delete
  `matrix` from ChartValue if nothing else reads it after this (grep `.matrix` in
  `components/`); `chartValue.test.ts:55-59` goes with it.
- `chart-showcase.json`: replace the `TableInputNode matrix` feeding Composed/Bubble with a
  `FrameInputNode` (`frameText`) carrying named columns; `seeds.test.ts` must stay green.
- Copy: `socketDocs.values` → "A list plots by position. A frame's first non-number column
  supplies the labels; every number column is a series." `CHART_OP_META` composed/bubble
  descriptions drop the "2-D Series" wording; catalog description `nodeCatalog.ts:247`
  likewise; `frameHints` example gains a third column (`Label / Sales / Target`). Run
  `uiCopy.test.ts`.
- Out of scope, one Finding line each: `stacked` option; per-series color overrides;
  secondary y-axis; legend toggling.

## Steps

1. `chartValue.ts` field + `ChartNode.data()` series extraction; tests first in
   `chartValue.test.ts`: 3-column frame → `values` = col 1, `series` = 2 named entries;
   number-first frame → no labels, all columns series; a string column in position 2 is
   skipped; 2-column frame → `series` undefined (fixture `:61-73` unchanged). `visual.test.ts`
   `:19-38` stays green (undefined key).
2. Renderer multi-series + Legend + tooltip; card mirror `ChartNode.tsx:50-56`. `tsc`.
   `kind.test.ts` re-run (report the weight delta in the digest; if the threshold moves,
   say so — don't retune it).
3. Composed/Bubble over `series`; delete the `series` socket, `CHART_MATRIX_OPS`, `matrix`;
   fix the showcase seed; `seeds.test.ts`, `persistenceSweep.test.ts`, `socketReference.test.ts`.
4. Copy + hints + builder comment; `uiCopy.test.ts`, `frameHint.test.ts`.
5. `live-market-data` check (step above). Full suite. Two commits minimum (value+renderer;
   socket deletion+seed).

## Done when

- Tests above + full suite + `tsc` green; digest line; this file deleted.
- Author eyeball at http://localhost:1420: `getting-started` chart unchanged; a Frame Input
  with `Month, Sales, Target` → Chart column shows two colored series + legend, line too;
  the chart-showcase Composed/Bubble cards look as before from the new frame source;
  Chart popup and a Report `=ref` embed show the legend.
