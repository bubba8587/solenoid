# React Flow port — plan and status ledger

**Branch: `react-port-develop`** (author-ordered 2026-08-26, superseding the develop-only
rule for THIS track). Runs in parallel with rete development on `develop`; merged in
eventually. Multi-session: each session picks up the next unchecked chunk item below.

**AUTHOR RULING (2026-08-26): this is a FULL PORT, not a spike.** React Flow is this
branch's app canvas (`FlowCanvas` in MainApp, real chrome, real documents, real
autosave); the rete stack stays reachable at `?rete` for side-by-side comparison only
until the port completes. No standalone harness — new work integrates with the app.

## The ruling architecture (decided at C0; revisit only at C9)
- **View layer → React Flow (`@xyflow/react` ^12.11.5).** Replaces `rete-area-plugin`,
  `rete-react-plugin`, `rete-connection-plugin`, `rete-render-utils`,
  `rete-minimap-plugin`, `rete-history-plugin` (own undo layer at C5), and the
  `rete-auto-arrange-plugin` adapter (ELK called directly).
- **Model + compute stay: `rete` core (`NodeEditor` + `ClassicPreset`) + `rete-engine`
  (`DataflowEngine`).** Both are renderer-free (run-graph.ts proves it) and carry the 309
  node classes, `coerceInputs`, error guards, and persistence untouched. Nodes render in
  the MAIN React tree — the separate-root store pattern, per-node boundaries, and
  `nativeHover` become unnecessary on this surface (removal is C9, not before).
- **Save format unchanged** (it is already rete-independent; textForm stays SSOT).
- The port surface lives in `src/graph/flow/` behind the `?rf` query param (same
  module-load fork as `?showcase`/`?landing`), lazy-loaded so the main bundle is
  untouched. The rete surface keeps working on this branch throughout.

## Session protocol (every session, in order)
1. `git checkout react-port-develop`; `git fetch origin develop && git merge origin/develop`
   (keep the port current with parallel rete work; resolve, keep green).
2. Read this ledger; do the next unchecked item(s) — depth over breadth, keep
   `tsc` + `vitest` green, commit as you land things.
3. Update this ledger (check items off, add discovered follow-ups under the chunk),
   digest per CLAUDE.md, `git push -u origin react-port-develop`.

## Known risks (test early, in the named chunk)
- **Socket churn** (C2): selector-driven socket swaps at catalog scale through
  `useUpdateNodeInternals` — unproven; this is the #1 go/no-go signal.
- **Touch** (C8): RF has its own open pinch/mobile issue tail (xyflow #5066/#5475/#1914);
  budget real device-emulation time, reuse `pointerGesture.ts` where RF falls short.
- **Perf** (always): same DOM compositing floor as rete (RF maintainers concur —
  xyflow #4711/#5117). The port must not regress the ~300-node target; HIC renderer
  decision deferred to C9.

## Chunks

### C0 — Beachhead (read-only canvas) — DONE 2026-08-26
- [x] Branch `react-port-develop` from `develop`; `@xyflow/react` installed.
- [x] `flow/flowModel.ts` — headless model: SavedGraph → `NodeEditor` + `DataflowEngine`
      (+ coercion + error guards), `computeAll`, pure `toFlowNodes`/`toFlowEdges`
      projections (RF-shape without importing RF — node-env testable).
- [x] `flow/flowSeeds.ts` — seed JSON glob (own copy; avoids pulling `persistence.ts` →
      `process.ts` → the whole rete render stack into the harness).
- [x] `flow/SolFlowNode.tsx` — generic card: label header, per-row typed handles
      (SOCKET_COLORS/SOCKET_TYPE_LABELS), per-output value previews. THROWAWAY visuals —
      replaced by real components in C2; DESIGN.md parity owed from C2 on.
- [x] `flow/preview.ts` — crude value previewer (SolError/frame/matrix/list/scalar).
- [x] `flow/FlowApp.tsx` — `?rf` page: seed picker, RF canvas (drag/select/fit), stats line.
- [x] `flowModel.test.ts` — model build + compute + projection pinned on real seeds.
- [x] `tsc` green; suite green; pushed.

### C1 — Interaction + persistence baseline — DONE 2026-08-26
- [x] Zoom clamps from `areaPresets` (MIN/MAX_ZOOM), double-click zoom off. The custom
      WHEEL CURVE (0.0028/px, cap 0.24) is NOT ported — RF default d3-zoom feel for now;
      revisit with chrome polish in C4.
- [x] `flow/flowController.ts`: connect/disconnect through the lattice
      (`canConnectTo` + self-loop + single-input eviction), targeted recompute
      (`downstreamClosure` cone + `#CIRC!` seeding reused from `process.ts` — never
      `engine.reset(id)`), delete (cables first), addNode from `FLAT_CATALOG`, moveNode.
- [x] `isValidConnection` wired in RF (invalid drags refused at hover time);
      values/edges refresh from the editor after every model edit.
- [x] Serialize via `extractInit` → textForm round-trip; names via `nodeNameStore`
      (claim on load, ensure on save). Verified: a browser-edited ?rf save runs
      through `scripts/run-graph.ts` (validator + headless engine) clean.
- [x] Minimal add menu (filter box over `FLAT_CATALOG`); Save button downloads the doc.
- [x] Live-verified via Playwright: add (34→35 nodes), edge delete (21→20), rewire with
      eviction (Annual total 600→2500, downstream Format followed, cable count constant),
      zero console errors. `flowController.test.ts` pins all verbs (11 tests green).
- Follow-ups discovered: recompute renders ALL nodes' data (no early-cutoff pruning yet —
  fine at ≤300 nodes, note for C2's value-refresh work); multi-edge delete does a full
  pass; real Add menu tree/quick-wire is C4.

### C2 — Real node components (the big one — split across sessions as needed)
- [x] Adapter shipped 2026-08-26: `SolNodeAdapter` renders the REAL components inside RF
      nodes (stub emit; per-ctor ErrorBoundary reused). Socket seam = ONE branch in
      `NodeSocket.tsx` → injected `FlowSocketHandle` (RF Handle wrapping the real
      `SocketComponent` glyphs; `flowSurface.ts` injection keeps @xyflow out of the main
      bundle). `flowArea.ts` = TRANSITIONAL area-shaped adapter; `setEditorRefs` binds
      process.ts to the flow model, autosave SUSPENDED on ?rf (never clobber main docs).
      Editor pipe syncs RF state for topology changes components make themselves.
      Live-verified: 28/28 real cards on getting-started (0 fallbacks, 0 boundaries),
      in-card edit → processGraph → 600→840 incl. downstream; cable drag on REAL dots
      rewires with eviction (2500); area-plane z-order restored via RF zIndex
      (groups −2 < conduits −1 < nodes 0, elevateNodesOnSelect off).
- [x] **Churn spike (the go/no-go) PASSED**: Distribution Normal→Binomial→Poisson→
      Normal→Standard Normal — socket set tracks (4→2 handles), dropInputCables path
      runs through the adapter, `useUpdateNodeInternals` on version bump, zero errors.
- [ ] Interaction discipline sweep: existing `stopDragStart` sites appear to block RF
      drags correctly (fields were editable in place) — still needs a deliberate pass
      (wheel-in-card, nowheel on scrollable popups, IS_COARSE paths).
- [ ] Value refresh polish: per-node version bump renders the whole cone (processGraph
      already early-cutoffs); measure on a 280-node seed before optimizing.
- [ ] Kill list opened: which storeKit singletons become context on the RF surface
      (execute at C9, list now).
- Discovered / not yet wired on ?rf: group MEMBER containment + group drag moving
  members (groupPush machinery inert — needs C6), collapse pills, conduit ribbons,
  Note/Report editing untested, composite drill-in (C7), real cable paths (C3).

### C2.5 — App integration (pulled forward by the full-port ruling) — core DONE 2026-08-26
- [x] `FlowCanvas` replaces `Canvas` in MainApp (rete behind `?rete`); the `?rf`
      harness page is DELETED. One app-lifetime editor/engine/`FlowArea` stack;
      `setEditorRefs`/`setCtorRegistryProvider` bound at creation.
- [x] REAL document lifecycle: `documentStore.restore()`/`ensureFirstDocument` →
      `loadGraph` runs against the flow area (rebuildGraph, placeholders, wildcard
      settle, FC dock, `zoomAt` framing all through the adapter). Autosave LIVE
      (`setGraphChanged→scheduleAutosave` + explicit schedules on canvas edits) —
      verified: in-card edit survives a full page reload.
- [x] Camera bridge: `area.area.zoom/translate` → RF `setViewport` — NavMenu zoom
      pill, `AreaExtensions.zoomAt`, fly-to all drive the RF viewport; RF `onMove`
      mirrors back into `area.area.transform`; `area.area.pointer` tracked in flow
      coords. `nodeViews.element` resolves to the LIVE `.react-flow__node` DOM
      (flash/containment readers see real elements).
- [x] Chrome slots registered: `setSelectNode`/`setUnselectAllNodes` (RF selection
      mirrored onto editor payloads), `setDeleteSelected`. REAL `AddNodeMenu` on pane
      context-menu + `addMenuRequest` (palette / top-bar +); composite hydrate on add.
- [x] Verified live with full chrome: menu/top/status bars, File menu, doc load,
      zoom pill, add menu — zero console errors.
- [x] `installCanvasKeyboard` runs against the flow stack unchanged (it already
      spoke editorRef/areaRef/process slots): F9, Enter→palette, Ctrl+A (34/34),
      Ctrl+C/V (copy/paste 28→56 through the real copyPaste machinery), arrow
      nudge (+DOT_SPACING; correctly skipped while a field has focus), group/tidy
      keys registered (verbs still no-op until wired), Ctrl+S/O, Delete via ONE
      path — the registered delete verb now covers nodes + selected cables and
      RF's own deleteKeyCode is OFF.
- [x] Quick-wire: RF `onConnectStart/End` — drag-to-empty-canvas opens the real
      AddNodeMenu (compatibility-filtered via `filterByCompatibleSocket`), the
      pick splices with `firstCompatibleSocketKey` (verified: +1 node +1 cable);
      cable drag blurs the focused field first (the connectionpick invariant) and
      lights the origin socket.
- [x] Context menus (2026-08-26): `installCanvasContextMenu` ports UNCHANGED — it
      targets data-socket attrs, `path.solenoid-cable-hit[data-conn-id]` (now
      rendered by FlowCableEdge; RF's own interaction path disabled per edge and
      visible strokes pointer-events:none, mirroring the rete discipline), and
      nodeViews element containment (live RF DOM). All three menus verified live:
      node (isolate/chain/where-used/pin/comment), cable (Insert Conduit — model
      correct, undo restores; Delete), socket (Attach Format Controller — created
      and docked a real FC). Pane fallback opens the Add menu; RF's
      onPaneContextMenu removed in favor of the one native handler.
- [x] Conduit lane cables render (2026-08-26): ConduitComponent was the ONE other
      direct `RefSocket` user — same flow-surface branch as NodeSocket (injected
      Handle wrapping the glyph). Insert Conduit now draws all 22 edges.
- [x] Tidy + Cleanup wired: `makeEnsureArrange/makeArrangeFn/makeCleanupFn`
      unchanged. Two adapter shims made the auto-arrange plugin work: fake
      `use()` wires `setParent` (parentScope walks land on the adapter, whose
      prototype is `BaseAreaPlugin.prototype` for the instanceof checks — both
      dissolve at C9 with ELK-direct), and `FlowNodeView.translate` (the ELK
      applier translates VIEWS, not the plugin). T-key Tidy re-layouts live.
- [x] Group drag tows members: RF `onNodeDrag` deltas → `moveGroupMembers`
      (skipSelected, expanded groups only) — verified 108px/108px.
- [x] Lock mode: `canvasLockStore` → `nodesDraggable/elementsSelectable` off +
      the `--locked` CSS modifier (cards pointer-transparent) + connection gate.
      Verified: node drag blocked, the press falls through to a LIVE pan.
- [x] Docked FCs: `setRepositionDocked` registered (same repositioner, adapter-
      driven).
- [x] Lasso: `installLassoSelection` ports unchanged — it already listened in
      CAPTURE on the container, so RF's pane (pan/box-select) never sees a
      shift-press; cable hit-testing works via new LIVE `connectionViews`
      (resolve to `.react-flow__edge[data-id]`). Verified: shift-drag selected
      10 nodes, no pan.
- [x] Isolate camera path: Canvas's snapshot/dim/zoomAt/restore effect ported
      (live elements take the dim class). Verified: I-key → 18 receded nodes
      dimmed + camera framed the focus; Escape restores and un-dims.
- [x] `setBulkSettle` registered (reconcileFcTypes + connection bump +
      processGraph + syncGroupCollapse — the rete shape minus its
      format-mismatch rescan, which stays unported).
- [ ] Chrome verbs still unwired: touch-select mode, Minimap accent parity (RF
      placeholder), presenter, standoff solver application on drag, group-push
      (expand displacement), format-mismatch rescan, HtmlCanvasLayer decision.
- [ ] C7 probe pending: couldn't reach the seed template menu in automation to
      load composite-workbench; test whether the rete-based drill-in overlay
      works over the flow surface when C7 starts.

### C3 — Cables — core DONE 2026-08-26
- [x] `FlowCableEdge`: the walk router (`getCablePath` — PathArgs maps 1:1 onto RF
      EdgeProps) with conduit angle hints, type coloring incl. combo-vs-live-value and
      `resolveTypedSource` conduit tracing, selection color/width, flow beads overlay,
      isolate dim. RF's own 20px interaction path gives hit-targets; RF edge selection
      mirrors into `cableSelectionStore` (deferred out of the state updater).
- [x] Shape switching live from the top-bar segmented control (all edges re-route).
- [x] Cable Inspector works on selection; **the Canvas-hosted overlay set is now
      mounted by FlowCanvas too** (CommandPalette, SocketLegend, IsolatePill,
      CableInspector, ConfirmDialog, NoticeToasts, LoadOverlay, ComputeOverlay) —
      they lived inside Canvas.tsx's JSX, not MainApp.
- [ ] Ribbons/conduit trunks + fans, ghost cables, load-reveal draw, value chips on
      cables, double-click run selection, per-edge z-lift when selected, hover width
      bump, socket-hover cable highlight (store wiring exists; verify), touch hit
      widths, CableFlourish.
- [ ] Cable-drag blurs focused field (rete `connectionpick` behavior re-created —
      RF `onConnectStart`).

### C4 — Chrome integration
- [ ] Mount real Header/NavMenu/Outline/StatusBar/HUD against the flow surface; port
      `canvasActions`/`canvasKeyboard`/lasso/fly-to/semantic zoom.
- [ ] Minimap: custom RF `<MiniMap>` (accent colors, border-box rects).
- [ ] Context menus, add-menu quick-wire, align bar, isolate, presenter mode.

### C5 — Undo/redo + copy/paste — core DONE 2026-08-26
- [x] `flow/flowHistory.ts`: SNAPSHOT history replacing rete-history-plugin — every
      settled mutation records `serializeGraph()` (400ms coalesce, 80 deep, no-op
      dedupe by JSON identity); undo/redo = `loadGraph` with the camera held
      (transform captured and re-applied through the area bridge) + autosave of the
      restored state. Baseline seeding rides the existing `setClearHistory` slot
      (loadGraph clears history at end-of-load → that IS the new baseline); the
      history's own restores are guarded out of both reset and record.
- [x] Recording hooks: `graphChanged` (all component-internal edits), the area
      adapter's moveNode (nudge/push/standoffs — no processGraph on those), drag
      stop. Every undo entry point already funnels through Ctrl+Z (Edit menu +
      mobile/tablet bars synthesize the key), so the keyboard historyRef duck is
      the single integration point.
- [x] Live-verified: value edit undo/redo (50↔99, camera held), add-node undo
      (29→28), drag undo (135px restored). Copy/paste itself landed with the
      keyboard round. No unit test — the restore path needs DOM (loadGraph
      teardown); pinned by live verification for now.
- [ ] `historyDigest` labels (Edit-menu "Undo <what>") — snapshot steps carry no
      label yet; derive from the diff or record a label at schedule() call sites.
- [ ] Undo depth/perf on a ~280-node doc (full rebuild per step) — measure, and if
      slow, apply snapshots as DIFFS through the editor instead of loadGraph.

### C6 — Groups, standoffs, conduits
- [ ] `groupPushCore`/`standoffSolver` (pure) applied via `setNodes`; collapse pills;
      conduit popup; area-plane z-order.

### C7 — Composite drill-in
- [ ] The payoff: drill-in = the SAME FlowCanvas component with the composite's
      editor/engine — no second stack, no `Scope.use` cache, no parity drift.
      `surfaceParity.test.ts` retargeted or retired.

### C8 — Touch/tablet pass
- [ ] Pinch/pan/tap-select/palm on emulated touch (Playwright CDP, sanctioned);
      mobile/tablet bars wired; the `?rf` surface must not regress the gesture inventory
      (`docs/touch-gestures.md`).

### C9 — Parity sweep + cutover decision
- [ ] Every seed opened side-by-side (rete vs RF), diffs listed and burned down.
- [ ] Re-harness the ~45 rete-coupled test files' fixtures; keep the ~228 pure ones.
- [ ] HIC renderer: port, keep rete-only, or drop (author call).
- [ ] Remove replaced rete packages + styled-components; storeKit kill list executed;
      docs reconciled (subsystem-invariants rete sections, CLAUDE.md traps).
- [ ] Merge plan back to `develop` (author decides timing).
