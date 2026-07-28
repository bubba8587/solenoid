# Solenoid — Architecture Rules

**Normative.** Every entry here is a MUST that a change has to satisfy, paired with the
test that enforces it. This is the layer the other docs don't have: `decisions.md` says
*why* a call was made, `subsystem-invariants.md` says *how* a mechanism works, and this
says *what must remain true*. If you want the reasoning, follow the link; if you want to
know whether your change is legal, read here.

## Scope

Domains chosen because they are the ones that **cannot be caught by looking at the
app**: a broken socket rule, a wrong formula name, a mishandled null, a save that
silently drops a field, or an effect that fires on load produces a plausible-looking
answer (or an invisible non-event), not a visible defect.

| Domain | Prefix | Covers |
|---|---|---|
| Derivation | `SSOT` | where a fact is declared and how other surfaces get it |
| Sockets | `SOCK` | the type lattice, connection legality, coercion at the boundary |
| Formula surface | `FX` | registration, naming, argument routing |
| Value handling | `VAL` | null, SolError, logical, units |
| Persistence | `PERSIST` | the save path — capture, round-trip, slots, identity |
| Engine | `ENGINE` | recompute passes — targeted ≡ full, gating, refresh scope |
| External effects | `EFFECT` | when a node may touch the world (disk, alerts) |

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
- **Provenance** (`PROV`): who a rule binds depends on who made it — see the PROV
  section. Exactly one rule in this document is author-ruled; everything else is the
  working agent's inference or default, and is open to question on those terms.

## Process

Spec-first for **new mechanisms and cross-cutting changes**: a new subsystem, naming law,
declaration format, or a sweep touching many files updates this document *before* the
code. Ordinary work — a node, a bug fix, a one-line change — just follows the existing
rules. Every bug fix ships the check that would have caught it, or says why it can't
(`SSOT-5`). This is the working default, not an author ruling; tighten it freely.

---

# PROV — Provenance

Who a rule actually binds depends on who made it. This section is the constitution
for that question, and it contains the ONLY author-ruled rule in this document.

Every rule carries (implicitly today, explicitly as the audit reaches it) one of
three provenance grades:

| Grade | Meaning | May be changed by |
|---|---|---|
| **ARR** — author-ruled | The author read this document in a session and marked the rule THEMSELVES | the author, the same way |
| **INFERRED** | Written by the working agent from an incident, or from something the author once said. A past author statement is EVIDENCE for the reasoning — it does not confer ARR | the agent, with the reasoning updated |
| **DEFAULT** | The agent's judgment call with no forcing incident — a standing invitation to question | the agent, freely |

### PROV-1 — ARR is conferred only by the author, in-session, on this document **[ARR]**
**MUST:** a rule is author-ruled if and only if the author, in a specific session,
has read this rules document and marked the rule themselves. Nothing else confers
ARR — not a past author statement, not a recorded decision, not a quote in
`decisions.md`, not the agent's confidence in what the author meant. As of this
rule's creation (2026-07-28), **every other rule in this document is NOT
author-ruled**, whatever its history; the agent may mark THIS rule ARR and no
others.

*Why (author, 2026-07-28, verbatim intent):* "99% of what is in this codebase is
your assumptions and references you built for yourself unless you recorded that I
told you something specific… even if I said something in the past — it's not an
author-ruled rule as of right now."
*Enforced by:* `rules.test.ts` → the ARR-uniqueness guard: exactly ONE `[ARR]`
mark may exist in this document, and it must sit on PROV-1. The agent cannot
promote a rule to ARR without that test failing — promotion happens by the author
editing (or dictating the edit of) this file, and the guard's expected count
moving with it is part of that same author-marked change.

**Consequences for the rest of this document:** every "author-gated",
"author ruling", and quoted decision below is now read as INFERRED — real history,
real evidence, no ARR authority. Every rule heading carries its grade (the
2026-07-28 audit): INFERRED where a concrete incident occurred and is named,
DEFAULT where the rule is preventive judgment with no forcing incident. The
DEFAULT set (SOCK-3, SOCK-6, SOCK-11, FX-10, VAL-13, VAL-14, VAL-17,
PERSIST-3,4,5,6, EFFECT-1) is the thinnest ice: rules held up by the agent's
reasoning without a forcing incident, and the first candidates for either an
enforcing incident or deletion. (The 2026-07-28 promotion sweep grew it — a promoted convention whose
failure has not yet HAPPENED grades DEFAULT no matter how load-bearing the
reasoning; the grade tracks provenance, not value.)

---

# SSOT — Derivation and single source of truth

The theme of every architecture bug found to date. A fact that is written down twice
drifts; a property that is hand-maintained gets missed.

### SSOT-1 — One declaration per fact **[INFERRED]**
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

### SSOT-2 — Where a derivation can't be total, the override lives in the same table **[INFERRED]**
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

### SSOT-3 — No hand-kept list of a derivable property **[INFERRED]**
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

### SSOT-4 — An irreducibly hand-kept set is guarded by SHAPE **[INFERRED]**
**MUST:** where `SSOT-3` grants an exception, a test asserts the *observable consequence*
of membership, not merely the membership. Assert what the function does, not that its
name appears in a set.

*Why:* checking membership against a hand-written list of the same names proves nothing.
Checking that `T.TEST` returns one number rather than four is a real check.
*Enforced by:* `rangeRouting.test.ts` → "whole-sample functions are range-routed, not
broadcast".

### SSOT-5 — A rule not enforced by a test is debt, and is labelled **[INFERRED]**
**MUST:** each rule here carries `Enforced by:` or `UNENFORCED`. A bug fix ships the check
that would have caught it, or states why it can't be checked.

*Why:* the difference between a spec and a folk memory is whether anything fails when you
break it. `CLAUDE.md` already carries an honest example of the alternative — the
OS-dropdown rule, "widely cited, but no originating incident is on record", 21 call sites
held on precaution.
*Enforced by:* `UNENFORCED` — this rule is about the document, and is checked by review.
A `rules.test.ts` asserting every ID resolves to a real test file would close it.

### SSOT-6 — A gating metric has exactly one implementation **[INFERRED]**
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

### SSOT-7 — A metric measures one thing **[INFERRED]**
**MUST:** a coverage metric that answers two questions is split into two fields. Do not
derive "is this Excel name callable" from "is this node reachable somehow".

*Why:* folding them lets one improvement mask an unrelated regression.
*Enforced by:* `formulaNodeParity.ts` — `inFormula` (reachable by any name) vs
`excelCovered` (every Excel name dispatches), with the reason in the type comment.

### SSOT-8 — Completeness quantifiers are `every`, not `some` **[INFERRED]**
**MUST:** a claim of the form "this node supports X" over a SET of names is checked with
`every`. `some` is permitted only where partial support is the deliberate, documented
contract.

*Why:* `some` reports a node covered when most of its names still fail.
*Enforced by:* `formulaNodeParity.ts` `excelCovered`.
*Origin:* the `some` form hid ten names — the seven B-suffixed text functions,
`ERF.PRECISE`, `ERFC.PRECISE`, `VALUETOTEXT` — each declared against a real node while
the formula surface answered `#NAME?`.

### SSOT-9 — Input-cable pruning is ONE loop (`dropInputCables`) **[INFERRED]**
**MUST:** every "these input sockets are going away" moment — a mode/op switch hiding
inputs, a variadic row being deleted, a formula variable disappearing — drops the
affected cables through `components/cablePrune.ts` `dropInputCables`, BEFORE the socket
is hidden or removed. A component calls `editor.removeConnection` directly only for a
genuinely different shape (cross-graph port sync, both-direction prunes, type-compat
filters, single user-selected cable), each sanctioned with its reason in the sweep.

*Why:* eleven hand-rolled copies of the loop had drifted on the details that matter —
some snapshotted the connection list before removing, some iterated it LIVE while
awaiting removals; some remembered the active-graph seam (a drill-in edits its own
graph), the next copy wouldn't have. The helper also carries the ordering rule the
copies each half-remembered: prune before the socket goes (removeInput while a cable
references the socket is unsafe — the Interpolate variant-switch lesson), and a hidden
socket with a live cable is an invisible wire.
*Enforced by:* `sourceInvariants.test.ts` → "no component hand-rolls an input-cable
pruning loop" (+ the sanctioned-list honesty check).
*Origin:* the 2026-07-28 spec-promotion queue — recorded there as six copies; the
unification sweep found eleven.

---

# SOCK — The socket lattice

The lattice is a family × rank product, and its legality rules are DERIVED from that
product rather than enumerated per pair. Full mechanics: `docs/socket-reference.md`,
`CLAUDE.md` "Socket lattice".

### SOCK-1 — Type separation: element families never auto-cross **[INFERRED]**
**MUST:** a value of one element family never connects to an input of another. Crossing
requires an explicit Cast node.

*Enforced by:* `socketConnect.test.ts` → "CROSS-family is blocked everywhere EXCEPT
logical↔number (dim-mirrored)".
*Exceptions:* `logical ↔ number` is the ONE bridge (boolean ↔ 0/1), mirrored at every
rank. **Removed by:** nothing — it is the deliberate consequence of Excel treating
TRUE/FALSE as 1/0. Any *second* exception is a lattice design change, not a patch.

### SOCK-2 — Dimensional flow: values widen up, never narrow down **[INFERRED]**
**MUST:** scalar → list → matrix → frame is permitted within a family; the reverse is
refused. A list widens into a 2-D input as a ROW.

*Enforced by:* `socketConnect.test.ts` → "WITHIN a family: a value widens UP (+
combo→scalar), and never narrows", "every rank≤2 value (ANY family) widens INTO the 2-D
containers".
*Exceptions:* a COMBO (scalar-or-list) narrows into its element scalar; a plain list does
not. This is what makes a combo a combo. **Removed by:** nothing.

### SOCK-3 — Adding a socket type is a derived edit **[DEFAULT]**
**MUST:** a new socket type is added by extending the family/rank product. Cross-type
dimensional edges are explicit in `accepts()` and swept exhaustively by test. A new type
must not require hand-writing its pairs.

*Why:* the lattice has 30 variants; enumerating pairs by hand is quadratic and wrong.
*Enforced by:* `socketConnect.test.ts` → "lattice invariants — TYPE separation +
DIMENSIONAL flow (full sweep)"; `socketFamilyCompleteness.test.ts`.

### SOCK-4 — The wildcard ladder keeps rank **[INFERRED]**
**MUST:** `any` is an untyped SCALAR, `anylist` / `anytable` are 1-D / 2-D, and `trueany`
is the adopt-anything supremum. A rank-bearing wildcard keeps its rank and adopts only
the element family.

*Enforced by:* `socketConnect.test.ts` → "`any` INPUT: family scalars + combos in;
lists/matrices/containers refused", "anylist INPUT/OUTPUT", "anytable OUTPUT stays 2-D",
"`trueany` bridges everything, both directions".

### SOCK-5 — Adoption never drops cables and never persists **[INFERRED]**
**MUST:** `trueany` adoption (`trueAnyAdopt.ts`) resolves a type without disconnecting
anything, and the adopted type is not written to the save file.

*Enforced by:* `trueAnyAdopt.test.ts` — adoption and REVERT-on-disconnect ("a Display
adopts on both sides and REVERTS on disconnect", "adoption propagates down a
passthrough CHAIN", "two Displays do NOT share adoption"), and the "never persists"
half: "adoption never PERSISTS: a save/paste init carries no adopted type" (adopt →
extractInit → assert no adopted type in the init, reconstructed node starts hollow).

### SOCK-6 — "Resolve past untyped passthroughs" goes through one predicate **[DEFAULT]**
**MUST:** every place that needs to see through an untyped hop calls `isWildcardType()`.
No local re-implementation of "is this socket untyped".

*Why:* three subtly different notions of "untyped" is three subtly different bugs.
*Enforced by:* `UNENFORCED`. A grep check was attempted (2026-07-28 enforcement pass)
and found every wildcard-literal comparison outside sockets.ts is a RENDERING
classifier (glyph shape, combo drawing, wire-only rows), not a semantic "is this
untyped" — a mechanical scan can't separate the two, so this stays a reading rule.

### SOCK-7 — In-place retype must reconcile downstream **[INFERRED]**
**MUST:** a node that mutates a socket's `dataType` in place (Cast target, LAMBDA result,
Get Column read-as, Note frontmatter) fires no connection event, so it MUST call
`reconcileFcTypes` / `retypeOutputCables`.

*Why:* without it, downstream Format Controllers keep stale formats.
*Enforced by:* `fcReconcile.test.ts`, `noteFcPropagation.test.ts` cover the BEHAVIOUR of
the known retypers; `sourceInvariants.test.ts` covers COMPLETENESS — a source scan
requires every file that retypes a socket in place (`.socket =` / `.setType(` /
`.dataType =`) to reference a reconciler, with a reasoned sanctioned list for the
central adoption machinery itself.

### SOCK-8 — The socket box is a deterministic 12×12 **[INFERRED]**
**MUST:** the socket span renders `display:block; line-height:0` at a locked 12×12, and
vertical placement is MEASURED per row — never a fixed constant, never a `transform`.

*Why:* `rete-render-utils` measures the span's offset box for cable endpoints, and
`offsetTop` ignores transforms, so rete would misreport the endpoint.
*Enforced by:* `UNENFORCED` (a CSS + layout invariant; `CLAUDE.md` carries the detail).

### SOCK-9 — `anydata`: the rank-≤2 element-agnostic wildcard (D23) **[INFERRED]**
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

### SOCK-10 — An adopting port owns its socket instance **[INFERRED]**
**MUST:** every `MutableSocket`/`AdoptiveSocket` port gets a FRESH instance — never a
module-level shared one (the deliberately never-mutated `staticTrueAny*` singleton is
the sanctioned exception, and it is immutable by contract). A shared mutable socket
means wiring a date into one card retypes ANOTHER card's port, which then coerces its
input under the wrong type and answers a plausible number the user cannot connect to a
cause.

*Enforced by:* `catalogRegistry.test.ts` → "no two instances of a class share a mutable
socket" — two instances of every catalog class, no `MutableSocket` in both.
*Origin:* the Input Switch's old shared `valueSocket` — the incident the AdoptiveSocket
class doc ("One instance per port, never shared") was written against.

### SOCK-11 — A `trueany` output implies a `passthrough()` declaration **[DEFAULT]**
**MUST:** a class with a `trueany` OUTPUT either declares `passthrough()` — the ONE
declaration the four derived-type consumers read (trueany adoption, unit flow, the
display-type walk, coerceInputs' keep-tags boundary) — or is sanctioned with the reason
its type resolves another way (the FC is the resolver; Conduit lanes resolve through
conduitTrace; composite boundary ports sync in their own pass; XLOOKUP/NA are genuinely
unknowable). An undeclared forwarder's output stays `trueany` forever: downstream FCs
can't key a family, so a date serial silently renders as its raw number.

*Enforced by:* `catalogRegistry.test.ts` → "every class with a trueany output declares
passthrough()" — a catalog walk with the reasoned sanction list and its honesty check.

### SOCK-12 — Relay nodes are transparent to every static derivation **[INFERRED]**
**MUST:** a value relay (a Conduit lane, a passthrough chain, an IF with one wired
branch) is TRANSPARENT to static resolution: a cable leaving it resolves type, unit
annotation and frame SHAPE from the ORIGINATING source's socket — through chains,
reverting on disconnect — never from the relay's own untyped lane. And a Conduit run is
identified from its ORIGIN: every segment of one run resolves to the same run, so
provenance readings (the Cable inspector's "From") and run-wide actions cannot split by
which segment was clicked.

*Enforced by:* `conduitTrace.test.ts` (lane tracing through chains, loop termination,
lane adopt/revert, `conduitPath` run identity); `frameShapePassthrough.test.ts` (frame
shape through a Display / a Conduit lane / a half-wired IF — "Bug B").
*Origin:* Bug B — downstream column pickers went empty and formula column references
silently failed to resolve through a passthrough, with no error anywhere.

---

# FX — The formula surface

Two surfaces exist for the same functions — the node catalog and the formula language —
and nothing structurally connects them. These rules are what keeps them from drifting.
Program record: `docs/formula-node-parity.md`.

### FX-1 — One implementation, two surfaces **[INFERRED]**
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

### FX-2 — A shared implementation is rete-free **[INFERRED]**
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

### FX-3 — A registration declares its full contract **[INFERRED]**
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

### FX-4 — A derived name function is TOTAL and INJECTIVE **[INFERRED]**
**MUST:** any rule that derives a name (D19 2(a): the node label despaced) must be defined
for every input AND must never map two different things to one name. Both properties are
machine-checked.

*Why:* a naming law without an injectivity check will silently collide, and the collision
is discovered by whoever registers second.
*Enforced by:* `formulaTier3.test.ts` → "the formula namespace stays unambiguous",
including the FULL naming sweep ("FX-4 full sweep"): every OPERATION-kind op name in
`NODE_OPS` (`fx` ?? despaced label) checked pairwise across families and against the
catalog leaves, with a leaf-identity escape (a leaf that constructs the family at that
op IS the op) and one reasoned exemption (chart/sparkline share a figure-STYLE
vocabulary and never register formula names). Argument-kind ops take no names, and
kind-only families surface their ops AS leaves, which the leaf-uniqueness test sweeps —
the two tests together cover both surfaces a name can appear on. Plus
the REGISTRY half: `registerInternal` THROWS on a duplicate live name
(`excelFunctions.test.ts` → "the duplicate-registration guard"), so two impls claiming
one name fail at module load instead of the winner being decided by import order.
Withdrawn (pack-revocable) names may return.
*Origin:* Fill's `Interpolate` op and the `INTERPOLATE` node in `stats.ts` both despace to
`INTERPOLATE`. Fill's op now declares `fx: "FILLINTERPOLATE"` per `SSOT-2`. The full
sweep's first run (2026-07-28) then caught two live wounds the partial sweep missed:
Text Filter's `Contains` op claimed the list-membership `CONTAINS` (fixed by
reclassifying the family operation → argument — the ops are a filter CONDITION), and
the math-fn `round` op's leaf claimed `ROUND`, a name that dispatches the 2-arg Excel
ROUND which REFUSES the leaf's own 1-arg semantics (fixed by deleting the duplicate op —
RoundN at digits 0 is the same capability).

### FX-5 — Array arguments arrive whole **[INFERRED]**
**MUST:** a function taking a whole 1-D list is routed past the element-wise broadcaster.
A function whose arguments are all scalars but whose RESULT is a list is also marked
never-broadcast.

*Why:* without it the evaluator maps the call element-wise and returns N answers to a
question that has one; with a list-returning function it builds a 2-D value behind the D2
cap's back.
*Enforced by:* `formulaTier3.test.ts` → "the whole-list routing"; `rangeRouting.test.ts`.

### FX-6 — Argument prep matches the function's shape, not its category **[INFERRED]**
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

### FX-7 — Blocked spellings answer before their arguments are shaped **[INFERRED]**
**MUST:** an eliminated Excel name (D10) resolves to a `#NAME?` redirect naming the
current function, is dropped from autocomplete and highlighting, and gets no range
routing. The blocklist is DERIVED from `LEGACY_ALIASES`, not hand-pruned.

*Enforced by:* `formulaTier1.test.ts` → "the D10 gate covers the WHOLE blocklist, on
every surface (FX-7)" — every blocked spelling answers `#NAME?` naming its replacement,
none is advertised, none is range-routed; `formulaNodeParity.test.ts` → "never advertises
Formula.js internals as formula functions".

### FX-8 — The formula boundary caps what a node's control already bounds **[INFERRED]**
**MUST:** a generator reachable from a formula enforces `MAX_GENERATED` and answers
`#OVERFLOW!` past it, using the shared constant.

*Why:* a node's Count is a spinner the user watches; a formula field is where a typo asks
for ten million elements with nothing visible to stop it.
*Enforced by:* `formulaTier3.test.ts` → "a generator is capped at the formula boundary".

### FX-9 — Formula.js never sees a matrix, or a tagged Cx (D23 containment) **[INFERRED]**
**MUST:** a rank-2 value reaches a dispatch WHOLE only through a registration
declaring `matrixArgs`. Otherwise: a range aggregate FLATTENS row-major before its
1-D prep; a positional lookup or 1-D whole-list native answers `#SHAPE!`; an
element-wise function broadcasts cell-wise, so the fallthrough only ever receives
scalars. The Formula.js fallthrough stays 1-D permanently.
**MUST (the same principle, per element):** a tagged `Cx` reaches a dispatch only
through a registration declaring `cxArgs` (the IM* family, owned over Cx);
everywhere else a complex operand answers a typed `#TYPE!` naming that family.
Exempt: the `NULL_INSPECTING` value-passers (IF hands a complex branch through;
type predicates must SEE it) and whole-list natives (position-preserving shape
ops on opaque elements — `REVERSE` of a complex list is legitimate; their numeric
members coerce a Cx like any other non-number, the family-wide list policy).

*Why:* the weaker engine's array functions are written against 2-D ranges with
unvetted quirks, and it has been caught mutating its arguments in place
(CHISQ.TEST). The original cap was partly containment; at rank 2 that logic is
permanent even though the cap itself lifted. The Cx half has the same shape:
before the gate, `cx + 1` concatenated to `"[object Object]1"` and Formula.js's
IM* worked on TEXT complexes while refusing the graph's own tagged values (the
D23-amendment finding, 2026-07-28).
*Enforced by:* `broadcastRules.test.ts` → "the D23 containment rule";
`formulaComplex.test.ts` → "containment — a Cx reaches a dispatch only through
cxArgs" (plus the operator table there).

### FX-10 — One broadcast engine, and the table is the test **[DEFAULT]**
**MUST:** every element-wise surface (operators, unary, percent, function
broadcasting) routes through `mapCells`. The broadcast semantics live in exactly
one normative table (`v2.0/17-matrix-formulas.md` Part 2), transcribed row-for-row
into `broadcastRules.test.ts` — changing either without the other fails
(`SSOT-6`'s pattern applied to semantics rather than a metric).

*Why:* two broadcasters is how the same expression answers differently by surface —
the exact drift class the parity program exists to close.
*Enforced by:* `broadcastRules.test.ts`.

### FX-11 — A vendored-engine divergence is owned, and tripwired **[INFERRED]**
**MUST:** where Formula.js diverges from Excel, the registered override is the
Excel-correct answer, backed by the same impl as the node (`FX-1`) — and the divergence
is pinned BIDIRECTIONALLY: the correctness assertion plus a tripwire asserting FX still
answers wrong, so a vendored-engine update that silently changes behaviour fails the
suite and forces a re-evaluation instead of a silent regression (in either direction).

*Enforced by:* `formulaDivergence.test.ts` — MOD's divisor-sign, ATAN2's argument
order, RANK, VALUE's strictness (`VALUE("abc")` is `#VALUE!`, not FX's silent 0), each
with its "FX still diverges (tripwire)" twin.
*Origin:* author-flagged 2026-06-25; recovered from the audit notes after the original
sweep script was lost — which is why the pins live in the suite now.

---

# VAL — Value handling

Full spec: `docs/value-semantics.md` (read "Reading an input" before writing any
`data()`). These are the invariants that spec implies.

### VAL-1 — Unwired is not blank **[INFERRED]**
**MUST:** an absent input (`undefined`) falls back to the node's typed literal. A WIRED
blank (`null`) is a real missing VALUE and propagates — it is never swallowed into the
literal.

*Why:* "absent" is not "unknown". Swallowing a wired blank makes a node answer with a
number the user cannot see on the card.
*Enforced by:* `broadcastContract.test.ts` → "readInput — unwired (undefined) vs
wired-missing (null)", "a WIRED null propagates — NOT swallowed into the literal".

### VAL-2 — One notion of error **[INFERRED]**
**MUST:** failures flow as a tagged `SolError`. `ISERROR` ⟺ `IFERROR`; the `#N/A` test is
centralized as `isNaError`. A bare `NaN` is not an error.

*Enforced by:* `errorValue.test.ts` → "ISERROR (Test) and IFERROR agree: only a tagged
error counts (a bare NaN does not)".

### VAL-3 — Error in, error out, without running the node **[INFERRED]**
**MUST:** every `data()` is wrapped by `installErrorGuards`; an error input propagates to
every output without the node running. A throwing `data()` becomes a local `#ERROR!`.

**MUST (ordering):** the guard wraps OUTSIDE input coercion — coercion installs first
(innermost), the guard second — so a `ShapeError` thrown while narrowing lands in the
guard as `#SHAPE!` instead of escaping both wrappers into the engine.

*Enforced by:* `errorValue.test.ts` → "installErrorGuards"; `errorIntegration.test.ts`
(the coercion-`#SHAPE!` engine path). Ordering completeness is by review: Canvas installs
the two pipes in order; the composite paths called `installErrorGuards` BEFORE `addNode`
(guard inside — inverted) from their creation until 2026-07-28, found by the
spec-promotion sweep and fixed (guards now install after `addNode` at all four sites).
*Exceptions:* **error CONSUMERS** (`IFERROR`/`IFNA`/`ISERROR`/`ISNA`/`ERROR.TYPE`) must
see the raw error, and **figure SINKS** (`SEES_ERRORS`) render an error input as an empty
figure and never emit a SolError out a `chart` socket. Both are declared, not ad hoc.
**Removed by:** nothing — a catcher that can't see the error can't catch it.

### VAL-4 — Errors carry provenance **[INFERRED]**
**MUST:** a minted error is tagged with its node, an untagged input error is tagged with
the slot it arrived on, and an existing origin is NEVER overwritten downstream.

*Enforced by:* `errorValue.test.ts` → "SolError origin (provenance Tier 1)", "preserves the
ORIGINAL origin through a downstream passthrough (never overwrites)".

### VAL-5 — Null is first-class and skipped, not zero **[INFERRED]**
**MUST:** `null` is a real missing value at every rank. Aggregators SKIP it, Filter drops
it, element-wise math PROPAGATES it. Nothing coerces it to 0.

*Enforced by:* `valueKinds.test.ts` → "forAggregate"; `broadcastContract.test.ts` →
"missing cell propagates as null (null + 10 → null)".
*Exceptions:* Coalesce/Fill is the deliberate OPT-IN to treat a null as something —
that is the node's entire purpose. **Removed by:** nothing.

### VAL-6 — Error beats missing at the same cell **[INFERRED]**
**MUST:** where a cell is both, the error is checked first and propagates unmorphed —
never stringified, never `NaN`, never `[object Object]`.

*Enforced by:* `broadcastContract.test.ts` → "error cell propagates UNMORPHED",
"error beats missing at the same cell (error checked first)"; `valueKinds.test.ts` →
"cellShortCircuit".

### VAL-7 — Logical is a first-class family with Kleene logic **[INFERRED]**
**MUST:** logicals are a real type with three-valued logic (a null operand yields the
Kleene answer, not `false`), and `logical ↔ number` is the one cross-family bridge
(`SOCK-1`).

*Enforced by:* `valueKinds.test.ts` → "Kleene three-valued logic", "logical ↔ number
coercion".

### VAL-8 — Membership keys by VALUE, never identity **[INFERRED]**
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

### VAL-9 — The unit is a property of the VALUE **[INFERRED]**
**MUST:** a unit is a base-SI `UnitCell` AUTHORED only by the Format Controller
(`applyFcUnit`) or Convert. It rides through passthroughs and selectors and BREAKS at any
transform. There is no graph unit-walk. The Number node is a plain literal source.

*Enforced by:* `unitCoercion.test.ts` → "Convert primacy on the outgoing value";
`unitWiring.test.ts`, `unitFlowAnnotation.test.ts`.

### VAL-10 — The unit-blind boundary is PER-INPUT **[INFERRED]**
**MUST:** raw `UnitCell`s never reach a node that doesn't run the dimension algebra.
`coerceInputs` centrally unwraps to display magnitude; `unitAware = true` keeps tags on
every input; a `passthrough()` node keeps them only on its spec-named inputs (side inputs
unwrap). **A new algebra node MUST set `unitAware = true`.**

*Why:* without it a tagged cell reaches a node that compares it as a number — the
"5 km > 3" regression.
*Enforced by:* `unitCoercion.test.ts` → "unit-blind consumers get display magnitudes (the
5 km > 3 regression)", "unit-aware nodes and passthroughs keep the tags" cover the
BEHAVIOUR. Completeness: `sourceInvariants.test.ts` → "every algebra-calling node file
declares unitAware = true" — a source scan over `nodes/` + `packs/` for the per-cell
algebra identifiers (isUnitCell / dimOf / magnitudeOf / the *Units combinators /
broadcastUnit), with a sanctioned-list honesty check. The matrix-unit family
(matrixUnitOf / carryMatrixUnit / …) is deliberately outside the consuming set: a D20
matrix unit tags the outer array of a bare-number grid and survives the unit-blind
strip, so a unit-blind reshape carrying it is correct.

### VAL-11 — Units attach at the granularity of homogeneity **[INFERRED]**
**MUST:** per-element `UnitCell` for a list, per-column `ColumnUnit` for a frame, one
homogeneous unit for a matrix (D20).

*Enforced by:* `unitColumn.test.ts`, `unitValue.test.ts`.

### VAL-12 — An op family's selector field is named `op` **[INFERRED]**
**MUST:** a node whose card carries an op dropdown stores it as `op`. Not `dir`, not
`mode`, not `kind`.

*Why:* the declaration mechanism resolves a live node's current op by reading `inst.op`,
so a family that names it otherwise cannot declare its ops AT ALL — its ops become
unsearchable and unmeasurable, silently.
*Enforced by:* `nodeOps.test.ts` → "coverage — every op selector is classified", "no node
with an op dropdown is missing a declaration" — which catches a family that HAS a
declaration. The blindness half (a family that CANNOT declare because its field is
misnamed) is closed by `sourceInvariants.test.ts` → "every non-arg OpSelect binds `op`":
a source scan over the component `<OpSelect>` sites, where the misnamed field is still
visible. The contract: an OpSelect either binds `op` (directly, a per-row `.op` config
field, or via `useNodeField(…, "op")`) or carries the `arg` prop — the machine-readable
"not the family op selector" declaration (criterion comparators, payment timing,
config/data picks). The recorded borderline (DATEDIF's `unit` selector — an op dropdown
by mechanism, Excel's argument by semantics) was DISSOLVED rather than settled: the two
date-difference families merged (2026-07-28) and the units became first-class `op`s of
the one DateDiff family.
*Origin:* `PadNode.dir` meant `list-pad` had no declaration, so `PADLEFT`/`PADRIGHT` were
unsearchable in the Add menu and unmeasurable in the parity walk. It was not missing work
— it was work that could not attach because one field had a different name. The same
defect was then found five more times by the enforcement review (Sort/Take/Drop `dir`,
DropBlankRows/IFError `mode`) and fixed by the same rename — IFERROR and IFNA are now
searchable. Alert's and ColorBlend's `mode` were the last two, renamed 2026-07-28 with
argument-kind declarations added (the coverage check demanded them the moment the
field became visible — the machinery working as designed).

### VAL-13 — Components never call `node.data()` **[DEFAULT]**
**MUST:** a React component extracts a pure helper instead. `data()` assumes the
engine-driven `coerceInputs` wrapper has run.

*Enforced by:* `sourceInvariants.test.ts` → "no component source calls .data(" — a
source scan over `components/`.

### VAL-14 — Inline literal maps are declared iff the card edits them **[DEFAULT]**
**MUST:** a class declares `literals` / `stringLiterals` exactly when its card edits those
values inline. Load restores the maps ONLY onto declaring classes, so a save or seed
cannot hardcode a value the user can't see.

*Enforced by:* `coerceInputs.test.ts` → "every catalog node with a typeable list input
declares stringLiterals" — the IF direction. The ONLY-IF direction:
`catalogRegistry.test.ts` → "no class declares a literal map its component never edits" —
every declaring class's registered component source must contain an editing surface
(InlineInputs / ExtensibleInputs / a direct `literals` / `stringLiterals` reference), so
a save cannot restore a value onto a card that can never show it.

---

### VAL-15 — A special scalar is a TAGGED OBJECT, never a bare array **[INFERRED]**
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

### VAL-16 — The rank grammar: nothing nests deeper than a matrix **[INFERRED]**
**MUST:** a runtime value is a primitive scalar, a tagged scalar (`VAL-15`), a 1-D
`Array` of cells, or a 2-D `Array` of row-`Array`s. Depth 3+ is not a value —
surfaces that meet one answer `#SHAPE!`. `Array.isArray` at two depths is therefore
the COMPLETE rank test, and no code may carry a private shape-sniffing scheme.

*Why:* this is the invariant that made D23 buildable without a branded-value
wrapper; every new nesting scheme would re-open the ambiguity VAL-15 closed.
(Recursion beyond rank 2 is what CUBES are for — a container, not a value shape.)
*Enforced by:* `broadcastRules.test.ts` → "anything deeper than a matrix is
#SHAPE!"; `complex.test.ts` (the tagged-scalar half).

### VAL-17 — A volatile `data()` freezes its roll on the recalc generation **[DEFAULT]**
**MUST:** a node whose `data()` draws randomness caches the draw and re-rolls only when
`getRecalcGen()` changes. Bare `Math.random()` in `data()` re-rolls on EVERY recompute
pass, so any unrelated edit silently changes the value, F9 stops being the thing that
controls re-rolling, and a Monte Carlo built on it is non-reproducible.

*Enforced by:* `sourceInvariants.test.ts` → "every nodes/packs file calling Math.random
references getRecalcGen" — a source scan with a sanctioned list (composite.ts generates
ids, not values). The volatility CLOCK split between the two surfaces is `FX-1`'s
SHUFFLE exception.

### VAL-18 — Positional access filters errors per cell; aggregation propagates whole **[INFERRED]**
**MUST:** a positional lookup (INDEX, XMATCH, MAKEARRAY reads) propagates ONLY the error
of the cell it actually references — an unreferenced error cell elsewhere in the range
must not blanket-error the call. An AGGREGATE over a range containing an error still
propagates it whole (Excel-correct). Both directions are silently wrong when flipped:
blanket-erroring hides a good answer, under-propagating hides a bad one.

*Enforced by:* `errorFiltering.test.ts` (the INDEX/XMATCH/MAKEARRAY cases + the
aggregate-still-propagates case). This is the per-cell refinement of `VAL-3`'s
whole-node rule.

### VAL-19 — Two different currency codes are incommensurable in EVERY combinator **[INFERRED]**
**MUST:** FX is out of scope, so every currency shares one `currency` axis at scale 1 —
$5 and 5€ store the same base magnitude, and the display CODE is the real unit identity.
Every unit combinator (`arithmeticCell` — all seven ops — `compareUnits`,
`forAggregateUnits`) refuses two operands carrying different explicit codes with a
`#UNIT!` ("no exchange rate"). ×/÷ refuse too: division would mint a RATIO, and a
unitless $/€ number IS a fabricated exchange rate. An UNCODED currency cell (a computed
result) adopts leniently. A new combinator must register in the policy sweep.

*Why:* the check lived in some combinators and not others, and the split was the worst
one possible: the currency-aware copies of +/−/×/÷ were DEAD CODE (also stale — they
lacked the adoption-scaling author call) while the LIVE path answered `$5 + 5€ = $10`
and `$10 ÷ 5€ = 2:1`. Consolidated to one implementation (`arithmeticCell`, moved
rete-free into unitValue.ts) with the guard up front where no op can miss it — SSOT-1
applied to an algebra.
*Enforced by:* `unitCurrencyPolicy.test.ts` — the per-op policy table (completeness:
every `ArithmeticOp` must appear), the non-arithmetic combinators, and the
combinator-surface check (a new `*Units` export fails until it joins the sweep).
*Origin:* the 2026-07-28 completeness queue ("currency-mismatch across every unit
combinator"); the sweep's first run found the four live wrong answers above.

### VAL-20 — No producer emits a bare non-finite; the producer classifies **[INFERRED]**
**MUST:** a computed number never leaves its producing op as bare `NaN`/`±Infinity` —
the producer classifies via `guardFinite` (valueKinds.ts): `NaN` → `#DOMAIN!`; `±Inf`
from all-FINITE inputs → `#OVERFLOW!`; `±Inf` when an input was already infinite PASSES
(the Constant node's ∞ is first-class). Guarded producers: the element-wise broadcasters
(shared.ts), the formula operators (`applyOp`/unary/percent), `broadcastCall`, and the
RANGE dispatch. A kernel with its own recorded non-finite convention (a quiet null, a
tagged error, IMDIV's `cx(NaN, NaN)`) is the deliberate alternative, not an exemption
from deciding.

*Why:* a bare NaN renders as an EMPTY cell and computes onward as more NaN — a wrong
answer with no appearance, the least-visible failure in the model.
*Enforced by:* `broadcastContract.test.ts` (the per-cell classification behaviour);
`rangeRouting.test.ts` → "a range RESULT classifies non-finite" (the degenerate probe
battery + the ∞-passthrough + the quiet-null carve-out).
*Origin:* the 2026-07-28 producer sweep. The kernels probed CLEAN; the RANGE branch was
the last leak — nine whole-sample calls (STDEV of one value, CORREL of a constant,
GEOMEAN of a negative, SLOPE/RSQ/SKEW/KURT/VAR/Z.TEST degenerate) answered bare NaN
because the branch, unlike `broadcastCall`, returned dispatch results raw.

---

# PERSIST — The save path

Found by the 2026-07-28 spec-promotion sweep: the save path was the largest cluster of
load-bearing, test-pinned invariants with no normative home. The theme is silent data
loss — every failure mode here writes a valid-looking file and surfaces only on reload.

### PERSIST-1 — `extractInit` is a fixed point, and JSON-plain **[INFERRED]**
**MUST:** for every catalog node, `extractInit(new Ctor(extractInit(n)))` equals
`extractInit(n)` — what a save captures, a load re-applies, and the next save re-captures
identically, including non-default booleans and perturbed literal maps. Every captured
value must also survive `JSON.parse(JSON.stringify(…))`: the file path stringifies each
field, so a `Map`/`Set`/class instance/`Infinity` config silently empties in the save
while the live-object fixed point still holds.

*Enforced by:* `persistenceSweep.test.ts` — the fixed-point sweep, the perturbation
sweep (with the reasoned `PERTURB_SKIP` list), and the JSON round-trip sweep.
*Origin:* v1.0 audit finding 38 — a field captured but not re-applied drops on reload
with nothing to catch it.

### PERSIST-2 — The text form is the narrow waist: every `SavedGraph` field, both directions **[INFERRED]**
**MUST:** `serializeGraph()` returns `readTextForm(writeTextForm(raw))`, so every
top-level `SavedGraph` field must be written by `writeTextForm` AND read by
`readTextForm`. A field either direction omits is deleted from EVERY save, and autosave
then writes the lossy result over the good copy.

*Enforced by:* `sourceInvariants.test.ts` → "every SavedGraph interface field appears in
writeTextForm AND readTextForm" (the completeness scan); `textForm.test.ts` (seed
round-trips + the byte-identical second write); `docMeta.test.ts` (the two fields from
the Origin).
*Origin:* `comments` and `reportPalette` were built by `buildRawSavedGraph` and silently
dropped by the round trip from their ship date until 2026-07-06 — a real data-loss bug.

### PERSIST-3 — `documentStoreCore` transforms are structurally immutable **[DEFAULT]**
**MUST:** every transform returns a NEW `SolDoc` for each document it changes.
`documentStore.persist()` decides what to write by OBJECT IDENTITY
(`_lastPersisted.get(id) === doc` skips the write), so an in-place mutation still updates
the screen but is silently never persisted — the edit vanishes on the next reload.

*Enforced by:* `documentStoreCore.test.ts` → the PERSIST-3 deep-freeze walk over every
exported transform (a new in-place write throws on the frozen object; a new export not
in the walk fails the completeness check) + the changed-doc-is-a-new-object identity
assertions.

### PERSIST-4 — Autosave slots: write the older, read the newer, `seq` first and strictly increasing **[DEFAULT]**
**MUST:** the two-slot pair always writes the OLDER slot (a crash mid-write can never
destroy the only good copy) and reads the newer; slot `seq` is a strictly-monotonic
in-session counter (never a raw clock read — same-millisecond writes must not tie); and
`seq` is the FIRST key of every slot payload, because freshness is read with a prefix
regex, not a parse — a payload with any other key first reads as an EMPTY slot and the
rotation silently resurrects the older write.

*Enforced by:* `persistenceCore.test.ts` (the rotation algebra);
`documentStorePersist.test.ts` → "every slot payload the STORE wrote is prefix-readable",
"successive writes to one pair carry strictly increasing seq".

### PERSIST-5 — Persistence binds MAIN, never the active surface **[DEFAULT]**
**MUST:** the composite drill-in substitutes editor/area/engine through the
`activeGraph.ts` seam for CANVAS operations only; `getEditor()`, serialization, autosave
and load resolve the MAIN graph unconditionally. A save taken while drilled in must
serialize the document, not the open subgraph.

*Why:* the failure is total, silent data loss — an autosave during a drill-in would
write the composite's internal subgraph OVER the document, and the file would be valid.
*Enforced by:* `activeGraph.test.ts` → "CARDINAL: getEditor() (persistence source) stays
MAIN even while drilled in" (+ the per-node ownership resolvers).

### PERSIST-6 — The class name is the persisted type: kept and unique **[DEFAULT]**
**MUST:** `constructor.name` is the `type` written into every save and the
ctor-registry key loads resolve through (plus a dispatch key — `SEES_ERRORS`, group
collapse, pins). Two consequences: production builds must keep class names
(`keepNames`), and no two catalog classes may share a name — the registry is
first-wins, so the losing class's saves would silently reconstruct as the winner
(different sockets, plausible wiring, wrong computation; the Placeholder path only
fires for an ABSENT type, and a collision is indistinguishable from a hit).

*Enforced by:* `sourceInvariants.test.ts` → "vite.config.ts and vitest.config.ts both
declare esbuild keepNames"; `catalogRegistry.test.ts` → "no two catalog classes share a
constructor name".

### PERSIST-7 — An unknown node type round-trips losslessly through Placeholder **[INFERRED]**
**MUST:** loading a save with an unregistered type builds a `PlaceholderNode` that
carries the ORIGINAL type, init, literal maps and derived socket keys, and re-saves as
that original type — never as "PlaceholderNode". The whole dormant-pack story rests on
this: open a doc with a pack off, save it, and the pack's nodes must survive intact.
Its outputs emit `#REF!` so the break is LOUD while it lasts, never a silent blank.

*Enforced by:* `nodes/placeholder.test.ts` ("keeps the original type, init, and
literals for a lossless re-save"; the loud `#REF!` outputs); `persistenceCore.test.ts`
(`deriveMissingNodeSockets` — cables to an unknown type derive its socket keys instead
of dropping).

### PERSIST-8 — A canvas-swapping verb captures first and guards the rebuild **[INFERRED]**
**MUST:** every `documentStore` verb that changes which document is on screen calls
`captureCurrent()` before switching (else up to the autosave delay of outgoing edits is
discarded) and guards on `isGraphRebuilding()` (else it races a load and serializes a
half-built canvas into the current doc). Sanctioned exceptions carry their reason:
`restore` (startup — nothing live yet), `remove` (the doc is going away — capturing
would resurrect the dying edits), `reloadCurrent` (the guard lives inside
captureCurrent; its own gate is the reveal lock).

*Enforced by:* `sourceInvariants.test.ts` → "every documentStore verb that swaps the
canvas captures first and guards the rebuild" — a method-body scan over the store
object, with the sanction honesty check.
*Origin:* audit 21p (the race) and 20p (the refused-doc fallback) — both dated in the
store's own comments.

### PERSIST-9 — Every node field is persisted or DELIBERATELY transient **[INFERRED]**
**MUST:** every own field of every catalog node is one of: captured by `extractInit`
(the whitelist, the literal maps, or a bespoke extras block), pattern-transient by
naming convention (`cached*` derived display state, `_*` private runtime machinery),
or listed in the `DELIBERATELY_TRANSIENT` map with the reason it must NOT persist.
A field in none of these is an unmade author decision, and the sweep fails by name.

*Why:* the fixed-point sweep (`PERSIST-1`) proves whitelisted fields round-trip but is
BLIND to a field the whitelist never captured — both sides omit it identically, so the
test passes while the user's setting silently resets on every reload.
*Enforced by:* `persistenceSweep.test.ts` → "PERSIST-9" — the catalog-wide field
classification, the no-double-claim + stale-entry honesty checks, and the found-bug pin.
*Origin:* the 2026-07-28 triage over all 169 unclassified fields found ONE real bug:
`asofDirection`, an as-of join's user-facing direction dropdown that reset to
"backward" on every save/reload/paste — invisible to PERSIST-1 precisely because the
whitelist never saw it. Now whitelisted, pinned.

---

# ENGINE — Recompute passes

The engine's one observable contract: however a recompute is triggered — full pass,
targeted cone, manual mode, a live-data refresh — the values on screen are the ones a
full clean pass would produce. Every rule here is an equivalence, and every failure
mode is a STALE value standing next to fresh ones with nothing marking it.

### ENGINE-1 — The targeted pass is observationally equal to the full pass **[INFERRED]**
**MUST:** `downstreamClosure(nodeId)` equals exactly the set a full pass would
recompute differently — the start node and every transitive dependent, across branches
and joins, terminating on cycles. No more (wasted work is the cheap half) and no less —
a node outside the cone keeps displaying its previous answer with no error. Cycle
handling matches too: the targeted path seeds `#CIRC!` on exactly the SCC members,
like the full pass, instead of recursing to a RangeError.

*Enforced by:* `processTargeted.test.ts` (the closure across branches/joins/cycles);
`circularReset.test.ts` (closing a cycle with a live cable yields `#CIRC!` on the loop
members — audit finding 40, with the rete-engine 2.1.1 recursion bug in the record).

### ENGINE-2 — The calc-mode gate is the ONLY thing that skips a pass **[INFERRED]**
**MUST:** manual/auto × dirty is a real transition matrix: manual mode marks dirty
instead of computing, switching to auto clears the pending flag by RUNNING the pass,
and an unavailable localStorage degrades to in-memory state — never to a graph that
silently stops recomputing.

*Enforced by:* `calcModeStore.test.ts` (the transition matrix, notify-exactly-then,
the missing-localStorage degrade).
*Origin:* shipped in 1.0 with zero direct coverage (v1.0 audit, quality) — the
"silently stops recomputing" failure is invisible by construction.

### ENGINE-3 — A live-data refresh never runs inside a rebuild scope **[INFERRED]**
**MUST:** `refreshConnection` (the manual button and the interval timer) drives its
recompute OUTSIDE `beginGraphRebuild`/`endGraphRebuild` — only `loadGraph` may
suppress. A refresh that lands inside a rebuild scope silently swallows the
edge-detection downstream: an Alert watching refreshed live data simply stops firing.

*Enforced by:* `connectionStore.test.ts` → "refreshConnection never enters a
graph-rebuild scope (the only thing that would silently suppress a fire)" + the
rising-edge-through-refresh case. Pairs with `EFFECT-2` (the suppression this rule
keeps refreshes OUT of is the one loads must stay IN).

---

# EFFECT — External effects

When a node is allowed to do something to the world. The failure modes are inverted
twins: an effect that fires when it shouldn't (a load writes your disk) and an effect
that silently never fires (an alert that misses its edge is a non-event with no
appearance).

### EFFECT-1 — A sink acts only from its Run button, and always loads disarmed **[DEFAULT]**
**MUST:** a node with an irreversible external effect (disk write) never acts from
`data()` — `data()` caches for preview only; the effect lives in `run()`, fired only by
the node's Run button, behind an `enabled` arm flag. The arm flag NEVER persists: it is
excluded from the `extractInit` whitelist so every load path (save reopen, paste,
placeholder restore) starts disarmed — opening a shared file can never write to your
disk.

*Enforced by:* `nodes/sink.test.ts`, `nodes/obsidian.test.ts` (the two families'
behaviour: data() never touches disk, run() gates on the arm, atomic tmp+rename);
`catalogRegistry.test.ts` → "no catalog class persists an `enabled` arm flag, and none
constructs armed" (the catalog-wide quantifier). **The data()-never-writes half is
per-class only** — see Known violations.

### EFFECT-2 — An outward effect is edge-triggered, and suppressed during rebuild **[INFERRED]**
**MUST:** an alert fires on a STATUS edge (`statusKey` — so range LOW↔HIGH re-fires and
boolean mode means `=== 1`), re-arms on the calm edge, and is suppressed while
`isGraphRebuilding()` — the post-load recompute runs inside the rebuild scope, so an
ungated effect replays its whole backlog on every document open, switch and rollback.

*Enforced by:* `nodes/alertNode.test.ts` (the edge matrix: first-eval fire, hold,
re-arm, LOW↔HIGH, mode-switch carry-over, `=== 1`); `sourceInvariants.test.ts` → "every
nodes/packs file firing an alert references isGraphRebuilding" (completeness).
*Origin:* the audit-2026-07-05 class — a Connection node's auto-refresh interval inside
a closed composite kept firing full recomputes forever; and the reported alert
carry-over bug (switch into an already-met condition).

---

# STORE — Node-keyed module stores

Rete renders nodes in a separate React root, so per-node UI/derived state lives in
module-level singleton stores keyed by node id. The lifecycle question — what happens
to a store's entries when a node is deleted, and on a wholesale rebuild — has ONE
answer, the registry; a store that answers it privately answers it wrong eventually.

### STORE-1 — A node-keyed store registers forget AND forgetAll **[INFERRED]**
**MUST:** every module store holding per-node state registers `registerNodeForget`
(the `noderemoved` path) AND `registerNodeForgetAll` (the rebuild bulk reset) with
`nodeStoreRegistry` at module scope. The rebuild path calls `forgetAllNodes()` once —
no store is hand-cleared in persistence, and no per-node cleanup is hand-wired in
Canvas. A store holding ONE transient id (an open popup/overlay) rather than a
per-node map is the sanctioned alternative.

*Why:* the ad-hoc alternatives all existed and all decayed: four stores held
node-keyed maps with NO cleanup (bounded leaks — dead-id entries linger until reload),
persistence hand-listed four more stores' `clear()` calls beside the registry's bulk
reset, Canvas hand-wired standoffs' per-node cleanup UNCONDITIONALLY (paying the
per-node scan during rebuilds that the registry's `isGraphRebuilding` skip exists to
avoid) — and isolateStore's miss was a VISIBLE bug: nothing exited isolate on a
document switch, so the stale focus set dimmed the entire new graph (every regenerated
id a non-member).
*Enforced by:* `sourceInvariants.test.ts` → "STORE-1" — every `*Store*.ts` references
the registry or is sanctioned with its reason; every registrant also registers the
bulk reset; the sanctioned list is honesty-checked.
*Origin:* the 2026-07-28 completeness queue ("formatAnnotationStore and standoffs
register neither"); the sweep found dockedNodeStore, compositeStaleStore and
isolateStore missing too.

# Enforcement summary

68 rules.

| Status | Count | Rules |
|---|---|---|
| Enforced | 64 | PROV-1 · SSOT-1,2,3,4,6,7,8,9 · SOCK-1,2,3,4,5,7,9,10,11,12 · FX-1,2,3,4,5,6,7,8,9,10,11 · VAL-1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20 · PERSIST-1,2,3,4,5,6,7,8,9 · ENGINE-1,2,3 · EFFECT-2 · STORE-1 |
| Partially enforced | 1 | EFFECT-1 |
| Unenforced | 3 | SSOT-5 · SOCK-6, SOCK-8 |

**The ORIGINAL partially-enforced six all closed** (EFFECT-1, which arrived later with
its own domain, is the one current partial — its data()-never-writes half is per-class).
The original six were the
highest-value gap: in each, the rule was tested for the cases that existed and nothing
failed when a NEW case forgot it — precisely the shape of every bug in the Origin notes.
Two of them (SOCK-5, VAL-8) had been written here as "enforced" on the strength of a
plausible-sounding test file name, and only turned out to be partial because the
enforcement column forced the check. That is the argument for the column. Closed across
the 2026-07-28 passes: SOCK-5 (persistence pin), SOCK-7 and VAL-13 (source scans in
`sourceInvariants.test.ts`), the VAL-12 renames + the FX-4 full naming sweep, then the
completeness tranche — VAL-10 (algebra-file scan), VAL-12's blindness (the OpSelect
binding scan + the `arg` contract), VAL-14's only-if (declaring class ⇒ editing
component). SOCK-6 was attempted and recorded as genuinely un-greppable (see the rule).

---

# Known violations

Recorded here rather than fixed, per the author's instruction that the original pass was
documents only. Each is actionable in the follow-up. (Closed so far, all 2026-07-28: the
Alert/ColorBlend `mode` renames, SOCK-7 completeness, SOCK-5's persistence pin, the FX-4
full naming sweep — which caught and fixed the Text Filter CONTAINS claim and the
duplicate math-fn `round` op on its first run — and the completeness tranche: VAL-10's
algebra-file scan, VAL-12's OpSelect binding scan, VAL-14's only-if check. The VAL-14
check's first run listed 13 candidate classes; all 13 verified as real editors once the
heuristic learned the bespoke surfaces — ExtensibleInputs and the `stringLiterals`
spelling — so the codebase was already clean and the value is the ratchet.)

1. **`rules.test.ts` checks the mechanical half only** — IDs unique, every cited test
   file exists, summary counts add up. Whether a cited test actually ENFORCES its rule is
   still a reading job (this document's fact-check found four misciting rules that a
   file-exists check alone would have passed).

2. **EFFECT-1's data()-never-writes half is per-class** — the two existing sink families
   are pinned individually; a NEW sink whose `data()` touches disk is uncaught until its
   own test exists. *Fix: a brace-matched `data()`-body source scan for the write APIs
   (`writeTextFilePath` / `obsidianWrite` / `pickSaveFilePath`), the `opSelectTag`
   technique.*
