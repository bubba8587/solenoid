---
aliases: ["Cable rendering knobs"]
tags: [spec, canvas]
---
<!-- [[B10]] reactFlowView, [[C10]] socketLattice -->

# Spec: Cable rendering knobs

Serves [[B10]] reactFlowView (the router and the spline) and [[C10]] socketLattice (ribbons and Conduit runs: the Conduit is wiring, so the run is the user's entity). It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

This spec covers how a wired cable is drawn: the three cable shapes (spline, diagonal and straight), per-socket exit angles, ribbons (several Conduit lanes drawn as one wide cable), and Conduit runs (the whole wire through a chain of Conduits). The drawing lives in `flow/FlowCableEdge.tsx`, the paths in `cablePaths.ts`, the ribbon logic in `ribbonCable.ts`, and the run walk in `conduitTrace.ts`.

## Names

- **Conduit** is the block bundler node (`ConduitNode`). It has up to `CONDUIT_MAX_LANES` (8) lanes; lane `i` passes input `in_i` straight through to output `out_i`.
- **Ribbon** is the bundled cable entity: 2 or more Conduit lanes drawn as one.
- There is no Manifold node type. A save that names one loads it as a Placeholder, like any unknown type.

## Drawing one cable

`FlowCableEdge` is the one edge type of both surfaces.

- The visible strokes are RF `BaseEdge`s styled inline, and a separate named hit path (`.solenoid-cable-hit`) is the one pointer target ([[react-flow-surface-contract]]). The hit path is wider than the stroke: `CABLE_HIT_W` is 28 on a coarse pointer and 20 otherwise, a ribbon trunk's is 30 or 22, and a fan branch's 24 or 14.
- Where a cable meets a compressed Conduit, the block sits under the cable, so the hit coverage (never the visible path) is dashed short of the block's endpoints and the block stays clickable.
- The resting opacity is 0.72, 0.9 when hovered or selected, and 0.65 for a ghost. The HTML-in-Canvas layer mirrors the resting value, so change the two together.
- Every store subscription is a per-edge selector, so a notify re-renders an edge only when its own derived value moved. A compute pass bumps `cableValueStore` for every cable, and only a combo cable whose color changes needs to repaint. A standalone cable watches only its own hover flag; ribbon members share their appearance. Conduit geometry moves ribbons and also the lane end of a plain cable into a Conduit, so an unribboned lane re-anchors when the block expands.
- Each edge caches its path, keyed on the geometry that feeds the router, and evicts the entry on unmount so the cache can't grow across create and delete churn.
- All of the edge's hooks run before its hidden-cable early return, because collapsing a group flips that condition during the edge's life, and a hook below it would break React's hook order.
- An endpoint on a collapsed group's hidden member is redirected to the group's pill for that socket ([[group-collapse]]).
- A ribbon whose destination is not mounted yet (its first frame), or whose Conduit has not yet published its layout, draws as a plain cable for that frame.

**The entrance draw-on.** On the marketing stages (`.sol-flow-reveal`), every cable draws itself from its source socket to its target at mount, all at once and linearly, after the cards have popped in (`sol-cable-draw 0.72s linear 0.28s`). The dash offset reels to zero, and `pathLength={1}` normalizes the dash to the path's own length, so it stays exact while RF is still settling the handle positions. Ghosts skip it, and so does `prefers-reduced-motion`, read once per session. The stages also want flow beads, but must not touch the stored setting, since the site shares the app's origin and local storage, so a reveal stage turns beads on locally once the draw-on has finished.

## Exit angles

Per-socket exit-angle overrides live in `cableAngleStore`, keyed by `${nodeId}::${socketKey}`. The Conduit writes one for every lane, both inputs and outputs, set to its snapped rotation angle, so cables leave and arrive perpendicular to its faces (see [[conduit-lane-faces]]). `FlowCableEdge` reads the store and passes `sourceAngleDeg` / `targetAngleDeg` to `getCablePath`. A socket with no override uses its cardinal side. Angles are in degrees clockwise from +X (0 is right, 90 is down), the same convention as `AngleDial`.

## Ribbons

A ribbon forms when 2 or more cables leave one visible Conduit's outputs for the same entity: another visible Conduit's inputs, or one collapsed group's combined input pill. The destination resolves to a collapsed group's pill first, because a hidden target Conduit belongs to its group, and to a visible Conduit's lane input otherwise. `ribbonForConnection` derives membership fresh on every render and never stores it. Ghost cables (`cableGhostStore`) never join a ribbon. Members are sorted by lane index, and the lowest lane is the representative (`repId`).

Drawing:

- The ribbon renders as one wide, neutral trunk (`RIBBON_WIDTH` 7.2, `#8a909c`) with flat (butt) caps. Near each Conduit face it fans out into per-lane branches, or it lands whole on a group's combined pill.
- The representative draws the trunk. Every member draws its own fan branches to its own sockets. Branch slots spread across the trunk width, ranked by lane order on each side, so fans cannot cross, and no member looks up another lane's position.
- The trunk runs from a merge point `RIBBON_SPLIT` (24) past the source Conduit's output face to a split point `RIBBON_SPLIT` before the target Conduit's input face.
- Hover, selection and delete treat the ribbon as one entity. Hover is shared through `ribbonHoverStore`, selecting selects the `repId`, and a canvas delete removes all members.

Separation. A ribbon splits back into ordinary cables while either of its Conduits is selected. Selecting one of those separated lanes pins the separation open (`pinRibbonSeparation`, keyed by the selected cable id), so the ribbon stays apart while that cable is selected. The pin expires by itself once the cable is no longer selected: pins are pruned on read.

Lane geometry. The ribbon's ends are computed, never measured. The lane constants are shared with `ConduitComponent`, which publishes each Conduit's live angle and scale; connections subscribe, so the trunk tracks an expand or collapse. The layout is null until the Conduit has mounted and published it. A cable can land a frame before the component republishes its lane count.

Flow beads. In animated mode (`cableFlowStore`, persisted), every live cable carries a stream of beads from output to input. A bead is a near-zero dash with a round cap, so it is a circle as wide as the stroke; the long gap spaces the beads out. The negative dash offset drives them along the path, which is drawn source to target, and the animation distance equals one dash period, so beads move at a constant speed in pixels whatever the cable's length, and the loop is seamless. They travel `FLOW_PERIOD` (72) px per `FLOW_DURATION` (2.25) s; these must match `.solenoid-cable-flow` in `canvas.css`. The bead overlay must keep `strokeLinecap="round"`, because each bead is a 0.01-long dash that a butt cap would flatten into a sliver. Within a ribbon, each segment gets a negative `animation-delay` equal to its upstream length, so beads flow continuously from socket to fan to trunk to fan. The source fan's length is taken as `RIBBON_SPLIT`; real per-lane fans differ by a few pixels, which is accepted. Lanes that do not draw the trunk still compute it, to learn its length for their own fan's delay.

### Ribbons out of a collapsed group

The inverse case (`kind: "groupSource"`) is a Conduit hidden inside a collapsed group whose 2 or more outputs leave the group. It mirrors the combined input pill:

- `recomputeGroupCollapse` folds all of the hidden Conduit's crossing `out_*` sockets into one combined readout row and pill on the group (`RetainedTerminal.lanes`).
- `groupSourceRibbon` detects the case. Members are filtered to one shared destination: a visible Conduit or a collapsed group.
- `FlowCableEdge` draws a short trunk leaving the pill toward that destination. The pill is the bundling point, so there is no source fan. A visible Conduit destination gets a target fan; a collapsed-group destination takes the trunk whole on its pill.
- Beads are phase-chained across trunk and fan as usual. There is no wide output stadium.

## Conduit runs

A cable is one segment of a wire, not the whole wire ([[type-propagation-on-in-place-socket-retype#Relays are transparent]]). A Conduit is wiring, not computation, so the entity the user means is the **run**. `conduitPath` in `conduitTrace.ts` (unit-tested in `conduitTrace.test.ts`) finds it in two walks:

1. **Upstream, a chain.** From the clicked cable, while its source is a Conduit, step to the one cable feeding the matching input lane (an input lane takes at most one cable). Stop at a node that is not a Conduit, or at a Conduit whose input lane is unwired; that Conduit is then the origin.
2. **Downstream, a tree, from the origin.** From the origin cable, follow every cable out of each Conduit's matching output lane (one output lane can feed many cables). A cable into a non-Conduit is a terminal. A Conduit lane with nothing wired out is also a terminal, where the run dies.

The downstream walk must start at the origin, not at the clicked cable. Otherwise clicking one branch of a fan-out hides its siblings, and two segments of the same run resolve to different runs, which breaks the inspector's "is this selection exactly one run?" test. Cycles (a `#CIRC!` Conduit loop) are broken by a `seen` set, and `MAX_HOPS` (512) caps pathological fan-out.

`conduitPath` returns every cable on the run (upstream first, the clicked one included), the origin (a Conduit only when its lane is unfed), the terminals (a Conduit only when its lane is unused), and `via`, the Conduits the run passes through, upstream to downstream.

The run has two consumers:

- The **Cable inspector** reports the run's ends: From is the origin, there is one To row per terminal, and a quiet Via row names the Conduits crossed. It reads the value, annotation and Frame shape from the origin.
- The inspector opens for exactly one selected cable or one complete Conduit run (what double-clicking a cable selects); any other multi-selection is ambiguous and shows nothing. A single ribbon cable bundles several lanes under one id, so it shows nothing either; a selected run is exempt because its ends are resolved. It reads `cableValueStore` and computes nothing: every terminal receives the origin's output unchanged, so one Value row speaks for the whole run. The Frame shape row shows only for a `frame` cable whose static shape resolves. The close button folds the panel to a chip and keeps the selection; deselecting is a canvas click.
- **Double-clicking a cable** selects every segment of the run (`selectRun`), so the whole path highlights and Delete removes all of it. It does nothing for a run of one segment. Ctrl, Cmd, or the touch multi-select toggle adds the run to the current selection instead of replacing it.

Double-click is detected as `e.detail >= 2` inside `onClick`, not through `onDoubleClick`, because the surface sets `zoomOnDoubleClick={false}`. The `detail` check must come before the single-click select and deselect branches, or the second click toggles the selection off first.

## Inserting a Conduit

Insert Conduit on the cable context menu (`insertConduitForCables`, `canvasActions.ts`) routes the chosen cables through new Conduits.

1. Each cable end is placed at its socket, or, when the socket is on a hidden member of a collapsed group, at that group's pill, since the member still measures at its expanded position while its cable is drawn to the pill.
2. Cables group into one lane per source socket, not per cable, so a fan-out rides the Conduit once and re-fans from its output. A lane's midpoint and direction are the means over its cables.
3. Lanes are sorted top to bottom (then left to right), so lane 0 is the top row and the spliced cables don't cross.
4. Lanes are chunked `CONDUIT_MAX_LANES` at a time. Each Conduit lands at its chunk's centroid, rotated to the mean flow direction snapped to 45°.
5. A Conduit renders behind nodes, so a centroid landing on a card would leave it invisible and unclickable. It is nudged below any covering card, up to four passes. Expanded groups are background boxes and don't count; collapsed groups are opaque obstacles; hidden members are skipped, since they still measure.
6. The original cables are removed and rewired through the lanes, and the selection clears.

## Diagonal and straight: the walk router

Both modes route through one router, `routeWalk` in `cablePaths.ts`, parametrized by the number of compass headings: `div = 8` gives 45° segments and turns (diagonal), and `div = 4` gives 90° segments and turns (straight), drawn with rounded `Q` corners of radius `CORNER_RADIUS` (8, capped at half the shorter adjacent leg). Every cable in these modes uses it, with or without an angle hint. Its constraints hold by construction, with no fallback to a sharper turn:

- A rigid stub leaves and enters each socket along its exact direction.
- Every other segment runs on a compass heading.
- Every turn is exactly one compass step.

A route is a **walk**: a sequence of compass headings where each leg differs from the last by one step. The candidates are the family "turn back `b` steps, forward `b + r + e` steps, back `e` steps", where `r` is the net rotation from the exit heading to the entry heading, tried in both rotation directions.

Selection picks the **shortest solvable walk overall**. The sort order (fewest turns, then the preferred rotation direction) only settles exact ties, and the sort is stable, so remaining ties keep their insertion order: the preferred rotation first, then the small `b`. The rotation preference is continuous in the endpoints, so it flips only at genuinely ambiguous, collinear head-on configurations. Heading indices stay unwrapped through the walk math (a heading of −3 or 9 is fine), so adjacency is plain integer succession, and only the final direction lookup wraps. Length must stay the primary criterion: a walk becomes feasible at exactly the length of its own wider extension, which was already competing, so the handoff between walks is seamless. Ranking by turn count first turns those handoffs into visible jumps.

Leg lengths come from a closed-form solve (`solveWalk`):

- A leg between two turns in the same direction keeps a minimum length. Collapsing it would fuse two turns into a sharper corner.
- A leg between two opposite turns may collapse to zero, merging its neighbors into one straight run.
- A leg next to an **off-grid stub** (a rotated socket direction that falls between compass headings) is held open at the minimum. Collapsing it would fold the snap offset into the next turn, which could make a turn of up to 135° in straight mode.
- The remaining displacement is split between the unique pair of adjacent headings in the walk that bracket it, spread evenly over the legs on each heading. This is what centers the diagonal of a Z between its two straight runs.

Sizes scale with the socket distance `dist`. The stub is `min(14, dist / 4)` and the staircase minimum is `min(14, dist / 8)`; 14 is `DIR_LEAD`. The minimum must shrink faster than the stub at close range, or every walk becomes unsolvable. If no walk solves, the minimum halves and the search retries, down to 0.25, so the router always terminates with its constraints intact.

Straight mode rounds each corner with a radius capped at half the shorter adjacent leg, so two rounds never overlap, and a vertex that sits on a straight run is dropped. The renderer drops a vertex only when it is within 0.01 of the previous one (`DEDUP_EPS`). This must stay well under a pixel: a coarser value deletes real tiny vertices and skews the neighboring headings off-grid.

The remaining discontinuities are inherent:

- Sockets closer than 15 (`STRAIGHT_THRESHOLD`, Euclidean distance, deliberately not per axis) draw as a straight line.
- Two routes of equal length can swap, including the mirror flip when sockets face each other head-on.

Property tests in `cablePaths.test.ts` check the invariants by machine, plus continuity under simulated 0.5 px drags: a large jump is allowed only between routes of equal length. Keep them passing when touching the router.

Why one walk router: the heuristic routers it replaced (`getDiagonalPath`, `getSmoothStepPath`, `withAngleLeads`) needed fallbacks, and the fallbacks produced kinks. Constraints that hold by construction leave nothing to fall back from. **Reopen if:** cables need obstacle avoidance, which no walk family provides.

## Spline

The spline is one cubic curve (`getAngleBezierPath`) whose control arms, of length `max(40, dist × 0.4)`, lie along the exit and entry directions (the angle hint, or the socket's cardinal side). The curve leaves each socket exactly along its direction and may bend right away; there is no rigid straight lead. It collapses to a straight line under the same Euclidean `dist < 15` test, so a target that merely lines up on one axis with the source (for example, directly below an east-facing Conduit) still gets a curve.
