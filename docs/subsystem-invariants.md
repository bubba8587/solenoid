# Solenoid — Subsystem invariants

The index of the subsystem specs. Each subsystem's mechanics live in `../specs/<name>.md`
(one spec per subsystem, serving the node it names); read the spec in full before touching
that subsystem. A section here is a pointer, never the mechanics.

## React Flow surface contract (`flow/FlowSurface.tsx`, `flow/FlowCanvas.tsx`, `flow/flowModel.ts`, `flow/flowView.ts`, `flow/FlowCableEdge.tsx`, `flow/FlowSocketHandle.tsx`)

`../specs/react-flow-surface-contract.md` — serves [[C43]] oneFlowSurface.

## Cable rendering knobs

`../specs/cable-rendering-knobs.md` — serves [[B10]] reactFlowView.

## Group expand push (`groupPush.ts` + `groupPushCore.ts`)

`../specs/group-expand-push.md` — serves [[B10]] reactFlowView.

## Group collapse — the retain rule (`groupCollapse.ts`)

`../specs/group-collapse.md` — serves [[B10]] reactFlowView.

## Equation solver (`equationSolve.ts`)

`../specs/equation-solver.md` — serves [[C47]] equationNode.

## Bordered-grid fill (`mathUtils.ts` `fillBorderedGrid`)

`../specs/bordered-grid-fill.md` — serves [[A5]] excelParity.

## Standoffs (`standoffs.ts`, `standoffSolver.ts`, `StandoffLayer.tsx`)

`../specs/standoffs.md` — serves [[C65]] domOrderStacking.

## Drawn cables (`drawnCables.ts`, `drawnCablePath.ts`, `components/DrawnCableLayer.tsx`, `components/DrawnCableCapture.tsx`, `components/DrawnCableInspector.tsx`)

`../specs/drawn-cables.md` — serves [[B10]] reactFlowView.

## Auto-arrange / Tidy (elkjs called directly — `tidyArrange.ts`)

`../specs/auto-arrange-tidy.md` — serves [[B10]] reactFlowView.

## Conduit lane faces

`../specs/conduit-lane-faces.md` — serves [[D17]] relaysTransparent.

## Resizable-content nodes (the Conduit pattern)

`../specs/resizable-content-nodes.md` — serves [[C37]] observerOwnsSize.

## Input-cable pruning — ONE loop (`components/cablePrune.ts`, onePrunePath)

`../specs/input-cable-pruning.md` — serves [[D10]] onePrunePath.

## Pointer gestures — pinch priority by listener PHASE (`pointerGesture.ts`, `flow/flowPinch.ts`, `flow/flowTouchPan.ts`)

`../specs/pointer-gestures.md` — serves [[C42]] htmlInCanvasRenderer.

## Add menu — catalog, search rows, and what a label may carry (`AddNodeMenu.tsx`, `catalogSearch.ts`, `nodeOps.ts`)

`../specs/add-menu.md` — serves [[D5]] searchWiderThanLabel.

## Socket lattice (`sockets.ts`)

`../specs/socket-lattice.md` — serves [[C10]] socketLattice.

## Type propagation on in-place socket retype (`fcReconcile.ts`)

`../specs/type-propagation-on-in-place-socket-retype.md` — serves [[D16]] retypeReconciles.

## Unit flow — the FC is VALUE-MUTATING; format is a display annotation (`unitFlow.ts`)

`../specs/unit-flow.md` — serves [[C25]] firstClassUnits.

## Error values (`errorValue.ts`)

`../specs/error-values.md` — serves [[C24]] arraySemantics.

## Alert node + Alerts HUD (`nodes/display.ts` AlertNode, `alertStore.ts`, `components/AlertLayer.tsx`, `HudStack.tsx`)

`../specs/alert-node-alerts-hud.md` — serves [[C39]] effectsEdgeTriggered.

## Addressable model (`nodeNameStore.ts`, `nodeNaming.ts`, `textForm.ts`)

`../specs/addressable-model.md` — serves [[C19]] namingModel.

## Live connections — cache + refresh (`connectionStore.ts`, `nodes/connection.ts`, `httpBridge.ts`)

`../specs/live-connections.md` — serves [[D32]] refreshOutsideRebuild.

## Graph load / teardown performance (`persistence.ts` `rebuildGraph`, `flow/FlowCanvas.tsx`)

`../specs/graph-load-teardown-performance.md` — serves [[C43]] oneFlowSurface.

## Per-doc autosave persistence (`documentStore.ts`, 2026-07-05)

`../specs/per-doc-autosave-persistence.md` — serves [[C32]] autosaveSlotOrder.

## Literal input editors — one popup surface (2026-09-07)

`../specs/literal-input-editors.md` — serves [[C28]] literalsIffEditable.

## Inline literal maps — declaration gates restore (2026-07-19)

`../specs/inline-literal-maps.md` — serves [[C28]] literalsIffEditable.

## Composite drill-in mount lifecycle (`flow/FlowCompositeOverlay.tsx`)

`../specs/composite-drill-in-mount-lifecycle.md` — serves [[C77]] compositeIsSubgraph.

## Script sandbox (`scriptWorker.ts`, `scriptExecutor.ts`, `nodes/scriptRun.ts`)

`../specs/script-sandbox.md` — serves [[C66]] scriptNode.

