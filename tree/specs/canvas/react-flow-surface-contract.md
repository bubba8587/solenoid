---
aliases: ["React Flow surface contract"]
tags: [spec, canvas]
---
<!-- [[C43]] oneFlowSurface, [[B10]] reactFlowView, [[C65]] domOrderStacking, [[C52]] visibleSelection, [[D41]] formatFlowsDownstream -->

# Spec: React Flow surface contract

Serves [[C43]] oneFlowSurface. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

The canvas is drawn by React Flow (RF) over a headless rete model ([[B10]] reactFlowView). RF owns the screen: node wrappers, the edge layer, selection, dragging, the camera. The rete model owns the graph: nodes, connections, absolute positions, values. This spec says which side owns what, how values cross the seam between them, and what the one shared surface does: its keyboard, its selection, deletion, copy and paste, Format Controller docking, isolate, and undo.

## One surface for both canvases

The main canvas (`FlowCanvas`) and the composite drill-in (`FlowCompositeOverlay`, the view you get by opening a composite node) render the same `FlowSurface` over a `SurfaceStack` ([[C43]] oneFlowSurface). The two hosts differ only through `SurfaceHooks`.

- Anything that belongs to the surface goes in `FlowSurface`, never in one host. That covers gestures, menus, keys, layers and installers. A behavior installed in one host is a behavior the other silently lacks.
- The top-bar chrome calls commands through slots in `canvasCommands.ts`. While a drill-in is open it swaps four of them to point at its own level and restores them on unmount: `swapSelectionSlots` (select, unselect all), `swapArrangeSlots` (Tidy and Cleanup), `swapDeleteSlot` (the delete button used on touch, where there is no Delete key) and `swapRepositionDockedSlot` (re-seating a docked Format Controller). A new slot that the drill-in should own needs its own `swap*` function here, or the command silently acts on the main canvas. The `setClearHistory` slot must run after every document load or rebuild, or Ctrl+Z unwinds the load itself.
- The "open the Add menu here" request (`addMenuRequest`, used by the command palette, the top bar's + and the `A` key) nests the same way: the drill-in's registration replaces the main canvas's while open and restores it on close.
- Code that runs for one node finds its graph with `getOwningEditor` / `getOwningView`. Chrome finds the graph the user is looking at with `getActiveEditor` / `getActiveView`. The bare `getEditor()` / `getView()` are only for persistence and main-only lifecycle code ([[C33]] saveBindsMain).
- Two mounted flows must carry different RF `id`s (`hooks.rfId`), because RF derives every internal pattern, marker and aria id from it. The main canvas uses `main`, the drill-in `drill`, the landing graph `landing`, and each landing scene card `scene` plus a React `useId`.

### The stack and its handlers

A `SurfaceStack` is a flow model plus its `view` and a set of `SurfaceHandlers`. The handlers are late-bound: each mount binds them and they fall back to no-ops (`idleHandlers`), so a stack can exist before, and across, mounts. They are `bumpNode`, `bumpConnections`, `bumpAllNodes` (re-render every card after a completed composite pass), `moveNode`, `setViewport`, `getContainer`, `syncTopology` and `syncSelection` (re-derive RF's `selected` from the model flags after a verb wrote them). `isRebuilding` reports a host-level rebuild (a drill-in hydrate or restore), during which live-creation behaviors such as group absorption stand down.

### The hooks

| Hook | What it does |
|---|---|
| `rfId` | The RF instance id; distinct per mounted flow. |
| `className` | Extra wrapper classes (the drill-in host). |
| `history` | The undo and redo this surface answers. |
| `deleteSelected` | What Delete removes: the shared `deleteSelection` verb under the host's `DeleteScope` (below). |
| `afterMove` | A drag settled; the host records position, size and membership. |
| `afterProgrammaticMove` | A programmatic move landed (nudge, push, standoffs); record only. |
| `afterNodeAdded` | A node was added from the Add menu and positioned. |
| `afterConnect` | A cable was wired. |
| `standoffs` | Render the standoff layer. Main canvas only. |
| `drawnCables` | Render the drawn-cable layer and its tool. Main canvas only, because drawn cables persist in `SavedGraph`, which binds to the main graph ([[C33]] saveBindsMain). |
| `standsDownWhenDrilled` | The main canvas's keyboard stands down while a drill-in is open (the drill-in installs its own). |
| `noKeyboard` | Skip the canvas keyboard entirely: no F9, Ctrl+S or O, palette, nudge, copy and paste, group verbs or Delete. The landing and showcase mounts run the canvas for its gestures alone. |
| `noContextMenu` | Suppress every right-click menu, the native one included. It also kills `contextmenu` at the DOM in the capture phase, because a touch long-press is not reliably seen by `onPaneContextMenu` and would otherwise raise the Add menu or the native menu. |
| `locked` | View-only (no drag, connect, select or delete) on top of the global `canvasLockStore`. A landing scene card locks itself so it stays a static, precomputed showcase. |
| `staticView` | No camera gestures either: no pan, no wheel or pinch zoom, and the page scrolls over the card instead of the card taking the wheel. For a fixed illustration framed once by `fitViewOnInit`; pair it with `locked`. |
| `fitViewOnInit` | Frame the graph once the first mounted cards have measured. |
| `onEscape` | Escape with nothing of the surface's own open (a menu, isolate, an overlay). |

**Framing on init.** RF's own `fitView` prop resolves on the first `setNodes`, but the surface mounts empty and fills after the host hydrates. So `fitViewOnInit` waits for RF's `useNodesInitialized()`, frames the bounds of all nodes once, and floors the zoom to a snap step.

## The `View` seam and positions

`process.ts` holds the live `_editor`, `_engine` and `_view`. `processGraph()` recomputes; the model pass itself lives in `graphCompute.ts`, shared with the composite engine, the CLI and the tests.

`_view` is `flow/flowView.ts`, the one implementation of the `View` interface in `view.ts`. Model-side verbs become RF state through late-bound callbacks the surface supplies, and the surface writes back what RF reports: the viewport (from `onMove`), the pointer's canvas position, and each card's measured size (from `onNodesChange` dimension changes). The view offers:

- `position(id)`, a live read of `node.position`, undefined for an id the view's editor doesn't hold; `hasNode(id)`, the "belongs to this surface" test;
- `nodeElement(id)`, the live RF node wrapper, and `connectionElement(id)`, the live edge group;
- the pane (`container`) and the transformed content element (`viewport`);
- the camera: `transform`, `zoom` (set the scale, then add an offset to the pan: the anchored-zoom step), `pan`, and `pointer`, the last pointer position in canvas coordinates;
- `moveNode`, `rerenderNode`, `rerenderCables` and `onRender` (per-card re-render events, which the HTML-in-Canvas layer uses to re-capture);
- `measured(id)`, RF's post-layout size with no DOM read, undefined until measured ([[D64]] oneSizeRead).

Positions are always absolute canvas coordinates, never RF's parent-relative ones. A node's absolute position lives on the node itself (`node.position`). An add path sets it right after `addNode` (`flowModel.addNode` before, most others through `view.moveNode` after), so there is no side map and nothing to reconcile. `nodeElement` looks up the live DOM element on every call, so a per-frame loop should cache the result locally.

`view.moveNode(nodeId, …)` is async and never lands in the same paint as a React commit. If a size change would need a matching position change in the same frame, restructure so it doesn't ([[resizable-content-nodes]]).

`SolenoidConnection` takes `ClassicPreset.Node` as its type parameter; a narrower node type fails on variance.

## The flow model

`flow/flowModel.ts` builds the headless model: a rete `NodeEditor` and `DataflowEngine` with the coercion and error guards installed, its edit verbs, and the projections RF reads. The projections are RF-shaped without importing RF, so they stay testable in the node test environment.

- `canConnect` / `connect` are the user's connection gate: the socket lattice rule plus no self-loop, and a single-connection input evicts its existing cable first. RF's connect and quick-wire go through them. Programmatic rewires (paste, ghosts, Conduit insert, the FC splice) still call `editor.addConnection` directly and rely on their own sources being valid.
- Removing nodes removes their cables through the editor, and their names go too.
- `toFlowNodes` lists parents before their children, as RF requires.

## Groups are sub-flows

A group is an RF parent node, and each member sets `parentId` to it. The model keeps absolute positions; RF holds a member's position relative to its group and tows members itself. Conversion happens only at the boundary: `flowModel.toFlowPosition` / `fromFlowPosition`, `handlers.moveNode` (where moving a group re-bases every member, so a Tidy that moves members before their group still ends consistent) and `onNodesChange` (which applies RF-driven moves to the model, groups first, so a member resolves against its group's new spot). Never write a member's RF position from absolute coordinates.

`SolenoidNode.position` is the node's absolute canvas position. The model layer stamps it when the node is added; no node class declares it, and it is optional in the type only for the instant before the stamp. Write it only through `View.moveNode` or `flowModel.moveNode`.

- A membership rebuild re-projects the nodes; it keeps object identity, so only re-parented cards re-render.
- During a group drag, the model's member positions follow the group by its per-frame delta, collapsed groups included, since RF tows hidden member children either way. Selected members are skipped, because RF already moves them as part of the selection.
- A node created live (the Add menu, paste) inside an expanded group's box joins it once the card has rendered, since containment needs its size. The pipe that does this is installed once per stack, because `editor.addPipe` cannot be removed, and it stands down during a rebuild.

The full rules are in [[group-expand-push]].

## An open group's interior is working canvas

The inside of an expanded group behaves like empty canvas, not like a handle for dragging the group.

- `flowModel.nodeClassName` gives an expanded group's wrapper the class `sol-group-open`, and flow.css makes that wrapper `pointer-events: none !important`. The `!important` is needed because RF stamps `pointer-events: all` inline on every selectable wrapper.
- The parts that should take presses claim their own pointers in GroupNode.css: the header, the grip, and four `solenoid-group__band` strips along the dashed edge. Each strip is 18px wide and straddles the edge, 4px outside and 14px inside.
- While the group is selected, its whole body takes pointers again, so a selected group drags by its face.
- Every other press inside the group falls through to the pane: pan, lasso, cable hits and the canvas context menu.
- A collapsed group gets no such class and stays draggable everywhere.

A Conduit gets the same treatment: its node box is a fixed 92 square around a much smaller block, and an invisible box that took pointers would out-rank the cables, standoffs and canvas under it. So the wrapper is pointer-transparent and the painted shell shapes and lane squares claim their own pointers (conduit.css). A compressed lane (`solenoid-conduit__lane--inert`) also turns off the RF Handle inside it, which RF's connectable rules would otherwise re-arm.

## What RF owns

- **Delete, selection and right-click.** RF handles Delete and Backspace (`deleteKeyCode` plus `onBeforeDelete`), selection (`useOnSelectionChange`) and context-menu routing (`onNodeContextMenu`, `onEdgeContextMenu`, `onPaneContextMenu`). The app's commands run from those callbacks. Don't add a second window listener for any of them. `deleteKeyCode` is null while the canvas is locked or the host sets `noKeyboard`.
- **Settings that are off on purpose.** RF's own arrow-key move is off (`disableKeyboardA11y`), because the canvas keyboard nudges the selection on the dot grid, and RF's version needs a focused card and steps 5px. RF's box select is off (`selectionKeyCode={null}`), because shift-drag belongs to the lasso. Double-click zoom is off (`zoomOnDoubleClick={false}`, see [[touch-gestures]]). `zoomOnScroll` is off, because `installWheelZoom` is the one wheel path. `zIndexMode="manual"`.
- **Locking.** A locked canvas passes `nodesDraggable`, `nodesConnectable` and `elementsSelectable` all false; the CSS half of locking is in [[pointer-gestures]].
- **A node wrapper's inline `visibility`.** RF writes `visible` onto `.react-flow__node` after measuring, so any imperative visibility write there is silently overwritten. Per-node hide and show rides RF's `className` instead (`flowModel.nodeClassName` plus an `!important` rule in flow.css). Hiding the members of a collapsed group is the standing example ([[group-collapse]]). The surface re-stamps the classes whenever the collapse store notifies, because a collapse toggle changes no topology and `syncTopology` never runs for it.
- **Stacking.** Each node's stacking is its RF `zIndex`, from `flowModel.nodeZIndex`: groups −2, Conduits −1, everything else 0 ([[C65]] domOrderStacking). Without it a group's body sits level with its members and takes their pointer events.
- **Card sizes.** A grip resize (`resizing` set on the dimension change) stays out of RF state: the model sizes the card and RF only measures it. RF's own measures feed the DOM-free size source.

## The dot grid

`snapToGrid` uses `[DOT_SPACING, DOT_SPACING]` (24), the lattice the arrow-key nudge also uses. RF paints each background dot at `gap/2 − size/2` inside its tile, so `DOT_OFFSET = DOT_SIZE/2 − DOT_SPACING/2` (with `DOT_SIZE` 2) slides the pattern until a dot sits on every multiple of `DOT_SPACING`. Objects handed to `<ReactFlow>` (the snap grid, node and edge types, minimap style, delete keys) live at module scope, because a fresh reference per render re-renders the flow.

## Pane and wrapper styling

- `.sol-rf-appcanvas` is the app-canvas layer. The dock and drill-in rules (ReportOverlay.css, InspectorPanel.css, compositeEditor.css) size and hide the canvas by this class.
- The pane's cursor is a plain pointer at rest and the grab-hand only while panning; RF defaults to `grab` everywhere, which reads as always about to pan. A locked canvas keeps `grab`, since panning is then the only gesture. flow.css loads after RF's stylesheet, so these rules override RF's.
- The layer sets `touch-action: none` (with no text selection and no touch callout), handing every touch gesture to the canvas. Without it the browser takes touch moves as page scroll and zoom. Field taps and focus still work.
- RF's MiniMap wears the app's `.solenoid-minimap` window: its own margin and inset yield to the window's measured position, and its svg is transparent so the overlay background reads through.
- A card sizes itself (NodeCard sets its width), so RF's wrapper adds no visible box. A node type with no registered component draws the generic fallback card `SolFlowNode`, with crude value previews (`flow/preview.ts`; containers read like the chips, rows × cols Name).

## Cables

A cable renders as an SVG `<g>` inside RF's shared edge SVG (`FlowCableEdge.tsx`).

- The visible strokes are RF `BaseEdge`s styled inline, because RF's edge CSS would otherwise recolor a selected path. They are `pointer-events: none`. The one hit target is the named `.solenoid-cable-hit` path, which carries `data-conn-id`.
- RF's own interaction path stays disabled (`interactionWidth: 0`). Left on, it sits over the hit path and catches `closest()` lookups and context-menu targeting first.
- The cable being dragged from a socket (`FlowConnectionLine`) uses the same router and type color as a live cable; RF's default is a plain bezier in a fixed color. It leaves the origin socket on the side its handle faces (`draggedCableArgs`), so a flipped socket's drag leaves the other way, and the pointer end faces back at it: from a plain output it leaves rightward toward the pointer; from an input the pointer end is the source and it arrives at the socket.
- Routing and ribbons are in [[cable-rendering-knobs]].

Starting a cable drag blurs the focused field first (`onConnectStart`), so a value that is mid-edit commits before it is wired. Rely on this; don't re-implement it. The drag also lights the origin socket for its duration, and the canvas root wears `solenoid-canvas--cabling` from pickup to drop: socket.css grows every socket's catch zone and re-arms mobile's drop targets off that class. The socket a dragged cable would land on (RF snaps within `connectionRadius`) lights once the pair validates.

Every live cable change, including the ones components make themselves, settles through the cable-change pipe: FC retype reconcile, the unit-mismatch rescan, and a targeted recompute. A cable dropped on empty canvas can open the Add menu instead (quick-wire, [[add-menu]]).

## Sockets

The socket box is always exactly 12×12 ([[C11]] socketBox12): `display: block; line-height: 0`, a global rule in `nodeCard.css`. The one exception under C11 is the Conduit's lane squares, sized to the lane geometry, whose tips are computed rather than measured.

- The RF `Handle` wraps the socket glyph (`FlowSocketHandle.tsx`, reset by `.sol-rf-handle-reset`). RF measures the handle's box for cable endpoints and uses its outer edge at mid-height.
- The reset Handle is `position: relative`, not `static`. The socket wrapper's pointer-catch halo (`[data-socket-side]::before` in socket.css) is a positioned box, so a static Handle paints under it, the wrapper swallows the press, and RF starts a node drag instead of a cable.
- Every cable drawer then pulls that end `SOCKET_OVERLAP` (2px, via `intoSocket` in `cablePaths.ts`) into the glyph. A stroke that only touches the half-pixel handle edge leaves a lighter seam, because two anti-aliased edges never sum to a solid pixel. 2px is under every glyph, the hollow "any" ring's stroke band included. Edges paint under nodes, so the overlap is hidden. Collapsed-group pills and Conduit lanes compute their own points and skip this.
- Every socket anchors to `.solenoid-node__content`, which excludes the header, so socket positions don't depend on the header.
- Vertical placement is measured per row (`MeasuredSocketRow`), never a fixed constant.
- The dot straddles the card edge with `left: -5` / `right: -5`, positioned against `__content`. Don't make the io-row or `__body` a positioning context.
- A Conduit's socket tips come from `conduitLaneOffset`, not from the measured handle ([[conduit-lane-faces]]).
- The card adapter (`SolNodeAdapter`) calls RF's `updateNodeInternals` whenever a card's version bumps, since a bump can mean swapped or retyped sockets. Its `emit` is a stub, because on this surface only `NodeSocket` consumes it and `NodeSocket` renders an RF Handle.

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

An overlay drawn in graph coordinates renders inside RF's `<ViewportPortal>`, which RF places inside the transformed viewport after the edge and node layers. Every surface mounts `PendingCableLayer`; `StandoffLayer` and `DrawnCableLayer` mount only when the host's `standoffs` / `drawnCables` hooks are on, which only the main canvas does. A sibling of `<ReactFlow>` would paint in screen space and not move with the camera. The armed drawn-cable tool is the exception: its capture sheet is screen-space, and because the pane never sees its presses, it pans the camera itself through a screen-space nudge on the surface ([[drawn-cables]]).

## Selection

RF's selection is the selection. `useOnSelectionChange` mirrors it into the model's `selected` flags, which chrome and components read off the node payload, and into the cable store (`cableSelectionStore`, read by the Cable inspector, the delete verbs and the edge's selected color). The other direction holds too: a cable selected on the app side (its hit path, a run selection) is selected in RF, and the update keeps object identity so untouched edges skip re-rendering.

- Node and cable selection are mutually exclusive with each other in the chrome's verbs, and drawn-cable, standoff and isolate-endpoint selection are each exclusive with all the rest.
- Every selection surface reaches only what the user can see ([[C52]] visibleSelection): Ctrl+A selects every node not hidden in a collapsed group and not receded by isolate, and creating a group from the selection skips hidden members. Collapsing a group drops its hidden members from the selection (`setGroupsCollapsed`), and entering isolate drops the receded cards (`isolate.ts`), so Delete, nudge and copy never act on an invisible card.
- In touch-select mode (see [[pointer-gestures]]) RF's multi-selection flag is held and pane-drag panning yields to the lasso.

## Context menus

RF reports which layer a right-click hit (node, edge or pane), and `canvasContextMenu.ts` resolves the app's finer targets. It is one native `contextmenu` path; a touch long-press is the browser's own synthesis of it ([[touch-gestures]]).

- A socket resolves first, on the node and pane menus alike, because its dot straddles the card edge and can sit on either. The target is the socket under the pointer, or the nearest one within a small radius, since the dot is about 12px and a press can land beside it.
- An actively edited field keeps the browser's own menu.
- **Cable menu.** It acts on the whole multi-selection when the clicked cable is part of it, else on just that cable; ribbons expand to their member lanes either way. A ghost cable gets no menu.
- **Node menu.** There is no selection surgery on right-click: the menu acts on the selection only if it contains the clicked node, else on that node alone. It offers Pin for a group or a node with outputs that is not a Conduit or a Format Controller; Link with Standoff when exactly two linkable nodes are selected, one of them the clicked node, and they are not already linked (linkable excludes Conduits, FCs, group members and docked nodes; see [[standoffs]]); Flip for a flippable node; and Lock position for a group.
- **Pane menu.** The Add menu; suppressed while isolating.

## The canvas keyboard

`installCanvasKeyboard` (`canvasKeyboard.ts`) is installed by the surface, once per surface, as a `window` keydown listener over that surface's refs. The drill-in installs its own; the main canvas stands down while a drill-in is open (`standsDownWhenDrilled`).

The gates run in this order:

1. While the compute overlay is up (`computeOverlayStore`), every key returns. The overlay blocks pointer input, and the keyboard too, so a queued key can't mutate the graph mid-pass. This is the only gate that outranks F9.
2. The main canvas under an open drill-in returns, except F9.
3. Presenting returns, except F9; otherwise the arrow keys would nudge a still-selected node on the hidden canvas.
4. A key under a modal or pop-up (`keyUnderModal`, the modal guard) returns, except F9: Enter in a confirm must not also open the palette, and `A` under a Frame Input pop-up must not open the Add menu.
5. A key whose target has a `.nokeys` ancestor returns, except F9 ([[pointer-gestures]]).
6. F9 recomputes. It stays live while typing, presenting, drilled in and under a modal, where it is the only remaining recompute path.
7. The armed draw tool is modal: outside a field and without Ctrl or Cmd, Escape disarms it, Enter finishes the run and Backspace drops the last point, before the palette and isolate can claim those keys.
8. A locked canvas is view-only: the keys that move, add or remove stand down (Delete, nudge, paste, Tidy, Cleanup, group create, composite create, autofit, expand and collapse, `[` and `]` rotation, undo and redo), and the Add menu does not open from any entry point, while the view keys (palette, isolate, chrome, Tab, F9) keep working.

Bare keys, outside a field and without a modifier:

- **Delete or Backspace** with a selected drawn cable or standoff runs the app's delete. Neither is RF's selection, so RF never fires its delete hook for them.
- **Enter** opens the command palette, unless the Add menu is open. The field gate means committing a field never opens it.
- **Escape** while isolating exits isolate.
- **Arrows** nudge the selection by `DOT_SPACING`, four times that with Shift (handled before the Shift split). Each affected node moves exactly once. The move set is expanded so a standoff cluster moves whole, because nudging one end and then re-settling would pull it halfway back. A docked FC rides with its host, standoffs settle, and an autosave is scheduled. With nothing selected an arrow does nothing at all. The nudge is async, so the key handler decides `preventDefault` from a synchronous selection check.
- **Tab** toggles all chrome, but only when focus is on the canvas background (no target, `body` or the document element). On a control, native focus traversal wins.
- **`[` and `]`**, matched by the produced character (they sit on different physical keys across layouts, and the reference shows the character), rotate the selection one step. A selected standoff rotates its axis by 45° and goes first, on its own, since it is exclusive with node selection; otherwise every selected Conduit and Angle Dial turns. The key is swallowed only when something rotated.
- **Letters**, matched by physical key (`e.code`): I toggles isolate on the selection, A opens the Add menu at the mouse, G groups the selection, T runs Tidy, C runs Cleanup, E expands or collapses groups, F autofits groups, N toggles the navigator. E and F act on the selected groups plus the group of any selected member, or every group when nothing is selected.

With Ctrl or Cmd:

- `/` (matched by `e.key`, since punctuation moves on non-US layouts) toggles the Function Reference, and Comma opens Settings.
- S saves (Shift forces the dialog), O opens, and Shift+L reloads the current document, a combination that avoids the browser's reload keys. These work even while a field is focused, and `preventDefault` blocks the browser's own save and open dialogs. Every key below is skipped in a field.
- Shift+G makes a composite from the selection; A selects all visible nodes; C copies; V pastes at the mouse (never while isolating or locked).
- Z undoes; Shift+Z and Y redo. Both run inside `withGraphRebuild`, so the restore settles once instead of once per restored cable.

## Deleting a selection

`deleteSelection` (`canvasActions.ts`) is the one delete verb for both surfaces, behind RF's `onBeforeDelete`, the canvas keyboard and the touch delete button. `onBeforeDelete` itself returns false: the app deletes from the model and RF follows through the topology pipe, since RF's own delete would also take a deleted group's members. A `DeleteScope` carries the host's differences: whether the main-only layers (drawn cables, standoffs) are in play, which nodes Delete keeps (a drill-in keeps its boundary markers, which are its ports), the rebuild gate, and the one settle (`bulkSettle` on the main canvas; FC type reconcile and collapse sync in a drill-in, whose topology pipe then recomputes).

1. On the main canvas, a selected drawn cable is its own target: it is removed and `commitDrawn()` records it.
2. On the main canvas, a selected standoff is its own target: it is removed and an autosave scheduled.
3. Otherwise the selected cables and nodes go under the rebuild gate, because the per-item `connectionremoved` and `noderemoved` sweeps are O((nodes + cables) × nodes), and a bulk delete would hang the tab.
   - A selected cable that is a ribbon lane takes every lane of its ribbon. Any ghost among them is committed first, then removed.
   - A docked FC is unspliced (`removeFcInline`) and then removed, so its consumers go back to the host socket as solid cables. Docked FCs go before the other selected nodes, so a host deleted with its FC still sees its own wiring.
   - A deleted Conduit leaves one ghost cable per lane (`conduitGhostSpecs`), since the generic path below can't see a multi-lane bundle.
   - A node with exactly one cable in and one out is spliced out: both cables and the node go, and a ghost cable joins its source to its consumer, unless that would be a self-loop or duplicate an existing cable. Clicking the ghost adopts it.
   - Any other node goes with all its cables.
4. After the gate, the suppressed settles run once, in the order the per-event sweeps would: each deleted node's stores forget it, group membership rebuilds, the scope's settle runs, and a deleted group restores the pushes it caused.

`deleteCables` (the cable menu's Delete) commits any ghost and removes the cables.

## Copy and paste

`copyPaste.ts` works on the active graph, so it works inside a drill-in too.

- **Copy** (Ctrl+C) takes the selected nodes (`copySet`). A selected group brings its members, and a copied node brings its docked FCs, since a docked FC is part of its host's entity. A composite's boundary markers never go, even as a group's members, because they are its ports: a pasted marker would be an orphan with no port.
- **The clipboard is a snapshot.** It holds, per node, the constructor, a deep copy of `extractInit` ([[save-format]]), the `literals` and `stringLiterals` maps, the collapse and flip state, and the position relative to the selection's top-left corner, plus the cables internal to the copied set. Editing or deleting a source after the copy never changes what pastes.
- **Cloning.** A clone is `new Ctor(init)` from a fresh copy of the snapshot, and its `literals` and `stringLiterals` maps are restored after construction, or the constructor's own defaults would overwrite them.
- **Paste** (Ctrl+V) places the clones at the mouse plus `PASTE_OFFSET` (30 canvas units).
  - A group's member list is remapped to the clones, dropping members that weren't copied, so a pasted group can't take originals. A docked FC's `hostNodeId` is remapped too; an FC whose host wasn't copied undocks. A Presentation's steps are remapped the same way, so a duplicated deck flies to its own nodes.
  - Body collapse (`collapseStore`) and the socket flip (`socketFlipStore`) carry over from the snapshot. A pasted FC whose host came along re-docks onto the clone (`dockSelf`); the copied cables already carry its splice. A sequenced identity re-claims a fresh number (`assignFreshSeq`), and every clone gets a fresh name, never the source's, since the source is still on the canvas.
  - Everything is added under the rebuild gate. That skips the per-`nodecreated` absorb sweep, so pasted nodes keep their copied membership instead of joining whatever group they land in, and skips the per-cable settle of `connectioncreated`. A composite clone hydrates its captured subgraph once it has been added. Cables are re-added, skipping any that are incompatible or duplicate.
  - The selection clears first and the pasted nodes become the selection, through the selection slots, which a drill-in swaps to its own level. RF has no wrapper for a clone yet when it is selected, so `syncTopology` (`mergeFlowNodes`) gives a node RF hasn't seen the model's `selected` flag, while a node RF already holds keeps RF's. On the main canvas `bulkSettle` then renders only the pasted nodes; in a drill-in, whose settle singleton is main-bound, the paste recomputes the whole main graph, owning composite included.

## Format Controller docking

A Format Controller (FC) can dock onto a socket of another card and ride with it ([[D41]] formatFlowsDownstream: a docked FC formats display only). `fcDocking.ts` is pure over an editor, a view, a container and the FC, so the main canvas and a drill-in share it.

- **Snapping.** `findDockTarget` finds the nearest host socket whose pairing edge is within `DOCK_SNAP_CANVAS_PX` (34 canvas units, the screen distance divided by the zoom; raw screen pixels would let a zoomed-out canvas snap to a far host). A host output pairs with the FC's input edge and a host input with its output edge. An FC never docks onto another FC.
- **Placement** (`computeDockedCanvasPos`). On a host input the FC sits to the left, its output edge meeting the socket; on a host output it sits to the right. It is centered vertically on the socket using its measured size, because a stale estimate drops it several pixels low. The anchor is the host's model position plus the socket's offset inside the host wrapper, both read from the same DOM frame, so it holds even before the wrapper has re-committed at a new position (the post-Tidy snap runs a frame after the moves); a screen-to-canvas conversion is the fallback. The offset is snapped to the half-pixel grid first and the result rounded to whole canvas pixels. Without the snap, an odd FC height makes the rounding a coin flip that re-docks the FC a pixel off its saved spot on every load; without the rounding, a fractional edge shifts on every re-dock and a group's autofit creeps after it.
- **Following the host.** `repositionDockedFor` re-seats every FC docked to a host, skipping a selected FC (the user is dragging it). The main canvas registers it in the `repositionDocked` slot and a drill-in swaps in its own copy, so a docked FC follows its host on a resize, a format change or a Tidy at any level. A dragged FC re-homes to the nearest socket on drop, or releases its dock.
- **Splicing** (`insertFcInline`). Docking splices the FC into the host's data path; values are unchanged, but cables now originate at the FC. On a host output, the host's consumers are rewired to the FC's `out` and the host feeds the FC's `in`. On a host input, the splice happens only when a cable feeds it (an unwired input has nothing to route, so the FC just annotates): the source feeds the FC and the FC's `out` feeds the host input.
- **Unsplicing** (`removeFcInline`) reverses it, and must run before `undock()` or any change to `hostNodeId`, since it reads the host, socket and side. A wired FC with no host, or whose host no longer has that socket, bridges its input's source straight to its output's consumers.
- **Releasing.** An FC dragged off every socket releases its dock (`releaseDock`) without unsplicing: it stays in the data path as a free FC, so no consumer loses its value. Otherwise the consumers go back to the host output, or the source goes back to the host input, and the FC's own cables are dropped.
- Adding an FC from a socket's menu (`attachFormatController`) docks it (`dockSelf` needs the id `addNode` assigns; undocked, the FC would land at the canvas origin), positions it, splices it in and recomputes.

## Isolate

Isolate is a view-only focus: the focus set shows and every other card recedes. Nothing is removed, and nothing is saved or recorded in undo.

- `isolateStore` holds the focus set (null when not isolating), a mode label for the Isolate pill ("Where used"), and `isVisible(id)`, true when not isolating or when the node is in the set. The endpoint selection on the isolate overlay is exclusive with node, cable and standoff selection.
- `isolate.ts` resolves through the active editor, so isolate works in a drill-in. It always expands to whole entities: a group brings its members and a node brings its docked FCs. Isolate chain (`isolateChainOf`) takes the connected chain both up- and downstream, seeded with group members so a group's own cables are walked, then re-expanded for anything reached. Where-used (`isolateWhereUsed`) takes only the downstream stream from one node; it dims the same way, so the pill's label is what tells the two apart.
- The overlay's boundary analysis (`isolateBoundary.ts`) finds the entries (an outside output feeding a focused input, drawn on the left) and the exits (a focused output feeding an outside input, drawn on the right).
- Receded cards fade out when isolation starts and take no pointer events. The dim is the `sol-isolate-dim` class from `flowModel.nodeClassName`, re-stamped when the isolate store notifies, like `sol-member-hidden`: RF rebuilds a wrapper's className on every selection change, so a class written on the element directly would drop, and its `pointer-events` rule is `!important` over RF's inline style (canvas.css). Positions, groups and push records are untouched: a move made while isolating stays. The Add menu is suppressed while isolating, and Escape exits.

## Undo history

Undo is a snapshot history (`flow/flowHistory.ts`, [[B10]] reactFlowView). Every settled mutation records the canonical document (`serializeGraph`, as JSON), so no action needs its own inverse: an undo is a `loadGraph` of the earlier snapshot.

- **Recording.** `schedule()` debounces by `COALESCE_MS` (400 ms); `recordNow()` records at once. Neither records while a restore or a rebuild is running. A snapshot identical to the current one is skipped, and so is one that differs only by the cards' measured `init.width` and `init.height`, which re-stamp after a restore mounts the cards; recording that drift would cut off the redo tail for nothing. A new record truncates the redo tail.
- **Who records.** `processGraph`'s graph-changed hook records component edits and autosaves; position-only changes (a nudge, a group push, standoffs), which never run `processGraph`, record through `afterProgrammaticMove`; drawn-cable edits record through `commitDrawn()`.
- **Limits.** At most `MAX_DEPTH` (80) entries and `MAX_BYTES` (16 MiB, counted as two bytes per JSON character), since on a large document whole-document snapshots reach tens of megabytes. The oldest entries go first; the current one always stays.
- **Restoring.** A restore runs without the load curtain and keeps the camera where it was, so an undo feels like an edit, and then schedules an autosave, since the restored state is now the document. One restore runs at a time. Undo first flushes a pending debounced record.
- **The baseline.** `reset()` is the `setClearHistory` slot: `loadGraph`'s own end-of-load clear seeds the new document's baseline, labeled "Opened". Restores skip it, so an undo never wipes the stack.
- **Labels.** `describeGraphDelta` (`flowHistoryDigest.ts`) derives each entry's label by diffing it against the one before. The parts join with "; ", most significant first: Added, Removed, Connected and Disconnected (a single cable reads "A → B"), Renamed, then Edited, each naming a single node or counting several. A card's `init.width` and `init.height` are measures re-stamped after every restore, so a change to them alone records nothing (`sameIgnoringDims`). A group's are the user's, so a grip resize or autofit records an entry, labeled with the "Edited document" fallback. A redo first flushes a pending edit, as undo does, so the edit is kept. Moves are reported only when nothing else changed, since they ride along with group tows and expand pushes. Failing all of those, the label is "Changed standoffs", "Drew a cable", "Removed a drawn cable", "Edited a drawn cable" or "Edited document". `records()` lists the applied transitions, oldest first and without the baseline, for Session History.

A composite drill-in keeps its own per-composite history ([[composite-drill-in-mount-lifecycle]]).

## The main canvas

`FlowCanvas` owns one editor, engine and view stack for the app's lifetime. Documents load through the real persistence and `documentStore` path, and chrome reaches the canvas through the `process.ts` slots. Once, at startup, it registers the delete verb, the docked-FC reposition, Tidy and Cleanup, the FC unit-mismatch badges (rescanned on every cable change and annotation edit), the bulk settle (the one settle after a bulk topology change such as paste or unpack), the standoff settle (the pure solver, with locked groups pinned) and the cable-change pipe.

- A live node deletion re-derives membership and collapse, and deleting an expanded group restores the pushes it caused ([[C40]] storesRegisterForget; a rebuild runs the forget-all pass once instead).
- A `/?seed=<id>` link (from the Examples page) opens that seed as a new document, then strips the parameter, so a reload or an autosave doesn't keep minting copies.
- The app chrome (toasts, dialogs, the palette) renders beside the surface, not inside it, because the main wrapper is `visibility: hidden` under a drill-in ([[C75]] gpuTextureBudget).

The showcase audit stage (`StaticFlowStage`, `?showcase`) is a minimal non-interactive surface: real components and real values with no pan, zoom or drag. Callers build its graph through the stack's editor and view verbs, and the stage mirrors the topology into RF state.

## Ghost cables

A ghost cable is a cable drawn dashed to show it is not yet valid or not yet real. There are two mechanisms, chosen by whether a real connection survives. Both live outside rete's editor, in `cableState.ts`.

- **Option A: the connection survives** (`cableGhostStore`, keyed by a live connection id). The rete connection is real and is only drawn dashed until it is valid or adopted. Two cases produce it: a node spliced out of a chain, and an in-place socket retype that stays wired. The store is a side set keyed by id rather than a property on the connection, because rete copies and serializes the connection object opaquely. Clicking a ghost adopts it only when its endpoints are type-compatible right now: a splice ghost always is, while a retype ghost stays dashed until its source fits again. Adopting it recomputes the target.
  - A ghost is a real connection to the engine, so it feeds its value like any cable: a splice ghost carries the spliced-out node's input straight through, and a retype ghost feeds whatever its source now holds, which the input's coercion guard turns into an error value when it doesn't fit. A node that must treat a ghosted input as unwired asks the store itself (Group Cost Settle's `inGhosted`).
  - The ghost mark is view state and is not saved: a reload draws every surviving connection solid. Whether it should survive a save is open with the author (inbox `ghost-cables-feed-and-save`).
- **Option B: the connection is dropped** (the Input Switch pending reconnect: `cablePendingStore` and `cablePendingReconnect.ts`). The Input Switch's One/Many toggle retypes its `out` socket, and `retypeOutputCables` drops the downstream cables the new type can't feed, so there is no connection left to draw dashed.
  1. Before the retype, `snapshotOutgoing` records the cables leaving `out`.
  2. After it, each cable that disappeared (and whose target node still exists) is recorded as a pending ghost keyed by source, output, target and input, so re-marking the same drop is idempotent, along with the target input's label.
  3. Whenever the output type fits that input again, the ghost becomes a real cable: the same input key if it is back, otherwise the one input with the same label. Two inputs sharing the label are ambiguous, and the ghost waits. In One mode the output is `trueany`, which fits every socket, so flipping back reattaches all of them. Both halves run on every retype, so a flip that drops one cable and reattaches another does both in one pass.
  4. If the user wired that single-cable input from elsewhere while the ghost waited, theirs wins and the ghost dies, never a second cable on the input. A ghost whose target node is gone is dropped.
  5. `PendingCableLayer` draws each pending ghost dashed, in the Option A stroke, from RF's measured handle bounds, since no edge exists to carry it.
  6. Nothing is saved. `registerNodeForget` / `registerNodeForgetAll` clear a ghost when either of its nodes is removed, and on every load.
  `cablePendingReconnect.test.ts` pins this behavior.

## Socket highlights

`cableState.ts` also holds the socket highlights, in three independent slots: the cable being dragged, the hovered cable and the hovered socket. A socket is lit if any slot holds it. One shared slot would let a socket's `mouseleave` clear the cable's `mouseenter` as the pointer slides off the socket onto its cable. An unchanged key skips the notify, because the drag slot is written on every pointer move and each notify re-renders every mounted socket, pill and group summary. Only `NodeSocket` writes the socket-hover slot.

## Controls inside cards

- A native form popup inside a node keeps its `pointerdown` / `mousedown` `stopPropagation`. The stop also prevents a node drag (`stopDragStart` in [[pointer-gestures]]).
- A controlled `<select>` gets its value from `useState` and mirrors it to the node in the change handler. Never refresh it through a `useReducer` forceUpdate.

## Error boundaries

Every render is inside an error boundary (`components/ErrorBoundary.tsx`): one at the app root and one around each card (`SolNodeAdapter`). An app-level throw shows the message and component stack with a Copy button. A single bad card shrinks to a small red box while the rest of the canvas keeps working. When a black screen is reported, ask for the copied text first.

## Load performance

Two mechanisms keep loads fast ([[graph-load-teardown-performance]]). The topology pipe merges a rebuild into one React commit. `syncTopology` keeps each surviving node's object identity, so RF's memo skips cards that didn't change, and adding one node re-renders one card.

## Entrance choreography

The marketing stages (the surfaces carrying `.sol-flow-reveal`) animate their entrance; the working canvas never does. The cards pop in first with a light cascade across the first several, using opacity and blur only, never a transform. RF measures each handle's position off the node's box and divides out only the viewport zoom, so a scale in flight mis-measures the sockets, and ResizeObserver ignores transforms, so it never corrects itself. Then every cable draws itself from its source socket to its target (see [[cable-rendering-knobs]]).

## Chart figures

A figure on a `chart` socket carries data, not geometry, and lays itself out at its measured width ([[schedule-and-gantt]]; the Gantt is the first figure that isn't a single `<svg>`).

- The value on the cable is flat JSON, a `ChartPayload`.
- The same figure draws at four sizes: the card's [Chart] chip, the resizable Display (with a size cap), the popup, and a Report embed. None of them uses a pre-rendered pixel frame.
- `ChartFigure` (`chartView.tsx`) is the one dispatcher. The popup passes `virtualize`, which renders only the visible rows.

**Static export** (`canvasCapture.ts`) never uses the HTML-in-Canvas API ([[C42]] htmlInCanvasRenderer).

- `captureCanvasImage` rasterizes the current viewport (not the whole world) through a `foreignObject`, and returns null when unmounted or when the browser refuses it, so an export fails soft. A rasterized `foreignObject` inherits no live stylesheets, so every same-origin stylesheet rule is inlined; an unreadable cross-origin sheet is skipped.
- A chart's SVG is serialized with its rendered styles inlined, since the exported document ships no app stylesheet and anything a chart takes from class rules or `var(--…)` must be baked in. The original and the clone are walked in lockstep, because `getComputedStyle` is blank on a detached node.
- A node's chart is its largest SVG that isn't card chrome (the frame overlays, which are the biggest SVGs on every card and paint nothing off-canvas) or glyph-sized furniture. `captureChartSvgs` returns every rendered chart node's SVG with the node's display name, narrowed to the report-referenced set when given.

**The export SVG seam.** A figure whose drawing is not one `<svg>` (the Gantt draws an HTML tree grid beside one banded SVG per row) registers its own serializer with `registerChartSvgProvider`, keyed by the host node it draws in. The disposer it returns removes only that provider, so a later mount that replaced it wins and an unmount can't delete the winner. The on-canvas Display registers one; the short-lived popup does not. The webpage export and the Write-to-Obsidian image both ask the provider first (`nodeChartSvgProvided`, null when none is registered or it declined) for a whole-chart SVG string (`ganttSvg`), and fall back to the largest `<svg>` only when there is none.
