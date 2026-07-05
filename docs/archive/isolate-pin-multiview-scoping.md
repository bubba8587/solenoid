# Scoping: Isolate, Pin, split-screen, multi-window

Four related "look at part of the graph without the rest of it in the way"
features, ordered by effort. The first two are canvas features inside the
current architecture; the last two challenge its single-editor/single-area
assumptions, which is where the cost lives.

**Status (2026-06-15):** §1 Isolate, §1.5 Isolate v2 (focus overlay + auto
endpoints), and §2 Pin (incl. groups) are BUILT. §5 Portals is the next direction
(scoping below). §3 split-screen and §4 multi-window remain scoping only.

## 1.5 Isolate v2 — focus overlay + auto endpoints — BUILT

> Built: focus-mode behaviors in the Canvas isolate effect (re-center via zoomAt;
> snapshot positions on enter + restore on exit so repositioning is ephemeral; Add
> menu / right-click-add / paste blocked; base stays dimmed + locked). Auto
> endpoints: `isolateBoundary.ts` `boundaryCrossings` (tested) drives
> `IsolateEndpoints.tsx`, which renders an Inputs terminal (left) + Outputs
> terminal (right) in the area's transformed plane with dashed virtual cables to
> the focused sockets. Terminals reuse the node card chrome (`.solenoid-node` /
> `__header` / `__io-row`), are coloured neutral "Any" gray (NOT the accent — that
> reads as a socket type), and are selectable + draggable via the shared selection
> store (`isoEndpointSelect`), mutually exclusive with node/cable selection.
> Deferred: the terminals are display elements joined to the selection system, NOT
> literal rete `editor` nodes — node ops (delete / copy / wiring a real cable to a
> terminal) would need them threaded through serialization (skip), the engine
> (inert), undo (`history.active` suppress), copy/paste, and the render presets;
> all confirmed feasible, do it if/when those ops are wanted. Multi-lane terminals
> render as a stacked box, not yet a literal Conduit grid.

Supersedes the v1 in-place dimming. Instead of dimming non-focus nodes where they
sit, Isolate becomes a **focus overlay**: the focus set is presented on its own
**centered layer** above a **dimmed canvas backdrop**, and the chain's boundary
connections become **auto-generated endpoint nodes** on either side — a Conduit
when several lanes cross, a single socket when one. Entry endpoints (an outside
output feeding a focused input) sit on the LEFT; exit endpoints (a focused output
feeding outside) sit on the RIGHT. So a chain reads as a self-contained little
circuit with labelled in/out terminals, no surrounding clutter.

**Rendering decision (resolved).** Done on the SINGLE editor (focus mode), not a
second live editor: the app is wired to one `getEditor`/`getArea` singleton (node
components, socket measurement, conduit/ribbon/standoff/push all read it), so a
true second editor would mean making every call site area-aware first — the §3
second-viewport refactor. The focus-mode approach delivers the behaviors the
"real copy" needed (base locked, ephemeral layout, no new nodes, edit
inputs/connections/delete) without that surface; the difference is the focus is
the real nodes spotlighted + re-centered, not a separately-rendered duplicate.

**Shared endpoint UI.** The auto endpoints and the Portal nodes (§5) use ONE
component / visual language: a compact terminal showing the lane(s) + a label
(the external node's name for an auto endpoint; the portal store name for a
Portal). Build it once, drive it from `boundaryCrossings` for the overlay and from
the portal store for Portals.

## 5. Portals (entry/exit named-store pairs) — FUTURE (name TBD)

A **Portal** node pair that pipes a value across the graph without a drawn cable:
an **exit portal** publishes its input to a **named store**; an **entry portal**
is a dropdown of all exit-portal names and reads the chosen one's value. (Name
TBD — "Portal" is a placeholder.) Uses for long-range wiring, dashboards, and
de-cluttering. Crucially, Portals share the auto-endpoint UI from §1.5: an exit
portal looks like an exit endpoint, an entry portal like an entry endpoint, so the
Isolate overlay's terminals and real Portals read as the same kind of object — and
an Isolate overlay could later offer to "promote" an auto endpoint into a real
Portal. Design the endpoint component once with both consumers in mind.

## 1. Isolate v1 (Node / Group / Chain) — small-medium — BUILT

> Built: `isolateStore.ts` (Set<nodeId>|null + pure `chainClosure` BFS, tested),
> `isolate.ts` (focus derivation), `NodeContextMenu` (Isolate / Isolate chain),
> hotkey `I` / Esc, `IsolatePill`, Canvas node-view dimming + cable dimming.
> Deferred: outline-row dimming, background double-click exit, the
> ribbon-dims-only-when-all-members-dim refinement.

Blender-style local view: pick a focus set, everything else recedes (dimmed
and non-interactive, NOT removed — positions, groups, and push records must
survive isolation untouched).

**Focus set derivation.** Three scopes from the current selection:
- *Node(s)*: the selection itself.
- *Group*: the group + members (+ docked FCs of members — `hostNodeId`).
- *Chain*: transitive closure over `editor.getConnections()` in BOTH
  directions from the selection (a chain is anything with up- and downstream
  connections). One BFS over the connection list; trivially cheap at our
  graph sizes. Variants worth a modifier key later: upstream-only ("what
  feeds this"), downstream-only ("what does this affect").

**Mechanics.** A module store (`isolateStore`, storeKit pattern) holding
`Set<nodeId> | null`. Consumers:
- Node views: Canvas applies a CSS class to `area.nodeViews.get(id).element`
  for non-members (opacity ~0.08, `pointer-events: none`). No rete surgery.
- Cables: `ConnectionComponent` already re-renders on connection/area events;
  it reads the store and dims any cable whose either end is outside the set.
  Ribbons: a ribbon dims only when ALL members dim (it's one entity).
- Minimap / Outline: outline rows for hidden nodes get the same dimming;
  minimap can ignore isolation v1.

**Entry/exit.** Right-click → "Isolate" (and "Isolate chain"), hotkey (`/` is
Blender's; `I` free?), Esc or background double-click exits, a small floating
"Isolated — Esc to exit" pill so users can't get lost. Isolation is a VIEW
state: not persisted, not in undo history.

**Edge cases.** Cable drag while isolated should only target visible sockets
(the pointer-events rule gives this for free). Group expand/collapse inside
isolation works normally (push records are position-level, unaffected by
opacity). Standoff bars to outside nodes dim with them.

**Estimate.** A focused day. No architectural risk; everything is a render-
level overlay on existing state.

## 2. Pin (floating compact values) — small-medium — v1 BUILT

> Built (v1): `pinStore.ts` (ordered pins, one per node, persisted in
> `SavedGraph.pins` with id-remap on load, auto-drop on delete via
> nodeStoreRegistry), `PinLayer.tsx` (screen-fixed top-right HUD portal'd to
> body, value read from cableValueStore, error badges reused, click → zoomAt),
> "Pin value" in the node context menu. **Groups** are pinnable too: a group chip
> shows its readouts (the same Display / boundary-crossing-output / leaf terminals
> a collapsed group surfaces, via `groupReadouts` in groupCollapse.ts). Deferred:
> chip drag-reordering and v2 interactive controls.

Pin a node's value (or a whole node, collapsed & extra-compact) to a
screen-fixed HUD layer that floats above the canvas at constant size,
regardless of pan/zoom.

**Key decision: pin the VALUE, not the rete view.** Rete node views live in
the area's transformed plane and rete-render-utils measures their DOM for
cable endpoints — re-parenting a live node element into a screen-space layer
breaks socket measurement and drag handling. But nothing requires the pinned
thing to BE the node: a pinned chip can render label + live value straight
from `cableValueStore` / `node.cachedResult` (module singletons, readable
from any React root — same trick the Conduit toolbar uses via portal).

**v1 — read-only value chips.**
- `pinStore`: ordered list of `{ nodeId, outputKey? }`, persisted additively
  in `SavedGraph` (like standoffs). Right-click a node → "Pin value";
  pin icon on the chip removes it.
- A `PinLayer` React root portal'd to document.body (screen space), docked
  e.g. top-right as a vertical stack; chips draggable within the layer.
- Chip = node label + ValueDisplay-style value (re-uses formatting + the new
  error badges), click → pan/zoom canvas to the node (`AreaExtensions.zoomAt`).
- Deleted node → chip auto-drops (subscribe to graph changes).

**v2 — interactive pins.** For input-ish nodes (Slider, Boolean, Scalar
Input, Slicer) the chip could host the actual control bound to the same node
instance — safe because controls already mutate the node + `processGraph()`
via module singletons, no rete coupling. This effectively gives "control
panel" dashboards for a model. Worth doing only after v1 proves the layer.

**Estimate.** v1 a day; v2 another day for the 3-4 control types. Pin + Isolate
together deliver most of the value people want from split-screen, at a
fraction of the cost — recommend building both before either view feature.

## 3. Split-screen (same and/or different files) — large

Two viewports side by side.

**Same file, second viewport.** The honest blocker: the app is built around
one `NodeEditor` + one `AreaPlugin` (`process.ts` singletons `_editor/_area`;
every store, socket watcher, and portal assumes them). Rete v2 *can* attach
two area plugins to one editor in principle, but each node gets a separate
view per area, and all our position-dependent systems (MeasuredSocketRow CSS
vars, conduit layout store, ribbon geometry, standoff layer, group push) read
THE area. Auditing every `getArea()` call site for "which area?" is a real
refactor (~50+ sites), plus duplicated render cost per viewport.
  - Cheaper variant worth considering: a **read-only second viewport** that
    renders from the same DOM via no rete instance at all — essentially a big
    minimap (boxes + cable paths redrawn from `nodeViews` positions, no
    interactivity beyond pan/zoom + click-to-navigate-the-main-view). Most of
    the "keep an eye on the outputs while I edit the inputs" value, none of
    the dual-area risk. Medium effort.

**Different files side by side.** Requires multi-document: two editor+area
instances in one window. The singletons make this a project-wide refactor
(every `getEditor()` becomes "editor of which pane"; stores keyed by node id
are *probably* collision-safe thanks to rete's unique ids, but
selection/clipboard/undo are global today). Honestly: if two files is the
goal, two OS windows (below) is cheaper and more natural than in-window
splits.

**Estimate.** Read-only viewport: 2-3 days. True dual-area or multi-document:
1-2 weeks with regression risk across every position-dependent feature.

## 4. Additional windows of the same file (Excel-style) — medium for viewer, large for live editing

**Plumbing is the easy part.** Tauri spawns extra `WebviewWindow`s natively;
the browser build can `window.open` itself. Each window is a separate JS
context running the full app.

**The real question is sync.** Two live editors on one graph need an op bus:
- *Viewer window (recommended v1)*: secondary windows open read-only,
  refreshed from the autosave channel (`localStorage` events fire across
  windows/tabs for free in the browser; Tauri has its event API). Latency =
  the 700 ms autosave debounce — fine for "watch the dashboard while editing".
  Roughly: a `?viewer` boot mode that loads the graph, disables editing
  (canvas lock store already exists), and reloads on storage events. 2-3 days.
- *Live editing in both (Excel parity)*: needs operation forwarding
  (node add/remove/translate, connection add/remove, literal edits) with
  echo suppression — a mini-CRDT/last-writer-wins layer over BroadcastChannel
  / Tauri events. Doable because all mutations already funnel through few
  choke points (editor pipes + processGraph), but it's a serious feature
  with conflict semantics to define. 1-2 weeks, and it partially overlaps
  with what a future real-collaboration feature would need — if collaboration
  is ever on the roadmap, design this as its first half rather than a one-off.

## Suggested order

1. **Isolate** (chain scope included) — cheapest, immediately useful.
2. **Pin v1** (value chips) — pairs with Isolate; reuses error badges/formatting.
3. **Viewer window** (Tauri + browser) — Excel-style second window, read-only.
4. Pin v2 (interactive controls) — turns pins into dashboards.
5. Only then judge whether split-pane / live multi-window editing still earns
   its cost; items 1-3 may have absorbed the demand.
