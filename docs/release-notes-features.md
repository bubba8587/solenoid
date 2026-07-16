# Solenoid 1.2 — feature highlights (selling list)

Curated, high-value features that sell 1.2 — the source material for the release
notes (the author writes the final copy) and the **What's New** slides. Living doc:
keep it current; each entry is a *benefit*, not a changelog line. Order = rough
selling priority. Mark `[slide]` on the ones worth a What's-New slide.
1.1's version of this doc: `archive/release-notes-1.1.md` (the bar definition lives
there too: a sell is a shiny thing a user will go discover and play with, or something
that would inspire a download — What's New is not a changelog; GitHub is).

Covers everything on `develop` since the v1.1.5 tag (~2026-07-10): the units
flagship, the what-if wave, Obsidian both ways, the terrain/field family, the chart
+ draw-controls waves, and the table cleanup verbs.

## Headliners — the slide deck (8, in order)

- **[slide] Real units.** Values carry units now. `SUM(5 km, 3)` is 8 km, `m × m`
  is m², and metres plus seconds fails **loud** with `#UNIT!` instead of silently
  adding nonsense. Units ride through lists (per element), frames (per column,
  lockable from a `Speed (km/h)` header), lookups and selectors; the Format
  Controller authors them, Convert changes them, and `10 m ÷ 2 m` cancels to a
  pure 5:1 ratio. No spreadsheet does this.
- **[slide] Monte Carlo.** Give a composite's inputs a ± spread and its outputs
  come back as distributions — mean ± sd with a histogram, from a seeded,
  reproducible sampler. Uncertainty as a first-class value, next to the Goal Seek /
  Scenarios / Data Table modes 1.1 shipped.
- **[slide] Draw your data.** Three new controls make data by hand: **Point
  Plotter** (click a plane, drag points, get X/Y lists), **Curve** (drag a
  no-overshoot spline envelope, get it sampled — tuning curves, easing, tiered
  rates), **Grid Painter** (paint a matrix with a value brush). Sketch a dataset,
  then run real regression on it.
- **[slide] Terrain & fields.** Wire a coordinate-bordered grid and watch it move
  between forms: **Grid Interpolate** fills the blanks (thin-plate spline, with
  forecast), **Surface** draws it as a shaded 3-D mesh, **Contour** draws the map
  view with iso-lines, **Vector Field** draws arrow flows — and Add Index's new
  two-way output turns any table into that bordered grid in one hop.
- **[slide] Seven new chart types.** **Waterfall** (the finance bridge),
  **Candlestick** (wire Data Feed stock history straight in), **Boxplot**,
  **Calendar heatmap** (a GitHub-style year of daily values), **Waffle**,
  **Contour**, **Vector Field** — plus a flat **7-Segment** meter readout for the
  dashboard corner. All of them embed live in Reports.
- **[slide] Obsidian, both directions.** Import a vault note as a live, typed
  source (frontmatter becomes output sockets; Reload re-reads from disk) — and
  write Notes or Reports back into the vault as portable markdown with real
  tables, mermaid blocks, math, and rendered chart images.
- **[slide] Table cleanup, the daily set.** **Fill Down** (un-merge report-shaped
  tables), **Replace Values**, **Merge Columns**, **Promote Headers**, **Drop
  Blank Rows**, and first/last/skip/range row slices — Power Query's everyday
  cleanup verbs as honest nodes, errors-in-errors-out.
- **[slide] Scrub any number.** Drag a number field to set it — Shift for coarse,
  Alt for fine — on every number input in the app, including the Number node.

## Analysis & data (sells for the release notes body, not slides)

- **Goal Seek grew guardrails** — max iterations, tolerance, and search bounds on
  the composite solver; Simulation runs show a live sparkline of the series inside
  the drill-in and on the card.
- **The Problems panel sees inside containers** — per-cell errors in lists and
  frames are itemized (bounded head+stride scan), and the model fuzzer is
  frame-aware; its "+ Clamp" quick-fix now arrives pre-seeded with the observed
  safe range.
- **Tornado is honest about extremes** — an input that breaks the model at an
  extreme is kept, marked, and surfaced at the top instead of silently dropped;
  tooltips show each bar's swing basis.
- **Multi-key sorting by chaining** — sorts are stable in both engines, so Sort by
  Sales → Sort by Region is a proper two-key order; documented on the node.
- **Grid Interpolate got smarter** — bilinear boxes that contain other known data
  defer to the spline (a sine wave along a diagonal interpolates as a wave, not a
  flat fill), and edges follow the spline instead of clamping.
- **Extreme numbers read as numbers** — forced scientific notation past 12 digits
  (or below 1e-4) in every table/frame cell, sized to the mono grid.

## Polish (mention, don't headline)

- **The Add menu breathes** — every pane fits without a scrollbar (regrouped into
  ≤12-row panes with subcategories); searching "add" or "multiply" now puts the
  arithmetic node first; the Frame socket has its own glyph in the legend.
- **The Reference explains the type system** — a new data-model chapter: what
  flows where, what coerces, how units attach at each container rank.
- Table Input never rewrites what you typed (blank rows survive anywhere, unparseable
  cells keep their source text); MUNIT can emit blanks instead of zeros; Filter has
  is-blank / not-blank; EXPAND pads with null unless you wire a fill.
- Formula editor: argument-count hints in autocomplete, a live parameter bar, and
  omitted arguments (`IF(x=0,,x)`) parse as blanks instead of erroring.

## Feature changelog (for the GitHub release body — features only, no fixes)

### Units
- Values carry dimensional units: per-element on lists, per-column on frames (`Name (unit)` headers lock), one unit per matrix
- `#UNIT!` mismatch algebra across Arithmetic, Math, Expression, Aggregate, SUMIFS, Get Column, and the lambda reducers
- The Format Controller authors a value's unit; Convert re-bases it; same-dimension division cancels to a ratio
- Bare numbers adopt the united side's display unit (`SUM(5 km, 3)` = 8 km)
- Trig ops read the incoming angle unit (deg/rad/Auto)

### What-if & trust
- Monte Carlo composite run mode: ± spread + distribution per input, mean ± sd + histogram per output, seeded sampler
- Goal Seek solver parameters: max iterations, tolerance, search bounds
- Simulation series sparkline on the composite card and inside the drill-in
- Problems panel + model fuzzer itemize per-cell errors inside lists and frames
- Fuzzer "+ Clamp" quick-fix pre-seeded with the observed safe range
- Tornado keeps and marks inputs that diverge at an extreme

### Nodes — charts & visuals
- Waterfall, Candlestick, Boxplot, Calendar heatmap, Waffle, Contour, Vector Field
- 7-Segment display readout
- Surface (shaded 3-D plot of a bordered grid) and Grid Interpolate (thin-plate spline fill with forecast)
- All figures embed live in Reports

### Nodes — controls
- Point Plotter, Curve (monotone spline envelope), Grid Painter
- Drag-to-scrub on every number field (Shift coarse / Alt fine)

### Tables
- Fill Down / Up, Replace Values, Merge Columns, Promote/Demote Headers, Drop Blank Rows
- Head modes: first / last / skip / range
- Add Index two-way output: any table → a coordinate-bordered grid
- Stable sorts in both engines (chain Frame Sorts for multi-key order)
- MUNIT blanks toggle; Filter is-blank/not-blank; EXPAND null padding; Table Input preserves blank rows and source text

### Documents & integrations
- Import from Obsidian: a vault note as a live typed source
- Write to Obsidian: Notes/Reports as portable markdown with rasterized figures
- Reference overlay: a data-model chapter (types, coercion, units by container)

### Chrome
- Add menu regrouped into no-scrollbar panes; exact-name search ranking; Frame socket glyph
- Formula editor argument hints, parameter bar, omitted-argument blanks

## Known issues (for the GitHub release body — deliberately NOT shown in-app)

Finalize at cut time (pending the 1.2 movement + composite-parity passes):

- **Inside a composite drill-in**, grouping, Cleanup/Autofit, the Navigator and
  lasso-select aren't available yet (main canvas only), and the top toolbar still
  drives the main canvas — keyboard and right-click do target the subgraph.
- **A hairline seam** can show between a node's header and body at some zoom
  levels (cosmetic).
- **Data Feed in the browser is CORS-limited** — some providers only work in the
  desktop app, which fetches natively.
- **No cable collision avoidance yet** — cables can overlap in dense graphs.
- **Android**: the status bar doesn't tint to the app accent in a normal tab
  (platform limitation).

---
*Punted to 1.3 (author call 2026-07-16):* iFrame/embed node (CSP posture), Data
Feed widening, drill-in navigator + lasso + group tools, document-level FC defaults.
