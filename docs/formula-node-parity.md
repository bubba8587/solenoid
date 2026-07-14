# Formula ↔ node parity — audit + design frame

**Status: WORKING DESIGN DOC (2026-07-14).** Author direction: the expression/equation
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

## Measured state (2026-07-14)

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

**Tier 1 — close the 57 (Excel-named nodes → dispatchable names).** Pure
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
Either is fine; **undecided-by-drift is the only wrong state.** (Author call — this is
the D10-consistency question.)

**Tier 3 — formula names for the Solenoid-native data-op core.** SETEQ/SETDIFF-style
registrations for the list/set utilities. Needs two small pieces of plumbing (a list
`ExcelReturn` type + range routing for list-in-list-out functions) and one design
decision: **naming**. Options: bare names matching the node labels (REVERSE, SLICE —
risk: future Excel collisions), or a SOL. namespace (SOL.REVERSE — the dotted-name
machinery already exists for NORM.DIST). Frame verbs in formulas are explicitly NOT this
tier — a query language in a formula string is its own large design (and bundle 08's
transpiler is the nearer answer for "text in, graph out").

**Tier 4 — the dimensionality cap itself (D2, reopened).** Whether formulas accept
matrices/frames. This is the real fork:
  - *Keep the cap*: formulas stay the scalar/1-D glue language; 2-D work stays in nodes;
    Tier 1's 2-D sub-case stays out. Cheapest, and the MAP/BYROW hosts remain the
    sanctioned 2-D formula path (which they already are — the cap has a deliberate
    2-D escape hatch today).
  - *Lift to 2-D*: the evaluator's broadcaster generalizes (element-wise over matrices,
    aggregates flatten, shape errors on mismatch) — a real but bounded engine project;
    makes ~15 more of the 57 registrable; partially obsoletes the MAP host node for
    simple cases. The sudoku seed is a ready-made stress corpus.
  - Either way, **decide once and record it in decisions.md as the D2 successor** —
    D2's current text says "permanently," which no longer reflects the author's stance.

## Proposed machinery — make parity an invariant, not a cleanup

Whatever tiers are chosen, the reason this rotted is that nothing enforced it. Two
cheap, permanent guards:

1. **A ratchet test** (`formulaNodeParity.test.ts`): pin today's three gap lists (the
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

## Open questions for the author

1. Tier 2 policy: legacy aliases — compat courtesy (documented) or D10-blocked?
2. Tier 3 naming: bare node-label names or a SOL. namespace?
3. Tier 4: keep the 1-D cap (formulas = glue language) or lift to 2-D?
4. Sequencing: Tier 1 + the ratchet test are mechanical and could start now — greenlight?
