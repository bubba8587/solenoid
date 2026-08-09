# Decision log — what stands, and what would reopen it

Relapse guards for the project's settled calls. Each entry is: **what stands** (the
final state, not the build history), **where** it lives/is enforced, and **reopen if**
— the honest interface for revisiting. IDs are stable and cited from code and docs;
never renumber. A reversed decision keeps its entry with a dated REVERSED line. The
old ADR-style histories (when/why/cost narratives, amendment chains) live in git and
`archive/dev-notes-history.md` — this file records outcomes only.

**Provenance (PROV-1, rules.md):** nothing here is author-ruled — a quoted author line
is evidence for the reasoning, not a standing order. ARR exists only in `rules.md`.

---

### D1 — Relational engine is Polars (native Rust), not DuckDB
Desktop runs native Polars; web runs the JS oracle only (web = "look and try",
desktop = full product). **Where:** the `FrameBackend` seam; cargo parity tests.
**Reopen if:** a production Polars-WASM path appears, or web becomes a real target —
DuckDB (one engine, two targets) is the scoped alternative; the seam makes the swap
one module. Never add a second engine "for web" without reopening this explicitly.

### D2 — Formula scope is capped: frames/cubes never enter formulas
The verb engine is the frame/cube surface; formulas stop at rank ≤ 2 (matrices and
complex ARE in — see D23, which superseded the old 1-D cap). Pressure to widen
Expression routes to composites/subgraphs instead. **Where:** CLAUDE.md,
`broadcastRules.test.ts`. The composite-toolbar-reroute half of "D2" stays
author-present (`deferrals.md`). **Reopen if:** nothing at the formula level.

### D3 — No backward compatibility / migration shims (pre-alpha)
Break saves/code/names freely; delete rather than preserve. The save-format `v`
field + forward-refusal guard stay (the seam migrations would attach to).
**Reopen if:** the first real external user — this flips hard that day.

### D4 — `main` = production, `develop` = all development
`main` is release-only (Vercel + tags); all work lands on `develop`, overriding
per-session `claude/*` directives. **Reopen if:** multiple contributors / release
trains.

### D5 — Array-semantics value model
Lists/frames carry first-class `null` (missing — skipped by aggregators) AND
per-cell `SolError` (propagated), plus a first-class logical type with Kleene
3-valued logic. **Where:** `valueKinds.ts`, `errorValue.ts`,
`subsystem-invariants.md` § Error values. **Reopen if:** nothing — foundational.

### D6 — Renderer is HTML-in-Canvas over the real DOM
Cards capture into a mip pyramid of bitmaps; the DOM renderer is the permanent
default/fallback. Depends on the `CanvasDrawElement` Blink flag (external
dependency — risk R2). **Reopen if:** the flag stalls → DOM stays default, no
crisis. The Pixi/WGSL groundwork was DELETED 2026-08-09 (author order — exactly
two renderers exist: DOM default + the experimental HIC Setting; git has the code).

### D7 — Socket lattice: type separation, dimensional flow
Element families never auto-cross (Cast required; sole bridge `logical↔number`);
values flow freely up in rank (scalar→list→matrix→frame). **Where:** `accepts()`,
machine-checked by the `socketConnect.test.ts` full sweep. **Reopen if:** a new
family or a second bridge — re-derive the lattice + sweep, never ad-hoc edit.

### D8 — Manual/automatic calc modes, targeted recompute
Manual mode (F9) + targeted recompute (a topology change recomputes only the
target's downstream closure) are the perf floor. **Where:** `calcModeStore.ts`,
`processTargeted.test.ts` (closure ≡ reset). **Reopen if:** nothing.

### D9 — Dates are real serials; default display `DD-MMM-YYYY`
No Excel-1900 model (sidesteps the leap-year bug); ISO stays a selectable style.
**Where:** `nodes/date.ts`. Guard: don't "helpfully" reintroduce 1900 compat.

### D10 — Parity means CURRENT Excel; superseded functions eliminated on EVERY surface
VLOOKUP/HLOOKUP/LOOKUP/MATCH, legacy CEILING sign rules, the pre-2010 stats family:
no node AND no formula — a typed use gets a terse `#NAME?` redirect. INDEX stays
(never superseded). **Where:** `ELIMINATED_FUNCTIONS` stubs in `excelFunctions.ts`;
`node-coverage.md`. **Reopen if:** a real `.xlsx` import ships — auto-rewriting
classic lookups then beats erroring. (Relapse on record: a 2026-07-02 audit pass
re-implemented VLOOKUP because the ruling lived only in a parenthetical — cross-
surface rulings live HERE.)

### D11 — One computation, one answer; ONE sanctioned divergence line
Semantics live in shared helpers (broadcasters, `forAggregate`), never re-derived
per surface. The only sanctioned formula-vs-node divergence: reduction contexts
skip nulls (formula AND/OR, the Aggregate family — Excel range semantics);
element-wise contexts are Kleene/null-propagating (BooleanOp, IF, operators — SQL
WHERE). Any OTHER node-vs-formula disagreement is a bug against this decision.

### D12 — Comparisons match like Excel's `=`; keys are identity
Every comparison (`=`, Comparison node, lookup match, Filter text ops) is
case-INsensitive (EXACT / "Match case" is the escape hatch). Every identity op
(Join/Group By/Distinct keys) is case-SENSITIVE — silent case-merging destroys
distinctions. Corollary (same line): list UNIQUE never dedupes error cells; frame
Distinct dedupes them by code. **Where:** `frameVerbs.ts`, `engine.rs`, the P6
operator table. **Reopen if:** nothing; a per-verb case-fold OPTION would be an
addition inside the rule.

### D13 — Cross-engine consistency outranks Excel-quirk parity
When an Excel quirk would split JS from Polars (`0^0`: Excel #NUM!, everyone else
1), the quirk loses — a manufactured engine split is worse than a documented
deviation (`parity:false`). An ordering of loyalties, not a feature.

### D14 — Equation node: acausal sibling of Expression, fixed sockets, no CAS
Every variable is an input AND an output plus a logical `Check`; solving is own
AST isolation + bracket/bisection fallback (no CAS dependency). Quadratic
residuals return every real root ascending. TVM / Compound Growth / Effective
Rate ride the framework (a CONFIG is anything that changes the RELATION).
**Deliberately NOT converted (relapse guard):** Depreciation, IPMT/PPMT/CUMIPMT/
ISPMT (derived quantities, not relations), DOLLARDE/FR, bonds/T-bills, DIST/INV
pairs (no closed-form CDFs). **Where:** `nodes/equation.ts`, `equationSolve.ts`.
**Reopen if:** demand for cubic+ roots (Cardano or a vendored CAS).

### D15 — The append ladder: ONE N-ary element-agnostic append per rank
Concat Lists (1-D) · VSTACK/HSTACK (2-D — ragged pads `#N/A` cells like Excel) ·
Append (frame — union by NAME, missing fills blank). All share wire-only
extensible rows. **Deliberately NOT unified (relapse guard):** Interleave, Pad,
Repeat, Add Column, Build Frame vs Frame from Lists; "add one row" = Get Row →
Append (a bare positional list into a by-name append is a refused footgun).
**Reopen if:** a variadic multi-connection socket primitive — it would collapse
the extensible-row pattern.

### D16 — Filter family: one honest job per node
List Filter tests a list against its OWN values only (the parallel-list mask is
DELETED); table filtering routes through the frame Filter; SUMIFS
(SUMIFS/COUNTIFS/AVERAGEIFS/MINIFS/MAXIFS) is the task-shaped conditional
aggregate — one frame input + criteria rows per the aligned-columns rule.
**Reopen if:** evidence that non-aggregating parallel-list filtering is common
enough to out-vote the mask's opacity. Per-cell 2-D filtering stays out
regardless (TOCOL → Filter is the spelling).

### D17 — The wildcard ladder; `trueany` is the adoptive supremum
Final state: `any` (untyped scalar) → `anycombo` (0-or-1-D) → `anylist` →
`anytable` → `trueany` (hollow ring; adopts the wired type, never drops cables,
never persists — re-derived after load). INDEX projects the element family from
its container (a frame column when statically knowable via `frameShapeResolver`);
a CUBE cell stays `trueany` — the one container heterogeneous within a column.
**Where:** `sockets.ts`, `trueAnyAdopt.ts`, CLAUDE.md lattice note,
`socket-reference.md`. **Reopen if:** none foreseen.

### D18 — A wired LAMBDA binds to the consumer's variables BY NAME
All lambda-family consumers (MAP, BYROW/BYCOL, REDUCE, SCAN, MAKEARRAY) bind
declared params by name, order-free; an unknown param is `#VALUE!`; a body var
that is a node variable but undeclared is flagged on the card (capture advisory);
captured constants stay explicit wireable sockets. Deliberate break from Excel's
positional model (`parity:false`). **Rejected (relapse guard):** reserved-name
auto-bind overriding wires — dead sockets + silently ignored wiring.

### D19 — Formula naming: aliases blocked, names unified with the hover hint, packs register
Legacy aliases never dispatch (`#NAME?` redirect — D10 on the formula surface).
Solenoid-native formula names are BARE, identical to the node's header hover hint
(no `SOL.` namespace). Packs register their own formula functions,
pack-enable-sensitively. **Reopen if:** a real user corpus leaning on legacy
names (soften to documented aliases), or an Excel release colliding with a bare
name (case-by-case rename).

### D20 — Units attach at the granularity of homogeneity
Scalar → the value; frame → the COLUMN; **matrix → ONE unit for the whole matrix**
(symbol-keyed tag on the outer array, lossy by design — rebuilders re-tag); list →
per-cell, deliberately (a list is the one rank with no homogeneity guarantee; a
frame ROW is legitimately mixed). Every matrix op declares a unit policy —
`matrixUnitPolicy.test.ts` FAILS THE BUILD on an undeclared op. Cube cells carry
per-cell UnitCells like lists. **Rejected (relapse guard):** a `MatrixValue`
wrapper — domain-wide churn through every coercion primitive for a niche payoff;
the fragility is localized to array-rebuilding sites. **Reopen if:** per-column
units on anonymous matrices — that's what the frame is for.

### D21 — Selection acts on what you can SEE; audit calls default to FIX
Every selection surface skips collapsed-group members and isolate-receded nodes
(invisible selection = mystery deletes; deleting a collapsed group never deletes
members). And when an audit finds defensible-but-worse behavior, fix it — don't
file it as acceptable. **Reopen if:** a real workflow needs gesture-selection of
hidden nodes (Navigator / where-used exist for that).

### D22 — The Power Query analogue is a Composite preset, not a new class
Query = the same `CompositeNode`, pre-seeded Table→Result, `runMode: "manual"`
(arm-and-run; Solve relabelled Refresh). The drill-in canvas IS the steps view;
the frame verbs are the steps. No new persistence shape. **Reopen if:** genuine
per-step preview/caching needs, or boundary typing adoption can't express.

### D23 — Formulas accept matrices and complex; frames/cubes stay out (Tier 4 resolved)
Matrices with Excel dynamic-array semantics; tagged Cx through the owned IM*
family. Frames/cubes rejected on record: no Excel semantics to copy, competes
with the verb engine, breaks lazy-FrameRef economics. **Containment:** Formula.js
never sees a matrix or a Cx (`matrixArgs`/`cxArgs` gates — rules.md FX-9); the
broadcast table is `broadcastRules.test.ts` (SSOT-6); element-wise ragged pads
null, shape construction pads `#N/A` (D15); a list is a ROW. **Reopen if:** the
broadcast semantics diverge from Excel in ways users hit — a re-cap would be a
new decision, not a silent revert.

### D24 — Computed-column references use Excel TABLE semantics
Bare column name = the WHOLE column; `@name` = this row's cell; brackets for
unspellable names (`[Unit Price]`, `@[Unit Price]`). λ params stay row-bound
(the λ's explicit per-row interface). Per-row math without `@` fails LOUD
(`#SHAPE!`), exactly as modern Excel resolved the same tension. **Where:**
`computedColumnCore.ts`; normative rules.md FX-13. **Reopen if:** nothing —
this IS the model the surface exists to mirror.

### D25 — No per-cell formulas, ever
One definition per column, living on the column header — no surface may accept a
formula typed into a grid cell. Excel's per-cell freedom is the disease this
surface cures. Dead, not deferred — same class as D10.

### D26 — A value's unit is FIRST-CLASS: only the algebra changes it
5 m and 5 km are different values — relabeling a unit IS overwriting the
magnitude, comparatively. An FC downstream of a united value LOCKS (mirrors,
never re-authors); only Convert (or a tag-breaking transform) changes a unit.
Join-key equality for dimensioned values: dimension symbol + base-SI magnitude
(`5 km` == `5000 m`; currency display code is identity — $5 ≠ 5€). **Where:**
`formatController.ts`, `unitFlow.ts`, `subsystem-invariants.md` § Unit flow.
**Reopen if:** nothing — value-model integrity, same class as D5.

### D27 — The AI layer is IN scope; marketing stays minimal
Reverses the old #7/#19 ruled-OUT. The cage framing survives as the design rule:
an AI edit proposes through the same governed, validated path a human edit takes,
with an approval step. Positioning stays file-over-app; AI is a capability, not
the pitch. Provider: Anthropic (`aiService.ts`). **Reopen if:** the loop can't be
made trustworthy, or the feature distorts the Excel-refugee focus into an
AI-first pitch.

### D28 — AI edit granularity: whole-document text-form rewrite, gated and diffed
The model emits a full replacement; the strict validator gates the apply; the
approval shows the old→new diff. NO edit-op layer — a second grammar/validator
with partial-state semantics, pure cost at model-sized documents. **Reopen if:**
documents outgrow reliable whole-doc regeneration, or the MCP port ships (its
typed tools ARE the op layer).

### D29 — Aggregators are ARGUMENTS of their host verb, not searchable ops
The Add menu shows the verb once; the aggregator is picked on the card. The
operation-vs-argument framework (weigh, don't let the last signal win): would the
user PICK it or could it arrive computed; does it have its own NAME (FX-4 can
overrule — ops sharing a name cannot be operations); would the user SEARCH for
it; is it meaningless without its host; is it an Excel function (corroborating
only). Distribution .RT forms stay SEARCH ROWS (kind and menu are separate axes;
rows must carry the searched token). **Where:** `nodeOps.ts` declarations.
**Reopen if:** users search aggregator names and fail → search ALIASES on the
host, not per-aggregator rows.

### D30 — Comment minimalism: knowledge lives in specs/tests/commits
Deletion is the default outcome for a comment under review; a survivor states a
line-granular constraint invisible in code, types, tests, specs, and commits.
History → commits; rulings → decisions/specs; investigations → dev-notes. Test
files exempt for now. **Where:** `code-comments.md` (policy), README "Code → spec
routing". **Reopen if:** repeated regressions a comment would have prevented —
fix routing first; comment copies are the last resort.

### D31 — Table Input: raw text is the STORED TRUTH; blank rows preserved
Editors never coerce the Source text; only the derived matrix coerces (blank →
null). A typed blank line survives everywhere — leading, interior, trailing.
Guard: a popup save re-serializing through a lossy parse silently DELETED rows.
**Where:** `nodes/matrix.ts` `keepBlankLines`, `TablePopup.tsx`.

### D32 — String ordering is BYTE order, not locale
JS `<`/`>` on raw strings (UTF-16 code units) for every comparison and data sort:
determinism (no host ICU dependence) + Polars byte-order parity. Case- and
accent-sensitive; diverges from UTF-8 only on astral-plane characters
(deliberately not chased). UI lists keep locale/natural sort. **Where:**
`stringOrder.ts`. **Reopen if:** demand for locale-aware data sorts — needs a
per-document locale pin, recorded as a new decision.

### D33 — ONE Running node: window mode is a toggle, never two nodes
Cumulative and Rolling merged (2026-08-09, author call: too similar to stay
separate). One concept — an aggregate per element over its window — with a mode
toggle: "Cumulative" grows the window, "Last N" slides it (Window size input
exists only there). One op set across both modes; one formula family RUNNING*
with the window as an optional arg (ROLLING* eliminated). A blank/0 WIRED window
as an "unbounded" sentinel was rejected: a wired blank means unknown
(value-semantics), so the mode is structural, not in-band. **Where:**
`RunningNode` in `nodes/list.ts`, `running()` in `nodes/listOps.ts`.
**Reopen if:** the grow/slide edge policies need to diverge further than the
per-window reducer policy can express.

### D34 — ONE Distribution node: the distribution is the op, the form is an argument
Every probability distribution lives on one card (2026-08-09, author call; the
same session first merged only the dist/inv pairs, then went the rest of the
way). The `op` selector picks the distribution (14: normal through negative
binomial), the arg-tagged `form` field picks CDF / PDF / PMF / a tail / the
inverse; an inverse form swaps the first input to Probability, and a
distribution switch swaps the parameter inputs (cables on departing sockets
prune first, SSOT-9). The forms carry across switches by meaning (PDF↔PMF over
the continuous/discrete line, inverse variants collapse to plain Inverse).
Binomial Range stays its own node: its range form has a two-input shape the
first-input swap cannot describe. **Where:** `nodes/distribution.ts`
(`DIST_SPECS` is the SSOT), `components/DistributionNode.tsx`.
**Reopen if:** a distribution whose parameters or input shape cannot be
described by `DIST_SPECS` (a second x input, a non-numeric parameter).

### D35 — A palette may author the canvas ground, and almost none do
The canvas background and its dot grid are palette-authorable per theme mode
(`BUILTIN_CANVAS`), PARALLEL to the slot map rather than four more slots: nothing
stores them on a node, `resolveColor` never returns one, and folding them into the
slot record would make every slot consumer (chart series, swatch grid, height ramp,
doc overrides) skip them. Declaring a ground is OPT-IN and stays rare — recoloring
the graph is what a palette does; recoloring the workbench is a separate claim.
Orchard is the only built-in that opts in (2026-08-09, author call), and a test pins
that so a later palette adds a ground deliberately. A palette that declares none
keeps App.css's neutral ground: `appTheme` CLEARS the inline vars per apply, since an
inline property beats the stylesheet's ramps and a stale one would strand a cream
canvas under Default. The custom palette's ground is always COMPLETE (seeded from
`DEFAULT_CANVAS`), so the editor can show it in a well. **Where:** `palette.ts`
(`BUILTIN_CANVAS` / `DEFAULT_CANVAS` / `canvasColors`), `appTheme.ts` `apply`,
`PaletteEditor.tsx`, `palette.test.ts` § canvas ground. **Reopen if:** grounds
outgrow two colors (a texture, a vignette, a per-doc ground) — that wants its own
model, not more keys.

### D36 — Node-combining round 1: eight approved merges landed
The author approved a batch of D33/D34-style merges (2026-08-09) and they all
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
prunes departing sockets' cables first (SSOT-9), and lets old saves load as
Placeholders (D3). Flat ops were preferred over a second axis wherever the
combo count is small — per-op hover descriptions keep working and no new
persisted field is needed. **Where:** the merged classes sit in their family
files; mechanics per CLAUDE.md "Node combining". **Parked pending author
review** (backlog "Node-combining parked"): the paired-list aggregate, the
payment-breakdown 2×2, the absorptions (Text Filter, TREND, PHI/GAUSS), and
the smaller pairs. **Reopen if:** a merged family needs per-op behavior the
spec table can't express, or an op needs its own formula-name treatment.

---

## Structural risks (standing conditions, not bugs)

- **R1 — Single-author bus factor.** Mitigation: the doc series + machine-checked
  seeds + the reconcile rule.
- **R2 — The renderer's external flag (D6).** Mitigation: DOM renderer is the
  permanent default; HIC is an enhancement.
- **R3 — Polars API churn** (pinned 0.46). Mitigation: the `FrameBackend` seam +
  the JS oracle as reference + cargo parity tests.
- **R4 — Web/desktop parity tax (D1).** Two engines that must agree — a permanent
  maintenance cost; budget for it.
- **R5 — Scope creep toward the out-of-scope set.** The most-requested features
  (code cell, live grid, collaboration) are the identity-killers; `out-of-scope.md`
  is the shield.
- **R6 — Doc rot.** The project's named failure mode. Mitigation: reconcile-don't-
  append; the README index; verify claims against code.
