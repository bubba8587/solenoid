# Solenoid: subsystem specs

The index of `../tree/specs/`, grouped by the folders the specs live in. Each spec states what its subsystem does, in enough detail to rebuild it, and names the decision leaves it serves on its first line. Read the whole spec before changing its subsystem. This page only points; it never holds mechanics.

## Floors

Three specs govern whole classes of files through a `covers:` glob in their header. A file the glob matches is built to that spec and cites nothing class-wide itself.

| Spec | Governs |
|---|---|
| `../tree/specs/floors/components.md` | every React component |
| `../tree/specs/floors/node-classes.md` | every node class and op module |
| `../tree/specs/floors/stores.md` | every module-singleton store |
| `../tree/specs/floors/engineering.md` | cross-cutting code-hygiene rules (no `covers:` glob; each rule binds every file that does what it names) |

## Computation

| Spec | Subsystem | Main code |
|---|---|---|
| `../tree/specs/computation/compute-pass.md` | the recompute pass, calc modes, the per-node wrappers and arrival coercion | `graphCompute.ts`, `process.ts`, `coerceInputs.ts`, `nodeRegistry.ts` |
| `../tree/specs/computation/formula-language.md` | the formula grammar, operators, name resolution, dispatch, broadcasting, LAMBDA, Expression | `excelFormula.ts`, `excelFunctions.ts`, `formulaSignatures.ts` |
| `../tree/specs/computation/formulajs-divergences.md` | why each `registerInternal` override exists | `excelFunctions.ts` |
| `../tree/specs/computation/computed-columns.md` | per-row formulas on a Frame: Fx columns and the Computed Column node | `computedColumnCore.ts`, `nodes/frame.ts` |
| `../tree/specs/computation/frame-verbs.md` | the Frame value, lazy frames, the JS / Polars backend seam, every relational verb | `frame.ts`, `frameVerbs.ts`, `frameBackend.ts`, `src-tauri/src/engine.rs` |
| `../tree/specs/computation/composite-nodes.md` | composite nodes: ports, run modes, the heavy-mode hold, loops, save and load | `nodes/composite.ts`, `components/CompositeNode.tsx` |
| `../tree/specs/computation/chart-figures.md` | the values on the `chart` socket, the figure nodes, the options string, rendering | `nodes/visual.ts`, `nodes/chartOptions.ts`, `chartRender.tsx` |
| `../tree/specs/computation/schedule-and-gantt.md` | the tasks cube, the Schedule and Gantt nodes, plan import, the Gantt figure, dates and precision | `scheduleCpm.ts`, `nodes/schedule.ts`, `nodes/gantt.ts`, `ganttPayload.ts`, `planImport.ts`, `packages/schedule-engine`, `packages/gantt-layout`, `packages/gantt-react` |
| `../tree/specs/computation/equation-solver.md` | solving a relation for any one variable | `equationSolve.ts` |
| `../tree/specs/computation/bordered-grid-fill.md` | filling blank cells in a bordered grid | `mathUtils.ts` `fillBorderedGrid` |
| `../tree/specs/computation/script-sandbox.md` | running Script code in a worker | `scriptWorker.ts`, `scriptExecutor.ts`, `nodes/scriptRun.ts` |
| `../tree/specs/computation/live-connections.md` | fetched data: caching, refresh, the network gate | `connectionStore.ts`, `nodes/connection.ts`, `httpBridge.ts` |
| `../tree/specs/computation/alert-node-alerts-hud.md` | the Alert node and the Alerts HUD | `nodes/display.ts`, `alertStore.ts`, `AlertLayer.tsx` |

## Values and types

| Spec | Subsystem | Main code |
|---|---|---|
| `../tree/specs/values/socket-lattice.md` | which sockets connect, and the wildcard ladder | `sockets.ts` |
| `../tree/specs/values/type-propagation-on-in-place-socket-retype.md` | reconciling downstream when a socket retypes in place | `fcReconcile.ts` |
| `../tree/specs/values/unit-flow.md` | units on values and formats flowing downstream | `unitFlow.ts`, `unitBridge.ts`, `unitValue.ts` |
| `../tree/specs/values/error-values.md` | error codes, propagation and display | `errorValue.ts` |
| `../tree/specs/values/value-semantics.md` | null, NaN, infinity and errors per context, and reading an input (wired blank vs literal) | every `data()` |
| `../tree/specs/values/format-model.md` | the Format Controller's render pipeline, per-family controls and precision | `formatModel.ts`, `formatAnnotationStore.ts` |

## Documents

| Spec | Subsystem | Main code |
|---|---|---|
| `../tree/specs/documents/save-format.md` | the saved document, the text form, loading | `persistence.ts`, `textForm.ts`, `graphValidate.ts` |
| `../tree/specs/documents/table-popup.md` | the Table popup: modes, editing, write-back, the Form view, copy and export | `components/TablePopup.tsx`, `tablePopupStore.ts` |
| `../tree/specs/documents/reports-and-notes.md` | Notes, Reports and Knap: the body syntax, rendering, mail merge, vault writes, export | `knapTemplate.ts`, `nodes/report.ts`, `nodes/annotation.ts` |
| `../tree/specs/documents/addressable-model.md` | node names and name-addressed references | `nodeNameStore.ts`, `nodeNaming.ts` |
| `../tree/specs/documents/per-doc-autosave-persistence.md` | per-document autosave slots | `documentStore.ts` |
| `../tree/specs/documents/inline-literal-maps.md` | values edited on a card, and which classes restore them | node classes, `persistence.ts` |
| `../tree/specs/documents/literal-input-editors.md` | the table popup as the editor for literal sources | `TablePopup.tsx`, `columnHeadControls.tsx` |
| `../tree/specs/documents/graph-load-teardown-performance.md` | building and tearing down a large graph | `persistence.ts` `rebuildGraph`, `flow/FlowCanvas.tsx` |

## Canvas

| Spec | Subsystem | Main code |
|---|---|---|
| `../tree/specs/canvas/react-flow-surface-contract.md` | what React Flow owns, sub-flows, cables, sockets, overlays, ghost cables | `flow/*` |
| `../tree/specs/canvas/pointer-gestures.md` | pinch, pan, drag and their priority (with `tree/specs/canvas/touch-gestures.md`) | `pointerGesture.ts`, `flow/flowPinch.ts`, `flow/flowTouchPan.ts` |
| `../tree/specs/canvas/html-in-canvas.md` | the HTML-in-Canvas gesture layer | `htmlCanvasRenderer.ts`, `HtmlCanvasLayer.tsx` |
| `../tree/specs/canvas/cable-rendering-knobs.md` | cable shapes, ribbons and the walk router | `cablePaths.ts`, `flow/FlowCableEdge.tsx` |
| `../tree/specs/canvas/drawn-cables.md` | annotation cables drawn by hand | `drawnCables.ts`, `DrawnCableLayer.tsx` |
| `../tree/specs/canvas/auto-arrange-tidy.md` | Tidy and Cleanup | `tidyArrange.ts` |
| `../tree/specs/canvas/group-expand-push.md` | how expanding a group moves its neighbors | `groupPush.ts`, `groupPushCore.ts` |
| `../tree/specs/canvas/group-collapse.md` | what a collapsed group shows and hides | `groupCollapse.ts` |
| `../tree/specs/canvas/standoffs.md` | standoff constraints and their solver | `standoffs.ts`, `standoffSolver.ts`, `StandoffLayer.tsx` |
| `../tree/specs/canvas/conduit-lane-faces.md` | Conduit lane geometry | Conduit components |
| `../tree/specs/canvas/resizable-content-nodes.md` | cards whose content the user resizes | Conduit, Display |
| `../tree/specs/canvas/input-cable-pruning.md` | dropping cables before their sockets go | `components/cablePrune.ts` |
| `../tree/specs/canvas/composite-drill-in-mount-lifecycle.md` | opening and leaving a composite's inner canvas | `flow/FlowCompositeOverlay.tsx`, `flow/drillStack.ts` |
| `../tree/specs/canvas/add-menu.md` | the Add menu tree, search rows and scoring | `AddNodeMenu.tsx`, `catalogSearch.ts`, `nodeOps.ts` |
| `../tree/specs/canvas/layout-chrome.md` | where every bar and floating overlay sits, and what its offsets derive from | `Header.tsx`, `chromeBottom.ts`, the chrome CSS |
| `../tree/specs/canvas/touch-gestures.md` | the inventory of every pointer and touch gesture per device | `flow/*`, `pointerGesture.ts` |
| `../tree/specs/canvas/palette-and-theme.md` | palettes, slots, the neutral chrome ramp, document and report palettes, the accent and light or dark theme | `palette.ts`, `appTheme.ts`, `themeVars.ts` |
| `../tree/specs/canvas/command-palette.md` | the Command Palette: what it lists, search, and AI mode | `CommandPalette.tsx` |
| `../tree/specs/canvas/outline-panel.md` | the Navigator list: tree, filters, sorting, focusing | `OutlinePanel.tsx` |

## Integrations

| Spec | Subsystem | Main code |
|---|---|---|
| `../tree/specs/integrations/obsidian-plugin.md` | Solenoid Properties, the Obsidian plugin | `obsidian-plugin/` |
