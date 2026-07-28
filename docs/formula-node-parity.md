# Formula ↔ node parity — audit + design frame

**Status: TIERS 1–3 BUILT (Tier 3 landed 2026-07-28). Tier 4 author-gated.**
The mechanical work D19 greenlit — the ratchet, the alias gate, the Tier 1
registrations, the pack seam, and now the Tier 3 list core — has landed; what remains
is the Tier 4 decision. The audit framing below is kept because Tier 4 still needs it. **Design frame as of 2026-07-14:** Author direction: the expression/equation
formula language and the node set should converge — "people will be expecting that and
we've kind of let it stagnate." The author has also explicitly **reopened the recorded
restrictions** in this area (D2's permanent Expression cap, the broadcastCall/element-wise
assumptions): *"a lot of assumptions have been made and quickly agreed to… I'm not
necessarily committed to assumptions/restrictions that we already wrote down. This project
is still fluid, let's keep an open mind."* Treat the standing rules as defaults pending
this design, not as walls.

Regenerate every number here with `npx tsx scripts/formula-node-parity.ts` (companion to
`scripts/parity.ts`, which measures the Excel→Solenoid gap; this one measures Solenoid
against itself).

## How the two surfaces work today (mechanics)

- **The node surface** is `nodeCatalog.ts` (626 visible leaves) + `nodeExcel.ts`'s
  `NODE_EXCEL` (node type → Excel function(s) it stands in for) + `EXCEL_GAP` (Excel
  functions deliberately not node-backed: 57 rows — 36 out-of-scope, 21
  compose-from-nodes). The Function Reference renders from this.
- **The formula surface** is `excelFormula.ts`: parser → `dispatch(name)` →
  `resolveExcelFunction` (`excelFunctions.ts`), which checks the **internal-impl
  registry** first (25 registered natives — the stalled "first wave" scaffold; 3 are
  Solenoid-only: CLAMP/ORDINAL/BETWEEN) and falls through to **Formula.js** for
  everything else. 422 names are dispatchable. `FORMULA_FUNCTION_NAMES` (the union) is
  autocomplete/highlighting metadata only — it does not gate dispatch.
- **Array semantics in formulas**: `broadcastCall` maps array args element-wise unless
  the function is range-routed (`RANGE_FUNCTIONS`-style sets: aggregates receive the
  vector whole; `RANGE_POSITIONAL` — XLOOKUP/XMATCH/VLOOKUP/HLOOKUP/LOOKUP/MATCH/INDEX —
  receive positional ranges). Dimensionality is capped at scalars + 1-D lists (D2),
  enforced at connect time for Expression/LAMBDA variables and by the `#SHAPE!` block in
  `nodes/expression.ts`.
- **The two surfaces share nothing structurally.** A node op is not callable from a
  formula unless someone hand-registers a native impl; a formula function has no node
  unless someone hand-builds one. Nothing checks the two against each other — which is
  why they drifted.

## Measured state

**Regenerate with `npx tsx scripts/formula-node-parity.ts`. The two ratcheted gaps
are machine-checked by `formulaNodeParity.test.ts` — that test, not this prose, is
the live truth.**

| | 2026-07-14 | 2026-07-27 |
|---|---|---|
| Leaves formula-callable | 266 / 626 | **302 / 646** |
| Gap A — Excel-named node, name not dispatchable | 57 | **19** |
| Gap C — dispatchable, no node, no decision | 75 | **0** |

Gap A's remaining 19 are the D2-capped set and **cannot be closed by registration**:
2-D shapes (TOCOL/TOROW/WRAPROWS/WRAPCOLS/MDETERM/MINVERSE/the table TAKE),
array-returning range functions still needing list-model range routing (FILTER/
SORTBY/GROUPBY/SEQUENCE/RANDARRAY/SCAN), and the lambda META-functions (LAMBDA/MAP/
BYROW/BYCOL/MAKEARRAY/REDUCE). They land if and only if Tier 4 lifts the cap.

### The original 2026-07-14 audit

**Node → formula: 266 of 626 leaves are formula-callable.** The 360 that aren't split
into two very different populations:

1. **57 Excel-named nodes whose name is NOT dispatchable** — the sharpest gap and the
   likely source of "people will be expecting that." These are modern-Excel functions
   Formula.js predates: TEXTSPLIT/TEXTAFTER/TEXTBEFORE, TAKE, SEQUENCE, RANDARRAY,
   TOCOL/TOROW, WRAPROWS/WRAPCOLS, FILTER, SORTBY, XLOOKUP/XMATCH, GROUPBY, SCAN,
   MDETERM/MINVERSE, the dotted distribution variants (NORM.S.DIST, T.DIST, GAMMA.DIST…),
   a bond-pricing block (PRICE/YIELD/DURATION/COUP\*…), REGEX\*, ENCODEURL, and the
   lambda hosts themselves (MAP/BYROW/REDUCE/MAKEARRAY/LAMBDA). A user typing
   `TEXTSPLIT(...)` in an Expression gets `#NAME?` while the node sits in the Add menu.
2. **303 Solenoid-native ops with no formula name at all.** Not one population either:
   ~130 are pack formulas (already Equation/formula presets — parity is moot), ~40 are
   visual/structural/IO (Chart, Report, Conduit, connections — parity is meaningless),
   and the meaningful residue is the **data-op core**: list shape ops (Set, Set relation,
   Coalesce/Fill, SLICE/REVERSE/DIFF/Interleave/Pad, Rolling aggregates, WAVG/WSTDEV,
   COUNT DISTINCT, ARGMIN/ARGMAX…), the 19 frame verbs, and the cube quartet.

**Formula → node: 422 dispatchable names, 96 with no node home — only 21 of them
deliberate** (EXCEL_GAP). The other **75 are untracked**: mostly pre-2010 legacy aliases
Formula.js drags in (NORMDIST, STDEVP, TDIST, PERCENTILE, RANK, MODE, COVAR, BETADIST,
FORECAST, GROWTH, AGGREGATE, NETWORKDAYSINTL…) plus our own 3 natives (CLAMP/ORDINAL/
BETWEEN, which NODE_EXCEL simply doesn't claim). Consequence: **D10 is currently violated
on the formula surface** — VLOOKUP is `oos: true` ("superseded by XLOOKUP") in EXCEL_GAP,
yet `VLOOKUP(...)` dispatches fine in an Expression (it's even range-routed). Nobody
decided that; it's drift.

## What "parity" could mean — the tiers, cheapest first

**Tier 1 — close the 57 (Excel-named nodes → dispatchable names). ✅ BUILT
2026-07-27** — 28 names registered (the modern text functions, FORECAST.LINEAR, and
the 20-name bond/security block Formula.js lacks), each calling the NODE'S OWN
compute via a shared pure module (`textOps.ts` / `financeOps.ts` /
`mathUtils.linearFit`) so the surfaces cannot drift by construction. Only the
D2-capped remainder is left. Pure
`registerInternal` work; the node implementations already exist, so most registrations
are thin wrappers around the node's own compute (or a shared helper both call — the
right refactor where the node's `data()` is thick). No new semantics for the scalar/1-D
ones (TEXTSPLIT, TAKE, SEQUENCE, dotted distributions, bond pricing). Three sub-cases
need a call:
  - *2-D-shaped ones* (TOCOL, WRAPROWS, MDETERM, MAP/BYROW…) are blocked by the D2 cap,
    not by registration — they land automatically if Tier 4 lands, and stay out if not.
  - *Range-semantics ones* (XLOOKUP/XMATCH, FILTER, SORTBY, GROUPBY) need range routing
    (the `RANGE_POSITIONAL` mechanism already exists — extend it).
  - *Meta-functions* (LAMBDA as a value, MAP hosting a lambda) are a language feature,
    not a registration; defer to Tier 4 thinking.

**Tier 2 — curate the untracked 75 (formula-only names).** An explicit alias policy:
either (a) legacy aliases stay callable as a compat courtesy and get listed in a
LEGACY_ALIASES table (documented, redirect note in the reference), or (b) D10 applies to
formulas too and the eliminated/superseded ones return a `#NAME?` with a "use X" hint.
**DECIDED: (b), blocked — see Decisions below. ✅ BUILT 2026-07-27** as
`LEGACY_ALIASES` (excelFunctions.ts): 93 superseded Excel spellings and
never-were-Excel Formula.js aliases return `#NAME?` naming the current function,
and are dropped from autocomplete and range routing. Gap C is now 0 — the
remaining current-Excel names with no node (AGGREGATE, GROWTH, N, T, TYPE,
ISO.CEILING, CEILING.PRECISE, FLOOR.PRECISE) are recorded in `EXCEL_GAP` instead.

**Tier 3 — formula names for the Solenoid-native data-op core. BUILT 2026-07-28.**
31 registrations covering Lists › Shape / Find / Aggregate / Build / Rolling: REVERSE,
SLICE, NTHELEMENT, INTERLEAVE, PADLEFT/PADRIGHT, DIFF, NORMALIZE, RUNNINGSUM/PRODUCT/
MAX/MIN, ROLLINGSUM/AVG/MIN/MAX/STDEV/MEDIAN, LENGTH, ARGMAX/ARGMIN, CONTAINS,
WAVG/WVAR/WSTDEV, LINSPACE, REPEAT, GEOMETRIC, FIBONACCI. Naming is bare and per-op
(decision 2(a)): the node LABEL DESPACED, read from the family's OP_META table rather
than reinvented, so "Rolling SUM" is ROLLINGSUM. `formulaNodeParity.ts` despaces the
same way when it measures, which is what stopped it under-reporting every multi-word
native.

Both surfaces call ONE implementation — `nodes/listOps.ts`, extracted from the nodes'
`data()` methods — so a formula and its node cannot answer differently;
`formulaTier3.test.ts` asserts that op by op rather than testing the formula alone.

The two pieces of plumbing it needed:
- **Output rank.** `ExcelImplMeta.rank` ("scalar" | "list") splits the RANK from the
  element type the way the socket lattice already does. Deliberately no "matrix" —
  that spelling arrives with the Tier 4 decision, not before.
- **Whole-list routing.** `listArgs` on a registration routes the call past the
  element-wise broadcaster. It is range routing with the RAW argument policy, not the
  aggregator one, and for the same reason COUNT has it: these ops are
  position-preserving, so dropping nulls out of the vector first would change the
  answer (`REVERSE([1,null,3])` is `[3,null,1]`) and hoisting a cell error to the top
  would erase which cell it came from. Both sets derive from the meta table, so a
  registration cannot declare one and forget the other.

Generators are capped at the FORMULA boundary (`#OVERFLOW!` past `MAX_GENERATED`,
the RANDARRAY/SEQUENCE convention). The nodes stay uncapped on purpose: a Count field
is a spinner the user watches, a formula field is where a typo asks for ten million.

Still open in the list family: Set / Set relation (needs the invented SETUNION-style
names), Coalesce/Fill, Shuffle (nondeterministic), Range and Concat Lists. Frame verbs
are explicitly NOT this tier — a query language in a formula string is its own large
design (and bundle 08's transpiler is the nearer answer for "text in, graph out").

**Tier 4 — the dimensionality cap itself (D2, reopened).** Whether formulas accept
matrices. Discussed with the author 2026-07-14 — full framing in the dedicated section
below; short version: NOT a now-decision. The precondition is finishing the engine
unification; the decision criteria are fixed (correctness + coherence — the
product-identity objection is retired by the author); the endpoint choice ("never" vs
"after unification, matrices-only") waits until the precondition is real.

## Tier 4 in full — the 2026-07-14 discussion, recorded

**What the original cap was actually protecting (the 2026-06-23 archive record —
`archive/dev-notes-history.md`, three same-day entries).** The `#SHAPE!` block predated
the decision and said "yet"; the author's decision made it permanent to close a thread.
The genuinely technical reason recorded is the **type-agnostic evaluator**: values in
formula-land are bare JS things (`Array.isArray` = list), so a complex `[re,im]` is
indistinguishable from a 2-list — fixing that "needs a branded value + a type pass —
exactly the line we're declining to cross." Same day, the author flagged the
**two-engine smell** (formulas run on Formula.js, nodes are hand-rolled natives; results
can diverge — the formula popup still carries the disclosure note) and parked the fix.
So the cap was partly **containment**: stop feeding the weaker, divergent engine.
`archive/formulajs-vs-native-audit.md` §4 makes the order explicit: single registry +
Formula.js→SolError mapping BEFORE any widening.

**What's changed since (verified in code 2026-07-14):** the SolError mapping EXISTS
(`fxErrorToSol`, applied at the dispatch boundary), and the 2026-07-10 node-vs-formula
sweep pinned stats/rounding/math agreement with `formulaDivergence.test.ts`. The audit's
precondition is therefore HALF-met: error integration done, divergence pinned by test,
**structural registry unification still partial** (25 natives; most nodes don't share an
impl with the formula path).

**The case against lifting, steelmanned (what a future session must answer):**
1. *The shape-branding problem* — the type-agnostic evaluator has no way to tell `[[1,2]]`
   (1×2 matrix) from a list-of-one-list, a 2-list from a row; Excel's grid stamps a shape
   on every value, we have no grid. Lifting either sneaks in the branded-value/type-pass
   D2 declined (a second typed engine inside strings) or runs on heuristics that misfire
   at the edges. This is the hard part, NOT the broadcaster.
2. *Feeding the divergent engine* — moot once unification is finished; blocking until then.
3. *The units fork* — largely CLOSED by D20 (2026-07-14): matrices get ONE homogeneous
   unit, so a future 2-D formula path shares the same single-tag rule as the node chain
   (`dimEval` with one matrix dim is the 1-D machinery unchanged).
4. *"Copy Excel DA" is a translation* — no cells → no spill/implicit intersection/#SPILL!;
   DA-for-sockets is a design act with parity-bug exposure. The broadcast-rules table
   (formatModel-style, machine-checked) is the cheap probe that surfaces regrets early.

**The author's criteria ruling (2026-07-14, verbatim intent):** the product-identity /
canvas-auditability objection ("big formulas hide logic and erode the app's
differentiator") is **explicitly retired** — *"if people find the normal app valuable
enough to use over Excel in the first place, they won't be tempted to only use the
Solenoid formula engine either; someone who wants everything in a tiny compact formula
will just use Excel already."* Tier 4 will be decided on **what is correct and necessary
for coherence** — engineering grounds only. Do not re-litigate the identity argument.

**Standing plan:** (1) finish the registry unification as part of the D19 Tier 1 work —
closing the 57 grows the registry anyway, so the precondition and the greenlit work are
the same motion; (2) with unification real, bring Tier 4 back with a concrete
shape-branding design + the DA broadcast-rules table; the two defensible endpoints are
"never (formulas stay 1-D glue)" and "matrices-only, full Excel-DA semantics — frames/
cubes/complex stay out" (rung 4, frames-in-formulas, is rejected outright: no Excel
semantics to copy, competes with the verb engine, breaks lazy-FrameRef economics).
The transpiler (bundle 08) is the standing pressure that keeps the lift alive: real
workbooks are full of dynamic-array formulas, and under the cap they transpile inert.

## Proposed machinery — make parity an invariant, not a cleanup

Whatever tiers are chosen, the reason this rotted is that nothing enforced it. Two
cheap, permanent guards:

1. **A ratchet test** (`formulaNodeParity.test.ts`) — ✅ BUILT 2026-07-27. Pins gap
   A and gap C BOTH ways: a new gap fails, and a closed gap must be deleted from the
   pin, so the lists can't rot into fiction. The measurement is shared with the report
   script (`formulaNodeParity.ts`) so the two can never compute the gap differently.
   Originally specified as: pin today's three gap lists (the
   57, the 75, and the native-core subset of the 303 once Tier 3 scopes it) as explicit
   arrays; assert the live gap is a SUBSET of the pinned list. Closing a gap shrinks the
   pin; adding a NEW node with an Excel name and no formula registration (or a new
   dispatchable name with no node/gap entry) FAILS CI with a pointer here. Same pattern
   as `formatModel.ts` (the truth table as machine-checked code).
2. **One authoring seam**: when a new op is added, it should be declared ONCE with both
   surfaces derived — realistically, a `registerInternal` call next to the op's meta
   table plus a NODE_EXCEL row, with the ratchet test forcing the pair. (A full
   single-source op registry that generates node + formula + reference is a bigger
   refactor; not proposed now.)

## Decisions (2026-07-14, author — recorded as D19; build deferred to a dedicated session)

1. **Legacy aliases: BLOCKED.** D10 applies to the formula surface too. Implementation
   shape: a curated blocklist (the EXCEL_GAP `oos` names + the untracked-75 legacy set)
   gated at `dispatch`/`resolveExcelFunction`, each returning `#NAME?` with a "use X"
   redirect hint; drop the blocked names from `RANGE_POSITIONAL` and autocomplete. The
   ratchet test then pins the *blocked* list instead of tolerating the drift.
2. **Naming: bare names, UNIFIED with the node header hover hint.** The hint
   (`typeHint()` in `nodeKit.tsx`: class name minus `Node`, camelCase split, uppercased)
   and the formula name are the same identity — spaces removed for dispatch
   ("SET RELATION" → `SETRELATION`). Two implementation notes for the build session:
   (a) the hint is per-CLASS while several classes are multi-op families (SetOpNode:
   union/intersection/…) — op-as-argument (`SETOP("union", a, b)`) mirrors the node's
   own op-selector shape, but per-op names are also defensible; decide there, under the
   unification rule. **RESOLVED 2026-07-27: per-op names, uniformly — and the name is
   the node's LABEL despaced, not the class hint.** The deciding argument is the editor
   rather than taste: a string-literal op is invisible to it — no autocomplete, no
   unknown-name highlighting, no signature hint — so `SETOP("unoin", a, b)` fails at
   runtime where `SETUNOIN(a, b)` is flagged as you type. The Tier 3 sketch above
   already assumed this ("SETEQ/SETDIFF-style"), and the LABEL already changes per op
   (the card reads ARGMIN, never ARGMINMAX — the class name is an implementation detail
   the user never sees for these). Three of the four families fall straight out, their
   labels being names already: WAVG/WVAR/WSTDEV, ARGMIN/ARGMAX, and Rolling SUM →
   ROLLINGSUM (…AVG/MIN/MAX/STDEV/MEDIAN). Only `SetOpNode` needs invented names, its
   labels being prose ("Union: in A or B"): SETUNION, SETINTERSECT, SETDIFFERENCE,
   SETSYMDIFF. (b) Excel-named ops (UPPER, TRIM…) keep their Excel names — this
   rule is for the Solenoid-native core only.
3. **Tier 4 (the reopened D2 cap): discussed 2026-07-14 — see "Tier 4 in full" above.**
   Not decided; criteria fixed (correctness + coherence; identity objection retired);
   precondition = finish the registry unification (same motion as the Tier 1 work).
   D2 stands as the working default meanwhile.
4. **Packs register their own formula functions** through the `registerInternal` seam,
   same naming rule — a pack ships its node + formula surface together. ✅ **BUILT
   2026-07-27** as `formulaExtensions.ts`, the direct sibling of `fcExtensions.ts`:
   declare `formulas: PackFormula[]` on a `Pack`.

   **Resolution is global, advertising is active-only.** A formula pack node serializes
   as a plain ExpressionNode and reloads with its pack switched off, so the functions
   its formula calls must keep answering — a deactivated pack that turned saved
   documents into `#NAME?` would be data loss, not tidiness. Autocomplete and
   highlighting offer a pack's names only while it is on.

   `FORMULA_FUNCTION_NAMES` was a load-time snapshot, which is exactly why the name set
   could never see pack registrations; it is now `formulaFunctionNames()`, memoized
   against a registry generation counter, with `advertisedFunctionNames()` as the
   editor-facing subset. A pack may not claim a core name, a blocked legacy spelling,
   or another pack's name — all three throw at startup rather than silently shadowing.

   **The guarantee covers DEACTIVATED, not ABSENT.** A `PackFormula.impl` is a JS
   function shipping inside the pack, so a pack removed from the packs folder has
   nothing to call: it sits on the custom-LOGIC side of the line `pack-architecture.md`
   already draws, not the pre-set-formula (data) side. The unsolved piece is DIAGNOSIS,
   and it is narrower than the placeholder plan covers — a pack function called from a
   hand-typed Expression is not a pack NODE, so nothing degrades it and the error never
   names the missing pack. Needs the unbuilt saved-file pack record; tracked under
   "Pack distribution" in the backlog.

**Status (2026-07-27): the whole greenlit mechanical set is BUILT** — the ratchet, the
alias blocklist, the Tier 1 registrations, and the pack seam. Still open:

- **Tier 3** — formula names for the Solenoid-native data-op core. Naming is now fully
  decided (see decision 2(a)); what is left is mechanical plus two pieces of plumbing:
  a list `ExcelReturn` type, and range routing for list-in-list-out functions.
- **Tier 4** — author-gated. Gap A's remaining 19 names ride entirely on it.

Two bugs the ratchet surfaced on its first run, both fixed:
- `fxLookup` walked objects but not FUNCTIONS, while the NAME walk descended into both.
  Ten current-Excel names (CEILING.MATH, CEILING.PRECISE, FLOOR.MATH, FLOOR.PRECISE,
  GAMMALN.PRECISE, SKEW.P, T.TEST, NETWORKDAYS.INTL, WORKDAY.INTL, BINOM.DIST.RANGE)
  autocompleted and then threw "Unknown function" when called.
- Formula.js's internal `utils.*` namespace was being advertised as callable Excel
  functions.

And two the pack-seam test surfaced: `initPackFormulas()` was not re-runnable (its
collision check read its own previous registrations as core ones), and a removed pack's
functions lingered because `registerInternal` had no inverse.
