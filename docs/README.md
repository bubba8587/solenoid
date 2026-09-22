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
   reverse it) is a node under `../decisions/`. Read the governing node before touching
   sockets, formula names or value handling, or proposing anything that touches a
   settled call.

Pointer hygiene is machine-checked: `docsPointers.test.ts` fails CI on a dead
`.md` citation anywhere in the live docs, a live doc missing from this index, an
archived doc missing from the archive index, a routing-table code file that
no longer exists, or a routing-table row pointing into `archive/` — nothing live
is parked there.

## Reference (read the relevant section before touching a subsystem)

- **`subsystem-invariants.md`** — the "don't break this" mechanics (the React Flow
  surface contract, pointer gestures, cable routing, group push, standoffs, tidy,
  error values, unit flow, alerts, addressable model, autosave, drill-in lifecycle).
- **`layout-chrome.md`** — the on-screen chrome map (bars, overlays, offsets,
  z-index ladder). Read before adding or moving any bar/overlay.
- **`touch-gestures.md`** — the pointer/touch gesture INVENTORY (what every
  gesture means, per device config, incl. the long-press → contextmenu paths).
  Read before adding/changing any gesture; update it in the same change.
- **`format-model.md`** — the FC function model: the render pipeline, the
  per-family control truth table (mirrored in `formatModel.ts`), the precision
  rule. Read before touching FC controls/resolution.
- **`socket-reference.md`** — every socket variant in plain English: what each
  carries, its glyph/color, what connects in, what is blocked, what it reaches,
  and what the coercion boundary does on arrival. Generated lists — regenerate
  with `scripts/socket-inventory.ts`.
- **`value-semantics.md`** — null / NaN / Infinity / SolError semantics per
  computation context, plus **"Reading an input"**: the spec for what a node
  does with a WIRED blank vs its typed literal. Target that section when
  writing a new node. All shipped.
- **`node-coverage.md`** — the node inventory + the arity/labeled-slots rules;
  `nodeCatalog.ts` is the real source of truth.
- **`knap-upstream.md`** — the `knap` bugs (with repros) and API asks found
  integrating it, each with the workaround it would retire, re-verified on every
  bump. The list to file upstream.
- **`../specs/formulajs-divergences.md`** — why Solenoid owns each `registerInternal`
  override instead of falling through to Formula.js. Read before deleting an
  override or widening the fallthrough; the library being wrong is the whole
  reason the override exists.
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
  ring map and everyday commands. Read before creating or changing a decision node;
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

- **`agent-coordination.md`** — the live claim board for parallel sessions; the protocol is the node it cites.

---

## Code → spec routing (grep your file here before editing)

The per-FILE version of the cheat-sheet below. Files listed here carry no prose comment
pointers by design ([[C57]] commentMinimalism) — this table IS the pointer; the one line a
file may carry is its `[[ID]]` citation, which `python tools/dte.py trace <file>` follows to the
governing nodes. Editing a listed file without reading its docs is how recorded negative
results get retried and settled rulings relapse.

| Code | Governing docs |
|---|---|
| `decisions/**`, `tools/dte.py`, `tests/graph/rules.test.ts` | `dte.md`; `../dte-rules/` (DTE's own SPEC, CLAUDE, README, ADOPTING, DECISIONS) |
| `groupCollapse.ts`, `flyToNode.ts` | [[C88]] collapseIsVisual; `../specs/group-collapse.md` |
| `AddNodeMenu.tsx`, `catalogSearch.ts`, `nodeOps.ts` | `../specs/add-menu.md`; [[D5]] searchWiderThanLabel, [[D6]] opRowDerivesFromHost |
| `equationSolve.ts` | [[C47]] equationNode; `../specs/equation-solver.md` |
| `semanticZoomStore.ts` | [[C74]] semanticZoomRawScale |
| `htmlCanvasRenderer.ts`, `rasterAtlas.ts`, `domSync.ts`, `zoomSettle.ts`, `HtmlCanvasLayer.tsx`, `hic*.ts` | [[C42]] htmlInCanvasRenderer; `../specs/html-in-canvas.md`; [[C75]] gpuTextureBudget |
| `pointerGesture.ts`, `flow/flowPinch.ts`, `flow/flowTouchPan.ts` | [[C92]] pinchUnvetoable, [[C93]] gestureByPointerType; `../specs/pointer-gestures.md` |
| `flow/FlowSurface.tsx`, `flow/FlowCanvas.tsx`, `flow/flowModel.ts`, `flow/flowView.ts`, `view.ts`, `canvasCommands.ts` | [[C43]] oneFlowSurface; `../specs/react-flow-surface-contract.md`; [[B10]] reactFlowView |
| `graphCompute.ts`, `process.ts` (the pass) | [[D30]] targetedEqualsFull, [[D31]] onlyCalcModeSkips; [[C24]] arraySemantics; `../specs/error-values.md` (`#CIRC!` is engine-level) |
| `flow/FlowCableEdge.tsx`, `flow/FlowSocketHandle.tsx`, `NodeSocket.tsx`, `NodeCard.tsx` | [[C43]] oneFlowSurface; `../specs/react-flow-surface-contract.md`; [[C11]] socketBox12; `../DESIGN.md` § Cards |
| `connectionStore.ts`, `httpBridge.ts`, live-source fetch | [[D32]] refreshOutsideRebuild; `../specs/live-connections.md` |
| `flyToNode.ts`, any camera `zoomAt` caller | [[C88]] collapseIsVisual; `../specs/group-collapse.md` (camera targets) |
| `activeGraph.ts` | [[C77]] compositeIsSubgraph; `../specs/composite-drill-in-mount-lifecycle.md` (canvas-substitution seam) |
| `mathUtils.ts` `fillBorderedGrid` | [[C102]] gridFillThenForecast; `../specs/bordered-grid-fill.md` |
| `excelFunctions.ts` overrides / dispatch walk | `../specs/formulajs-divergences.md` (why each override exists) |
| `applyOp` scalar operators (`excelFormula.ts`) | `value-semantics.md` § Scalar operators (P6) |
| `stringOrder.ts` | [[C59]] byteStringOrder (byte order, not locale) |
| `nodes/matrix.ts` Table Input parse, `TablePopup.tsx` | [[C58]] tableInputRawText (raw text is the stored truth) |
| `palette.ts` socket-color siblings | `../DESIGN.md` § Tertiary (Typed Socket Palette) |
| `cablePaths.ts`, `ribbonCable.ts` | [[C91]] cableWalkRouter, [[D17]] relaysTransparent; `../specs/cable-rendering-knobs.md` |
| `groupPush.ts`, `groupPushCore.ts`, `groupLogic.ts` | [[C85]] groupPushDeterministic, [[C86]] membershipByGesture, [[C87]] groupsAreSubflows; `../specs/group-expand-push.md` |
| `standoffSolver.ts`, `standoffs.ts` | [[C89]] standoffsSolveLast; `../specs/standoffs.md` |
| `drawnCables.ts`, `drawnCablePath.ts`, `components/DrawnCable*.tsx` | [[C90]] drawnCablesAnnotate; `../specs/drawn-cables.md` |
| `tidyArrange.ts` (ELK), `nodeSize.ts` | [[C84]] tidyTranslatesOnly, [[D63]] lockedGroupIsObstacle, [[D64]] oneSizeRead; `../specs/auto-arrange-tidy.md` |
| `errorValue.ts`, `valueKinds.ts` | `value-semantics.md`; [[C24]] arraySemantics; `../specs/error-values.md` |
| `fcReconcile.ts`, in-place socket retype | [[D16]] retypeReconciles; `../specs/type-propagation-on-in-place-socket-retype.md` |
| `unitFlow.ts`, `unitBridge.ts`, `unitValue.ts`, `coerceInputs.ts` | `../specs/unit-flow.md`; [[D43]] unitByGranularity, [[C25]] firstClassUnits |
| `formatModel.ts`, `formatController.ts`, FC controls | `format-model.md` |
| `alertStore.ts` | [[C39]] effectsEdgeTriggered; `../specs/alert-node-alerts-hud.md` |
| `nodeNameStore.ts` | [[C19]] namingModel; `../specs/addressable-model.md` |
| `persistence.ts`, `textForm.ts`, `graphValidate.ts`, `fileSession.ts` | [[B12]] losslessSaves; `../specs/save-format.md` (names: `../specs/addressable-model.md`) |
| `documentStore.ts`, `documentStoreCore.ts` | [[C32]] autosaveSlotOrder; `../specs/per-doc-autosave-persistence.md` |
| `persistence.ts` (load gate, literal maps) | [[C28]] literalsIffEditable; `../specs/inline-literal-maps.md` |
| `flow/FlowCompositeOverlay.tsx`, drill-in lifecycle | [[C77]] compositeIsSubgraph; `../specs/composite-drill-in-mount-lifecycle.md` |
| `sockets.ts`, `accepts()`, `trueAnyAdopt.ts` | `../specs/socket-lattice.md` (the spec); `socket-reference.md`; [[C10]] socketLattice, [[D15]] wildcardsKeepRank |
| `nodes/cube.ts` | [[C10]] socketLattice; `../specs/socket-lattice.md` (the Cube is the recursive lattice supremum) |
| `knapTemplate.ts`, `nodes/report.ts`, `nodes/annotation.ts` NoteNode.data, `components/useKnapRender.ts` | `node-coverage.md` § Annotation (Note and Report bodies are Knap templates: what mints an input, what a bare `{{ name }}` embeds); [[C68]] knapIsTheDocumentSyntax; `knap-upstream.md` (which workarounds are upstream bugs) |
| `nodes/script.ts`, `nodes/scriptRun.ts`, `nodes/scriptCoerce.ts`, `scriptWorker.ts`, `scriptExecutor.ts`, `jsSyntax.ts`, `components/JsEditor.tsx`, `components/ScriptPopup.tsx` | [[C66]] scriptNode; `out-of-scope.md` §4 (the bounded form); `../specs/script-sandbox.md` |
| `excelFunctions.ts`, `excelFormula.ts`, Expression/LAMBDA | `../specs/formulajs-divergences.md`; the formula-surface nodes (`python tools/dte.py tree --under B5`); [[C22]] rowFormulaRefs |
| `nodes/listOps.ts`, `textOps.ts`, `financeOps.ts`, `matrixOps.ts`, `indexAccess.ts`, `dateSerial.ts`, `convertUnits.ts` — and ANY new shared node↔formula module | [[C17]] shareImpl (one impl, two surfaces), [[D19]] implReteFree (rete-free; what not to extract) |
| `computedColumnCore.ts`, `ComputedColumnNode`, Frame Input Fx columns | [[C22]] rowFormulaRefs, [[C54]] noPerCellFormulas; `../specs/computed-columns.md` |
| `scheduleCpm.ts`, `ganttPayload.ts`, `planImport.ts`, `nodes/schedule.ts`, `nodes/gantt.ts`, `packages/*` | `node-coverage.md` § Schedule and § Gantt (what stands); `v2.0/25-gantt.md` § 4.1 (the one rule), § 6 (the cube contract, the figure payload, the figure never writes); [[C69]] ganttPackages, [[C70]] oneScheduleRule, [[C71]] noBarEditing |
| `frameVerbs.ts`, `frameBackend.ts`, `frame.ts` | `glossary.md` (FrameRef); [[C16]] polarsEngine, [[C24]] arraySemantics; cargo parity tests |
| `nodeOps.ts`, any `op` field, `OpSelect`/`ArgSelect`/`SegToggle`/`OpToggle` | [[C26]] opArgDistinct; `../DESIGN.md` § Op pickers; `node-coverage.md` |
| `nodeCatalog.ts` | `node-coverage.md`; [[C14]] currentExcelParity (eliminated functions stay eliminated) |
| any `.css`, any visual change | `../DESIGN.md` |
| any bar/overlay position or z-index | `layout-chrome.md` |
| `WindowControls.tsx`, `desktopFrame.css`, the window setup in `src-tauri/src/lib.rs` | `layout-chrome.md` § Desktop window frame |
| `obsidian-plugin/**` | `../specs/obsidian-plugin.md` (what it has, how it is built, every divergence from the app), under [[C107]] obsidianPlugin |
| `ConduitComponent.tsx`, conduit faces/lanes | [[D17]] relaysTransparent; `../specs/conduit-lane-faces.md` |

## Task → docs cheat-sheet

- **Adding/changing a node:** `node-coverage.md` (inventory + the node-design rules)
  + `glossary.md`; `nodeCatalog.ts` is the source of truth (Add menu + Function
  Reference generate from it). Merging nodes: [[B11]] maximalMerge.
- **Anything on the canvas surface (a gesture, a key, a menu, a layer, a cable or
  socket change):** [[C43]] oneFlowSurface; `../specs/react-flow-surface-contract.md` first;
  `touch-gestures.md` for gestures.
- **Choosing a socket type for a port, or "why won't this cable connect?":**
  `socket-reference.md` (the per-variant tables) + subsystem-invariants "Socket
  lattice".
- **Touching the FC / formats / units:** `format-model.md` + subsystem-invariants
  "Unit flow" + [[D43]] unitByGranularity (units granularity).
- **Touching frames/the engine:** `glossary.md` + [[C16]] polarsEngine/arraySemantics + the
  `frameVerbs.ts` oracle and cargo parity tests.
- **A visual/UI change:** `../DESIGN.md` (the design-system rulebook) first, always.
- **Proposing a feature or scope change:** `out-of-scope.md` + the decision tree (`dte.md`) +
  `v2.0/README.md` (verdict-pending + ruled-out lists) — most of the idea space
  has already been walked and ruled; don't re-litigate.
- **Wrapping up a session:** the reconcile ritual in `CLAUDE.md` — extend the
  session digest (sweep digested ones to the archive), DELETE landed backlog
  lines, archive any doc whose job finished, update this index if the set changed.
