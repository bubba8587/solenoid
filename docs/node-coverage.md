# Solenoid — Node coverage

`nodeCatalog.ts` is the source of truth — the Add menu AND the in-app Function
Reference (Ctrl+/) are generated from it, so a node's catalog `description` is its
Reference entry. This file is a human-readable inventory by category plus the
non-obvious per-node notes. (Moved out of CLAUDE.md to keep the always-loaded doc
lean; update it when the catalog changes meaningfully.)

**Multi-op declarations (`nodeOps.ts`)** — one declaration per OP family (a node class with an `op` field). `expose` is the MENU axis: `"collapsed"` (default) gives one Add-menu leaf with every op reachable from SEARCH ("Chart: Column"); `"leaves"` generates a leaf per op — a family earns per-op leaves deliberately, the default keeps dropdowns from spraying the tree. The `{ }` marker is DERIVED, never declared (shown iff the node has ops with no leaf of their own; `mark: false` suppresses it for labels that already enumerate, e.g. "GCD / LCM"). There is no semantic axis: a family is in `nodeOps.ts` because its `op` field's values are ops; an ARGUMENT (a sort order, an aggregator, a view) is stored under its own name, picked with `ArgSelect`/`SegToggle`, and is not declared ([[C26]] opArgDistinct; `DESIGN.md` § Op pickers).

**Add-menu pane ROW BUDGET** — the rule behind every catalog regrouping: a category
pane holds about **12 rows** before it needs a scrollbar, so a pane growing past ~12
gets its tail folded into subcategories rather than left flat (the 2026-07-16 sweep
applied this across charts, statistics, hyperbolics, bitwise, and the frame verbs;
control widgets folded into Input 2026-07-09, freeing the top-level row Packs uses).
A future node addition that flattens a pane back past the budget reintroduces the
scrollbar that sweep removed.

**Scalar**:
- Input, Constant, Arithmetic (all ops), Math functions, Rounding, Trig, Hyperbolic, Logarithms, Combinatorics, Bitwise, Engineering.
- **Trig angle mode.** A Math node's trig ops carry a deg / rad / Auto SegToggle. Auto (the default) reads the incoming unit, so a °-tagged value computes in degrees and anything else in radians, as in Excel; Rad and Deg pin it. Forward trig converts the input, and inverse trig converts the result and tags the `deg` unit. `trigMode.ts` resolves it at recompute time, the one place compute reads units.
- **Comparison and Boolean logic** emit the first-class logical type (purple, TRUE/FALSE, converting to and from 1/0), and AND, OR and NOT are Kleene three-valued on `null`.
  - **`BooleanOpNode`**: AND, OR, XOR, NAND, NOR and XNOR as reducers over extensible operand rows, all emitting logical, so switching the op never swaps the socket. Operand inputs are `logicalcombo`, since a Boolean op takes Booleans; a number still bridges in (0/1 ⟷ FALSE/TRUE). The rows are wire-only, like IF's condition: you wire in a comparison or test.
  - **`NotNode`**: a unary element-wise flip.
- **The value selectors**, all variadic: **IF** (`IfNode`, a value passthrough, `util`-colored like its siblings, not logical), **IFS** (any number of condition and value pairs, plus an Otherwise fallback), **SWITCH** (any number of when and then pairs between a fixed `expr` and `default`) and **CHOOSE** (add and remove value rows over a fixed `index`). They use labeled rows, not list sockets; see the labeled-slots rule below and `docs/archive/node-arity-audit.md`.
- IFERROR and NA.
- **Type Check** (`IsTestNode`): an op dropdown of ISNUMBER, ISNULL, ISBLANK, ISERROR, ISNA, ISLOGICAL, ISTEXT and ISNONTEXT. The `islogical` op value keeps its name, and its label is ISLOGICAL, the real Excel name ([[D23]] capsClaimsFunction). ISNULL is the per-cell missing test, which is not the same as unwired. Every check tests per cell to any depth, Frames included. It doubles as the error-inspection surface (`../specs/error-values.md`).
- **ISEVEN / ISODD** (`IsEvenOddNode`): one parity node with an even / odd toggle, emitting TRUE/FALSE (not 1/0) and broadcasting over a list. It lives in the Logic menu.
- **Alert**: watches a value and, on a changed trigger, shows a toast and logs to the Alerts HUD (`../specs/alert-node-alerts-hud.md`).
- **Between** (inclusive Low ≤ Value ≤ High) and **Is Close** (|A − B| ≤ tolerance): `numListIn` predicates that broadcast like Comparison, with `logicalcombo` out.

**Lists**:
- **Literal** and **Series**, one list-generator node with Range, SEQUENCE, LinSpace, Geometric, Fibonacci and Repeat as ops. Start is shared, so switching ops keeps the cable.
- **Aggregate** (`AggregateNode`): a fixed-op 1-D reducer with 20 ops (sum, avg, min, max, count, countdistinct, median, product, stdev, var, geomean…). It isn't called Reduce, so it can't be confused with the REDUCE LAMBDA helper, which takes a table.
- **List Filter**: 1-D only, filtering a list against its own values with the Frame Filter's condition engine (extensible AND / OR op and value rows, text ops, Match case), on an `anylist`. Tables go to Frame Filter, which a matrix enters with auto-named columns Col1…N. The permanent `Dropped` output is the exact complement.
- **Fill** (`FillNode`): the missing-value node, with ops constant, ffill, bfill, mean, median, mode, interpolate, drop and coalesce. Per-cell errors pass through, and the statistics impute from the present values.
- List Sort, Reverse, Slice, Unique, Diff, Interleave, Pad, Shuffle, NthElement, Index, Length, Contains, NthValue, ArgMin / ArgMax, SumProduct. Take and Drop are the one rank-preserving `TakeDropNode` under 2-D Tables ▸ Select: a list, matrix or scalar in, the same rank out.
- **Position-only ops are passthroughs.** Reverse, Slice, Shuffle, NthElement, Interleave and Pad are element-agnostic `anylist` ops. The single-input ones (Reverse, Slice, Shuffle, NthElement, Pad, plus the matrix ops TRANSPOSE, CHOOSEROWS / COLS, TAKE / DROP and EXPAND) have adoptive inputs and outputs and a `passthrough()` declaration, so a reversed or transposed date list stays a date list with date formatting downstream. The multi-input rungs of the append ladder (Concat Lists, Interleave, VSTACK / HSTACK) declare `agree` over their rows, and the rank-changing TOCOL and WRAP ops declare a rank projection. See `nodes/passthrough.ts` and `../specs/type-propagation-on-in-place-socket-retype.md`.
- **Set** (`SetOpNode`): two-list union, intersection, difference (A ∖ B) and symmetric difference. It compares by value, dedupes and keeps first-seen order like UNIQUE, ignores nulls, and keeps errors except in intersection. Excel ships only UNIQUE.
- **Set relation** (`SetRelationNode`): the companion predicates, equal, subset (A ⊆ B), superset (A ⊇ B) and disjoint, giving TRUE/FALSE with the same value-set rules as Set. Both unwired gives null.
- **Concat Lists**: the 1-D rung of the append ladder. Any number of element-agnostic `anylist` rows joined in row order; a scalar widens to a one-item list.
- **Running** (`RunningNode`): a SegToggle picks the window. Cumulative grows it from the start, and Last N slides it and shows a Window size input. Seven ops: sum, avg, min, max, median, product, stdev. On the formula surface it is one function, `RUNNING(op, list, [window])`, with the aggregator as a string argument ([[C56]] aggregatorsAreArguments).
- **Rank & Percentile**: one order-statistics node with LARGE / SMALL, RANK.EQ / AVG and PERCENTILE / QUARTILE / PERCENTRANK, including the INC and EXC forms, as ops. All take a list and one scalar and give a scalar; RANK and PERCENTRANK share the Value key.
- Normalize (a 0–1 / z toggle), Standardize, Correl, Covariance, Fisher.
- **Regression:** LINEST (a linear / exponential toggle that absorbs LOGEST; the three outputs retitle between slope / intercept / R² and m / b / R²-log, with keys unchanged so cables survive), FORECAST.LINEAR (a linear / exponential toggle that absorbs TREND and GROWTH; X may be a scalar or a list, and the result mirrors its shape), STEYX, Poly Fit, Grid Interpolate.
- **Transform** (each also a formula): DIFF (a Δ / % / ∇ gradient toggle), Shift (blank, or wrap like `numpy.roll`), Bin (digitize), EWMA, Convolve, Integrate (trapz), Run Lengths (rle, into a value and count table). **Build:** Combinations (a combos / perms toggle, capped at 10k rows). Toggle cards share `makeToggleNodeComponent` (`standardNode.tsx`).
- **From the Python and R survey** (`python-r-gap.md`, Tier 1): Aggregate gained PTP, IQR, MAD, SEM, CV and RMS; Correl gained SPEARMAN and KENDALL; Bin gained a quantiles mode (NTILE); Outliers (z, IQR or MAD, into one Value / Outlier frame); Spectrum (FFT); Text Similarity and Fuzzy Match (Text ▸ Measure & Encode); Forecast (ETS) under Regression; and Hypothesis Test gained ANOVA, Kruskal–Wallis, Mann–Whitney, Wilcoxon, Fisher exact, KS, two-proportion z and binomial (with table sockets for the k-group ops).

**Stats**: the ONE Distributions node (oneDistributionNode, below) covers the distribution families; **Hypothesis Test** is likewise ONE node (nodeCombiningRound1): Z.TEST / T.TEST (paired, equal var, Welch) / F.TEST / CHISQ.TEST as ops — every op emits a p-value, the two-sample ops share the a/b keys so switches keep cables.

**Finance**: TVM — ONE acausal Equation node covering PMT/PV/FV/NPER/RATE (wire four of {rate, nper, pmt, pv, fv}, the fifth solves; payment-timing dropdown swaps the locked relation; rate = 0 uses the exact limit form), Compound Growth (fv = pv·(1+rate)^nper; covers PDURATION/RRI) and Effective Rate (EFFECT/NOMINAL) as locked Equation presets, IPMT/PPMT, CumPmt, NPV and IRR (each with a Periodic/Dated SegToggle — Dated reveals a Dates input and IS XNPV/XIRR, nodeCombiningRound1), MIRR, depreciation (ONE node since nodeCombiningRound1: SLN/DB/DDB/SYD/VDB, per-op input rows), bond pricing (PRICE/YIELD, odd coupons, accrued interest).

**Distributions**: ONE Distributions node (oneDistributionNode, 2026-08-09): a distribution dropdown (normal, standard normal, **PHI** — φ, the standard-normal density — and **GAUSS** — Φ−½, the 0-to-x half-area, both single-input forms that moved here from the Math node 2026-08-25, t, chi-squared, F, beta, gamma, lognormal, Weibull, exponential, binomial, Poisson, hypergeometric, negative binomial) plus a form dropdown (CDF / PDF / PMF / tails / inverse; GAUSS carries the one "Φ − ½" form); the inverse trades the x input for a probability, a distribution switch swaps the parameter inputs. `DIST_SPECS` in `nodes/distribution.ts` is the SSOT. BINOM.DIST.RANGE stays its own node. Z/T/F/Chisq tests unchanged.

**Text**:
- Text Input, case/trim transforms, CONCAT, TEXTJOIN/SPLIT, LEN, FIND/SEARCH, SUBSTITUTE/REPLACE, TEXTAFTER/BEFORE, **Regex** (REGEXTEST/EXTRACT/REPLACE), VALUE/NUMBERVALUE, TEXT/DOLLAR/FIXED, ROMAN/ARABIC, CHAR/CODE, ENCODEURL.
- **Every element-wise text node broadcasts.** Operands are `strcombo`/`numlist`, and a wired list spills element-wise, Excel-array-formula style (`=UPPER(A1:A10)`). See the Element-wise operand rule below.
  - There is no separate Text Map ("UPPER (list)") node: Text Transform with a list wired in does that job.
- **The exceptions are deliberate:**
  - CONCAT/TEXTJOIN reduce a set to one string (Excel's CONCAT flattens an array rather than spilling).
  - TEXTSPLIT is already 1-D → 1-D. Broadcasting would need a rank-2 result, and the lattice has no 1-D→2-D edge for it.
  - Regex stays on the wildcard ladder because its element type depends on the op. It emits `anycombo` rather than `any`, so its dot doesn't draw a scalar circle on a port that can spill a list.

**Date & Time**: TODAY/NOW, DATE/TIME construct, date parts, WEEKNUM/WEEKDAY, DATEDIF, **Workdays** (ONE node, nodeCombiningRound1: WORKDAY/NETWORKDAYS as inverse forms — the op swaps Days↔End date and retypes the output date↔number via `retypeOutputCables`), date formatting.

**Complex numbers**: COMPLEX build/unpack, 16 unary ops, 4 binary ops, IMPOWER.

**Build Frame** / **Frame from Lists**: the matrix⇄frame constructors, both type-by-adoption.
- Build Frame puts headers on a table to make a Frame. Frame from Lists turns N typed lists into a mixed Frame. Adding columns is other nodes' job.
- Their value inputs are **adoptive** sockets (`adoptiveTableIn`/`adoptiveListIn`: an `AdoptiveSocket` with an `anytable`/`anylist` base instead of `trueany`). They accept any element family and adopt the wired cable's concrete type via `settleWildcardTypes`, so a `datetable`/`datelist` gives **date columns**.
- This is the only way `date` survives, because a serial is indistinguishable from a number at the value level.
  - `colTypeForSocket` maps the adopted socket to a `FrameColType`. It returns `null` for a not-yet-adopted `anytable`/`anylist` or for `complex`, which falls back to value inference.
  - `typedColumn`/`buildFrameTyped` (core `frame.ts`) do the typing. A numeric matrix still routes through the unchanged `buildFrame` (byte-identical).
  - There is no `columnFromCells`, and Frame from Lists does not deliver dates as numbers to retype downstream.
- Headless (`run-graph.ts`, no settle pass) degrades to value inference (date→number).

**Split Frame** (`SplitFrameNode`): Frame → Matrix + Headers, with a **column-type filter** SegToggle (All / Num / Date / Bool / Text). Filtering to a type pulls just those columns out of a MIXED frame (which plain "All" can't — any text column makes the number matrix null); both Matrix and Headers are filtered. **The Matrix output socket type tracks the filter** (`splitMatrixOutput` + in-place swap via `applySplitColType`, like Get Column's read-as): number/all → `table`, date → `datetable` (serials), bool → `logicaltable` (1/0), text → `strtable` (a real string matrix, not null). `colType` persists via extractInit.

**Frames / Table verbs** (`nodes/frame.ts` + `frameVerbs.ts`; the relational family):
- **The verbs:** Get Column (read-as retypes, Boolean included), Get Row, Add Column, Frame Filter, Frame Sort, Join (including as-of, semi and anti modes), GROUPBY, Append, Distinct, Head, PIVOTBY, Unpivot, Nest and Unnest; the cleanup verbs (Fill Down, Replace Values, Drop Blank Rows, Keep Columns and Drop Columns, Rename, Split Column, Merge Columns, Add Index, Headers); Reconcile; and the Cube family (Nest Join, Build Cube, Cube Columns, Cube Rollup).
- **Add Column** is Cube-adoptive, like Computed Column: a Cube in appends the new column per row, carries the nested columns through by reference, and comes out a Cube (`cubeWithColumn`).
- **Add Index** has a two-way option (the author's call): the same data indexed on both axes as a matrix with coordinate borders, exactly the grid that Surface, Contour and Grid Interpolate read. A wired matrix widens to Col1…N and gets row and column indices counting from Start.
- **Frame XLOOKUP's `search_mode`** decides which row wins on duplicate keys: "first" (the default, Excel's mode 1) scans top to bottom, and "last" (mode −1) bottom up. Excel's binary modes (2 and −2) are left out on purpose: on a materialized column, a binary search over sorted data finds the same row a linear scan does, so it would be a speed setting with no different result, and the scan is always linear.
- **Reconcile** classifies each key as added (right only), removed (left only), changed (a shared column differs) or unchanged, with before, after and Δ for each shared number column. When both a price and a quantity column are named, and are numbers on both sides, it splits the total (price × qty) change into the standard price, volume and mix variances: price = (P1−P0)·Q0, volume = (Q1−Q0)·P0, mix = (P1−P0)·(Q1−Q0), which sum exactly to P1·Q1 − P0·Q0.
- **Computed Column** (`ComputedColumnNode`; [[C22]] rowFormulaRefs, [[C54]] noPerCellFormulas) adds one defined column mid-pipeline, from an inline formula or a wired λ. A bare name or `[Name]` is the whole column as a list, and `@name` or `@[Name]` is this row's cell; λ parameters are bound to the row. Each free name grows an `anydata` side-input socket (`sideVars`, saved) with a column-binding picker. `addAs` types the result and `After` places it. This node is why Frames stay out of formulas ([[C15]] matricesInFormulas): the row loop lives here, so the formula sees one row's cells and whole columns as lists, never the Frame. The Frame stays plain data and the calculation is a node on the graph. Per row: an error in any bound column becomes that row's result (the first in binding order wins), and a null reaches the formula, so ISBLANK and IF can see it. The output type is inferred from the computed cells, with one addition cells can't show: a formula that keeps a date a date types the column Date (`exprYieldsDate`: a date column read, a function declared `returns: "date"`, date ± days, or an IF whose branches are dates; date − date is a span and stays a number, [[D41]] formatFlowsDownstream). A `Name (unit)` header tags the unit, as in Add Column. Frame Input's **Fx** column type is the same model: a formula row under the header, where a wired λ is called by its socket name (`λ1` or `λ1(@a, @b)`). Both surfaces run `computedColumnCore.ts`, so they can't disagree.
- **Query** is a Composite shaped for data transformation: a verb chain inside, in Manual refresh mode, the Power Query shape ([[C53]] queryIsCompositePreset).

**2D Tables / Matrix** (node kind `table`, a vermilion accent matching the table socket; see `kind.ts`):
- **Table Input** grid: a literal source on Frame Input's model. Raw text is the stored truth, bad cells derive to NaN with the quiet affordance, and the grid editor edits Source text.
  - One element type per table, picked by a Num/Text/Date/Bool SegToggle that retypes the output socket in place. The header accent tracks it.
- MMULT, MDETERM, MINVERSE, MUNIT, TRANSPOSE.
- **VSTACK/HSTACK**: the 2-D rungs of the append ladder ([[C48]] appendLadder). N extensible `anytable` rows stack in row order, a list counts as one row, and ragged inputs pad with #N/A cells like Excel.
- WRAPROWS/COLS (leftover cells pad with #N/A, Excel's default pad_with), TOCOL/ROW, CHOOSEROWS/COLS.
- **TAKE / DROP**: one rank-preserving card for the 1-D and 2-D forms. A list, matrix or scalar goes in and the same rank comes out. The sign of the count is the direction, and 0 means an omitted arg.
- **EXPAND**: grows to R×C, filling with the wired Fill or #N/A. Shrinking is #VALUE!.
- ROWS/COLUMNS, DIAGONAL (numpy.diag; off-diagonal 0 or blank, MUNIT's toggle), OUTER, Cross Product (3-vectors).
- TRACE / MATRIXRANK / NORM are MDETERM card ops. The op switch retypes the output number ↔ table.
- Solve A·x = b, Eigen (symmetric, Jacobi).

**Input/Control**:
- Number Input, BooleanInput, Slider (its ◄/► step buttons are the "stepper"), AngleDial, Slicer, Date Range, RandBetween, RandArray, Sequence.
- **Date Input**: type any date (ISO, day-first numeric, ordinals, month names, via the shared chrono-backed `parseDate`) or use the native calendar. It renders DD-MMM-YYYY and keeps the raw text. An ambiguous numeric like 3/4/2026 gives `#AMBIGUOUS!`, never a guess.
- **XYPad**: drag a 2D handle to get X/Y in [0,1].
- **ColorPicker**: RGB / HSV sliders with gradient-painted tracks, or a Hex text field as a third mode.
  - An output-format dropdown picks hex or rgb, CSS-valid only (no `hsv()`/`hsl()`). The output socket sits on the swatch row below the dropdown.
  - Conversions go through the `colord` lib. It feeds Chart Builder's Color.
- **ColorBlend** (kind `string`): two CSS color-string inputs, typeable or wired, and a blend-mode dropdown (mix/multiply/screen/overlay/soft·hard-light/darken/lighten/difference/exclusion/dodge/burn).
  - It uses the W3C separable formulas per RGB channel, with A as the backdrop. Hex comes out on a ColorPicker-style swatch row.
  - Unparseable input gives `#VALUE!`. `colord` loads the `names` plugin globally, so "tomato" parses.
- **Save Times**: the last autosave and the last write-to-file as two date serials, per document, read through the leaf `saveTimeStore` seam. Refresh and Save buttons sit on the rows.

**Output**:
- **Display**, and **Cast**: universal type conversion to number, text, date, complex or **Boolean**, item by item on lists. The Boolean target gives a real `logical` from "TRUE" / "FALSE" text or a nonzero number, through `coerceLogical`. Cast replaces the old single-purpose TEXT, VALUE and Format Date coercers.
- **Visual nodes** (`nodes/visual.ts`, the `display` kind, drawn with recharts unless noted). They all flow the `chart` socket, so each one embeds in a Report like a chart:
  - **Sparkline**: an inline line, column or win-loss view of a list.
  - **Chart**: 11 kinds (column, bar, line, area, pie, radar, radial bar, funnel, scatter, composed, bubble).
  - **Gauge**: a value on a fixed scale, with a Dial / Bar style selector. Dial reads the value as a fraction (1 = 100%, fixed at 0 → 100%) and minifies to a square; Bar is a 0 → Max track with a target tick, and absorbed the former Bullet node. It emits a chart value, not a passthrough, so a Report embeds the readout.
  - **Heatmap**: a table in, a cool-to-warm color grid out.
  - **Mermaid** (`MermaidNode`, a wide card) is the one that isn't recharts. Mermaid.js source text in (typed on the card or wired to `source`), a `MermaidValue` out the `chart` socket (a sibling brand to `ChartValue`, in `mermaidValue.ts`). `MermaidView.tsx` imports mermaid (heavy: d3 and dagre) only when a diagram is on screen.
  - **Record**: Frame rows as labeled boxes on a text-defined grid, with three views on one op selector. **Card** shows the picked row, from the pager or a wired 1-based `Row`, and echoes the resolved pick out `picked` so downstream follows the pager. **Gallery** tiles every row as a card. **Board** makes lanes keyed by a `Group by` column, with blanks last in a `—` lane and the grouping column skipped from the default stacked cards. Gallery and Board cap at 60 cards with a `+N more` line. The layout has one line per grid row, with cells split on `|`; a repeated name merges its cells, and a string cell holding a `data:image/` or image-extension URL draws as the picture. The card itself never draws the grid; it carries the [Chart] chip, and the drawn card appears wherever the chart output goes (a resizable Display, the popup, a Report embed). DOM view: `RecordCardView` in `chartCards.tsx` (touching square boxes). Seed: `record-cards`.
  - **Gantt** (`nodes/gantt.ts`): a scheduled project drawn as a Gantt chart, with bars, milestone diamonds, summary brackets, dependency arrows, the critical path, a today or status line, and shaded non-working days. A Schedule `cube` goes in, plus an optional baseline table and Holidays / Weekend for the shading. It computes no dates itself and only reads the columns Schedule appended; `ganttPayloadFromSchedule` builds the data-only payload, and the figure lays it out at its width. It emits a `chart` value of kind `gantt`; like Record, the card carries the [Chart] chip and never draws the timeline, and the figure draws in Display, the popup and Reports, windowing its rows in the popup.
    - Layout and headless SVG live in `@solenoid/gantt-layout`, the React view in `@solenoid/gantt-react`. The popup has a Copy SVG action, and the export paths pull that SVG through the `data-chart-svg-provider` seam.
    - Options include `layout=calendar` (the month-grid sibling), `histogram=on` (a resource band under the timeline from Resource and Units columns, with over-allocation marked), `fit=page` (export fit for long spans) and `minutes=on`. A task's Segments draw as split bars. The tree grid has a keyboard map (arrows, Home / End, Left / Right fold a phase, Enter toggles) behind `.nokeys`.
    - A composite's By-Row mode iterates a Cube's rows too (one single-row Cube per pass, nested cells kept), so a portfolio Cube of projects schedules row by row. Seeds: `product-launch-gantt` (also as a calendar) and `kitchen-remodel-tasknotes`.
  - The rest of the figure catalog: Boxplot, Candlestick, Surface (with Contour as its Flat view: one node, two leaves), Waterfall, Waffle, Calendar (heatmap), Vector Field, the Proportion category (the Proportion node with Treemap and Waffle layouts on an `op` selector, plus Sankey), and the draw-your-data inputs (Point Plotter, Curve, Grid Painter).
- **The standing rule:** rich visuals are node outputs flowing the `chart` socket, never Report markdown features; Reports stay plain text plus embeds. A LAMBDA wired into a Report renders as KaTeX through the same inline-reference path (`inlineRefDisplay.tsx`).
- **Chart UI.** The chart op pickers use `SegToggle` (the Format Controller's segmented selector), not a dropdown. Hover shows a `formatScalar`-rounded readout, and the ⤢ expand button is the shared `solenoid-expr__expand`. Sparkline, Chart and Heatmap use the wide card (`nodeWide`) so the plot fits. Sparkline and Chart share one `ChartView` (`components/chartView.tsx`) and an expand popup (`chartPopupStore` + `ChartPopup`, mounted in App like FormulaPopup and TablePopup). Chart's `values` socket is centered on the plot by measurement, with `options` on its own row below. Chart Builder's and Color's output sockets are measured onto their readout rows (`hideOutputSockets` + a `MeasuredSocketRow side="output"`).
- **Chart options.** Twelve figures (Chart, Histogram, KPI, Gauge, Proportion, Sankey, Waterfall, Candlestick, Boxplot, Calendar, Record, Gantt) have an `options` string socket. It is typeable inline (an InlineInputs text row) or fed by the **Chart Builder** node, a labeled "Concat for chart options" whose fields are each also inputs, emitting a flat `key=value;…` string.
  - Chart Builder's chart-type dropdown (`CHART_BUILDER_TARGETS` in `chartOptions.ts`) shows only the option rows the chosen figure reads. Wired or filled rows stay visible, dimmed, and serialization stays full, so one builder can feed several charts. An option a figure can't express, like `marker` on a treemap, is simply ignored, as in matplotlib.
  - The keys use matplotlib's names: `title`, `xlabel`, `ylabel`, `color`, `grid`, `marker`, `ylim`, `linewidth`, `markersize`, `alpha`, `fontsize` (in points, where 10 is the built-in size; an FC on a chart socket multiplies on top with its display-only text scale, see `docs/format-model.md`). `title` overrides the node label as the figure title wherever it applies.
  - `nodes/chartOptions.ts` (`parseChartOptions` / `serializeChartOptions`) is the one source of truth, and `ChartView` applies the parsed `ChartOptions`. That configurability is what separates Chart from the deliberately minimal Sparkline.
- Every family's combo socket (`strcombo`, `datecombo`, `complexcombo`, `logicalcombo`) mirrors `numlist`: scalar or list, drawn as a two-color split square.

**Find (under Lists)**: XLookup, XMatch. Convert (unit conversion) sits under Output. (Classic MATCH / VLOOKUP / HLOOKUP omitted — XLOOKUP/XMATCH supersede them.) **XMatch carries the same `search_mode` as the frame XLOOKUP** (First / Last — which duplicate wins; binary ±2 omitted for the reason above), so the two lookups and their formula forms all take the same two mode arguments; the shared kernel is `xmatchIndex` (`listOps.ts`).

**Connections & sinks**:
- **Web Source**; **Data Feed** (keyed providers; auto-refresh).
- **Local File**: CSV/Parquet by extension.
  - A Project XML file, or a Smartsheet-style CSV whose Predecessors use row numbers, also comes out a `plan` cube socket (`planImport.ts`). The outline becomes nesting, names are resolved from row numbers at the border, typed links become a Task · Type · Lag table, and the flat outline goes on `frame`.
  - `planNotes` carries what an MSPDI read could not model.
- **Geocode**: place name → lat/lon/IANA timezone, from Open-Meteo, keyless.
- **Weather** (Open-Meteo): a past+future Daily frame and the Now temp. °C/°F carries the unit downstream.
- **Holidays** (Nager.Date): a year's public holidays as a frame, a Dates list feeding NETWORKDAYS/WORKDAY, and days-to-next. The region is optional.
- **Currency** (Frankfurter ECB FX): a **Spot/History** `mode` swaps the sockets in place.
  - Spot: Amount/From/To → Converted (authored with the target currency as an FC unit), plus Rate and As-of.
  - History: From/To and a typeable date range → a Date·Rate `frame` to chart. The range endpoint fetch sits behind the same [[C104]] foreignDocNetworkGate gate.
- **Vault Folder** (`nodes/connection.ts` VaultFolderNode + the pure `vaultCube.ts`/`mdbaseTypes.ts`/`obsidianTypes.ts`/`dailyNotesConfig.ts`; in the Connections › Obsidian menu with the other vault nodes): an Obsidian folder becomes one `cube`, a row per note.
  - Columns: the Bases `file.*` built-ins (path/name/folder/ext/size/created/modified/tags/links/embeds/date) plus the frontmatter union. Scalars are typed, lists become list cells, and rows-of-objects become nested frames.
  - Typing per key: mdbase, then `.obsidian/types.json`, then a guesser widened across rows. R3 date-from-name uses the daily-notes format by default.
  - **`folder` and `glob` are wireable string inputs.** A cable drives which subfolder and name filter to read; otherwise the card's dropdown and field do (they disable when wired). `data()` resolves each, and `load()` reads the resolved values.
  - Include-body puts the body in a **`note-body`** column, the reserved property Write Properties round-trips as the note's body.
  - There is no per-node vault: the vault nodes use the app-wide `obsidianVault` setting.
  - It is a desktop-only local read (no network gate). On web it emits nothing. `statVaultFile` backs created/modified.
- Import HTML / Import XML, Import Obsidian Note.
- **Write File** (CSV/JSON) / **Write to Obsidian**: disk writes fire only from the node's Run button ([[C38]] sinkRunButtonOnly).
- **Data Quality**: Expect (inline assertions that pass data through and report violations), Tornado (sensitivity sweep figure).
- **Canvas/meta**: Session History (live undo/redo log, non-persisting), Presentation (presenter-mode step list).

**Formula**:
- **Expression** takes a formula like `a * b + 1`, and each variable becomes an input socket. Its inputs are `anydata`: a single value, a 1-D list or a 2-D matrix. Frames and Cubes never enter a formula ([[C15]] matricesInFormulas); per-row math on a Frame is a Computed Column.
- `pi`, `tau`, `e` and `phi` are constants, not variables (`FORMULA_CONSTANTS` in `excelFormula.ts`). `extractVariables` skips them, so every formula surface sees them.
- **Variable descriptions:** each variable can carry a prose description (`varDescriptions`), kept out of the formula string so KaTeX never renders it. It shows as a hover tooltip on the card and an editable legend under the KaTeX in the formula popup. Expression, Equation and LAMBDA share that popup; some pack presets (Ohm's Law, ideal gas) ship descriptions. A LAMBDA wired into a Report renders as KaTeX with a muted "where:" legend of those descriptions.
- **The LAMBDA helpers** are MAP, BYROW, BYCOL, REDUCE, SCAN and MAKEARRAY, each running an inline formula or a wired LAMBDA. SCAN folds like REDUCE from Initial but emits the accumulator after every cell, in the input's shape: a running total is `acc + value`, a running max `MAX(acc, value)`. Running covers the common aggregates without a formula, and REDUCE gives only the final value.
- **Polyform:** a Number / Text / Date / Auto result-type selector on Expression, the LAMBDA helpers and LAMBDA lets them loop any Excel function over arrays of any element type (`UPPER(name)`, `first & " " & last`, `DATE(y,m,d)`), and the output socket changes to match. LAMBDA's capture sockets are `anylist`.

**Script** (`ScriptNode`, `nodes/script.ts`, [[C66]] scriptNode; the bounded form of out-of-scope §4): a JavaScript function expression as a node. It is named Script, not Code, because CODE is the Excel node ([[D21]] noExcelNameClash).
- **Inputs.** Its parameter names are `anydata` inputs, re-derived on commit (`applyScriptChange`, Expression's mechanic).
  - With `autoLiterals`, an unwired parameter takes a typed number or text. Unwired and untyped is `undefined`, and a wired blank is `null`.
  - Inputs are trueany: a wired frame (materialized in full) or cube arrives as the same rows-of-objects (`scriptArgToJs`). Lambdas, charts and documents error before the run.
- **The return value types itself.** `scriptCoerce.ts` folds it onto the value model; there is no declared result type.
  - Numbers, text and booleans are their own families. A `Date` or `Solenoid.date(serial)` is a date.
  - Rows of `{name: value}` objects build a Frame with typed columns, and rows nesting rows or lists build a Cube.
  - NaN is `#DOMAIN!`, unsupported values are `#TYPE!`, and anything beyond the accepted shapes is `#SHAPE!`. A list, table or frame column mixing families is `#AMBIGUOUS!`. Ragged rows are padded with null.
  - The result socket reconciles family and rank off the value.
- A volatile source (Math.random, Date.now, argless `new Date`, …) grows the shared Recalculate button (`scriptIsVolatile`).
- It runs in the sandbox Worker under a 1 s wall clock (`../specs/script-sandbox.md`).

**Equation** (`EquationNode`, `equationSolve.ts`, [[C47]] equationNode): the acausal sibling of Expression.
- Type a relation (`V = I * R`). Every variable gets an input and an output socket, plus a fixed logical **Check** output (output key `holds`).
- **Exactly one unknown** (unwired, empty literal) is solved:
  - Symbolic AST isolation when the unknown appears once (`+-*/^`, POWER/LOG, EXP/LN, SQRT, trig/hyperbolic, DEGREES/RADIANS, unary minus, %). The isolated form unparses to a formula and recompiles, so list broadcasting is free.
  - Otherwise, a residual that is quadratic in the unknown (numerically probed, any arrangement) solves via the quadratic formula and yields every real root as an ascending list (x² = 36 → [-6, 6]). A double root is a scalar, and a negative discriminant is #SOLVE!.
  - Anything else falls to a numeric log-grid + bisection fallback on the LHS-RHS residual (scalar-only, `#SOLVE!` when there is no real root).
- **All variables known:** Check is a relative-tolerance (1e-9) truth check, broadcasting per element.
- Inversion takes principal branches (sqrt, ASIN).
- Wired variables pass through to their outputs, so the node doubles as a labeled junction.

**Import Obsidian Note**:
- **The source note is a wireable identity.** It has a `path` **output** (vault-relative, `.md` included, matching a Vault Folder cube's `path`) and a `path` **input** that loads that note in the background, replacing the picked one (`loadFromWire`: read the file, adopt the body and frontmatter sockets, recompute; the VaultFolder guard pattern).
  - The note's own title (its file name) renders at the top of the card body.
  - `NoteNode.reservedOutputs()` keeps the path output through `syncFields`.
- **Reload cadence:** `refreshMinutes` (persisted; 0 = off). The picker's foot carries "every N min", and the component reruns `reload()` on the cadence while a file is picked (desktop). The watcher hook waits on the Stage-0 desktop watcher.
- **Midnight rollover** (R5, `volatileDates.ts`):
  - `hasVolatileDates(nodes)` spots `TODAY()`/`NOW()` in an `expr` or a frame's formulas, and a relative Date Input phrase.
  - `armMidnightRollover` (installed by App) runs `requestRecalc()` at each local midnight when one exists. There is no setting.
  - Tests: `volatileDates.test.ts`.

**Headless seam**: `fileBridge.ts` has an injectable `FsProvider` (`setFsProvider`; `hasFs()` means the desktop shell or an installed provider).
- The vault readers and writers (`listVault*`, `readVaultFile`, `statVaultFile`, `readTextFilePath`, `writeTextFilePath`, `ensureDir`, `pathExists`, `joinPath`, binaries) route through it. The Obsidian sinks and readers gate on `hasFs()` instead of the shell.
- `scripts/run-graph.ts` flags:
  - `--vault <path>` installs the Node provider and points the Obsidian nodes at it.
  - `--tasknotes <url>` lets Node's fetch reach the plugin.
  - `--run <sink name>` arms and runs one named sink after the compute. It is the Run button's headless equivalent ([[C38]] sinkRunButtonOnly).
- With a vault or url, the runner awaits every background load (`connectionStore.trackInflight` / `whenConnectionsSettled`) and computes again, so the printed values include what was read.
- Test: `scripts/run-graph-vault.test.ts` over `demo-vault/` (a read, and a `--run` write into a temp copy).
- Dialogs and the OS opener stay desktop-only.

**Open in Obsidian** (bundle item D, first half, 2026-09-07): `obsidianLinks.ts` builds `obsidian://open?vault=<vault folder base name>&file=<vault-relative, no .md>`; `openExternal` launches it (the opener capability is widened to `obsidian://**`). On the Import Obsidian Note header (when a file is picked) and on Write to Obsidian after a successful Run (`lastWritten`, transient). The Vault Folder card takes the same helper. The stub note + `solenoid:` backlink are D's second half, below (Links both ways).

**Write to Obsidian → Note** (the Note target):
- **Modes.** `mode` is overwrite | append | block on the card (SegToggle; persisted). A missing note is created in every mode. `mergeNoteText` (`obsidianWrite.ts`) is the pure merge.
  - `block` splices the assembled markdown between `%% solenoid:begin <node name> %%` and `%% solenoid:end %%` (`managedBlock.ts` `spliceBlock`). Markers in a code fence are text, and a begin with no end gets a fresh pair. Content carrying `%%` outside a fence is refused with the line, so nothing invisible is written.
  - `append` adds after one blank line.
- **The target is a single vault-relative `path`**: a wireable `string` input, set by an InlineInputs literal or else a cable (e.g. a Vault Folder row's `path`).
  - A **Browse** chooser lists the vault's notes (the Import picker).
  - A `folder/name` path splits, and the leading folder prepends to the subfolder `<select>`. `renderedTarget()` does the split.
  - A blank name still batches (`writeDocumentToVault` names each page).
  - There is no `{{date}}`/`{{daily}}` template grammar, `date` input or `nameTemplate.ts`. To date a note, wire a formatted date into `path`.
- Tests: `managedBlock.test.ts`, `obsidianWriteModes.test.ts`.

**TaskNotes** (`nodes/taskNotes.ts` + the pure `taskNotesApi.ts`, input kind, Connections › Obsidian menu): the TaskNotes plugin over its local HTTP API.
- Settings: `Settings ▸ Obsidian ▸ TaskNotes API`, default `http://localhost:8080`. The bearer token lives in `apiKeyStore("tasknotes")`, typed on the card, never in the settings file.
- One node, with a `provider` select that reshapes the sockets:
  - **Tasks** → a `tasks` cube: path · title · status · priority · due · scheduled · completed · timeEstimate · trackedMinutes · archived; then projects · contexts · tags · blockedBy as list cells; timeEntries (Start · End · Minutes · Description) and complete_instances (Date) as nested frames; created · modified; then every user field as its own column in first-seen order.
  - **Calendar** → `from`/`to` date inputs (unwired: today .. today+7; a wired blank fetches nothing) and an `events` frame (Title · Start · End · Source).
  - **Stats** → five number outputs.
- It pages `GET /api/tasks` (200 per page) until `hasMore` is false. `{success,data}` envelope errors surface in the status line (401 → "token"; unreachable → "turn on its HTTP API").
- The WebSource sync-background fetch, keyed on provider + url + window, rides the [[C104]] foreignDocNetworkGate gate.
- The provider switch prunes departing cables through `dropInputCables` + `dropStrandedFrontmatterCables` ([[D10]] onePrunePath).
- Tests: `taskNotesApi.test.ts` (one fixture per endpoint), `nodes/taskNotes.test.ts`. Write Tasks is below.
- Not yet: the calendar-events source shape beyond title/start/end/source.

**Write Tasks** (`nodes/taskNotes.ts` `WriteTasksNode`, sink kind, Connections › Obsidian menu): rows (a `cube`; a frame widens) go to the TaskNotes API.
- A row with a `path` → `PUT /api/tasks/:id` (URL-encoded path). A row without one → `POST /api/tasks` from its title. Nothing to send → skip.
- The fields sent are the writable task keys present (`WRITABLE_TASK_KEYS`: title · details · status · priority · due · scheduled · tags · contexts · projects · recurrence · recurrence_anchor · timeEstimate · blockedBy), narrowed by the card's `keys` literal.
  - `cellToTaskField` turns serials into `YYYY-MM-DD`, arrays or comma text into arrays, and blocked-by names into `[[Name]]` FINISHTOSTART links.
  - Read-only columns (trackedMinutes, nested tables) never send.
- `data()` caches and emits the **`plan`** frame (path · title · action · fields).
- **Preview** reads each update row's task and marks `unchanged` / `unreadable`.
- **Run** (armed only, [[C38]] sinkRunButtonOnly; `enabled` never persists) sends the rest and reports created / updated / failed, naming the first failures.
- The pure half is in `taskNotesApi.ts`; `fetchJson` (POST/PUT) is in `httpBridge.ts`. Tests: `taskNotesWrite.test.ts`.
- Not yet: `/api/nlp/create` for a single text column; a `stamp` toggle (the Link to graph stamp stays off for task notes anyway).

**Write to Obsidian → Properties** (the Properties target of `WriteObsidianNode`, `nodes/obsidian.ts`; there is no separate `WritePropertiesNode`): a `cube` of rows (a frame widens) goes to notes' YAML frontmatter, keyed by a `path` column.
- A **`note-body`** column writes each note's body (`setBody`), and the frontmatter block stays byte-identical.
- **One YAML writer.** The pure `frontmatterPatch.ts` is the one writer of a note's YAML ([[C101]] onePatchPath). `patchFrontmatter` edits line-level over the raw text:
  - A present key's whole span (its line and every indented line under it) is replaced.
  - A missing key appends before the closing fence, and a note with no block gets one.
  - Untouched bytes stay identical.
- Everything renders in **Obsidian's block style**: a list as a `- ` block, rows as `- k: v` items, a list field as a nested block. That is the spelling the Properties editor writes back, so a note Solenoid wrote and one Obsidian rewrote look the same.
- `cellToYaml` normalizes a cube cell: dates by the column type (unquoted), a string naming an existing note → `[[link]]`, a nested frame/cube → rows.
- `data()` plans the **`plan`** frame (path · key · before · after · action, pending).
- **Preview** reads each note, resolves add / update / unchanged / refused / unreadable, and fills the current value.
- **Run** (armed only, [[C38]] sinkRunButtonOnly, gated on `hasFs()` so headless `--run` drives it) patches and writes atomically.
  - It registers a new key's type in `.obsidian/types.json` (`addMissing`) and bumps an existing `dateModified`/`updated`.
  - It is **mdbase-aware**: it walks up for the note's `mdbase.yaml`/`_types` and refuses a row breaking type / enum / min / max / required, with the reason in the plan's `action` (`mdbaseSchemaFor` + `validateAgainst`).
- `writeBase` (off by default; a card toggle) also writes a `<node>.base` Bases view over the folder.
- Tests: `frontmatterPatch.test.ts`, `baseView.test.ts`, and the mdbase-validation slice in `vaultCube.test.ts`.

**Links both ways** (Obsidian bundle D, 2026-09-07): every reader/writer card gets **Open in Obsidian** (`obsidianLinks.ts` `obsidian://open`, via `openExternal`). Write to Obsidian gains a **Link to graph** toggle (`stamp`, **off** by default — opt-in, author 2026-09-07): when on, Preview names the `Solenoid/<doc>.md` stub before Run, and on Run it patches `solenoid: "[[Solenoid/<doc>]] › <node>"` onto the written note (through `frontmatterPatch`) and creates/refreshes that stub note (`type: solenoid`, `nodes:`, `writes:`, `updated:`; body lists what the graph writes where + the `run-graph --run` line). Pure `graphStub.ts` (`buildStub`/`mergeStub`/`stubLink`), tests `graphStub.test.ts`.

**Cube Input** (`nodes/cube.ts` `CubeInputNode`, `components/CubeInputNode.tsx`): the fourth literal source beside Table / Frame / List Input. The author's rule: "no in-cell string lists, that is what the cube is for".
- The stored truth is `cubeText` (persisted; JSON rows of records, where a value is a scalar, a list, or a list of records). The cube derives at compute through `recordsToCube` (a list value is a list cell). Bad text gives one `#VALUE!` with the reason.
- The card is the grid preview plus the cube chip, with no text field (the author's call).
- The popup carries the corner resize grip the table popup has (`PopupShell` `resizable`).
- Wide tier: any cube-socket node, like frame nodes (`nodeWide`).
- **Editing:** the cube popup is the editor, in one window (`cubePopupStore.edit`, `CubeEditBinding` = records() / save(); every drill level carries a records `path`; `components/cubeEditCell.tsx`).
  - A scalar cell edits inline (Enter/blur; Escape reverts).
  - A nested cell drills on the breadcrumb, never a popup above a popup. A list cell opens an editable list level (one item per row), a frame-shaped record list an editable table level, and a cube-shaped one a cube level with the same rules.
  - Every level has `+ Row` / `− Row`. Table and cube levels add `+ Col` / `− Col` (the last key on every row; new ones arrive as "Column N") and editable column headers (a rename changes the key on every row).
  - Every commit patches the records at its path (`literalEditors.ts`: `getAtPath` / `setAtPath` / `recordsShape` / `parseCellText`), and `cubePopup.refresh()` re-derives the whole stack.
  - It is checked on a phone viewport (touch-sized cells and buttons).
- **List Input** has its own popup editor: its chip opens the table popup as one raw column. Save rewrites the rows via `applyListRows`. Kept rows keep their cables, and dropped rows prune first.
- Seed: `product-launch-gantt.json` (tasks as a Cube Input; the critical-path Filter reads Schedule's cube). Tests: `literalEditors.test.ts`.

**Payoff Planner** (`nodes/frame.ts` `PayoffPlannerNode` + the pure `nodes/payoffOps.ts`, frame kind, Table verbs › Plan menu): rows are debts.
- Columns: the first text column names them, then `Balance` / `APR` (a fraction or a percent ≥ 1) / `Min`, or else the first three number columns in that order.
- Inputs: `extra` (numIn literal) is the monthly amount on top of the minimums. `start` is a dateIn; unwired, it is the first of this month.
- `order` is Avalanche (highest APR first) or Snowball (smallest balance first), via ArgSelect (`PAYOFF_ORDER_META`).
- `mode` is Summary (Debt · Months · Interest · Payoff date) or Schedule (Month · a balance column per debt).
- Month by month, interest accrues, every open debt gets its minimum, and the extra plus every freed minimum cascades down the order. A plan whose payments never cover the interest is `#VALUE!` naming the debt (600-month cap).
- Balance's unit and format ride onto the money columns.
- Seed: `planners.json` (avalanche and snowball side by side). Tests: `payoffOps.test.ts`, `nodes/payoffPlanner.test.ts`.

**Group Cost Settle** (`nodes/frame.ts` `SettleNode` + the pure `nodes/settleOps.ts`, frame kind, Table verbs › Plan menu): rows are people.
- Columns: the first text column names them, `Paid` (or the first number column) is what each paid, and an optional `Share` column weighs what each owes (blank = 1).
- `split` is Equal split or By Share (SegToggle; persisted).
- Each person is netted against their fair share (paid total × weight / Σ weights). Then the biggest creditor takes from the biggest debtor. That gives the fewest transfers a greedy pass can, exact to the cent (a residual cent lands on the last transfer).
- Outputs: `transfers` (From · To · Amount) and `net` (Person · Paid · Owes · Net). Paid's unit and format ride onto every money column.
- Seed: `planners.json`. Tests: `settleOps.test.ts`.
- Hours balancing is the **Allocator**, not a separate node. Its copy says "range" (a price, hours, anything you spread), and people with Min · Max · Weight in `hr` over a 160 h budget use the same card.

**Schedule** (`nodes/schedule.ts` + `scheduleCpm.ts`, which binds the cube to `@solenoid/schedule-engine` in `packages/schedule-engine/`; frame kind, Table verbs › Plan menu): the critical-path method over a tasks cube, on the `v2.0/25-gantt.md` § 6.1 contract.
- **Core columns:**
  - Task: `Task`/`name`/`title` or the first text column. Names are unique, matched trimmed and case-insensitive.
  - Duration: `Duration`/`days` or the first number column, in days. Blank or 0 is a milestone. An hour-united column converts through `hours`.
  - Predecessors: a list cell of names is FS with lag 0, and a text cell is one name, never split. A nested Task · Type · Lag table gives FS/SS/FF/SF with lags and leads. It is never a grammar string.
- **Optional one-rule columns** (§ 4.1):
  - Start is a floor. Finish is a ceiling (negative float, nothing moves). Deadline is a flag (`Late`). Manual is a pin (predecessors ignored, successors still driven). Complete is 0–100. Project gives the gantt sections.
  - A Tasks / Children / Subtasks column holding a nested table is the WBS. A parent is a summary: dates roll up, its float is the children's least, a link on it bounds every leaf beneath it, and a link from it reads the roll-up.
- **Per-task columns:**
  - ALAP starts the task at its late start, critical. A deadline pulls it earlier.
  - Actual start pins the early start; out-of-sequence is allowed.
  - Elapsed makes every day count.
  - Weekend / Hours / Holidays are the row's own calendar over the project's. Links cross calendars by instant, and a nested Predecessors table's Elapsed column makes a lag count calendar days.
  - Work / Units are effort-driven (rule 16). Resource / Units feed the figure's histogram.
  - Active = FALSE keeps inactive rows in place.
  - Repeat + Every turns a recurring row into a phase of N occurrences k calendar days apart (Project's recurring task).
- **Inputs:** `start` (wire-only; unwired = today), `holidays`, `weekend_code` (WORKDAY.INTL, literal 1), `status` (wire-only; with it, the unfinished part of a started task is scheduled after that day), `hours` (8), and `links` (an optional flat Dependencies frame, the § 10 two-frame form: Successor · Predecessor · Type · Lag rows added to the tasks' predecessors).
- **Card toggles:**
  - Working | Calendar days.
  - Days | Minutes precision. Minutes is Project's model: intervals come from `hours`, with an 08:00 start and a lunch hour for an 8-hour day. An FS successor starts the same afternoon, a finish is the end of the last working minute, durations and lags may be fractions of a day, and a date-only ceiling means the end of that day.
  - Critical paths: One path | Every path (multiple critical paths) | Longest path (P6).
  - Split the rest | Move the whole: a started task's remainder after the status date is either split from its done part (Project's default) or the whole task moves. A split task carries a Segments table the figure draws as parts.
- **Outputs:**
  - `cube`: every level of the input with `Start · Finish · Float · Critical · Free Float · Early Start · Early Finish · Late Start · Late Finish · Driving · Late` appended (plus `WBS · Level · Summary` when nested). A typed Start / Finish column is replaced in place by the scheduled one, and a floor that held reads as typed.
  - `finish`.
  - `diagnostics` (Check · Task · Detail under plain names; declared `frameShape`): no predecessor / no successor with phase links inherited, negative float, high float, held by a typed start, past deadline, lead, lag, link type, broken link, long task, manual, should have started / finished, finished early.
  - `gantt` (Mermaid): `excludes weekends, <holidays>`, `section` per Project, `crit` / `milestone` / `done` / `active`, nested indent, exclusive ends.
  - `mspdi`: Project XML via `writeMspdi`. Write File saves it.
- **Errors:** a cycle, an unknown predecessor, a duplicate name, a bad duration, or an unreadable or ambiguous date gives one `#VALUE!` (or the `#AMBIGUOUS!`) naming the row, on every socket (the aggregate rule).
- **Engine** (`packages/schedule-engine/src/`, MIT, no Date object):
  - `calendar`: a unit index space, negative for leads, with a day layer and a minute layer.
  - `graph`: flattens the WBS into a name-keyed DAG (Kahn).
  - `cpm`: forward / backward passes, total and free float per link, the driving predecessor, roll-ups, Complete vs the status date.
  - `diagnostics`, `mermaid`.
  - `predecessors`: the `3FS+2d` grammar (import only), plus the grid text.
  - `mspdi`: the Project XML pj14 read. It covers outline nesting, link codes 0=FF/1=FS/2=SF/3=SS, lag in tenths of a minute, the eight constraint types onto Start / Finish / Manual, and the base calendar's weekdays, exceptions and working times. Unmodelled fields are named in `unsupported`.
  - `xml`: a small reader.
  - Formats (`packages/schedule-engine/src/formats.ts`): GanttProject `.gan` and Primavera XER read (Local File's plan socket, by extension), and MSPDI write (round trip pinned).
- **Corpus:** `fixtures/schedule/`, hand-authored MSPDI whose stored dates the engine reproduces in both modes. `divergences.json` names any field it may not.
- Not built (named, not hidden): resource leveling.
- Seeds: `product-launch-gantt` (three phases, SS+2, FS−3, a deadline, a pinned task, progress against a status date, Holidays, Earned Value) and `kitchen-remodel-tasknotes` (live TaskNotes). Tests: `packages/schedule-engine/src/*.test.ts` (engine, minutes, mspdi), `scheduleCpm.test.ts`, `nodes/schedule.test.ts`.

**Earned Value** (`nodes/earnedValue.ts` + the pure `nodes/earnedValueOps.ts`, frame kind, Table verbs › Plan menu): EVM over a scheduled cube.
- **Inputs:**
  - `schedule`: a Schedule cube. It reads Task, Complete 0–100, a Cost column named Cost/Budget/BAC or the `cost` literal, an Actual cost column, and Start/Finish.
  - `baseline`: a second scheduled cube joined by name. Its Cost is the budget and its Start/Finish set the planned pace. Unwired, the schedule is its own baseline.
  - `status`: a wire-only date. Unwired, it is today.
  - `cost`: the column-name literal.
- **Per task, as of the status date:**
  - BCWS = baseline cost × the planned working-day fraction elapsed (`networkDays`, Mon–Fri). Holidays are not subtracted, a documented simplification since the node has no calendar.
  - BCWP = cost × Complete. ACWP = the Actual cost column, else BCWP.
  - Then SV/CV, SPI/CPI (null when their denominator is 0), EAC = BAC ÷ CPI, VAC, TCPI.
- **Outputs:**
  - `frame` = Task · BCWS · BCWP · ACWP · SV · CV · SPI · CPI · EAC · VAC · TCPI (declared `frameShape`). The money columns carry the Cost column's currency via the `...unit` copy idiom; the indices stay unitless.
  - `spi` · `cpi` · `eac` totals as scalars. Each total ratio comes from the summed components, never averaged. EAC carries the unit through `tagFrameCellUnit`.
- Seed: `earned-value.json`. Tests: `nodes/earnedValueOps.test.ts`, `nodes/earnedValue.test.ts`.

**Decision support**:
- **Decision Matrix** (`DecisionMatrixNode`, frame kind, in the Table-verbs menu): a port of the author's Decision Matrix Bases View Obsidian plugin. It scores and ranks a Frame of options (rows) by criteria (number/logical columns, not date; an optional leading text column names the options).
  - The score is a weighted average, `Σ(value × weight) / Σ|weight|`. A negative weight penalizes a lower-is-better criterion.
  - Rank is competition rank on the rounded (4dp) score, so display and rank can never disagree ([[C64]] decisionMatrixFamily).
  - **Weights ride a criterion-keyed `weights` frame** (`Criterion · Weight · Norm`). The weights are orthogonal to the score rows, one per criterion column, so they key by criterion name, never by a positional list.
  - `resolveDecisionWeights` (`frameVerbs.ts`) aligns the weights frame to the detected criteria by name. The first text column is Criterion. The number column named Weight/Value (else the first number column) is the weight. An optional Norm text column is parsed by `parseNormalize` (Raw/none, ÷Max/max, Rank). Unwired, or for a criterion the frame omits, the weight is 1 with the default normalize.
  - The card keeps only the node-wide defaults:
    - The `normalize` SegToggle: `none`/`÷max`/`rank`. **÷max is the node default** ([[C64]] decisionMatrixFamily), because raw silently degenerates the moment criteria mix scales. ÷max and rank both land in [0,1], so mixed-mode columns stay comparable: weights, not scale, decide influence.
    - `detail` (Summary / Breakdown). Breakdown inserts each criterion's **signed contribution**, effective × weight / Σ|weight|, so the columns sum to the Score and a negative-weight column reads as the penalty it is. It never shows the bare post-normalize value.
  - The node's own `frameShape()` declares the static output shape (label · [criteria] · Score · Rank).
- **Decision Sensitivity** (`DecisionSensitivityNode`) is the companion. Feed it the same Scores and a Scenarios frame.
  - The Scenarios frame is the weights frame widened: rows are criteria, each number column is one scenario named by its header, and one optional Norm column is shared.
  - A criterion a scenario omits gets 1. If no criterion row matches at all, the result is `#VALUE!` (the renamed-criteria trap).
  - It emits a **Cube**: Scenario · Winner · Margin · Ranking, where Ranking is the full ranking frame nested per cell (drill in).
  - Margin = top − runner-up (decisiveness). A dead tie for first lists every tied option in Winner ("A = B").
- Verbs: `decisionMatrix` / `decisionSensitivity` / `resolveDecisionWeights` in `frameVerbs.ts` (`decisionMatrix.test.ts`).
- **Seed** `decision-matrix.json`, held to the engine by `decisionSeed.test.ts` (winner order, the flip, the exact tie, the report wiring):
  - One criterion comes from a Note's frontmatter frame (rows-of-objects: prose = the judgment, rows = the data), left-joined by name.
  - The weights and the transposed scenarios are Frame Inputs.
  - The podium is a Columns node (keep [Option, Score]) → Chart (labeled bars), beside a radar off the Join.
  - A Report memo pulls `=winner` (INDEX 1,1), the podium figure, and the contributions table.

**python-r-gap Tier 2 (2026-08-23g, see `python-r-gap.md`):** Lists gained Smooth (Savitzky–Golay / LOWESS / Gaussian, op-owned parameter sockets), Find Peaks, ARGMAX ops ARGSORT / ARGSORT DESC / WHICH (sockets retype with the op), Polynomial Roots (Complex); Finance gained Returns (log / simple / cumulative, drawdown, max drawdown, CAGR, volatility, Sharpe, Sortino — op owns rf / periods); Regression gained Decompose (classical seasonal); Text gained Pad Text, Truncate Text, Template ({name} grows a socket), Hash, UUID, UNACCENT / SLUGIFY on Text Transform and Base64 on the url-encode card; Tables gained K-Means, PCA, Logistic Regression (Analyze), Bind Columns (Append's positional sibling — a backend verb on both engines) and Join `how = cross`.

**Describe / Correlation Matrix / Window** (Table verbs):
- **Describe**: pandas describe (one row per column).
- **Correlation Matrix**: df.corr / df.cov (Pearson / Spearman / Kendall / covariance, pairwise-complete).
- **Window**: the per-group transform column (running / rank / lag / lead / diff / pct_change / rolling / group total / share / first / last, partition + order, original row order kept). It is a lazy FrameOp: Polars `.over()` on desktop, the oracle on web, with a `window.json` parity fixture.
- Also in this set: Epoch ↔ Date and Truncate Date (Date & Time), and Amortization Schedule (Finance).

**Aggregation**:
- **Group Lists**: a 1D parallel-list group + aggregate (keys + values outputs).
- **GROUPBY**: groups a frame's rows by key columns and aggregates.
- **SUMIFS** ([[C49]] filterOneJob): a conditional aggregate over one Frame.
  - An op selector (SUMIFS/COUNTIFS/AVERAGEIFS/MINIFS/MAXIFS), a Values-column field (hidden for COUNTIFS), and extensible criteria rows (column + test + value, AND like Excel's *IFS).
  - Empty-match parity: AVERAGEIFS gives #DIV/0!, MINIFS/MAXIFS give 0. A missing column is #REF!.
  - Parallel lists route through Frame from Lists (the aligned-columns rule).
- **PIVOTBY** is full Excel `=PIVOTBY`. The engine is `pivotFrame(f, PivotSpec)` in `frameVerbs.ts`. Background: the PIVOTBY full-Excel-parity entry in `archive/dev-notes-history.md`.
  - Multiple row/col/value fields (composite `"East | A"` headers).
  - A per-value function from the expanded set (SUM/AVERAGE/COUNT/MIN/MAX/PRODUCT/MEDIAN/MODE/STDEV.S-P/VAR.S-P/PERCENTOF).
  - Grand totals and subtotals (row/col depth, top/bottom) that **re-aggregate the source**.
  - Value/field sort, a filter mask, and % running totals (`relativeTo`).

**Annotation**:
- **Note**: a free-floating sticky note with a markdown title/body, drag and tint.
  - **Frontmatter sockets.** A Note is sockets-less by default. If its body opens with an Obsidian-style `---`-fenced YAML frontmatter block, each key becomes a typed output socket (the guessed type is persisted and overridable per key), so the Note doubles as a typed-record / constants source (`noteFrontmatter.ts`).
  - A key whose value is a list of maps emits a **frame** output, with columns from the row keys. Any YAML spelling works: Obsidian's block rows, `- {k: v}` inline, or `[{k: v}, …]` flow (`noteFrontmatter.ts` reads through the `yaml` package).
  - It emits a **cube** output when any row value is a list (`after: [B, C]` or a nested `- ` block). `recordsToCube` in `frame.ts` is the rows→cube shape the vault readers share: a list value is a list cell, never joined into text. This is the Script node's `{name: value}` row shape, so a Note can seed a table with no Frame from Lists.
  - **Knap inside frontmatter.** A quoted tag value (`total: "{{ price | round }}"`, with the note's other fields as its variables) puts its rendered value on the socket, typed by the render's plain-scalar guess (or the key's pin). Knap has no arithmetic, only variables, comparisons and filters. The document carries the rendered block, and the socket retypes through the same reconcile as a body edit (`renderedFields`, a microtask).
    - A Report using such a note as its template defaults an unwired input to the rendered value.
    - An unquoted tag is a YAML flow map, so the socket emits `#SYNTAX!` "Knap vars in frontmatter require quoted "{{var}}" syntax" (`knapUnquoted`). There is no pre-parse rewrite: quoting is the spelling, and the removed `{{daily}}` grammar stays removed (the author's call).
    - Tests: `annotation.test.ts`, `report.test.ts`.
- **Note and Report bodies are Knap templates** (knap.md, the Obsidian template language; `knapTemplate.ts`, the `knap` package; [[C68]] knapIsTheDocumentSyntax). Knap is the authoring syntax; `` `=name` `` survives only as the internal span below.
  - `{{ name }}`, `{% if %}`/`{% for %}`, `{% set %}` and the standard filter set (`date`, `table`, `join`, `number_format`, `wikilink`, `yaml_property`…) render at compute into the `document` output.
  - A Note's variables are its own frontmatter fields (no inputs minted; dates as ISO text so `date:` formats them).
  - A Report's root variables mint `trueany` inputs, one socket per name, in first-use order.
  - **In a Report a bare `{{ name }}` embeds the wired value as the canvas shows it**: an FC-formatted scalar, a scrollable frame grid, a chart figure, a KaTeX lambda, a Mermaid diagram, a wired Note as a block. `{{ name | highlight }}` is the tinted text form.
    - `embedBareVariables` rewrites those tags to the internal `` `=name` `` / `` `=name!` `` span before the render, and the span resolves by kind afterwards (`inlineRefDisplay.tsx` on screen, `obsidianMarkdown.ts` at write, `reportExport.ts` at export).
  - Any other use of the name (a filter, a loop, a condition, dot access) reads the data form: frames and cubes as rows of `{column: value}`, a wired document as its body text, a date serial as ISO text only when the source socket is a date type, a chart as null.
  - A syntax error is `#SYNTAX!` on the document with `line:column`. The card/overlay preview shows the same lines.
  - A body with nothing left for the engine after the rewrite (prose + embeds) stays synchronous.
  - Knap 0.4 rejects the `{{-` trim dashes its README lists.
- **Two fixed Report inputs:**
  - **Template** takes a wired Note (a vault template through Import Obsidian Note, or a canvas Note) as the text instead of the body.
    - Its root variables mint the sockets, persisted as `sideVars` so restored cables find them before the first compute. `data()` reconciles them through `dropInputCables` when the template changes.
    - Its own frontmatter fills any input left unwired, and the overlay shows it read-only.
    - A Note's document carries its raw body as `source` for this. A Note keeps a bare tag naming no field literal (`renderKnap keepUnknown`), so a template note reads as a template on the canvas and round-trips to the vault intact.
  - **Records** is the mail merge (Word's term for the merge list, chosen over "Rows" as the primary keyword; the author's call).
    - A frame or cube renders one page per row (`renderKnapPages`: `record` and `index` in scope beside the inputs, `MAX_PAGES` 500), each named by the report's `pageName` Knap (blank → the index).
    - The document carries `pages` and a body of the pages joined by a rule. Write to Obsidian writes one note per page (stamping skipped for a batch).
  - `template` and `records` are variable names too. Bare, they embed the note / the frame; filtered or looped, they read the source text / the records.
  - Fixture: `tests/fixtures/mail-merge.json`. The Report showcase keeps a merge group. Write File writing the same pages to a plain folder is parked in the Write mega-merge (backlog).
- **Seeds** lean on the shaping filters (`sort:("col","desc")`, `slice`, `where:("col", v)`, `map:x => x.col`, `unique`, `sum:"col"`, `list:numbered`). The showcase, the decision memo and the mail merge each carry a sorted, sliced or filtered passage. `knap-upstream.md` lists the knap 0.4 bugs the seeds steer around.
- **Overlay chrome:**
  - The source pane tints Knap tags (`knapHighlight.ts`, a highlighted backdrop under a transparent textarea).
  - A Filters button lists every standard filter with its example (`standardFilterMetadata`) and inserts `| filter` at the caret.
  - A merge previews one page at a time with a stepper.
- **Image** (in the Add menu's "Other" category): a free-floating picture. Attach a local file or paste a web URL; it has a height field and no socket or data.
- **File Link** (in "Other"): a link to a file on disk, with a title, a preview row and an Open button. No sockets, no data.
  - It stores the path, not the bytes. Desktop persists the absolute `path`, and Open launches it in the OS app via `openPath` (needs `opener:allow-open-path`).
  - A web attach is session-only, since the browser has no path. Only `fileName` survives reload.
  - It is a fixed-width card, deliberately not a SIZE_OWNER.
- **SVG** (interactive picture / visual slicer, also in "Other"): `SvgPickerNode`, kind `input`; see below.
- **Format Controller** (catalog label "Format"): a docked node that sets a socket's number format, and authors a unit only onto a unit-less value. Fed an already-united value, it mirrors the unit and locks ([[C25]] firstClassUnits: only Convert changes a unit). `formatModel.ts` is the control truth table.
- **SVG Picker** (`nodes/annotation.ts` `SvgPickerNode`, `components/SvgPickerNode.tsx`): load an SVG, either a local `.svg` read as text or a web URL fetched to text. It is inlined into the well, so its inner shapes are hoverable and clickable.
  - **Click a shape or layer and the `Layer` string output emits its name** (element `inkscape:label`/`data-name`/`aria-label`/`id`, human label first, walking up to the nearest named ancestor; pure `svgLayer.ts`, `resolveLayer`). Wire that into a Filter to slice a dataset by the clicked region: a clickable map or floorplan as a data selector.
  - Clicking the current pick clears it. The pick is `null` (missing) until made.
  - It also flows the picture out the `chart` object socket as an `SvgValue` (`svgValue.ts`: source + selection + hover color). A Report / Display / Cable Switch / Composite boundary renders it via the shared read-only `SvgFigure.tsx`, highlighting the same layer.
  - The hover and selection highlight is an imperative `filter: drop-shadow` glow in the adjustable color, not per-move React state.
  - Persistence: the markup lives in `stringLiterals.source` (the Mermaid pattern: text, no bundling, unlike Image). `url`/`hoverColor`/`selectedLayer` round-trip via `INIT_FIELD_ORDER`.
  - **Caveat:** a cross-origin URL fetch can be CORS-blocked; local-file attach always works. A failed fetch leaves an inline hint.
  - Tests: `svgLayer.test.ts`, `svgPicker.test.ts`.
- **Image persistence (`nodes/annotation.ts`):** a web `url` round-trips through the JSON save (and copy/paste) via `extractInit`; a LOCAL file is read to a base64 `dataUrl` that is deliberately NOT persisted (the save is plain JSON — no embedded image bytes yet; bundling comes later), so it's session-only and `dataUrl` is kept out of the extractInit whitelist. `src` getter = `dataUrl || url` (a fresh local attach wins; setting one source clears the other). The height field uses `useDraftCommit` (commit on Enter/blur), not live onChange — a live-clamped number input can't be cleared to retype.

**Conduit**: block bundler (up to 8 lanes, one rotation angle) whose outputs travel as a single Ribbon cable. (The old two-arm "Manifold" bundler it replaced was removed 2026-06-19.)

**Composability rule**: scalars → fine-grained one-op nodes. Lists/tables → bundled task-shaped nodes (e.g. one Aggregate with op selector, not five separate sum/avg/etc. nodes).

**Node design rules (the author's standing shape calls):**
- Scalars → fine-grained one-op nodes; lists/tables → bundled task-shaped nodes with op
  selectors. A variant is a mode/op selector on the existing card, never a sibling node
  ([[B11]] maximalMerge).
- Aligned parallel columns → ONE frame input, not parallel list sockets (charts, SUMIFS,
  the frame verbs). The same for OUTPUTS: correlated lists (t and y of a solution, the
  parts of a decomposition) leave as ONE frame, never as parallel list sockets (author,
  2026-08-24). This is about ROW-aligned data — a value per row, parallel to a frame's rows
  (why the Allocator's per-category weights are a Weight COLUMN, not a socket). A vector that
  runs ORTHOGONAL to the frame — one value per COLUMN, like Decision Matrix's per-criterion
  weights — is not parallel data and legitimately stays a list socket.
- A node that takes a user formula takes it as a LAMBDA input (`lambdaIn` + `lambdaSig` +
  `resolveFn`, the λ-family in `tableLambda.ts`), never as a string socket holding an
  expression (author, 2026-08-24).
- Meaningful differences from Excel, especially output-affecting ones, go in the catalog as
  `parity: false` + a note (`nodeExcel.ts`).

**Labeled slots vs a list input** (the variadic-node rule; background in `docs/archive/node-arity-audit.md`). A variadic node uses **individually labeled, individually wireable scalar rows** (the `ExtensibleInputs` / `PairedExtensibleInputs` pattern), not a single list or table socket, when each input plays a **distinct role**: positional (CHOOSE's value per index) or **paired** (IFS and SWITCH's condition and result). The label is the affordance: it says what each slot does and what an edit affects, while a raw list of paired values hides the pairing and makes edits opaque. Separate sockets also let each input come from a different upstream node. Use a single **list socket** only when the elements are **interchangeable**: all the same role, where order may matter but identity and pairing don't (SUM, AVERAGE, AGGREGATE, the List literal). Litmus test: if explaining the list takes "the 2nd element means X, the 3rd means Y", it should be labeled slots.

**Input dimensionality: pick a socket by the input's role.** The socket type both gates connections (`canConnect`) and drives coercion at the engine boundary (`coerceInputs.ts`), so it must match what `data()` actually consumes. Every node input was audited against its `data()`.

- **Element-wise operand** (paired with each element through a broadcaster) → the family's **combo**: `numlist`, `strcombo`, `datecombo`, `logicalcombo`, `complexcombo`. An operand can validly be a per-element vector, as in Excel's `=ROUND(A1:A10, B1:B10)` or `=LEFT(A1:A10, B1:B10)`.
  - This covers Arithmetic's `a` and `b`; the secondary operands `RoundN.digits`, `Clamp.min` / `max`, `MRound.multiple`, `Gcd.b`; every date operand (DatePart, DateAdd, DateDiff, DATEDIF, WORKDAY, NETWORKDAYS, DATE, TIME); every text operand (UPPER, LEN, LEFT / MID / RIGHT, FIND, SUBSTITUTE, REPLACE, REPT, CHAR / CODE, TEXTAFTER / BEFORE, EXACT, NUMBERVALUE, ROMAN / ARABIC, FIXED, DOLLAR, ENCODEURL, Reverse Text, Spell Number); and every complex operand (COMPLEX, IM Unpack, the IM unary and binary ops, IMPOWER, Quadratic Roots).
  - All five families are swept, so a combo rung with no node using it is a bug, not a gap.
  - Don't narrow these to the scalar rung; that breaks list broadcasting and makes them inconsistent with their family. The combo is pure widening: it accepts everything the scalar did and feeds everything the scalar fed (combo → scalar is an explicit lattice edge), so switching one breaks no existing cable.
- **Structural control parameter** (a count, index, window size, polynomial or Bessel order, numeric base, mode or type flag) → `number`, or a scalar `string`. It has no per-element meaning, so a list there is a real mistake the socket should block. The test is whether the value describes one operation over the whole input or varies per element. Examples: `Take.count`, `Running.window`, `Combinatorics.n` / `k`, `BaseConvert.from` / `to`, `Slice.start` / `end`, distribution evaluation points and parameters, every finance scalar (rate, nper, pmt, pv, fv, basis…), WEEKDAY's `return_type`, YEARFRAC's `basis`, WORKDAY's `weekend_code`, NUMBERVALUE's separators. A per-element numeric operand is not this: `LEFT.n`, `MID.start` / `len`, `REPLACE.start` / `num_chars`, `REPT.times` and `FIXED.decimals` are combos.
- **1-D list or sample data** → `list` (`strlist`, `datelist`): stats samples, cash-flow arrays (NPV, IRR, XIRR…), Filter's `mask`.
- **2-D matrix** → `table` (numbers), `strtable` (text), `datetable` (dates), `complextable` (complex); a **table with named columns** → `frame`. Matrix ops take `table` and Frame ops take `frame`. A 2-D output never narrows into a 1-D or 0-D input, and a lower rank widens up: a list into a matrix or Frame (as a single row), a matrix into a Frame.
  - Element-agnostic 2-D inputs use the grid socket `anyTableIn` (TRANSPOSE, HSTACK, CHOOSEROWS / COLS, reshape-flatten, the MAP / BYROW / REDUCE values). They render as a grid, and a 1-D list widens in.
  - TableInfo (ROWS, COLUMNS) is `frame`-typed, so a matrix, list or scalar widens in.
  - Get Column can read a column as Boolean: a logical column leaves as a real logical list, with 0/1 and true/false converted.
- **Recursive nested table** → `cube`, the top of the lattice: a Frame whose cells can hold any value, a nested Frame or Cube included.
  - Producers: **Nest Join** (nests two Frames on a shared key into a Cube of sub-frames, tidyr's `nest_join`, the dual of a flat Join) and **Build Cube** (extensible `trueany` cells into one column, each cell any value).
  - Access: **INDEX** is `trueany` in and out and reads a cell out of a list, matrix, Frame or Cube; a nested Frame or Cube comes out whole. A blank or 0 Row gives the whole column and a blank or 0 Column the whole row (Excel's `INDEX(range, 0, col)`); both blank passes the container through. Slices follow the accessor conventions: a Frame row is a one-row Frame (Get Row), a Frame column is a list (Get Column), Cube slices stay Cubes with nested cells whole, and matrix slices are 1-D lists. The Row and Column fields default empty, with an `[all]` placeholder.
  - **Cube Rollup** (`CubeRollupNode`) goes the other way: it aggregates a column inside each row's nested sub-frame (the full 12-op AggOp set, reusing GROUPBY's `aggregateGroup`) and flattens the Cube back to a Frame with the roll-up appended. That's the bill-of-materials shape: an assembly's cost is the SUM of its nested parts. See the rollup row in the `cubes` seed.
  - Display: `CubeDisplay` and the drill-in `CubePopup`, which shows depth and lets every nested cell (Cube, Frame, list) drill in place along one breadcrumb. The cached `depth` counts Cube-in-Cube only; a nested Frame is a leaf. Full detail: `docs/archive/cube-node-scope.md`.
- **Genuinely type-agnostic** → the wildcard ladder ([[D15]] wildcardsKeepRank): `any` (a gray circle: one value of any family), `anycombo`, `anylist` and `anytable` (its 1-D and 2-D siblings), `anydata` (anything up to a matrix) and **`trueany`** (a hollow gray circle, border only), which accepts anything.
  - `trueany`: Cast, Display, the Test inspector, Input Switch, unwired Conduit lanes, the selectors, Report references, Placeholder and composite ports.
  - **Expression's variable inputs are `anydata`**: scalars, lists and matrices in, Frames and Cubes never ([[C15]] matricesInFormulas). **LAMBDA's capture sockets stay `anylist`.**
  - The polyform producers declare their output element type with a Number / Text / Date / Auto result-type selector that swaps the output socket at the node's rank (Auto is `any` at scalar or combo rank and `anytable` at matrix rank). A matrix result swaps to the family's matrix rung in place ([[D16]] retypeReconciles).
  - REDUCE's iterable `values` and the MAP and BYROW table inputs are `anyTableIn` grids; the scalar seed is `anylist`.

The governing principle: **keep types separate (a Cast crosses element families, and `logical ↔ number` is the one bridge) and let dimensions flow** (lower ranks widen into `anytable` and `frame`). The spec is `../specs/socket-lattice.md`, machine-checked by the full sweep in `socketConnect.test.ts`.

**Frame Input's column sources.** Frame Input is a literal source for Data columns: it stores the raw text you typed and derives the typed Frame at compute time, and the popup's Source checkbox shows that raw text on every frame node (`FrameColumn.raw`). Each column has a source: **Data** (typed cells), **Formula** (an inline row-wise expression, `expr?` on `FrameSourceColumn`) or **λ** (a wired LAMBDA, `lambda?`, which wins when both are set). Computed columns evaluate in dependency order with cycle refusal, can carry a per-column unit from the popup's unit picker, and the chip's **ƒ** marks a table with definitions. The popup's **Form view** (frame-source editors only) edits one record as labeled fields, with a pager and + Record / − Record. It rides the same raw-text grid truth and edit-draft path as the grid cells, so it reaches rows past the grid's 1000-row render cap; computed columns are read-only there. Field placement uses the Record layout text (`parseRecordLayout`: empty is stacked, unmatched names keep inert boxes, columns not in the layout are hidden), and the form renders as the Record card's look made editable (touching square boxes, the label inside the box). The layout is authored on the Frame Input card, never in the popup, and is saved as `FrameInputNode.stringLiterals.layout`. See `../specs/error-values.md` § Literal sources.

## Packs (add-on node bundles — `src/graph/packs/`, 2026-07-09 wave)

Pack nodes live in per-pack files (`packs/electricity.ts`, …), NOT `nodeCatalog.ts` —
each pack file IS its inventory (formula entries + custom-node placements + FC
units/formats), and every pack has a vitest file asserting its formulas against
reference values. Registry/activation: `packs.ts`; authoring shapes: `packs/packShared.ts`.
The current built-in set — Geometry + Common Excel Timesavers ship ON; the rest ship OFF:

- **Geometry** (ON): 27 formula presets (areas/volumes, circles & arcs, solids) + HYPOTENUSE + **Triangle Solver** (the current EQUATION card: dual-socket hero rows per part + a logical Valid check + the triangle drawn to scale; the angle outputs carry the real `deg` unit per-output (`annotationFor`), so they read as degrees downstream (and a trig node in Auto mode picks them up) while the sides stay bare; `numlist` sockets like the rest of the Equation family — parallel lists broadcast to a triangle per index (Valid becomes a logical list, the figure draws index 0); any three parts incl. one side → all sides/angles/area/perimeter, over-given parts are consistency-CHECKED like Equation's all-known mode; SSS/SAS/ASA/AAS, ambiguous SSA is an honest #SOLVE!); DMS format, turn/px units.
- **Common Excel Timesavers** (ON): core-node reclassification tags + 7 presets (Percent Change, CAGR, Ordinal, Clean Whitespace, Mask, word/occurrence counts) + Reverse Text + Spell Number + **Time Zone Convert** (formula `TIMEZONECONVERT(datetime, from_zone, to_zone)`, the one shareImpl kernel `convertZone`; the result defaults to a datetime display style via `annotationFor`, and From/To offer an IANA-name `<datalist>` from `timeZone.ts` `IANA_ZONES`) + **World Clock** (pure `Intl`, DST-correct; timeZone.ts; the Zones field shares the same IANA suggestions) + **QR Code** (text/URL/Wi-Fi/vCard → ImageValue out the chart socket; `qrcode` lazy-loaded, SVG build in qrCode.ts).
- **Electricity & Circuits**: 23 presets + Parallel Combine, E-Series Value, AWG Wire, **Resistor Color Code** (4/5-band dropdowns + a live band glyph → Ω + tolerance; IEC 60062); Electrical FC units + SI-prefix format. Ohm's Law and dBm ↔ Watts are locked EQUATION presets (solve any way, or truth-check).
- **Electromagnetism** (dependsOn electricity): 20 presets (Wavelength ↔ Frequency is an equation preset) + the CODATA Physics Constant node, whose unit rides downstream like an FC lock, + **EM Spectrum Band** (frequency OR wavelength → Radio…Gamma, visible names its color; emits both quantities via c).
- **Health & Fitness**: 20 presets (BMI/BSA/IBW, body fat, BMR/TDEE, cardio, clinical) + **Heart-Rate Zones** (age / optional resting HR / optional max override → a five-zone Low/High FRAME; Karvonen when resting is given — the pack's chartable table).
- **Fluid Mechanics**: 20 presets + the Colebrook root-finding friction-factor node + **Pipe Roughness** (13-material ε table, mm; with a diameter also emits ε/D for Colebrook/Swamee–Jain); pressure/flow/viscosity FC units.
- **Thermodynamics & Air**: 18 presets + ISA Standard Atmosphere + Antoine Vapor Pressure; Energy FC units. The old four solved ideal-gas forms are ONE pV = nRT equation preset.
- **Sets & Membership**: Is In (membership mask) + Tally (value counts); claims the core COUNT DISTINCT aggregate op. (Semi/anti join modes are core Join.)
- **Earth & Sky**: 8 presets (haversine, bearing, gravity, orbits) + NOAA Sun Position, Sunrise/Sunset, Moon Phase.
- **Chemistry Basics**: 11 presets + Element (118 IUPAC weights; the mass output carries g/mol per-output — `annotationFor`) + Molar Mass (formula parser); Chemistry FC units. Moles ↔ Mass and pH ↔ [H⁺] are equation presets. The Element card opens a PICKER popup: fuzzy search (symbol/name/number) + the clickable 18-column periodic table itself (symbols only; current pick and best match accented).

Composite-shaped pack ideas are planned, not built — `docs/pack-composite-plans.md`.
