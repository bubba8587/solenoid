# Solenoid 1.1 — feature highlights (selling list)

Curated, high-value features that sell 1.1 — the source material for the release
notes (the author writes the final copy) and the **What's New** slides. Living doc:
keep it current; each entry is a *benefit*, not a changelog line. Order = rough
selling priority. Mark `[slide]` on the ones worth a What's-New slide.

**The bar (author 2026-07-08):** a sell is a shiny thing a user will go discover and
play with, or something that would inspire a download / link click on social media —
what makes someone want this alongside or over Excel. What's New is not a changelog;
GitHub is. Non-sells that shipped (document properties, type-colored chips, charts
following the palette as its own line, composite-editor/main-canvas parity) live in
the body sections or under the hood, not on slides.

## Headliners — the slide deck (11, in order)

- **[slide] What-if analysis.** Wrap part of a model in a composite node and ask
  what-if without disturbing the rest: **Goal Seek** (drive an input until an output
  hits a target), **Scenarios**, **Data Table** (sweep a grid), **Simulation** (step a
  feedback loop). Heavy modes run on Solve, with a stale marker. *(The composite
  drill-in editor is the machinery behind this, not the sell.)*
- **[slide] Command palette.** Ctrl+K, type, Enter: every menu action and toggle, with
  recent actions first. Can be docked always-on.
- **[slide] Live market & economic data.** FRED series with **no API key**; date range
  + frequency; stock history via a free Alpha Vantage key. Chart it and compute on the
  same numbers; feeds refresh on a timer and never bake data into the file. The
  **Live Market Data** seed is the demo.
- **[slide] Mobile redesign.** Three role-split zones: document strip, tool row, and a
  thumb-reach bottom action bar (undo, add, select, delete). Palette, navigator, and
  examples all work on a phone.
- **[slide] Reports.** Markdown with live `=name` embeds: numbers, tables, charts,
  equations, diagrams, all recomputing in place. Docks to the right edge while the
  canvas stays live.
- **[slide] Presenter mode.** A Presentation node plays the canvas as a slideshow: the
  camera flies step to step, chrome hides, the graph stays live.
- **[slide] Mermaid diagrams.** Flowcharts, sequence/state diagrams, Gantt, pie, from
  plain text; template starters; embeds in a Report.
- **[slide] Set operations.** Union / intersection / difference / symmetric difference
  plus membership tests, rendered in set notation on the card. Excel has no direct
  equivalent.
- **[slide] More chart types.** Pie, Scatter, Bubble, Radar, Radial, Funnel, Composed,
  plus Treemap, Sankey, Histogram, KPI cards, and Bullet graphs.
- **[slide] Align & distribute bar.** Select two or more nodes: align edges or centers
  and distribute spacing evenly, both axes.
- **[slide] Palette editor.** Design a palette on live sample nodes; use it app-wide or
  pin one to a document. Charts, diagrams, and the desktop window border follow it.

## Analysis & data (sells for the release notes body, not slides)

- **One XLOOKUP for everything** — lists, frames, and cubes through a single node,
  with approximate match and as-of (nearest-date) lookups.
- **Trust your model.** An **Expect** node (not-null / unique / range / regex checks),
  a **Problems** panel, a **Reconcile** node (compare two frames), **Tornado** sensitivity,
  and a one-click model fuzzer that finds inputs that break your math.
- **Fast on big tables.** Native Polars engine on desktop; **Sketch** mode samples huge
  tables so editing stays snappy, and **Manual** calc (F9) puts you in control.
- **Format once, flows everywhere.** The redesigned Format Controller carries a value's
  unit + number format downstream, with an advanced tier (separators, accounting negatives,
  K/M/B scaling) — and Convert stays first-class.
- **Zero-Googling from Excel.** Hover tooltips with Excel equivalents, a socket legend, and a
  Ctrl+/ function reference.

## Under the hood (mention, don't headline)

- Composite drill-in runs in the full editor (minimap, keyboard, right-click, Tidy) via
  the `activeGraph` seam + shared area presets.
- Document properties (title/author/tags/palette), type-colored chips, charts themed to
  the palette.
- Rust engine parity (byte-identical keys, Infinity handling), native CSV date inference,
  AND/OR frame filters, headless graph runner + file-sink nodes.

## Known issues (for the GitHub release body — deliberately NOT shown in-app)

Honest list of what's rough in 1.1; each is tracked in `backlog.md` / dev-notes.

- **Tidy / Cleanup around expanded groups is wonky** — auto-arrange and cleanup can
  misplace nodes when expanded groups are involved; re-running or nudging recovers.
- **Inside a composite drill-in**, grouping, Isolate, Cleanup/Autofit, the Navigator
  and lasso-select aren't available yet (main canvas only), and the top toolbar still
  drives the main canvas — the keyboard and right-click menu do target the subgraph.
- **Node-label edits aren't undoable** (on any surface) — Ctrl+Z skips them.
- **A hairline seam** can show between a node's header and body at some zoom levels
  (cosmetic).
- **Data Feed in the browser is CORS-limited** — some providers only work in the
  desktop app, which fetches natively.
- **The Problems panel and model fuzzer only see whole-value errors** — a per-cell
  error inside a list/frame shows in the value, but isn't itemized in the panel.
- **Tornado ranking** mixes true sensitivity with each input's sweep width (a Slider
  sweeps its full range, a Number ±10%), and an input that errors at an extreme is
  dropped from the chart rather than marked.
- The model fuzzer's **"+ Clamp" quick-fix inserts an unconfigured Clamp** — set the
  bounds yourself after inserting.
- **Set nodes compare complex numbers by identity**, so equal complex values from
  different sources never match.
- **No cable collision avoidance yet** — cables can overlap each other and nodes in
  dense graphs.
- In **private browsing** during a network outage, recovering from a stale deploy can
  reload-loop (the web app can't persist its retry guard).
- **Android**: the status bar doesn't tint to the app accent in a normal tab
  (platform limitation).

---
*Not in 1.1 (coming in 2.0):* units-by-dimensionality, the Excel `.xlsx` importer.
