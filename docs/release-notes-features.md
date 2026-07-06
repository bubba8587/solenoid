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
- **[slide] Live market & economic data.** *(1.1 build)* Pull FRED economic series and
  stock/FX quotes straight onto the canvas with your own API keys — refreshes on a timer,
  charts in a click, never bakes data into the file.
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
*Not in 1.1 (coming in 2.0):* units-by-dimensionality, the Excel `.xlsx` importer.
