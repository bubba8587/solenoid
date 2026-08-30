# Glossary — Solenoid's invented vocabulary

Solenoid has coined a lot of terms. They're used precisely and consistently in the code
and docs, but their definitions live only in whoever's head wrote them. A wrong guess
about what "Standoff" or "FrameRef" means sends an agent down the wrong path. This is the
single place to learn the words. One line each, plus where it lives in code, grouped by
area. When you coin a new load-bearing term, add it here.

## Graph & canvas

- **Node** — one computation unit; a card on the canvas. Its `data()` method is a pure
  function of its inputs. (`nodes/*.ts`, `components/nodeKit.tsx`)
- **Cable / connection** — a wire carrying a value from one node's output socket to
  another's input. The dependency edges of the graph. (`flow/FlowCableEdge.tsx`,
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
  (elkjs via `elkTidyLayout`, `arrangeFn` — `tidyArrange.ts`)
- **Isolate** — a focus mode showing only a scoped sub-region of the graph.
  (`isolate.ts`, `isolateStore.ts`)
- **Pin** — a value lifted out of the graph onto a persistent HUD overlay.
  (`pinStore.ts`, `PinLayer.tsx`)
- **Collapse** — shrinking a node's body to just its result box (per-node chevron).
  (`collapseStore.ts`)
- **Snap to grid** — dropped nodes round to the 24px background-dot grid.
  (`gridSnapStore.ts`, `GRID_SNAP_STEP`)
- **Load curtain** — the build-phase progress overlay over a document load (the
  rete-era draw-on animation was dropped at the React Flow cutover).
  (`loadReveal.ts`, `LoadOverlay.tsx`)

## Values, types, errors

- **SolError** — a tagged error value (`#DIV/0!`, `#SHAPE!`, `#TYPE!`, `#DOMAIN!`,
  `#OVERFLOW!`, `#CIRC!`, `#N/A`…) that propagates through the graph. One notion of
  error; `ISERROR` ⟺ `IFERROR`. (`errorValue.ts`)
- **Missing / null** — a first-class "hole" in a list/frame: rendered `null`, *skipped* by
  aggregators, propagated by element-wise math, dropped by Filter. Distinct from an error.
  (`valueKinds.ts` `isMissing`)
- **`forAggregate`** — the canonical prep an aggregator must run: propagate the first
  SolError, drop nulls, keep the rest. The correct-handling primitive for the value model.
  (`valueKinds.ts`)
- **Kleene logic** — 3-valued AND/OR/NOT (true/false/null) matching SQL/Polars.
  (`valueKinds.ts` `kleeneAnd/Or/Not`)
- **Logical type** — first-class Boolean (purple socket family) rendering TRUE/FALSE,
  coercing ↔ 1/0. The one cross-family socket bridge. (`sockets.ts`, `nodes/logic.ts`)
- **Socket lattice** — the ruleset for what can connect to what: type families never
  auto-cross (Cast required); dimensionality flows upward freely. (`sockets.ts`,
  `socketConnect.test.ts`; see decisions.md socketLattice)
- **Cast** — the explicit node to change a value's type family (the required bridge the
  lattice won't do automatically). (`nodes/cast.ts`)
- **Fill** — the opt-in node to treat `null` as a real value.
  (`nodes/list.ts` `FillNode`)

## Format & units

- **Format Controller (FC)** — a node that LOCKS a value's number format, and authors a
  unit ONLY onto a unit-less value; both ride the value through passthroughs and
  selectors. A transform drops the FORMAT; the unit's dimension re-derives through the
  algebra and keeps its display when the dimension survives (unitOnValue / firstClassUnits).
  (`nodes/formatController.ts`, `fcReconcile.ts`)
- **FC lock states** — who owns the FC's unit dropdown: *authored* (the FC set it),
  **forwarding** (an inherited upstream unit — the FC MIRRORS it, locked, because a
  unit is first-class like the magnitude; firstClassUnits), **lockedByConvert** (a downstream
  Convert's `fromUnit` dictates it). `unitLocked = lockedByConvert || forwarding`.
  (`nodes/formatController.ts`)
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
- **Verb node** — a relational operation node — Filter/Sort/Join/GROUPBY/Append/
  Distinct/PIVOTBY/Unpivot/Nest/Unnest/Computed Column/Split Column… and the rest of the
  catalog's Table group. (`nodes/frame.ts`, `frameVerbs.ts`; inventory in
  `nodeCatalog.ts`)
- **FrameBackend** — the seam with two implementations: `JsFrameBackend` (web/dev, eager)
  and `PolarsBackend` (desktop, native Rust). One interface, chosen at startup.
  (`frameBackend.ts`; see decisions.md polarsEngine)
- **Frame verbs (`frameVerbs.ts`)** — the pure JS reference implementation ("the oracle")
  of every verb; the correctness standard the Rust engine is tested against.
- **Materialization boundary** — the point where a lazy `FrameRef` is collected into a
  real `FrameValue` (e.g. Get Column, a chart, an export). (`coerceInputs.ts`)
- **Preview / collectPreview** — a verb card shows head-N rows, not the whole frame;
  `FrameValue.__totalRows` carries the true count. (`frameBackend.ts`)
- **Source-handle cache** — a WeakMap keyed by frame identity so a given frame uploads to
  Rust only once. (`frameBackend.ts` `_sourceCache`)
- **Cube** — the recursive nested-table container (a frame whose cells can be frames);
  the anti-flat-grid feature, with cached depth and a drill-in popup. (`CubeValue` in
  `frame.ts`; nodes in `nodes/cube.ts`, `cubePopupStore.ts`)
- **Computed column** — a frame column whose cells come from a per-row computation
  (an inline formula or a wired λ) instead of typed data. ONE definition per column,
  never per cell (noPerCellFormulas). Two surfaces, one core: the Frame Input popup's per-column
  source picker (**Data | Formula | λ**) and the Computed Column verb node.
  (`computedColumnCore.ts`, `nodes/frame.ts`, `tablePopupStore.ts`; decisions tableRefSemantics/noPerCellFormulas)
- **Side value** — a non-column value wired into a computed column's definition (a
  scalar or a row-aligned list); surfaces grow/prune side sockets from the expression's
  free names (`sideVars`). `@list` reads a side list's this-row element after a length
  check. (`computedColumnCore.ts`, `nodes/frame.ts`)

## Formula layer

- **Expression node** — the in-cell formula node; computes at rank ≤ 2 — scalars, lists,
  matrices, complex (matricesInFormulas lifted the old 1-D cap). Frames/cubes stay out permanently: the
  verb engine is their surface. (`nodes/expression.ts`; see decisions.md noFramesInFormulas → matricesInFormulas)
- **LAMBDA** — a reusable formula value with named params, plus the 2-D LAMBDA family
  (MAP/BYROW/REDUCE…). In a computed column its PARAMS are row-bound; free names and
  @names in the body become **capture** sockets on the Lambda card. (`nodes/lambda.ts`
  `captured`, `nodes/tableLambda.ts`)
- **`@` / this-row reference** — inside a computed column, `@name` reads THIS row's cell
  of a column (or a side list's element, length-checked). A bare name is the WHOLE
  column as a list — Excel's table semantics exactly (tableRefSemantics). (`computedColumnCore.ts`
  `readRowCell`/`readWholeColumn`, `excelFormula.ts` `atcol`/`wholecol`)
- **Structured (bracket) reference** — the spelling for unspellable column names:
  `[Unit Price]` whole column, `@[Unit Price]` / `[@Unit Price]` this row. Replaced the
  deleted `col()`/`at()` functions. (`excelFormula.ts` tokenizer `colref`/`rowref`)
- **Formula evaluator** — the tree-walking `evalAst` in `excelFormula.ts` is THE
  evaluation core (the old `compileFormula` codegen path was retired outright).
- **RANGE_FUNCTIONS** — formula functions that take a whole list at once (SUM, MEDIAN…)
  vs. element-wise broadcast ones. (`excelFormula.ts`)

## Persistence & structure

- **Seed** — a bundled example document (plain JSON in `seedGraphs/`), machine-checked in
  CI. The template gallery + demo/marketing substrate. (`seeds.ts`, `seeds.test.ts`)
- **Placeholder node** — what an unknown/renamed node type loads as: inert, keeps wiring +
  data, re-serializes as the original type (lossless). (`nodes/placeholder.ts`)
- **Pack** — an optional node-family add-on (the lean-core split); most ship off,
  Geometry and Timesavers ship on (`defaultActive`).
  (`packs.ts`, `pack-architecture.md`)
- **Note frontmatter** — a `---`-fenced YAML block at the top of a Note that turns keys
  into typed output sockets (a Note as a typed-record source). (`noteFrontmatter.ts`)
- **Document / library** — the multi-doc model; each doc persists to its OWN
  two-slot localStorage pair plus a light index. (`documentStore.ts`, `persistence.ts`)

## Runtime & rendering

- **processGraph** — the recompute-and-rerender entry point; never call it from a text
  field's `onChange` (edits commit on Enter/blur). (`process.ts`)
- **DataflowEngine** — rete's PULL-based execution engine (inputs resolve recursively
  before `data()` runs; async ones awaited). (`rete-engine`, `process.ts`)
- **Calc mode** — manual vs. automatic recompute; F9 forces a recompute in manual mode.
  (`calcModeStore.ts`; see decisions.md calcModes)
- **Compute overlay** — the deferred "Computing…" curtain that blocks interaction during a
  heavy pass. (`computeOverlayStore.ts`, `ComputeOverlay.tsx`)
- **Render mode** — `dom` (default/fallback) vs. `html` (HTML-in-canvas). (`renderMode.ts`)
- **HTML-in-Canvas renderer** — draws the real DOM cards into a canvas via a mip-pyramid of
  bitmaps during pan/zoom gestures; idle is the real DOM. (`htmlCanvasRenderer.ts`,
  `HtmlCanvasLayer.tsx`)
- **perfProbe** — the runtime instrumentation (`window.__solenoidPerf` / `__solenoidStats`)
  logging per-pass node `data()` + engine IPC. (`perfProbe.ts`)
- **Alert / HUD** — the Alert node fires on status *change* (edge-detect) → a toast + the
  HUD log. (`alertStore.ts`, `HudStack.tsx`)
- **View** — the canvas-view seam (`view.ts`, renamed from rete's "Area" 2026-08-30):
  `position(id)`/`nodeElement(id)`/`connectionElement(id)`/`hasNode(id)`, the camera
  (`transform`/`zoom`/`pan`), `moveNode`, `rerenderNode`/`rerenderCables`, `measured`;
  `flow/flowView.ts` is the one implementation and `view` is its variable name
  everywhere. Positions live ON the node (`node.position`, absolute canvas coords) —
  there is no side map. **FlowSurface** is the one React component both canvases
  render (decisions oneFlowSurface).

## The author's UI vocabulary (chrome name → code handle)

Geometry (offsets, z-index, reflow) is `layout-chrome.md`; this is term → handle.

- **File / menu bar** — top strip (File/Edit/… + doc name). `MenuBar.tsx` · `.solenoid-menubar`.
- **Top bar** — toolbar row under it. `TopBar.tsx` / `AppToolbar.tsx` · `.solenoid-topbar`.
  On a TABLET it also carries the touch actions (`TabletActions.tsx`, `html.is-tablet`).
- **Navigator** — left outline panel. `OutlinePanel.tsx` · `.solenoid-outline` (open sets
  `body.solenoid-nav-open`).
- **Bottom bar** (mobile) — touch action bar. `MobileControls.tsx` · `.solenoid-mobile-bar`.
  A TABLET never gets it (it runs the desktop chrome) — same actions live in the top bar;
  both bars source handlers/glyphs from `touchActions.tsx` (drift-pinned).
- **Zoom pill** (desktop) / **Lock pill** (mobile) — upper-right canvas controls. `NavMenu.tsx`.
- **Align bar** — top-center align/distribute pill (≥2 selected). `SelectionActionsBar.tsx`.
- **Minimap** — bottom-right. RF `<MiniMap>` in `flow/FlowSurface.tsx` wearing the
  `.solenoid-minimap` window; accent policy in `components/Minimap.tsx` (hidden on mobile).
- **Cable inspector** — selected-cable panel. `CableInspector.tsx`.
- **Conduit popup** — floating toolbar on a Conduit. `ConduitComponent.tsx` ·
  `.solenoid-conduit-toolbar`.
- **Chips** — compact value previews in a value box. `ArrayChip.tsx` variants (frame/cube/chart);
  one chip registry `ValueChip.tsx` `valueChipFor`; errors → `ErrorChip`.
- **List / Frame / Cube popups** — click-to-open viewers. `TablePopup.tsx` / `CubePopup.tsx` /
  `ChartPopup.tsx`.
- **Problems / Alerts / Pins / Comments** — the right-side HUD stack. `HudStack.tsx` +
  `alertStore` / `pinStore` / `problemsStore` / `commentStore`.
- **Nodes** — the cards. `NodeCard.tsx` (NodeShell). NO single wrapper class — roots vary
  (`.solenoid-node` / `.solenoid-note` / `.solenoid-group` / `.solenoid-conduit`); map a DOM
  event → node via `view.nodeElement` containment, never a class.
- **Sockets** — typed dots on node edges. `NodeSocket.tsx` (`MeasuredSocketRow`);
  `.input-socket` / `.output-socket`, locked 12×12 (rules socketBox12).
- **Cables** — `flow/FlowCableEdge.tsx` (a `<g>` in RF's shared edge svg); paths from
  `cablePaths.ts`, ribbons from `ribbonCable.ts`.
- **Hero box** — the large result box at a node's bottom. `.solenoid-node__io-row--hero`; value
  renders as `.solenoid-node__display-value`.
- **Pills** — (1) button-group pills (radius-999 clusters, segmented toggles); (2) merged-socket
  pills on a collapsed group (`.solenoid-node__output-pill` etc.).
- **App menu** (mobile) — the round ⋯ overflow button opening the File sheet.
  `.solenoid-topbar__icon` → `.solenoid-menubar__sheet`. (The brand lives in Row A's
  wordmark, `.solenoid-menubar__wordmark`.)
- **FC** — the **Format Controller** node. `FormatControllerNode.tsx` · `formatController.ts`;
  model `formatModel.ts`, flow `unitFlow.ts`.
- **Reference** — the tabbed overlay (Ctrl+/). `FunctionReference.tsx` · `.fr-panel`.
- **Inspector** — the right-dock node detail panel ((i) in the top bar). `InspectorPanel.tsx` ·
  `inspectorStore.ts` · `html.sol-inspector-docked`.
