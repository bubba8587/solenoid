# Solenoid — Architecture Rules

**Normative.** Every entry here is a MUST that a change has to satisfy, paired with the
test that enforces it. This is the layer the other docs don't have: `decisions.md` says
*why* a call was made, `subsystem-invariants.md` says *how* a mechanism works, and this
says *what must remain true*. If you want the reasoning, follow the link; if you want to
know whether your change is legal, read here.

## Scope

Three domains, chosen because they are the ones that **cannot be caught by looking at the
app**: a broken socket rule, a wrong formula name or a mishandled null produces a
plausible-looking answer, not a visible defect.

| Domain | Prefix | Covers |
|---|---|---|
| Derivation | `SSOT` | where a fact is declared and how other surfaces get it |
| Sockets | `SOCK` | the type lattice, connection legality, coercion at the boundary |
| Formula surface | `FX` | registration, naming, argument routing |
| Value handling | `VAL` | null, SolError, logical, units |

**Out of scope here:** UI, visual and copy rules live in `DESIGN.md` and are enforced by
`uiCopy.test.ts`. Branch model, doc duty and commit style live in `CLAUDE.md`. This file
does not repeat them.

## Conventions

- **Cite rule IDs** in code comments, commit messages and backlog items (`per FX-4`).
  A rule nobody cites is a rule nobody applies.
- **`Enforced by:`** names the test that fails when the rule is broken. A rule marked
  **`UNENFORCED`** is *debt, not decoration* — it is a rule we currently trust people to
  remember, which is exactly how every bug in the "Origin" notes below happened.
- **Exceptions are listed under their own rule**, never in a separate file, so the count
  is visible at the point of reading and the pressure on it is downward. An exception
  states what would remove it. An exception with no removal condition is a rule that was
  written wrong — fix the rule instead.
- **`Origin:`** records the incident that produced the rule. Rules invented without an
  incident tend to be someone's taste; rules with one are load-bearing.

## Process

Spec-first for **new mechanisms and cross-cutting changes**: a new subsystem, naming law,
declaration format, or a sweep touching many files updates this document *before* the
code. Ordinary work — a node, a bug fix, a one-line change — just follows the existing
rules. Every bug fix ships the check that would have caught it, or says why it can't
(`SSOT-5`). This is the working default, not an author ruling; tighten it freely.

---

# SSOT — Derivation and single source of truth

The theme of every architecture bug found to date. A fact that is written down twice
drifts; a property that is hand-maintained gets missed.

### SSOT-1 — One declaration per fact
**MUST:** every user-visible fact (a label, a name, an op's identity, an arity) has
exactly ONE declaration. Every other surface DERIVES from it. Transcribing a value into a
second location is a defect even while the two agree.

*Why:* two copies have no mechanism keeping them equal, so they are already wrong; you
just haven't looked yet.
*Enforced by:* `nodeOps.test.ts` → "the ops list is derived, not transcribed", "the
hand-written name lists cover their meta exactly", "a name list names its ops — it never
repeats the meta's prose".
*Origin:* the IS.TEST card read `ISBOOLEAN` while Add-menu search offered `ISLOGICAL` —
you could read a name off a card and fail to find it in the menu. Two `OPS` arrays, one
in the component and one in `nodeOps.ts`.

### SSOT-2 — Where a derivation can't be total, the override lives in the same table
**MUST:** when a derived value can't be computed for every case, the exception is
declared as a FIELD on the same declaration (the `fx` field on an `OP_META` table), never
as a parallel lookup map keyed by the same identity.

*Why:* a parallel map is SSOT-1's failure wearing a different hat — it is a second place
that must be kept in step, and it is not next to the thing it modifies.
*Enforced by:* `formulaTier3.test.ts` → "the prose-labelled families — names DECLARED, not
despaced".
*Origin:* D19 2(a) derives a formula name by despacing the node label, which works only
while a label is a name. Three families label themselves in sentences for the dropdown
("Union: in A or B"). `fx` sits on `SET_OP_META` / `SET_RELATION_META` / `FILL_OP_META`.

### SSOT-3 — No hand-kept list of a derivable property
**MUST:** membership sets that encode a property of a declaration (routing, exposure,
capability) are DERIVED from the declarations. A hand-written set is permitted only for
facts that live nowhere else, and it must then be shape-checked (`SSOT-4`).

*Why:* a hand-kept set fails open. Nothing errors when a name is missing from it — the
behaviour just silently changes.
*Enforced by:* `excelFunctions.ts` `listReturningNames()` / `wholeArgNames()` derive from
`EXCEL_IMPL_META`; `formulaTier3.test.ts` → "the declarations stay honest".
*Exceptions:* `RANGE_FUNCTIONS` (`excelFormula.ts`) is still hand-kept for the Formula.js
half of the surface, because Formula.js publishes no machine-readable signature to derive
from. Shape-guarded by `rangeRouting.test.ts` per `SSOT-4`. **Removed by:** deriving
argument shape from a signature table, if one is ever authored.
*Origin:* ten functions — `T.TEST`, `F.TEST`, `Z.TEST`, `CHISQ.TEST`, `SUMX2MY2`,
`SUMX2PY2`, `SUMXMY2`, `MODE.SNGL`, `PROB`, `SERIESSUM` — were missing from
`RANGE_FUNCTIONS` and had been silently broadcast element-wise, each returning a
plausible-looking wrong value.

### SSOT-4 — An irreducibly hand-kept set is guarded by SHAPE
**MUST:** where `SSOT-3` grants an exception, a test asserts the *observable consequence*
of membership, not merely the membership. Assert what the function does, not that its
name appears in a set.

*Why:* checking membership against a hand-written list of the same names proves nothing.
Checking that `T.TEST` returns one number rather than four is a real check.
*Enforced by:* `rangeRouting.test.ts` → "whole-sample functions are range-routed, not
broadcast".

### SSOT-5 — A rule not enforced by a test is debt, and is labelled
**MUST:** each rule here carries `Enforced by:` or `UNENFORCED`. A bug fix ships the check
that would have caught it, or states why it can't be checked.

*Why:* the difference between a spec and a folk memory is whether anything fails when you
break it. `CLAUDE.md` already carries an honest example of the alternative — the
OS-dropdown rule, "widely cited, but no originating incident is on record", 21 call sites
held on precaution.
*Enforced by:* `UNENFORCED` — this rule is about the document, and is checked by review.
A `rules.test.ts` asserting every ID resolves to a real test file would close it.

### SSOT-6 — A gating metric has exactly one implementation
**MUST:** a number that gates CI is computed in ONE module. The human-readable report and
the ratchet test call the same function. Neither recomputes it.

*Why:* a report that measures differently from the test is how a ratchet silently stops
ratcheting.
*Enforced by:* `formulaNodeParity.ts` is the single measurement, imported by both
`scripts/formula-node-parity.ts` and `formulaNodeParity.test.ts`; its header states this.
*Origin:* stated as a comment, then violated twice in one session anyway. The measurement
matched a leaf by its host label (reporting nine registered `FILL*` functions as a gap),
and gap A was computed as `!inFormula`, so registering `RUNNINGSUM` made `SCAN` drop out
of the gap it was still in. See `SSOT-7`.

### SSOT-7 — A metric measures one thing
**MUST:** a coverage metric that answers two questions is split into two fields. Do not
derive "is this Excel name callable" from "is this node reachable somehow".

*Why:* folding them lets one improvement mask an unrelated regression.
*Enforced by:* `formulaNodeParity.ts` — `inFormula` (reachable by any name) vs
`excelCovered` (every Excel name dispatches), with the reason in the type comment.

### SSOT-8 — Completeness quantifiers are `every`, not `some`
**MUST:** a claim of the form "this node supports X" over a SET of names is checked with
`every`. `some` is permitted only where partial support is the deliberate, documented
contract.

*Why:* `some` reports a node covered when most of its names still fail.
*Enforced by:* `formulaNodeParity.ts` `excelCovered`.
*Origin:* the `some` form hid ten names — the seven B-suffixed text functions,
`ERF.PRECISE`, `ERFC.PRECISE`, `VALUETOTEXT` — each declared against a real node while
the formula surface answered `#NAME?`.

---

# SOCK — The socket lattice

The lattice is a family × rank product, and its legality rules are DERIVED from that
product rather than enumerated per pair. Full mechanics: `docs/socket-reference.md`,
`CLAUDE.md` "Socket lattice".

### SOCK-1 — Type separation: element families never auto-cross
**MUST:** a value of one element family never connects to an input of another. Crossing
requires an explicit Cast node.

*Enforced by:* `socketConnect.test.ts` → "CROSS-family is blocked everywhere EXCEPT
logical↔number (dim-mirrored)".
*Exceptions:* `logical ↔ number` is the ONE bridge (boolean ↔ 0/1), mirrored at every
rank. **Removed by:** nothing — it is the deliberate consequence of Excel treating
TRUE/FALSE as 1/0. Any *second* exception is a lattice design change, not a patch.

### SOCK-2 — Dimensional flow: values widen up, never narrow down
**MUST:** scalar → list → matrix → frame is permitted within a family; the reverse is
refused. A list widens into a 2-D input as a ROW.

*Enforced by:* `socketConnect.test.ts` → "WITHIN a family: a value widens UP (+
combo→scalar), and never narrows", "every rank≤2 value (ANY family) widens INTO the 2-D
containers".
*Exceptions:* a COMBO (scalar-or-list) narrows into its element scalar; a plain list does
not. This is what makes a combo a combo. **Removed by:** nothing.

### SOCK-3 — Adding a socket type is a derived edit
**MUST:** a new socket type is added by extending the family/rank product. Cross-type
dimensional edges are explicit in `accepts()` and swept exhaustively by test. A new type
must not require hand-writing its pairs.

*Why:* the lattice has 30 variants; enumerating pairs by hand is quadratic and wrong.
*Enforced by:* `socketConnect.test.ts` → "lattice invariants — TYPE separation +
DIMENSIONAL flow (full sweep)"; `socketFamilyCompleteness.test.ts`.

### SOCK-4 — The wildcard ladder keeps rank
**MUST:** `any` is an untyped SCALAR, `anylist` / `anytable` are 1-D / 2-D, and `trueany`
is the adopt-anything supremum. A rank-bearing wildcard keeps its rank and adopts only
the element family.

*Enforced by:* `socketConnect.test.ts` → "`any` INPUT: family scalars + combos in;
lists/matrices/containers refused", "anylist INPUT/OUTPUT", "anytable OUTPUT stays 2-D",
"`trueany` bridges everything, both directions".

### SOCK-5 — Adoption never drops cables and never persists
**MUST:** `trueany` adoption (`trueAnyAdopt.ts`) resolves a type without disconnecting
anything, and the adopted type is not written to the save file.

*Enforced by:* `trueAnyAdopt.test.ts` covers adoption and REVERT-on-disconnect ("a
Display adopts on both sides and REVERTS on disconnect", "adoption propagates down a
passthrough CHAIN", "two Displays do NOT share adoption"). **"Never persists" is
`UNENFORCED`** — no test asserts an adopted type is absent from the save.

### SOCK-6 — "Resolve past untyped passthroughs" goes through one predicate
**MUST:** every place that needs to see through an untyped hop calls `isWildcardType()`.
No local re-implementation of "is this socket untyped".

*Why:* three subtly different notions of "untyped" is three subtly different bugs.
*Enforced by:* `UNENFORCED` — a grep-based check that no file inlines the wildcard set
would close it.

### SOCK-7 — In-place retype must reconcile downstream
**MUST:** a node that mutates a socket's `dataType` in place (Cast target, LAMBDA result,
Get Column read-as, Note frontmatter) fires no connection event, so it MUST call
`reconcileFcTypes` / `retypeOutputCables`.

*Why:* without it, downstream Format Controllers keep stale formats.
*Enforced by:* `fcReconcile.test.ts`, `noteFcPropagation.test.ts` cover the BEHAVIOUR of
the known retypers. **Completeness is `UNENFORCED`** — nothing proves a *new* in-place
retyper calls it. See Known violations.

### SOCK-8 — The socket box is a deterministic 12×12
**MUST:** the socket span renders `display:block; line-height:0` at a locked 12×12, and
vertical placement is MEASURED per row — never a fixed constant, never a `transform`.

*Why:* `rete-render-utils` measures the span's offset box for cable endpoints, and
`offsetTop` ignores transforms, so rete would misreport the endpoint.
*Enforced by:* `UNENFORCED` (a CSS + layout invariant; `CLAUDE.md` carries the detail).

### SOCK-9 — `anydata`: the rank-≤2 element-agnostic wildcard (D23)
**MUST:** `anydata` accepts every FAMILY value of rank ≤ 2 (scalar / list / combo /
matrix) plus the lower wildcards (`any`, `anylist`, `anycombo`, `anytable`), and
REFUSES frames, cubes and the object family (lambda / chart / document). As an
OUTPUT it flows wherever `anycombo` flows (runtime-shaped, same accepted risk). Its
membership edges are DERIVED additions to `accepts()` per `SOCK-3`, swept by the
full lattice test. Expression VARIABLES are `anydata` — that is the D23 lift.

The RESULT keeps its family: the `resultAs` combo socket stays for rank-≤1
results, and when a computed result is a MATRIX the node swaps its result socket
to the same family's matrix rung and reconciles per `SOCK-7`
(`retypeOutputCables`) — value-driven, but through the same machinery every
in-place retype uses. Family typing for downstream FCs survives; the socket never
lies about rank.

*Why:* the D23 endpoint is matrices-ONLY. A `trueany` variable would admit frames
and cubes into formulas (out of scope, permanently); `anycombo` refuses the
matrices the decision admits. The lattice needed the one rung between them. The
result is NOT `anydata` because that would trade away the family (`familyOf` =
none) that Format Controllers key on, for a rank the matrix rungs already spell.
*Enforced by:* `socketConnect.test.ts` (the full sweep + the anydata cases);
`expressionMatrix.test.ts` (the lift + the result-rank reconcile).

---

# FX — The formula surface

Two surfaces exist for the same functions — the node catalog and the formula language —
and nothing structurally connects them. These rules are what keeps them from drifting.
Program record: `docs/formula-node-parity.md`.

### FX-1 — One implementation, two surfaces
**MUST:** a function callable from BOTH a node and a formula has exactly one
implementation, in a rete-free module (`nodes/listOps.ts`, `textOps.ts`, `financeOps.ts`,
`mathUtils.ts`, `dateSerial.ts`, `convertUnits.ts`). Both callers delegate to it.

*Why:* the two surfaces drifted for exactly as long as they were two implementations.
*Enforced by:* `formulaTier3.test.ts` → "every Tier 3 name computes what its node
computes"; `formulaTier1.test.ts`.
*Exceptions:* `SHUFFLE` cannot assert node-equals-formula because it is VOLATILE and the
two surfaces run different volatility clocks deliberately — the node holds its sort keys
until the next recalc, a formula redraws per evaluation. The PERMUTATION is still one
implementation (`shuffleList` takes its keys as an argument); the test asserts a
permutation plus real variation instead of equality. **Removed by:** nothing — this is
what volatile means. Any future volatile function follows the same split.

### FX-2 — A shared implementation is rete-free
**MUST:** a module imported by the formula path must not pull in rete, the socket lattice
or the frame model.

*Why:* the headless formula path (`run-graph`, the evaluator) should not load the editor.
*Enforced by:* `formulaPathIsReteFree.test.ts` — walks the import graph from
`excelFormula`/`excelFunctions` and fails on any reachable `rete` or `sockets` import.
*Origin:* `interpolateLinear` lived in `stats.ts` and had to move to `mathUtils.ts` before
`INTERPOLATE` could be registered. The rule was VIOLATED while it was unenforced:
`excelFunctions` reached rete through `nodes/date.ts` (the serial helpers) and
`nodes/convert.ts` (the unit table) until both were extracted (`dateSerial.ts`,
`convertUnits.ts`) — found by the enforcement column's own review, which is the argument
for the test.

### FX-3 — A registration declares its full contract
**MUST:** every `registerInternal` name has an `EXCEL_IMPL_META` entry declaring
`returns`, `arity`, and where applicable `rank` and `listArgs`. Routing DERIVES from that
entry (`SSOT-3`); it is never declared twice.

*Enforced by:* `excelFunctions.test.ts` → "every registered internal declares its meta
(FX-3, the registered→declared direction)" — the D10 redirect stubs are out of scope (they
are the gate, not implementations); `formulaTier3.test.ts` → "the declarations stay
honest", "a list-RETURNING function also takes its args whole" (the declared→dispatches
direction).
*Exceptions:* the POSITIONAL lookups (`XLOOKUP`/`XMATCH`/`INDEX`) declare meta but not
`listArgs` — they are routed by `RANGE_POSITIONAL` (skip the error scan) and the flag
would reroute them. **Removed by:** unifying the two routing declarations.

### FX-4 — A derived name function is TOTAL and INJECTIVE
**MUST:** any rule that derives a name (D19 2(a): the node label despaced) must be defined
for every input AND must never map two different things to one name. Both properties are
machine-checked.

*Why:* a naming law without an injectivity check will silently collide, and the collision
is discovered by whoever registers second.
*Enforced by:* `formulaTier3.test.ts` → "the formula namespace stays unambiguous" —
PARTIAL: it sweeps catalog leaf labels and the three declared `fx` tables, but not every
family's op labels against each other. See Known violations.
*Origin:* Fill's `Interpolate` op and the `INTERPOLATE` node in `stats.ts` both despace to
`INTERPOLATE`. Fill's op now declares `fx: "FILLINTERPOLATE"` per `SSOT-2`.

### FX-5 — Array arguments arrive whole
**MUST:** a function taking a whole 1-D list is routed past the element-wise broadcaster.
A function whose arguments are all scalars but whose RESULT is a list is also marked
never-broadcast.

*Why:* without it the evaluator maps the call element-wise and returns N answers to a
question that has one; with a list-returning function it builds a 2-D value behind the D2
cap's back.
*Enforced by:* `formulaTier3.test.ts` → "the whole-list routing"; `rangeRouting.test.ts`.

### FX-6 — Argument prep matches the function's shape, not its category
**MUST:** a routed function declares which null/error policy applies:
**raw** (positions preserved, cell errors ride along) for position-preserving ops;
**pooled** (nulls dropped per array) for aggregators;
**paired** (index-aligned pairwise drop) for term-by-term functions.

*Why:* the aggregator policy is wrong for a position-preserving op —
`REVERSE([1,null,3])` must be `[3,null,1]`, never `[3,1]` — and the paired policy is wrong
for independent samples of different lengths.
*Enforced by:* `formulaTier3.test.ts` → "nulls keep their POSITION", "a cell error rides
along in its own slot" (raw); `auditFixes.test.ts` → "CORREL propagates an embedded error
and drops null pairs" and `excelFormula.test.ts` (SUMPRODUCT pairwise drop) for the
PAIRED policy; `formulaReviewFixes.test.ts` (SERIESSUM's zero-fill, the T.TEST family).
`rangeRouting.test.ts` checks routing SHAPE only, not policy.
*Exceptions:* `T.TEST` and `F.TEST` take the POOLED policy despite comparing two arrays,
because their arrays are samples that may legitimately differ in length for an independent
test; the paired policy's min-length zip would discard the tail of the longer one on every
such call. **Removed by:** per-`type` routing, if the evaluator ever dispatches on an
argument value.

### FX-7 — Blocked spellings answer before their arguments are shaped
**MUST:** an eliminated Excel name (D10) resolves to a `#NAME?` redirect naming the
current function, is dropped from autocomplete and highlighting, and gets no range
routing. The blocklist is DERIVED from `LEGACY_ALIASES`, not hand-pruned.

*Enforced by:* `formulaTier1.test.ts` → "the D10 gate covers the WHOLE blocklist, on
every surface (FX-7)" — every blocked spelling answers `#NAME?` naming its replacement,
none is advertised, none is range-routed; `formulaNodeParity.test.ts` → "never advertises
Formula.js internals as formula functions".

### FX-8 — The formula boundary caps what a node's control already bounds
**MUST:** a generator reachable from a formula enforces `MAX_GENERATED` and answers
`#OVERFLOW!` past it, using the shared constant.

*Why:* a node's Count is a spinner the user watches; a formula field is where a typo asks
for ten million elements with nothing visible to stop it.
*Enforced by:* `formulaTier3.test.ts` → "a generator is capped at the formula boundary".

### FX-9 — Formula.js never sees a matrix (D23 containment)
**MUST:** a rank-2 value reaches a dispatch WHOLE only through a registration
declaring `matrixArgs`. Otherwise: a range aggregate FLATTENS row-major before its
1-D prep; a positional lookup or 1-D whole-list native answers `#SHAPE!`; an
element-wise function broadcasts cell-wise, so the fallthrough only ever receives
scalars. The Formula.js fallthrough stays 1-D permanently.

*Why:* the weaker engine's array functions are written against 2-D ranges with
unvetted quirks, and it has been caught mutating its arguments in place
(CHISQ.TEST). The original cap was partly containment; at rank 2 that logic is
permanent even though the cap itself lifted.
*Enforced by:* `broadcastRules.test.ts` → "the D23 containment rule".

### FX-10 — One broadcast engine, and the table is the test
**MUST:** every element-wise surface (operators, unary, percent, function
broadcasting) routes through `mapCells`. The broadcast semantics live in exactly
one normative table (`v2.0/17-matrix-formulas.md` Part 2), transcribed row-for-row
into `broadcastRules.test.ts` — changing either without the other fails
(`SSOT-6`'s pattern applied to semantics rather than a metric).

*Why:* two broadcasters is how the same expression answers differently by surface —
the exact drift class the parity program exists to close.
*Enforced by:* `broadcastRules.test.ts`.

---

# VAL — Value handling

Full spec: `docs/value-semantics.md` (read "Reading an input" before writing any
`data()`). These are the invariants that spec implies.

### VAL-1 — Unwired is not blank
**MUST:** an absent input (`undefined`) falls back to the node's typed literal. A WIRED
blank (`null`) is a real missing VALUE and propagates — it is never swallowed into the
literal.

*Why:* "absent" is not "unknown". Swallowing a wired blank makes a node answer with a
number the user cannot see on the card.
*Enforced by:* `broadcastContract.test.ts` → "readInput — unwired (undefined) vs
wired-missing (null)", "a WIRED null propagates — NOT swallowed into the literal".

### VAL-2 — One notion of error
**MUST:** failures flow as a tagged `SolError`. `ISERROR` ⟺ `IFERROR`; the `#N/A` test is
centralized as `isNaError`. A bare `NaN` is not an error.

*Enforced by:* `errorValue.test.ts` → "ISERROR (Test) and IFERROR agree: only a tagged
error counts (a bare NaN does not)".

### VAL-3 — Error in, error out, without running the node
**MUST:** every `data()` is wrapped by `installErrorGuards`; an error input propagates to
every output without the node running. A throwing `data()` becomes a local `#ERROR!`.

*Enforced by:* `errorValue.test.ts` → "installErrorGuards".
*Exceptions:* **error CONSUMERS** (`IFERROR`/`IFNA`/`ISERROR`/`ISNA`/`ERROR.TYPE`) must
see the raw error, and **figure SINKS** (`SEES_ERRORS`) render an error input as an empty
figure and never emit a SolError out a `chart` socket. Both are declared, not ad hoc.
**Removed by:** nothing — a catcher that can't see the error can't catch it.

### VAL-4 — Errors carry provenance
**MUST:** a minted error is tagged with its node, an untagged input error is tagged with
the slot it arrived on, and an existing origin is NEVER overwritten downstream.

*Enforced by:* `errorValue.test.ts` → "SolError origin (provenance Tier 1)", "preserves the
ORIGINAL origin through a downstream passthrough (never overwrites)".

### VAL-5 — Null is first-class and skipped, not zero
**MUST:** `null` is a real missing value at every rank. Aggregators SKIP it, Filter drops
it, element-wise math PROPAGATES it. Nothing coerces it to 0.

*Enforced by:* `valueKinds.test.ts` → "forAggregate"; `broadcastContract.test.ts` →
"missing cell propagates as null (null + 10 → null)".
*Exceptions:* Coalesce/Fill is the deliberate OPT-IN to treat a null as something —
that is the node's entire purpose. **Removed by:** nothing.

### VAL-6 — Error beats missing at the same cell
**MUST:** where a cell is both, the error is checked first and propagates unmorphed —
never stringified, never `NaN`, never `[object Object]`.

*Enforced by:* `broadcastContract.test.ts` → "error cell propagates UNMORPHED",
"error beats missing at the same cell (error checked first)"; `valueKinds.test.ts` →
"cellShortCircuit".

### VAL-7 — Logical is a first-class family with Kleene logic
**MUST:** logicals are a real type with three-valued logic (a null operand yields the
Kleene answer, not `false`), and `logical ↔ number` is the one cross-family bridge
(`SOCK-1`).

*Enforced by:* `valueKinds.test.ts` → "Kleene three-valued logic", "logical ↔ number
coercion".

### VAL-8 — Membership keys by VALUE, never identity
**MUST:** any set, dedupe, tally or membership test keys through `setKey`. A JS `Set` over
raw values is a defect wherever a value may be an ARRAY.

*Why:* JS Sets/Maps key OBJECTS by reference, so two equal tagged scalars (a complex —
VAL-15) from different sources never match without a canonical key.
*Enforced by:* `packs/sets.test.ts` covers the PRIMITIVE behaviour ("counts distinct
values in first-seen order", "counts unique values, skipping nulls, propagating errors");
`nodes/list.test.ts` → "complex numbers compare by VALUE, not array identity (Set-node
fix)" puts distinct `[re, im]` instances through Set / IsIn / Tally — reverting a
consumer to a raw `Set` fails it.
*Origin:* a real Set-node bug; `setKey` was introduced to fix it and now lives in
`listOps.ts` for every membership consumer. (An earlier revision of this document
recorded the complex-tuple case as unpinned — the list.test.ts block already covered it;
CONTAINS was the one consumer still comparing by reference, fixed with the review.)

### VAL-9 — The unit is a property of the VALUE
**MUST:** a unit is a base-SI `UnitCell` AUTHORED only by the Format Controller
(`applyFcUnit`) or Convert. It rides through passthroughs and selectors and BREAKS at any
transform. There is no graph unit-walk. The Number node is a plain literal source.

*Enforced by:* `unitCoercion.test.ts` → "Convert primacy on the outgoing value";
`unitWiring.test.ts`, `unitFlowAnnotation.test.ts`.

### VAL-10 — The unit-blind boundary is PER-INPUT
**MUST:** raw `UnitCell`s never reach a node that doesn't run the dimension algebra.
`coerceInputs` centrally unwraps to display magnitude; `unitAware = true` keeps tags on
every input; a `passthrough()` node keeps them only on its spec-named inputs (side inputs
unwrap). **A new algebra node MUST set `unitAware = true`.**

*Why:* without it a tagged cell reaches a node that compares it as a number — the
"5 km > 3" regression.
*Enforced by:* `unitCoercion.test.ts` → "unit-blind consumers get display magnitudes (the
5 km > 3 regression)", "unit-aware nodes and passthroughs keep the tags" cover the
BEHAVIOUR. **Completeness is `UNENFORCED`** — nothing proves a new algebra node declared
it. See Known violations.

### VAL-11 — Units attach at the granularity of homogeneity
**MUST:** per-element `UnitCell` for a list, per-column `ColumnUnit` for a frame, one
homogeneous unit for a matrix (D20).

*Enforced by:* `unitColumn.test.ts`, `unitValue.test.ts`.

### VAL-12 — An op family's selector field is named `op`
**MUST:** a node whose card carries an op dropdown stores it as `op`. Not `dir`, not
`mode`, not `kind`.

*Why:* the declaration mechanism resolves a live node's current op by reading `inst.op`,
so a family that names it otherwise cannot declare its ops AT ALL — its ops become
unsearchable and unmeasurable, silently.
*Enforced by:* `nodeOps.test.ts` → "coverage — every op selector is classified", "no node
with an op dropdown is missing a declaration" — which catches a family that HAS a
declaration. **A family that cannot declare because its field is misnamed is currently
invisible to this check.** See Known violations.
*Origin:* `PadNode.dir` meant `list-pad` had no declaration, so `PADLEFT`/`PADRIGHT` were
unsearchable in the Add menu and unmeasurable in the parity walk. It was not missing work
— it was work that could not attach because one field had a different name. The same
defect was then found five more times by the enforcement review (Sort/Take/Drop `dir`,
DropBlankRows/IFError `mode`) and fixed by the same rename — IFERROR and IFNA are now
searchable. Alert's and ColorBlend's `mode` remain (see Known violations).

### VAL-13 — Components never call `node.data()`
**MUST:** a React component extracts a pure helper instead. `data()` assumes the
engine-driven `coerceInputs` wrapper has run.

*Enforced by:* `UNENFORCED` — a grep-based check would close it.

### VAL-14 — Inline literal maps are declared iff the card edits them
**MUST:** a class declares `literals` / `stringLiterals` exactly when its card edits those
values inline. Load restores the maps ONLY onto declaring classes, so a save or seed
cannot hardcode a value the user can't see.

*Enforced by:* `coerceInputs.test.ts` → "every catalog node with a typeable list input
declares stringLiterals" — the IF direction. **The ONLY-IF direction is `UNENFORCED`:**
nothing catches a class declaring a map its card never edits.

---

### VAL-15 — A special scalar is a TAGGED OBJECT, never a bare array
**MUST:** every non-primitive scalar value — a value that is one *thing* but needs more
than one JS primitive to carry it — is a tagged object (`SolError` `{__solError…}`,
`UnitCell`, complex `{__cx, re, im}`). No scalar is represented as a bare array.
`Array.isArray` therefore means exactly one thing everywhere: *this is a 1-D list*.

*Why:* a bare-array scalar collides with the list representation, and every consumer
that sniffs shape then needs a bespoke disambiguation path. The `[re, im]` tuple forced
four of them: complex.ts's own broadcaster (call-site tagging because `broadcastCells`'
`Array.isArray` test couldn't tell a scalar from a list), `coerceInputs`' complex
special-cases (outer-length tests, "can't disambiguate from a 2-list here"), `setKey`'s
array canonicalization, and `ArrayChip.is2D` — where a complexlist reaching a generic
chip rendered as a 2-column TABLE, silently. It is also the shape-branding blocker the
Tier 4 record names: "a complex `[re,im]` is indistinguishable from a 2-list."
*Enforced by:* `complex.test.ts` (the tagged representation + the family's behaviour
through it); the disambiguation sites above DELETE their special cases, so a regression
to bare arrays fails type-check at the `Cx` type itself.
*Origin:* the complex rebrand (2026-07-28). Complex was the only bare-array scalar in
the value model and the sole reason "a cell may be an array" was ever true.

### VAL-16 — The rank grammar: nothing nests deeper than a matrix
**MUST:** a runtime value is a primitive scalar, a tagged scalar (`VAL-15`), a 1-D
`Array` of cells, or a 2-D `Array` of row-`Array`s. Depth 3+ is not a value —
surfaces that meet one answer `#SHAPE!`. `Array.isArray` at two depths is therefore
the COMPLETE rank test, and no code may carry a private shape-sniffing scheme.

*Why:* this is the invariant that made D23 buildable without a branded-value
wrapper; every new nesting scheme would re-open the ambiguity VAL-15 closed.
(Recursion beyond rank 2 is what CUBES are for — a container, not a value shape.)
*Enforced by:* `broadcastRules.test.ts` → "anything deeper than a matrix is
#SHAPE!"; `complex.test.ts` (the tagged-scalar half).

# Enforcement summary

43 rules.

| Status | Count | Rules |
|---|---|---|
| Enforced | 33 | SSOT-1,2,3,4,6,7,8 · SOCK-1,2,3,4,9 · FX-1,2,3,5,6,7,8,9,10 · VAL-1,2,3,4,5,6,7,8,9,11,15,16 |
| Partially enforced | 6 | SOCK-5, SOCK-7 · FX-4 · VAL-10, VAL-12, VAL-14 |
| Unenforced | 4 | SSOT-5 · SOCK-6, SOCK-8 · VAL-13 |

**The partially-enforced six are the highest-value gap.** In each the rule is tested for
the cases that exist and nothing fails when a NEW case forgets it — precisely the shape of
every bug in the Origin notes. Two of them (SOCK-5, VAL-8) were written here as "enforced"
on the strength of a plausible-sounding test file name, and only turned out to be partial
because the enforcement column forced the check. That is the argument for the column.

---

# Known violations

Recorded here rather than fixed, per the author's instruction that this pass is documents
only. Each is actionable in the follow-up.

1. **`AlertNode` and `ColorBlendNode` name their op selector `mode`** — the last two
   VAL-12 field-name violations (Sort/Take/Drop's `dir` and DropBlankRows/IFError's
   `mode` were renamed with the enforcement review). Both are argument-shaped, so the
   cost is only that the coverage check cannot see them. *Fix: same rename.* (`DateIf`'s
   `unit` selector is the borderline sibling — an op dropdown by mechanism, Excel's
   argument by semantics.)

2. **VAL-12's check cannot see its own violations** — `nodeOps.test.ts` verifies that a
   node WITH a declaration is consistent, but a family that can't declare (misnamed field)
   is invisible to it. *Fix: assert every node class exposing an op dropdown has a
   string-valued `op` field, driven off the catalog rather than the declarations.*

3. **VAL-10 completeness unenforced** — no test references `unitAware`. A new algebra node
   that forgets it silently gets display magnitudes. *Fix: enumerate nodes performing
   dimensional arithmetic and assert the flag, or assert the converse (a node that reads a
   `UnitCell` declares it).*

4. **SOCK-7 completeness unenforced** — the known in-place retypers are behaviour-tested;
   a new one that skips `reconcileFcTypes` leaves stale downstream formats. *Fix: assert
   every class that assigns to a socket's `dataType` also calls the reconciler.*

5. **FX-4 injectivity is partial** — the check covers catalog leaf labels and the three
   declared `fx` tables. It does NOT check that two ops in DIFFERENT families despace to
   distinct names. *Fix: extend the sweep to every `OP_META` label across all families.*

6. **VAL-14 only-if direction unenforced** — nothing catches a class declaring a literal
   map its card never edits, which would let a save inject an invisible value.

7. **Array-RETURNING range functions are unrouted** — `TREND`, `GROWTH`, `LINEST`,
   `LOGEST`, `FREQUENCY`, `MODE.MULT`, `UNIQUE`, `SORT`, `FILTER`, `TRANSPOSE` are still
   broadcast (FX-5). Formula.js writes them against a 2-D range and doesn't treat a 1-D
   list as a vector, so each needs list-model handling. Pinned as a known state by
   `rangeRouting.test.ts`.

8. **`rules.test.ts` checks the mechanical half only** — IDs unique, every cited test
   file exists, summary counts add up. Whether a cited test actually ENFORCES its rule is
   still a reading job (this document's fact-check found four misciting rules that a
   file-exists check alone would have passed).

9. **SOCK-5's "never persists" is unpinned** — adoption behaviour is tested, but nothing
    asserts an adopted type is absent from the serialized graph. *Fix: adopt, serialize,
    assert the socket's declared type is the wildcard.*
