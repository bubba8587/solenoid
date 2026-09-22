<!-- [[C43]] oneFlowSurface -->

# Spec: React Flow surface contract

Serves [[C43]] oneFlowSurface. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

The canvas is drawn by React Flow (RF) over a headless rete model ([[B10]] reactFlowView). RF owns the screen: node wrappers, the edge layer, selection, dragging, the camera. The rete model owns the graph: nodes, connections, absolute positions, values. This spec says which side owns what, and how values cross the seam between them.

## One surface for both canvases

The main canvas (`FlowCanvas`) and the composite drill-in (`FlowCompositeOverlay`, the view you get by opening a composite node) render the same `FlowSurface` over a `SurfaceStack` ([[C43]] oneFlowSurface). The two hosts differ only through `SurfaceHooks`: what settles a move, which history answers undo, what Delete removes, whether standoffs and drawn cables render, and similar named switches.

- Anything that belongs to the surface goes in `FlowSurface`, never in one host. That covers gestures, menus, keys, layers and installers. A behavior installed in one host is a behavior the other silently lacks.
- The top-bar chrome calls commands through slots in `canvasCommands.ts`. While a drill-in is open it swaps four of them to point at its own level and restores them on unmount: `swapSelectionSlots` (select, unselect all), `swapArrangeSlots` (Tidy and Cleanup), `swapDeleteSlot` (the delete button used on touch, where there is no Delete key) and `swapRepositionDockedSlot` (re-seating a docked Format Controller). A new slot that the drill-in should own needs its own `swap*` function here, or the command silently acts on the main canvas.
- Code that runs for one node finds its graph with `getOwningEditor` / `getOwningView`. Chrome finds the graph the user is looking at with `getActiveEditor` / `getActiveView`. The bare `getEditor()` / `getView()` are only for persistence and main-only lifecycle code ([[C33]] saveBindsMain).
- Two mounted flows must carry different RF `id`s (`hooks.rfId`), because RF derives every internal pattern, marker and aria id from it. The main canvas uses `main`, the drill-in `drill`, the landing graph `landing`, and each landing scene card `scene` plus a React `useId`.

## The `View` seam and positions

`process.ts` holds the live `_editor`, `_engine` and `_view`. `processGraph()` recomputes; the model pass itself lives in `graphCompute.ts`, shared with the composite engine, the CLI and the tests.

`_view` is `flow/flowView.ts`, the one implementation of the `View` interface in `view.ts`. It offers:

- `position(id)`, `nodeElement(id)`, `connectionElement(id)`, `hasNode(id)`;
- the camera: `transform`, `zoom`, `pan`, `viewport`;
- `moveNode`, `rerenderNode`, `rerenderCables` and `onRender`.

A node's absolute position lives on the node itself (`node.position`). The model layer stamps it on every add path, so there is no side map and nothing to reconcile. `nodeElement` looks up the live DOM element on every call, so a per-frame loop should cache the result locally.

`view.moveNode(nodeId, …)` is async and never lands in the same paint as a React commit. If a size change would need a matching position change in the same frame, restructure so it doesn't (`specs/resizable-content-nodes.md`).

`SolenoidConnection` takes `ClassicPreset.Node` as its type parameter; a narrower node type fails on variance.

## Groups are sub-flows

A group is an RF parent node, and each member sets `parentId` to it. The model keeps absolute positions; RF holds a member's position relative to its group and tows members itself. Conversion happens only at the boundary: `flowModel.toFlowPosition` / `fromFlowPosition`, `handlers.moveNode` and `onNodesChange`. Never write a member's RF position from absolute coordinates. The full rules are in `specs/group-expand-push.md`.

## An open group's interior is working canvas

The inside of an expanded group behaves like empty canvas, not like a handle for dragging the group.

- `flowModel.nodeClassName` gives an expanded group's wrapper the class `sol-group-open`, and flow.css makes that wrapper `pointer-events: none !important` (the same pattern the Conduit uses).
- The parts that should take presses claim their own pointers in GroupNode.css: the header, the grip, and four `solenoid-group__band` strips along the dashed edge. Each strip is 18px wide and straddles the edge, 4px outside and 14px inside.
- While the group is selected, its whole body takes pointers again, so a selected group drags by its face.
- Every other press inside the group falls through to the pane: pan, lasso, cable hits and the canvas context menu.
- A collapsed group gets no such class and stays draggable everywhere.

## What RF owns

- **Delete, selection and right-click.** RF handles Delete and Backspace (`deleteKeyCode` plus `onBeforeDelete`), selection (`useOnSelectionChange`) and context-menu routing (`onNodeContextMenu`, `onEdgeContextMenu`, `onPaneContextMenu`). The app's commands run from those callbacks. Don't add a second window listener for any of them. `deleteKeyCode` is null while the canvas is locked or the host sets `noKeyboard`.
- **Settings that are off on purpose.** RF's own arrow-key move is off (`disableKeyboardA11y`), because the canvas keyboard nudges the selection on the dot grid. RF's box select is off (`selectionKeyCode={null}`), because shift-drag belongs to the lasso. Double-click zoom is off (`zoomOnDoubleClick={false}`, see `docs/touch-gestures.md`). `zoomOnScroll` is off, because `installWheelZoom` is the one wheel path. `zIndexMode="manual"`.
- **Locking.** A locked canvas passes `nodesDraggable`, `nodesConnectable` and `elementsSelectable` all false; the CSS half of locking is in `specs/pointer-gestures.md`.
- **A node wrapper's inline `visibility`.** RF writes `visible` onto `.react-flow__node` after measuring, so any imperative visibility write there is silently overwritten. Per-node hide and show rides RF's `className` instead (`flowModel.nodeClassName` plus an `!important` rule in flow.css). Hiding the members of a collapsed group is the standing example (`specs/group-collapse.md`).
- **Stacking.** Each node's stacking is its RF `zIndex`, from `flowModel.nodeZIndex`: groups −2, Conduits −1, everything else 0 ([[C65]] domOrderStacking).

## Cables

A cable renders as an SVG `<g>` inside RF's shared edge SVG (`FlowCableEdge.tsx`).

- The visible strokes are `pointer-events: none`. The one hit target is the named `.solenoid-cable-hit` path, which carries `data-conn-id`.
- RF's own interaction path stays disabled (`interactionWidth: 0`). Left on, it catches `closest()` lookups before the hit path does.
- Routing and ribbons are in `specs/cable-rendering-knobs.md`.

Starting a cable drag blurs the focused field first (`onConnectStart`), so a value that is mid-edit commits before it is wired. Rely on this; don't re-implement it.

## Sockets

The socket box is always exactly 12×12 ([[C11]] socketBox12): `display: block; line-height: 0`, a global rule in `nodeCard.css`.

- The RF `Handle` wraps the socket glyph (`FlowSocketHandle.tsx`, reset by `.sol-rf-handle-reset`). RF measures the handle's box for cable endpoints and uses its outer edge at mid-height.
- Every cable drawer then pulls that end `SOCKET_OVERLAP` (2px, via `intoSocket` in `cablePaths.ts`) into the glyph. A stroke that only touches the half-pixel handle edge leaves a lighter seam. Edges paint under nodes, so the overlap is hidden. Collapsed-group pills and Conduit lanes compute their own points and skip this.
- Every socket anchors to `.solenoid-node__content`, which excludes the header, so socket positions don't depend on the header.
- Vertical placement is measured per row (`MeasuredSocketRow`), never a fixed constant.
- The dot straddles the card edge with `left: -5` / `right: -5`, positioned against `__content`. Don't make the io-row or `__body` a positioning context.
- A Conduit's socket tips come from `conduitLaneOffset`, not from the measured handle (`specs/resizable-content-nodes.md`).

## Flipped sockets

A node can flip its sockets to the opposite side, inputs on the right and outputs on the left.

- **State.** `socketFlipStore` holds a per-node set, shaped like `collapseStore`. It saves per node as `SavedNode.flipped` through the text form's `positions` and is restored in `rebuildGraph`.
- **Which nodes.** A node type opts in through `flippableNodes.ts` (`isFlippableNode`, tested by constructor name). The right-click menu then shows Flip or Unflip. Display is the first node to opt in.
- **Visual only.** Three places read the flip, and each swaps only the visual side, never a Handle's `type`. Target and source stay semantic, so connection legality and cable direction are unchanged.
  - `NodeSocket` swaps the CSS `left` / `right`.
  - `FlowSocketHandle` swaps the RF `Position`.
  - `FlowCableEdge` swaps each endpoint's `CablePosition` passed to `getCablePath`, so the outward stub leaves from the correct edge. A flipped output exits to the left and a flipped input enters from the right.
- `data-socket-side` stays semantic. DOM lookups find sockets by the measured dot, so they follow the flip with no extra work.
- Toggling calls `rerenderNode`, so RF re-measures the moved handles.

## World-coordinate overlays

An overlay drawn in graph coordinates renders inside RF's `<ViewportPortal>`, which RF places inside the transformed viewport after the edge and node layers. Every surface mounts `PendingCableLayer`; `StandoffLayer` and `DrawnCableLayer` mount only when the host's `standoffs` / `drawnCables` hooks are on, which only the main canvas does. A sibling of `<ReactFlow>` would paint in screen space and not move with the camera.

## Ghost cables

A ghost cable is a cable drawn dashed to show it is not yet valid or not yet real. There are two mechanisms, chosen by whether a real connection survives.

- **Option A: the connection survives** (`cableGhostStore`, keyed by a live connection id). The rete connection is real and is only drawn dashed until it is valid or adopted. Two cases produce it: a node spliced out of a chain, and an in-place socket retype that stays wired.
- **Option B: the connection is dropped** (the Input Switch pending reconnect: `cablePendingStore` and `cablePendingReconnect.ts`). The Input Switch's One/Many toggle retypes its `out` socket, and `retypeOutputCables` drops the downstream cables the new type can't feed, so there is no connection left to draw dashed.
  1. Before the retype, `snapshotOutgoing` records the cables leaving `out`.
  2. After it, each cable that disappeared (and whose target node still exists) is recorded as a pending ghost keyed by source, output, target and input, along with the target input's label.
  3. Whenever the output type fits that input again, the ghost becomes a real cable: the same input key if it is back, otherwise an input with the same label. In One mode the output is `trueany`, which fits every socket, so flipping back reattaches all of them.
  4. `PendingCableLayer` draws each pending ghost dashed, in the Option A stroke, from RF's measured handle bounds, since no edge exists to carry it.
  5. Nothing is saved. `registerNodeForget` / `registerNodeForgetAll` clear a ghost when either of its nodes is removed, and on every load.
  `cablePendingReconnect.test.ts` pins this behavior.

## Controls inside cards

- A native form popup inside a node keeps its `pointerdown` / `mousedown` `stopPropagation`. The stop also prevents a node drag (`stopDragStart` in `specs/pointer-gestures.md`).
- A controlled `<select>` gets its value from `useState` and mirrors it to the node in the change handler. Never refresh it through a `useReducer` forceUpdate.

## Error boundaries

Every render is inside an error boundary (`components/ErrorBoundary.tsx`): one at the app root and one around each card (`SolNodeAdapter`). An app-level throw shows the message and component stack with a Copy button. A single bad card shrinks to a small red box while the rest of the canvas keeps working. When a black screen is reported, ask for the copied text first.

## Load performance

Two mechanisms keep loads fast (`specs/graph-load-teardown-performance.md`). The topology pipe merges a rebuild into one React commit. `syncTopology` keeps each surviving node's object identity, so RF's memo skips cards that didn't change.

## Chart figures

A figure on a `chart` socket carries data, not geometry, and lays itself out at its measured width (`docs/v2.0/25-gantt.md` § 6.3; the Gantt is the first figure that isn't a single `<svg>`).

- The value on the cable is flat JSON, a `ChartPayload`.
- The same figure draws at four sizes: the card's [Chart] chip, the resizable Display (with a size cap), the popup, and a Report embed. None of them uses a pre-rendered pixel frame.
- `ChartFigure` (`chartView.tsx`) is the one dispatcher. The popup passes `virtualize`, which renders only the visible rows.

**Export SVG seam.** Most figures export by scraping their largest DOM `<svg>`. A figure whose drawing is not one `<svg>` (the Gantt draws an HTML tree grid beside one banded SVG per row) registers its own serializer with `registerChartSvgProvider` (`canvasCapture.ts`), keyed by the host node it draws in. The on-canvas Display registers one; the short-lived popup does not. The webpage export (`captureChartSvgs`) and the Write-to-Obsidian image both ask the provider first (`nodeChartSvgProvided`) for a whole-chart SVG string (`ganttSvg`), and fall back to the largest `<svg>` only when there is none.
