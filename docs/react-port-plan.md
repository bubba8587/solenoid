# React Flow port — plan and status ledger

**Branch: `react-port-develop`** (author-ordered 2026-08-26, superseding the develop-only
rule for THIS track). Runs in parallel with rete development on `develop`; merged in
eventually. Multi-session: each session picks up the next unchecked chunk item below.

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

### C1 — Interaction + persistence baseline
- [ ] Zoom/pan parity: wheel curve + clamp from `areaPresets` (`clampZoom` values), no
      double-click zoom, `panOnDrag`/`selectionOnDrag` matching rete feel.
- [ ] Connect/disconnect: `isValidConnection` from `SolenoidSocket.canConnect` (the
      lattice's `accepts()`), writes through `editor.addConnection/removeConnection`,
      recompute + value refresh on change (targeted `cache.delete` cone like
      `process.ts`, not full rebuild).
- [ ] Node drag writes back to model positions; delete (nodes + cables) through editor.
- [ ] Save/load round-trip from the flow surface (serialize via textForm path; prove a
      graph edited in RF reloads identically in the rete surface).
- [ ] Add-node: minimal add menu from `nodeCatalog` (flat search list is enough here).

### C2 — Real node components (the big one — split across sessions as needed)
- [ ] Adapter: render existing `components/*` node components inside RF nodes — shim
      `{ data, emit }` props; socket rendering swapped to a Handle-based
      `MeasuredSocketRow` twin (ONE shared component, not 311 edits).
- [ ] Dynamic sockets: bridge retype/`fcReconcile`/`ExtensibleInputs` paths to
      `useUpdateNodeInternals`; **measure churn** on the distribution/Running/FC nodes.
- [ ] Interaction discipline: `nodrag`/`nowheel`/`nopan` sweep replacing
      `stopDragStart`-for-RF; draft-commit fields (`useDraftCommit`) verified.
- [ ] Value refresh: replace `area.update("node", id)` call sites on this surface with
      state-driven re-render (RF node `data` versioning).
- [ ] Kill list opened: which storeKit singletons become context on the RF surface
      (execute at C9, list now).

### C3 — Cables
- [ ] Custom edge: `cablePaths.ts` walk router as the RF edge path (pure code ports).
- [ ] Ribbons/conduit trunks, ghost cable, selection + cable inspector, value chips.
- [ ] Cable-drag blurs focused field (rete `connectionpick` behavior re-created).

### C4 — Chrome integration
- [ ] Mount real Header/NavMenu/Outline/StatusBar/HUD against the flow surface; port
      `canvasActions`/`canvasKeyboard`/lasso/fly-to/semantic zoom.
- [ ] Minimap: custom RF `<MiniMap>` (accent colors, border-box rects).
- [ ] Context menus, add-menu quick-wire, align bar, isolate, presenter mode.

### C5 — Undo/redo + copy/paste
- [ ] Command layer replacing `rete-history-plugin` (snapshot on the textForm/immutable
      stores); `historyDigest` labels preserved.
- [ ] Copy/paste parity.

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
