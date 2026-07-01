# Solenoid — Input / Output / Visual / Control Node Proposal

Scoping doc. A high-level survey of Solenoid's current **input, control, output, and
visual** nodes, a proposed feature set of new nodes in those four domains, and — for each
— a recommendation on whether it belongs in the **always-on core** or in a **toggleable
pack** (`packs.ts`, see `docs/pack-architecture.md`). Backed by outside research into what
dashboard / BI / no-code tools actually ship and what data-viz literature considers high
value vs long-tail. No build commitment yet; this is the menu, not the order.

Companion docs: `docs/pack-architecture.md` (the pack mechanism + core-vs-pack philosophy),
`docs/reference-packs.md` (the *data/engineering* packs — a different axis from this doc),
`docs/node-coverage.md` (current inventory).

---

## 1. Where we are today

The four categories as they ship in `nodeCatalog.ts` (the source of truth):

- **Input** (`Input` category): Number, List, Text Input, Constant, Boolean, RAND, NA,
  Web Source (CSV/JSON URL), CSV File, Import HTML, Import XML.
- **Control** (`Control` category): Slider, Angle Dial, Date Picker, XY Pad, Color, Slicer
  (filter a Frame by column values), Input Switch (multiplexer).
- **Output / Visual** (`Output` category): Display, Alert (OK/LOW/HIGH vs thresholds),
  Sparkline, Chart (column/bar/line/area + Chart Builder options), Gauge (radial dial),
  Heatmap (Frame cells colour-scaled), Conduit, Format, Group, Note, Convert, Cast.

Charts render on **`recharts@3.8.1`** (React-19 compatible) with explicit pixel dims;
Heatmap is a pure CSS-gradient swatch (no lib). The Color picker uses `colord`. This
recharts dependency is the load-bearing fact for the core-vs-pack line on charts (§5).

**Inventory verdict:** the *scalar* input side and the *basic* chart family are in good
shape. The clearest gaps are (a) **set-selection inputs** (dropdown/multi-select/radio),
(b) a real **data-table display** for the Frame type, (c) a proper **KPI/stat card**, and
(d) the **specialized chart long tail** — none of which should crowd the core.

---

## 2. The core-vs-pack rule for *these* domains

The general philosophy (`pack-architecture.md`) is "lean core, most things dormant." For
input/visual/control nodes specifically, three refinements:

1. **Core = universal across every tool surveyed.** If Streamlit, Observable Inputs,
   Retool, Tableau, Power BI, and Grafana *all* ship it, a spreadsheet refugee expects it.
   Dropdown, table display, KPI card, range slider, date-range — these are table stakes,
   not differentiators. They earn core placement.

2. **Pack = the specialist long tail.** Box plots, candlesticks, sankeys, choropleths,
   pivot matrices, camera input. High value to *some* users, clutter to most. Exactly what
   `packs.ts` exists to gate.

3. **These are *custom-widget* packs, not formula-data packs — a key nuance.** The pack
   architecture's cheap default ("a pack node is a pre-set Expression node, just data") does
   **not** apply here. A chart or an input widget is the declared exception: "needs a custom
   widget or behavior the node toolkit doesn't provide." So a Viz pack ships real node code
   (a class + a React component + a registry entry), and — unlike a formula pack — its nodes
   **cannot degrade gracefully to a live computation when the pack is off**; a dormant viz
   node falls back to a harmless placeholder (it was a pass-through sink anyway, so the
   *data* still flows — only the picture disappears). `packs.ts` already supports this:
   `PackPlacement.entry.create` takes an arbitrary node constructor, and every pack's
   constructors are always registered so saved files still load. We just haven't shipped a
   *code* pack yet (Geometry/Timesavers are formula + reclassification only).

A useful tie-breaker for borderline cases: **does it render on the existing recharts
dependency, or pull in a heavy new renderer?** Recharts-native → can be core or a no-new-dep
pack. Needs ECharts/Plotly/a map lib → pack, behind that optional dependency (§5).

---

## 3. Proposal — Charts & Visual output

### 3a. Core additions (all native to recharts@3, zero new dependencies)

The data-viz literature is strikingly consistent: **bar + line + pie cover ~80% of business
charts**, with bar #1 and line #2; bar/line/scatter are the experts' universally-recommended
trio. Solenoid already has bar/line/area/column. The cheap, high-value core fills:

| New node | What | Why core | recharts |
|---|---|---|---|
| **Scatter** | two numeric lists → XY points | the standard correlation/EDA chart; the missing leg of the bar/line/scatter trio | `ScatterChart` native |
| **Bubble** | scatter + 3rd value as point size | near-zero marginal cost over Scatter (`ZAxis`); high analytical value | `ScatterChart`+`ZAxis` |
| **Pie / Donut** | one list → part-to-whole | universally *expected* (not loved — see note); users will look for it | `PieChart` native |
| **Combo** | bars + line on shared axis | "one of the most-used dashboard charts" (revenue bars + margin line) | `ComposedChart` native |
| **Histogram** | one list → binned frequency | foundational distribution view; apt for an "Excel alternative". Bin in a graph node, draw as a bar chart | `BarChart` over pre-binned data |
| **KPI / Stat card** | one value + label, optional **delta** vs a 2nd input (↑/↓, %, colour) | the single most universal dashboard primitive; our Display node is one step away | plain DOM (no lib) |

Notes / honest defaults:
- **Pie is controversial** (Few's "Save the Pies for Dessert"; humans judge angle/area
  poorly). Ship it because users demand it, but **default the comparison affordance to
  bar**, and keep Donut as the milder 1–2-segment form.
- **Delta belongs *on* the stat card**, not as a separate node — "a number without context
  is just a number." It reuses the Alert node's threshold-colour logic.
- These six are entirely on the existing recharts/`Display` infrastructure — no new deps,
  so the "lean core" objection (bundle size, learning curve) is weak. The main cost is
  Add-menu real estate, which the category tree already absorbs.

### 3b. Pack — **Statistical Viz** (`stats-viz`)

Distribution/spread charts. Box plot and heatmap are recharts-*rough* or absent; the rest
need a heavier renderer.

- **Box plot (box-and-whisker)** — quartiles + outliers. No native recharts type; painful to
  emulate. *Heavy renderer.*
- **Violin plot** — box + density. Needs Plotly/ECharts. *Heavy renderer.*
- **Standalone Heatmap chart** — values across two categorical axes (distinct from our
  existing Frame-cell Heatmap, which is conditional-formatting, not an axed chart). *Heavy
  renderer.*
- **Contour / density** — scientific 2-D density. *Heavy renderer.*

### 3c. Pack — **Financial Viz** (`finance-viz`)

Pairs with the strong existing finance node coverage.

- **Candlestick / OHLC** — the price-data standard. Not in recharts; first-class in
  ECharts/Plotly. *Heavy renderer.*
- **Waterfall** — start value + sequential ±deltas → final (P&L bridges). No native recharts
  type; emulated awkwardly with floating stacked bars. *Heavy renderer (or rough recharts).*
- **Funnel** — pipeline/conversion stages. recharts has a native `FunnelChart`, so this is a
  **no-new-dep pack node** (or even core-adjacent). *recharts native.*
- **Bullet graph** — value vs target over qualitative bands (see 3e — strong enough to be
  core, listed there).

### 3d. Pack — **Hierarchy & Flow Viz** (`hierarchy-flow-viz`)

- **Treemap** — nested rectangles. recharts native (`Treemap`) but **tooltips don't fire on
  2-D charts** and nesting is limited. *recharts native, rough.*
- **Sunburst** — concentric hierarchy rings. recharts native (`SunburstChart`) but **no touch
  events**. *recharts native, rough.*
- **Sankey** — flow magnitude between nodes. recharts native (`Sankey`) but rigid data shape,
  no tooltips, no touch. *recharts native, rough.*
- **Radar / spider** — multivariate per-category. recharts native (`Radar`) but experts rate
  it **misleading** (area scales non-linearly; axis order changes perceived area). Pack-only,
  with a caveat tooltip. *recharts native.*
- **Network / node-link graph** — relationships. Ironically, **Solenoid's own canvas could
  render this better than any chart lib** — a possible native-renderer node rather than a
  chart-lib one. *Custom / heavy.*
- **Chord**, **Parallel coordinates** — many-to-many flows / high-dimensional. ECharts/D3.
  *Heavy renderer.*

### 3e. Bullet graph — a **core** visual, called out

The data-viz literature (Stephen Few) designed the **bullet graph explicitly to replace the
radial gauge**: a compact horizontal strip — actual value, target marker, qualitative bands
(poor/ok/good) — that stacks densely where a gauge wastes space. Strong **core** candidate
*precisely because we already ship the Gauge*: offer the recommended alternative. It reuses
the Alert node's threshold logic and renders on plain DOM/recharts primitives. Pair it with a
plain **Progress bar / bar-gauge** (trivial 0–100% fill) for the "value toward goal" case.

### 3f. Pack — **Geographic Viz** (`geo-viz`) and **Scientific Viz** (`sci-viz`)

- **Geographic** — choropleth (filled map), symbol/bubble map. High cost (tiles, projections,
  geocoding), geo-only value; the textbook optional pack. Needs Plotly/ECharts-geo or a map
  lib (Leaflet/visx-geo). *Heavy renderer.*
- **Scientific** — 3-D surface, 3-D scatter (Plotly/ECharts-GL), **Gantt** (project
  timelines; no native type in any of these libs — custom horizontal-bar build). *Heavy /
  custom.*

---

## 4. Proposal — Input & Control nodes

Cross-tool survey (Streamlit widgets, Observable Inputs, Retool, Tableau/Power BI slicers,
Grafana variables, Airtable fields). Solenoid's *scalar* inputs are well covered; the
**set-selection** family is the conspicuous universal gap.

### 4a. Core additions (universal across all tools surveyed, currently missing)

- **Dropdown / single-select** — *the* most universal input we lack. Pick one of a typed
  list of options. (Streamlit `selectbox`, Observable `select`, Retool, every BI slicer.)
- **Multi-select** — pick any subset; pairs naturally with our List/Frame outputs.
- **Range / dual-handle slider** — pick a min–max band. Our Slider is single-value; a band
  slider is everywhere in BI (Tableau "Range of Values", Power BI numeric range slicer).
- **Date-range picker** — start+end. Ubiquitous; complements our single Date Picker.

*(Second-look: Dropdown, Multi-select, Range slider, and Date-range are the firm core — they
expose data the canvas genuinely can't produce another way.)*

### 4b. Pack — **Form & Survey Inputs** (`form-inputs`)

Stylistic variants and lower-frequency widgets:

- **Radio group / Checkbox group** *(second-look demotion from core)* — these carry the same
  data as Dropdown/Multi-select, just "all options visible." On a space-constrained node
  canvas the compact select is the better default, so these are a presentation variant, not a
  separate must-have. Ship after the selects.
- **Generic file-upload** *(second-look demotion from core)* — Solenoid's data-in story is
  already covered by **CSV File + Web Source + Import HTML/XML + Image**, and a generic
  "any file → bytes" node has nothing downstream to *consume* raw bytes yet. Lower priority
  than it first looked; revisit when there's a bytes/blob consumer.
- **Button / action trigger** *(second-look caveat)* — genuinely useful (gate/commit an
  expensive branch) but its semantics are non-obvious in a *push-based reactive* engine where
  everything already recomputes on change; it needs a clear "what does pressing it mean"
  design (a latch? a one-shot? a manual-recompute gate?) before it's core. Park in this pack
  until that's settled.
- **Text area** (multi-line) · **Combobox / autocomplete** (search-mode dropdown, once
  dropdown exists) · **Segmented control / pill buttons** (styling variant of radio) ·
  **Select-slider** (slider over ordered non-numeric values) · **Time / datetime picker**
  (niche vs date) · **Rating / feedback** (survey) · **Tags input** (list-of-tokens; overlaps
  List) · **Number stepper** (a *mode* of the Number field, not a new node).

### 4c. Pack — **Media Inputs** (`media-inputs`, desktop-leaning)

- **Camera / webcam capture** · **Audio / microphone input**. Clearly specialized
  (`st.camera_input`, `st.audio_input`); pack-only.

### 4d. Table-coupled controls — a natural second wave (leans on the Frame type)

These only make sense because Solenoid has a Frame/table type, and extend the existing
**Slicer**:

- **Search box → table** — free text filters matching rows of a Frame (`Inputs.search`).
  Natural Slicer companion; strong candidate. → could be **core** alongside Slicer.
- **Column-sourced select** — a dropdown/multi-select whose options are a Frame column's
  distinct values (what makes BI slicers *dynamic*). An *option-source* mode on the core
  Dropdown node once it exists.
- **Selectable table input** — user checks rows; the value is the selected subset
  (`Inputs.table` / `st.data_editor`). High value for an "Excel alternative" (mirrors
  selecting cells), but a substantial feature → **pack** (`table-inputs`) or later-core.

---

## 5. Proposal — Non-chart Output / Display nodes

Beyond charts, BI tools lean heavily on a handful of non-chart display primitives.

### 5a. Core additions

- **KPI / Stat card** (also in §3a) — labeled big-number with optional delta. The biggest,
  most universal dashboard primitive; the highest-leverage upgrade to Display.
- **Data Table / Grid display** — render the **Frame type as a real formatted grid** (typed
  columns, alignment, number formatting). Tables are a first-class output in *every* tool
  surveyed; we have the Frame data type but no proper grid *view* of it. Highest-value gap on
  the output side after the stat card.
- **Conditional formatting on tables** — colour cells/rows by rule and by scale, plus in-cell
  **data bars / mini-bars** (Metabase, Power BI). Our Heatmap already does the colour-*scale*
  half; the **rule-based + data-bar** half is the gap, and it's what makes a table a *visual*.
- **Progress bar / bar-gauge** — simple "value toward goal"; cheap, ubiquitous, complements
  Gauge. (Pairs with the Bullet graph from §3e.)
- **Text / Markdown panel** — a *data-bound* text/markdown sink (distinct from the static
  **Note**): bind a Display-like node to a template string of upstream values. Cheap and
  universally present (Grafana Text, Power BI text box).

### 5b. Pack — **Dashboard Output** (`dashboard-viz`)

- **Pivot table / matrix** — cross-tab with row/column hierarchies, subtotals, drill-down.
  Valuable and a natural fit for a table app, but substantial → pack / later-core, ship a
  plain Data Table first.
- **Multi-row card** — several labeled values tiled; easily emulated by tiling stat cards.
- **State timeline / status history** — discrete states over time; monitoring-specific.
- **Status light / state badge** — discrete OK/WARN/CRIT chip. *Largely already covered by
  the Alert node*; a small badge/dot visual variant would round it out (could be a core
  Alert option rather than a new node).
- **Smart narrative / decomposition tree / key-influencers** — AI/analytics-heavy; out of
  scope or far-future.

---

## 6. The dependency line (the practical constraint)

Everything in §2's "core" and the recharts-native pack nodes ships on the **existing
`recharts@3.8.1`** dependency — no bundle-size or new-lib cost. The specialist packs split
cleanly:

- **No new dependency (recharts-native, just rougher):** Funnel, Treemap, Sunburst, Sankey,
  Radar. Ship as packs to avoid Add-menu clutter, but note the tooltip/touch limitations in
  their descriptions.
- **Needs one heavy renderer:** box/violin/heatmap-chart/contour (statistical),
  candlestick/waterfall (financial), choropleth/symbol-map (geographic), chord/parallel-coords
  (flow), 3-D/Gantt (scientific). **Recommendation: gate all of these behind a single
  optional dependency rather than scattering libs.** **ECharts** gives the broadest
  coverage-per-dependency (heatmap, candlestick, gauge, graph/network, parallel coords, geo
  maps, even 3-D via ECharts-GL); **Plotly** is the pick if statistical + financial + 3-D
  parity is the priority. Lazy-load it only when a heavy-viz pack is switched on — which is
  exactly the level-1 isolation the pack architecture already aims for ("a pack's code isn't
  loaded until switched on").
- **Native-canvas candidate:** the **network/node-link graph** is the one case where
  Solenoid's *own* canvas renderer could beat any chart lib — worth prototyping before
  reaching for ECharts's graph series.

This also means a heavy-viz pack is **desktop-first-friendly**: the optional renderer is dead
weight in a web build but free on disk in the Tauri build (matches the browser/desktop split
in `compute-architecture.md`).

---

## 7. Suggested sequencing

Order by value-to-effort, leaning on what's already in place:

1. **Core, no-new-dep, high value:** KPI/Stat card (with delta) · Dropdown + Multi-select ·
   Data Table grid view of the Frame type. These three close the biggest universal gaps.
2. **Core, cheap, leans on existing logic:** Scatter/Bubble · Histogram · Bullet graph +
   Progress bar (reuse Alert thresholds) · Range slider · Date-range picker. *(Radio/checkbox
   groups, generic file-upload, and the Button trigger were demoted to the Form pack on
   second look — see §4b.)*
3. **Core table polish:** conditional formatting + in-cell data bars on the Data Table;
   Search-box-to-table beside the Slicer.
4. **First *code* pack** (proves the custom-widget pack path `packs.ts` stubs but hasn't
   exercised): a recharts-native pack — **Funnel + Treemap + Sunburst + Sankey + Radar** — no
   new dependency, so it isolates the *pack-loading* mechanics from the *heavy-dependency*
   question.
5. **Heavy-renderer packs** (after the optional-dependency lazy-load lands): Statistical →
   Financial → Geographic → Scientific, in rough demand order.

Pie/Donut and Radar ship available-but-non-default given the expert criticism.

---

## 8. Sources

Charts / data-viz value:
- Luzmo — chart types: https://www.luzmo.com/blog/chart-types
- ThoughtSpot — types of charts/graphs: https://www.thoughtspot.com/data-trends/data-visualization/types-of-charts-graphs
- Atlassian — essential chart types: https://www.atlassian.com/data/charts/essential-chart-types-for-data-visualization
- Recharts specialized charts (Sankey/Funnel/Treemap/Sunburst/Radar limits): https://deepwiki.com/recharts/recharts/3.3-specialized-charts
- React charting library comparison (Recharts vs ECharts/Plotly/Nivo): https://medium.com/@ponshriharini/comparing-8-popular-react-charting-libraries-performance-features-and-use-cases-cc178d80b3ba
- Stephen Few, "Save the Pies for Dessert": https://www.pdqdecide.com/post/pie-charts-and-chart-junk
- "Radar — more evil than pie": https://darkhorsevisualization.com/blog/radar-more-evil-than-pie
- Power BI filled maps / choropleths: https://learn.microsoft.com/en-us/power-bi/visuals/power-bi-visualization-filled-maps-choropleths

Input / control widgets:
- Streamlit input widgets API: https://docs.streamlit.io/develop/api-reference/widgets
- Observable Inputs: https://observablehq.com/framework/inputs/
- Retool input component library: https://retool.com/blog/new-input-ui-component-library
- Tableau filter card types: https://help.tableau.com/current/pro/desktop/en-us/filtering.htm
- Power BI slicers (numeric/date range, relative): https://learn.microsoft.com/en-us/power-bi/visuals/power-bi-visualization-slicers
- Grafana variable types: https://grafana.com/docs/grafana/latest/dashboards/variables/add-template-variables/
- Airtable field types: https://support.airtable.com/docs/supported-field-types-in-airtable-overview

Non-chart visual output:
- Grafana visualizations (full panel list): https://grafana.com/docs/grafana/latest/visualizations/panels-visualizations/visualizations/
- Power BI visualizations overview: https://learn.microsoft.com/en-us/power-bi/visuals/power-bi-visualizations-overview
- Power BI card visual: https://learn.microsoft.com/en-us/power-bi/visuals/power-bi-visualization-card
- Bullet graph (Stephen Few / Information Dashboard Design): https://en.wikipedia.org/wiki/Bullet_graph · https://www.domo.com/learn/charts/bullet-graphs
- Metabase tables (conditional formatting, mini bars): https://www.metabase.com/docs/latest/questions/visualizations/table
- Streamlit st.metric: https://docs.streamlit.io/develop/api-reference/data/st.metric

(Per CLAUDE.md, WebFetch is unreliable on JS-rendered pages; the Power BI/Grafana/Streamlit
enumerations above are server-rendered or markdown-sourced and were treated as trustworthy,
while small-model page *summaries* were treated as paraphrase.)
