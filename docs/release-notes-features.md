# Solenoid 1.3 — feature highlights (selling list)

Curated, high-value features that will sell 1.3 — the source material for the release
notes (the author writes the final copy) and the **What's New** slides. Living doc:
keep it current as features land; each entry is a *benefit*, not a changelog line.
Order = rough selling priority. Mark `[slide]` on the ones worth a What's-New slide.
The bar for what earns a spot: `archive/release-notes-1.1.md` (a sell is a shiny thing
a user will go discover and play with, or something that would inspire a download —
What's New is not a changelog; GitHub is). The 1.2 list shipped with v1.2.0
(2026-07-22) and lives in git history.

Covers everything on `develop` since the v1.2.0 tag.

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
- **[slide] Matrix formulas & LAMBDA.** Expression now takes matrices (D23):
  TRANSPOSE/MMULT/SEQUENCE/WRAPROWS and the array-returning core, LAMBDA as a first-
  class value — including eta-lambdas, higher-order `f(x)`, and reusable λs wired
  across the graph — plus complex numbers (IM* over a true complex type). Every
  registrable Excel-name is now callable: ~380 non-pack functions, and **every pack
  function** (SUNRISE, AWG, PIPE…) works in a formula the moment its pack is active.
- **[slide] Query.** A Power Query-style transform node: drop a Query, drill in,
  chain the table verbs, and Refresh on demand — upstream changes only mark it
  stale, never silently recompute (D22: a pre-seeded manual-mode Composite).

## Release-notes body

- Lists everywhere: the date, text, and complex families are element-wise now —
  wire a list of dates into EOMONTH like a column, no MAP ceremony.
- Frame verbs typed in a formula (FILTER, PIVOT…) are recognized and redirected to
  their node — a real name gets guidance, never a bare `#NAME?`.
- Click a column header in any table popup to sort the view — multi-column,
  visual-only, the value never changes.
- A value's unit is first-class now: a Format node downstream of a united value
  shows the unit locked instead of letting a dropdown relabel it — changing a
  display unit takes a Convert node, because a unit change is a magnitude change.
- The Add menu finds operations *inside* nodes: searching "median" surfaces the
  Aggregate card's op, not just node names.
- The desktop (Polars) engine and the web engine are corpus-tested to agree
  bit-for-bit — one fixture set runs both, fuzzed, including fused verb chains and
  non-finite edges.
- Touch: pinch-zoom can't be stolen by the node under your fingers, and a touch
  never selects a node on contact — selection lands on release.
- Tablet support: correct viewport on touch-desktop browsers, fullscreen on the
  zoom pill, stable pinch-zoom on mobile-class GPUs.
- Socket Types reference rewritten from the live socket registry; socket shades
  retuned; a full voice pass over every shipped string.

## Known issues (for the GitHub release body — finalize at cut time)

- (carry forward any still true from 1.2: drill-in Navigator/lasso/group tools,
  header/body hairline seam, browser Data Feed CORS limits, no cable collision
  avoidance, Android status-bar tint.)
