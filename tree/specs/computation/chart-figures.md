---
aliases: ["Chart figures"]
tags: [spec, computation]
---
<!-- [[C100]] chartIsAValue, [[C96]] chartOptionsAreMatplotlib, [[D75]] builderExposesEveryOption, [[C97]] rechartsLazyChunk, [[C71]] noBarEditing, [[C63]] oneRecordNode, [[C94]] formatFamilyGates, [[C8]] declareOnce, [[C26]] opArgDistinct, [[C103]] untrustedContentSeams -->

# Spec: Chart figures

Serves [[C100]] chartIsAValue, [[C96]] chartOptionsAreMatplotlib, [[D75]] builderExposesEveryOption, [[C97]] rechartsLazyChunk, [[C71]] noBarEditing, [[C63]] oneRecordNode and [[C94]] formatFamilyGates (the Format Controller's `chart` family). It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

A chart in Solenoid is a value, not a drawing. Each figure node computes a small, self-describing figure value and sends it down a `chart` cable; whatever receives it (the node's own card, a Display, the chart popup, a Report embed) draws it at the size it has. This spec covers that value, the nodes that make it, the options string that styles it, and the renderers that draw it.

Code: `src/graph/chartValue.ts` and `src/graph/mermaidValue.ts` (the values), `src/graph/nodes/visual.ts` (every figure node but Gantt), `src/graph/nodes/gantt.ts` with `src/graph/ganttPayload.ts` (the Gantt node), `src/graph/nodes/chartOptions.ts` (the options grammar and the Chart Builder's target table), `src/graph/components/chartView.tsx` (the one dispatcher, `ChartFigure`), `chartRender.tsx` (every recharts renderer), `chartCards.tsx` (the CSS figures), `chartCanvasViews.tsx` and `SurfaceView.tsx` (the canvas figures), `MermaidView.tsx`, `ChartChip.tsx`, `ChartPopup.tsx` with `chartPopupStore.ts`, `DisplayNode.tsx` and `inlineRefDisplay.tsx` (the Display and Report surfaces). The Gantt layout and its React figure are packages with their own contracts: `packages/gantt-layout/README.md` and `packages/gantt-react/README.md`. `docs/node-coverage.md` § Output is the node inventory; this file is the mechanics.

## The values on the `chart` socket

The `chart` socket carries a self-describing figure value. Every figure node is terminal: it emits a new value and never passes its input through. The Heatmap card (`HeatmapCellNode`) is not a figure node: it takes a table, passes it through unchanged on `result`, and draws the color grid on the card only. Acceptance follows [[socket-lattice]]: `chart` is an object-family type, so a chart output reaches a `chart` input or a `trueany` input (Display, Report, Cable Switch, Composite boundaries) and nothing else. The socket also carries two sibling brands that this spec does not cover: `ImageValue` (`imageValue.ts`, the QR node and image inputs) and `SvgValue` (`svgValue.ts`, the SVG picker).

Every consumer recognizes a value by its brand field, never by structure: `isChartValue(v)` tests `__chart === true`, `isMermaidValue(v)` tests `__mermaid === true`. Both values are flat and JSON-safe (plain objects, arrays, numbers, strings, booleans, null), so they cross cables and React roots unchanged.

### `ChartValue`

| Field | Type | Meaning |
|---|---|---|
| `__chart` | `true` | The brand. |
| `op` | `ChartValueOp` | The figure kind. Picks the renderer (see Render dispatch). |
| `values` | `number \| number[] \| null` | The raw 1-D numbers the figure plots. The series figures draw from it; for the payload figures it is a summary (see the per-node table) that no renderer reads. |
| `series` | `{ name, values: (number \| null)[] }[]`, optional | Named series. For the cartesian ops it is set only when two or more numeric columns survive the label column, and `values` then mirrors the first series. Composed reads it as bar then lines, Bubble as x, y, size. Sparkline always sets one series. |
| `labels` | `(string \| number)[]`, optional | One category label per data point (a Frame's column 0), shown on the axis instead of the 1-based index. For Radar it is the spoke names. |
| `payload` | `ChartPayload`, optional | Structured data for the figures that are not a numeric series. Its `kind` equals `op`. |
| `options` | `ChartOptions` | The parsed options string (see The options string). Figures that take no options carry `{}`. |
| `title` | string, optional | The display title: the options `title`, else the node label, else the node's default name. It labels the popup header, the Report embed bar and the chip; it is never drawn inside the figure (the in-figure title is `options.title`, see Titles). |

`ChartValueOp` is the union of the Chart node's eleven ops (`column`, `bar`, `line`, `area`, `scatter`, `pie`, `radar`, `radialbar`, `funnel`, `composed`, `bubble`, the keys of `CHART_OP_META`) and the fourteen special ops in `CHART_SPECIAL_OPS` (`kpi`, `scale`, `proportion`, `sankey`, `surface`, `contour`, `waterfall`, `candle`, `boxplot`, `calheat`, `quiver`, `record`, `overlay`, `gantt`). `chartValueOps()` enumerates all 25 at runtime, and `chartPopupCoverage.test.ts` checks that every one reaches the shared popup path.

### Payloads

Every payload is data, never geometry: the renderer lays it out at the size it is given.

| `kind` | Fields |
|---|---|
| `kpi` | `value: number \| null`, `prev: number \| null`, `unit: string` (a suffix after the number), `goodUp: boolean` (whether an increase is good). |
| `scale` | `style: "dial" \| "bar"`, `value`, `target: number \| null`, `min`, `max`. Dial pins `min 0`, `max 1`, `target null`. |
| `proportion` | `layout: "treemap" \| "waffle"`, `names: string[]`, `values: number[]`. |
| `sankey` | `sources: string[]`, `targets: string[]`, `values: number[]`, parallel: flow `i` runs from `sources[i]` to `targets[i]` carrying `values[i]`. Nodes are the unique names across both ends, in first-seen order. |
| `surface` | `xs: number[]`, `ys: number[]`, `z: (number \| null)[][]` with `z[iy][ix]` the height at `(xs[ix], ys[iy])` and null a hole; `yaw`, `pitch` in degrees. |
| `contour` | `xs`, `ys`, `z` as Surface; `levels`: the iso-line count. |
| `waterfall` | `names: string[]`, `values: (number \| null)[]` (signed deltas; null is an unknown step), `total: boolean` (append a computed Total bar). |
| `candle` | `labels: string[]`, `open`, `high`, `low`, `close`: parallel `(number \| null)[]`. |
| `boxplot` | `boxes: { name, lo, q1, med, q3, hi, outliers: number[] }[]`. |
| `calheat` | `days: number[]` (whole date serials), `values: number[]`, parallel. |
| `quiver` | `u`, `v`: same-shaped `(number \| null)[][]` of the x and y components, one arrow per cell. |
| `record` | See The Record figure. |
| `overlay` | `series: OverlaySeries[]`, `labels?: (string \| number)[]`. An `OverlaySeries` is `{ name, kind: "line" \| "area" \| "column" \| "bar" \| "scatter", values: (number \| null)[], color?, markersize?, linewidth?, alpha?, marker?: boolean }`. |
| `gantt` | `GanttPayload` from `@solenoid/gantt-layout`: tasks in depth-first WBS order, links, non-working spans, weekend days, holidays, `today`, `statusDate`, `projectStart`, `projectFinish`, per-task predecessor text and the resolved `view` options. The field list is the package README's; this spec does not restate it. |

### `MermaidValue`

`{ __mermaid: true, source: string, title?: string }`. `source` is Mermaid diagram text; `title` is the Mermaid node's label, else `"Diagram"`. It rides the same `chart` socket.

## The figure nodes

Each figure node computes its value in `data()`, caches it on the node (`cachedChart`, `cachedPayload` or `cachedResult` with `cachedSeries` / `cachedLabels`) for its card, and returns it on the `chart` output (Mermaid's output is `diagram`). A card never calls `data()`; it reads the cache.

"Wired blank" below means a connected cable whose value is null. It is always distinct from unwired (`readInput`): unwired falls back to the card's literal, wired blank does not.

| Node | Inputs | Emits `op` | `values` | Options |
|---|---|---|---|---|
| Sparkline | `values` (number list) | `line` or `column` | the known numbers | none, `{}` |
| Chart | `values` (Data: frame, cube, list or number, received raw), `options` | its op | first series | yes |
| Merge Plots | `p0`, `p1`, … (charts), `options` | `overlay` | null | yes |
| Histogram 1-D | `values`, `bins`, `options` | `column` | bin counts | yes |
| Histogram 2-D | `values` (X), `bins`, `y`, `ybins`, `options` | `contour` | null | yes |
| Gauge, Dial | `value` | `scale` | the value | none, `{}` |
| Gauge, Bar | `value`, `target`, `max`, `options` | `scale` | the value | yes |
| KPI | `value`, `prev` (Prior), `options`; `unit` and `goodUp` on the card | `kpi` | the value | yes |
| Proportion | `frame` (Label + Value), `options` | `proportion` | the values | yes |
| Sankey | `frame` (From + To + Value), `options` | `sankey` | the flow values | yes |
| Surface (3-D view) | `z` (table), `xs`, `ys` | `surface` | null | none, `{}` |
| Surface (Flat view) | `z`, `xs`, `ys`, `levels` | `contour` | null | none, `{}` |
| Waterfall | `frame` (Label + Delta), `options` | `waterfall` | the known deltas | yes |
| Candlestick | `frame` (Date + OHLC), `options` | `candle` | the known closes | yes |
| Boxplot | `values` (frame or list, received raw), `options` | `boxplot` | null | yes |
| Calendar Heatmap | `frame` (Date + Value), `options` | `calheat` | the values | yes |
| Record | `frame`, `row` (Card only), `by` (Board only), `layout`, `options` | `record` | null | yes |
| Vector Field (Quiver) | `u`, `v` (tables) | `quiver` | null | none, `{}` |
| Gantt | `schedule` (cube), `baseline` (cube), `holidays` (date list), `weekend_code`, `status` (date), `options` | `gantt` | null | yes |
| Mermaid | `source` (string) | MermaidValue | n/a | n/a |

Title defaults (used when neither the options `title` nor the label is set): Sparkline `"Sparkline"`, Chart `"Chart"`, Merge Plots `"Merged Plot"`, Histogram `"Histogram"`, Gauge `"Gauge"`, KPI `"KPI"`, Proportion `"Proportion"`, Sankey `"Sankey"`, Surface `"Surface"` or `"Contour"`, Waterfall `"Waterfall"`, Candlestick `"Candlestick"`, Boxplot `"Boxplot"`, Calendar Heatmap `"Calendar"`, Record `"Record"`, Vector Field `"Vector Field"`, Gantt `"Gantt"`. Nodes without options take the title from the label alone.

### Sparkline

Ops `line`, `column`, `winloss` (`SPARKLINE_OP_META`); an old save's `bar` loads as `column` and `area` as `line`. Each cell that is not a finite number becomes a gap (null), never zero. Win/Loss maps each known cell to its sign (`-1`, `0`, `1`) and emits op `column`. The value carries `series: [{ name, values }]` with the gaps in place and `values` with only the known numbers. The card draws its own axis-less figure (see Cards); the value on the cable carries no sign colors, so a Sparkline drawn downstream is an ordinary single-series chart with axes.

### Chart

The card picks the op in two steps: a family select (Cartesian, Categorical, Multi-series, from `CHART_OP_META`'s `group`) narrows a type select, and picking a family jumps to its first type. The type is the node's `op`, the accented op select; the family is only a filter ([[C26]] opArgDistinct), and both derive from `CHART_OP_META` so they can't drift from the Add-menu rows ([[C8]] declareOnce). Every op reads the same `values` input, so switching op is a plain recompute.

`data()` reads the raw `values` input. The input is kept raw (`rawInputs`) because coercion would widen a wired list into a single frame row; Boxplot is raw for the same reason. A cube is flattened to a frame of its scalar columns first (`flatCubeToFrame(cube, "scalar")`: a list or table column has nothing to plot and is skipped); a top-level `SolError` there is treated as no data (Chart is in the error guard's see-errors set, so it runs). Every non-finite cell becomes null in place, so labels stay aligned with rows.

- **Frame, op `bubble`:** the first three number-typed columns (column 0 included) become `series` in order x, y, size. No labels, no legend. `values` is the x column.
- **Frame, op `radar`, two or more columns:** the frame is read transposed. `labels` are the names of the number columns after column 0 (the spokes). Each row becomes a series named by its column-0 cell (formatted, else `Row N`) with one value per spoke. `series` is set only for two or more rows; `values` is the first row. The flip makes a Decision Matrix row read as one option scored across its criteria; the cartesian charts keep column 0 as labels.
- **Frame, any other op, two or more columns:** column 0 is always the label column, formatted by `formatFrameCell` (dates as date text, errors as their code). The series are the number-typed columns after it; other types are skipped. `series` is set only for two or more; `values` is the first series.
- **Frame with one column:** plots positionally; `values` is that column.
- **Plain list:** `values` is the list, non-finite cells null. **A number:** `values` is the number.

Options: a wired string is parsed; a wired blank means no options; a wired non-string falls back to the inline literal. For Bubble, an unset `xlabel` or `ylabel` defaults to the x or y column's name.

### Merge Plots

Plot inputs are keyed `p0`, `p1`, …; `nextInputId` keeps keys unique across removals, and a load rebuilds exactly the saved keys so cables realign (`valueKeys`). A new card starts with two plot rows. For each plot row in order: an empty row or a non-chart value is skipped. A chart whose op is not in `PLANAR_CHART_OPS` (`line`, `area`, `column`, `bar`, `scatter`) makes the whole output `#TYPE!` "Plot N is a OP chart, which has no x/y plane to overlay", naming the first such row. Otherwise each source series becomes an `OverlaySeries` with the source's op as its `kind` and the source's `color`, `markersize`, `linewidth`, `alpha` and `marker` options; a source with no `series` contributes one series from `values` named by its title. `labels` are the first source's labels that exist.

### Histogram

`histogramBins(values, k)`: a non-finite `k` or `floor(k) < 1` is `#DOMAIN!` "Bins must be 1 or more". Bins are `floor(k)` clamped to 100. Only finite numbers count; none gives `[]`. Equal min and max puts every count in bin 0. Otherwise bins are equal width over `[min, max]`, index `floor((x - min) / w)` clamped into range, so the last bin is closed. A wired blank `bins` gives an empty figure. The 2-D mode pairs X and Y by index, keeps pairs where both are finite, bins each axis the same way (`histogram2d`, each bin count clamped 1 to 100) and emits a contour payload whose `xs`, `ys` are the lower bin edges, `z[iy][ix]` the counts, `levels: 10`. Switching mode adds or removes `y` and `ybins` and keeps Options last; the component prunes the departing cables first ([[D10]] onePrunePath).

### Gauge

`mode` is `dial` or `bar`, an argument picked with a segmented toggle ([[C26]] opArgDistinct). Dial has only `value`; Bar adds `target`, `max` and `options`, which a switch to Dial prunes and removes. Dial emits `{ style: "dial", value, target: null, min: 0, max: 1 }` with `options: {}`. Bar emits `{ style: "bar", value, target, min: 0, max }`; `max` falls back to the card literal (default 100) even when wired blank, because it is the track's scale, while `value` and `target` are data (a wired blank is null). Literal defaults: value 0, target 80, max 100.

### KPI

`value` and `prev` read with `readInput`, card literals default to 0. `unit` is the card text, `goodUp` the card flag (default on). A wired blank `prev` gives null (no comparison).

### Frame-fed payload figures

Proportion, Sankey, Waterfall, Candlestick and Calendar Heatmap read their frame through `readFrame`; anything that is not a frame reads as no columns. Two column readers: `colAsStrings` formats each cell (`formatFrameCell`) to text, blank as `""`; `colAsNumbers` formats each cell and keeps a finite number, or text that parses as a finite number, else null.

- **Proportion:** names from column 0, values from column 1 (column 0 when there is only one), null as 0. The layout (`treemap` or `waffle`) only re-derives the figure; the sockets do not change.
- **Sankey:** sources from column 0, targets column 1, values column 2 (null as 0). `mergeFlows` first folds every repeated From and To pair into one flow carrying the sum of their values, in first-seen order, so the payload holds one flow per pair. `acyclicFlows` then walks the flows in order: a blank end, a self-loop or a value that is not positive is kept in place untouched; a flow whose target already reaches its source closes a cycle and is dropped (counted in `droppedLoops`); the rest are added to the graph. When at least one flow was dropped and no drawable flow remains, the output is `#SHAPE!` "The flows form a loop; a Sankey needs a direction".
- **Waterfall:** names column 0, deltas column 1 with null kept as a gap; `total` is always true.
- **Candlestick:** no columns gives a null output. Fewer than four columns is `#SHAPE!` "Candlestick needs Open, High, Low and Close columns (a date column first is optional)". Five or more: column 0 is the label axis (as text) and columns 1 to 4 are OHLC. Exactly four: all four are OHLC and labels are `"1"`, `"2"`, ….
- **Calendar Heatmap:** column 0 and column 1 are read raw (a date stays a serial). A row is kept only when both are finite numbers; the day is `floor(serial)`. A day without a value is dropped, never painted as zero.

### Boxplot

The raw input: for a frame, each number-typed column is one box named by the column; for a plain list, one unnamed box. `boxplotStats` sorts the finite numbers; `q1`, `med`, `q3` are linear-interpolated quantiles at 0.25, 0.5, 0.75 (`quantileSorted`, Excel `PERCENTILE.INC`); the fences are `q1 - 1.5·IQR` and `q3 + 1.5·IQR`; `lo` and `hi` are the smallest and largest values inside the fences (the sample's extremes if none are inside); `outliers` are the values outside. A column with no finite numbers gives no box.

### Surface and Contour

One node with op `surface` (3-D) or `contour` (Flat). `gridAxes(z, xs, ys)`: `z` must be a non-empty 2-D array; its width is the widest row, and a cell that is not a finite number is null. An unwired `xs` or `ys` is `1, 2, 3, …`; a wired blank, a length that does not match the grid, or a non-finite coordinate makes the figure empty (the node swallows the `#SHAPE!` or `#VALUE!` that `gridAxes` returns). The 3-D view carries the card's `yaw` and `pitch` literals (default 45 each, stepped by the card's rotate pad in 45 degree steps). Both angles wrap fully from 0 to 360, so the pitch flips all the way over rather than clamping, and the pad's home button resets both to 45. The Flat view adds `levels`: rounded and clamped 2 to 24, default 8, a wired blank gives 0. Switching to 3-D prunes the Levels cable first.

### Vector Field

`u` and `v` are normalized to matrices of finite-or-null cells; a non-array row becomes a one-cell row.

### The Record figure

Record is one node whose views are ops `card`, `gallery`, `board`, `list` (`RECORD_OP_META`, each its own Add-menu row, [[C63]] oneRecordNode). The op owns sockets: `row` exists only on Card and `by` only on Board, and a switch prunes the departing cable before removing the socket.

- **Row (Card):** the 1-based pick, rounded. When unwired, the pick is clamped to `1..total` and written back to the literal so the pager and the card agree. A wired pick out of range, or a wired blank, gives index 0: every box empty, never an error.
- **Layout:** `parseRecordLayout(text)`. One line per grid row, cells split on `|`; an empty cell or `.` is a gap; lines with no named cell are dropped. `Name*N` widens a cell to N columns (N clamped 1 to 12, expanded before the walk, so later cells shift right). A first `:` splits placeholder text (`Qty: e.g. 40`) kept as the box's `hint`, first authored hint wins. A leading `#` marks the title field. Repeating a name (case-insensitive, first spelling kept) claims the bounding rectangle of all its cells; when that rectangle overlaps one placed earlier, it shrinks to the cell where the name first appeared. Placements are 1-based CSS grid lines. The card's `cols` is the widest placed column. An empty layout stacks every column one per row (Board skips its grouping column there). A layout name that matches no column (case-insensitive) keeps its box with the name as the label and no value.
- **Fields:** the label is the column name, plus ` (unit)` when the column carries a unit. The value is `formatFrameCell` of the cell: numbers stay numeric, dates, logicals and errors arrive as text, a null cell is null. A text value that is a `data:image/` URL, or an http(s) URL ending in an image extension (`png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`, `avif`, `bmp`, optional query), is also set as `image`. An empty value carries the layout's `hint`.
- **Views:** Card draws one card (the picked row). Gallery and List draw every row up to `RECORD_CARD_CAP` (60) and set `more` to the rest. Board requires a `by` column (matched case-insensitively and trimmed); a blank or unmatched name draws nothing. Over the first 60 rows, each row goes to the lane of its formatted grouping cell (`"—"` for a null cell), lanes in first-seen order, and `more` counts the rest.
- **Options:** `cardsize=s|m|l` (Gallery tile size, absent means medium) and `clamp=on|true|yes|1` (clamp long tile values) are read by their own patterns from the raw options string, not by `parseChartOptions`. A wired blank Layout or Options means none given.

`RecordPayload`: `{ kind: "record", view, cols, cards: RecordField[][], lanes?: { label, cards: number[] }[], more?, size?, clamp?, index, total }`, where `index` is the Card view's pick (0 for none) and `total` the row count. A `RecordField` is `{ label, value: number | string | null, image?, hint?, isTitle?, row, col, rowSpan, colSpan }`. `titleIndexFor(fields)` is the one place that picks the title field: the first `isTitle` field, else field 0.

### Gantt

The Gantt node computes no dates ([[C71]] noBarEditing: the figure is display-only; edits happen in the table). A top-level `SolError` on `schedule` passes through as the output. A value that is neither a cube nor a frame gives a null output. Otherwise `ganttPayloadFromSchedule` reads the columns a Schedule node appended:

- The table is flattened depth-first. The task column is the first of `task`, `name`, `title` (case-insensitive), else the first column holding any text; with none, `#VALUE!` "Gantt needs a Task column naming each task". A child column (`tasks`, `children`, `subtasks`, `steps`, or a column of nested tables that have a task column) recurses one level deeper. A row with a blank task name is skipped, and so is a row the Schedule left out (its Active cell set and false, `isInactive`), with its subtree.
- Every row needs numeric `start` and `finish`, else `#VALUE!` naming the task. A row is a summary when its `summary` cell is true or the next row is one level deeper. A milestone is a non-summary with duration 0, or with no duration and `start === finish`. The remaining columns (`duration` or `days`, `complete` or `% complete`, `critical`, `late`, `float`, `deadline` or `due`, `segments`, `manual`, `project`/`section`/`group`, `color`, `resource`/`who`/`owner`/`assignee`, `units`) map onto the task fields listed in the gantt-layout README.
- Links come from the predecessor column (`predecessors`, `predecessor`, `after`, `depends on`, `blockedby`, `blocked by`): text, a list of names, or a nested table with a task column plus optional `type` (FS, SS, FF, SF, default FS) and `lag`.
- A baseline is a second scheduled table joined by task name (case-insensitive); one that is not a plan draws no ghost bars.
- The shading calendar is built from `weekend_code` (Excel `WORKDAY.INTL` codes, default 1) and `holidays`, over the project span padded by 14 days. `today` is the local day; `status` is wire-only (unwired means no status line).
- The options string is parsed twice: `parseChartOptions` for `title` and `fontsize`, and `parseGanttViewOptions` for the view keys. `view.minutes` is also set automatically when any start or finish carries a clock fraction.

### Mermaid

The source is the wired `source` string, else the card literal (a starter flowchart on a new card). A wired blank renders empty. The card offers starter templates only when the source is unwired.

## The options string

Figures with an `options` input take one string of `key=value` pairs separated by `;` ([[C96]] chartOptionsAreMatplotlib). It is typed on the card or produced by a Chart Builder.

### Grammar (`parseChartOptions`)

- Split on `;`. A part with no `=` is skipped. The key is the text before the first `=`, trimmed and lower-cased; the value is the rest, trimmed (so `title=a=b` is `a=b`). There is no escape: a value cannot contain `;`.
- Pairs apply left to right, so a later key overrides an earlier one (`ylim=0,10;ymax=5` gives ymax 5).
- An unrecognized key is ignored. A recognized key with an unreadable value is ignored, so the default stands.
- Booleans: `on`, `true`, `1`, `yes`, `y` are true; `off`, `false`, `0`, `no`, `n` are false (case-insensitive); anything else is ignored.
- Numbers: `Number(text)` must be finite; blank is ignored.
- A null or empty string gives `{}`.

### Keys read by `parseChartOptions`

| Key | Parsed as | Default when absent | Meaning |
|---|---|---|---|
| `title` | non-empty text | none | The in-figure title and the value's `title`. |
| `xlabel`, `ylabel` | non-empty text | none | Axis titles, drawn only on axed figures. |
| `color` | non-empty text (any CSS color) | the Display kind accent | The single-series mark color. |
| `grid` | boolean | on | Grid lines on axed figures. |
| `marker` | boolean | on for single-series axed line, area and radar; off elsewhere | Dots on line, area and radar points. |
| `ylim` | `lo,hi`, either side may be blank | none | Sets `ymin` and `ymax`. |
| `ymin`, `ymax` | number | open (`auto`) | The value-axis bounds. On a horizontal Bar chart they bound the horizontal value axis. |
| `linewidth`, `lw` | number | 1.5 | Line, area and radar stroke width. |
| `markersize`, `ms` | number greater than 0 | 2 on lines, 3 on scatter | Marker radius in pixels. |
| `alpha` | number | 0.25 area and radar fill (0.18 when two or more area series overlap); lines, bars and dots opaque | Mark opacity: the fill of areas, radar polygons and bars, the stroke of lines, the dots of scatter. |
| `fontsize` | number greater than 0 | 10 | Text size in points; every text size scales by `fontsize / 10`. |
| `pielabels` | `off`, `outside` (`leader`, `on`, a true boolean), `inside` (`center`, `on-chart`); a false boolean is `off` | outside | Pie category labels. |
| `radarscale` | `axis` (`normalize`, `normalized`, `independent`) or `shared` (`raw`, `absolute`) | axis | Multi-series radar radius. `axis` scales each spoke to 0 to 1 by its own maximum, so one large-valued column (dollars beside scores out of 10) cannot swamp the rest, and a negative value plots at the center; `shared` keeps one raw radius. |

### Keys read elsewhere

| Key | Read by | Values |
|---|---|---|
| `cardsize` | Record (`readCardSize`) | `s`, `m`, `l` (the single letter only) |
| `clamp` | Record (`readClamp`) | `on`, `true`, `yes`, `1` |
| `layout`, `zoom`, `fit`, `tiers`, `collapse`, `fiscal_start`, `week`, `window`, `columns`, `critical`, `baseline`, `arrows`, `today`, `status`, `weekends`, `group_by`, `labels`, `minutes`, `histogram` | Gantt (`parseGanttViewOptions`) | As the gantt-react README's Option keys. Defaults the figure applies when absent: `layout=gantt`, `zoom=fit`, two header rows, every level open, ISO weeks, a January fiscal year, `critical`, `baseline`, `arrows`, `today`, `status`, `weekends`, `group_by` and `labels` on, `histogram` and `minutes` off. A `window` bound is parsed as a date; an unreadable or ambiguous bound means no window. |

Each parser reads only its own keys from the shared string and ignores the rest, so one string can carry chart keys and figure keys together.

### Which renderer reads which key

A key a renderer does not read is inert on that figure. For each Chart Builder target the key list (`CHART_BUILDER_TARGETS`) is exactly this set ([[D75]] builderExposesEveryOption); the target's `op` names the figure it draws.

| Target (`op`) | Keys read |
|---|---|
| Column, Bar, Histogram (`column`, `bar`) | `title`, `xlabel`, `ylabel`, `color`, `grid`, `ymin`/`ymax`, `alpha`, `fontsize`. On Bar the value axis is horizontal. |
| Line, Area | as Column, plus `marker`, `linewidth`, `markersize` |
| Scatter | as Column, plus `markersize` |
| Pie | `title`, `fontsize`, `pielabels` |
| Radar | `title`, `grid`, `marker`, `radarscale`, `ymin`/`ymax`, `linewidth`, `markersize`, `alpha`, `fontsize` |
| Radial, Funnel | `title`, `fontsize` |
| Composed | `title`, `xlabel`, `ylabel`, `grid`, `marker`, `ymin`/`ymax`, `linewidth`, `markersize`, `alpha` (the bars), `fontsize` |
| Bubble | `title`, `xlabel`, `ylabel` (default the x and y column names), `grid`, `ymin`/`ymax`, `fontsize` |
| Merge Plots (`overlay`) | `title`, `grid`, `ymin`/`ymax`, `linewidth` (a fallback for series without one), `fontsize`; each series keeps its inherited `color`, `markersize`, `linewidth`, `alpha`, `marker` |
| Histogram 2-D (`contour`), KPI, Gauge (`scale`), Proportion, Sankey, Waterfall, Candlestick, Boxplot, Calendar Heatmap | `title`, `fontsize` |
| Record | `title`, `fontsize`, `cardsize`, `clamp` |
| Gantt, timeline | `title`, `fontsize`, `zoom`, `tiers`, `layout`, `fit`, `critical`, `baseline`, `arrows`, `today`, `status`, `weekends`, `labels`, `histogram`, `minutes`, `window`, `columns`, `collapse`, `group_by`, `week`, `fiscal_start` |
| Gantt, `layout=calendar` | `title`, `fontsize`, `layout`, `critical`, `minutes`, `window`, `week` |

Exceptions a key list cannot see, because the builder does not know the data:

- **Series count.** Two or more series paint from the palette, so `color` is inert on a multi-series Column, Bar, Line, Area or Scatter. `radarscale` is read only by a multi-series Radar, and with `radarscale=axis` (the default) the radius is `[0, 1]`, so `ymin`/`ymax` apply to a single-series or `shared` Radar only. A Composed or Bubble with a single number column draws as Column or Scatter and reads their keys.
- **Mode.** Gauge's Dial mode has no Options input and emits `{}`; the Gauge target covers the Bar mode. Surface (both views) and Vector Field have no Options input and no target.
### Serialization and the Chart Builder

`serializeChartOptions(fields)` emits only set fields, in this order: `title`, `xlabel`, `ylabel`, `color`, `grid`, `marker`, `pielabels`, `radarscale`, `zoom`, `layout`, `tiers`, `fit`, `critical`, `baseline`, `arrows`, `today`, `weekends`, `labels`, `histogram`, `minutes`, `window`, `columns`, `collapse`, `week`, `fiscal_start`, `status`, `group_by`, `cardsize`, `clamp`, then `ylim=lo,hi` (either side blank when unset; emitted when either bound is finite), `linewidth`, `markersize`, `alpha`, `fontsize`. Text values are trimmed and a blank one is skipped; a number must be finite. Parts join with `;`, so an untouched builder yields `""`.

The Chart Builder node has one input per field (29 text, 6 number) and one output, `result` (a string). Each field is the wired value, else the card literal; a wired blank means the field is unset, never the literal. Its `target` (one of the 24 `CHART_BUILDER_TARGETS`, default `column`; a stale saved target loads as `column`) only chooses which rows the card offers (`chartBuilderKeys`; the Gantt target offers fewer keys when `layout=calendar`). The Chart node's own ops are targets of their own, and Histogram, Histogram 2-D and Merge Plots are targets beside them, so each offers only the keys its figure reads (see Which renderer reads which key), in a two-level dropdown (`group`). The categorical ops (Pie, Radar, Radial, Funnel) are not offered `color`, because they paint from the palette. The Gantt calendar layout draws its own grid and ignores the scale, bars, links and grid pane, so it is offered only `title`, `fontsize`, `layout`, `critical`, `minutes`, `window` and `week`; it always outlines today, shades weekends and labels its chips. A row the target does not read stays visible and dimmed while it is wired or holds a value, and every set field serializes regardless of target, so one builder can feed several figures. Toggles store `on`/`off`; a select's default option stores `""`.

## Render dispatch

`ChartFigure({ value, width, height, axes = true, fontScale, recordNav, virtualize })` in `chartView.tsx` is the one function that maps a `ChartValue` to a drawing. Every surface (the figure cards, Display, the popup, a Report embed, the socket peek, a Composite boundary) goes through it. It tests `op` together with a matching `payload.kind`:

| Op | Renderer | Path |
|---|---|---|
| `kpi` | `KpiCard` | CSS |
| `scale`, dial | `ScaleDial` (a recharts arc under DOM text) | recharts |
| `scale`, bar | `BulletBar` | CSS |
| `proportion`, treemap | `TreemapView` | recharts |
| `proportion`, waffle | `WaffleView` | canvas |
| `sankey` | `SankeyView` | recharts |
| `surface` | `SurfaceView` | canvas |
| `contour`, `waterfall`, `candle`, `boxplot`, `calheat`, `quiver` | `ContourView`, `WaterfallView`, `CandleView`, `BoxplotView`, `CalHeatView`, `QuiverView` | canvas |
| `record` | `RecordCardView` | CSS |
| `overlay` | `OverlayView` | recharts |
| `gantt` | `GanttView` (`GanttFigure` from `@solenoid/gantt-react`) | its own lazy chunk, DOM grid plus SVG |
| `composed` | `ComposedView` with series; else the single-series path as `column` | recharts |
| `bubble` | `BubbleView` with series; else the single-series path as `scatter` | recharts |
| the other Chart ops | the series path | recharts |

The series path: when `series` has two or more entries and the op is `column`, `bar`, `line`, `area`, `scatter` or `radar`, `MultiSeriesView` draws one mark per series with a legend. Otherwise `toSeries(values)` keeps each finite cell as `{ i, v }` with `i` its original index (so labels stay aligned across gaps); none left draws the empty dash; else `ChartView` draws one series.

A `MermaidValue` is not a `ChartValue`; the surfaces test for it separately and draw `MermaidView`.

### The three paths

- **recharts.** Every recharts component lives in `chartRender.tsx`, the one module under `src/` that imports `recharts`, and nothing imports it statically ([[C97]] rechartsLazyChunk). `chartView.tsx` and `chartCore.ts` stay recharts-free and wrap each renderer in `lazy` plus `Suspense`, with a blank box of the figure's size as the fallback, so the card doesn't reflow and its sockets don't re-measure before the chunk arrives. There is no spinner; it would flash too fast to read. A chart is a figure, never prose or a form control, so the whole recharts subtree is unselectable and draws no focus outline (`chartView.css`): recharts' SVG text would otherwise select in fragments, and recharts 3's accessibility layer makes marks focusable. Colors are resolved values, not CSS variables, because recharts writes SVG attributes: `useChartColors` reads `--border-strong` (grid), `--text-dim` (axis), `--gauge-track` and the Display kind accent (the default mark color), and re-reads when the theme store changes. `mermaid` and `@solenoid/gantt-react` follow the same rule: reached only by dynamic import.
- **CSS cards.** KPI, the Bar gauge and Record are DOM elements styled by `chartCards.css`; every text size there is `calc(Npx * var(--chart-fscale, 1))`.
- **Canvas.** One `<canvas>` element however many points it draws. `setupCanvas` sets the backing store to `min(4, devicePixelRatio · 2)` times the CSS size and lets the browser downscale. Colors are read from the canvas's computed CSS variables at each draw (`--text`, `--text-dim`, `--border-strong`, `--surface-sunken`, `--accent`, plus the palette's green, vermilion and blue); the component subscribes to the theme store so a theme change redraws. Each view redraws on every layout.

### The categorical palette

Multi-series marks, categorical slices, treemap cells, Sankey nodes and waffle categories take colors from `useSeriesColors()`: the palette slots `blue`, `gold`, `teal`, `pink`, `green`, `purple`, `sky`, `vermilion`, `lime`, `violet`, `amber`, `gray`, resolved through the active palette, indexed `i % 12`. `MermaidView` uses the same order for its pie colors.

### Titles

The in-figure title is `options.title`, drawn as a centered bold strip `ceil(16 · fs)` pixels tall at `11 · fs` pixels, taken out of the plot's height, by `ChartView`, `MultiSeriesView`, `OverlayView`, `ComposedView`, `BubbleView` and `RecordCardView`. For the figures that draw none themselves (KPI, Gauge, Proportion, Sankey, Waterfall, Candlestick, Boxplot, Calendar Heatmap, Contour and Gantt, `UNTITLED_FIGURES` in `chartTitle.tsx`), `ChartFigure` draws the same strip (`chartTitle.tsx`) above the figure and hands it the remaining height. The Sankey, KPI and Gauge cards draw through `ChartFigure`, so their options apply on the card as they do in a Display. The popup and a Report embed remove both `title` and `options.title` before drawing, because their header or bar already shows it.

## The recharts figures

All recharts figures run with animation off. Tick text is `9 · fs`, axis titles `10 · fs`, where `fs = fontScale · (fontsize / 10)`.

- **Axis ticks.** With `labels`, a tick shows the label at the rounded index (a number label is snapped to 10 significant figures by `axisTick`), blank past the ends; without, the 1-based index. Every tick is shown while there are 12 points or fewer; beyond that recharts thins them.
- **Tooltips.** Values format with `formatScalar`. The single-series tooltip shows `#n` (1-based) and the value (Scatter shows the real x instead when it has one); categorical tooltips show the value only; multi-series tooltips list each series with a swatch; a tooltip value that is an object shows its `code`.
- **Line, Area, Column.** Cartesian plot with 14 pixels of top headroom for the expand button. Column bars and line strokes use `color` at full opacity unless `alpha` is given.
- **Bar.** Horizontal bars; the category axis is sized to the widest label (about `5.2 · fs` pixels per character plus 8, at least 18, at most a third of the width).
- **Scatter.** When every label of the plotted points is a number, each dot sits at that real x; otherwise x is the row index, pinned to `[0, n-1]` with 8 pixels padding and integer ticks.
- **Pie.** A slice that is zero or negative is dropped (`pieSlices`), since a pie has no place for it; the slices keep their row's color and label. Radius `max(18, min(width, height) / 2 - pad)`, where pad is 6 with no labels, `min(16, 7% of width)` inside, `min(30, 12% of width)` outside. Labels draw only when `labels` exist and `pielabels` is not `off`. Label text goes through `sanitizeChartLabel` (control characters to spaces, whitespace collapsed, capped at 10 code points when the width is under 260, else 16, with an ellipsis). A slice under 3% gets no label. Outside labels ride a two-segment leader (a 7 pixel radial stub, then a horizontal run to a shared column per side). Inside labels sit at 62% of the radius on a translucent plate, for slices of 6% or more; smaller slices keep the outside leader.
- **Radar.** Polar grid (none with `grid=off`), spoke names from `labels`, no radial tick text (it would print rotated on the polygon); the single-series radar takes the palette's first color. Multi-series with `radarscale=axis` normalizes each spoke to `[0, 1]` by dividing by the largest value on that spoke, and the tooltip shows the raw value. Dividing by the maximum (never min-max scaling) keeps the result proportional, so spokes in different units (a price beside a score out of 10) share one figure and the weakest value keeps its true fraction of the axis. A negative value plots at the center, since a radar has no sensible place for one, and an all-zero spoke plots at 0.
- **Radial.** Rings from 18% to 92% radius, starting at 12 o'clock; a bottom legend names the rings only when `labels` exist, each name through `sanitizeChartLabel`.
- **Funnel.** Palette-colored stages with the value labeled on the right.
- **Multi-series.** The legend is a fixed 18 pixel DOM row under the plot, its height taken off the plot, inset by the y-axis width to center on the plot area. It is never recharts' `<Legend>`, which reserves a strip inside the plot, lays it out against the x-axis (landing on the x label) and re-reserves whenever its measured height changes, so the plot jumps on a click. Clicking an entry spotlights that series (the others drop to 0.18 opacity); clicking it again clears. A pointer press on the legend is stopped so the card does not start a drag.
- **Composed.** Series 0 as bars, the rest as lines, gridded unless `grid=off`, with a legend when there are two or more series: the same DOM row under the plot as every multi-series chart (`SeriesLegend`), whose click spotlights a series.
- **Bubble.** One dot per row at `(x, y)` sized by the third column (area range 40 to 420, a missing size counts 1) at 0.55 opacity; a row with no y is dropped; with a single column the dot plots at `(x, x)`. The tooltip names all three columns.
- **Overlay.** A series' inherited `alpha` is its line stroke, area fill, bar fill or dot opacity. One shared cartesian plane (a recharts `ComposedChart`) with each series in its own mark: line, area, scatter, and both `column` and `bar` as vertical bars, so every mark shares the x axis. A series without an inherited color takes the palette. Legend clicks spotlight by series index (the data key), never by name, since merged series names can collide.
- **Treemap.** Cells sized by value (non-positive values dropped, blank names shown as `#n`); a name is drawn in white only in a cell wider than `46 · fs` and taller than `20 · fs`.
- **Sankey.** Flows that are blank, self-loops or not positive are skipped; node width 10, padding 16; labels sit inward (left of nodes in the right half, right of the others). A flow is drawn at stroke opacity 0.5 and lifts to 0.85 under the pointer (`.sol-sankey .recharts-sankey-link:hover` in `chartView.css`), beside its value tooltip.
- **Dial.** A half-ring arc for `value` clamped to `[0, 1]` over a track, with the percent (one decimal) centered and `0%`, `100%` at the ends. Its size is the given `size`, else the width clamped to 120 to 200 pixels, drawn 0.55 times as tall. The Gauge card's square-collapsed miniature draws the same arc (`GaugeArc`).
- **Tornado bars.** The Tornado node's card draws `TornadoBars`, a horizontal stacked bar chart 218 pixels wide (`TORNADO_W`, the same width as the Chart card, kept as a literal in `chartView.tsx` so reading it doesn't load the chunk) and `max(70, 22 per row + 16)` tall. Each row is a transparent offset bar plus a range bar: `#e0524d` when the output rises, `#4c8bf5` when it falls, and a muted full-width bar at 0.4 opacity for a diverged row, which has no finite swing and reads as off the chart. The tooltip shows the output range (or "diverged (non-finite)") and the input range with its basis (the slider range, or ±10% for a number), so a wide bar is never mistaken for a like-for-like comparison with a narrow nudge. The Tornado bars are not a chart value; they are drawn only on that card.

## The CSS and canvas figures

- **KPI.** The formatted value (`formatScalar`) with the unit suffix. When `prev` is a finite number, a delta line shows an arrow (up, down, or a bar for no change), the absolute change and, when `prev` is not zero, the percent change against `|prev|`. It is green (`#2fae7a`) when the direction is good (`goodUp` decides), the error color when bad, dim when unchanged. The green is a semantic state color, never a palette slot, because a trend reads as good or bad, not as a series color.
- **Bar gauge.** A 0 to `max` track (a non-finite bound falls back to 0 and `min + 1`) with the value's fill and a target tick; the fill is green when the value meets the target, else the accent. Below it: min, `target N`, max.
- **Record.** Card: one CSS grid of boxes at the payload's placements. The boxes are neutral sunken fields (the type signal stays on the sockets), square, and touching, overlapping their shared 1 pixel borders so adjacent edges read as one hairline. A title box drops its label and draws its value larger (14 pixels at scale 1); an image box draws the picture; an empty box shows its hint muted or a dash. When a surface passes `recordNav` and there are two or more records, a pager (previous, `index / total`, next) sits under the card. In a host of definite height (a resized Display, the popup) the card is a column in which the grid takes the height the pager leaves, so a short host clips the grid, never the pager; in an auto-height host it stays content-sized. Gallery: a masonry of cards (`masonryLayout.ts`), tracks aimed at 130, 170 or 230 pixels for `s`, `m`, `l` (bands 110 to 190, 140 to 260, 190 to 340: a track compresses to the band's minimum before a column drops and never stretches past its maximum), 6 pixel gap. The placement is the CSSWG masonry explainer's definite-first pack, the Pinterest algorithm: in order, each card goes into the column whose running height is smallest, the leftmost on ties (`packMasonry`). It runs in script because native CSS masonry is still flag-gated in Chromium. The column plan (`planColumns`) justifies the track width to fill the container within that band (the maximum keeps a lone card from stretching into a full-width stack), and tracks never outnumber the cards, so a short gallery's tracks widen to fill instead of leaving phantom columns. The container's height is the tallest packed column. Card heights are measured from the DOM, a ResizeObserver re-packs on a container resize, a wrap change or a text-scale change, and tiles stay hidden until the first measurement at the final track width, so no mispacked frame paints. With `clamp` on, a Gallery tile's long values stop at three lines with an ellipsis. Board: one lane per `lanes` entry. List: per record, the title field's text, then one ellipsized `label: value` line per field, indented 12 pixels, text only (a long value or an image URL clamps to its line). `+N more` follows when `more` is set. The figure's height follows its content; the given height is ignored.
- **Waterfall.** Bars span the running total `[cum, cum + v]`, green up, vermilion down; a null step keeps its slot, draws nothing and does not move the total; the Total bar spans `[0, sum]` in blue. Dashed connectors join bar tops, a zero line draws over the bars, labels show under bars at least 20 pixels wide.
- **Candlestick.** A candle with any null of the four, or high below low, is a gap; open and close are clamped into `[low, high]`. Green when close is at or above open. Only the first and last labels are drawn.
- **Boxplot.** Whiskers, caps, a translucent IQR box, a heavier median line and vermilion outlier dots; names under boxes at least 20 pixels wide.
- **Calendar Heatmap.** Values on the same day sum. Weeks run Monday first and the grid starts on a Monday, so columns stay week-aligned; it ends at the last day's week and starts at the later of the first data day and a year before the end, limited to the weeks that fit at 3.2 pixels a cell (at least 4), below which the grid stops reading as days. A multi-year feed therefore shows its most recent weeks. When data starts before the drawn grid, `last N wk` shows in the corner, since the reader must know the data reaches further back. Month initials label the top, at each week whose Monday enters a new month, and `M`, `W`, `F` label the rows. Every in-span day draws a sunken cell; a day with a value adds the accent at opacity `0.16 + 0.84 · t`, where `t` is the value's place between the drawn minimum and maximum (0.75 when they are equal).
- **Waffle.** A 10 by 10 grid filled bottom-up. A single value between 0 and 1 fills that share in the accent. Otherwise shares of the positive values are split into 100 cells by largest remainder, one palette color per category, with a legend of up to four names when any name is set; the unfilled cells draw sunken.
- **Contour.** Each grid cell is shaded by bilinear interpolation in 6 by 6 subquads through the palette's height ramp, each overdrawn by half a pixel so the subquads meet without seams; a cell with any missing corner stays blank, a hole as in Surface. Iso-lines by marching squares at `levels` evenly spaced heights strictly inside the data range (at least 2), with linear interpolation along each cell edge and saddles split by the cell mean. Corner hints show x min and x max along the bottom and y max above the top left, in real gutters, since they would be illegible over the filled bands.
- **Surface.** An orthographic projection of the grid normalized to a unit box (height exaggerated 0.55), yaw about the vertical then pitch. The floor and the two farthest walls draw as faint grids behind; cells with all four corners known paint back to front (the painter's algorithm, no depth buffer), colored by mean height on the height ramp and lit from the upper front left, at 0.86 opacity. X, Y and Z label the box edges.
- **Vector Field.** One arrow per cell, centered on the cell, colored on the height ramp by magnitude relative to the largest, length `0.15 + 0.85` of that fraction times 46% of the cell; positive v points up. The stroke thins on small arrows (`max(0.7, 7% of the cell × (0.55 + 0.45 · t))`), because a full-width stroke on a short arrow reads as a blob. The head is `min(4.5, 55% of the length)` long and 0.9 of that wide, drawn only when at least 2.2 pixels long (else the arrow is a plain line), and the shaft stops at the head's base so it can't poke past the tip. A cell with a null component draws a faint dot.

Tick labels on the canvas figures are compact: three significant figures with K, M, B above a thousand. Their text is `8.5 · fscale` pixels, and the gutters that hold it (the y-axis and label strips, the Calendar Heatmap's month and weekday rows, the Contour hints, the Waffle legend) grow with it.

## Mermaid

`MermaidView` loads `mermaid` on first use (one module per session, reached only by dynamic import, since mermaid pulls in d3 and dagre) and initializes it before every render with `securityLevel: "strict"`, `theme: "base"` and theme variables read from the live CSS variables: the node fills, borders and text shared by flowchart, class, state and ER diagrams, edges and labels, the flowchart aliases some diagram types read, sequence actors and notes, and the pie colors in the categorical palette's order, resolved through the active palette and mode. Over-specifying is safe, because mermaid ignores a variable a diagram type doesn't use. Strict security is kept because the source is a wired socket or a literal that rides in any shared document ([[C103]] untrustedContentSeams): labels stay text and click and href callbacks stay inert. Each render gets a unique DOM id from a counter. It validates with `mermaid.parse` first, then renders the SVG into its host element. A blank source renders nothing. A parse or render failure draws a `Diagram error` box with the message as its tooltip, never Mermaid's own error graphic. A theme change re-renders.

## Surfaces and sizing

The same value draws at several sizes; the renderer is always given pixel width and height.

| Surface | Size |
|---|---|
| Figure card | Fixed per node: Chart, Histogram, Merge Plots 218 by 150; Sparkline 218 by 56 (46 by 22 square-collapsed); Sankey 218 by 170; Surface 218 by 190; Waterfall, Candlestick, Boxplot, Proportion card width minus 22 by 170; Calendar Heatmap by 110; Vector Field by 190; the Dial at size 160. |
| Display, unsized | 210 by 130. |
| Display, resized | The body's measured size, at least 120 by 90; the card's resize floor is 230 by 150 for a chart, 200 by 120 for a diagram. |
| Popup | The window minus chrome, capped at 1000 wide and 380 tall (680 for Gantt), at least 200 by 140; after opening it follows the measured region minus 16 pixels padding a side (at least 160 by 120). Resizable, minimum 260 by 200 (520 by 300 for Gantt). |
| Report embed | The container's measured width capped at 640 (320 before the first measurement), 200 tall. KPI and Gauge draw before measuring; other figures wait for a width. |
| Socket peek | 200 by 120. |
| Composite boundary | 200 by 110. |

### What each card draws

- **Draws its own figure:** Chart, Histogram, Merge Plots, Sankey, Surface (with the rotate pad on the 3-D view), Waterfall, Candlestick, Boxplot, Calendar Heatmap, Proportion, Vector Field (through `ChartFigure`); Sparkline (a bare `ChartView` without axes, win/loss bars colored green, vermilion, or grid color for zero); KPI (the card itself, not collapsible); Gauge (the Dial, or the Bar); Mermaid (the diagram under its source box).
- **Draws only the `Chart` chip:** Record and Gantt. The figure would be squashed at card width, so it draws wherever the output goes ([[C63]] oneRecordNode). The Record card keeps its own pager when Row is unwired. The Gantt card registers an SVG serializer for exports (see Exports).
- **Collapsed:** a figure card shows the `Chart` chip in its hero box instead of the figure; Sparkline and the Dial square-collapse to a miniature; Mermaid shows a `Diagram` chip that re-expands the card.

The `Chart` chip (`ChartChip`) opens the popup with the value, titled by the chip's label, else the value's title, else `Chart`. An expand button in the figure's top right corner does the same on the Chart, Merge Plots, Sparkline and Display surfaces; the Chart card omits it for Composed and Bubble.

The popup (`ChartPopup`, one instance mounted in App, state in `chartPopupStore`, a module store because it is opened from inside rete's React root) holds a snapshot of the value, not a subscription. Its state carries either the whole chart `value`, which every surface uses, or, for the Sparkline and Chart expand buttons, the series path (`op`, `axes`, `series`, `labels`, `opts`, `signColors`); with a `value` the series fields are ignored. It opens at the window size less its chrome (32 pixels of overlay margin, a 38 pixel header and 32 of chart padding), and the figure region has 16 pixels of padding a side. It draws through `ChartFigure`, with `virtualize` on for Gantt (windowed rows), and offers Copy SVG for a Gantt (`ganttSvg` at the current width). For a Record card whose Row is unwired it pages with the on-figure pager and the left and right arrow keys (ignored while focus is in a text field), stepping the node's Row literal and swapping in the fresh value. `recordNav.ts` finds the Record node by walking up to 8 single-inlet hops from the surface's node; the card is steppable only in the Card view, with Row unwired and two or more records. A step clamps to `1..total` and recomputes the node; a wired Row means the cable wins and no surface offers arrows. A Sparkline's popup is drawn from the series it was opened with.

### Display

A Display holding a chart value draws `ChartFigure` with an expand button; collapsed, it draws the `Chart` chip. It passes `recordNav` when its source is a steppable Record card. A `MermaidValue` draws `MermaidView`, or the `Diagram` chip when collapsed.

### Report embeds

A Report's bare `{{ name }}` tag on a wired input becomes an inline reference (the `=name` code span, `embedBareVariables`), and a chart or diagram value there renders as a figure: in a Report, a collapsible block (open by default) titled by the value's title, else the input name; in a Note's inline span, the title as a caption above the figure. Any other use of the name in the template (a filter, a loop, a path) reads the data form, where a chart is null and a Mermaid value is its fenced source (`toTemplateValue`).

### Exports

The webpage export and Write to Obsidian take a chart as SVG from the source node: a registered serializer first (`registerChartSvgProvider`, keyed by node id), else the largest `<svg>` in the node's element that is not card chrome, serialized with computed styles inlined (`canvasCapture.ts`). The Gantt card and a Gantt drawn in a canvas Display register `ganttSvg(payload, { width: 1000 })`, a width independent of the on-screen size, so the export gets the whole chart. The card registers under its own node id, so a Report referencing it exports the figure with nothing mounted; the popup never registers, being transient. `ganttSvg` is imported eagerly, not with the lazy figure, because the export asks each provider for a string synchronously. Write to Obsidian rasterizes that SVG to a PNG asset. A figure that draws on a canvas, or a node not on the live canvas, exports nothing.

## A Format Controller on a chart socket

The `chart` family has one control, the text scale `chartFontScale` (×0.8, ×1 default, ×1.25, ×1.5, ×2), and nothing else ([[C94]] formatFamilyGates; the table is [[format-model]]). It is display-only: it never changes the value on the cable. The scale multiplies with the value's own `fontsize`: the payload figures get `fscale = chartFontScale · fontsize / 10`, and the recharts series figures compute the same product themselves.

- **Where it is read:** the Chart and Merge Plots cards (the FC on their own output), Display (`resolveDisplayAnnotation`: an FC on the Display, else one on its source output or downstream), the popup (the FC on the node it was opened from) and a Report embed (the FC resolved for that reference). The other figure cards do not read it.
- **Figures it affects:** every recharts series figure, Overlay, Composed, Bubble, Treemap and Sankey labels, KPI, the Bar gauge and Record (through `--chart-fscale`), Gantt, and the canvas text of Waterfall, Candlestick, Boxplot, Calendar Heatmap, Waffle and Contour. It has no effect on the Dial, Surface or Vector Field.

## Errors and empty inputs

Every figure node except Chart is subject to the error guard's short-circuit ([[compute-pass]]): a top-level `SolError` on any input becomes the `chart` output without running `data()`, and the guard also writes it to the card's `cachedChart` (and blanks `cachedPayload`), so a card never keeps drawing the last good figure. Chart runs on errors: a `SolError` on Data draws nothing, and one on Options falls back to the card text. Errors a node produces itself:

| Node | Error |
|---|---|
| Merge Plots | `#TYPE!` when a plot has no x/y plane. |
| Histogram | `#DOMAIN!` when bins is not 1 or more. |
| Sankey | `#SHAPE!` when every flow closes a loop. |
| Candlestick | `#SHAPE!` with fewer than four columns. |
| Gantt | `#VALUE!` with no task column, or a task without Start or Finish. |

A chart output that is a `SolError` renders as an error everywhere else: Display's error value box, a Report's inline error code, the Merge Plots card's error chip, the shared figure card's code with the message as its tooltip.

Empty is never an error. A figure with nothing to draw shows the muted em-dash box (`solenoid-node__display-value--empty`): the series path with no finite values, a Treemap with no positive value, a Sankey with no drawable flow, a Bubble with no point, a Waterfall, Candlestick, Boxplot, Calendar Heatmap, Waffle or Vector Field with no rows, a Contour or Surface with fewer than two coordinates on an axis or no finite height. A canvas figure whose rows all turn out unusable (every candle a gap, a waffle whose values are all zero) draws an empty canvas. The KPI and gauges draw their frame with a dash for a null value (the Dial at 0%). A Record with no data draws its boxes empty. Candlestick with no columns and Gantt with no table emit null, which surfaces show as an empty value. Blank or error cells inside the data are gaps, never zeros, in every figure (Sparkline, Chart, Waterfall, Candlestick, Calendar Heatmap, Contour, Surface, Vector Field); Proportion and Sankey read a blank value as 0, which draws nothing.

## Enforced by

`tests/graph/chartValue.test.ts`, `tests/graph/chartPopupCoverage.test.ts` (every op reaches the popup), `tests/graph/components/chartCore.test.ts`, `tests/graph/chartLabel.test.ts` (`sanitizeChartLabel`), `tests/graph/nodes/chartOptions.test.ts`, `tests/graph/nodes/visual.test.ts`, `tests/graph/nodes/mergePlots.test.ts`, `tests/graph/recordViews.test.ts`, `tests/graph/components/masonryLayout.test.ts`, `tests/graph/ganttBuilder.test.ts`, `tests/graph/ganttPayload.test.ts`, `tests/graph/nodes/gantt.test.ts`, `tests/graph/fcLambdaChart.test.ts`, `tests/graph/chartTitles.test.ts` (every target that offers a title draws one, draws a real op, and offers only keys a parser reads), and the source sweep in `tests/graph/sourceInvariants.test.ts` (only `chartRender.tsx` imports recharts).
