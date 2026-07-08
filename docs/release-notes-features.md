# Solenoid 1.1 — feature highlights (selling list)

Curated, high-value features that sell 1.1 — the source material for the release
notes (the author writes the final copy) and the **What's New** slides. Living doc:
keep it current as 1.1 scope lands; each entry is a *benefit*, not a changelog line.
Order = rough selling priority. Mark `[slide]` on the ones worth a What's-New slide.

## Headliners

- **[slide] Edit a composite like it's its own canvas.** Drill into a composite node
  and the whole app comes with you — toolbar, minimap, zoom, right-click, copy/paste,
  keyboard, Tidy. It's a real canvas now, not a stripped-down popup.
- **[slide] Ask "what if" — four ways.** Composite containers run as **Goal Seek**
  (drive an input until an output hits a target), **Scenarios**, **Data Table** (sweep
  a grid of inputs), and **Simulation**. Heavy ones are arm-and-run: a Solve button and
  a stale dot, so nothing recomputes behind your back.
- **[slide] Live market & economic data.** Pull FRED economic series straight onto the
  canvas with **no API key** — pick a date range and frequency, chart it in a click, and
  compute on the real series. Stock history comes via a free Alpha Vantage key. Feeds
  refresh on a timer and never bake data into the file. (The **Live Market Data** seed
  is the demo.)
- **[slide] Every chart Excel has, and then some.** Pie, Scatter, Bubble, Radar,
  RadialBar, Funnel, Composed — plus **Treemap, Sankey, Histogram, KPI cards, Bullet
  graphs**, and a date-range control. All themed to your palette.

## Analysis & data

- **One XLOOKUP for everything** — lists, frames, and cubes through a single node,
  with approximate match and as-of (nearest-date) lookups.
- **Trust your model.** An **Expect** node (not-null / unique / range / regex checks),
  a **Problems** panel, a **Reconcile** node (compare two frames), **Tornado** sensitivity,
  and a one-click model fuzzer that finds inputs that break your math.
- **[slide] Reports & presentations, built in.** A **Report** node writes plain markdown
  with live `=value` embeds (numbers, tables, charts, equations, Mermaid diagrams);
  **Presenter mode** turns the canvas into a click-through slideshow. Add **Mermaid**
  diagrams as a first-class node.
- **Fast on big tables.** Native Polars engine on desktop; **Sketch** mode samples huge
  tables so editing stays snappy, and **Manual** calc (F9) puts you in control.

## Polish & control

- **Format once, flows everywhere.** The redesigned Format Controller carries a value's
  unit + number format downstream, with an advanced tier (separators, accounting negatives,
  K/M/B scaling) — and Convert stays first-class.
- **[slide] Make it yours.** A custom palette editor, per-document properties (title/author/
  tags/palette), type-coloured chips, and a command palette that's every menu action + recent
  actions in one Enter-press.
- **Zero-Googling from Excel.** Hover tooltips with Excel equivalents, a socket legend, and a
  Ctrl+/ function reference.

## Under the hood (mention, don't headline)

- First-class drill-in seam (`activeGraph`) + shared area presets so surfaces can't drift.
- Rust engine parity (byte-identical keys, Infinity handling), native CSV date inference,
  AND/OR frame filters, headless graph runner + file-sink nodes.

---

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
