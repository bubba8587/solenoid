# Canvas frame cost: findings (October 2026)

What a pan or zoom frame on the canvas costs, why, and what changes would cut it. This is a report, so read it whole before
acting on any one finding: several plausible results that held on one kind of test failed on another, and those reversals
are part of the record. It is written so it can be read without the session that produced it. It serves [[C120]] linearWork (per-frame
work stays proportional to what changed) and the canvas rules in `tree/specs/canvas/react-flow-surface-contract.md`.

Status of each finding at a glance:

| # | Finding | Evidence | Status |
|---|---|---|---|
| 1 | Pans repainted every card on desktop; a GPU layer for the pan fixes it | measured, live app, desktop | **Shipped** (desktop pan layer, Chromium, fine pointers) |
| 2 | Extending that layer to phones (and holding it between strokes) | measured in emulation, then on the author's phone | **Reverted**: helped zoomed far out, hurt close zoom |
| 3 | Every socket subscribes to React Flow's store, so every pan frame runs ~466 extra selectors | React Flow source, direct listener count, live A/B | **Shipped** (the socket handle no longer uses RF's `<Handle>`) |
| 4 | Every cable subscribes three times and recomputes its endpoints each frame | React Flow source, upper-bound test | Candidate (architecture change, the author's call) |
| 5 | The desktop minimap subscribes once per card | React Flow source, A/B | Candidate |
| 6 | One CSS rule (`clip-path` on grouped cards' corner tag) makes Chrome re-record those cards on every zoom step | Chromium source, live desktop A/B | Not shipped: costs phones layerize, cause unproven |
| 7 | Many card styles (shadows, filters, text, masks, the header clip, chevrons) | knockout tests | Ruled out |

## How it was measured

- **Seed:** personal-finance (154 nodes, 172 cables, 466 sockets, 15 groups, 89 of the 154 cards hidden inside collapsed
  groups at load). It is the largest realistic seed.
- **Browser:** the preinstalled headless Chromium, driven by puppeteer. **Desktop:** 1600×1000 at 1×. **Phone:**
  412×915 at 2.625×, mobile user agent, touch, `pointer: coarse` forced, CPU throttled 4× (so phone milliseconds read about
  four times what a real phone pays).
- **Cost:** a Chrome trace per run, summed by phase: script (JS), paint (recording display lists), layerize (turning paint
  chunks into compositor layers), raster (pixels; headless rasters on the CPU, so raster numbers overstate what a GPU pays).
  "Net" means paint + layerize + script, the main-thread work that decides frame rate.
- **Pans:** mouse drags (desktop) or four long touch strokes (phone) from empty canvas, plus phone strokes starting on a
  card. **Zoom:** wheel notches that cross the 0.1 zoom steps (the zoom snaps to 0.1, so a step is one full repaint).
- **Rigor:** each comparison is the median of 5 to 15 runs with its range, alternating variants where order could matter.
  A finding counts only when the Chromium or React Flow source explains the mechanism and the live measurement matches what
  that code predicts. Static-page results (the canvas DOM and CSS frozen into a page without React) were used to find
  candidates, never to decide.
- **Tools:** `scripts/zoom-perf-probe.mjs` (desktop pan and zoom by phase, layers mid-pan, CSS knockouts) is in the repo.
  The phone probe, the static-page harness, the store benchmark, the subscriber census and every raw result are on the
  branch `exp/zoomed-out-perf` (folder `perf-experiments`, with its running LOG file and a README on how to rerun them).

## 1. The desktop pan repainted every card (shipped)

**Symptom.** Panning zoomed far out was much slower than zoomed in, and worse than linear in what was on screen.

**Mechanism.** In the default DOM mode the React Flow viewport had no compositor layer, so every pan frame re-recorded and
re-rastered every card on screen. The number of cards on screen grows with the square of how far out the camera is, which
is the "feels quadratic" effect.

**Why the old attempt at a pan layer failed, and the fix.** Promoting the viewport split it into about 106 layers on a 1×
desktop screen: Chrome won't merge text on an opaque fill into a layer whose contents aren't known to be opaque (it would
lose LCD antialiasing), nor two distant pieces into one sparse layer. An opaque canvas backing under the cards
(`CanvasBacking`, which also replaced React Flow's `<Background>`, whose screen-space pattern re-rastered every frame) keeps
the layer whole. `will-change: transform` rasters at a rounded scale (text went soft at zoom 0.3), so the layer is a flat 3D
translate; a fractional camera offset composites soft, so a press snaps the camera to whole device pixels first.

**Result.** personal-finance at zoom 0.1, 120 pan frames: paint about 1.8 s to 0.5 s, raster about 3.0 s to 0.2 s, one
layer mid-pan, mid-pan screenshots identical to the canvas at rest. The mechanism and its rules are in
`../tree/specs/canvas/react-flow-surface-contract.md` § Drag performance and § The dot grid.

## 2. The pan layer on phones (reverted)

Extended to touch pans, then kept up between strokes, primed at rest and held by a do-nothing animation (which makes Chrome
record the layer whole instead of re-recording as a long pan outruns its painted margin; `ShouldUseInfiniteCullRect` returns
true for a transform with an active animation). In emulation the hitches went away, but on the author's phone it helped only
zoomed far out, did little in the middle, and made close zoom worse. All of it was reverted (commit `409383f`). Phones stay
off the layer. Do not retry it without a test on a real device at close zoom.

## 3. Every socket subscribed to React Flow's store (shipped)

**Mechanism (React Flow 12.12.0 source).** React Flow keeps the camera in a zustand store. `setState` calls every listener
(`listeners.forEach(listener)`), and each `useStore` subscriber's selector runs, whether or not its component is on screen.
A pan frame is one camera update. React Flow's `HandleComponent` subscribes each handle with
`useStore(connectingSelector(nodeId, handleId, type), shallow)`. That selector only decides the classes `connectingfrom`,
`connectingto`, `valid` and `connectionindicator`, which only switch `pointer-events` in React Flow's stylesheet; the app
styles none of them, and `@xyflow/system`'s connection code reads only `source`, `target`, `connectable` and
`connectableend`.

**Profile.** On a phone pan the script time was almost all one chain: d3's `touchmoved`, React Flow's `setState(transform)`,
then every subscriber's selector (`checkIfSnapshotChanged` and `with-selector` overhead per subscriber, cable endpoint maths,
card selectors, socket selectors). JS was the largest single cost of a phone pan, in a production build too (zoom 0.1, per
pan: script 5.6 s, paint 4.2 s, layerize 2.3 s, raster 1.6 s at 4× slowdown).

**Fix.** `FlowSocketHandle.tsx` renders React Flow's handle markup itself (the same classes and data attributes), starts a
connection with `XYHandle.onPointerDown` and click-to-connect with `XYHandle.isValid` from `@xyflow/system`, exactly as React
Flow's Handle does, and subscribes to nothing. It wears the idle classes permanently. The socket a dragged cable would land
on already lit from `litTargetStore`, not from React Flow's classes.

**Evidence.**
- Direct count of store listeners during one camera update: 1,374 with React Flow's `<Handle>`, 908 without. The difference
  is exactly 466, the socket count.
- Synthetic camera update (100 `setState({transform})` calls, phone emulation at 4×), 15 runs each in three alternating
  rounds: 7.32 ms median per update [3.04 to 10.02] against 10.98 ms [5.52 to 13.71], about a third less.
- Live phone pans, 5 runs each, net main-thread time per pan: zoom 0.2, 9,991 ms [8,891 to 10,534] to 8,494 ms [7,908 to
  9,387] (−15%, script 6,047 to 4,575); zoom 0.5, 9,248 to 8,567 (−7%). Paint and layerize unchanged, as the mechanism
  predicts.
- Correctness: `scripts/socket-drag-probe.mjs` passes identically (every socket hit, crosshair cursor, a press starts a cable
  and not a node drag, an input-to-output drop lands). The only difference is that the dragged-from socket no longer gets
  `connectingfrom`, which nothing uses.

**Upkeep.** `@xyflow/system` is pinned to the exact version `@xyflow/react` pins; bump them together and compare the new
`HandleComponent` with the socket handle (`docs/backlog.md` § Dependency updates, the spec's Sockets section).

## 4. Every cable recomputes its endpoints each frame (candidate)

With sockets gone, a phone camera update still notifies 752 subscribers: cables 516, cards 154, resize grips 41 and about 41
others. React Flow's `EdgeWrapper` subscribes three times per cable (`edgeLookup.get(id)`, `defaultEdgeOptions`, and a
selector that runs `getEdgePosition`: two node lookups and handle-position maths). A pan never moves a cable's endpoints,
so all of that is wasted on every frame.

**Upper bound.** With React Flow handed no edges at all (a throwaway test, cables not drawn): a synthetic camera update
went from about 9 to 10 ms to 1.3 ms (5 runs), and a live phone pan's script from 4,795 ms [4,283 to 5,171] to 2,765 ms
[2,687 to 3,466], −42%, ranges not overlapping. (Paint fell too, but only because cables were not drawn; don't count it.)

**What the change would be.** Draw cables in one app layer that subscribes once and recomputes endpoints only when cards or
cables change, never on a camera change. It touches cable selection, hover and context menus (React Flow's `onEdge*`
callbacks), deletion, the cable z-order, `view.connectionElement` (which queries `.react-flow__edge[data-id]`), the
HTML-in-Canvas cable snapshot and the drag line. It is an architecture decision, not a tuning.

## 5. The desktop minimap subscribes once per card (candidate)

React Flow's minimap renders a `NodeComponentWrapper` per card, each with its own `useStore` selector recomputing that
card's position and size, plus `useStore(selectorNodeIds, shallow)` rebuilding the id list, on every camera update, though
minimap rectangles change only when cards move. Phones don't mount it. Desktop synthetic camera update, 10 runs each, with
the socket fix in: about 9.0 ms with the minimap against 4.5 ms without. A minimap drawn from one subscription that
recomputes rectangles only when cards change (and the viewport mask from the camera alone) would recover most of it.

## 6. Clips that defeat Chrome's paint cache (mechanism proven; one fix, not shipped)

**Mechanism (Chromium source, `third_party/blink/renderer/core/paint` and `platform/graphics/paint`).**
1. `PaintLayerPainter::Paint` marks a paint layer `kMayBeClippedByCullRect` when its contents' visual rect is not contained in
   its contents cull rect.
2. `CullRect::ApplyPaintPropertiesWithoutExpansion` intersects the cull rect with the layer's own clip, so a layer that clips
   content reaching past the clip (an `overflow` clip or a `clip-path`) can never contain it, even fully on screen.
3. `PaintLayerPainter::PaintChildren` passes a child's `kMayBeClippedByCullRect` up to its parent, so one such element flags
   its whole card.
4. `CullRectUpdater` skips cull-rect updates for a non-composited transform whose layer was `kFullyPainted`, and
   `SetLayerNeedsRepaintOnCullRectChange` repaints a flagged layer whenever its cull rect changes. So a flagged card is
   re-recorded on every camera change.

A minimal page shows it: a positioned box with `overflow: hidden` made Chrome re-record it on every 1px slide (paint 316 ms
per 60 frames against 3 ms for the same box unpositioned, or positioned without the clip).

**On the canvas.** The one element that matters is `.solenoid-node--grouped::before`, the group-color corner tag on grouped
cards: a positioned, full-card pseudo-element clipped to a 15px triangle by `clip-path`. Desktop zoom steps at zoom 0.2, 5
runs each: paint per step 31.4 ms [28.8 to 37.7] to 11.1 ms [10.6 to 12.2] with the tag removed (−65%); main thread 66.6 to
62.0 ms. A `mask` or a CSS border triangle draws the same corner (8× crops identical apart from antialiasing on the diagonal)
and caches the same way. Unclipping the frame header SVG or the chevron SVGs changed nothing (the header was predicted to
matter and didn't; the chevrons draw inside their own box, so the source says they can't flag).

**Why it isn't shipped.** On a phone, removing or replacing the tag gave no paint gain and **doubled layerize** (5 runs per
variant at zoom 0.2: 1.9 s to 3.5 to 3.6 s per pan; a do-nothing injected rule as control matched baseline). The layer tree is
identical either way, and every phone pan frame takes the full `PaintArtifactCompositor::Update` in both cases (156 of 156),
but each full update costs about 1.8× more without the tag. Why is not established; it may be how the clip-path's chunk cuts
short Chrome's chunk-merging search. Zoom steps are not the pressing problem, so this stays open.

**Also not shipped:** moving the value box's clip onto an inner element. It follows the same mechanism (a positioned value
box clipped for its "…" truncation) and fixes it in a minimal page, but showed no live gain on its own, because the card
stays flagged by its other elements.

## 7. Ruled out

Knocked out one at a time on the desktop canvas, each within noise for pan or zoom cost: box shadows, filters, opacity,
inner transforms, transitions, z-index, text, masks on icons, the socket glyphs' SVG clip paths, scroll containers, the frame
header SVG clip, the chevron SVGs, and (for paint) the hidden members of collapsed groups, which cost about 1 ms of layout
per zoom step and nothing in paint. The dot grid is about half of zoom-step raster in headless CPU raster only; a GPU
tiles it nearly for free, and React Flow's old background cost the same.

## Corrections made along the way

- A static snapshot of the canvas (desktop CSS) predicted large paint savings from the corner tag; the live phone app showed
  none and a layerize cost. Static pages find candidates; only live repeated runs decide.
- An early phone-probe "flicker" was a bug in the probe (it sampled one pixel as the background colour); fixed, there was no
  flicker.
- A production-build run at "zoom 0.2" was invalid (the hidden zoom buttons left the scale at 0.1 and covered the canvas).
- The prediction that every flagging element must go before a phone card stops re-recording did not hold: removing all of
  them changed nothing on the phone, whose per-frame repaint comes from the viewport's own cull-rect changes.

## Where to go next

1. Cables out of React Flow's per-edge subscriptions (finding 4): the largest remaining per-frame JS, on every device and
   every zoom.
2. An own minimap (finding 5): half the remaining per-frame store work on desktop.
3. The phone layerize puzzle in finding 6, if zoom steps ever matter: trace `PaintArtifactCompositor` chunk counts with and
   without the corner tag's `clip-path`.
