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
├── scripts/                  # new-node.mjs (scaffold), parity.ts, dev-restart.ps1
├── .claude/                  # Claude Code project skills (add-node, startup)
├── .github/workflows/        # CI: windows-portable.yml builds solenoid.exe
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
├── App.css                   # Theme token layer (dark/light ramps, --sock-* colors)
├── mobile.css                # @media (pointer: coarse) overrides (desktop layout is truth)
├── desktopFrame.css          # Tauri window chrome
├── env.ts                    # IS_COARSE / isDesktop-style environment flags
├── logo/                     # Brand assets
└── graph/                    # Everything graph-related (flat; grouped below by concern)
```

### Engine / core (`src/graph/`)

| Module | Role |
|---|---|
| `process.ts` | Module singleton `_editor/_engine/_area`; `processGraph()` recompute + re-render; recalc generation (volatile nodes); graph-rebuild guard; history hook |
| `schemes.ts` | Rete scheme types (`SolenoidConnection` must use `ClassicPreset.Node` — variance) |
| `rete-nodes.ts` | Node class re-exports for the editor |
| `nodeRegistry.ts` | `NODE_COMPONENTS`: `[Ctor, Component]` rows — the one place a node binds its React component |
| `coerceInputs.ts` | `nodecreated` pipe wrapping every `data()` — normalizes incoming shapes to the socket's declared type (`#SHAPE!` on coercion failure); widens scalar/list/matrix → `frame` (list = ROW), bridges logical↔number |
| `persistence.ts` | JSON save/load (format v2), localStorage autosave, export/import; ctor lookup derived from the catalog; `rebuildGraph(…, animate)` cinematic load reveal |
| `loadReveal.ts`, `LoadOverlay.tsx` | Load-reveal store (phase/progress/revealed conns) + `revealWaves` layering; the build-phase progress overlay |
| `copyPaste.ts` | Ctrl+C/V with topology, id remap; shares rebuild path with persistence |
| `seeds.ts` + `seedGraphs/*.json` | Example graphs in Export format, globbed into a registry |
| `Canvas.tsx` | Rete bootstrap: plugins, pipes (selection, lasso, keys, group reconcile), delete/undo wiring |

### Typing / sockets / units

| Module | Role |
|---|---|
| `sockets.ts` | `SocketDataType` + `SOCKET_COLORS` (CSS vars, incl. purple = logical); `FAMILIES` (element × dim lattice) DERIVES `SOCKET_ACCEPTS`; `accepts`/`areCompatible`/`canConnect`. Governing rule: enforce TYPE separation (Cast to cross families; only logical↔number bridges), allow DIMENSIONAL flow (scalar→list→matrix→frame); `anytable`/`frame` widen from lower rank |
| `valueKinds.ts` | First-class value-model kinds: `null` (missing), logical (boolean), Kleene 3-valued logic helpers; aggregators skip null / propagate `SolError` |
| `nodes/kind.ts` | `NodeKind` → header accent color mapping |
| `unitFlow.ts` | Unit/format-of-the-value resolver. `makeUnitResolver`/`makeAnnotationResolver` walk the graph: an FC locks, Convert imposes its `toUnit`, a passthrough/selector carries (data-aware), a transform breaks. BIDIRECTIONAL — `inAnnotation` (upstream FC) + `downstreamAnnotation` (an FC ahead through pure passthroughs, for boxes in front of a trailing FC) |
| `unitFormat.ts` | Unit + number-format rendering helpers |
| `formatAnnotationStore.ts` | Per-socket display annotations (Format Controller writes, value boxes read) |
| `fcReconcile.ts` | Type propagation: `reconcileFcTypes` re-adapts every FC to its upstream type (shared by the Canvas connection pipe + in-place retypes); `retypeOutputCables` keeps still-valid cables + reconciles after a Cast/LAMBDA/Get Column/Note output retype |
| `noteFrontmatter.ts` | Pure parser: a Note body's YAML frontmatter → typed fields (→ NoteNode output sockets) + the markdown below the block |
| `frame.ts` | Frame value model (named typed columns) + helpers; also the Cube model (recursive cells), cached `depth`, and `relateFramesToCube` |
| `nodes/cube.ts` | Cube nodes: Build Cube (extensible any-cell constructor) + Nest Join (nest two frames on a key) |
| `cubePopupStore.ts` + `components/CubePopup.tsx` / `CubeChip.tsx` / `CubeDisplay.tsx` / `cubeCell.tsx` | Cube drill-in popup (depth + breadcrumb), result-box chip + preview, per-cell rendering |
| `components/ResultDisplay.tsx` | Dispatches a result box to CubeDisplay / FrameDisplay / ValueDisplay by container kind (used by `makeNodeComponent`) |
| `chartValue.ts` / `mermaidValue.ts` | First-class FIGURE values (`__chart` / `__mermaid`) riding the green `chart` "Special" socket; a node output, embedded in Reports |
| `nodes/visual.ts` + `components/{ChartNode,MermaidNode,MermaidView}.tsx` | Visual nodes (Sparkline/Chart/Gauge/Heatmap/**Mermaid**); `MermaidView` dynamically imports mermaid.js (heavy) only when a diagram is on screen |
| `components/inlineRefDisplay.tsx` | The ONE render path for a Report/Note inline `` `=name` `` ref → live value by kind (scalar/frame/chart/mermaid/lambda-KaTeX); `CollapsibleFigure` (Report embeds fold); `InlineRefBody` swaps `=name` code spans + `![[note]]` embeds via imperative innerHTML + portals |
| `compositeEditorStore.ts` + `components/CompositeEditorOverlay.tsx` | Composite drill-in: a breadcrumb STACK of composite instances (multi-layer, `Canvas ▸ A ▸ B`); full-bleed overlay; recompute retargets `stack[0]`; `compositeLogic.ts` = create/unpack |
| `presentationStore.ts` + `components/PresentationOverlay.tsx` | Presenter mode: full-screen slideshow, hides chrome (`html.solenoid-presenting`), flies the camera per step (click/Space/→/←/Esc) |

### Relational engine (WS2/WS3 — the FrameBackend seam + verbs)
| Module | Role |
|---|---|
| `frameBackend.ts` (+`.test.ts`) | The engine seam: a `FrameBackend` interface (`source`/`apply`/`join`/`append`/`collect`/`preview`/`column`/`drop`) over opaque `FrameHandle`s, so the frame layer runs on either the in-process `JsFrameBackend` (web/dev) or the **`PolarsBackend`** (desktop, over `ipcBridge`; selected by `initFrameBackend()` when `engine_ping` says `"polars"`). Also holds the node-facing **runners** `runFrameUnary`/`runFrameJoin`/`runFrameAppend` (which now return a **lazy `FrameRef`** that chains in the backend), `readFrame`/`collectPreview` (the materialization boundary — full / head-N), `dropFrameRef` (lifecycle), and `materialize()` (error-as-value bridge). Data crosses back at `collect`/`preview`/`column`; verb cards use `collectPreview` (head-N for a large frame). `coerceInputs` collects a ref to a `FrameValue` for every non-lazy consumer centrally. Module-singleton; `setFrameBackend` swaps it |
| `frameVerbs.ts` (+`.test.ts`) | The pure relational verb engine — ONE definition of each verb (FrameValue→FrameValue), shared by the JS backend's `apply`, the Polars parity oracle, and (later) the verb nodes. Unary (`applyVerb`): select/drop/rename/sort/distinct/head/filter/groupBy/pivot/unpivot; binary: join (inner/left/right/outer, fan-out, key-coalesce, null≠null), append (union-by-name); cube bridge: nest/unnest. Reuses `compareOp` + `forAggregate` so semantics can't drift from the nodes |
| `ipcBridge.ts` (+`.test.ts`) | Web→Rust door: `engineAvailable`/`ipcInvoke`/`enginePing` (guarded by `isDesktop()`), `toSolError` maps a rejected `invoke` to a tagged `SolError`. Lazy `@tauri-apps/api/core` import → node/web-safe |

### Cables

| Module | Role |
|---|---|
| `cablePaths.ts` (+`.test.ts`) | Path generators: walk-enumeration router (diagonal/straight), tangent-exact spline; property tests guard continuity invariants |
| `cableShape.tsx`, `CableShapeSelector.tsx` | Graph-wide shape setting + toolbar |
| `cableAngleStore.ts` | Per-socket exit-angle overrides (Conduit lanes) |
| `cableState.ts`, `cableValueStore.ts` | Hover/selection state; live per-connection values |
| `cableFlowStore.ts`, `cableFlourishStore.ts` | Flow-bead animation toggle; decorative flourish |
| `ribbonCable.ts` | Ribbon (bundled trunk + fans) membership/geometry — derived fresh per render |
| `components/ConnectionComponent.tsx` | The cable renderer (owns its SVG wrapper, hit strokes, ribbon/pill rerouting, flow overlay). In `canvas` render-mode it publishes the visible stroke to `cableScene` and emits only the hit path |

### GPU render layer (WS4, feature-gated — DOM is the permanent default/fallback)
| File | Responsibility |
|---|---|
| `renderMode.ts` | Render-mode store `dom`\|`canvas`\|`html` (default `dom`; only `html` persists) + `gpuCapabilityStore` (set by the startup probe); `useRenderMode` hook |
| `htmlCanvasRenderer.ts` | **The SHIPPED WS4 renderer** (Settings-gated, DOM stays default): captures the real node DOM via `drawElementImage` into mip pyramids; pan/zoom draws the canvas, idle shows the DOM |
| `components/HtmlCanvasLayer.tsx` | Mounts the HTML-canvas renderer when mode is `html` ≥100 nodes: gesture swap (DOM hidden ↔ canvas), targeted re-capture per changed node id, DOM-only escape hatch (conduits) |
| `gpuProbe.ts` (+`.test.ts`) | Capability probe: WebGPU non-fallback adapter → else non-software WebGL2 → else DOM. Pure `classifyCapability`/`isSoftwareRenderer` |
| `overlayTransform.ts` (+`.test.ts`) | Pure world↔device/css transform math + `deviceMatrix` (setTransform baking) + the `overlayBus` singleton (Canvas feeds transform/viewport) |
| `cableScene.ts` (+`.test.ts`) | Module store of published cable strokes (the canvas scene); `ConnectionComponent` is the sole producer |
| `components/CableCanvas.tsx` | Paints the cable scene onto two portaled canvases (below/above nodes) in world units; the Phase-1 cable layer |
| `components/RenderOverlay.tsx` | Transparent transform-mirror overlay (Phase-0 harness); console `__solenoidOverlayDebug()` draws a verification grid |
| `cableHitTest.ts` (+`.test.ts`) | **Phase-3 groundwork, UNWIRED.** Pure cable hit geometry: flatten an SVG `d` (M/L/C/Q) to a polyline, point→segment / point→polyline distance, `hitTestCables` |
| `spatialIndex.ts` (+`.test.ts`) | **Phase-3 groundwork, UNWIRED.** Uniform `SpatialGrid` (bucket-by-bbox, point/radius query) — narrows hit-testing to nearby candidates on big graphs |
| `cableHitIndex.ts` (+`.test.ts`) | **Phase-3 groundwork, UNWIRED.** Composes the two: `update(cables)` syncs a self-maintaining index, `hitTest(point, tol)` → nearest cable. Replaces the per-cable hit `<svg>` when Phase 3 ships |
| `nodeHitIndex.ts` (+`.test.ts`) | **Phase-2/3 groundwork, UNWIRED.** Point→node hit-testing (point-in-rect over the SpatialGrid, topmost by z) for when node bodies draw on canvas and DOM nodes no longer catch clicks |
| `cssColor.ts` (+`.test.ts`) | **Renderer primitive, UNWIRED.** Pure CSS color parse (hex/rgb) + sRGB `mixSrgb`/`flowTint` — a canvas can't evaluate `color-mix`/`var()`, so flow tints + header tints compute in JS |

### Groups / layout / standoffs

| Module | Role |
|---|---|
| `groupLogic.ts`, `groupMembership.ts` | Group create/resize/autofit; hybrid (explicit + spatial) membership |
| `groupCollapse.ts` | Visual-only collapse: retain rules, pill sockets, readouts |
| `groupPush.ts` + `groupPushCore.ts` (+`.test.ts`) | Expand-push displacement (rails/clear/cascade) + snap-back records; pure core is unit-tested |
| `standoffs.ts`, `standoffSolver.ts` (+`.test.ts`), `components/StandoffLayer.tsx` | User-declared axis-band constraints; iterative-projection solver runs after every layout pass |
| `lasso.ts`, `canvasLock.ts`, `nodeSizeStore.ts`, `collapseStore.ts`, `dockedNodeStore.ts` | Box-select, lock, per-node size/collapse, FC docking |
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
| `packs.ts`, `fcExtensions.ts` | Pack framework (placements, `NODE_PACK_TAGS`, FC unit/format contributions) |
| `AddNodeMenu.tsx`, `addMenuStore.ts`, `fuzzy.ts` | Right-click add menu + search |
| `excelFormula.ts` (+`.test.ts`) | The Expression/LAMBDA formula compiler (Formula.js scope) |

### App chrome

`TopBar`, `MenuBar`, `NavMenu` (seeds, export/import, tidy, fit), `StatusBar`,
`Header`, `AppToolbar` (accent + light/dark via `appTheme.ts`), `OutlinePanel`,
`Settings` (+`settingsStore`), `ShortcutsOverlay`, `Minimap`,
`MobileControls` (+`mobileMenuStore`, `touchSelectStore`), `SeedSelect`,
`WebDemoBanner`, plus dialog/popup stores (`confirmStore`,
`connectionDialogStore`, `formulaPopupStore`, `tablePopupStore`).

### External data

`connectionStore.ts` (cached async fetch + refresh generation),
`fileBridge.ts` (Tauri fs/dialog behind an `isDesktop()` guard),
`nodes/connection.ts` (Web Source, CSV File).

### Node compute layer (`src/graph/nodes/`)

One file per family, pure `data()` classes: `scalar`, `list`, `stats`,
`dist-*`, `finance`, `text`, `date`, `complex`, `matrix`, `frame`,
`tableLambda`, `expression`, `lookup`, `convert`, `logic`, `input`, `control`,
`display`, `group`, `conduit` (block bundler), `formatController`,
`annotation` (Note — its body's YAML frontmatter becomes typed OUTPUT sockets,
parsed by `noteFrontmatter.ts`), `cast`,
`coerce`, `connection`, plus `shared.ts` (port factories, broadcast) and
`mathUtils.ts`. Vitest covers the math families (`*.test.ts` alongside).

### Node components (`src/graph/components/`)

One React component per node, mostly one-line `makeNodeComponent` calls
(`standardNode.tsx`). Shared kit: `nodeKit.tsx` (NodeShell, ValueDisplay,
OpSelect, InlineOutputRows), `NodeCard.tsx`, `NodeSocket.tsx`
(MeasuredSocketRow), `SocketComponent.tsx`, `inlineInput.tsx`,
`ExtensibleInputs.tsx` (flat variadic value rows, optional fixed `leadingKeys`),
`PairedExtensibleInputs.tsx` (variadic input PAIRS — IFS/SWITCH — with optional
fixed leading/trailing rows), `ArrayChip` / `TablePopup` / `FormulaPopup` (+
`popupChrome.css`), `FrameChip` / `FrameDisplay`, `SegToggle`, `SwatchGrid`,
`ResizeHandle`, `RecalcButton`. Adding a node: see the `add-node` skill /
`scripts/new-node.mjs`.

### Help (`src/graph/help/`)

In-app markdown: `help.md` (getting around), `notes.md` (concepts: frames,
live data, units) — rendered by `components/Markdown.tsx` in the Reference
overlay tabs.

---

## Tauri shell (`src-tauri/`)

```
src-tauri/
├── Cargo.toml                # Crate manifest (+ fs/dialog plugin deps)
├── tauri.conf.json           # Window, identifier, build hooks
├── capabilities/default.json # Permissions: dialog:default, fs read scoped to $HOME/**
├── src/ipc.rs                # IPC command surface (WS1): `engine_ping` (reports backend "polars") + `IpcError` (serializes SolError-shaped).
├── src/engine.rs (+engine/tests.rs) # WS2 native Polars engine: handle table (HashMap<String, SolFrame> = DataFrame + per-column SolType tags) + the relational verbs over polars 0.46; `engine_source/apply/join/append/collect/preview/column/drop` commands. 27 cargo parity tests vs the frameVerbs JS oracle.
└── src/lib.rs                # Plugin registration + `invoke_handler` (engine_ping + the 8 engine_* commands)
```

The web layer reaches `ipc.rs` via `src/graph/ipcBridge.ts` (`engineAvailable`/
`ipcInvoke`/`enginePing`, guarded by `isDesktop()` like `fileBridge.ts`); a Rust
`Err` arrives as a tagged `SolError`. The Polars engine (WS2) is built — see
`src/engine.rs` above and [compute-architecture.md](compute-architecture.md) for the
browser-demo vs desktop split. Solver/sweep stays scoped, not built.

---

## Docs (`docs/`)

| File | Status | Purpose |
|---|---|---|
| `architecture.md` | living | (this file) module map |
| `subsystem-invariants.md` | living | the "don't break this" deep-dives — cable routing, group push, standoffs, tidy, resizable nodes, error values, unit flow, alerts |
| `dev-notes.md` | living log | direction, deferred work, technical gotchas — the primary running record |
| `backlog.md` | living | open features, polish, verification tasks |
| `v1.0-plan.md` | planning | what's left for 1.0 (lazy-handle-on-cable; Windows packaging) |
| `node-coverage.md` | living | node inventory by category (`nodeCatalog.ts` is the real source) |
| `node-arity-audit.md` | rationale | labeled-slots vs single-list-socket decision for variadic nodes |
| `cube-node-scope.md` | rationale | the Cube (recursive nested-table) model + its node set |
| `excel-pain-points.md` / `excel-toolbar-supplementals.md` | research | Excel function gaps + the non-function toolbar parity verdicts |
| `compute-architecture.md` | scoping | browser-demo vs desktop native-compute (Polars) split |
| `pack-architecture.md` | scoping | core-vs-pack line, isolation levels |
| `performance-hardening.md` | reference | perf invariants for the hot paths (recompute, render) |
| `cable-routing.md` | historical | original cable/conduit spec — superseded by the built system (see banner) |
| `grid-system.md` | future spec | soft-snap grid; unimplemented |
| `isolate-pin-multiview-scoping.md` | reference | isolate / pin multiview scoping rules |
| `agent-coordination.md` | parallel-session board | claim/coordinate when several agents work in parallel |
| `archive/` | archived | finalized/inactive docs (research, reviews, shipped specs, parked proposals, decided-renderer journey). See `archive/README.md`. |

---

## Conventions

- **One node class per family file, one component row in `nodeRegistry.ts`,
  one catalog leaf.** `constructor.name` is the persistence type key
  (`keepNames` in vite.config.ts makes it prod-stable).
- **`extractInit` allowlist** (persistence.ts): a node's persistent
  constructor fields must be listed there or they silently don't survive
  save/load/paste.
- **Module-singleton stores** for anything read across React roots
  (`storeKit.ts`: `createNotifier` / `createToggleStore`), consumed via
  `useSyncExternalStore`.
- **Composability rule**: scalars → fine-grained one-op nodes; lists/tables →
  bundled task-shaped nodes with op selectors.
- **Excel metadata lives on the node** (`nodeExcel.ts`); menus and the
  Function Reference are generated, never hand-listed.
- **Stable ids** from `crypto.randomUUID()`; loads remap ids.
- See `CLAUDE.md` for the rendering/measurement gotchas (socket boxes,
  measured rows, async `area.translate`, pointer-event traps).
