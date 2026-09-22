---
aliases: ["Cable rendering knobs"]
tags: [spec, canvas]
---
<!-- [[C91]] cableWalkRouter, [[D17]] relaysTransparent -->

# Spec: Cable rendering knobs

Serves [[C91]] cableWalkRouter (the router and the spline) and [[D17]] relaysTransparent (ribbons and Conduit runs: the Conduit is wiring, so the run is the user's entity). It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

This spec covers how a wired cable is drawn: the three cable shapes (spline, diagonal and straight), per-socket exit angles, ribbons (several Conduit lanes drawn as one wide cable), and Conduit runs (the whole wire through a chain of Conduits). The drawing lives in `flow/FlowCableEdge.tsx`, the paths in `cablePaths.ts`, the ribbon logic in `ribbonCable.ts`, and the run walk in `conduitTrace.ts`.

## Names

- **Conduit** is the block bundler node (`ConduitNode`). It has up to `CONDUIT_MAX_LANES` (8) lanes; lane `i` passes input `in_i` straight through to output `out_i`.
- **Ribbon** is the bundled cable entity: 2 or more Conduit lanes drawn as one.
- There is no Manifold node type. A save that names one loads it as a Placeholder, like any unknown type.

## Exit angles

Per-socket exit-angle overrides live in `cableAngleStore`, keyed by `${nodeId}::${socketKey}`. The Conduit writes one for every lane, both inputs and outputs, set to its snapped rotation angle, so cables leave and arrive perpendicular to its faces (see [[conduit-lane-faces]]). `FlowCableEdge` reads the store and passes `sourceAngleDeg` / `targetAngleDeg` to `getCablePath`. A socket with no override uses its cardinal side.

## Ribbons

A ribbon forms when 2 or more cables leave one visible Conduit's outputs for the same entity: another visible Conduit's inputs, or one collapsed group's combined input pill. `ribbonForConnection` derives membership fresh on every render and never stores it. Ghost cables (`cableGhostStore`) never join a ribbon. Members are sorted by lane index, and the lowest lane is the representative (`repId`).

Drawing:

- The ribbon renders as one wide, neutral trunk with flat (butt) caps. Near each Conduit face it fans out into per-lane branches, or it lands whole on a group's combined pill.
- The representative draws the trunk. Every member draws its own fan branches to its own sockets. Branch slots spread across the trunk width, ranked by lane order on each side, so fans cannot cross, and no member looks up another lane's position.
- The trunk runs from a merge point `RIBBON_SPLIT` (24) past the source Conduit's output face to a split point `RIBBON_SPLIT` before the target Conduit's input face.
- Hover, selection and delete treat the ribbon as one entity. Hover is shared through `ribbonHoverStore`, selecting selects the `repId`, and a canvas delete removes all members.

Separation. A ribbon splits back into ordinary cables while either of its Conduits is selected. Selecting one of those separated lanes pins the separation open (`pinRibbonSeparation`, keyed by the selected cable id), so the ribbon stays apart while that cable is selected. The pin expires by itself once the cable is no longer selected.

Flow beads. Every cable animates beads that travel `FLOW_PERIOD` (72) px per `FLOW_DURATION` (2.25) s; these must match `.solenoid-cable-flow` in `canvas.css`. The bead overlay must keep `strokeLinecap="round"`, because each bead is a 0.01-long dash that a butt cap would flatten into a sliver. Within a ribbon, each segment gets a negative `animation-delay` equal to its upstream length, so beads flow continuously from socket to fan to trunk to fan. The source fan's length is taken as `RIBBON_SPLIT`; real per-lane fans differ by a few pixels, which is accepted. Lanes that do not draw the trunk still compute it, to learn its length for their own fan's delay.

### Ribbons out of a collapsed group

The inverse case (`kind: "groupSource"`) is a Conduit hidden inside a collapsed group whose 2 or more outputs leave the group. It mirrors the combined input pill:

- `recomputeGroupCollapse` folds all of the hidden Conduit's crossing `out_*` sockets into one combined readout row and pill on the group (`RetainedTerminal.lanes`).
- `groupSourceRibbon` detects the case. Members are filtered to one shared destination: a visible Conduit or a collapsed group.
- `FlowCableEdge` draws a short trunk leaving the pill toward that destination. The pill is the bundling point, so there is no source fan. A visible Conduit destination gets a target fan; a collapsed-group destination takes the trunk whole on its pill.
- Beads are phase-chained across trunk and fan as usual. There is no wide output stadium.

## Conduit runs

A cable is one segment of a wire, not the whole wire ([[D17]] relaysTransparent). A Conduit is wiring, not computation, so the entity the user means is the **run**. `conduitPath` in `conduitTrace.ts` (unit-tested in `conduitTrace.test.ts`) finds it in two walks:

1. **Upstream, a chain.** From the clicked cable, while its source is a Conduit, step to the one cable feeding the matching input lane (an input lane takes at most one cable). Stop at a node that is not a Conduit, or at a Conduit whose input lane is unwired; that Conduit is then the origin.
2. **Downstream, a tree, from the origin.** From the origin cable, follow every cable out of each Conduit's matching output lane (one output lane can feed many cables). A cable into a non-Conduit is a terminal. A Conduit lane with nothing wired out is also a terminal, where the run dies.

The downstream walk must start at the origin, not at the clicked cable. Otherwise clicking one branch of a fan-out hides its siblings, and two segments of the same run resolve to different runs, which breaks the inspector's "is this selection exactly one run?" test. Cycles (a `#CIRC!` Conduit loop) are broken by a `seen` set, and `MAX_HOPS` (512) caps pathological fan-out.

The run has two consumers:

- The **Cable inspector** reports the run's ends: From is the origin, there is one To row per terminal, and a quiet Via row names the Conduits crossed. It reads the value, annotation and Frame shape from the origin.
- **Double-clicking a cable** selects every segment of the run (`selectRun`), so the whole path highlights and Delete removes all of it. It does nothing for a run of one segment. Ctrl, Cmd, or the touch multi-select toggle adds the run to the current selection instead of replacing it.

Double-click is detected as `e.detail >= 2` inside `onClick`, not through `onDoubleClick`, because the surface sets `zoomOnDoubleClick={false}`. The `detail` check must come before the single-click select and deselect branches, or the second click toggles the selection off first.

## Diagonal and straight: the walk router

Both modes route through one router, `routeWalk` in `cablePaths.ts`, parametrized by the number of compass headings: `div = 8` gives 45° segments and turns (diagonal), and `div = 4` gives 90° segments and turns (straight), drawn with rounded `Q` corners of radius `CORNER_RADIUS` (8, capped at half the shorter adjacent leg). Every cable in these modes uses it, with or without an angle hint. Its constraints hold by construction, with no fallback to a sharper turn:

- A rigid stub leaves and enters each socket along its exact direction.
- Every other segment runs on a compass heading.
- Every turn is exactly one compass step.

A route is a **walk**: a sequence of compass headings where each leg differs from the last by one step. The candidates are the family "turn back `b` steps, forward `b + r + e` steps, back `e` steps", where `r` is the net rotation from the exit heading to the entry heading, tried in both rotation directions.

Selection picks the **shortest solvable walk overall**. The sort order (fewest turns, then the preferred rotation direction) only settles exact ties. Length must stay the primary criterion: a walk becomes feasible at exactly the length of its own wider extension, which was already competing, so the handoff between walks is seamless. Ranking by turn count first turns those handoffs into visible jumps.

Leg lengths come from a closed-form solve (`solveWalk`):

- A leg between two turns in the same direction keeps a minimum length. Collapsing it would fuse two turns into a sharper corner.
- A leg between two opposite turns may collapse to zero, merging its neighbors into one straight run.
- A leg next to an **off-grid stub** (a rotated socket direction that falls between compass headings) is held open at the minimum. Collapsing it would fold the snap offset into the next turn, which could make a turn of up to 135° in straight mode.
- The remaining displacement is split between the unique pair of adjacent headings in the walk that bracket it, spread evenly over the legs on each heading. This is what centers the diagonal of a Z between its two straight runs.

Sizes scale with the socket distance `dist`. The stub is `min(14, dist / 4)` and the staircase minimum is `min(14, dist / 8)`. The minimum must shrink faster than the stub at close range, or every walk becomes unsolvable. If no walk solves, the minimum halves and the search retries, down to 0.25, so the router always terminates with its constraints intact.

The renderer drops a vertex only when it is within 0.01 of the previous one (`DEDUP_EPS`). This must stay well under a pixel: a coarser value deletes real tiny vertices and skews the neighboring headings off-grid.

The remaining discontinuities are inherent:

- Sockets closer than 15 (`STRAIGHT_THRESHOLD`, Euclidean distance, deliberately not per axis) draw as a straight line.
- Two routes of equal length can swap, including the mirror flip when sockets face each other head-on.

Property tests in `cablePaths.test.ts` check the invariants by machine, plus continuity under simulated 0.5 px drags: a large jump is allowed only between routes of equal length. Keep them passing when touching the router.

## Spline

The spline is one cubic curve (`getAngleBezierPath`) whose control arms, of length `max(40, dist × 0.4)`, lie along the exit and entry directions (the angle hint, or the socket's cardinal side). The curve leaves each socket exactly along its direction and may bend right away; there is no rigid straight lead. It collapses to a straight line under the same Euclidean `dist < 15` test, so a target that merely lines up on one axis with the source (for example, directly below an east-facing Conduit) still gets a curve.
