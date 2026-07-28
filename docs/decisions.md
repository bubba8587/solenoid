# Decision log — the WHYs, and what would reverse them

The project's hard, deliberate, feels-irreversible calls: each entry is the reasoning
and, crucially, **what would justify revisiting**. Rules derived from these live in
`CLAUDE.md` and `rules.md`; the build history behind them lives in the dev-notes archive.

**Provenance (PROV-1, rules.md):** nothing in this log is author-ruled — including
entries that quote the author verbatim. A quote is EVIDENCE for a decision's reasoning
and carries the weight of that reasoning, not the force of a standing order; ARR exists
only in `rules.md`, conferred only by the author marking a rule there in-session. Read
"author:" attributions here as *what was said and when*, never as *what may not be
questioned*. The reversal conditions below are the honest interface for reopening any
of these.

CLAUDE.md's own standing rule warns against **re-litigating settled decisions**. But a
decision with no recorded rationale gets re-litigated anyway (nobody remembers why), and
a decision with no recorded *reversal condition* becomes dogma that outlives its reason.
This doc fixes both: each entry is **what / why / the cost accepted / what would reverse
it.** The reversal field is the important, novel part — it lets a future agent tell
"settled, leave it" from "the ground has shifted, re-open it" without guessing.

Format is deliberately lightweight (not formal ADRs). Add an entry when a genuinely
load-bearing, hard-to-reverse choice is made. Don't delete entries — if one reverses,
append a dated "REVERSED" note; the history is the value.

---

### D1 — Relational engine is Polars (native Rust), not DuckDB
**When:** 2026-06-22. **Where:** `archive/compute-architecture.md` + the dev-notes archive.
**Why:** fastest engine; `LazyFrame` verbs map 1:1 onto the verb nodes.
**Cost accepted:** Polars has no production browser build → the **web build does not run
the real engine** (web = "look and try", desktop = full product).
**What would reverse it:** (a) a production-grade Polars WASM path appearing, OR (b) the
web build becoming a real target for revenue/adoption reasons — at which point DuckDB
(desktop crate + DuckDB-WASM = one engine, two targets) is the standing alternative,
already scoped. The `FrameBackend` seam exists precisely so this swap is one module, not
a rewrite. **Do not** casually add a second engine "for web" without re-opening THIS
decision explicitly (see future-directions Bet 5 for the honest trade-off).

### D2 — Expression / formula scope is capped, permanently
**When:** 2026-06-23. **Where:** `CLAUDE.md`, the `#SHAPE!` matrix guard in `nodes/expression.ts`.
**Why:** the formula language stays the type-agnostic subset (scalars + 1-D lists,
broadcast element-wise). Matrices/frames/complex/type-directed semantics are explicitly
NOT coming — that's the job of the future subgraph/composite node.
**Cost accepted:** some Excel-parity gaps can't be closed in a formula; they route to a
node or the subgraph escape hatch instead.
**What would reverse it:** essentially nothing at the formula level — this is a
philosophical cap, not a TODO. The pressure it creates should be spent building the
**composite/subgraph node** (the sanctioned power-user path), never on widening
Expression. If you're tempted to widen Expression, the answer is "build subgraphs."
**REOPENED (2026-07-14, author):** in the formula↔node parity direction the author
explicitly walked back the "permanent" framing — *"I'm not necessarily committed to
assumptions/restrictions that we already wrote down… let's keep an open mind."* The cap
STANDS as the working default until the parity design decides Tier 4 (keep 1-D vs lift
to 2-D) — see `docs/formula-node-parity.md`, whose outcome should be recorded here as
D2's successor. Do not treat D2 as immovable in that design; do not silently widen
Expression before it's decided either.
Tier-4 preconditions, decision criteria (correctness + coherence only — the
auditability objection is retired), and the candidate endpoints are recorded in full in
`formula-node-parity.md` "Tier 4 in full"; the open technical crux is shape-branding in
the type-agnostic evaluator (`[re,im]` vs a 2-list, `[[1,2]]` vs list-of-lists).

### D3 — No backward compatibility / no migration shims (pre-alpha)
**When:** ongoing policy; swept clean 2026-06-19. **Where:** `CLAUDE.md` pre-alpha section.
**Why:** one user (the author), who has explicitly authorized breaking old saves/code/
names. Shims and migration maps are pure cost with no beneficiary.
**Cost accepted:** old autosaves/exports can fail to load across a rename; that's fine.
**What would reverse it:** the **first real external user.** The day someone else's data
lives in a `.sol` file, this flips hard — and the save-format `v` field + forward-refusal
guard (kept deliberately) are the seam where migrations would attach. Until then, keep
deleting rather than preserving.

### D4 — `main` = production, `develop` = all development
**When:** 2026-07-01 (post-1.0). **Where:** `CLAUDE.md` branch model.
**Why:** `main` is release-only (Vercel serves it; tags live there). Day-to-day work is
noise on a production branch.
**Cost accepted:** an extra merge step at release; agents must ignore per-session
`claude/*` branch directives and use `develop`.
**What would reverse it:** a real branching need (multiple contributors, release trains).
Note the trap this already caused: a session forked from `main` inherits `main`'s
CLAUDE.md, which said `working` before this doc existed — verify the branch model against
`develop`'s CLAUDE.md, not whatever branch you started on.

### D5 — Array-semantics value model (first-class null + per-cell errors + logical type)
**When:** 2026-06-22 (Inc 1–8). **Where:** `subsystem-invariants.md` "Error values",
`valueKinds.ts`, `errorValue.ts`.
**Why:** real data has holes and errors; the old "lists never contain errors" invariant
couldn't express missing-vs-error, so aggregators lied. Now a list/frame carries `null`
(missing, skipped by aggregators) AND per-cell `SolError` (propagated) as distinct kinds,
plus a first-class logical type with Kleene 3-valued logic.
**Cost accepted:** every aggregator/broadcaster must handle three cases (value/null/error)
via `forAggregate`/`valueKinds`; more surface, more tests. (The v1.0 audit found several
paths that still don't — that's a bug against this decision, not a reason to reverse it.)
**What would reverse it:** nothing foreseeable — this is foundational. The audit's
compute findings are the *completion* of this decision, not a challenge to it.

### D6 — Renderer is HTML-in-Canvas, not hand-rolled WebGPU or a Pixi re-implementation
**When:** 2026-06-27 (supersedes the WGSL and Pixi directions). **Where:** `backlog.md`
Renderer section, `htmlCanvasRenderer.ts`.
**Why:** capture the *real* DOM cards into a mip-pyramid of bitmaps → crisp at any zoom,
no component re-authoring. Perf-validated (280 nodes, 165fps). The DOM renderer stays the
permanent default/fallback.
**Cost accepted:** depends on the `CanvasDrawElement` Blink feature (desktop enables the
flag; web: origin trial Chrome 148–150 + Android DevTrial since 138, not yet stable —
status 2026-07). This is a genuine **external dependency** — see the risk register in
this doc. Spec drift absorbed 2026-07: `ElementImage` is final as a minimal non-
ImageBitmapSource interface (the pyramid builds via in-paint atlas raster), and the
no-opt-out privacy pass makes canvas text grayscale-AA — a permanent fidelity floor.
**What would reverse it:** the flag stalling permanently (unlikely) → the DOM renderer
just remains default, no crisis. Or a dramatically better native path. The Pixi/WGSL
groundwork is parked, not deleted, if a full swap is ever forced.

### D7 — Socket lattice: enforce TYPE separation, allow DIMENSIONAL flow
**When:** ongoing; formalized with the array-semantics work. **Where:** `CLAUDE.md`
socket-lattice rule, `socketConnect.test.ts`.
**Why:** element families (number/string/date/complex/logical) never auto-cross (Cast
required); values flow freely UP in dimensionality (scalar→list→matrix→frame). One
exception: `logical↔number` (0/1 ↔ TRUE/FALSE).
**Cost accepted:** the cross-type dimensional edges can't be derived purely and are
enumerated explicitly in `accepts()`, machine-checked by a full-sweep test.
**What would reverse it:** a new element family or a compelling second cross-family
bridge — either requires re-deriving the lattice and updating the sweep test, not an
ad-hoc `accepts()` edit.

### D8 — Calculation mode: manual/automatic, targeted recompute
**When:** 2026-07-01. **Where:** `CLAUDE.md`, `calcModeStore.ts`, `process.ts`.
**Why:** heavy tables made every edit a full recompute; manual mode (F9) + targeted
recompute for value edits keep big graphs usable.
**Cost accepted:** a mode to reason about; a full recompute still fires on cable
connect/disconnect (extending targeted recompute to topology changes is open follow-through,
not a reason to drop this).
**What would reverse it:** nothing — this is the perf floor. The open work is *extending*
targeted recompute to topology changes (audit perf finding), not reverting to always-auto.

### D9 — Default date format is `DD-MMM-YYYY`, dates are real serials (not the Excel 1900 model)
**When:** ongoing. **Where:** `nodes/date.ts` `DEFAULT_DATE_FORMAT` / serial epoch.
**Why:** unambiguous display; real serials sidestep Excel's 1900 leap-year bug for
post-Feb-1900 dates.
**Cost accepted:** none material — `parseDateToSerial` is UTC-based (a timezone-dependence
bug against this decision was found and fixed).
**What would reverse it:** nothing; ISO stays a selectable style. This entry exists mainly
so a future agent doesn't "helpfully" reintroduce Excel-1900 compatibility.

### D10 — Excel parity means CURRENT Excel; superseded functions are eliminated on EVERY surface
**When:** 2026-07-02 (the VLOOKUP relapse). **Where:** `node-coverage.md`, the
`ELIMINATED_FUNCTIONS` redirect stubs in `excelFunctions.ts`, this entry.
**Why:** parity targets what Excel is today. Anything Excel itself deprecated or superseded
(legacy CEILING sign rules, VLOOKUP/HLOOKUP/LOOKUP → XLOOKUP, MATCH → XMATCH) is disregarded
entirely — we neither match it nor document divergence from it. Crucially, an elimination
covers ALL surfaces: no node AND no formula implementation. A typed formula naming an
eliminated function gets a terse `#NAME?` redirect (**"Use XLOOKUP"** — no longer, per the
no-Captain-Obvious rule). INDEX stays (current Excel, never superseded).
**Cost accepted:** a pasted-from-Excel formula containing VLOOKUP errors (with the fix in
the message) instead of silently working.
**What would reverse it:** a real `.xlsx` IMPORT feature — at that point auto-rewriting
classic lookups to their modern forms beats erroring. Nothing else.
**The relapse that prompted this:** the 2026-07-02 audit fix pass, hunting parity gaps,
re-implemented VLOOKUP/HLOOKUP/LOOKUP/MATCH in the formula layer because the elimination
was recorded only as a node-coverage parenthetical. Cross-surface rulings live HERE now.

### D11 — Surface harmony: one computation, one answer — with ONE sanctioned divergence line
**When:** 2026-07-02 (formalizing 2026-06-22's model). **Where:** the shared broadcasters
(`shared.ts`, `excelFormula.ts`, `logic.ts`), backlog "Post-audit tails".
**Why:** the same computation must answer the same whether built from nodes or typed as a
formula — semantics live in SHARED helpers (broadcasters, `forAggregate`, the one
filter-coercion spec), never re-derived per surface. The ONLY sanctioned formula-vs-node
divergence is the **reduction vs element-wise null line**: reduction contexts skip nulls
(formula AND/OR, the Aggregate family — Excel range semantics, SQL BOOL_AND); element-wise/
expression contexts are Kleene/null-propagating (BooleanOp, Comparison, IF, operators — SQL
WHERE). Both sides match their reference model; unifying either way breaks one.
**Cost accepted:** `AND(list-with-null)` answers TRUE in a formula and null through
element-wise nodes — principled, documented (BooleanOp catalog note), and not drift.
**What would reverse it:** nothing at the line itself; any OTHER node-vs-formula
disagreement is a bug against this decision.

### D12 — Case sensitivity: comparisons match like Excel's `=`; keys are identity
**When:** 2026-07-02 (the filter revisit). **Where:** P6 operator table, `frameVerbs.ts`,
`engine.rs`, backlog "Post-audit tails".
**Why:** every COMPARISON (the `=` operator, Comparison node, XLOOKUP/Frame Lookup match,
frame Filter eq/neq/contains/startsWith/endsWith) is case-INsensitive — Excel's semantics,
and the app's one text-equality rule (EXACT / a "Match case" toggle = the escape hatch).
Every IDENTITY op (Join keys, Group By keys, Distinct) is case-SENSITIVE — keys are
identity (databases/Polars/PQ); Excel PivotTable's silent case-merging destroys
distinctions irrecoverably and is the thing we refuse.
**Cost accepted:** "us"/"US" group separately until the user normalizes case explicitly;
parity:false notes on the identity verbs.
**What would reverse it:** nothing foreseeable; a per-verb case-fold OPTION on Group By/
Join would be an addition inside this rule, not a reversal.
**Second instance of the same line (2026-07-02, UNIQUE ruling):** list ops answer to the
spreadsheet model, relational verbs to the relational model — list UNIQUE never dedupes
error cells (each is an independent problem, the sanity-check reading), while frame
Distinct dedupes them by code (errors as values, SQL/Polars identity semantics).

### D13 — Cross-engine consistency outranks Excel-quirk parity
**When:** 2026-07-02 (the `0^0` ruling). **Where:** this entry; pow item in backlog.
**Why:** half the app's arithmetic runs in JS, half in Polars. When importing an Excel
quirk would make the two engines disagree (Excel says `0^0` = #NUM!; JS/Python/R/Polars
all say 1), the quirk loses — a JS-vs-Rust split manufactured for parity's sake is a worse
bug than a documented deviation.
**Cost accepted:** occasional parity:false notes where Excel is the odd one out.
**What would reverse it:** nothing; this is an ordering of loyalties, not a feature.

### D14 — The Equation node is a SIBLING of Expression, acausal, with a FIXED socket set
**When:** 2026-07-09 (author: "just build it now"). **Where:** `nodes/equation.ts`,
`equationSolve.ts`; the design discussion is in the session digest.
**Why:** three sub-decisions. (1) A new node, NOT a widened Expression — D2 caps
Expression permanently, ~135 locked pack presets and the LAMBDA hosts lean on its
directional contract, and the card shape differs anyway. (2) Every variable gets an input
AND an output plus one always-present logical `Check` — rather than the single output
that morphs numlist→logical — because in-place retype is a known minefield
(fcReconcile/retypeOutputCables) and a morphing output changes MEANING when inputs are
rewired, silently breaking downstream cables. (3) Solving is our own AST isolation
(unparse → recompile, so broadcasting is free) + a numeric bracket/bisection fallback —
no CAS dependency (nerdamer/algebrite are heavy, stale, and speak a different grammar).
**Cost accepted:** principal branches on NON-polynomial inversion (√/ASIN — the returned
value satisfies the equation but may not be the branch you meant); the numeric fallback is
scalar-only and reports the root nearest an ascending log-grid scan; tall cards (2n+1 value
rows).
**Amendments (both 2026-07-09):** a probe-detected QUADRATIC residual solves via the
quadratic formula and returns EVERY real root ascending (x² = 36 → [−6, 6]; double root
stays scalar; negative discriminant → #SOLVE!) — intercepted before symbolic isolation so
the negative root never falls to the principal branch. The finance families collapsed
onto the framework: **TVM** (one `TvmNode extends EquationNode`, locked annuity relation,
any-4-of-5 solves; payment timing is a CONFIG dropdown that swaps the locked relation —
a config is anything that changes the RELATION rather than a quantity in it, the template
for future subclasses; rate = 0 uses the exact zero-rate limit), **Compound Growth**
(PDURATION/RRI) and **Effective Rate** (EFFECT/NOMINAL) as locked catalog presets.
`solveNumeric` bisects every sign-change bracket and returns the SMALLEST-MAGNITUDE root.
**Surveyed and deliberately NOT converted** (relapse guard): Depreciation, the
IPMT/PPMT/CUMIPMT/ISPMT family (derived quantities, not relations), DOLLARDE/FR,
bonds/T-bills (date sockets), distribution DIST/INV pairs (no closed-form CDFs).
**What would reverse it:** demand for cubic/higher roots (Cardano or a vendored CAS);
per-output socket annotations would unlock richer per-variable typing.

---

### D15 — The append ladder: ONE N-ary, element-agnostic append node per container rank
**When:** 2026-07-09 (author: "heavy thinking pass over the entire set of nodes which
involve appending data … continuing from the VSTACK/HSTACK changes").
**What:** appending is the same idea at every rank, so each rank gets exactly one node,
and they all share the same shape — extensible wire-only rows (add/remove, order =
stack order), element-agnostic accepts, lattice widening on the way in:
- **1-D — Concat Lists**: `anylist` rows (a scalar widens to a 1-element list, so "push
  one value" needs no wrapper) → `anylist` out. Concatenation has no ragged case.
- **2-D — VSTACK / HSTACK**: `anytable` rows (scalar → 1×1, list → ONE ROW) → `anytable`.
  Ragged inputs PAD WITH #N/A CELLS exactly like Excel — VSTACK pads narrower inputs
  right, HSTACK pads shorter inputs down. The old whole-result #SHAPE! made the common
  "stack a 3-list on a 5-list" case unusable; a per-cell #N/A is visible, honest, and
  recoverable (IFNA/Fill), and SUM over it goes #N/A like Excel.
- **Frame — Append**: `frame` rows (union by column NAME via the verb engine, which was
  always N-ary — the node just exposes it; missing column fills blank, type clash #TYPE!).
  Ragged-by-name ≠ ragged-by-position, so no #N/A padding here — blanks are the frame
  semantics.
- WRAPROWS/WRAPCOLS joined the same padding rule (#N/A, Excel's default pad_with) —
  they previously disagreed with each other (ragged short row vs NaN fill).
**Deliberately NOT unified:** Interleave (positional A/B alternation — two DISTINCT
roles, stays 2-ary), Pad (fill-to-length) and Repeat (self-append) are 1-D utilities,
not appends; Add Column is the frame's single-named-column horizontal add (bulk = Frame
from Lists, keyed = Join); Build Frame (matrix+headers) vs Frame from Lists (named typed
columns) are different constructors, both kept; "add one row to a frame" is Get Row →
Append (a 1-row frame keeps column names — a bare positional list into a by-name append
is a footgun we refuse).
**How (mechanics):** the extensible-row plumbing is the BooleanOp pattern (`valueKeys`
persistence, `addValueInput`/`removeValueInput`, row undo via pushRow*Undo);
`ExtensibleInputs` gained a WIRE-ONLY row branch (container-typed rows render position
number / "↩ source", never a literal field — a typed literal has no meaning for a
list/table/frame operand and typed lists belong to List Input).
**Cost accepted:** container rows can't be typed in place; #N/A padding can hide a
genuine width mistake until an aggregate goes #N/A (Excel makes the same trade).
**What would reverse it:** a variadic "multi-connection socket" primitive (one pill that
accepts N cables) would collapse the extensible-row pattern across all four nodes.

---

### D16 — The Filter family: one honest job per node (mask removed, SUMIFS born)
**When:** 2026-07-09 (author-led redesign; the old Filter was four tools wearing one card).
**The ruling:** the **list Filter** tests a 1-D list against ITS OWN values only
(shared `passesFilter` condition engine, Kept + Dropped outs) — the parallel-list mask
and the table acceptance are DELETED, not bridged with chrome. **Table filtering routes
through the frame Filter** (a matrix widens in as `Col1..N`; a list can't — it widens as
ONE ROW, so lists keep their own node). **SUMIFS** (`SumIfsNode`,
SUMIFS/COUNTIFS/AVERAGEIFS/MINIFS/MAXIFS) is the task-shaped conditional aggregate that
replaces the mask's bread-and-butter job, built as ONE frame input + a Values-column
field + criteria rows — per the standing **aligned-columns rule** (position-aligned
columns arrive as a 2-D input, never parallel list sockets; a shorter parallel list
silently failing rows past its end is the exact hazard). Parallel-list filtering without
aggregation = Frame from Lists → Frame Filter.
**Cost accepted:** `FILTER(sales, region="North")` as a bare list has no 2-node spelling
anymore (mask + Comparison used to do it); the sanctioned spellings are SUMIFS (when
aggregating — the overwhelmingly common case) or the frames route.
**What would reverse it:** the mask's return would need evidence that non-aggregating
parallel-list filtering is common enough to out-vote the mask's opacity; per-cell 2-D
filtering stays out regardless (Excel's FILTER refuses 2-D includes; ragged output
doesn't exist in its model — TOCOL → Filter is the explicit spelling).

---

### D17 — The wildcard ladder: `any` is a scalar; `trueany` is the supremum
**When:** 2026-07-09 (author challenge: "(any accepts everything) — um, it shouldn't?
that's why we have any, any list, and any matrix").
**The problem:** `any` was doing two jobs — the rank-0 rung of the untyped ladder AND the
accept-everything supremum. The code made it the supremum (`accepts()` returned true for
`any` on either side); the DESIGN — a plain gray circle among circles-are-scalars — had
always said "one value of any type." With `anylist`/`anytable` as explicit 1-D/2-D untyped
rungs, an `any` input silently swallowing frames, cubes, and lambdas was a lattice hole:
Expand's Fill ("any scalar fill value") happily accepted a whole frame.
**The decision:** split them. `any` = element-agnostic SCALAR — accepts any family's
scalar (and combos, which can be scalars); its output widens anywhere data flows, never
into the object family. `trueany` = the true supremum — accepts and flows to everything —
with a NEW glyph: a HOLLOW gray circle (border only, no fill), distinguishable from every
filled shape even zoomed out. So the untyped ladder reads any → anylist → anytable, with
trueany above the whole lattice.
Call sites sort by what they MEAN: genuine anything-ports → `trueany`;
scalar-or-1-D under the Expression cap → `anylist` (enforced at CONNECT time, not
runtime #SHAPE!); true scalars (SWITCH equality, Expand fill, Filter/SUMIFS value rows)
stay `any`. `isWildcardType()` centralizes "walk past untyped passthroughs" over both
rungs.
**Cost accepted:** `any` outputs (Regex result) can still deliver a non-scalar at
runtime into a scalar input; there is no untyped COMBO socket (Regex result is the known
combo-shaped hole).
**AMENDED 2026-07-25 — INDEX ADOPTS; only the heterogeneous containers are unknowable
(author).** "Value-dependent results like INDEX keep a STATIC trueany" was too broad: it
held for a CUBE cell (which may hold a nested frame/cube) and a FRAME cell (heterogeneous
columns, picked by a runtime index), and for nothing else. A list or matrix is
HOMOGENEOUS — its element family is fixed by the socket whichever cell you pull — so
declaring the whole node unknowable cost real behavior: a date pulled out of a date list
lost its date-ness downstream (`isDateType` reads the socket, so it rendered as a raw
serial), and the output dot stayed a hollow ring while the input dot colored. INDEX now
declares a `passthrough()` on its `list` input — it FORWARDS a value out of its container,
which is what that declaration means — with a new `project` hook that drops the RANK and
keeps the family: what Row/Column vary is one-cell-vs-whole-axis, and the COMBO rung means
exactly "a scalar or a list of F", so the result feeds a scalar input AND a list input.
`comboOfType` returns null for frame/cube, where the placeholder correctly stands. This is
D18's own "adopt only where honest" rule applied per CONTAINER instead of per node.
**AMENDED same day — trueany is ADOPTIVE (author):** a trueany port is a PLACEHOLDER
that adopts the wired cable's type and reverts on disconnect. Inputs adopt universally;
outputs only where honest (passthroughs; selector results when every wired branch
agrees; value-dependent results like INDEX/XLOOKUP keep a STATIC trueany). Adoption
never drops cables and is never persisted — re-derived from wiring after load/paste.
Mechanics: `trueAnyAdopt.ts` + CLAUDE.md's socket-lattice note. The hollow ring on
screen always means "nothing has flowed here yet".
**AMENDED 2026-07-25 — the `anycombo` rung was added, closing the combo-shaped hole.**
The element-agnostic COMBO (gray split square): accepts exactly what `anylist` accepts,
but a scalar reaches `data()` as a SCALAR rather than widening to a singleton, and its
OUTPUT may be a scalar so it also reaches a scalar input. The ladder is now
`any` (0) → `anycombo` (0-or-1) → `anylist` (1) → `anytable` (2) → `trueany` (⊤).
Two things it retired: Expression's `noWidenInputs` — a node overriding what its own
socket said about rank, the exact kind of invisible side-channel that made the
2026-07-25 shape bugs hard to trace — and Regex's `anyOut`, which drew a scalar CIRCLE
on a port that can emit a list. Cost recorded honestly in `type-resolution-plan.md`: it
is a TRADE (a socket type for a flag), justified because it moves the fact into the
type system rather than beside it.
**AMENDED 2026-07-27 — a FRAME's family lives in the COLUMN, so INDEX reads it there
(author: "INDEX of a Frame should pass through the column's data type").** The 07-25
amendment stopped one step short: it said "frame/cube have no element family, so the
placeholder stands", which is true of the SOCKET and false of the VALUE. A frame's
columns are each homogeneous and named, and INDEX names WHICH one — so the family is
knowable exactly when the column is. `project` now takes a `ProjectContext` (the static
frame `Shape` arriving on the forwarded input + whether an input is wired), supplied by
the adoption pass from the SAME `frameShapeResolver` walk the Cable Inspector's shape row
uses. INDEX over a frame resolves: blank/0 Column → the whole row, still a `frame`;
Column = c → that column's family at the COMBO rung. It falls back to `trueany` only
where the answer is genuinely unknown — a WIRED Column (a runtime value the literal no
longer decides), an unresolvable upstream shape (CSV / Web Source), a `dynamic` shape
(a pivot's data-driven columns shift positions at compute time), or an out-of-range index.
A CUBE cell stays `trueany` — it is the one container whose cells are heterogeneous
*within a column* (it may hold a nested frame/cube). Second half of the change: a socket
type can now be derived from static CONFIG, not just wiring, so the LITERAL commit paths
(`InlineInputs`, `useNodeField`, the Frame Input source editor) call
`reconcileTypesAfterEdit` — the settle early-outs unless a type actually moved.
**What would reverse it:** none foreseen.

---

### D18 — A wired LAMBDA binds to the consumer's variables BY NAME, not by position
**When:** 2026-07-10 (author: "positional params just aren't acceptable at all — that's not
the way anything else in this project works; every other node explicitly declares its
sockets so you know exactly what is getting wired in where").
**The problem:** the lambda-family consumers called a wired LAMBDA positionally (Excel's
model). The param NAMES were cosmetic, so `LAMBDA(value, acc, "value + 2*acc")` into SCAN
silently computed `acc + 2*value` — the names lied — and `LAMBDA(value, "acc + value")`
silently dropped the accumulator (`acc` became a captured 0), a blank/degenerate fold with no
error. Opaque binding is the opposite of Solenoid's every-socket-is-named principle.
**The decision:** ALL lambda-family consumers (MAP, BYROW/BYCOL, REDUCE, SCAN, MAKEARRAY —
`byName` in `resolveFn`) bind a wired lambda's declared params to the node's fixed variables
**by name**, order-free. A param that ISN'T one of the node's variables is a hard `#VALUE!`
(the consumer can't supply it). The advisory is CAPTURE-based, not required-based: if a body
variable is one of the node's OWN variables but wasn't declared as a param, it silently became
a captured constant (0) instead of the live value — `undeclaredConsumerVars` (from the
LambdaValue's new `captured` list ∩ the node's `lambdaSig.vars`) names those on the card. So
`λ(value)="acc + value"` into REDUCE flags `acc`; `λ(row)="value + row"` into MAP flags
`value`; a genuine constant (`rate`) is never flagged. **Captured constants are untouched:**
any non-node-variable body var stays an explicit input socket on the LAMBDA node and rides the
closure through, verified (`rate` wired 3 → `[3,6,9]`). The two authoring paths finally agree —
a wired lambda behaves like the inline formula, both writing the body in the node's vocabulary.
**Variable names:** the fixed variables are WORDS, not single letters (REDUCE/SCAN
`acc`/`value`/`step`; MAP `value`/`value2`/`value3`/`row`/`col`; MAKEARRAY `row`/`col`;
BYROW/BYCOL `values`). The fuzzy-autocomplete collision with function names (value→VALUE)
is accepted — clarity beats the stray suggestion.
**Break from Excel (deliberate):** Excel's LAMBDA is positional; you may name params freely. Here
the per-iteration variables use the consumer's reserved names and can't be renamed. Everything
else is preserved or better: full computational parity, and captured constants become explicit
wireable sockets (vs Excel's invisible outer-cell/LET capture). Catalog entries stay `parity:false`.
**What would reverse it:** going the other way (Level 2 — reserved names auto-bind even when
undeclared, overriding a wire on those sockets) was rejected: it leaves dead sockets on the
lambda card and silently ignores a deliberately-wired value. Declaration stays required so
every socket means exactly what it shows.

### D19 — Formula↔node parity, round 1: aliases blocked, names unified with the hover hint, packs register formulas
**When:** 2026-07-14 (the parity direction session — see `docs/formula-node-parity.md`
for the audit + tiers this decides). Author answered the doc's four gating questions;
the mechanical work is greenlit but deliberately deferred to a dedicated session.
**The decisions:**
1. **Legacy aliases are BLOCKED on the formula surface.** D10 applies to every surface:
   an eliminated/superseded name (VLOOKUP, NORMDIST, STDEVP, the pre-2010 family
   Formula.js drags in) must NOT dispatch — `#NAME?` with a "use X" redirect hint. The
   classic-lookup set is already blocked (`ELIMINATED_FUNCTIONS` stubs in
   `excelFunctions.ts`); the pre-2010 stats family still awaits the Tier-1 registry work.
2. **Formula names for Solenoid-native ops are BARE names, UNIFIED with the node's
   header hover hint** (`typeHint()` in `nodeKit.tsx` — class name minus `Node`,
   camelCase split, uppercased). The hint text and the formula name are the same
   identifier, with spaces removed where the hint has them ("SET RELATION" →
   `SETRELATION`). One identity per op family, shown on the card and typed in a formula
   — no `SOL.` namespace. Where a class is a multi-op family (SetOpNode's
   union/intersection/…), the naming of ops within the function (op-as-argument vs
   per-op names) is an implementation call for the build session, made under this rule.
3. **Packs can register their own formula functions** into the internal-impl registry
   (the `registerInternal` seam), following the same naming rule — so a pack ships node
   + formula surface together. Registration must respect pack enable/disable
   (`FORMULA_FUNCTION_NAMES` and autocomplete become pack-sensitive).
4. **Tier 4 (the reopened D2 dimensionality cap) is NOT decided** — author-present
   discussion explicitly required ("we have to talk about this"). D2 stands as the
   working default until then.
**Cost accepted:** blocking aliases breaks any formula that used a legacy name (pre-alpha,
acceptable per D3); bare names risk future Excel-name collisions (accepted over the
namespace's ugliness — a collision is handled case-by-case when Excel ships one).
**What would reverse it:** (1) a real user corpus that leans on legacy names could soften
blocking into documented aliases; (2) an Excel release colliding with a bare Solenoid name
forces a rename or precedence rule — revisit then, not preemptively.

### D20 — Units attach at the granularity of homogeneity; matrices get ONE unit
**When:** 2026-07-14 (author, correcting the A4 record: "I thought I said matrices should
have homogeneous units, not none").
**The problem:** bundle 05 recorded "Matrix = unit-AGNOSTIC always" with no rationale
attached, and the matrix node family shipped unit-blind (the coercion boundary strips
tags at their inputs). That didn't match the author's intent, and it left a hole in the
lattice: a heatmap of temperatures silently loses its unit on becoming a matrix, while
the same numbers as a frame column keep theirs.
**The decision — the governing principle:** *units attach at the granularity where the
container guarantees element homogeneity.* Scalar → the value. Frame → the COLUMN
(homogeneous population). **Matrix → the WHOLE MATRIX** (one element family per matrix —
the Table Input SegToggle / table-socket split — so one unit, a single tag per value, NOT
per-cell). **List → per-cell, deliberately** (reaffirmed): a list is the one rank with no
homogeneity guarantee — it serves as both a column fragment and a FRAME ROW (Get Row
yields legitimately mixed units) — so tagged cells stay, with uniformity enforced where
mixing matters (`forAggregateUnits` → `#UNIT!` at folds; `elemUnitOf`'s shared-unit check).
**Representation:** the one matrix tag is a symbol-keyed `ColumnUnit` on the outer
array (`unitValue.ts`) — invisible to iteration/JSON, LOSSY by design (a rebuilt array
drops it), so ops that keep the unit re-tag and everything else strips.
**A `MatrixValue` wrapper was CONSIDERED and REJECTED (relapse guard — still the right
call):** a wrapper must pass through `toMatrix`/`toScalar`/`toList` — the universal
coercion primitives every node leans on — plus every math kernel, display, popup, and
the serializer: domain-wide churn for a niche case, with only partial type-safety
payoff. The fragility is localized (only array-REBUILDING sites drop the tag), so the
right fix is a complete, self-guarding discipline, not a new representation.
**The op-unit POLICY + its guard:** every matrix op declares carry /
carry-if-uniform / convert / strip / na / author; `matrixUnitPolicy.test.ts` holds the
per-op behavior table PLUS a completeness sweep that FAILS THE BUILD if a matrix-taking
node ships without a declared policy — the discipline is structural, not whack-a-mole.
(MMULT/MDETERM/MINVERSE = documented strip; dimensioned linear algebra is out of scope.)
**Cube = units PER CELL, like a list:** a cube is heterogeneous per cell (a cell can be
a scalar, list, matrix, or nested frame) — the LIST's shape, not the frame's — so a
dimensioned cube cell carries a base-SI `UnitCell` as a value; the frame↔cube round
trip recovers a uniform column unit.
**What would reverse it:** a real need for per-column units on anonymous matrices —
which is what the FRAME is for; use a frame.

### D21 — Selection surfaces act on what you can SEE (and audit calls default to FIX)
**When:** 2026-07-16 (author, during the standing audit walk: "the decision is to fix
things and make them better").
**The decision, part 1 — the selection rule:** every selection surface (lasso, Ctrl+A,
future marquee variants) skips nodes the user cannot see or interact with: members
hidden inside a collapsed group (`groupCollapseStore.isNodeHidden`) AND isolate's
receded non-focus nodes (`isolateStore.isVisible` — they render at opacity .08 with
pointer-events:none). Selection is a visual gesture; invisibly selecting a node the
user can't reason about produces silent mis-groupings and mystery deletes. Deleting a
collapsed group never deletes its members (they just unhide), so nothing becomes
unreachable under this rule.
**Part 2 — the audit default:** when an audit finds behavior that is defensible but
worse ("technically consistent" but surprising), the standing author instruction is to
FIX it, not to file it away as acceptable. Deference is for genuine semantic forks
(e.g. the base-SI vs display-unit adoption call), not for polish.
**Cost accepted:** "select all" no longer literally means every node in the editor —
a Ctrl+A + Delete during isolation deletes only the focus set. That asymmetry is the
point.
**What would reverse it:** a real workflow that needs gesture-selection of hidden
nodes (none known — the Navigator and where-used exist for reaching things you can't
see).

### D22 — The Power Query analogue is a Composite preset, not a new node class
**When:** 2026-07-22 (author: "re-use the existing Composite node + its drill-in view
to set up a Power Query-esque data transformation node which … only transforms &
refreshes manually").
**The decision:** Solenoid's Get & Transform analogue is (1) a `"manual"` Composite run
mode — computationally identical to Single run (one `runPass`), but ALWAYS heavy, so
the existing arm-and-run hold applies: upstream ticks only flag the stale dot; the
Solve button (relabelled **Refresh** with a refresh glyph in this mode) re-runs the
chain — and (2) a **Query** Add-menu entry (`type: "query"`, paired with Composite)
that is the SAME `CompositeNode` class pre-seeded: exposed **Table** input marker wired
straight to a **Result** output marker, `runMode: "manual"`. No `QueryNode` class, no
new persistence shape (it saves as a plain `CompositeNode`), no applied-steps list —
the drill-in canvas IS the steps view, and the frame verbs are the steps.
**Why:** the hold machinery (solveKey ref-tokens make a recomputed upstream frame
stale, `internalEditSeq` makes a drill-in edit stale) is exactly Power Query's refresh
model and already existed; a run mode + preset costs ~no new surface. One deliberate
semantic: `requestSolve(insideOnly)` ignores `insideOnly` in manual mode — frame ports
have no numeric seeds, so a drill-in Refresh always re-runs on the real wired inputs.
Pre-seeded catalog entries ship a pending internal snapshot, so every add path now
hydrates a CompositeNode right after `create()` (Canvas menu, `addNodeByCatalogType`,
the drill-in add menu), mirroring the load path.
**What would reverse it:** the container genuinely needing per-step preview/caching
(a value box per verb inside the chain already gives most of this) or query-specific
boundary typing that adoption can't express — either would argue for a real subclass.

### D23 — Formulas accept matrices (Tier 4 resolved: the D2 cap lifts, matrices-only)
**When:** 2026-07-28 (author, with the `v2.0/17-matrix-formulas.md` packet on the
table: "Yes — lift the limit").
**The decision:** Expression / LAMBDA formulas will accept 2-D MATRICES with Excel
dynamic-array semantics. Frames and cubes stay out of formulas (rung 4 was rejected
on record — no Excel semantics to copy, competes with the verb engine, breaks
lazy-FrameRef economics). This supersedes the "permanent" reading of the D2 formula
cap; D2's OTHER half (the composite toolbar reroute) is untouched.

**AMENDED 2026-07-28 (same day, author challenge): complex is NOT excluded.** The
original clause read "frames, cubes and complex stay out" — but complex was
piggybacking on reasons that only apply to frames/cubes (Excel HAS complex
semantics: the IM* family), and its actual technical blocker (the [re,im]/2-list
ambiguity) was removed by VAL-15 the same day. Worse, the exclusion was never
enforced: `anydata` accepts the complex family, so tagged Cx values already flow
into formulas — where operators concatenate them into "[object Object]1" and the
Formula.js IM* names work on TEXT complexes ("3+4i") while refusing tagged ones.
Complex-in-formulas is therefore an OPEN build (backlog), not an exclusion: own the
IM* family over tagged Cx (FX-1, the complex.ts kernels), accept Excel's text form
on the way in, and make an operator on a Cx a typed #TYPE! instead of garbage.
**The criteria that decided it** (fixed 2026-07-14): correctness + coherence only —
the identity objection was retired by the author. What made it decidable now:
registry unification is real through Tier 3 (one shared impl per function,
node-equality-tested), and the VAL-15 complex rebrand removed the recorded
shape-branding blocker, so `Array.isArray` at two depths IS the rank test — no
branded-value wrapper, no type pass.
**Bound rules (the packet, now normative):**
- **Containment:** Formula.js never sees a matrix — a rank-2 argument dispatches
  only to a declared, owned registration; the fallthrough stays 1-D permanently.
- **Broadcast:** the eleven-row table in `v2.0/17-matrix-formulas.md` Part 2,
  transcribed into `broadcastRules.test.ts` as one literal (SSOT-6).
- **PAD:** split by operation kind, per the standing rulings — element-wise ragged
  ops pad `null` (P3), shape CONSTRUCTION pads `#N/A` (D15). No new rule.
- **Orientation:** a list is a ROW where orientation matters (SOCK-2's convention);
  a column is spelled TRANSPOSE(list).
**What would reverse it:** the broadcast table proving unimplementable without a
grid (spill/`@` complications leaking in after all), or the transpiler (bundle 08)
demonstrating the semantics diverge from Excel in ways users hit — either would
argue for re-capping to 1-D, recorded as a new decision, not a silent revert.

---

## Structural risks (the threats register — distinct from bugs)

Not defects and not opportunities — standing conditions.
These are standing conditions that could hurt the project; each pairs with its mitigation.

- **R1 — Single-author bus factor.** The entire design context lives with one person +
  these docs. *Mitigation:* this exact doc series, the machine-checked seeds, the
  reconcile-the-docs rule. The more the reasoning is written (decisions, glossary,
  invariants), the lower this risk — which is the strongest argument for this whole pass.
- **R2 — Renderer's external flag (D6).** `CanvasDrawElement` reaching stable browsers is
  outside the project's control. *Mitigation:* DOM renderer is the permanent default;
  HTML-canvas is an enhancement, not a dependency. Low residual risk by design.
- **R3 — Polars API churn.** Pinned at 0.46; it's a fast-moving pre-1.0-feeling library.
  Upgrades may break the engine. *Mitigation:* the `FrameBackend` seam + the JS oracle
  (`frameVerbs.ts`) as a reference implementation + the cargo parity tests. Keep the JS
  oracle authoritative so a Polars break is detectable, not silent.
- **R4 — The web/desktop parity tax (consequence of D1).** Two engines that must agree;
  the audit found real drift. *Mitigation:* schema-inference (future-directions Bet 3)
  turns drift into a contract violation; more cargo parity tests. This is a permanent
  maintenance cost, not a one-time fix — budget for it.
- **R5 — Scope-creep pressure toward the "out-of-scope" categories.** The most-requested
  features (a code cell, a live grid, collaboration) are exactly the identity-killers.
  *Mitigation:* the out-of-scope draft, once ratified, plus D2 as the precedent that
  "we say no to power-user escape hatches on purpose."
- **R6 — Doc rot.** The project's named, recurring failure mode. *Mitigation:* the
  reconcile-don't-append rule; the docs index (`docs/README.md`); verifying claims against
  code.
