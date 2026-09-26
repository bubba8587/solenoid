# Docs index

Solenoid's `docs/` folder — the WORKING set only. `CLAUDE.md` (repo root) is always
loaded and is the source of truth for standing rules; this index maps everything
else. Finished docs (shipped plans, resolved scoping, point-in-time research, the
dev-notes per-item history) live in `archive/` — see `archive/README.md`.

## Start here (new agent, in this order)

1. **`../CLAUDE.md`** — standing orders (branch, verification, doc duty) and the
   pointer map; every mechanism lives in the docs below.
2. **`mental-model.md`** — how the system RUNS, end to end (the React Flow view over
   the headless rete model, the compute path, types, frames, display, save/load).
   The story the reference docs assume you know.
3. **`glossary.md`** — the invented vocabulary (Conduit, Standoff, FrameRef, unit
   flow…) plus the author's names for the on-screen chrome. Read before the
   deep-dive docs or their terms won't parse.
4. **`architecture.md`** — the file map: where things live.
5. **`dte.md`** — the decision tree: every NORMATIVE rule (what must remain true, and
   the test that enforces it) and every settled decision (the WHY and what would
   reverse it) is a leaf under `../tree/decisions/`. Read the governing leaf before touching
   sockets, formula names or value handling, or proposing anything that touches a
   settled call.

Pointer hygiene is machine-checked: `docsPointers.test.ts` fails CI on a dead
`.md` citation anywhere in the live docs, a live doc missing from this index, an
archived doc missing from the archive index, a routing-table code file that
no longer exists, or a routing-table row pointing into `archive/` — nothing live
is parked there.

## Reference (read the relevant section before touching a subsystem)

- **`subsystem-invariants.md`**: the index of every spec in `../tree/specs/` (the mechanics, one per
  subsystem, in folders), including the chrome map (`layout-chrome`), the gesture inventory
  (`touch-gestures`), the FC format model (`format-model`) and the null/NaN/error semantics with
  "Reading an input" (`value-semantics`). Read the relevant spec before touching a subsystem.
- **`socket-reference.md`** — every socket variant in plain English: what each
  carries, its glyph/color, what connects in, what is blocked, what it reaches,
  and what the coercion boundary does on arrival. Generated lists — regenerate
  with `scripts/socket-inventory.ts`.
- **`node-coverage.md`** — the node inventory + the arity/labeled-slots rules;
  `nodeCatalog.ts` is the real source of truth.
- **`knap-upstream.md`** — the `knap` bugs (with repros) and API asks found
  integrating it, each with the workaround it would retire, re-verified on every
  bump. The list to file upstream.
- **`../tree/specs/computation/formulajs-divergences.md`** — why Solenoid owns each `registerInternal`
  override instead of falling through to Formula.js. Read before deleting an
  override or widening the fallthrough; the library being wrong is the whole
  reason the override exists.
- **`../tree/specs/floors/engineering.md`** — the cross-cutting code-hygiene rules: overrides on
  the declaration, generated name lists, one implementation per gating metric, `every` for
  completeness, the rete-free formula path, lazy heavy libraries.
- **`upstream-formulajs.md`** — the subset of those divergences that are genuine
  Formula.js bugs, written up as ready-to-paste upstream issues (author submits).
- **`pack-architecture.md`** — the pack authoring guide (framework BUILT); the settled
  calls are [[B15]] leanCore and its children.
- **`pack-composite-plans.md`** — queued composite-shaped pack nodes; the pack program
  is `archive/1.4-plan.md` E3 (Materials & Mechanical content) + `2.0-plan.md` Arc 7 (the
  composite pack shape + distribution).
- **`release-notes-features.md`** — the curated selling list / What's-New source for
  the release in progress (1.4; the 1.3 list is at the v1.3.0 tag).
- **`grid-system.md`** — the (unbuilt) soft-grid design spec; parked in
  `deferrals.md`.
- **`out-of-scope.md`** — the standing NO list.
- **`dte.md`** — decision provenance: the vendored DTE tool (`tools/dte.py`), Solenoid's
  ring map and everyday commands. Read before creating or changing a decision leaf;
  `python tools/dte.py validate` must print `OK` before you finish.
- **`dte-feedback.md`** — difficulties met with the DTE tool itself, numbered, for the author to
  carry upstream; delete an item once it is processed there.

- **`google-style/`** — fetched text of the Google developer style guide (2026-08-18),
  the ARBITER for the UI-copy register experiment; overrides DESIGN.md §7 for that
  work by author ruling. `word-list.txt` is the dictionary; see its README.

## Work queue (forward-looking — verify against code; these rot)

- **`backlog.md`** — OPEN items only; **the single source of truth for tasks.**
  Landed items get DELETED (git + digests are the record). 1.4 shipped (its plan is
  `archive/1.4-plan.md`); the 2.0 cut is proposed in `2.0-plan.md` and items land here as the
  author promotes them. The
  release tail lives here.
- **`plans/`** — per-task execution plans for promoted backlog items, written so a
  smaller model can do the routine work (index + protocol in `plans/README.md`).
  A plan is deleted with its backlog line.
- **`python-r-gap.md`** — the 2026-08-23 survey of numpy/pandas/scipy/R functions with no
  Solenoid node (ranked; Tier 1 = build next). Delete a line when its node lands.
- **`deferrals.md`** — the parked set WITHOUT a plan (reopen-only, trigger-gated,
  parked bugs and features), with the notes needed to reopen each. Planned items live
  in `2.0-plan.md`, never here too.
- **`2.0-plan.md`** — the 2.0 release plan (PROPOSAL 2026-09-01): the arcs that change
  what a document is — pages, collaboration (accounts / cloud saves / multiplayer), the
  Excel transpiler, conditional formatting, canvas at scale, value-model extensions,
  packs, Gantt — plus the cross-cutting prerequisites (save-format freeze, trust on
  open, updater, the web-target decision) and the decisions it reopens.
- **`v2.0/`** — the live plan bundles: 08 Excel transpiler, 10 decision sensitivity,
  12 uncertain/money, 16 widget nodes (proposed for 1.4), 20 pages, 21 collaboration,
  22 canvas at scale, 23 conditional formatting; 25 Gantt is BUILT (2026-09-12) and stays live as
  the engine + figure spec. Built bundles are archived (05 units →
  `archive/units-format-controller.md`; 17 matrix formulas, 18 parity corpus,
  19 computed-column surface → `archive/`); see `v2.0/README.md`.
- **`dev-notes.md`** — session DIGESTS + open problems only; per-item history in
  `archive/dev-notes-history.md`.
- Shipped release views are archived: `archive/release-plan-1.1.md` (the 1.1 cut),
  `archive/1.2-plan.md` (the 1.2 build queue, executed).

## Process

- **`agent-coordination.md`** — the live claim board for parallel sessions; the protocol is the leaf it cites.

---

## Code → spec routing (grep your file here before editing)

The per-FILE version of the cheat-sheet below. Files listed here carry no prose comment
pointers by design (`../tree/specs/floors/engineering.md` § Comments) — this table IS the pointer; the one line a
file may carry is its `[[ID]]` citation, which `python tools/dte.py trace <file>` follows to the
governing leaves. Editing a listed file without reading its docs is how recorded negative
results get retried and settled rulings relapse.

| Code | Governing docs |
|---|---|
| `tree/decisions/**`, `tools/dte.py`, `tests/graph/rules.test.ts` | `dte.md`; `../dte-rules/` (DTE's own SPEC, CLAUDE, README, ADOPTING, DECISIONS) |
| `groupCollapse.ts`, `flyToNode.ts` | [[C88]] collapseIsVisual; `../tree/specs/canvas/group-collapse.md` |
| `AddNodeMenu.tsx`, `catalogSearch.ts`, `nodeOps.ts` | `../tree/specs/canvas/add-menu.md`; [[D5]] searchWiderThanLabel |
| `equationSolve.ts` | [[C47]] equationNode; `../tree/specs/computation/equation-solver.md` |
| `semanticZoomStore.ts` | [[B10]] reactFlowView; `../tree/specs/canvas/react-flow-surface-contract.md` § Semantic zoom |
| `htmlCanvasRenderer.ts`, `rasterAtlas.ts`, `domSync.ts`, `zoomSettle.ts`, `HtmlCanvasLayer.tsx`, `hic*.ts` | [[C42]] htmlInCanvasRenderer; `../tree/specs/canvas/html-in-canvas.md`; [[B10]] reactFlowView |
| `pointerGesture.ts`, `flow/flowPinch.ts`, `flow/flowTouchPan.ts` | [[C92]] pinchUnvetoable, [[C93]] gestureByPointerType; `../tree/specs/canvas/pointer-gestures.md` |
| `flow/FlowSurface.tsx`, `flow/FlowCanvas.tsx`, `flow/flowModel.ts`, `flow/flowView.ts`, `view.ts`, `canvasCommands.ts` | [[C43]] oneFlowSurface; `../tree/specs/canvas/react-flow-surface-contract.md`; [[B10]] reactFlowView |
| `graphCompute.ts`, `process.ts`, `coerceInputs.ts`, `nodeRegistry.ts` (the pass and arrival coercion) | `../tree/specs/computation/compute-pass.md`; [[C23]] calcModes; `../tree/specs/values/error-values.md` |
| `flow/FlowCableEdge.tsx`, `flow/FlowSocketHandle.tsx`, `NodeSocket.tsx`, `NodeCard.tsx` | [[C43]] oneFlowSurface; `../tree/specs/canvas/react-flow-surface-contract.md`; [[B10]] reactFlowView; `../DESIGN.md` § Cards |
| `connectionStore.ts`, `httpBridge.ts`, live-source fetch | [[C23]] calcModes; `../tree/specs/computation/live-connections.md` |
| `flyToNode.ts`, any camera `zoomAt` caller | [[C88]] collapseIsVisual; `../tree/specs/canvas/group-collapse.md` (camera targets) |
| `activeGraph.ts` | [[C77]] compositeIsSubgraph; `../tree/specs/canvas/composite-drill-in-mount-lifecycle.md` (canvas-substitution seam) |
| `mathUtils.ts` `fillBorderedGrid` | [[C102]] gridFillThenForecast; `../tree/specs/computation/bordered-grid-fill.md` |
| `excelFunctions.ts` overrides / dispatch walk | `../tree/specs/computation/formulajs-divergences.md` (why each override exists) |
| `applyOp` scalar operators (`excelFormula.ts`) | `../tree/specs/computation/formula-language.md` § Scalar operators |
| `stringOrder.ts` | [[C59]] byteStringOrder (byte order, not locale) |
| `nodes/matrix.ts` Table Input parse, `TablePopup.tsx` | [[C58]] tableInputRawText (raw text is the stored truth); `../tree/specs/documents/table-popup.md` |
| `palette.ts`, `appTheme.ts`, `themeVars.ts` | `../tree/specs/canvas/palette-and-theme.md`; `../DESIGN.md` § Tertiary (Typed Socket Palette) |
| `CommandPalette.tsx` | `../tree/specs/canvas/command-palette.md` |
| `OutlinePanel.tsx` | `../tree/specs/canvas/outline-panel.md` |
| `cablePaths.ts`, `ribbonCable.ts` | [[B10]] reactFlowView, [[C10]] socketLattice; `../tree/specs/canvas/cable-rendering-knobs.md` |
| `groupPush.ts`, `groupPushCore.ts`, `groupLogic.ts` | [[C85]] groupPushDeterministic, [[C86]] membershipByGesture, [[B10]] reactFlowView; `../tree/specs/canvas/group-expand-push.md` |
| `standoffSolver.ts`, `standoffs.ts` | [[C89]] standoffsSolveLast; `../tree/specs/canvas/standoffs.md` |
| `drawnCables.ts`, `drawnCablePath.ts`, `components/DrawnCable*.tsx` | `../tree/specs/canvas/drawn-cables.md` |
| `tidyArrange.ts` (ELK), `nodeSize.ts` | [[B10]] reactFlowView, [[D63]] lockedGroupIsObstacle; `../tree/specs/canvas/auto-arrange-tidy.md` |
| `errorValue.ts`, `valueKinds.ts` | `tree/specs/values/value-semantics.md`; [[C24]] arraySemantics; `../tree/specs/values/error-values.md` |
| `fcReconcile.ts`, in-place socket retype | [[D16]] retypeReconciles; `../tree/specs/values/type-propagation-on-in-place-socket-retype.md` |
| `unitFlow.ts`, `unitBridge.ts`, `unitValue.ts`, `coerceInputs.ts` | `../tree/specs/values/unit-flow.md`; [[D43]] unitByGranularity, [[C25]] firstClassUnits |
| `formatModel.ts`, `formatController.ts`, FC controls | `tree/specs/values/format-model.md` |
| `alertStore.ts` | [[D79]] effectsEdgeTriggered; `../tree/specs/computation/alert-node-alerts-hud.md` |
| `nodeNameStore.ts` | [[C19]] namingModel; `../tree/specs/documents/addressable-model.md` |
| `persistence.ts`, `textForm.ts`, `graphValidate.ts`, `fileSession.ts` | [[B12]] losslessSaves; `../tree/specs/documents/save-format.md` (names: `../tree/specs/documents/addressable-model.md`) |
| `documentStore.ts`, `documentStoreCore.ts` | [[B12]] losslessSaves; `../tree/specs/documents/per-doc-autosave-persistence.md` |
| `persistence.ts` (load gate, literal maps) | [[C28]] literalsIffEditable; `../tree/specs/documents/inline-literal-maps.md` |
| `flow/FlowCompositeOverlay.tsx`, `flow/drillStack.ts`, drill-in lifecycle | [[C77]] compositeIsSubgraph; `../tree/specs/canvas/composite-drill-in-mount-lifecycle.md` |
| `sockets.ts`, `accepts()`, `trueAnyAdopt.ts` | `../tree/specs/values/socket-lattice.md` (the spec); `socket-reference.md`; [[C10]] socketLattice |
| `nodes/cube.ts` | [[C10]] socketLattice; `../tree/specs/values/socket-lattice.md` (the Cube is the recursive lattice supremum) |
| `knapTemplate.ts`, `nodes/report.ts`, `nodes/annotation.ts` NoteNode.data, `components/useKnapRender.ts`, `ReportOverlay.tsx`, `reportExport.ts` | `../tree/specs/documents/reports-and-notes.md`; [[C68]] knapIsTheDocumentSyntax; `knap-upstream.md` (which workarounds are upstream bugs) |
| `nodes/composite.ts`, `compositeLogic.ts`, `components/CompositeNode.tsx` | `../tree/specs/computation/composite-nodes.md`; [[C77]] compositeIsSubgraph, [[D52]] compositesHoldUntilSolve |
| `nodes/visual.ts`, `nodes/chartOptions.ts`, `components/chartView.tsx`, `components/chartRender.tsx`, `chartCanvasViews.tsx`, `chartCards.tsx` | `../tree/specs/computation/chart-figures.md`; [[C100]] chartIsAValue, [[C96]] chartOptionsAreMatplotlib |
| `nodes/script.ts`, `nodes/scriptRun.ts`, `nodes/scriptCoerce.ts`, `scriptWorker.ts`, `scriptExecutor.ts`, `jsSyntax.ts`, `components/JsEditor.tsx`, `components/ScriptPopup.tsx` | [[C66]] scriptNode; `out-of-scope.md` §4 (the bounded form); `../tree/specs/computation/script-sandbox.md` |
| `excelFunctions.ts`, `excelFormula.ts`, `formulaSignatures.ts`, Expression/LAMBDA | `../tree/specs/computation/formula-language.md`; `../tree/specs/computation/formulajs-divergences.md`; the formula-surface nodes (`python3 tools/dte.py tree --under B16`) |
| `nodes/listOps.ts`, `textOps.ts`, `financeOps.ts`, `matrixOps.ts`, `indexAccess.ts`, `dateSerial.ts`, `convertUnits.ts`, the pack kernels (`astroOps.ts`, `chemistryOps.ts`, `electricalOps.ts`, `emSpectrumOps.ts`, `fluidsOps.ts`, `healthOps.ts`, `physicsConstantsOps.ts`, `thermoOps.ts`, `triangleOps.ts`), `packs/*Formulas.ts` — and ANY new shared node↔formula module | [[C17]] shareImpl (one impl, two surfaces) |
| `computedColumnCore.ts`, `cubeRows.ts`, `ComputedColumnNode`, Frame Input and Cube Input Fx columns | [[C22]] rowFormulaRefs, [[C54]] noPerCellFormulas, [[D81]] cubeRowLists; `../tree/specs/computation/computed-columns.md` |
| Cube Input's typed columns (`cubeFromSource`, `parseCubeSource`, `typedCubeCell`), `cubeEditCell.tsx` | [[D80]] cubeColumnTypes; `../tree/specs/computation/frame-verbs.md` § The Cube value, `../tree/specs/documents/table-popup.md` § Editing a Cube Input |
| `SPARKLINE` (`sparklineImage` in `nodes/visualOps.ts`), picture cells (`cellImageSrc`, `CellImage`) | [[D82]] sparklineCell, [[D83]] imageTextCells; `../tree/specs/computation/formula-language.md` § Lists, `../tree/specs/documents/table-popup.md` § Formatted and Source |
| `scheduleCpm.ts`, `ganttPayload.ts`, `planImport.ts`, `nodes/schedule.ts`, `nodes/gantt.ts`, `packages/*` | `../tree/specs/computation/schedule-and-gantt.md` (the tasks cube, the nodes, the figure, dates and precision); `node-coverage.md` § Schedule and § Gantt (what stands); `v2.0/25-gantt.md` § 4.1 (the one rule); [[C69]] ganttPackages, [[C70]] oneScheduleRule, [[C71]] noBarEditing |
| `frameVerbs.ts`, `frameBackend.ts`, `frame.ts`, `nodes/frame.ts`, `src-tauri/src/engine.rs` | `../tree/specs/computation/frame-verbs.md`; [[C16]] polarsEngine |
| `nodeOps.ts`, any `op` field, `OpSelect`/`ArgSelect`/`SegToggle`/`OpToggle` | [[C26]] opArgDistinct; `../DESIGN.md` § Op pickers; `node-coverage.md` |
| `nodeCatalog.ts` | `node-coverage.md`; [[C14]] currentExcelParity (eliminated functions stay eliminated) |
| any `.css`, any visual change | `../DESIGN.md` |
| any bar/overlay position or z-index | `tree/specs/canvas/layout-chrome.md` |
| `WindowControls.tsx`, `desktopFrame.css`, the window setup in `src-tauri/src/lib.rs` | `tree/specs/canvas/layout-chrome.md` § Desktop window frame |
| `obsidian-plugin/**` | `../tree/specs/integrations/obsidian-plugin.md` (what it has, how it is built, every divergence from the app), under [[C107]] obsidianPlugin |
| `ConduitComponent.tsx`, conduit faces/lanes | [[C10]] socketLattice; `../tree/specs/canvas/conduit-lane-faces.md` |

## Task → docs cheat-sheet

- **Adding/changing a node:** `node-coverage.md` (inventory + the node-design rules)
  + `glossary.md`; `nodeCatalog.ts` is the source of truth (Add menu + Function
  Reference generate from it). Merging nodes: [[B11]] maximalMerge.
- **Anything on the canvas surface (a gesture, a key, a menu, a layer, a cable or
  socket change):** [[C43]] oneFlowSurface; `../tree/specs/canvas/react-flow-surface-contract.md` first;
  `tree/specs/canvas/touch-gestures.md` for gestures.
- **Choosing a socket type for a port, or "why won't this cable connect?":**
  `socket-reference.md` (the per-variant tables) + `../tree/specs/values/socket-lattice.md`.
- **Touching the FC / formats / units:** `tree/specs/values/format-model.md` +
  `../tree/specs/values/unit-flow.md` + [[D43]] unitByGranularity (units granularity).
- **Touching frames/the engine:** `glossary.md` + [[C16]] polarsEngine/arraySemantics + the
  `frameVerbs.ts` oracle and cargo parity tests.
- **A visual/UI change:** `../DESIGN.md` (the design-system rulebook) first, always.
- **Proposing a feature or scope change:** `out-of-scope.md` + the decision tree (`dte.md`) +
  `v2.0/README.md` (verdict-pending + ruled-out lists) — most of the idea space
  has already been walked and ruled; don't re-litigate.
- **Wrapping up a session:** the reconcile ritual in `CLAUDE.md` — extend the
  session digest (sweep digested ones to the archive), DELETE landed backlog
  lines, archive any doc whose job finished, update this index if the set changed.
