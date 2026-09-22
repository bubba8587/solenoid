# Solenoid: subsystem specs

The index of `../specs/`. Each spec states what its subsystem does, in enough detail to rebuild it, and names the decision nodes it serves on its first line. Read the whole spec before changing its subsystem. This page only points; it never holds mechanics.

## Floors

Three specs govern whole classes of files through a `covers:` glob in their header. A file the glob matches is built to that spec and cites nothing class-wide itself.

| Spec | Governs |
|---|---|
| `../specs/components.md` | every React component |
| `../specs/node-classes.md` | every node class and op module |
| `../specs/stores.md` | every module-singleton store |

## Computation

| Spec | Subsystem | Main code |
|---|---|---|
| `../specs/compute-pass.md` | the recompute pass, calc modes, the per-node wrappers and arrival coercion | `graphCompute.ts`, `process.ts`, `coerceInputs.ts`, `nodeRegistry.ts` |
| `../specs/formula-language.md` | the formula grammar, operators, name resolution, dispatch, broadcasting, LAMBDA, Expression | `excelFormula.ts`, `excelFunctions.ts`, `formulaSignatures.ts` |
| `../specs/formulajs-divergences.md` | why each `registerInternal` override exists | `excelFunctions.ts` |
| `../specs/computed-columns.md` | per-row formulas on a Frame: Fx columns and the Computed Column node | `computedColumnCore.ts`, `nodes/frame.ts` |
| `../specs/frame-verbs.md` | the Frame value, lazy frames, the JS / Polars backend seam, every relational verb | `frame.ts`, `frameVerbs.ts`, `frameBackend.ts`, `src-tauri/src/engine.rs` |
| `../specs/equation-solver.md` | solving a relation for any one variable | `equationSolve.ts` |
| `../specs/bordered-grid-fill.md` | filling blank cells in a bordered grid | `mathUtils.ts` `fillBorderedGrid` |
| `../specs/script-sandbox.md` | running Script code in a worker | `scriptWorker.ts`, `scriptExecutor.ts`, `nodes/scriptRun.ts` |
| `../specs/live-connections.md` | fetched data: caching, refresh, the network gate | `connectionStore.ts`, `nodes/connection.ts`, `httpBridge.ts` |
| `../specs/alert-node-alerts-hud.md` | the Alert node and the Alerts HUD | `nodes/display.ts`, `alertStore.ts`, `AlertLayer.tsx` |

## Values and types

| Spec | Subsystem | Main code |
|---|---|---|
| `../specs/socket-lattice.md` | which sockets connect, and the wildcard ladder | `sockets.ts` |
| `../specs/type-propagation-on-in-place-socket-retype.md` | reconciling downstream when a socket retypes in place | `fcReconcile.ts` |
| `../specs/unit-flow.md` | units on values and formats flowing downstream | `unitFlow.ts`, `unitBridge.ts`, `unitValue.ts` |
| `../specs/error-values.md` | error codes, propagation and display | `errorValue.ts` |

## Documents

| Spec | Subsystem | Main code |
|---|---|---|
| `../specs/save-format.md` | the saved document, the text form, loading | `persistence.ts`, `textForm.ts`, `graphValidate.ts` |
| `../specs/addressable-model.md` | node names and name-addressed references | `nodeNameStore.ts`, `nodeNaming.ts` |
| `../specs/per-doc-autosave-persistence.md` | per-document autosave slots | `documentStore.ts` |
| `../specs/inline-literal-maps.md` | values edited on a card, and which classes restore them | node classes, `persistence.ts` |
| `../specs/literal-input-editors.md` | the table popup as the editor for literal sources | `TablePopup.tsx`, `columnHeadControls.tsx` |
| `../specs/graph-load-teardown-performance.md` | building and tearing down a large graph | `persistence.ts` `rebuildGraph`, `flow/FlowCanvas.tsx` |

## Canvas

| Spec | Subsystem | Main code |
|---|---|---|
| `../specs/react-flow-surface-contract.md` | what React Flow owns, sub-flows, cables, sockets, overlays, ghost cables | `flow/*` |
| `../specs/pointer-gestures.md` | pinch, pan, drag and their priority (with `touch-gestures.md`) | `pointerGesture.ts`, `flow/flowPinch.ts`, `flow/flowTouchPan.ts` |
| `../specs/html-in-canvas.md` | the HTML-in-Canvas gesture layer | `htmlCanvasRenderer.ts`, `HtmlCanvasLayer.tsx` |
| `../specs/cable-rendering-knobs.md` | cable shapes, ribbons and the walk router | `cablePaths.ts`, `flow/FlowCableEdge.tsx` |
| `../specs/drawn-cables.md` | annotation cables drawn by hand | `drawnCables.ts`, `DrawnCableLayer.tsx` |
| `../specs/auto-arrange-tidy.md` | Tidy and Cleanup | `tidyArrange.ts` |
| `../specs/group-expand-push.md` | how expanding a group moves its neighbors | `groupPush.ts`, `groupPushCore.ts` |
| `../specs/group-collapse.md` | what a collapsed group shows and hides | `groupCollapse.ts` |
| `../specs/standoffs.md` | standoff constraints and their solver | `standoffs.ts`, `standoffSolver.ts`, `StandoffLayer.tsx` |
| `../specs/conduit-lane-faces.md` | Conduit lane geometry | Conduit components |
| `../specs/resizable-content-nodes.md` | cards whose content the user resizes | Conduit, Display |
| `../specs/input-cable-pruning.md` | dropping cables before their sockets go | `components/cablePrune.ts` |
| `../specs/composite-drill-in-mount-lifecycle.md` | opening and leaving a composite's inner canvas | `flow/FlowCompositeOverlay.tsx` |
| `../specs/add-menu.md` | the Add menu tree, search rows and scoring | `AddNodeMenu.tsx`, `catalogSearch.ts`, `nodeOps.ts` |

## Integrations

| Spec | Subsystem | Main code |
|---|---|---|
| `../specs/obsidian-plugin.md` | Solenoid Properties, the Obsidian plugin | `obsidian-plugin/` |
