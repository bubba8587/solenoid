# Solenoid — Architecture & File Map

Living document, kept at **module granularity** (one line per concern, not one
line per node file — there are ~300 of those and the registry is the real
index). Update when a new module or concern lands, in the same commit.

Deep behavioral notes and gotchas live in `CLAUDE.md` (agent-facing) and
`docs/dev-notes.md` (running log). This file is the map.

---

## Top-level layout

```
/
├── docs/                     # Planning, design, decisions, this map
├── src/                      # React + TypeScript frontend (the canvas + UI)
├── src-tauri/                # Tauri (Rust) shell: window, fs/dialog plugins
├── public/                   # Static assets served by Vite
├── fixtures/                 # frame-verbs/ — the shared JS↔Rust verb corpus (FX-12)
├── scripts/                  # new-node.mjs (scaffold), run-graph.ts (headless runner; takes
│                             #     JSON or the text form, gated on graphValidate),
│                             #     validate-graph.ts (strict-reader CLI), ai-grounding.ts
│                             #     (model-facing spec CLI), ai-prompt.ts (the palette's AI
│                             #     loop from a terminal, real key),
│                             #     formula-node-parity.ts (SSOT-6 gap report), op-exposure.ts,
│                             #     socket-inventory.ts (regenerates socket-reference counts),
│                             #     fuzz-frame-verbs.ts, tune-seeds.mjs, parity.ts, release-build.ps1
├── .claude/                  # Claude Code project config: skills/ (add-node), commands/, settings.json
├── .github/workflows/        # CI: test.yml (tsc+vitest), windows-portable.yml (solenoid.exe),
│                             #     cargo-audit.yml (src-tauri/Cargo.lock advisories)
├── package.json              # JS deps + scripts (dev, build, test, tauri)
├── vite.config.ts            # Vite config (keepNames: constructor.name is load-bearing)
├── vitest.config.ts          # Test runner config
└── index.html                # HTML entry point
```

## Stack

- **Graph engine**: Rete v2 (`rete`, `rete-area-plugin`, `rete-react-plugin`,
  `rete-connection-plugin`, `rete-engine` DataflowEngine, history, minimap,
  auto-arrange/ELK).
- **UI**: React + Vite, desktop shell via Tauri. Math helpers: formulajs,
  KaTeX (formula popup), marked (help panel).
- Rete renders node components in a **separate React root** — cross-root state
  is module-level singleton stores (`storeKit.ts` pattern), never React context.

---

## Frontend (`src/`)

```
src/
├── main.tsx                  # Entry — init theme/packs/flow stores, mount <App />
├── App.tsx                   # Top-level: canvas + overlays (popups, dialogs, settings)
├── App.css                   # Theme token layer (dark/light ramps; socket colors are BUILT by palette.ts/appTheme.ts, not defined here. The NEUTRAL ramp IS defined here, but a palette may replace it — appTheme writes or CLEARS every chrome var per apply, see D35)
├── mobile.css                # @media (pointer: coarse) overrides (desktop layout is truth)
├── desktopFrame.css          # Tauri window chrome
├── env.ts                    # IS_COARSE / isDesktop-style environment flags
├── logo/                     # Brand assets
└── graph/                    # Everything graph-related (flat; grouped below by concern)
```

### Engine / core (`src/graph/`)

| Module | Role |
|---|---|
| `process.ts` | Module singleton `_editor/_engine/_area`; `processGraph()` recompute + re-render; recalc generation (volatile nodes); graph-rebuild guard; history hook. **STAYS MAIN-ONLY** (persistence/serialize read it) |
| `activeGraph.ts` (+`.test.ts`) | The canvas-substitution SEAM: `setActiveGraph(ctx\|null)` registers a substituting surface (composite drill-in), `getActive*`/`getOwningEditor` resolve override-else-main. Chrome/actions read these so a drill-in is first-class; `getEditor()`/persistence stay MAIN (locked by the test). Register on mount / clear on unmount; nested surfaces REPLACE (breadcrumb stack lives in compositeEditorStore) |
| `areaPresets.ts` | Shared rete config for EVERY editing surface (main canvas + drill-in), so they can't drift: `solenoidClassicRenderSetup` (node/socket/connection components + socket-position watcher), `makeSolenoidConnectionFlow` (compat + self-loop + lock veto), `CappedZoom` + `installSurfacePointer` (proportional wheel + double-click-zoom suppression + capture-seated `area.pointer`), `installSurfaceBackground` (camera-tracked dot grid), `installPinchTranslateVeto`. Drift-pinned by `surfaceParity.test.ts`; the behaviors still stranded in `Canvas.tsx`'s init closure are the 1.4 kernel bundle in `deferrals.md` |
| `schemes.ts` | Rete scheme types (`SolenoidConnection` must use `ClassicPreset.Node` — variance) |
| `rete-nodes.ts` | Node class re-exports for the editor |
| `nodeRegistry.ts` | `NODE_COMPONENTS`: `[Ctor, Component]` rows — the one place a node binds its React component |
| `coerceInputs.ts` | `nodecreated` pipe wrapping every `data()` — normalizes incoming shapes to the socket's declared type (`#SHAPE!` on coercion failure); widens scalar/list/matrix → `frame` (list = ROW), bridges logical↔number. Per-input policy: a node lists `rawInputs` (a `ReadonlySet<string>`) to receive an input UNCOERCED and branch on the runtime shape itself (XLOOKUP's `frame` — a polymorphic frame-or-cube source); ACCEPTANCE stays lattice-driven, COERCION is the node's call |
| `persistence.ts` (+`persistenceCore.ts`) | JSON save/load (format v2), localStorage autosave, export/import; ctor lookup derived from the catalog; `rebuildGraph(…, animate)` cinematic load reveal. ORDER MATTERS in the rebuild tail: `settleWildcardTypes` runs BEFORE the FC dock loop (SOCK-13, pinned by `fcDockReload.test.ts`). `persistenceCore` holds the pure validate/version helpers (`validateSavedGraph`, `CURRENT_SAVE_VERSION`) |
| `loadReveal.ts`, `components/LoadOverlay.tsx` | Load-reveal store (phase/progress/revealed conns) + `revealWaves` layering; the build-phase progress overlay |
| `copyPaste.ts` | Ctrl+C/V with topology, id remap (own `cloneNode`/`pasteClipboard` path); ALSO the home of `extractInit`/`INIT_FIELD_ORDER` — imported by persistence/aiGrounding/composite |
| `nodeCtorRegistry.ts` | The ctor lookup, DERIVED from the catalog (calls every `FLAT_CATALOG` factory, keys by `ctor.name`) — what persistence resolves types through |
| `guardedSocketPosition.ts` | The socket-position watcher `areaPresets` installs (orphan-record eviction — see subsystem-invariants) |
| `documentStore.ts` (+`documentStoreCore.ts`) | Multi-document library: current doc + open tabs; per-doc autosave as ONE two-slot pair per doc id (`solenoid.docs.doc.<id>.a/.b`) plus a light two-slot index, object-identity change-detection so an unchanged doc costs zero serialization (`documentStorePersist.test.ts`); `documentStoreCore` holds the pure validate/transform helpers |
| `textForm.ts` | The addressable model's text projection: pure `SavedGraph ↔ text` (one node per line, topological + alphabetical-tie order, name-addressed connections); `serializeGraph`'s JSON is generated by round-tripping through it, not hand-maintained; robustness fuzzed in `textFormFuzz.test.ts` (clean rejection or round-trip closure, never a hang) |
| `graphValidate.ts` | The STRICT validating reader (D27/D28 pre-apply gate): every silently-repaired load condition is a repair-grade, line-anchored issue; op values checked against `opVocab.ts`; recurses into composite internals; cycles are warnings. False-positive guards: the seeds + whole-catalog sweeps in its test |
| `opVocab.ts` | Per-class `op=` vocabulary (NODE_OPS + catalog leaves + hiddenOps + the dropdown-only aggregate families); shared by the validator and the grounding spec |
| `aiGrounding.ts` | The model-facing authoring spec, GENERATED from the catalog + live classes (grammar, socket lattice, per-class init/inline/ops); cached per session as the AI system prompt |
| `aiService.ts` (+`aiKey.ts`) | The AI palette's loop: prompt + current text form → `claude-opus-5` (SDK, browser opt-in, user's key) → prose answer or fenced full rewrite, validator-gated with repair rounds; canonicalized for the diff |
| `textDiff.ts` | Pure LCS line diff for the AI apply-approval view |
| `nodeNameStore.ts`, `nodeNaming.ts` | The addressable model's other half: every node's stable, user-editable, unique `name` (separate from rete's regenerated-on-load `id`) |
| `docMetaStore.ts` | Per-document metadata (F-2): author + tags → `SavedGraph.meta`, sidecar-carried; the Document Properties modal open flag (`docPropertiesPanel`). Title stays the documentStore name |
| `seeds.ts` + `seedGraphs/*.json` | Example graphs in Export format, globbed into a registry |
| `Canvas.tsx` | Rete bootstrap: plugin construction + the event pipes (selection semantics, drag bookkeeping, group reconcile, FC dock/undock) and the component JSX. The separable subsystems live in the `canvas*`/`tidyArrange`/`fcDocking` modules below and are wired here |
| `canvasKeyboard.ts` | `installCanvasKeyboard(deps)` — the whole keyboard map (single-key graph actions, Ctrl chords, F9, arrows/nudge, rotate, Tab chrome toggle) + its helpers (resolveGroupTargets, rotateSelection, nudgeSelection) |
| `canvasLasso.ts` | `installLassoSelection(deps)` — shift-drag / touch-select lasso: winding-direction touch vs enclose modes, cached node rects, frame-coalesced live apply, release-time cable path sampling |
| `canvasContextMenu.ts` | `installCanvasContextMenu(deps)` — native right-click routing: socket (with near-miss radius) → cable (ribbon/selection expansion) → node body (pin/standoff offers) → blank canvas Add menu |
| `canvasActions.ts` | The graph actions those menus/keys invoke: `deleteSelection` (ghost-splicing bulk delete), `insertConduitForCables` (lane-bundled Conduit splice), `linkStandoffBetween`, `deleteCables`, `attachFormatController` |
| `canvasGeometry.ts` | Screen ↔ canvas coordinate helpers (`getSocketScreenCenter`, `screenToCanvas`) shared by FC docking + quick-wire placement |
| `fcDocking.ts` | FC docking: `findDockTarget` (canvas-unit snap), `computeDockedCanvasPos`/`dockedRenderedDims`, and the inline splice/unsplice (`insertFcInline`/`removeFcInline`) |
| `tidyArrange.ts` | Tidy + Cleanup: `makeEnsureArrange` (lazy ELK), `makeArrangeFn` (the group/standoff/docked-FC-aware ELK layout — see subsystem-invariants "Auto-arrange / Tidy"), `makeCleanupFn` |

### Typing / sockets / units

| Module | Role |
|---|---|
| `sockets.ts` | `SocketDataType` + `SOCKET_COLORS` (CSS vars, incl. purple = logical); `FAMILIES` (element × dim lattice) DERIVES `SOCKET_ACCEPTS`; `accepts`/`areCompatible`/`canConnect`. Governing rule: enforce TYPE separation (Cast to cross families; only logical↔number bridges), allow DIMENSIONAL flow (scalar→list→matrix→frame); `anytable`/`frame` widen from lower rank. The wildcard ladder (D17): `any` = untyped SCALAR, `anycombo` = 0-or-1-D, `anylist`/`anytable` = 1-D/2-D, `anydata` = rank ≤ 2 (D23), `trueany` = the adopt-anything supremum (hollow ring; `AdoptiveSocket`/`MutableSocket`, `isWildcardType`) |
| `valueKinds.ts` | First-class value-model kinds: `null` (missing), logical (boolean), Kleene 3-valued logic helpers; aggregators skip null / propagate `SolError` |
| `errorValue.ts` | Tagged `SolError` values (Excel-style `#CODE!`); `installErrorGuards(node)` wraps every `data()` at `nodecreated` (error in → error out); `withOrigin`/`SolErrorOrigin` stamp the FIRST mint site (nodeId/name, row index for list/frame cells) so a chain of passthroughs still points at the true source; `registerErrorSink` is the seam the Problems panel taps (reports `null` on a clean pass so a relapse re-fires) |
| `nodeStoreRegistry.ts` | The forget seam: any node-keyed module store (collapse, manual size, cable values, socket angles…) calls `registerNodeForget(fn)` once; `forgetNode(id)` runs from the `noderemoved` pipe AND the bulk-delete path (`canvasActions`), so a deleted node's entries don't leak — a new store never threads its own cleanup |
| `flyToNode.ts` | Pan/zoom the viewport to center one or more nodes (expanding a collapsed host group first) — the shared "go to this node" action behind the pins HUD, alerts HUD, popup "Go to node" buttons, and Presentation's per-step camera fly |
| `nodes/kind.ts` | node → `NodeKind` CLASSIFIER (`nodeKindOf`) + per-kind weights/resizable/wide flags; the kind → accent map (`NODE_KIND_ACCENTS`) lives in `nodes/shared.ts` |
| `dimension.ts` | Dimensional algebra — the pure, graph-free units foundation (dimension vectors, multiply/divide/power, commensurability) |
| `unitValue.ts` | The unit-on-the-VALUE layer (FC A4): `UnitCell` (base-SI magnitude + display id), mirrors `valueKinds.ts`'s shape; `applyFcUnit` lives at this seam via `unitBridge` |
| `unitDimExpr.ts` + `unitLattice.ts` | Unit-expression algebra (compound unit spellings) + the unit compatibility lattice |
| `unitBridge.ts` | The unit-blind boundary (`stripUnitCells`, applied per-input by `coerceInputs`; `unitAware = true` opts a node into the algebra — VAL-10) + `applyFcUnit`'s three branches |
| `unitColumn.ts` | Per-column frame units: `ColumnUnit`, `columnUnitFromSpec`, `parseColumnUnitFromHeader` — the D20 frame granularity, incl. computed columns |
| `unitFlow.ts` | Format-annotation resolver: `makeAnnotationResolver` (+ the cached `sharedAnnotationResolver` most callers use, and `resolveValueOrigin` for the popup Go-to-source walk) walks the graph: an FC locks, Convert imposes its `toUnit`, a passthrough/selector carries (data-aware), a transform breaks. BIDIRECTIONAL — `inAnnotation` (upstream FC) + `downstreamAnnotation` (an FC ahead through pure passthroughs, for boxes in front of a trailing FC) |
| `unitFormat.ts` | Unit + number-format rendering helpers |
| `formatModel.ts` | The FC control truth table (`familyOf`/`controlsFor`/`precisionApplies`) — the machine mirror of `docs/format-model.md` |
| `formatAnnotationStore.ts` | Per-socket display annotations (Format Controller writes, value boxes read) |
| `fcReconcile.ts` | Type propagation: `reconcileFcTypes` re-adapts every FC to its upstream type (shared by the Canvas connection pipe + in-place retypes); `retypeOutputCables` keeps still-valid cables + reconciles after a Cast/LAMBDA/Get Column/Note output retype |
| `trueAnyAdopt.ts` | trueany ADOPTION (D17): every `AdoptiveSocket` port takes the wired cable's type / reverts on disconnect; outputs adopt only where honest (passthroughs, agreeing selectors). `settleWildcardTypes` = the ONE settle point, alternating this with `conduitTrace.ts`'s lane reconcile to a joint fixpoint (called by `reconcileFcTypes` + the load path, where it MUST precede FC docking — SOCK-13) |
| `conduitTrace.ts` | Conduit lane type adoption: `resolveTypedSource` traces an output lane back through chained Conduits to the real source socket (cable colors); `reconcileConduitTypes` makes lanes adopt the feeding type (fixpoint). Also `conduitPath` — the whole RUN a cable belongs to (origin producer, every terminal consumer, Conduits crossed), used by the Cable inspector and double-click cable selection |
| `trigMode.ts` | `resolveTrigModes(editor)` — the ONE compute-time unit read: an Auto-mode trig `Math` node computes degrees when its input resolves to the `deg` unit, else radians (Excel parity). Run from `processGraph` before the engine pull, stamps a transient `_resolvedAngleMode`. Main-editor only |
| `noteFrontmatter.ts` | Pure parser: a Note body's YAML frontmatter → typed fields (→ NoteNode output sockets) + the markdown below the block |
| `frame.ts` | Frame value model (named typed columns) + helpers; also the Cube model (recursive cells), cached `depth`, and `relateFramesToCube`; `FrameSourceColumn` carries the column-source model (Data / Formula `expr?` / λ) |
| `computedColumnCore.ts` | THE shared computed-column row-eval core (D24/D25): binding resolution (bare name = whole column, `@` = this row), `readRowCell`/`readWholeColumn`, side values, `tagComputedCell` — one home so the Frame Input popup and the Computed Column verb cannot disagree |
| `nodes/cube.ts` | Cube nodes: Build Cube (extensible any-cell constructor), Nest Join, Cube Columns, Cube Rollup |
| `nodes/equation.ts` + `equationSolve.ts` | The ACAUSAL Equation node (D14): every variable is an input AND an output + a logical Check; one unknown → solved. `equationSolve.ts` = the pure solver (symbolic AST isolation, quadratic multi-root, numeric log-grid + bisection fallback returning the smallest-magnitude root, `#SOLVE!`). `nodes/finance.ts` TvmNode/Compound Growth/Effective Rate + the pack presets subclass/lock it |
| `cubePopupStore.ts` + `components/CubePopup.tsx` / `CubeChip.tsx` / `CubeDisplay.tsx` / `cubeCell.tsx` | Cube drill-in popup (depth + breadcrumb), result-box chip + preview, per-cell rendering |
| `components/ResultDisplay.tsx` | Dispatches a result box to CubeDisplay / FrameDisplay / ValueDisplay by container kind (used by `makeNodeComponent`) |
| `chartValue.ts` / `mermaidValue.ts` | First-class FIGURE values (`__chart` / `__mermaid`) riding the green `chart` "Special" socket; a node output, embedded in Reports |
| `nodes/visual.ts` + `components/{ChartNode,MermaidNode,MermaidView}.tsx` | Visual nodes (Sparkline/Chart/Gauge/Heatmap/**Mermaid**); `MermaidView` dynamically imports mermaid.js (heavy) only when a diagram is on screen |
| `components/inlineRefDisplay.tsx` | The ONE render path for a Report/Note inline `` `=name` `` ref → live value by kind (scalar/frame/chart/mermaid/lambda-KaTeX); `CollapsibleFigure` (Report embeds fold); `InlineRefBody` swaps `=name` code spans + `![[note]]` embeds via imperative innerHTML + portals |
| `compositeEditorStore.ts` + `components/CompositeEditorOverlay.tsx` | Composite drill-in, now a FIRST-CLASS canvas: a breadcrumb STACK of composite instances (multi-layer, `Canvas ▸ A ▸ B`); the subgraph canvas sits IN the canvas region (`z-index:4`, `html.sol-drilled-in`) so the app chrome stays and drives it via `activeGraph.ts`; own minimap + `installSurfacePointer` + `CompositeRunControls` panel; recompute retargets `stack[0]`; `compositeLogic.ts` = create/unpack |
| `compositeStaleStore.ts` | Which composites are STALE (a heavy run mode — goal-seek/scenarios/data-table/simulation — whose inputs/config changed since the last Solve). Drives the arm-and-run status dot; a module store because a HELD composite's output doesn't change, so processGraph's re-render pruning would skip the card |
| `presentationStore.ts` + `components/PresentationOverlay.tsx` | Presenter mode: full-screen slideshow, hides chrome (`html.solenoid-presenting`), flies the camera per step (click/Space/→/←/Esc) |

### Relational engine (WS2/WS3 — the FrameBackend seam + verbs)
| Module | Role |
|---|---|
| `frameBackend.ts` (+`.test.ts`) | The engine seam: a `FrameBackend` interface (`source`/`apply`/`join`/`append`/`collect`/`preview`/`column`/`drop`) over opaque `FrameHandle`s, so the frame layer runs on either the in-process `JsFrameBackend` (web/dev) or the **`PolarsBackend`** (desktop, over `ipcBridge`; selected by `initFrameBackend()` when `engine_ping` says `"polars"`). Also holds the node-facing **runners** `runFrameUnary`/`runFrameJoin`/`runFrameAppend` (which now return a **lazy `FrameRef`** that chains in the backend), `readFrame`/`collectPreview` (the materialization boundary — full / head-N), `dropFrameRef` (lifecycle), and `materialize()` (error-as-value bridge). Data crosses back at `collect`/`preview`/`column`; verb cards use `collectPreview` (head-N for a large frame). `coerceInputs` collects a ref to a `FrameValue` for every non-lazy consumer centrally. Module-singleton; `setFrameBackend` swaps it |
| `frameVerbs.ts` (+`.test.ts`) | The pure relational verb engine — ONE definition of each verb (FrameValue→FrameValue), shared by the JS backend's `apply`, the Polars parity oracle, and (later) the verb nodes. Unary (`applyVerb`): select/drop/rename/sort/distinct/head/filter/groupBy/pivot/unpivot; binary: join (inner/left/right/outer, fan-out, key-coalesce, null≠null), append (union-by-name); cube bridge: nest/unnest; `reconcileFrames` (two-frame key diff, surfaces blank/invalid-key rows + a PVM price/volume/mix breakdown that excludes errored cells — `reconcile.test.ts`). Reuses `compareOp` + `forAggregate` so semantics can't drift from the nodes |
| `ipcBridge.ts` (+`.test.ts`) | Web→Rust door: `engineAvailable`/`ipcInvoke`/`enginePing` (guarded by `isDesktop()`), `toSolError` maps a rejected `invoke` to a tagged `SolError`. Lazy `@tauri-apps/api/core` import → node/web-safe |
| `frameShape.ts` (+`.test.ts`), `frameShapeResolver.ts` | Static frame shape: column names/types computed AHEAD of running anything, mirroring each verb's column-reshaping logic without touching row data (a mismatch with the real JS/Rust output is a caught test failure, not a silent divergence). The resolver walks the graph forward from literal frame sources so a downstream node can show its shape before data flows. Nest/Unnest and Frame Lookup fall outside this on purpose (their outputs aren't a Frame shape) |

### Cables

| Module | Role |
|---|---|
| `cablePaths.ts` (+`.test.ts`) | Path generators: walk-enumeration router (diagonal/straight), tangent-exact spline; property tests guard continuity invariants |
| `cableShape.tsx`, `CableShapeSelector.tsx` | Graph-wide shape setting + toolbar |
| `cableAngleStore.ts` | Per-socket exit-angle overrides (Conduit lanes) |
| `cableState.ts`, `cableValueStore.ts` | Hover/selection state; live per-connection values |
| `cableFlowStore.ts`, `cableFlourishStore.ts` | Flow-bead animation toggle; decorative flourish |
| `ribbonCable.ts` | Ribbon (bundled trunk + fans) membership/geometry — derived fresh per render |
| `components/ConnectionComponent.tsx` | The cable renderer (owns its SVG wrapper, hit strokes, ribbon/pill rerouting, flow overlay) |

### Renderers — exactly TWO (author 2026-08-09)

The DOM renderer (default, universal) and the experimental **HTML-in-Canvas**
mode (a shipped Setting, gated on `supportsHtmlInCanvas()`). Every other
renderer direction — the pixi spike, the WGSL/`canvas` cable+node layers, the
hit-index groundwork — was DELETED 2026-08-09 (git has it). Do not rebuild a
third path.

| File | Responsibility |
|---|---|
| `renderMode.ts` | Render-mode store `dom`\|`html` (default `dom`; only `html` persists) + `useRenderMode` hook |
| `htmlCanvasSupport.ts` | Gates the `html` option on `supportsHtmlInCanvas()` |
| `htmlCanvasRenderer.ts` | The HTML-in-Canvas renderer: captures the real node DOM via `drawElementImage` into mip pyramids; pan/zoom draws the canvas, idle shows the DOM |
| `components/HtmlCanvasLayer.tsx` | Mounts it when mode is `html` ≥100 nodes: gesture swap (DOM hidden ↔ canvas), targeted re-capture per changed node id, DOM-only escape hatch (conduits) |
| `hicCamera.ts` (+`.test.ts`) | world↔screen camera math (pan, anchored zoom, pinch, fit-to-bounds) |
| `hicCableGeom.ts` (+`.test.ts`) | `cablePolyline` — the app's REAL router (`getCablePath`) flattened via `pathPoints.ts`, so canvas cables match DOM cables |
| `hicGraphSnapshot.ts` | snapshots the live rete graph (node rects, kind colors, socket world-positions, connections) for capture |
| `hicColors.ts`, `hicSocketGlyph.ts` (+tests) | color helpers + socket-glyph classification the snapshot uses |
| `pathPoints.ts` (+`.test.ts`) | pure M/L/C/Q path → polyline flattening (`parsePathPoints`) |
| `rasterAtlas.ts` | the capture atlas (`packAtlas`) |
| `cssColor.ts` (+`.test.ts`) | Pure CSS color parse (hex/rgb) + sRGB mixing — a canvas can't evaluate `color-mix`/`var()` |
| `domSync.ts` | DOM↔canvas transform sync (`camFromDrawMatrix`, holder transforms) |

### Groups / layout / standoffs

| Module | Role |
|---|---|
| `groupLogic.ts`, `groupMembership.ts` | Group create/resize/autofit; hybrid (explicit + spatial) membership |
| `groupCollapse.ts` | Visual-only collapse: retain rules, pill sockets, readouts |
| `groupPush.ts` + `groupPushCore.ts` (+`.test.ts`) | Expand-push displacement (rails/clear/cascade) + snap-back records; pure core is unit-tested |
| `standoffs.ts`, `standoffSolver.ts` (+`.test.ts`), `components/StandoffLayer.tsx` | User-declared axis-band constraints; iterative-projection solver runs after every layout pass |
| `layoutInvariants.test.ts` | Seeded-PRNG property tests over the pure layout cores (`groupPushCore`'s `separateOverlaps`, the composed expand pipeline, `distributeDeltas`, `alignDeltas`, `solveStandoffs`) machine-checking the "nodes/groups never overlap after a layout op" rule — ~1650 fixtures, no violation found. Scopes out ELK Tidy + the `settleStandoffs` integration (not pure cores) |
| `lasso.ts`, `canvasLock.ts`, `nodeSizeStore.ts`, `collapseStore.ts`, `dockedNodeStore.ts` | Box-select, lock, per-node size/collapse, FC docking |
| `selectionOps.ts` + `components/SelectionActionsBar.tsx`/`selectionActions.css` | Align/distribute deltas (pure) + the bottom-center overlay pill (≥2 nodes selected) that surfaces them outside the Command Palette |
| `calcModeStore.ts` | Manual/automatic calculation mode + the dirty flag (`processGraph` short-circuits in manual; F9/Calculate Now forces) — persisted like Excel's per-workbook flag |
| `computeOverlayStore.ts` + `components/ComputeOverlay.tsx` | Deferred "Computing…" curtain over an irreducibly heavy pass (150 ms reveal / 350 ms min) |
| `perfProbe.ts` | Runtime perf instrumentation: `window.__solenoidPerf` per-pass node `data()` + engine IPC timings; `window.__solenoidStats()` cumulative tables |
| `nodes/placeholder.ts` | `PlaceholderNode` — what an unknown/renamed node type loads as: inert, keeps wiring + init data, re-serializes as the original type (lossless) |

### Catalog / menus / packs

| Module | Role |
|---|---|
| `nodeCatalog.ts` | The Add-menu category tree (`NODE_CATALOG`) |
| `catalogUtils.ts`, `catalogValidator.ts` | `buildCatalog` (pack insertion, dedup, prune) + dev-time consistency check |
| `nodeExcel.ts`, `excelToCatalog.ts` | Excel equivalence metadata (single source of truth) + derived maps; `EXCEL_GAP` parity list |
| `functionReference.ts`, `frStore.ts` | Function Reference overlay data (generated from the catalog) |
| `packs.ts`, `fcExtensions.ts` | Pack framework (registry/activation store, placements, `NODE_PACK_TAGS` derived from per-pack tags, FC unit/format contributions); definitions live ONE FILE PER PACK in `packs/` on `packs/packShared.ts` (authoring types, `formulaNode`/`placeFormulas`, Equation presets), each with a vitest file pinning its formulas (`packs/formulaTestKit.ts`) |
| `AddNodeMenu.tsx`, `addMenuStore.ts`, `fuzzy.ts`, `catalogSearch.ts` (+`.test.ts`) | Right-click add menu + search; `catalogSearch.ts` extracts the scoring (label/description/Excel names/category path/keywords) plus the quick-wire drop filter, which memoizes each catalog type's socket signature so a drop doesn't re-`create()` every leaf |
| `excelFunctions.ts` | The single declared home for "which of the two parallel Excel implementations is authoritative for this function" (the ~150 native nodes vs Formula.js via `excelFormula.ts` `dispatch`) — per the per-family verdicts in `docs/archive/formulajs-vs-native-audit.md` |
| `excelFormula.ts` (+`.test.ts`) | The Expression/LAMBDA formula compiler (Formula.js scope); also owns the D24 structured-reference syntax (`[Col]` whole column / `@[Col]` this row — tokenizer `colref`/`rowref` → AST `wholecol`/`atcol`) that the computed-column surfaces read |
| `formulaSignatures.ts`, `formulaSyntax.ts`, `formulaExtensions.ts`, `formulaNodeParity.ts` | The formula-surface cluster: signature metadata + syntax hints, highlighting, registered extensions, and the node↔formula parity model (`inFormula`/`excelCovered` — SSOT-6/7/8) |
| `nodeOps.ts` | Per-class op declarations (`kind: "op" \| "argument"`) — what the Add-menu search may surface and how ops are counted; aggregator hosts are `argument` (never searchable) |
| `formulaDivergence.test.ts` | Durable CI guard for the node-vs-Formula.js divergence audit: pins every Excel-correct override (`resolveExcelFunction`) the 2026-06-25 consolidation made because FX is wrong (MOD/QUOTIENT/ATAN2/ROUND/RANK/TRIMMEAN/PERCENTRANK), plus FX-still-buggy tripwires — an FX upgrade that fixes those trips the test instead of silently re-introducing drift |

### App chrome

`TopBar`, `MenuBar`, `NavMenu` (seeds, export/import, tidy, fit), `StatusBar`,
`Header`, `AppToolbar` (accent + light/dark via `appTheme.ts`), `OutlinePanel`,
`Settings` (+`settingsStore`), `ShortcutsOverlay`, `Minimap`,
`MobileControls` (+`mobileMenuStore`, `touchSelectStore`),
`WebDemoBanner`, `CommandPalette.tsx` (+ `palette.ts`, the app palette engine
behind `PaletteEditor`/`paletteStore`), plus dialog/popup stores
(`confirmStore`, `connectionDialogStore`, `formulaPopupStore`,
`tablePopupStore` — the last also defines the LIVE-COMMIT seam:
`SourceCommitRefresh` + `onCommitSource`, produced by `FrameNodes.tsx` and
consumed by `TablePopup.tsx`, so a formula/unit pick recomputes through the
real engine and refreshes the open popup).
The HUD family stacks in `components/HudStack.tsx`: `pinStore` (pinned
values), `alertStore` (threshold fires, edge-detected on status not a
boolean), `problemsStore` (error-sink relapse tracking), `commentStore`
(node-anchored comments), `noticeStore` (the toast/warn channel — e.g. the
drill-in dropped-cable notice). Other cross-cutting toggles:
`semanticZoomStore`, `gridSnapStore`, `isolateStore`.
The View ▸ Architecture map overlay (`components/SpecMapView.tsx` + `specMapStore.ts`)
draws the enforcement web as a three-layer graph — rule domains → cited test suites →
this file's module groups — from `docs/rules.md` and this file, imported `?raw` and
parsed by `specMap.ts` (+`.test.ts`): DERIVED at build time, nothing hand-kept
(SSOT-3). Only TABLED sections here land on the map's right layer; a suite whose home
module lives in a prose section shows no right-hand edge, deliberately.

### External data

`connectionStore.ts` (cached async fetch + refresh generation),
`fileBridge.ts` (Tauri fs/dialog behind an `isDesktop()` guard),
`httpBridge.ts` (proxy-aware fetch), `csv.ts` (parse/serialize),
`nodes/connection.ts` (Web Source, CSV File, Parquet, Import HTML/XML),
`dataProviders.ts` + `nodes/dataFeed.ts` (the keyed data-feed providers),
`obsidianMarkdown.ts` + `obsidianWrite.ts` + `nodes/obsidian.ts` (the
Obsidian vault import/export direction).

### Node compute layer (`src/graph/nodes/`)

One file per family, pure `data()` classes: `scalar`, `list`, `listOps`,
`stats`, `dist-*`, `finance`, `financeOps`, `text`, `textOps`, `date`,
`dateSerial`, `complex`, `matrix`, `matrixOps`, `frame`, `cube`,
`tableLambda`, `lambda`, `expression`, `convert`, `convertUnits`,
`logic`, `input`, `control`,
`display`, `group`, `conduit` (block bundler), `formatController`, `composite`,
`annotation` (Note — its body's YAML frontmatter becomes typed OUTPUT sockets,
parsed by `noteFrontmatter.ts`), `report` (Report — plain-markdown sink with
`` `=name` `` inline embeds; the mirror-image counterpart to Note), `visual`
(the figure family incl. Mermaid), `surfaceFit`, `presentation`, `tornado`,
`quality` (Expect — data-quality checks, frame-cell-aware), `sink` (Write
CSV/JSON), `obsidian`, `dataFeed`, `history`, `chartOptions`, `cast`,
`coerce`, `connection`, `passthrough` (the D15 passthrough declarations),
`placeholder`, plus `shared.ts` (port factories,
broadcast + `NODE_KIND_ACCENTS`), `mathUtils.ts`, and `kind.ts` (the node → kind classifier).
Composite run modes live one level up (`src/graph/monteCarlo.ts` + `tornadoRun.ts` —
simulation / sensitivity sweeps; only the `tornado` node class is in `nodes/`). Vitest covers the math families + the
newer data-quality/report nodes (`*.test.ts` alongside; the full inventory
by category is `docs/node-coverage.md`, hand-maintained against
`nodeCatalog.ts` — nothing generates it).

### Node components (`src/graph/components/`)

One React component per node, mostly one-line `makeNodeComponent` calls
(`standardNode.tsx`). Shared kit: `nodeKit.tsx` (NodeShell, ValueDisplay,
OpSelect, InlineOutputRows), `NodeCard.tsx`, `NodeSocket.tsx`
(MeasuredSocketRow), `SocketComponent.tsx`, `inlineInput.tsx`,
`ExtensibleInputs.tsx` (flat variadic value rows, optional fixed `leadingKeys`),
`PairedExtensibleInputs.tsx` (variadic input PAIRS — IFS/SWITCH — with optional
fixed leading/trailing rows), `ArrayChip` / `TablePopup` / `FormulaPopup` (+
`popupChrome.css`), `FrameChip` / `FrameDisplay`, `SegToggle`, `SwatchGrid`, `PaletteEditor`
(F-1 app custom-palette editor, Settings-only), `DocumentProperties` (F-2
doc metadata + per-doc palette base modal), `ResizeHandle`, `RecalcButton`.
Adding a node: see the `add-node` skill /
`scripts/new-node.mjs`.

### Help (`src/graph/help/`)

In-app markdown: `help.md` (getting around), `notes.md` (concepts: frames,
live data, units), `data-model.md` + `data-types.md` (the value-model and
socket-lattice tabs) — rendered by `components/Markdown.tsx` in the Reference
overlay tabs.

---

## Tauri shell (`src-tauri/`)

```
src-tauri/
├── Cargo.toml                # Crate manifest (+ fs/dialog plugin deps)
├── tauri.conf.json           # Window, identifier, build hooks
├── capabilities/default.json # Permissions: dialog + fs read/write scoped to $HOME/** + http(s) fetch + opener + window/decorum commands
├── src/ipc.rs                # IPC command surface (WS1): `engine_ping` (reports backend "polars") + `IpcError` (serializes SolError-shaped).
├── src/engine.rs (+engine/tests.rs) # WS2 native Polars engine: handle table (HashMap<String, SolFrame> = DataFrame + per-column SolType tags) + the relational verbs over polars 0.46; `engine_source/apply/join/append/collect/preview/column/drop` commands. Verb parity vs the frameVerbs JS oracle runs from the shared corpus (`fixtures/frame-verbs/`, FX-12): `corpus_cases` in engine/tests.rs + `frameVerbCorpus.test.ts` read the same wire-format fixture files.
└── src/lib.rs                # Plugin registration + `invoke_handler`: window commands (`open_devtools`, `set_window_border`, `toggle_fullscreen`) + `engine_ping` + the `engine_*` command set
```

The web layer reaches `ipc.rs` via `src/graph/ipcBridge.ts` (`engineAvailable`/
`ipcInvoke`/`enginePing`, guarded by `isDesktop()` like `fileBridge.ts`); a Rust
`Err` arrives as a tagged `SolError`. The Polars engine (WS2) is built — see
`src/engine.rs` above (the original browser-vs-desktop scoping is archived as
`archive/compute-architecture.md`). Solve/sweep now ship as COMPOSITE run modes
(goal-seek bisection/secant, scenarios, data-table, simulation — JS, arm-and-run);
there is no solver in the Rust engine itself.

---

## Docs (`docs/`)

Live docs only — one row per file. Archived material (shipped plans, condensed
rationale, point-in-time research, the dev-notes history) is indexed in
`archive/README.md`; don't duplicate its rows here.

| File | Status | Purpose |
|---|---|---|
| `README.md` | living | the docs index — start here |
| `mental-model.md` | living | how the system runs, end to end — the onboarding story |
| `architecture.md` | living | (this file) module map |
| `glossary.md` | living | the invented vocabulary |
| `decisions.md` | living | the decision log — what stands / where / what would reopen it |
| `subsystem-invariants.md` | living | the "don't break this" deep-dives — cable routing, group push, standoffs, tidy, error values, unit flow, addressable model, autosave, drill-in |
| `layout-chrome.md` | living | on-screen chrome map — bar/overlay geometry, offset sync map, z-index ladder; read before adding/moving chrome |
| `touch-gestures.md` | living | the pointer/touch gesture inventory per device config |
| `renderer-performance.md` | living | settled renderer-perf policies (zoom settle, GPU promotion, semantic-zoom gate, HIC capture) |
| `code-comments.md` | living | the D30 comment policy — cut rules, blast-radius test |
| `dev-notes.md` | living log | open problems + the latest session digests only (history in `archive/dev-notes-history.md`) |
| `backlog.md` | living | OPEN items only — the 1.3 polish/patch queue (landed items are deleted) |
| `deferrals.md` | living | the deferred/parked/author-gated set, incl. Pushed-to-1.4/2.0 |
| `2.0-plan.md` | living | the author-present flagships — release view over `v2.0/` |
| `release-notes-features.md` | living | curated feature list — release-notes source + What's-New slide content |
| `format-model.md` | living | the FC function model — control truth table + precision rule (mirrored in `formatModel.ts`) |
| `value-semantics.md` | living | null/NaN/Infinity/SolError semantics per computation context |
| `rules.md` | living | the NORMATIVE architecture spec — numbered MUST-rules with their enforcing tests |
| `socket-reference.md` | living | every socket variant in plain English (connection lists machine-checked by `socketReference.test.ts`) |
| `v2.0/` | living plans | the open build bundles — 08 transpiler, 10 sensitivity, 12 uncertain/money, 16 widgets |
| `node-coverage.md` | living | node inventory by category (`nodeCatalog.ts` is the real source) |
| `pack-architecture.md` | design + authoring guide | core-vs-pack line, isolation levels |
| `pack-composite-plans.md` | plans (parked) | queued composite-shaped pack nodes |
| `out-of-scope.md` | policy | the standing NO list |
| `grid-system.md` | future spec | soft-snap grid; unimplemented |
| `agent-coordination.md` | parallel-session board | claim/coordinate when several agents work in parallel |
| `archive/` | index | everything finished/inactive — see `archive/README.md` |

---

## Conventions

- **One node class per family file, one component row in `nodeRegistry.ts`,
  one catalog leaf.** `constructor.name` is the persistence type key
  (`keepNames` in vite.config.ts makes it prod-stable).
- **`extractInit` allowlist** (`copyPaste.ts`; `persistence.ts` imports it): a node's
  persistent constructor fields must be listed there or they silently don't survive
  save/load/paste.
- **Module-singleton stores** for anything read across React roots
  (`storeKit.ts`: `createNotifier` / `createToggleStore` / `createValueStore`
  — the last is the "one nullable open/close value" popup-store shape),
  consumed via `useSyncExternalStore`.
- **Composability rule**: scalars → fine-grained one-op nodes; lists/tables →
  bundled task-shaped nodes with op selectors.
- **Excel metadata lives on the node** (`nodeExcel.ts`); menus and the
  Function Reference are generated, never hand-listed.
- **Stable ids** from `crypto.randomUUID()`; loads remap ids.
- See `CLAUDE.md` for the rendering/measurement gotchas (socket boxes,
  measured rows, async `area.translate`, pointer-event traps).
