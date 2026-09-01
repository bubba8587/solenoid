# Deferrals — the parked set (no plan attached)

Everything the author has parked, ruled reopen-only, or left waiting on a trigger, in ONE
place — with the notes needed to reopen it without re-deriving. **Planned items are not
here:** the 2026-09-01 planning pass scored every deferred idea and moved the ones with a
plan into [`1.4-plan.md`](1.4-plan.md) (the workbench release) or [`2.0-plan.md`](2.0-plan.md)
+ [`v2.0/`](v2.0/README.md) (the structural arcs). An item the author rejects from those plans
comes back here with a one-line reason; an item promoted from here gets a plan section there
and its entry deleted. Ruled-out-forever ideas: `out-of-scope.md`; settled rationale:
`decisions.md`.

## Needs an author decision before any build

- **Architecture map v2 — WAIT FOR THE AUTHOR'S SPEC.** The old map (Subsystem cards +
  import cables, generator chain, coverage guards) is deleted. The author will describe the
  replacement precisely; build nothing toward it until then.
- **Feature/value copy doc** for landing/marketing — author will initiate; ranked candidate
  copy lines per feature, author ranks value.
- **Table/cube popup virtualization for wide EDITABLE frames** (author 2026-08-30: "don't
  really care" — parked; `1.4-plan.md` B9 HOLD). Read-only cells already render plain text
  (~50% off every read-only popup, landed 2026-08-24; `scripts/table-popup-probe.mjs` has the
  measurements). The open call is Path A (keep the `<table>`, window the `<tr>`s ourselves,
  ~60 lines) vs Path B (div-grid rewrite on `react-window` — settled: react-window CANNOT wrap
  the existing `<table>`, its rows are hardcoded divs). Either path: sort order, an open edit
  scrolling out, Copy CSV / Export staying whole-dataset, and the form-view pager all need
  checking. 1.4's frozen-header lift (B3) is `position: sticky` and does not prejudge this.
- **INDEX — marked for later (2026-07-01, `archive/cube-node-scope.md`)**: output socket
  should express Cube (today singular `any`); Excel range forms (`row=0`/`col=0` whole
  row/col, the reference form) — Solenoid INDEX is cell-only. (`1.4-plan.md` D6 HOLD.)

## Reopen only if the trigger returns

- **Image as a real FrameColType** (author proposal with the Record node, 2026-08-18;
  evaluated and deferred). A first-class `image` column touches every layer that switches on
  `FrameColType` — both FrameBackends and the cargo parity corpus, CSV read/write, coercion,
  socket coloring, the popup editor — for a payload Polars cannot compute on. What the
  proposal was FOR (a picture rendering inside a Record box) shipped without it:
  `recordImageSrc` detects `data:image/` and image-extension URLs in plain STRING cells at
  the display layer. Reopen only if images need to behave differently from strings inside
  the ENGINE (e.g. an attachment store bundling frame images the way the Image node bundles
  its file — 2.0's cloud assets, `v2.0/21-collaboration.md`, would be that trigger); the
  next cheap slice would be the same detection in `TablePopup` cells. The same blast-radius
  argument is why 1.4's categorical columns (B2) ship as sugar, not a type.
- **Data Feed widening** — real symbol-search picker + more providers (shipped baseline:
  FRED keyless / Alpha Vantage keyed). Stays Excel STOCKHISTORY scope — no crypto/FX/
  real-time/options/fundamentals (FX itself is the widget-node call, `1.4-plan.md` C1).
  Reopen on a user ask. (`1.4-plan.md` C3 HOLD.)
- **Lazy handles, the ruled-out tail** (Slicer went lazy 7c34d874; plan doc deleted): Rust
  store as `LazyFrame` plans (would make an intermediate flush free but breaks the eager-
  independent-frames drop rule) and `WireOp::pivot` — both out-of-scope separate calls.
- **Distribution accuracy widening** — representative-point validation only today; widen if
  accuracy is ever in doubt.
- **Pack variant-switch reconciles the socket set** — a variant dropdown would add/remove
  sockets like Cast/read-as do. (The existing custom nodes all keep fixed sockets across
  their dropdowns, deliberately — nothing waits on this; the Materials & Mechanical pack,
  `1.4-plan.md` E3, uses fixed sockets.)
- **MMULT dimension algebra** — only if a dimensioned-linear-algebra use case ever appears;
  documented-strip is the deliberate stance (unitGranularity).
- **Provenance Tier 2 — on-demand "why is this?" walk** — backward-derivation trace for any
  value (Tier 1, error origin + fly-to-source, shipped in `errorValue.ts`). Idea salvaged
  from the archived provenance bundle. 1.4's pin (A1, "a pinned value is a labeled literal")
  and the dependency-cone brush (A4) are the closest planned relatives.
- **Inside-solve stale dot is uniform** — after an INSIDE Solve the dot reads green though
  the held result is seed-based; distinguishing needs a drill-state signal in the compute
  layer (couples `data()` to `compositeEditorStore`). Left simple on purpose; revisit only
  if it reads as misleading (1.4's A0 badge vocabulary is where a "held" state would go).
- **Obsidian follow-ups (if wanted)**: auto-reload an imported note on file change (the
  Stage-0 file watcher in `v2.0/21-collaboration.md` would give this for free); write config
  for `![[Note]]` transclusion vs inlining an embedded note's body.
- **Group-by-into-nesting / a top-edge "grid" Build Cube** — considered-and-dropped ideas
  the cube doc keeps on the table; add only on demand.
- **Two-axis board (swimlanes)** — Airtable's kanban lacks it; a differentiator if the board
  ever grows. HOLD until 1.4's grouped gallery (B1) proves the lane machinery.

## Parked bugs (explicitly parked by the author)

- **High memory use (Chrome tab estimate) for a light app** (author 2026-08-26, parked
  2026-08-30: wait) — longstanding, predates the RF port; not investigated. The
  MEASUREMENT is planned (`1.4-plan.md` F5: a heap snapshot on the getting-started seed vs a
  blank doc — retained node clones? HIC pyramids? popup caches? per-doc tab growth); the
  virtualization lever is 2.0's `v2.0/22-canvas-at-scale.md`. This entry stays until the
  finding lands.
- **Choppy zoom BAND (parked by the author 2026-08-25: "something we've been chasing our
  tail on massively").** An interior range of camera scales zooms choppier than both
  extremes; not pinned to a `k` range. The full record — what is ruled out (gesture-exit
  settle, element count, the HIC mip curve) and the untried T1–T8 plan — moved verbatim to
  `archive/dev-notes-history.md` (sweep 2026-08-25). Reopens only on the author's say-so,
  and then starts at T1/T2 (pin `k`, trace inside vs outside the band), nothing built before.

## Parked features (revisit only if the trigger returns)

- **UI-scale toggle (Default / Larger)** — subsumes all per-panel resize asks; don't build
  per-panel resize. **Moveable / resizable / hideable toolbar chrome** is the same
  customization slice (`1.4-plan.md` F3 HOLD; `layout-chrome.md` shows the cost).
- **Cable collision avoidance** — spec: `archive/cable-routing.md` §2. Superseded by the
  obstacle-router shape if the author accepts its license (`1.4-plan.md` F1); delete this
  entry when F1 lands.
- **Grid system** — spec: `grid-system.md`.
- **`content-visibility: auto` on node roots — ruled out** while socket positions are
  measured from live DOM geometry (off-screen subtrees don't compute descendant layout →
  cable endpoints jump at the viewport edge). Headless card metrics (`v2.0/22`, step 1)
  would lift that objection — re-evaluate after it, before virtualization.
