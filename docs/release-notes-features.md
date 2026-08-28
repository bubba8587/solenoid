# Solenoid 1.3 — feature highlights (selling list)

Curated, high-value features that will sell 1.3 — the source material for the release
notes (the author writes the final copy) and the **What's New** slides. Living doc:
keep it current as features land; each entry is a *benefit*, not a changelog line.
Order = rough selling priority. Mark `[slide]` on the ones worth a What's-New slide.
The bar for what earns a spot: `archive/release-notes-1.1.md` (a sell is a shiny thing
a user will go discover and play with, or something that would inspire a download —
What's New is not a changelog; GitHub is). The 1.2 list shipped with v1.2.0
(2026-07-22) and lives in git history.

Covers everything on `develop` since the v1.2.0 tag (v1.2.5, 2026-08-12, was a patch
tag along the way — the baseline stays v1.2.0).

## Headliners — the slide deck

- **[slide] Computed columns.** A table column can now be *defined*, not just typed:
  pick Formula on any Frame Input column and write `@price * @qty`, or bind a wired λ.
  References work exactly like an Excel table: **a bare name is the whole column,
  `@name` is this row's cell** — so `@revenue / SUM(revenue)` is a share-of-total and
  `SUMIFS(amt, cat, @cat)` a per-group subtotal, per row. Computed columns can
  reference each other, take per-column units and number formats like any typed
  column, and the chip's **ƒ** marks a defined table. Mid-pipeline, the Computed
  Column node does the same over any frame — with side inputs, bracket references
  (`@[Unit Price]`) for unspellable names, and per-variable column-binding pickers. The
  "Computed Columns & @" example canvas tours it.
- **[slide] Script node.** Write a JavaScript function; it runs as a node. The value
  types itself from what you return: a number, text, `Solenoid.date(…)`, `[ ]` for a
  list, `[[ ]]` for a table, `[{name: value}, …]` for a frame — and wired frames
  arrive the same way, so a script reads and builds tables in plain JS. A real
  editor (syntax highlighting, expandable popup, wide card), sandboxed and
  time-capped, with a Recalculate button when the source is volatile
  (`Math.random`, `Date.now`). The "Script: worked examples" canvas tours four:
  Monte Carlo π, Collatz, a 30-year amortization table, Friday-the-13ths.
- **[slide] Matrix formulas & LAMBDA.** Expression now takes matrices (matricesInFormulas):
  TRANSPOSE/MMULT/SEQUENCE/WRAPROWS and the array-returning core, LAMBDA as a first-
  class value — including eta-lambdas, higher-order `f(x)`, and reusable λs wired
  across the graph — plus complex numbers (IM* over a true complex type). Every
  in-scope Excel name is callable — the unimplemented set is ZERO — and **every pack
  function** (SUNRISE, AWG, PIPE…) works in a formula the moment its pack is active.
- **[slide] Query.** A Power Query-style transform node: drop a Query, drill in,
  chain the table verbs, and Refresh on demand — upstream changes only mark it
  stale, never silently recompute (queryIsCompositePreset: a pre-seeded manual-mode Composite).
- **[slide] AI palette.** Type a prompt in the command palette: a question gets an
  answer about *your* document; a build request gets a validated whole-document
  rewrite shown as a diff you approve or cancel — never a blind edit (aiInScope/aiWholeDocRewrite).
  Bring your own Anthropic key (Settings ▸ AI), or type `demo` for the offline
  staged demo. Applied additions animate in.
- **[slide] The analytics shelf.** The numpy / pandas / scipy / R toolkit, as nodes —
  roughly forty new cards: Forecast (Holt–Winters ETS with confidence intervals),
  Window (per-group running / rank / lag / share-of-group columns), K-Means, PCA,
  Logistic Regression, Spectrum (FFT), Smooth (Savitzky–Golay / LOWESS / Gaussian),
  Find Peaks, Decompose (classical + STL), Fit Distribution (MLE fits ranked by
  AIC), Monte Carlo with *correlated* inputs (Gaussian copula), ODE Integrate,
  Polynomial Roots, Text Similarity + Fuzzy Match, Returns (drawdown, CAGR, Sharpe,
  Sortino), Describe, Correlation Matrix, Amortization Schedule… The Function
  Reference grew numpy / pandas / scipy / R / SQL / Excel filter chips, so you find
  them from whichever vocabulary you already speak.
- **[slide] Records & forms.** The Record node shows one table row as a card you lay
  out yourself — labeled boxes on a text-defined grid, `*N` column spans — with
  Gallery and Board views over the whole frame. Flip a table popup to Form view and
  that layout becomes editable: page through rows and enter data in widgets that
  follow each column's type.
- **[slide] Multi-series charts.** Wire a frame into a chart and every column is a
  named series — legend, multi-value tooltip, click a legend entry to spotlight one
  series (card and popup alike). Merge Plots overlays several charts on one plot.
  New figures: Proportion (treemap or waffle) and 2-D Histogram; marker size is a
  chart option everywhere.

## Release-notes body

- Node Inspector: an (i) on the top bar (and every context menu) docks a reference
  panel for the selected node — what it computes, its Excel equivalence, every
  socket described under its real glyph, example tables for frame inputs.
- The table popup is a mini spreadsheet now: arrow/Tab/Enter movement, sorting
  ranks the *whole* dataset (Copy and Export follow the visual order), and a
  summary footer puts a stat picker under every column — Sum, Average, Median,
  Distinct, Errors… (cube popups sort and export the same way).
- One card per job: dozens of near-duplicate nodes merged into op-driven cards —
  one Distribution (with its inverses and a Sample form), one Hypothesis Test
  (ANOVA, Mann–Whitney, Fisher exact…), one Series, one Running, one Rank &
  Percentile — and every card renames itself to the op it's set to. Searching the
  Add menu finds every op inside them.
- Date Input: type a date in about any format — or `next friday`, with relative
  dates as an opt-in — and ambiguity answers #AMBIGUOUS!, never a silent guess.
- An Excel-accuracy audit pinned the dark corners against real Excel: T-bill day
  counts, bond pricing across issue→maturity, quartile endpoints, half-away-from-zero
  rounding, the iterative solvers — and nodes and formulas share one kernel per
  name, so both surfaces answer alike.
- Every formula autocompletes with named arguments (`RUNNING(op, list, [window])`),
  never "N args".
- Lists everywhere: the date, text, and complex families are element-wise now —
  wire a list of dates into EOMONTH like a column, no MAP ceremony.
- Frame verbs typed in a formula (FILTER, PIVOT…) are recognized and redirected to
  their node — a real name gets guidance, never a bare `#NAME?`.
- Drill into a composite and the full canvas comes with you: lasso, the whole
  keyboard, Tidy, minimap, touch gestures — editing inside a composite is no longer
  a reduced surface.
- Heavy tables stopped being copied around: downstream readers (Slicer, Pivot,
  SUMIFS, Table Size…) pull only the columns they need from a lazy handle, so big
  documents load and recompute lighter.
- A value's unit is first-class now: a Format node downstream of a united value
  shows the unit locked instead of letting a dropdown relabel it — changing a
  display unit takes a Convert node, because a unit change is a magnitude change.
- Palettes grew: Orchard and Blueprint join the set, and a palette now paints the
  whole app — canvas ground and chrome follow it, tinted from your accent.
- Tidy takes options: direction, density, and a width cap, from a popover on the
  button.
- Notes: task-list checkboxes are tickable right in the read view, and embedding a
  note in a Report is an ordinary `=name` reference the graph can see.
- The desktop (Polars) engine and the web engine are corpus-tested to agree
  bit-for-bit — one fixture set runs both, fuzzed, including fused verb chains and
  non-finite edges.
- Touch: pinch-zoom can't be stolen by the node under your fingers, and a touch
  never selects a node on contact — selection lands on release.
- Tablet support: correct viewport on touch-desktop browsers, fullscreen on the
  zoom pill, stable pinch-zoom on mobile-class GPUs.
- Pixel-perfect cards: the card frame (border, header cap, divider) paints as one
  SVG, so strokes can't crack apart at any zoom — the long-standing hairline seam
  and the selection-ring overhang on notes are gone.
- Hover a frame input's socket (tap the row on touch) and a miniature EXAMPLE
  table shows exactly the columns it expects, with sample data.
- A crash can no longer black out the app: the failing card degrades to a small
  red box with a copyable message and everything else keeps working.
- Touch polish: node descriptions on long-press, tap-to-expand descriptions in
  the Function Reference, context menus stay on-screen, the wordmark tops the
  mobile bar.

## Under the hood — seed list for the GitHub changelog

Non-sells that shipped; mentioned in the release body, never headlined.

- The canvas view is React Flow end-to-end — the rete render stack is deleted; one
  shared surface serves the main canvas and the drill-in; snapshot undo/redo with
  labeled entries and a byte budget. (NOT a What's-New item: not user-facing.)
- Formula backing flips: statistics, distribution, date, and lookup formulas run
  the nodes' kernels — one implementation per name, parity-pinned.
- Excel parity details: XLOOKUP/XMATCH spill array lookups and take orientation-free
  1-D matrices; COLUMNS/ROWS own rank-2 shapes; SUBSTITUTE instance_num; WRAPROWS
  pad; COUNTBLANK; WORKDAY.INTL; HYPGEOM.DIST cdf; #AMBIGUOUS! survives to the cell.
- The wired-blank contract: a sweep of every node family killed the silent
  wrong answers a wired blank could produce (literal resurrection, Infinity bounds,
  Kleene slips).
- New utility nodes: Set Cell (writes by address, extends by shape), Template,
  Hash / UUID, Wrap Text, File Link, Save Times, XSTACK, Bind Columns.
- The naming model: cards named by their op, ALL-CAPS labels are callable names,
  Excel names are search rows; a voice pass over every shipped string.
- Zoom clamps to a floor and ceiling and snaps to 10% steps; the minimap tracks
  each node's real accent.
- Toolchain: TypeScript 7 (native typecheck), Vite 8, React 19.2, Recharts 3.10,
  KaTeX 0.18, elkjs 0.12, plus the full dependency-major sweep.

## Known issues (for the GitHub release body — finalize at cut time)

- Carry forward from 1.2 if still true: browser Data Feed CORS limits, no cable
  collision avoidance (obstacle router deferred behind an LGPL gate), Android
  status-bar tint. High memory on big documents (author-filed, pre-dates the RF
  port). The 1.2 drill-in gap is CLOSED (full canvas surface inside composites) and
  the header/body hairline seam is FIXED — drop both.
