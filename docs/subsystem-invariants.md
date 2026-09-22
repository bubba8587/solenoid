# Solenoid — Subsystem invariants

The index of the subsystem specs. Each subsystem's mechanics live in `../specs/<name>.md`
(one spec per subsystem; its first line names the leaves it serves); read the spec in full before touching
that subsystem. A section here is a pointer, never the mechanics.

## The floor specs (`covers:` globs)

`../specs/components.md` (every React component), `../specs/node-classes.md` (every node class and op
module), `../specs/stores.md` (every module-singleton store). Each ends its header with a `covers:`
glob; a file the glob matches is built to that spec and cites nothing class-wide itself.

## React Flow surface contract (`flow/FlowSurface.tsx`, `flow/FlowCanvas.tsx`, `flow/flowModel.ts`, `flow/flowView.ts`, `flow/FlowCableEdge.tsx`, `flow/FlowSocketHandle.tsx`)

`../specs/react-flow-surface-contract.md`.

## Cable rendering knobs

`../specs/cable-rendering-knobs.md`.

## Group expand push (`groupPush.ts` + `groupPushCore.ts`)

`../specs/group-expand-push.md`.

## Group collapse — the retain rule (`groupCollapse.ts`)

`../specs/group-collapse.md`.

## Equation solver (`equationSolve.ts`)

`../specs/equation-solver.md`.

## Bordered-grid fill (`mathUtils.ts` `fillBorderedGrid`)

`../specs/bordered-grid-fill.md`.

## Standoffs (`standoffs.ts`, `standoffSolver.ts`, `StandoffLayer.tsx`)

`../specs/standoffs.md`.

## HTML-in-Canvas gesture layer (`htmlCanvasRenderer.ts`, `components/HtmlCanvasLayer.tsx`, `rasterAtlas.ts`, `domSync.ts`, `zoomSettle.ts`)

`../specs/html-in-canvas.md`.

## Drawn cables (`drawnCables.ts`, `drawnCablePath.ts`, `components/DrawnCableLayer.tsx`, `components/DrawnCableCapture.tsx`, `components/DrawnCableInspector.tsx`)

`../specs/drawn-cables.md`.

## Auto-arrange / Tidy (elkjs called directly — `tidyArrange.ts`)

`../specs/auto-arrange-tidy.md`.

## Conduit lane faces

`../specs/conduit-lane-faces.md`.

## Resizable-content nodes (the Conduit pattern)

`../specs/resizable-content-nodes.md`.

## Input-cable pruning — ONE loop (`components/cablePrune.ts`, onePrunePath)

`../specs/input-cable-pruning.md`.

## Pointer gestures — pinch priority by listener PHASE (`pointerGesture.ts`, `flow/flowPinch.ts`, `flow/flowTouchPan.ts`)

`../specs/pointer-gestures.md`.

## Add menu — catalog, search rows, and what a label may carry (`AddNodeMenu.tsx`, `catalogSearch.ts`, `nodeOps.ts`)

`../specs/add-menu.md`.

## Socket lattice (`sockets.ts`)

`../specs/socket-lattice.md`.

## Type propagation on in-place socket retype (`fcReconcile.ts`)

`../specs/type-propagation-on-in-place-socket-retype.md`.

## Unit flow — the FC is VALUE-MUTATING; format is a display annotation (`unitFlow.ts`)

`../specs/unit-flow.md`.

## Error values (`errorValue.ts`)

`../specs/error-values.md`.

## Alert node + Alerts HUD (`nodes/display.ts` AlertNode, `alertStore.ts`, `components/AlertLayer.tsx`, `HudStack.tsx`)

`../specs/alert-node-alerts-hud.md`.

## Addressable model (`nodeNameStore.ts`, `nodeNaming.ts`, `textForm.ts`)

`../specs/addressable-model.md`.

## Live connections — cache + refresh (`connectionStore.ts`, `nodes/connection.ts`, `httpBridge.ts`)

`../specs/live-connections.md`.

## Graph load / teardown performance (`persistence.ts` `rebuildGraph`, `flow/FlowCanvas.tsx`)

`../specs/graph-load-teardown-performance.md`.

## Per-doc autosave persistence (`documentStore.ts`, 2026-07-05)

`../specs/per-doc-autosave-persistence.md`.

## Literal input editors — one popup surface (2026-09-07)

`../specs/literal-input-editors.md`.

## Inline literal maps — declaration gates restore (2026-07-19)

`../specs/inline-literal-maps.md`.

## Composite drill-in mount lifecycle (`flow/FlowCompositeOverlay.tsx`)

`../specs/composite-drill-in-mount-lifecycle.md`.

## Script sandbox (`scriptWorker.ts`, `scriptExecutor.ts`, `nodes/scriptRun.ts`)

`../specs/script-sandbox.md`.

## Solenoid Properties, the Obsidian plugin (`obsidian-plugin/`, 2026-09-20)

`../specs/obsidian-plugin.md`.

