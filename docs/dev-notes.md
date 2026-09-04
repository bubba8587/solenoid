# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### SESSION DIGEST (2026-09-04 — Allocator rename, weights-row removal, domain sweep)

**Renamed Budget Allocator → Allocator**, whole identity: class `AllocatorNode`, kind
`super("Allocator")`, catalog `type:"allocator"`, refused formula token `ALLOCATOR`
(`FRAME_SURFACE_NAMES`), seed `allocator.json`, test `allocator.test.ts`. Standing rule: "rename"
means the type too, not just the label.

**Removed the Allocator's `weights` list socket** — an ordered per-row list wired as a socket
violates orderedColumnsAreFrames (node-coverage §Node design rules: aligned parallel columns →
ONE frame, not parallel list sockets). Weights now come ONLY from the categories frame's Weight
(or Value) column; no column = equal weights. `allocateFrame` lost its `wiredWeights` param; the
card's `BUDGET_CABLE_ONLY` set is gone (only `amount` is cable-only, in Min proportional); height
215→191. Seed already fed weights by column, unchanged. **NOT the same as DecisionMatrix:** its
wired `weights` list is correct and stays — those weights are ORTHOGONAL to the frame (one per
criterion COLUMN, not per row), so they aren't row-aligned parallel data and the aligned-columns
rule doesn't apply. The Allocator's weights were per-ROW (parallel to the category rows), which is
exactly why they belong in a column.

**Allocator-domain sweep.** Author promoted three same-DNA nodes (closed-form linear, solver-free,
tedious by hand), each to ship with a seed → specs in `1.4-plan.md` Track H: **H1 Payoff Planner**
(debt avalanche/snowball, cascade freed payments), **H2 Apportionment** (integer exact-sum split;
recommended a NEW node over an Allocator mode — different inputs/invariant), **H3 Group Cost
Settle** (net + greedy min-transfers). Parked to `deferrals.md`: blend/mix (alligation), loan-term
solver. Break-even ruled a composite run mode (A6), not a node.

**Open problem — personnel scheduling.** Author asked to explore shift fill-in / balancing hours
over a roster. Not yet a spec: assignment/balancing is LP-ish (Hungarian / min-cost-flow), so the
author decides which slice is node-sized and closed-form vs a composite run mode (A6) before a
Track H sibling gets written.

**Decision Matrix / Sensitivity — weights as a criterion-keyed frame.** The DM `weights` socket
went from a positional number list (+ on-card weightMap/normMap boxes) to a `frameIn`: a
`Criterion | Weight | Norm` frame keyed by criterion NAME (orderedColumnsAreFrames). The whole
per-criterion card section, `weightMap`, `normMap`, `criteria`, `wiredWeights`, and the
positional-override path are gone; the card keeps only the fallback Normalize + Summary/Breakdown
toggles. Sensitivity's Scenarios frame is INVERTED to the same shape: rows are criteria, each
number column is one scenario's weights, one optional shared `Norm` column. `decisionMatrix`
(the engine) is unchanged — the node resolves the frame to its existing `(weights[],
normOverrides)` args via `resolveDecisionWeights` / `parseNormalize` in `frameVerbs.ts`. Unwired
DM → all weights 1, default normalize. Seed rewired (a Weights Frame Input, transposed scenarios)
+ retuned; copyPaste + persistenceSweep transient/extra entries pruned; orphan `dm-*` CSS removed.

**Radar reads a frame transposed (chartRadarTranspose).** A frame-fed radar was inverting the
intuitive mapping. Now the number COLUMNS are the spokes and each ROW is one overlaid polygon
named by column 0 (`ChartNode.data()` in `visual.ts`, radar-only; cartesian charts and list-fed
radars untouched). **Per-axis normalization (chartRender):** mixed-unit spokes let the big axis
own the radius, so each spoke is scaled to [0,1] by its own MAX (÷max, not min/max — min/max
pinned the weakest option to the centre), raw value kept on the tooltip, radial ticks hidden. A
new `radarscale` option (axis | shared, on the string and the Chart Builder) opts back to a raw
shared radius. Single-series radars can't self-normalize (one value per spoke), left as-is. Added
a radar off the DM seed's Join output.

**Note frontmatter → frame output.** A frontmatter key whose value is rows of inline objects
(`- {k: v}` block or `[{k: v}, …]` flow) now emits a single `frame` output, columns from the row
keys — the Script node's `{name: value}` row shape (so what one emits the other reads).
`noteFrontmatter.ts` gained brace-aware flow splitting + inline-object parsing + a "frame" field
type; `annotation.ts` builds the FrameValue; NoteNode's field row shows a frame glyph, no retype
picker. Applied to the decision-matrix seed: the screen-scores Note wires its one frame straight
into the Join, dropping the two parallel lists + the Frame from Lists node.

**DM seed layout for whole-canvas Tidy.** Tidy scattered the seed's free-floating Notes, so the
decision-matrix seed got 2 groups (collapsed Podium, expanded Sensitivity) + 7 note-standoffs
(each Note pinned to the node/group it explains; Weights/radar inputs to their consumers), then
re-tuned. Exemplar for the backlogged sweep across the rest of the seed library.

### SESSION DIGEST (2026-09-03 — charts, pie labels, Budget Allocator seed)

Shipped on `develop`: **Pie category labels** reworked to a hand-drawn two-segment leader
(radial stub + horizontal run to a fixed column per side, so a side's labels share one x and
the line meets the text; recharts' own `labelLine` is off). **`pielabels` option** is now
off/outside/inside — inside centres a backing-plated label on the slice, a thin slice (<6%)
keeps the outside leader (`chartRender.tsx`; parse aliases on->outside, center->inside).
**Chart node type picker** is two selects: a family filter + the type OpSelect (the type stays
`op`). **Chart Builder target** is one grouped two-level dropdown whose entries are the Chart
ops + the figure nodes, and the form shows only the keys that type reads (`CHART_BUILDER_TARGETS`
per-op in `chartOptions.ts`); pie gets a Labels select, `color` dropped from pie/radial/funnel
(palette-painted, so it was inert). **Budget Allocator** slimmed to Category + Allocation +
Share (raw fraction); the price comparison moved into the seed — a Join pulls Min/Max back in,
a Computed Column adds Headroom, Share shows as a percent via a per-column `frameFormats` entry;
the pie Chart is minimized and routed to a large Display, styled by a wired Chart Builder.

**Seed layout == Tidy.** The Allocator seed groups its intermediaries (Join+Computed Column,
Chart Builder+minimized Chart) collapsed and standoffs a rectangular note off the allocator's
south face. Authoring rule learned: don't hand-place seed geometry — run `scripts/tune-seeds.mjs
<id>` to bake the app's real tidy/autofit. `seedTune.ts` was UPGRADED to run a **whole-canvas
Tidy** (`autoArrange({skipConfirm})`, the press-T pass) after the per-group fit, so a seed's
shipped layout equals the tidied one. Ran it across the library: 22 seeds re-baked. Held back
**personal-finance** (a full tidy lands its docked FCs + displays inside the expanded
`grp-advisor` box → absorb-on-reconcile; kept hand-composed) and **live-market-data** (FRED
charts CORS-block headless, tuned empty). Survey finding: the abstract-the-intermediaries
pattern only fits pipeline-shaped seeds (the Allocator); the other worked examples are teaching
GALLERIES whose "intermediary" nodes ARE the exhibit and are named by their notes, so grouping
them would hide the lesson.

**OPEN — input→output cable draw regression (React Flow port).** You can no longer drag a
cable starting from an INPUT socket back into an output; hovering an input shows the pan-grab
pointer, not a connect cursor. RF Handles likely only start connections from the source side —
needs the input Handle to be connectable-as-start (or a reverse-connect path). Not yet fixed.

**FYI carried forward:** `color` applies to radar only for a SINGLE-series radar (multi-series
uses the palette, like pie); verify in the screenshot pass and decide whether to keep offering
it. Author sanctioned a screenshot pass over the chart ops + options.

### SESSION DIGEST (2026-09-03 — group lock, socket flip, popup chrome)

Shipped on `develop`: **Group "Lock position"** (right-click / header icon; `lockedPosition`
persisted; drag off + exempt from Tidy/Cleanup, which treat it as a fixed obstacle via a
pinned `separateOverlaps`; the lock also wins over a Standoff band — every `solveStandoffs`
call site pins locked groups, `withLockedGroupsPinned`). **Flip sockets** — a reusable
per-node left↔right socket mirror (`socketFlipStore` + `flippableNodes.ts`; Display is the
first adopter; the cable path threads each flipped endpoint's `CablePosition` into
`getCablePath`; a flipped node lays out as a *predecessor* — `subsetConns` reverses its ELK
edge, portless). **Chart pop-out on every Display chart** + a mechanical `chartPopupCoverage`
sweep so no op ships without one. **Frame Input Form** carries the Source toggle; Source Off
renders through the shared `RecordGrid` (Record chart view, images). **Pop-ups: resize grip**
(centered, `PopupShell` `resizable`) and **canvas cursor** (plain pointer on hover, grab only
while panning; Lock keeps the grab-hand). Small fix: chart-in-Display wheel trap; tidy no
longer stamps a manual width on a collapsed card.

**Pop-up frame alignment (root cause + fix).** The accent header (a child overhanging the
card border) and the card's own border derived from DIFFERENT boxes (content box vs border
box); Chromium rounds each element's border independently at paint, so at a fractional DPR
(Windows 125%/150% scaling) OR a fractional `transform: scale()` the two edges split by ~1px,
width-dependent. Same-width does NOT fix it (still two elements) — this is why the node cards
went to SVG. Fix (`popupChrome.css` + `PopupShell`): the card draws NO border; the body
border is `::after` starting at `--header-h` (published via `useHeaderHeightVar`); the header
carries the real accent border with no overhang — both edges now share the card box (one
rounding basis) so they can't crack. Verified in isolation across fractional widths at DPR 2.5
AND `scale(1.37)`.

**Plan-pull (mechanical items from `1.4-plan.md`).** Landed: **B5** — XLOOKUP/XMATCH accept
an orientation-free 1×N/N×1 matrix as the lookup VALUE (spills over its cells, mirroring the
lookup array; a true 2-D grid stays `#SHAPE!`). **D12** — an optional `weights` socket on the
Shuffle node for a weighted draw without replacement (Efraimidis–Spirakis `-ln(u)/w`; the last
open `python-r-gap` Tier-2 item; the positional `TakeDrop` isn't random, so weights apply to
Shuffle only). **D13 HELD by the author** (2026-09-03): the "perturb ±N%" sensitivity affordance
needs a base-weight source (the node has only `scores` + `scenarios`; each scenario is a full
weight set); left alone pending a base-weights decision.

**OPEN — revert NodeCard's SVG frame (`CardFrame`) to CSS, same principle.** Verified viable:
the one-basis CSS holds under a fractional `transform: scale()` (the canvas zoom, the exact
case the SVG was built for). Plan:
- Card `border: none`; header gets the REAL accent border (2px top+sides), `width:100%`,
  `box-sizing:border-box`, `margin:0` (drop the `-1px` overhang), `box-shadow: inset 0 -1px 0`
  divider. Body border becomes ONE absolute overlay div `.solenoid-node__frame-body`
  (`top:var(--header-h)`, sides+bottom) — a div, not a pseudo, since `::after`=selection ring
  and `::before`=group corner are taken. Both header + overlay derive from the card box → align.
- Move the `__frame-body/cap/divider` color states (hover→`border-strong`, selected/grouped
  exclusions, grouped `2px`+group-color, light `--node-accent-dark`) onto the header + overlay.
- Adjustments the border removal forces: bump `--node-socket-x` (`-6.5px`→`-5.5px`) + input-pill
  (`-7px`→`-6px`) so dots keep straddling the edge (verify cable endpoints); carry the
  `--frame-outset` math onto the overlay (isolate endpoints, palette sample); group-corner
  `::before` inset/radius correction (as the popup needed); `--header-h:0` cards (headerless /
  square-collapse) wrap all four sides — verify Sparkline + collapsed readout; `frameless` FC
  nodes unchanged.
- Sequence: (1) author confirms the POPUP fix at their scaling first; (2) apply to nodes,
  verify live across zoom levels × states (hover/selected/grouped/collapsed/square/FC/resized);
  (3) delete `CardFrame` + `__frame-*` CSS. Net: −1 component, ~−60 lines SVG CSS, node+popup
  framing unified.

### SESSION DIGEST (2026-09-01 — 1.3 shipped; the 1.4 / 2.0 planning pass)

**1.3 is released** (v1.3.0 on `main`; the author: `develop` is level with it). The backlog's
"Cut 1.3" tail is deleted; the backlog is retitled to 1.4 and carries only the two
ratifications (the 1.4 cut, `out-of-scope.md`) plus the ARR pass.
**The deferral review ran as a planning pass.** Every parked, deferred and author-gated idea
(deferrals, the 2.0 flagships, the v2.0 bundles, the pack-composite queue, the open
python-r-gap item) was walked and scored on one rubric — strength, relevance,
complexity, blast radius; no time estimates by order — and placed: **`1.4-plan.md`** (new: the
workbench release — what-if surgery pin/mute/peek/cone + an Optimize run mode, the Record and
table lifts, the widget nodes behind a per-document network permission, the surface
hardening: allowlist A, node-combining round 2, ARR, AI palette back on; every item with a
grounded plan, tests, gate and done-definition; a consolidated author-call list), and
**`2.0-plan.md`** (rewritten: pages, collaboration, the transpiler, conditional formatting,
canvas at scale, value-model extensions, packs as a program, Gantt; the cross-cutting
prerequisites it surfaces — save-format freeze + migration seam, trust on open, desktop
updater, the web-target decision, version history + diff, an accessibility baseline).
Four new bundle docs: `v2.0/20-pages.md` (one editor/engine, pages as view scopes, cross-page
cables as portal stubs), `v2.0/21-collaboration.md` (the author's new surface — accounts,
cloud saves, multiplayer — staged 0→3, Stage 0 serverless and 1.4-pullable; states plainly
what a service costs; the CRDT keyed by the addressable model's names; the trust-on-open security
work), `v2.0/22-canvas-at-scale.md` (headless card metrics → virtualization → worker HIC),
`v2.0/23-conditional-formatting.md` (design-pass prep: a rule is a graph value).
**Reconciles:** `deferrals.md` shrunk to parked-with-no-plan (planned entries moved into the
plans — one home per fact); `release-notes-features.md` reset to the 1.4 shell (the 1.3 list
is at the v1.3.0 tag); **`out-of-scope.md` test 3 / §3 / §11 and decisions R5 rewritten to
the collaboration order** — first framed as "the order reverses them", corrected same
session on the author's point: that doc carries no ARR (`authorRuled`: nothing outside
`rules.md` does) and is a DRAFT, so the "stay out" was agent inference and the order is
the first ruling on that ground — nothing to reverse, only an inference to correct; bundle 08's
"sheets → Groups" becomes "sheets → pages"; bundle 16's status points at 1.4 C1; the docs
index and the v2.0 index list the new docs. Findings from the pass worth a line: the
compositeToolbarReroute flagship is mostly delivered by the RF port's `activeGraph` seam —
1.4 E2 is an audit, not a build; Solver parity fits as a composite RUN MODE (Goal Seek
generalized), not a node; the Excel transpiler's best-fidelity path is Excel Tables →
Frame Inputs with computed columns (structured refs ≈ tableRefSemantics).
**Awaiting the author:** the 1.4 cut; the out-of-scope ratification (now a rewrite of three
sections); the calls listed at the end of `1.4-plan.md` and in `v2.0/21` § Open author calls.
