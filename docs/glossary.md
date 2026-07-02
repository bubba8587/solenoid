# Glossary — Solenoid's invented vocabulary

Solenoid has coined a lot of terms. They're used precisely and consistently in the code
and docs, but their definitions live only in whoever's head wrote them. A wrong guess
about what "Standoff" or "FrameRef" means sends an agent down the wrong path. This is the
single place to learn the words. One line each, plus where it lives in code, grouped by
area. When you coin a new load-bearing term, add it here.

## Graph & canvas

- **Node** — one computation unit; a card on the canvas. Its `data()` method is a pure
  function of its inputs. (`nodes/*.ts`, `nodeKit.tsx`)
- **Cable / connection** — a wire carrying a value from one node's output socket to
  another's input. The dependency edges of the graph. (`ConnectionComponent.tsx`,
  `cablePaths.ts`)
- **Socket** — the typed plug where a cable attaches; shape = dimensionality, color =
  type. Locked to a deterministic 12×12 box for cable-endpoint math. (`sockets.ts`,
  `NodeSocket.tsx`)
- **Conduit** — a rotatable multi-lane node that bundles several cables through one
  routed channel; essentially a row/record and a bridge toward table ops.
  (`nodes/conduit.ts`, `ConduitComponent.tsx`)
- **Ribbon (cable)** — the visual bundling of 2+ Conduit cables running together;
  membership derived fresh per render. (`ribbonCable.ts`)
- **Standoff** — a rigid spacing constraint between nodes (axis-band; LOCKED = rigid 45°);
  a standoff-connected cluster moves as one block. (`standoffSolver.ts`)
- **Group** — a container box around member nodes; expand/collapse pushes surrounding
  nodes out of the way. (`groupPushCore.ts`, `GroupNode.tsx`)
- **Tidy / auto-arrange** — ELK-based layout with a custom symmetric port preset.
  (`rete-auto-arrange-plugin` usage, `arrangeFn`)
- **Isolate** — a focus mode showing only a scoped sub-region of the graph.
  (`isolate.ts`, `isolateStore.ts`)
- **Pin** — a value lifted out of the graph onto a persistent HUD overlay.
  (`pinStore.ts`, `PinLayer.tsx`)
- **Collapse** — shrinking a node's body to just its result box (per-node chevron).
  (`collapseStore.ts`)
- **Snap to grid** — dropped nodes round to the 24px background-dot grid.
  (`gridSnapStore.ts`, `GRID_SNAP_STEP`)
- **Load reveal** — the cinematic startup animation (nodes fade in, cables draw on).
  (`loadReveal.ts`, `LoadOverlay.tsx`)

## Values, types, errors

- **SolError** — a tagged error value (`#DIV/0!`, `#SHAPE!`, `#CIRC!`, `#TYPE!`, `#N/A`…)
  that propagates through the graph. One notion of error; `ISERROR` ⟺ `IFERROR`.
  (`errorValue.ts`)
- **Missing / null** — a first-class "hole" in a list/frame: rendered `null`, *skipped* by
  aggregators, propagated by element-wise math, dropped by Filter. Distinct from an error.
  (`valueKinds.ts` `isMissing`)
- **`forAggregate`** — the canonical prep an aggregator must run: propagate the first
  SolError, drop nulls, keep the rest. The correct-handling primitive for the value model.
  (`valueKinds.ts`)
- **Kleene logic** — 3-valued AND/OR/NOT (true/false/null) matching SQL/Polars.
  (`valueKinds.ts` `kleeneAnd/Or/Not`)
- **Logical type** — first-class Boolean (purple socket family) rendering TRUE/FALSE,
  coercing ↔ 1/0. The one cross-family socket bridge. (`sockets.ts`, `logic.ts`)
- **Socket lattice** — the ruleset for what can connect to what: type families never
  auto-cross (Cast required); dimensionality flows upward freely. (`sockets.ts`,
  `socketConnect.test.ts`; see decisions.md D7)
- **Cast** — the explicit node to change a value's type family (the required bridge the
  lattice won't do automatically). (`nodes/cast.ts`)
- **Coalesce / Fill** — the opt-in node to treat `null` as a real value. (`list.ts`
  `FillNode`)

## Format & units

- **Format Controller (FC)** — a node that LOCKS a value's unit + number format; the lock
  rides the value through passthroughs and selectors, breaking at a transform.
  (`formatController.ts`, `fcReconcile.ts`)
- **Unit flow** — the machinery that carries an FC's unit/format lock along the value both
  downstream and upstream through passthroughs, derived on read. ($ is a unit, not a
  format.) (`unitFlow.ts`, `unitFormat.ts`)
- **Annotation** — the resolved unit/format metadata attached to a value for display;
  computed by walking the graph, mostly not stored. (`formatAnnotationStore.ts`)
- **Convert** — the node that changes a value's unit (m→ft), forwarding its target into a
  downstream FC. (`nodes/convert.ts`)

## Tables (frames) & the engine

- **Frame** — Solenoid's table: typed columns, may carry nulls and per-cell errors.
  (`frame.ts`)
- **FrameValue** — a fully-materialized frame held in JS memory. (`frame.ts`)
- **FrameRef** — a *lazy handle* on a cable pointing at a frame living in the engine
  (a query plan), not the data itself. (`frameBackend.ts` `isFrameRef`)
- **Verb node** — a relational operation node: Filter/Sort/Join/Group By/Append/Distinct/
  Rename/Select/Drop/Pivot/Unpivot/Nest/Unnest/Frame Lookup/Split Column/Add Index.
  (`nodes/frame.ts`, `frameVerbs.ts`)
- **FrameBackend** — the seam with two implementations: `JsFrameBackend` (web/dev, eager)
  and `PolarsBackend` (desktop, native Rust). One interface, chosen at startup.
  (`frameBackend.ts`; see decisions.md D1)
- **Frame verbs (`frameVerbs.ts`)** — the pure JS reference implementation ("the oracle")
  of every verb; the correctness standard the Rust engine is tested against.
- **Materialization boundary** — the point where a lazy `FrameRef` is collected into a
  real `FrameValue` (e.g. Get Column, a chart, an export). (`coerceInputs.ts`)
- **Preview / collectPreview** — a verb card shows head-N rows, not the whole frame;
  `FrameValue.__totalRows` carries the true count. (`frameBackend.ts`)
- **Source-handle cache** — a WeakMap keyed by frame identity so a given frame uploads to
  Rust only once. (`frameBackend.ts` `_sourceCache`)
- **Cube** — the recursive nested-table container (a frame whose cells can be frames);
  the anti-flat-grid feature, with cached depth and a drill-in popup. (`cube.ts`,
  `cubePopupStore.ts`)

## Formula layer

- **Expression node** — the in-cell formula node; capped at the type-agnostic scalar/1-D
  subset. (`nodes/expression.ts`; see decisions.md D2)
- **LAMBDA** — reusable formula values + 2-D LAMBDA family (MAP/etc.). (`nodes/lambda.ts`,
  `nodes/tableLambda.ts`)
- **Formula compiler** — `compileFormula` (AST→closure) in `excelFormula.ts`; a real
  compiler, currently prod-unused (the tree-walking `evalAst` runs instead) — flagged in
  future-directions Bet 1 as latent leverage.
- **RANGE_FUNCTIONS** — formula functions that take a whole list at once (SUM, MEDIAN…)
  vs. element-wise broadcast ones. (`excelFormula.ts`)

## Persistence & structure

- **Seed** — a bundled example document (plain JSON in `seedGraphs/`), machine-checked in
  CI. The template gallery + demo/marketing substrate. (`seeds.ts`, `seeds.test.ts`)
- **Placeholder node** — what an unknown/renamed node type loads as: inert, keeps wiring +
  data, re-serializes as the original type (lossless). (`nodes/placeholder.ts`)
- **Pack** — an optional, off-by-default node-family add-on; the lean-core split.
  (`packs.ts`, `pack-architecture.md`)
- **Note frontmatter** — a `---`-fenced YAML block at the top of a Note that turns keys
  into typed output sockets (a Note as a typed-record source). (`noteFrontmatter.ts`)
- **Document / library** — the multi-doc model; the whole library serializes to
  local storage (two-slot rotation). (`documentStore.ts`, `persistence.ts`)

## Runtime & rendering

- **processGraph** — the recompute-and-rerender entry point; never call it from a text
  field's `onChange` (edits commit on Enter/blur). (`process.ts`)
- **DataflowEngine** — the push/pull reactive execution engine (rete) that runs `data()`
  methods and awaits async ones. (`rete-engine`, `process.ts`)
- **Calc mode** — manual vs. automatic recompute; F9 forces a recompute in manual mode.
  (`calcModeStore.ts`; see decisions.md D8)
- **Compute overlay** — the deferred "Computing…" curtain that blocks interaction during a
  heavy pass. (`computeOverlayStore.ts`, `ComputeOverlay.tsx`)
- **Render mode** — `dom` (default/fallback) vs. `html` (HTML-in-canvas). (`renderMode.ts`;
  see decisions.md D6)
- **HTML-in-Canvas renderer** — draws the real DOM cards into a canvas via a mip-pyramid of
  bitmaps; crisp at any zoom. (`htmlCanvasRenderer.ts`, `HtmlCanvasLayer.tsx`)
- **perfProbe** — the runtime instrumentation (`window.__solenoidPerf` / `__solenoidStats`)
  logging per-pass node `data()` + engine IPC. (`perfProbe.ts`)
- **Alert / HUD** — the Alert node fires on status *change* (edge-detect) → a toast + the
  HUD log. (`alertStore.ts`, `HudStack.tsx`)
