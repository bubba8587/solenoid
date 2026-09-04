# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### SESSION DIGEST (2026-09-04c — three agents in worktrees; the finance merges land)

Three Opus agents (Han = Lead on `develop`, Chewie and Lando on their own branches in git
worktrees, merged by Han); the author remote, one docs point per turn.

**The three finance merges, released by the author's Set-card verdict.** Discount Security
(TBILLEQ/TBILLPRICE/TBILLYIELD, DISC/PRICEDISC/YIELDDISC/INTRATE/RECEIVED, PRICEMAT/YIELDMAT),
Accrued Interest (ACCRINT / ACCRINTM as a Periodic / At-maturity toggle, the Irr precedent) and
Bond Pricing (PRICE/YIELD + the four ODD* ops). Each card's sockets follow a per-op key table
after the shared settlement/maturity pair; the switch prunes departing cables first
(onePrunePath), keeps shared inputs' cables and literals, and reorders sockets per the new
op. One mechanism for all three: `keysDroppedBy` + `reshapeInputs` (`finance.ts` § Spec-table
op cards) and `makeSpecOpComponent` (`components/specOpNode.tsx`). Side effects: PriceDisc and
BondPrice no longer show a dead price socket beside their yield; the odd-coupon date is two
sockets (`firstcoupon` / `lastinterest`) because they are different facts; the T-bill and
ACCRINT math moved to `financeOps` as kernels (`tbill`, `accrint`). Ten + two + six catalog
leaves collapsed to three, each carrying its Excel equivalents in `nodeExcel`; old saves of the
merged types load as Placeholders (noBackCompat). **Author eyeball:** Finance > Other has
Discount Security + Accrued Interest, Finance > Bonds has Bond Pricing; switch ops and watch
the sockets reshape with the shared ones keeping their cables.

**The FC `—` inherit pick (Lando, landed 7f904f54 + 11950fe0).** Every family's primary style
dropdown gets a leading `—` ("Inherit the upstream format"): the FC carries the upstream display
cluster through and authors its unit alone, so a 2nd FC docked only for a unit no longer resets
the style to Auto. `inheritFormat` flag + `FormatControllerNode.resolveAnnotation`, which
`makeAnnotationResolver` calls in place of `annotation()`. Enforced in `unitFlowAnnotation.test.ts`;
spec in rules.md formatFlowsDownstream + format-model.md. **Author eyeball:** dock two FCs, set
the 2nd's style to `—` + a unit → upstream style survives, muted `← Decimal · 3 places` hint shows.

**F5 — memory heap-snapshot investigation (Lando; `scripts/heap-probe.mjs`, CDP on a worktree dev
server).** Finding: **no product memory leak; the "high memory for a light app" is mostly a
DEV-build artifact.** The light seed's real footprint is ~20MB.

| getting-started | JS heap | DOM nodes | listeners |
|---|---|---|---|
| dev (`vite`, :5199) | 49.1 MB | 2733 | 1932 |
| prod (`vite build` + preview) | **20.1 MB** | 2575 | 1918 |

Same DOM/listeners; the ~29 MB dev gap is unminified source + per-module `code` objects + React
19 dev perf-track marks. Other findings:
- **No teardown/rebuild leak.** 5× full reload (Ctrl+Shift+L) of chart-showcase: heap 67.6→68.3 MB,
  DOM flat 5315, listeners flat 8095, snapshot detached-DOM = **0 MB**. Node clones / HIC atlas /
  React Flow internals all release on teardown.
- **Per-doc tabs are bounded**, not a leak. Seeding a doc 5× (5 library tabs): +1.3 MB total
  (~0.25 MB/tab = the serialized `SavedGraph` JSON), DOM/listeners flat — only the current doc
  renders; background docs keep no DOM/listeners resident.
- **Where the bytes are** (chart-showcase snapshot, ~140 MB incl. shared): `ExternalStringData`
  66 + `string` 26 + `code` 18 = ~110 MB (78%) is the dev bundle's source/code; `FiberNode` 1.9,
  `Object` 4.1, arrays 7 are the modest runtime. `PerformanceMeasure` grew 3.3→5.7 MB across
  reloads = React/Vite dev perf-track entries (no `performance.measure` in src), dev-only.
- **DOM at scale** is frame/table cards, not node count: personal-finance is 14.5k DOM at 82 MB.
  The `onlyRenderVisibleElements` virtualization lever stays the 2.0 canvas-at-scale item; the
  table/cube popup already caps at 1000 rows.

Proposal for the author (no code changed): the app is memory-clean — measure prod, not dev, if a
real number is wanted. Nothing here is a contained fix; F5's output is this finding.

**E2 — compositeToolbarReroute audit + close (Lando).** Walked every top-toolbar / menu-bar /
mobile-bar / keyboard verb with a drill-in open. Already correct via the seam: keyboard (the
drill-in installs its own instance over its refs, MAIN stands down), undo/redo (per-surface
history), Tidy/Cleanup and select/unselect/Ctrl+A (`swapArrangeSlots` / `swapSelectionSlots`
already swap them), add-node placement + copy/paste + isolate (`getActiveEditor/View`), Navigator
+ Minimap + fit/zoom (`getActiveView`), the Delete KEY (RF per-surface `onBeforeDelete`). The ONE
genuine gap: the keyboard-less **delete button** (mobile / tablet `MobileControls` /
`TabletActions` → `canvasCommands.deleteSelected()`) went to MAIN because the drill-in swapped
selection + arrange but not delete. Fixed by adding `swapDeleteSlot` and having the drill-in swap
`deleteSelected` → its own level (restored on unmount) — the existing pattern, not a rebuild.
Pinned by `canvasCommandsSwap.test.ts`. Known limitation logged (backlog § Composites): docked FCs
inside a drill-in don't recenter (`repositionDockedTo` is a no-op) — component reflow, out of E2's
verb scope. `compositeToolbarReroute` flagship closed (2.0-plan) + its decisions pointer; E2 marked
done in the 1.4 table.

**B1 (trimmed) — Record gallery size preset + List view (Lando).** Two lifts on the one Record
node (`nodes/visual.ts` + `chartCards.tsx`): (a) a `cardsize=s|m|l` OPTIONS key (default m) read
in `data()` and carried on `RecordPayload.size`, scaling the gallery track band only (S 130/110/190
· M 170/140/260 · L 230/190/340); card/board/list ignore it. (b) a fourth `RecordOp` "list" — one
indented outline block per record, the title field on its own line and the trailing fields as
"label: value" rows beneath, drawn text-only with per-line ellipsis. WHICH field is the title lives
behind ONE seam, `titleIndexFor(fields)` in `chartValue.ts` (today the first field; the per-card
`#field` title-row marker plugs in there and every view follows). List reuses the gallery row build
(cap `RECORD_CARD_CAP`, no row/by socket). Catalog description + `cardsize` socketDoc updated. Pinned
by `recordViews.test.ts`. Title row (`#field` marker) + wrap/clamp land next (author promoted both
back IN 2026-09-04c).

**D1 — formula-surface allowlist: Option A DROPPED on step-0 findings (Chewie).** Option A
(one guard before `broadcastCall`: an undeclared FX name refuses ARRAY args) was greenlit on
the proposal's premise that only "a handful" of undeclared names broadcast fine. Step 0
refutes it. Method: enumerate `FX_FUNCTION_NAMES` minus (declared `EXCEL_IMPL_META` ∪ internal ∪
legacy-alias ∪ frame-verb ∪ node-verb ∪ eliminated ∪ non-resolving), then classify each
survivor by evaluating `NAME(x)` with `x=[1,2,3]` through `compileEvaluator`. Of **174**
undeclared names: **127 broadcast a CLEAN element-wise array today** — the guard would refuse
every one (`COS({1,2,3})` → SolError instead of three cosines), a large regression of correct
behaviour, not a handful. 33 are `RANGE_FUNCTIONS` (SUM etc.) that never reach the guard. Only
14 error on the one-arg probe, and that set is arity-contaminated (multi-arg fns flagged only
because the probe passed a single arg). The genuinely broadcast-WRONG set can't be separated
mechanically — arity confounds any uniform probe — and that separation IS the Option B
per-name audit. **Author's call (via Han, 2026-09-04c): Option A does NOT ship; Option B (D1b)
is the path, author-present.** No code landed; the proposal keeps its top note pointing here.

- **IMPROVE (the Option B starting set — 14, VERIFY each before declaring):** ACOTH, CLEAN,
  CODE, CONFIDENCE.NORM, CONFIDENCE.T, ERROR.TYPE, IPMT, ISPMT, NPER, PDURATION, PEARSON, PMT,
  PPMT, UNICODE. Caveat: these merely errored on a ONE-arg list probe. PMT/IPMT/PPMT/NPER/
  PDURATION/ISPMT are multi-arg financials that almost certainly broadcast fine with real args
  (probe artifact, not a real hole); CLEAN/CODE/UNICODE/CONFIDENCE.*/PEARSON/ERROR.TYPE/ACOTH
  are the names actually worth an author look. So the real hole is a handful — but a DIFFERENT
  handful than the surface count implied, and only the audit tells which.
- **REGRESS (127 — broadcast correctly today, Option A would wrongly refuse):** ACCRINT, ACOT,
  ARABIC, ASINH, ATAN, BASE, BESSELI, BESSELJ, BESSELK, BESSELY, BIN2DEC, BIN2HEX, BIN2OCT,
  BINOM.DIST.RANGE, BITAND, BITLSHIFT, BITOR, BITRSHIFT, BITXOR, CEILING, CEILING.MATH, CHAR,
  COMBIN, COMBINA, COS, COSH, COT, COTH, COUPDAYS, CSC, CSCH, CUMIPMT, CUMPRINC, DB, DDB,
  DEC2BIN, DEC2HEX, DEC2OCT, DECIMAL, DEGREES, DELTA, DISC, DOLLARDE, DOLLARFR, EFFECT, ERF,
  ERFC, EVEN, EXP, FACT, FACTDOUBLE, FALSE, FIXED, FLOOR, FLOOR.MATH, FV, FVSCHEDULE, GAMMA,
  GAMMALN, GAMMALN.PRECISE, GAUSS, GCD, GESTEP, HEX2BIN, HEX2DEC, HEX2OCT, IFERROR, IFNA, IFS,
  INT, ISBLANK, ISERR, ISERROR, ISEVEN, ISLOGICAL, ISNA, ISNONTEXT, ISNUMBER, ISODD, ISTEXT,
  LCM, LOG, MROUND, MULTINOMIAL, N, NA, NOMINAL, NOT, OCT2BIN, OCT2DEC, OCT2HEX, ODD,
  PERCENTRANK.EXC, PERCENTRANK.INC, PERMUT, PERMUTATIONA, PHI, PI, POWER, PRICEDISC, PV,
  RADIANS, RAND, RANDBETWEEN, RATE, ROMAN, ROUNDDOWN, ROUNDUP, RRI, SEC, SECH, SIGN, SIN, SINH,
  SLN, SWITCH, SYD, T, TAN, TANH, TBILLEQ, TBILLPRICE, TBILLYIELD, TRUE, TRUNC, TYPE, UNICHAR.
  (IFERROR/IFNA/IFS/SWITCH/NA/TRUE/FALSE/IS* land here as probe quirks — control/predicate
  names, not broadcast math; they too resolve their own way. The audit sorts them.)
- **RANGE_FUNCTIONS (33 — never reach the guard, handled at the range gate; for completeness):**
  AND, AVERAGEIF, AVERAGEIFS, CHISQ.TEST, COUNT, COUNTA, COUNTBLANK, COUNTIF, COUNTIFS, MAX,
  MAXA, MAXIFS, MIN, MINA, MINIFS, NPV, OR, PRODUCT, SERIESSUM, STDEVA, STDEVPA, SUM, SUMIFS,
  SUMPRODUCT, SUMSQ, SUMX2MY2, SUMX2PY2, SUMXMY2, VARA, VARPA, XNPV, XOR, Z.TEST.

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

**A frame column's FORMAT now flows downstream like its unit** (the author's Allocator report:
Headroom set to Decimal in the popup, and neither the downstream Display's card frame nor its
popup showed it). `FrameColumn.format` is the carrier; the stamp is ONE seam — the coercion
wrapper's new OUTPUT step in `coerceInputs.ts`, which every node's `data()` result passes,
composites included — reading that node's own `frameFormatStore` picks. Shallow-copies (a cached
frame is shared) and memoizes on the frame's identity, which the backend's upload cache and the
nodes' own identity memos depend on. A verb-BUILT column takes a source column's format only
where it already takes the unit — nest and the Allocator's Allocation, per an exhaustive audit
of every `FrameColumn` construction in `frameVerbs.ts`; everything that spreads carries it free.
Readers take the local pick first (`FrameDisplay.annFor`, the popup's format row).
**Limit, same as the unit's:** a LAZY verb emits a
`FrameRef`, so its own pick can't be stamped into the value — it renders on that node's card but
travels no further; and `previewToFrame` / the Polars wire structs carry neither field.
**Second defect, same area:** a popup format pick wrote to the store with no `scheduleAutosave()`
and no recompute, so it survived a reload only by luck — both now fire, and Frame Input's
`onSaveSource`/`onCommitSource` (where a popup UNIT pick lands) autosave too.
**Third defect (author): Auto silently overrode an inherited format**, because the row's dropdown
had no way to say "no pick of mine". Every per-column style dropdown now leads with `—` (delete
the entry), the row carries a muted `← Decimal · 3 places` reading of what arrives, and Auto is a
real override — `columnFormatRow` in `frameFormatStore.ts`. The blank option is an `<option>`
ELEMENT, not a component: `LazySelect`'s collapsed render walks children for `type === "option"`
and skipped a wrapper, showing the next option's label instead.

**Docs reconciled:** `node-coverage.md` § Decision support (weights frame, inverted scenarios,
the Note-frame seed), `v2.0/10` grounding, `architecture.md` (modalGuard row), `format-model.md`
+ `rules.md` formatFlowsDownstream + subsystem-invariants § Unit flow (the frame-column format
carrier), backlog (canvas cursor + popup 1px + keystroke-guard + frame-format lines deleted as
landed).

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

**Author call — radar `color`.** Dropped from the Chart Builder's radar target (`RADAR_KEYS`),
and the single-series radar now paints from the palette like every categorical op, so `color`
is inert on radar in both shapes.

**FC lost its date style on reload (author: Script → Display → FC "Wed, Jun 3" → reload →
default date).** Not persistence — every FC field is whitelisted and the autosave rides
`processGraph`'s graph-changed hook. The pick was REWRITTEN by `_applyType` on every family hop:
at load a Script-fed Display resolves through the wildcard, then the Script's construction-time
NUMBER family, then the real date type, and "date style on a non-date → auto, then auto on a
date → first date style" ate the pick. `9738f145`: `_applyType` only mirrors the type; a pick
outside the socket's family is INERT via `effectiveFormat()` (the family default applies, the
popup shows it) and returns with its family. Replayed live by `scripts/fc-attach-probe.mjs`
(`__spike.attachFc`, and `patch()` re-registers an FC annotation); the seed-level
`fc-reload-probe.mjs` had passed because no seed FC sits on a run-time-typed value.

**Format flows downstream through transforms (author ruling, `3edeb031`, `formatFlowsDownstream`
in rules.md).** The resolver's transform case: the first wired input carrying an annotation
wins, gated on the output socket's element family matching, the copy stripped to `unit:"none"`
— the unit stays value-level and locked (`unitOnValue`); a nearer FC overrides; Convert still
drops (it rescales the magnitude, so the old precision no longer describes the number); the
UPSTREAM walk stays bounded by transforms. Unit-flow seed lane C's copy now reads "keeps the
FORMAT; the unit COMPUTES" (author's strings, rewritten because the old caption became false —
eyeball). **Surfaces sweep (`f08482b6`):** every render surface asks one question,
`resolveDisplayAnnotation(nodeId, socketKey?)` (direct ?? carried ?? trailing FC) — ordinary
card value boxes (the passthrough-only guard is gone), list cells (logical show-as, text case,
complex and united cells too), `TableDisplay` matrix cells (had no annotation at all), inline
refs (united/complex refs rendered `[object Object]` before), the cable inspector, pins, the
collapsed-group readouts. `annotationForValue`: an annotation with `unit:"none"` over a
`UnitCell` keeps the cell's unit and supplies only the style. Unchanged by design: the array
chip shows no cells; frames/cubes/the table popup grid are per-column. Verified on the unit-flow
lanes A/B/C: an FC moved 2 → 3 places re-formats every downstream surface, units kept, and the
Multiply card's own box after the transform now reads `$1,000.000`.

**Dev graph mirror (`f2827631`).** The author asked whether the live graph is readable. Now
it is: each autosave POSTs the document to `/__dev-graph` (vite.config.ts `devGraphMirror`) →
`.dev/current-graph.json` (ignored); automated pages (`navigator.webdriver`) skip it. CLAUDE.md
carries the pointer. Track I (`1.4-plan.md`): the author's later proposal to fold the FC into
the Display (format/unit set at sources + displays, downstream only) — analysis + scope there.

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

