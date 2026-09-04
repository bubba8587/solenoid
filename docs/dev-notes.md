# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### SESSION DIGEST (2026-09-04b — backward commit review: fixes, reconciles, the input-cable regression)

Walked `develop` backward from `5b3004ac` to `1fd16b6c` (the whole post-1.3 tail) for correctness
and refactor findings; baseline and end state both `tsc` clean, full vitest green.

**Input→output cable regression — ROOT CAUSE + FIX (`flow.css`).** Probed live (a puppeteer DOM
probe, now `scripts/socket-drag-probe.mjs`): at rest the INPUT socket wrapper carries the
pointer-catch halo (`socket.css` `[data-socket-side="input"]::before`, absolutely positioned),
and the RF Handle reset made the Handle `position: static` — a positioned pseudo paints OVER a
static sibling, so `elementFromPoint` on an input dot returned the classless wrapper, the press
went to RF's node drag, and the cursor was the node's `grab`. Outputs carry no rest halo, hence
one-sided. Fix: the Handle reset is `position: relative` (same box, paints above the halo);
every input now starts a cable with the crosshair, an input-started drag lands on an output, and
`socket-box-probe.mjs` (socketBox12) stays clean. React Flow itself already allowed target-first
drags (`connectablestart` on both handle types) — the block was purely the paint order.

**Fixes landed from the review.** (1) Note frontmatter type PINS now respect the value's
dimensionality (`reshapePin` in `annotation.ts`): a pinned `strlist` on a key that becomes
rows-of-objects no longer stringifies each row to `[object Object]`, and a scalar pin on a key
that becomes a list no longer truncates it to its first element — the pin keeps the element
family, the body owns scalar/list/frame; a `frame` guess drops the pin. (2) The DM criterion-key
normalization (`critKey` / `criterionColumn`) has one home in `frameVerbs.ts`; XLOOKUP/XMATCH share
one `spillLookup`. (3) Catalog copy caught up with the redesigns: Sensitivity's Scenarios sentence
was still the row-per-scenario shape, Decision Matrix said nothing about the weights table, the
Allocator listed a two-column output. (4) Chart Builder's select rows are table-driven
(`SELECT_KEYS`, like `TOGGLE_KEYS`); the radar `color` comment no longer claims radar is one series.

**Decision-matrix seed re-cut to the author's seed rule** (groups liberally, standoffs sparingly:
a standoff ONLY pins an unwired explanatory Note to what it explains; a Note wired through its
frontmatter exports needs none; data nodes never standoff to consumers). Dropped `weights→dm`,
`noteScreen→join` (frame-wired) and `radar→join`; added the expanded `grp-dm` (Weights + Decision
Matrix) and retargeted the DM note to it; 4 note standoffs + 3 groups; re-baked with `tune-seeds`.
The backlog sweep item carries the rule.

**Modal keystroke guard (`modalGuard.ts`).** The author hit Enter on the Tidy confirm opening the
Command Palette (the confirm's capture handler prevented default but the canvas's bubble handler
still ran). One predicate, `modalOwnsKeyboard()` — an `aria-modal` dialog / pop-up overlay root in
the DOM, or an open palette / reference / settings / shortcuts — is asked first by
`canvasKeyboard` (F9 excepted), the surface's Escape handler and RF's `onBeforeDelete`; the
per-store checks those handlers each carried are gone. **Timing gotcha:** the overlay answers
in the CAPTURE phase and closes on the same key, and React has removed it from the DOM before
the canvas's bubble handler runs — so a bubble-time DOM check still opened the palette. The
answer is taken by a load-time capture listener and pinned on the event (`keyUnderModal(e)`).
Pinned live by `scripts/tidy-drift-probe.mjs` (T → confirm → Enter → no palette). Backlog item
deleted.

**Tidy converges.** The same probe presses T twice and diffs every model position: no drift on
getting-started / table-verbs / unit-flow / decision-matrix (run while no other tune was writing
seed JSONs — a concurrent `tune-seeds` write HMR-reloads the page and fakes drift). The optional
convergence-loop backlog item is deleted on that evidence.

**Frame shapes are declared per node (the backlog item, landed 6f41d140 by an Opus agent).**
`nodes/frameShapeHook.ts` is the producer sibling of `passthrough()`: a node states its own
output columns via `frameShape(outKey, ctx)` (`ctx.inputShape`, `ctx.wired`); the resolver keeps
only the walk, the Conduit lane case and passthrough forwarding — the `instanceof` chain is
gone. The 17 old rules moved verbatim (two dead spots fixed on the way: Append read sockets it
no longer has; Split Column substituted `,` for a cleared delimiter), and ~23 more producers
gained rules, so ~40 frame outputs carry a static shape instead of 17. Where a verb's columns
provably don't depend on row data the node runs its OWN verb over `emptyFrameOf(shape)` rather
than a second mirror that could drift (Reconcile, Describe, CorrMatrix, Merge Columns,
Allocator, Bind Columns, Headers-demote, Add/Computed Column). `frameShapeCoverage.test.ts`
fails any frame output with no rule unless it is a NAMED data-dependent producer (BuildFrame,
KMeans, PCA, Logistic, the imports/feeds, Cube Rollup, Outliers, list Group By, Tally);
`frameShapeRules.test.ts` pins one case per rule. Follow-up in the backlog: the migrated rules
still read a card literal on a WIRED socket; the new ones gate on `ctx.wired`.

**Two more backlog items landed by the same agent lane.** (1) `857e757c` — the eight migrated
frame-shape rules (Columns, Rename, Group By, Unpivot, Pivot, Join, Split Column, Add Index)
return `null` when their config socket is WIRED instead of projecting the card literal (unwired
paths byte-identical; 8 tests). (2) `f01f6287` — the **Frame Input form-layout hide toggle**:
`FrameInputNode.layoutHidden` (persisted via `INIT_FIELD_ORDER`), a `get activeLayout()` that is
the ONE reader the card and `FrameDisplay`'s `formLayout` share (hidden → the popup Form view
falls back to stacked), a ✕ top-right of the layout box, and the add button reading "Show Form
layout" while a hidden text exists. **Author eyeball:** type a layout, ✕ → box collapses to the
Show button and the popup Form view is stacked; Show (and a reload while hidden) → the exact
text is back, the state survives. End state of the session: `tsc` clean, 285 files / 4888 tests
green; `tidy-drift-probe` clean on cubes / unit-flow / null-and-logical / decision-matrix.

**Seed-layout sweep, batch one (the backlog item, under the rule above; an Opus agent per
batch).** getting-started (the Budget exhibit now wraps its Display + FC; no Notes there),
table-verbs (a Nearest-match group holding the as-of/XLOOKUP exhibit + its Note; the intro Note's
one standoff to Sales), computed-columns (2 exhibit groups, Notes inside; intro standoff to the
first group), pivot-tables (Reshape-the-source group; intro standoff to Orders), cubes (6 exhibit
groups each holding its Note; intro standoff), chart-showcase (9 groups, one per exhibit; no
Notes). Pattern that held everywhere: every unwired explanatory Note became a group MEMBER; the
only standoffs are whole-canvas intro Notes; shared source frames that fan out stay loose. All
re-baked + seed suites green. Gotcha: a peer agent's `src/` saves HMR-reload the tune page
("Execution context was destroyed") — retry the seed on a quiet window. **Batch two** (12 seeds,
one commit each): dimensional-flow 5 groups, equation-solver 7, famous-math 1 (the loose
expression chain + its Note, beside its two pre-existing groups), lambda-helpers unchanged
(already grouped, no Notes), null-and-logical 10, power-features 4 (KEPT its `in-sb ↔ grp-mon`
data standoff — a Note narrates that bar, and Note bodies are the author's; so the three sensors
stay loose), record-cards 2, report-showcase 1 (its `method` Note is frontmatter-wired, no
standoff), script-tour 5, trust-data-quality 3, unit-flow 10 (one per lane, caption Notes
inside), units-by-dimension 2. Every standoff left is a whole-canvas intro Note (plus the
narrated demo bar). sudoku-solver / composite-workbench / zz-scratch / the two held seeds are out
of the sweep. **The author eyeballs the results** — the rule was applied blind; the backlog line
carries the two open calls.

**Docs reconciled:** `node-coverage.md` § Decision support (weights frame, inverted scenarios,
the Note-frame seed), `v2.0/10` grounding, `architecture.md` (modalGuard row), backlog (canvas
cursor + popup 1px + keystroke-guard lines deleted as landed).

**Third mechanical lane (author: "any other mechanical backlog work?").** (1) `04262401` +
`5dfcb29d` — the dependency walk: in-range moves (Tauri plugins, `@xyflow/react` 12.11.6,
mermaid, katex, plugin-react, puppeteer-core) and the long-skipped `@anthropic-ai/sdk` major
(0.115 → 0.123, zero call-site changes; `aiDemo.test.ts` drives the real client over the demo
transport); `vitest` 5 is the one remaining major, untouched; `npm audit --omit=dev` clean. (2)
`e0da2250` — **a flipped node lays out down-and-left**: `elk.layered.considerModelOrder.strategy
= NODES_AND_EDGES` + `crossingMinimization.forceNodeModelOrder` are added to the root options ONLY
when an ELK-visible node is flipped, and flipped nodes are emitted last in `children`; measured
src y 41 / flipped sink y 179 (was 159 / 41); an unflipped layout's options + children order are
pinned byte-identical by a recording-stub test. (3) `b29a71ce` — the sanctioned **chart
screenshot pass**: `scripts/chart-contact-sheet.mjs` (+ a dev-only `__spike.patch(id, fields)`
hook) renders every Chart op × option variant × theme off the chart-showcase seed (46 PNGs).
Reviewed by eye; defects handed to a fix lane (composed drops the label column + title + line
width; radar radial tick labels smear into the polygon; stacked area fills hide the first
series; the expand button + top tick sit on the plot's top edge; bar/scatter thin their category
ticks, scatter leaves a right gutter; radialbar has no legend; bubble names no column). Left
as-is: `color` is inert on a multi-series radar (palette-painted) but works single-series — the
Builder keeps offering it; a question for the author below. **Fixed in `427c1e29`** (verified on
the re-rendered PNGs): Composed takes `labels` + `opts` (col 0 ticks, the title strip,
`linewidth`/`marker` on its line, `MultiTooltip`); `PolarRadiusAxis tick={false}` on every
radar; multi-series area fill alpha 0.18 (two fills overlap to ≈0.33, so the first series
shows; `alpha=` still wins); `PLOT_TOP = 14` on every axed cartesian margin incl. Merge Plots;
row-index category axes `interval={0}` up to 12 rows and categorical scatter x pinned to
`[0, n−1]` with a tick per index; radialbar ring data carries `name`/`fill` so a `Legend`
draws; bubble defaults `xlabel`/`ylabel` to its first two number columns, names x/y/size in
its tooltip, and draws its title (also silently dropped before).

**Author call — Shuffle weights.** A wired `weights` list shorter than the list is now
`#SHAPE!` ("The weights list has N values but the list has M", the Sort-by rule), not a silent
uniform shuffle; a longer list is fine (extras ignored). `#SHAPE!` over `#VALUE!` because the
house vocabulary reserves `#SHAPE!` for a length/dimension mismatch (`errorValue.ts`).

**Author call — radar negatives.** Under the per-axis scale a negative value plots at the centre
(clamped to 0; the spoke's max is the max VALUE, not |value|): "there's no sensible correct way"
to place a negative on a radar. The raw value still rides the tooltip.

**Author call — the Allocator seed** keeps its "Budget Allocator" title and Note (the seed is
about a budget; the node is the general Allocator).

**Walk stop point.** Below `main` the walk covered `af410b48` down to `45130f0c` (the Add-menu
per-word search + one-edit matcher, the env.ts dissolve, the minimap recolor, the four RF-port
fixes: collapsed-group tow, the FlowCableEdge hook order, the FC chip 1px step + caret
placement, the delete verb + removed-node skip in the pass) — all clean; older is the
author-smoked 1.3 release tail, not re-walked.

**Reviewed clean (no action):** frame-shape resolver DM/Note rules (match `decisionColumns`;
scaffolding for the declarative-shape backlog item), radar transpose + ÷max normalization, the
Allocator verb + `allocateOps` modes, weighted Shuffle key, XLOOKUP matrix spill, locked-group
obstacle separation, flip-edge reversal (OR is right: both ends flipped still puts the reader
left), pop-up one-basis frame, the elk import retry.

**Scheduling slice, reworked (AUTHOR-GATED — `1.4-plan.md` Track H § Scheduling slice).** The
author: the first pass was decent but wanted calendar/schedule-shaped, solver-free where
possible, useful to a simplistic user. Now: **hours balancing is the Allocator** (a seed + "range"
copy, no node); **H4 Rota** (Shifts × People → Assignments + Load, round-robin or
fewest-hours-first, explicit Unfilled rows, greedy and says so); **H5 Spread over dates** (a total
phased over a date range: every day / working days + holidays / weekday weights / ramp / month
length → Date · Amount · Cumulative); **H6 Schedule** (Tasks with durations + predecessors →
Start · Finish · Float · Critical, CPM passes on working days — the data half of the 2.0 Gantt);
**H7 Common free time** (availability windows → when everyone, or any N, is free ≥ M minutes).
Hungarian matching and Erlang staffing parked to `deferrals.md`. Nothing starts until the author
picks; a backlog line carries the gate.

**Questions for the author** (not blocking, answered whenever):
- Chart Builder offers `color` for radar, but it only paints a SINGLE-series radar (a frame-fed
  multi-series one uses the palette). Keep offering it, or drop it from `RADAR_KEYS` like pie?

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

**Personnel scheduling** — the author's ask (shift fill-in / balancing hours over a roster) got a
first pass this session (Hours Balancer as an Allocator mode, Hungarian Shift Assignment, a
round-robin Rotation generator, Erlang staffing), unanswered here; reworked in 09-04b below.

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

