# Solenoid — Cable Routing System (original design spec)

> **Status: HISTORICAL (superseded).** This is the React-Flow-era spec the
> cable system grew from. The built system diverged substantially:
> - Cable shapes are live, but diagonal/straight route through the
>   **walk-enumeration router** and spline is a tangent-exact cubic — see
>   "Cable rendering knobs" in `CLAUDE.md` and `cablePaths.ts` (+ property
>   tests). The naive midpoint geometry below was replaced wholesale.
> - The two-arm node specced here as "Conduit" shipped, was renamed
>   **Manifold**, and was removed entirely 2026-06-19. Today's **Conduit** is
>   the block bundler whose outputs travel as a **Ribbon** cable — see
>   dev-notes ("The great renaming", and the deprecated-baggage cleanup).
> - Still genuinely future: collision avoidance (§2) and per-cable shape
>   overrides — tracked in `backlog.md`.
>
> Kept for the design rationale; don't implement from it.

Terminology (as of this spec):
- **Cable** — the user-facing name for the visible line connecting
  two nodes (user-facing language is always "cable").
- **Conduit** — [historical spec term; that two-arm node became Manifold, now removed] the routing node that cables pass through.

---

## 1. Cable shape / draw types

User-selectable, applied graph-wide (per-cable override deferred).
Three modes:

- **Spline / curve** — soft bezier between endpoints (current default).
- **Straight (right-angle)** — segments run horizontal or vertical
  only; turns at 90°. Circuit-board aesthetic.
- **Diagonal** — segments run horizontal, vertical, or 45°. Halfway
  between the other two; reduces dogleg length without committing to
  bezier organic shape.

Straight and diagonal modes will eventually snap to the grid
(`grid-system.md`) — once the grid system lands, the shape geometry
keys off it. Pre-grid, the geometry is naive (straight uses
midpoint-based right angles; diagonal uses one 45° segment in the
middle).

## 2. Collision avoidance — DEFERRED

(Not part of this build push — multi-week ELK / smart-edge work per
`node-graph-ux-research.md`. Kept in the spec so the long-term shape
is clear, but explicitly out of scope for the current Cables &
Conduits visual buildout.)

- **Avoid nodes** — cables route around node bounding boxes instead
  of cutting through.
- **Avoid cables** — cables that would cross another prefer to run
  parallel where they share direction, then split at the last
  reasonable point. At unavoidable crossings, draw a small bridge
  hop (electrical-schematic convention).

Both toggles act on top of the chosen shape — straight + avoid nodes
is a circuit-board feel; spline + avoid cables is an organic "data
clusters flowing alongside each other" feel.

## 3. Conduit nodes — full feature set

The Conduit node grows from "simple dot pass-through" into a real
routing primitive. Each new feature is its own slice.

### 3a. Dynamic matched lanes

A Conduit carries N matched lanes (one input handle and one output
handle per lane, pairing by index). N is **not** a user setting —
the Conduit grows and shrinks based on connections:

- `data.inputs` and `data.outputs` always declare all
  `CONDUIT_MAX_LANES` (currently 16) handles, so the connection
  validator works for any lane index.
- Visible lane handles = (highest used lane index + 1) + 1 phantom
  slot. The phantom is the trailing dimmed handle on each side; drop
  a cable onto it to grow the Conduit by one lane.
- A pristine Conduit shows one phantom slot per side (no real lanes
  yet).
- Disconnect drops the visible count back down, but mid-lane gaps
  are kept as empty slots (true compaction across gaps is a follow-
  up since renumbering live edges is messy).

### 3b. Tightness and the perpendicular-face handle layout

Lane handles sit on **the perpendicular faces** of each arm, not on
its central axis. Each face carries N + 1 handles spaced by that
side's tightness:

- Input handles on the perpendicular-CW face of the input arm
- Output handles on the perpendicular-CCW face of the output arm

When both arms are at the **same angle** (the default — both 90°,
pointing down) the arms overlap into a single bar with inputs on the
left face and outputs on the right face. That's the natural form for
LTR cable flow: cables enter the bar from the left, exit to the
right.

Tightness still controls the spacing between adjacent handles on a
side, so divergent tightnesses give one face tightly bunched handles
and the other loose ones — the wiring-harness / cable-comb form
factor expressed perpendicular to the arms.

### 3c. Independent input / output angles

A Conduit is **two thin rectangular arms meeting at a central pivot**.
Each arm has its own settable angle (multiples of 15°). Each arm's
length is driven by `lanes × that side's tightness`. The arms can
point any direction; the pivot is the bend.

- Default: input arm pointing 180° (left), output arm pointing 0°
  (right) → a flat horizontal pass-through.
- Any non-180-apart pair gives a visible bend at the pivot
  (e.g. inputAngle=180, outputAngle=90 → input from the left, output
  to the bottom).
- Each arm's handles sit along its central axis from the pivot
  outward at `(i + 0.5) × tightness` per lane.
- The React Flow Handle Position for each arm is the closest
  cardinal direction to that arm's angle, so cable bezier curves
  enter / exit on the correct side.

Keyboard rotation shortcuts come later — currently the inspector
toolbar carries ↺ / ↻ steppers per arm.

### 3d. Conduit data model

```
inputAngle:       number   (degrees, default 90 — input arm points down)
outputAngle:      number   (degrees, default 90 — output arm points down,
                            overlapping the input arm)
inputTightness:   number   (px, default 12)
outputTightness:  number   (px, default 12)
inputs:           full CONDUIT_MAX_LANES map (always)
outputs:          full CONDUIT_MAX_LANES map (always)
out_0..out_15:    per-lane mirrored values, written on update
```

A default Conduit is a short vertical bar with one phantom slot per
face. As cables are dropped on phantom slots, the bar grows.
Tightnesses and angles can be tuned in the inspector; the lane count
is implicit in the connections themselves.

## 4. Implementation order

Active sequence. Each step is its own slice with its own visible
artifact.

1. ✅ **Terminology** — rename wire → cable everywhere.
2. ✅ **Cable shapes** — three shape modes with a graph-level selector.
3. ✅ **Multi-cable Conduit + tightness** — configurable matched-lane
   count with independent input/output tightness. Inspector toolbar
   on the Conduit when selected. Harness/comb visual form emerges
   when tightnesses diverge.
4. ✅ **Angled Conduits** — two-arm pivot geometry with independent
   input and output angles (15° steps). Body is an SVG with two
   rotated `<rect>` arms plus a pivot disc; handle positions match
   each arm's direction. Inspector exposes ↺ / ↻ steppers and a
   degree readout for each arm.
5. (Deferred) Avoid-nodes routing — ELK or smart-edge integration.
6. (Deferred) Avoid-cables + intersection bridge UI.
7. (Deferred) Per-cable shape / avoidance overrides.

Polish layers stack on top of these as needed: hover glows on cables,
animations on Conduit insertion / shape change, etc.
