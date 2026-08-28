# Decision log — what stands, and what would reopen it

Relapse guards for the project's settled calls. Each entry is: **what stands** (the
final state, not the build history), **where** it lives/is enforced, and **reopen if**
— the honest interface for revisiting. Names are stable and cited from code and docs;
rename only with a full cross-repo sweep. A reversed decision keeps its entry with a dated REVERSED line. The
old ADR-style histories (when/why/cost narratives, amendment chains) live in git and
`archive/dev-notes-history.md` — this file records outcomes only.

**Provenance (authorRuled, rules.md):** nothing here is author-ruled — a quoted author line
is evidence for the reasoning, not a standing order. ARR exists only in `rules.md`.

---

### polarsEngine — Relational engine is Polars (native Rust), not DuckDB
Desktop runs native Polars; web runs the JS oracle only (web = "look and try",
desktop = full product). **Where:** the `FrameBackend` seam; cargo parity tests.
**Reopen if:** a production Polars-WASM path appears, or web becomes a real target —
DuckDB (one engine, two targets) is the scoped alternative; the seam makes the swap
one module. Never add a second engine "for web" without reopening this explicitly.

### noFramesInFormulas — Formula scope is capped: frames/cubes never enter formulas
The verb engine is the frame/cube surface; formulas stop at rank ≤ 2 (matrices and
complex ARE in — see matricesInFormulas, which superseded the old 1-D cap). Pressure to widen
Expression routes to composites/subgraphs instead. **Where:** rules.md hideMatrixFromVendor,
`broadcastRules.test.ts`. The composite-toolbar-reroute concern that once shared this decision's scope is
now `compositeToolbarReroute`, deferred author-present (`deferrals.md`). **Reopen if:** nothing at the formula level.

### noBackCompat — No backward compatibility / migration shims (pre-alpha)
Break saves/code/names freely; delete rather than preserve. The save-format `v`
field + forward-refusal guard stay (the seam migrations would attach to).
**Reopen if:** the first real external user — this flips hard that day.

### branchModel — `main` = production, `develop` = all development
`main` is release-only (Vercel + tags); all work lands on `develop`, overriding
per-session `claude/*` directives. **Reopen if:** multiple contributors / release
trains.

### arraySemantics — Array-semantics value model
Lists/frames carry first-class `null` (missing — skipped by aggregators) AND
per-cell `SolError` (propagated), plus a first-class logical type with Kleene
3-valued logic. **Where:** `valueKinds.ts`, `errorValue.ts`,
`subsystem-invariants.md` § Error values. **Reopen if:** nothing — foundational.

### htmlInCanvasRenderer — The gesture renderer is HTML-in-Canvas over the React Flow DOM
Cards capture into a mip pyramid of bitmaps drawn during pan/zoom; the DOM surface is
the permanent default and the idle state. Depends on the `CanvasDrawElement` Blink flag
(external dependency — risk R2). Author ruling 2026-08-26: HIC is IN — it survived the
rete cutover and was ported to the RF surface (`HtmlCanvasLayer.tsx`, a Setting gated
on `supportsHtmlInCanvas()`). **Where:** `renderer-performance.md`. **Reopen if:** the
flag stalls → DOM stays default, no crisis. The Pixi/WGSL groundwork was DELETED
2026-08-09 (author order — exactly two render paths exist: the RF DOM surface + the
HIC gesture layer; git has the code). Do not rebuild a third path (reactFlowView).

### reactFlowView — The view is React Flow; the model + engine are rete core + rete-engine, on purpose
**View (author, 2026-08-26: "going all out on React Flow, no rete"):** React Flow
(`@xyflow/react`) renders every card, cable, the minimap and the viewport in the app's
ONE React tree; every rete RENDER package (area/react/connection/render-utils/minimap/
history/auto-arrange) and `styled-components` are deleted; Tidy calls elkjs directly;
undo is the snapshot history (`flow/flowHistory.ts`). The module-singleton stores
(`storeKit.ts`) stay as app-wide state; the save format was already rete-independent
(saveViaTextForm). Do not rebuild a third render path (htmlInCanvasRenderer).

**Model + engine (author-ratified 2026-08-27, after the port's C0 scoping was surfaced
as never agreed to):** `rete` core and `rete-engine` stay as the headless graph model
and dataflow engine. The surface used is small and already minimal — `ClassicPreset.Node
/ Input / Output / Socket / Connection` (plain data classes; every node class extends
`Node`), `NodeEditor` (add/remove/get nodes + connections, `addPipe` for the
`nodecreated`/`connectioncreated`/`noderemoved` events that `coerceInputs`, the error
guards, FC reconcile and the RF topology sync hang off), and `DataflowEngine`
(`fetch`/`reset`/`cache` — the pull-with-cache that calls `data(inputs)`, whose public
`cache` is pre-seeded for `#CIRC!`). ~1,500 lines of vendored ESM, one dep, MIT. React
Flow is only a renderer — it has no graph model, typed ports or engine — and no
third-party alternative fits better (graphology has no ports/dataflow; Flume/nodl
bundle renderers; baklava core is the same shape under another name); hand-rolling
would replace ~1,500 maintained lines with ~400 of ours for no functional gain across
151 files. Dependence here is fine. Components may import rete TYPES (`import type`)
and construct `ClassicPreset.Connection` when they wire a cable — that is the app's
own model type, not a render coupling.
**Where:** `architecture.md` § Stack, `subsystem-invariants.md` § React Flow surface
contract, `flow/flowModel.ts` (the model ↔ RF projection seam), `process.ts`.
**Reopen if:** rete core goes unmaintained in a way that bites (a React/TS major it
can't follow), or a genuinely headless typed-dataflow library appears that would delete
code rather than rename it. Merged to `develop` 2026-08-27; build record in
`archive/react-port-plan.md`.

### oneFlowSurface — Both canvases are ONE surface component
**What stands (author, 2026-08-26: the main canvas and the drill-in must be
equivalent):** `flow/FlowSurface.tsx` is the one surface; the main canvas and the
composite drill-in render it over a `SurfaceStack` and differ only through
`SurfaceHooks`. Every surface-level behavior — gesture installers, lasso, menus,
keyboard, layers — is wired there once; a host may only supply what settles a move,
which history answers undo, and what Delete removes. **Where:**
`subsystem-invariants.md` § React Flow surface contract; the drill-in host
`flow/FlowCompositeOverlay.tsx`. **Reopen if:** a surface genuinely needs a behavior
the other must not have — then the difference is a named hook, never a host-local
installer.

### socketLattice — Socket lattice: type separation, dimensional flow
Element families never auto-cross (Cast required; sole bridge `logical↔number`);
values flow freely up in rank (scalar→list→matrix→frame). **Where:** `accepts()`,
machine-checked by the `socketConnect.test.ts` full sweep. **Reopen if:** a new
family or a second bridge — re-derive the lattice + sweep, never ad-hoc edit.

### calcModes — Manual/automatic calc modes, targeted recompute
Manual mode (F9) + targeted recompute (a topology change recomputes only the
target's downstream closure) are the perf floor. **Where:** `calcModeStore.ts`,
`processTargeted.test.ts` (closure ≡ reset). **Reopen if:** nothing.

### dateSerials — Dates are real serials; default display `DD-MMM-YYYY`
No Excel-1900 model (sidesteps the leap-year bug); ISO stays a selectable style.
**Where:** `nodes/date.ts`. Guard: don't "helpfully" reintroduce 1900 compat.

### currentExcelParity — Parity means CURRENT Excel; superseded functions eliminated on EVERY surface
VLOOKUP/HLOOKUP/LOOKUP/MATCH, legacy CEILING sign rules, the pre-2010 stats family:
no node AND no formula — a typed use gets a terse `#NAME?` redirect. INDEX stays
(never superseded). **Where:** `ELIMINATED_FUNCTIONS` stubs in `excelFunctions.ts`;
`node-coverage.md`. **Reopen if:** a real `.xlsx` import ships — auto-rewriting
classic lookups then beats erroring. (Relapse on record: a 2026-07-02 audit pass
re-implemented VLOOKUP because the ruling lived only in a parenthetical — cross-
surface rulings live HERE.)

### oneAnswerOneDivergence — One computation, one answer; ONE sanctioned divergence line
Semantics live in shared helpers (broadcasters, `forAggregate`), never re-derived
per surface. The only sanctioned formula-vs-node divergence: reduction contexts
skip nulls (formula AND/OR, the Aggregate family — Excel range semantics);
element-wise contexts are Kleene/null-propagating (BooleanOp, IF, operators — SQL
WHERE). Any OTHER node-vs-formula disagreement is a bug against this decision.

### excelComparisons — Comparisons match like Excel's `=`; keys are identity
Every comparison (`=`, Comparison node, lookup match, Filter text ops) is
case-INsensitive (EXACT / "Match case" is the escape hatch). Every identity op
(Join/Group By/Distinct keys) is case-SENSITIVE — silent case-merging destroys
distinctions. Corollary (same line): list UNIQUE never dedupes error cells; frame
Distinct dedupes them by code. **Where:** `frameVerbs.ts`, `engine.rs`, the P6
operator table. **Reopen if:** nothing; a per-verb case-fold OPTION would be an
addition inside the rule.

### consistencyOverQuirks — Cross-engine consistency outranks Excel-quirk parity
When an Excel quirk would split JS from Polars (`0^0`: Excel #NUM!, everyone else
1), the quirk loses — a manufactured engine split is worse than a documented
deviation (`parity:false`). An ordering of loyalties, not a feature.

### equationNode — Equation node: acausal sibling of Expression, fixed sockets, no CAS
Every variable is an input AND an output plus a logical `Check`; solving is own
AST isolation + bracket/bisection fallback (no CAS dependency). Quadratic
residuals return every real root ascending. TVM / Compound Growth / Effective
Rate ride the framework (a CONFIG is anything that changes the RELATION).
**Deliberately NOT converted (relapse guard):** Depreciation, IPMT/PPMT/CUMIPMT/
ISPMT (derived quantities, not relations), DOLLARDE/FR, bonds/T-bills, DIST/INV
pairs (no closed-form CDFs). **Where:** `nodes/equation.ts`, `equationSolve.ts`.
**Reopen if:** demand for cubic+ roots (Cardano or a vendored CAS).

### appendLadder — The append ladder: ONE N-ary element-agnostic append per rank
Concat Lists (1-D) · VSTACK/HSTACK (2-D — ragged pads `#N/A` cells like Excel) ·
Append (frame — union by NAME, missing fills blank). All share wire-only
extensible rows. **Deliberately NOT unified (relapse guard):** Interleave, Pad,
Repeat, Add Column, Build Frame vs Frame from Lists; "add one row" = Get Row →
Append (a bare positional list into a by-name append is a refused footgun).
**Reopen if:** a variadic multi-connection socket primitive — it would collapse
the extensible-row pattern.

### filterOneJob — Filter family: one honest job per node
List Filter tests a list against its OWN values only (the parallel-list mask is
DELETED); table filtering routes through the frame Filter; SUMIFS
(SUMIFS/COUNTIFS/AVERAGEIFS/MINIFS/MAXIFS) is the task-shaped conditional
aggregate — one frame input + criteria rows per the aligned-columns rule.
**Reopen if:** evidence that non-aggregating parallel-list filtering is common
enough to out-vote the mask's opacity. Per-cell 2-D filtering stays out
regardless (TOCOL → Filter is the spelling).

### wildcardLadder — The wildcard ladder; `trueany` is the adoptive supremum
Final state: `any` (untyped scalar) → `anycombo` (0-or-1-D) → `anylist` →
`anytable` → `trueany` (hollow ring; adopts the wired type, never drops cables,
never persists — re-derived after load). INDEX projects the element family from
its container (a frame column when statically knowable via `frameShapeResolver`);
a CUBE cell stays `trueany` — the one container heterogeneous within a column.
**Where:** `sockets.ts`, `trueAnyAdopt.ts`, `subsystem-invariants.md` § Socket lattice,
`socket-reference.md`. **Reopen if:** none foreseen.

### lambdaBindsByName — A wired LAMBDA binds to the consumer's variables BY NAME
All lambda-family consumers (MAP, BYROW/BYCOL, REDUCE, SCAN, MAKEARRAY) bind
declared params by name, order-free; an unknown param is `#VALUE!`; a body var
that is a node variable but undeclared is flagged on the card (capture advisory);
captured constants stay explicit wireable sockets. Deliberate break from Excel's
positional model (`parity:false`). **Rejected (relapse guard):** reserved-name
auto-bind overriding wires — dead sockets + silently ignored wiring.

### formulaNaming — Formula naming: aliases blocked, names unified with the hover hint, packs register
Legacy aliases never dispatch (`#NAME?` redirect — currentExcelParity on the formula surface).
Solenoid-native formula names are BARE, identical to the node's header hover hint
(no `SOL.` namespace). Packs register their own formula functions,
pack-enable-sensitively. **Reopen if:** a real user corpus leaning on legacy
names (soften to documented aliases), or an Excel release colliding with a bare
name (case-by-case rename).

### unitGranularity — Units attach at the granularity of homogeneity
Scalar → the value; frame → the COLUMN; **matrix → ONE unit for the whole matrix**
(symbol-keyed tag on the outer array, lossy by design — rebuilders re-tag); list →
per-cell, deliberately (a list is the one rank with no homogeneity guarantee; a
frame ROW is legitimately mixed). Every matrix op declares a unit policy —
`matrixUnitPolicy.test.ts` FAILS THE BUILD on an undeclared op. Cube cells carry
per-cell UnitCells like lists. **Rejected (relapse guard):** a `MatrixValue`
wrapper — domain-wide churn through every coercion primitive for a niche payoff;
the fragility is localized to array-rebuilding sites. **Reopen if:** per-column
units on anonymous matrices — that's what the frame is for.

### visibleSelection — Selection acts on what you can SEE; audit calls default to FIX
Every selection surface skips collapsed-group members and isolate-receded nodes
(invisible selection = mystery deletes; deleting a collapsed group never deletes
members). And when an audit finds defensible-but-worse behavior, fix it — don't
file it as acceptable. **Reopen if:** a real workflow needs gesture-selection of
hidden nodes (Navigator / where-used exist for that).

### queryIsCompositePreset — The Power Query analogue is a Composite preset, not a new class
Query = the same `CompositeNode`, pre-seeded Table→Result, `runMode: "manual"`
(arm-and-run; Solve relabelled Refresh). The drill-in canvas IS the steps view;
the frame verbs are the steps. No new persistence shape. **Reopen if:** genuine
per-step preview/caching needs, or boundary typing adoption can't express.

### matricesInFormulas — Formulas accept matrices and complex; frames/cubes stay out (Tier 4 resolved)
Matrices with Excel dynamic-array semantics; tagged Cx through the owned IM*
family. Frames/cubes rejected on record: no Excel semantics to copy, competes
with the verb engine, breaks lazy-FrameRef economics. **Containment:** Formula.js
never sees a matrix or a Cx (`matrixArgs`/`cxArgs` gates — rules.md hideMatrixFromVendor); the
broadcast table is `broadcastRules.test.ts` (oneMetricImpl); element-wise ragged pads
null, shape construction pads `#N/A` (appendLadder); a list is a ROW. **Reopen if:** the
broadcast semantics diverge from Excel in ways users hit — a re-cap would be a
new decision, not a silent revert.

### tableRefSemantics — Computed-column references use Excel TABLE semantics
Bare column name = the WHOLE column; `@name` = this row's cell; brackets for
unspellable names (`[Unit Price]`, `@[Unit Price]`). λ params stay row-bound
(the λ's explicit per-row interface). Per-row math without `@` fails LOUD
(`#SHAPE!`), exactly as modern Excel resolved the same tension. **Where:**
`computedColumnCore.ts`; normative rules.md rowFormulaRefs. **Reopen if:** nothing —
this IS the model the surface exists to mirror.

### noPerCellFormulas — No per-cell formulas, ever
One definition per column, living on the column header — no surface may accept a
formula typed into a grid cell. Excel's per-cell freedom is the disease this
surface cures. Dead, not deferred — same class as currentExcelParity.

### firstClassUnits — A value's unit is FIRST-CLASS: only the algebra changes it
5 m and 5 km are different values — relabeling a unit IS overwriting the
magnitude, comparatively. An FC downstream of a united value LOCKS (mirrors,
never re-authors); only Convert (or a tag-breaking transform) changes a unit.
Join-key equality for dimensioned values: dimension symbol + base-SI magnitude
(`5 km` == `5000 m`; currency display code is identity — $5 ≠ 5€). **Where:**
`formatController.ts`, `unitFlow.ts`, `subsystem-invariants.md` § Unit flow.
**Reopen if:** nothing — value-model integrity, same class as arraySemantics.

### aiInScope — The AI layer is IN scope; marketing stays minimal
Reverses the old #7/#19 ruled-OUT. The cage framing survives as the design rule:
an AI edit proposes through the same governed, validated path a human edit takes,
with an approval step. Positioning stays file-over-app; AI is a capability, not
the pitch. Provider: Anthropic (`aiService.ts`). **Reopen if:** the loop can't be
made trustworthy, or the feature distorts the Excel-refugee focus into an
AI-first pitch.

### aiWholeDocRewrite — AI edit granularity: whole-document text-form rewrite, gated and diffed
The model emits a full replacement; the strict validator gates the apply; the
approval shows the old→new diff. NO edit-op layer — a second grammar/validator
with partial-state semantics, pure cost at model-sized documents. **Reopen if:**
documents outgrow reliable whole-doc regeneration, or the MCP port ships (its
typed tools ARE the op layer).

### aggregatorsAreArguments — Aggregators are ARGUMENTS of their host verb, not searchable ops
**"Having op" is ONE property with three consequences, never three switches** (author,
2026-08-10). An operation's ops are (1) genuine top-level functions in the formula
editor, (2) accented and hoisted to the top of the card body, and (3) searchable in the
Add menu. An ARGUMENT is a parameter inside a top-level function: neutral control, no
function, no search row of its own — its searched words live as `keywords` on the HOST
leaf, which is this entry's own reopen clause. `kind` is the one declaration; it already
gates (1) via `formulaNodeParity` and (2) via `data-op-kind`, and `nodeOps.test.ts` §
"op-vs-arg is harmonized" now pins (3) for the argument half. The operation half (every
op callable) stays the parity PROGRAM's business — DATEDIF sits at 3/8 — so asserting it
would duplicate a tracked backlog as a red test.

**An argument is a parameter INSIDE a top-level function — both halves are load-bearing.**
Classifying a family as an argument deletes its PER-OP formula names and moves the op
into the argument list of the family's ONE function; it does not delete the family's
formula surface. Running is the worked example, including both failure modes tried
first (2026-08-10): the per-op family `RUNNINGSUM`…`RUNNINGSTDEV` was wrong (seven
top-level names for a parameter), and deleting everything was equally wrong (the
parameter lost its function to be inside). The standing form is
`RUNNING(op, list, [window])` — aggregator as a validated string argument, window
optional, exactly the shape `SORT(list, index, order)` already had for `list-sort`'s
direction. A dispatchable per-op name is never EVIDENCE that a family is an operation;
it is a consequence to add or remove once the classification is made.

The Add menu shows the verb once; the aggregator is picked on the card. The
operation-vs-argument framework (weigh, don't let the last signal win): would the
user PICK it or could it arrive computed; does it have its own NAME (uniqueNameMap can
overrule — ops sharing a name cannot be operations); would the user SEARCH for
it; is it meaningless without its host; is it an Excel function (corroborating
only). An argument's searched words live as `keywords` on the HOST leaf, never as op
rows of its own; Distribution's `.RT` forms are search rows because Distribution is an
OPERATION family, not because arguments may be searchable. On the formula surface an
argument family gets its host's ONE function with the op as a parameter, where the host
is formula-eligible at all: RUNNING(op, list, [window]), SORT(list, index, order).

The SUM/AVERAGE/MIN/… picker appears on five cards. Four are `argument` — `list-groupby`,
`group-by-frame`, `cube-rollup`, `list-running` — none of which names a function. The one
`operation` is `reduce-sum` (Aggregate), where the aggregator is not a parameter of a host
verb but IS the whole node. Test for a new aggregator picker: does the card have a job the
aggregator merely parameterizes? Then argument, and it gets no formula name and no op row.
**Where:** `nodeOps.ts` declarations. **Reopen if:** users search aggregator names
and fail → search ALIASES on the host (`keywords` on the catalog leaf), not
per-aggregator rows.

### commentMinimalism — Comment minimalism: knowledge lives in specs/tests/commits
Deletion is the default outcome for a comment under review; a survivor states a
line-granular constraint invisible in code, types, tests, specs, and commits.
History → commits; rulings → decisions/specs; investigations → dev-notes. Test
files exempt for now. **Where:** `code-comments.md` (policy), README "Code → spec
routing". **Reopen if:** repeated regressions a comment would have prevented —
fix routing first; comment copies are the last resort.

### tableInputRawText — Table Input: raw text is the STORED TRUTH; blank rows preserved
Editors never coerce the Source text; only the derived matrix coerces (blank →
null). A typed blank line survives everywhere — leading, interior, trailing.
Guard: a popup save re-serializing through a lossy parse silently DELETED rows.
**Where:** `nodes/matrix.ts` `keepBlankLines`, `TablePopup.tsx`.

### byteStringOrder — String ordering is BYTE order, not locale
JS `<`/`>` on raw strings (UTF-16 code units) for every comparison and data sort:
determinism (no host ICU dependence) + Polars byte-order parity. Case- and
accent-sensitive; diverges from UTF-8 only on astral-plane characters
(deliberately not chased). UI lists keep locale/natural sort. **Where:**
`stringOrder.ts`. **Reopen if:** demand for locale-aware data sorts — needs a
per-document locale pin, recorded as a new decision.

### oneRunningNode — ONE Running node: window mode is a toggle, never two nodes
Cumulative and Rolling merged (2026-08-09, author call: too similar to stay
separate). One concept — an aggregate per element over its window — with a mode
toggle: "Cumulative" grows the window, "Last N" slides it (Window size input
exists only there). One op set across both modes. Formula surface: ONE function,
`RUNNING(op, list, [window])` — the aggregator is a string argument per aggregatorsAreArguments (the
per-op `RUNNING*` family was eliminated 2026-08-10; window omitted = cumulative,
window given = Last N). A blank/0 WIRED window
as an "unbounded" sentinel was rejected: a wired blank means unknown
(value-semantics), so the mode is structural, not in-band. **Where:**
`RunningNode` in `nodes/list.ts`, `running()` in `nodes/listOps.ts`.
**Reopen if:** the grow/slide edge policies need to diverge further than the
per-window reducer policy can express.

### oneDistributionNode — ONE Distribution node: the distribution is the op, the form is an argument
Every probability distribution lives on one card (2026-08-09, author call; the
same session first merged only the dist/inv pairs, then went the rest of the
way). The `op` selector picks the distribution (14: normal through negative
binomial), the arg-tagged `form` field picks CDF / PDF / PMF / a tail / the
inverse; an inverse form swaps the first input to Probability, and a
distribution switch swaps the parameter inputs (cables on departing sockets
prune first, onePrunePath). The forms carry across switches by meaning (PDF↔PMF over
the continuous/discrete line, inverse variants collapse to plain Inverse).
Binomial Range stays its own node: its range form has a two-input shape the
first-input swap cannot describe. **Where:** `nodes/distribution.ts`
(`DIST_SPECS` is the SSOT), `components/DistributionNode.tsx`.
**Reopen if:** a distribution whose parameters or input shape cannot be
described by `DIST_SPECS` (a second x input, a non-numeric parameter).

### paletteAllOrNone — A palette authors the whole neutral chrome, all of it or none
A palette can replace App.css's neutral ramp — canvas, window, three surfaces, three
borders, four inks, per theme mode (`BUILTIN_CHROME`). It is PARALLEL to the slot map
rather than more slots: nothing stores a neutral on a node, `resolveColor` never
returns one, and folding them in would make every slot consumer (chart series, swatch
grid, height ramp, doc overrides) skip them. The remaining literal-valued neutrals
(panel/overlay fills, overlay border, button hover, gauge track, selected cable,
wordmark, light-theme shadows) DERIVE from those 13 by fixed mixes, calibrated by
running the DEFAULT ramp through them and matching App.css's own hand-tuned literals
— so an author moves one ramp, and a step that reproduces the tuned values also
behaves on a ramp nobody has eyeballed.

**All or nothing per palette.** `Default` alone authors none: it IS App.css, and a copy
would be two homes for one truth. Every other built-in authors a COMPLETE ramp in both
modes, because a partial one writes its keys and derives nothing, landing the app in a
mix of authored neutrals and stylesheet ones. `appTheme` CLEARS every chrome var per
apply, since an inline property beats the stylesheet and a stale one would strand cream
chrome under Default. The custom palette's ramp is always complete (seeded from
`DEFAULT_CHROME`, a hand-held mirror of App.css), so the editor can show it in a well.

**A ramp may recolor the workbench but not renege on its STRUCTURE.** These hold for
every ramp, the App.css baseline included (a rule Default fails is a wrong rule, not a
failing palette): canvas darker than card; dot legible on canvas without shouting; the
field brightest in light and a recess in dark; hover fill stepping toward the ink; three
border tiers stepping outward; four ink tiers stepping down in contrast. They are the
grammar of the ramp, not a taste, and they are what makes a swapped ramp still drive
`chromeCssVars`'s derivations sensibly.

**A TINTED ramp follows the live accent** (2026-08-18). Orchard and Blueprint declare
the accent slot their ramp was authored against (`CHROME_HOME`: green / blue); appTheme
rotates the whole ramp by the hue delta to the selected accent — in OKLCh, holding
every key's chroma AND its WCAG relative luminance (bisected OK lightness) — so the
tint stays exactly as strong as authored, the structure rules below survive any accent,
and the authored ramp reappears byte-identical at the home accent. The space is load-
bearing, not taste: the first cut rotated in HSL, whose saturation is hue-anisotropic,
and the workbench came out "washed in the color" (author) — up to 2× the authored
perceived chroma on Orchard's dark ground. This does NOT reopen the socket-sibling
HSV rule (DESIGN.md §Tertiary): that derivation takes fixed steps NEAR its own hue,
where anisotropy never bites; a rotation always crosses hue regions, which is the one
job HSV/HSL cannot do evenly. Chroma may only DROP in transit, where sRGB's gamut is
tighter at the new hue (near-white creams carried to pink) — never inflate. Adaptation
is per-palette by declaration, never universal: Solarized's base ladder is a lifted
identity, Colorblind-safe and Equinox are achromatic on purpose, Muted's brief is glare
rather than hue, and Custom is exactly what its author picked. An accent below the
OKLCh chroma floor (the gray slot, the neutral cycle) carries no hue and leaves the
ramp authored.

**CONTRAST is scoped to two palettes: `Default` and `Colorblind-safe`** (2026-08-09;
this narrows the same decision's original all-palettes rule). Those two carry the AA
promise — Default because it is the experience nobody chose, Colorblind-safe because
legibility IS its brief — and their ink tiers must clear WCAG AA 4.5:1 on the card and
the field. The rest are aesthetic opt-ins whose whole value is fidelity to a look, and a
palette lifted from a low-contrast source must be allowed to BE low-contrast: Solarized
sits near 3:1 by design, and forcing AA meant a card on base02→base03 and an invented
muted tier, i.e. shipping something that was no longer Solarized. Fidelity wins there;
a reader who needs contrast has two palettes that guarantee it. Structure still applies
to all — an unordered ink ramp is a mistake in any palette, at any contrast.
**Where:** `palette.ts` (`BUILTIN_CHROME` / `DEFAULT_CHROME` / `chromeCssVars` /
`CHROME_HOME` / `adaptChrome`), `appTheme.ts` `apply`, `PaletteEditor.tsx`,
`palette.test.ts` §§ chrome ramp, chrome ramp structure, accent-adaptive chrome,
chromeCssVars (`AA_PALETTES` is the scope). **Reopen if:** chrome
outgrows flat colors (a texture, a vignette, a per-doc ramp) — that wants its own model,
not more keys. On the contrast scope: if a palette other than these two ever becomes a
default for anyone, it joins `AA_PALETTES` that day.

### nodeCombiningRound1 — Node-combining round 1: eight approved merges landed
The author approved a batch of oneRunningNode/oneDistributionNode-style merges (2026-08-09) and they all
shipped in one pass: **Hypothesis Test** (Z/T×3/F/chi-square, six flat ops, the
two-sample keys shared so switches keep cables), **Rank & Percentile** (LARGE/
SMALL + RANK.EQ/AVG + PERCENTILE/QUARTILE/PERCENTRANK with the INC/EXC forms as
ops), **Series** (Range/SEQUENCE/LinSpace — three parameterizations of one
arithmetic progression; Geometric/Fibonacci/Repeat/RANDARRAY stay separate by
author call), **NPV/IRR absorb XNPV/XIRR** (a Periodic/Dated SegToggle reveals
the Dates input), **Workdays** (WORKDAY/NETWORKDAYS as inverse forms; the op
retypes the output in place, so the switch calls `retypeOutputCables`),
**Depreciation absorbs VDB** (and the always-visible qualifier rows became a
per-op spec table), **ListTakeDrop** (matching the table sibling), and
**Surface absorbs Contour** (a 3-D/Flat view toggle; payload kinds unchanged).
Every merge keeps its old Add-menu leaf types (nodeExcel/Reference untouched),
prunes departing sockets' cables first (onePrunePath), and lets old saves load as
Placeholders (noBackCompat). Flat ops were preferred over a second axis wherever the
combo count is small — per-op hover descriptions keep working and no new
persisted field is needed. **Where:** the merged classes sit in their family
files; mechanics per maximalMerge. **Parked pending author
review** (backlog "Node-combining parked"): the paired-list aggregate, the
payment-breakdown 2×2, and the remaining smaller pairs. (Landed since under
`docs/plans/`: TREND⊂FORECAST.LINEAR+GROWTH, LINEST⊂LOGEST, PHI/GAUSS→Distribution,
Select+Drop Columns→Columns, and Text Filter⊂List Filter.)
**Reopen if:** a merged family needs per-op behavior the
spec table can't express, or an op needs its own formula-name treatment.

### maximalMerge — "These could be one node" means the MAXIMAL merge
**What stands (recurring author program; oneRunningNode and oneDistributionNode are the
models):** one card, selectors for what varied — never a pairwise or partial merge
(2026-08-09 the distribution merge stalled a turn at pairwise; the intent was all
fourteen). A variant is a mode/op selector on the existing card, never a sibling node.
Mechanics that were gotten wrong once and must not repeat: an op's formula name is
`fx ?? despace(label)` — when the real name is an Excel spelling or the label went bare,
DECLARE `fx` (distribution `normal` → NORM.DIST; Running `SUM` → RUNNINGSUM); never dodge
a uniqueNameMap collision by reclassifying the family argument-kind or inventing a
parallel presentation flag — `kind: "operation"` whenever the selector names the card,
and the accent follows (aggregatorsAreArguments). Selector-driven socket swaps prune
departing keys via `dropInputCables` BEFORE `removeInput` (rules onePrunePath),
spec-table the per-op shape (the `DIST_SPECS` pattern), and carry state across switches
by meaning (PDF↔PMF, inverse variants → Inverse). Old saves load as Placeholders
(noBackCompat). After a merge run `nodeOps.test.ts` + `formulaNodeCoverage.test.ts`
beside the parity/catalog/seed suites. **Where:** nodeCombiningRound1 records the
landed batch; `node-coverage.md` the inventory. **Reopen if:** a family whose variants
cannot share a spec table (a second x input, a non-numeric parameter) — then a
sibling is honest, and the reason is recorded.

### oneRecordNode — The Record family: ONE figure node, and its views are ARGUMENTS
**What stands:** Every record-shaped view — Card, Gallery, Board, and any future
one — is an op on the one Record node, never a sibling node (author order,
2026-08-18). The view selector is **argument-kind** in `NODE_OPS` even though it
names the card: a view is a presentation parameter of one figure, not a thing
called by name — contrast Chart, whose TYPES are operations. "gallery"/"kanban"
ride the host leaf's keywords; no per-view search rows or formula names exist.
The card itself never draws its grid (squished at card width): the hero chip
carries it, and the drawn card lands wherever the chart output goes — Display,
popup, Report embed. Record boxes TOUCH and are square. Record-at-a-time ENTRY
is the Table popup's Form view on frame-source editors: the same record look
made editable, placed by the same layout text, authored on the Frame Input CARD
(never in the popup), with column-type entry widgets (logical → checkbox with an
indeterminate blank; date → the native date input writing ISO text).
**Where:** `nodes/visual.ts` (RecordNode, `RECORD_OP_META`, `parseRecordLayout`),
`chartCards.tsx`/`.css` (`RecordCardView`), `nodeOps.ts` (argument-kind),
TablePopup's Form view; pins in `visual.test.ts`.
**Reopen if:** a record view needs behavior an op cannot express, or the formula
surface ever needs a record-view name.

### decisionMatrixFamily — Decision family: contributions breakdown, ÷Max default, ties surfaced
**What stands:** The Decision Matrix's Breakdown columns are each criterion's SIGNED
contribution (effective × weight / Σ|weight|), summing to the Score — never the bare
post-normalize values, which read backwards under a negative weight (the priciest
option showed Price 1.0 while taking the largest penalty). Ranking runs on the
ROUNDED (4dp) score so display and rank cannot disagree, and round4 flattens −0.
Both decision nodes default normalize to ÷Max: Raw silently degenerates the moment
criteria mix scales, which is the node's whole reason to exist. Sensitivity lists
every rank-1 option in Winner ("A = B") on an exact tie (Margin 0 ⟺ tie), and
#VALUE!s when no Scenarios column names a criterion — otherwise every weight
defaults to 1 and all scenarios come out identical (the renamed-criteria trap).
**Where:** `frameVerbs.decisionMatrix`/`decisionSensitivity`, `nodes/frame.ts`;
pins in `decisionMatrix.test.ts`; the seed's prose claims held to the engine by
`decisionSeed.test.ts`.
**Reopen if:** a raw-values breakdown is wanted back (add it as a third detail
mode, not a redefinition), or a scenarios frame legitimately needs to run with
zero matching columns.

### capabilityParity — Node↔formula CAPABILITY parity: the node exposes everything the formula can
**What stands (author's standing order, 2026-08-21):** for a function on BOTH surfaces,
the node must expose every argument, mode, and return shape the formula surface can reach —
never less. Excel / Formula.js divergence is a judgement call (documented per `nodeExcel`
note); our OWN two surfaces disagreeing is a defect that does not ship. This strengthens
shareImpl from "one implementation" to "one implementation AND full node reach." The 2026-08-21
sweep closed the open gaps: SUBSTITUTE `instance`, TREND optional New Xs, WRAP `pad_with`,
DB `month`, RANDARRAY `integer`, REGEXEXTRACT capture-groups, REGEXREPLACE `occurrence` —
each now parity-tested node↔formula.
**Where:** rules.md shareImpl (extended); behavioural agreement tests per function (finance /
auditFixes / formulaTier1 / text / rangeRouting / matrixReshape); `nodeFormulaArgParity.test.ts`
is a PARTIAL greppable guard (dispatch-through-`resolveExcelFunction` only — it cannot see a
separate-impl or Formula.js-fall-through gap, so the behavioural tests are the real line).
**Reopen if:** never as a whole (standing order). A specific arg may be a SANCTIONED
shortfall with a recorded reason (e.g. an Excel arg that is a cell-grid concept, or one the
formula surface ALSO lacks — an equal Excel divergence, which is fine).

---

## Structural risks (standing conditions, not bugs)

- **R1 — Single-author bus factor.** Mitigation: the doc series + machine-checked
  seeds + the reconcile rule.
- **R2 — The renderer's external flag (htmlInCanvasRenderer).** Mitigation: DOM renderer is the
  permanent default; HIC is an enhancement.
- **R3 — Polars API churn** (pinned 0.46). Mitigation: the `FrameBackend` seam +
  the JS oracle as reference + cargo parity tests.
- **R4 — Web/desktop parity tax (polarsEngine).** Two engines that must agree — a permanent
  maintenance cost; budget for it.
- **R5 — Scope creep toward the out-of-scope set.** The most-requested features
  (code cell, live grid, collaboration) are the identity-killers; `out-of-scope.md`
  is the shield.
- **R6 — Doc rot.** The project's named failure mode. Mitigation: reconcile-don't-
  append; the README index; verify claims against code.

### relativeDatesOptIn — relative dates resolve ONLY on an opted-in Date Input (2026-08-23)
**Stands:** `parseDate` refuses relative phrases (today / next friday / in 3 days / a bare
weekday with no year) unless called with `{ relative: true }`; the ONLY caller that does is
the Date Input node, and only under Settings ▸ Data ▸ Relative dates (default off). It
re-resolves on every pass and fires a warning Alert when the resolved DAY moves between
calculations (edge on the serial). DATEVALUE, Cast, Frame/Table columns and every other
date surface stay deterministic — Excel purity and "a stored date is a fixed calendar day".
A text with a four-digit year is never relative ("Monday, 16 March 2026" is absolute).
**Where:** `dateSerial.ts` (`isRelativeDateText`, `ParseDateOptions`), `control.ts`
DateInputNode, `settingsStore.ts` relativeDates; pinned in `relativeDates.test.ts`.
**Reopens if:** the author wants DATEVALUE (or a frame column) to follow the setting — then
the opt-in moves from the node to the parser call sites, the alert story with it.

### isBooleanName — The type-check op is ISBOOLEAN, a callable alias of ISLOGICAL
Solenoid's first-class Boolean type is called Boolean on every surface, so the Type Check
op reads ISBOOLEAN (author 2026-08-25; a NAME-4 sweep had flipped it to ISLOGICAL the same
day). `ISBOOLEAN(v)` is registered as a formula (`excelFunctions.ts`, same test as Formula.js
ISLOGICAL), so the all-caps label is a true callable claim and `nameCase.test.ts` needs no
allowlist entry; `ISLOGICAL` stays callable for Excel parity and is the Inspector's Excel
equivalent. Reopens only if the type itself is renamed.

### dateBuildName — The DATE(y, m, d) node is named "DATE (Build)"
The builder node keeps its "(Build)" tag (author 2026-08-25, restoring an earlier explicit
override a NAME-3 sweep had trimmed to "DATE"): on a canvas next to a Date Input card, a bare
"DATE" and "Date Input" differ by case alone. The tag is the distinguisher, not a hint, so it
stays under NAME-3/NAME-4 (DATE is the callable token; the parenthetical is Title Case).
Reopens only if Date Input is renamed.

### frameVerbExcelNames — A frame verb that IS an Excel function carries its spelling
GROUPBY and PIVOTBY are the node names (author 2026-08-25; a NAME-3 sweep had made PIVOTBY
"Pivot" to match the Title-Case verbs). The verbs are refused on the formula surface
(`FRAME_SURFACE_NAMES`, frames don't flow through formulas), but the typed name redirects to
the node, so the all-caps claim holds; NAME-4's test admits the map's keys. Verbs with no Excel
function (Unpivot, Nest, Rename…) stay Title Case; Append / Bind Columns become VSTACK / HSTACK
when the stack merge lands. Reopens only if the formula surface starts accepting frames.

### domOrderStacking — Node stacking is per-node `zIndex` (`nodeZIndex`, flowModel.ts)
SUPERSEDED MECHANISM, SAME LADDER: the rete-era DOM-order stacking (`simpleNodesOrder`
re-appending the picked card) died with the rete surface. React Flow stacks by the node's
`zIndex`, stamped by `nodeZIndex` — the area-plane ladder (standoffs −3 < expanded groups
−2 < conduits −1 < nodes 0) is now data, not DOM order; the fixed lifts (isolate
endpoints, open group picker, selected cable) stay explicit z-index writes. **Where:**
`flow/flowModel.ts` (`nodeZIndex`), `StandoffLayer.tsx`, `GroupNode.tsx`,
`ConduitComponent.tsx`, `flow/FlowCableEdge.tsx`; no test pins it (eyeball only). A side
effect of the old mechanism is gone with it: selecting a node no longer reparents its DOM
element, so the reparent-closes-native-popup constraint (the settled 2026-08-24 probe) no
longer applies — the form-control pointerdown swallow survives on drag-prevention grounds
alone. **Reopen if:** cards visibly stack wrongly after selection, or a control needs
last-selected-on-top semantics RF's `zIndex` model doesn't give.


### scriptNode — Script: the ONE arbitrary-evaluation node, typed at the boundary (author 2026-08-28; toggle dropped 2026-08-28b)
The author asked for a code node whose outputs are restricted to the existing value
types, overriding out-of-scope §4's blanket NO; §4 now states the bounded form. What
stands: the source is a JavaScript function expression (`(a, b) => …`); its parameters
are `anydata` inputs re-derived on commit (Expression's mechanic, `applyScriptChange`);
the return value passes `coerceScriptResult` and **the value types itself — there is no
declared result type** ("if it's going to be a script, script it"): numbers, text and
booleans carry their own families, a returned `Date` (or `Solenoid.date(serial)`, the
one in-script global, closed over by `compileScript`) is a date, and the result socket
reconciles FAMILY as well as rank off the computed value (`reconcileResultRank`;
number/text/date sockets, logical/complex and mixed LISTS ride the wildcard).
Unresolvable outputs error: `#TYPE!` for unsupported values, `#DOMAIN!` for NaN,
`#SHAPE!` beyond rows of values (ragged rows padded with null), and — per
unitGranularity's single-typed matrix — **rows mixing families are `#AMBIGUOUS!`**,
never an anytable. Expression KEEPS its Number/Text/Date/Auto toggle: a formula's
variables don't say what it returns; a script's values do. Evaluation runs in the sandbox
worker (`subsystem-invariants.md` § Script sandbox) under `SCRIPT_TIMEOUT_MS`; the Tauri
CSP carries `'unsafe-eval'` for it. Named Script, not Code (NAME-2: CODE is an Excel
function node). **Where:** `nodes/script.ts`, `nodes/scriptRun.ts`, `nodes/scriptCoerce.ts`,
`scriptWorker.ts`, `scriptExecutor.ts`; pinned by `nodes/script.test.ts`. **Reopen if:**
a script needs I/O, state between runs, a frame input, or a second language — each is
§4's creep, not a feature request. Frame/cube OUTPUT is a live author question
(2026-08-28b), not yet ruled.
