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

Rules are named, not numbered — a camelCase descriptor cited as `per shareImpl`. They
group into these domains (the section order below), one example each:

| Domain | Covers | e.g. |
|---|---|---|
| Derivation | where a fact is declared and how other surfaces get it | `declareOnce` |
| Sockets | the type lattice, connection legality, coercion at the boundary | `noAutoCross` |
| Formula surface | registration, naming, argument routing | `shareImpl` |
| Value handling | null, SolError, logical, units | `unwiredNotBlank` |
| Persistence | the save path — capture, round-trip, slots, identity | `plainJsonInit` |
| Engine | recompute passes — targeted ≡ full, gating, refresh scope | `targetedEqualsFull` |
| External effects | when a node may touch the world (disk, alerts) | `sinkRunButtonOnly` |
| Stores | node-keyed module-store lifecycle (the forget seam) | `storesRegisterForget` |
| Provenance | what counts as an author ruling (ARR) | `authorRuled` |

**Out of scope here:** UI, visual and copy rules live in `DESIGN.md` and are enforced by
`uiCopy.test.ts`. Branch model, doc duty and commit style live in `CLAUDE.md`. This file
does not repeat them.

**Vocabulary:** the invented terms (frame, cube, combo, FC, Conduit, the socket
families…) are defined in `docs/glossary.md`; read it first if a term here doesn't
parse. `CLAUDE.md`'s alias table maps the author's UI words to code handles.

## Conventions

- **Cite rule names** in code comments, commit messages and backlog items (`per uniqueNameMap`).
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
- **Provenance** (the Provenance domain): who a rule binds depends on who made it — see the PROV
  section. Exactly one rule in this document is author-ruled; everything else is the
  working agent's inference or default, and is open to question on those terms.

## Process

Spec-first for **new mechanisms and cross-cutting changes**: a new subsystem, naming law,
declaration format, or a sweep touching many files updates this document *before* the
code. Ordinary work — a node, a bug fix, a one-line change — just follows the existing
rules. Every bug fix ships the check that would have caught it, or says why it can't
(`labelUnenforced`). This is the working default, not an author ruling; tighten it freely.

## Rule index (the authorization checklist)

Every rule, one line each — the walk order for the author's authorization pass (the
procedure is in the PROV section). Machine-checked against the actual headings by
`rules.test.ts`, so this list cannot drift.

| ID | Rule |
|---|---|
| authorRuled | ARR is conferred only by the author, in-session, on this document |
| declareOnce | One declaration per fact |
| overrideInPlace | Where a derivation can't be total, the override lives in the same table |
| noManualList | No hand-kept list of a derivable property |
| shapeGuardManualSets | An irreducibly hand-kept set is guarded by SHAPE |
| labelUnenforced | A rule not enforced by a test is debt, and is labelled |
| oneMetricImpl | A gating metric has exactly one implementation |
| oneThingPerMetric | A metric measures one thing |
| useEveryNotSome | Completeness quantifiers are `every`, not `some` |
| onePrunePath | Input-cable pruning is ONE loop (`dropInputCables`) |
| noAutoCross | Type separation: element families never auto-cross |
| widenNeverNarrow | Dimensional flow: values widen up, never narrow down |
| derivedSocketTypes | Adding a socket type is a derived edit |
| wildcardsKeepRank | The wildcard ladder keeps rank |
| adoptKeepsCables | Adoption never drops cables and never persists |
| oneResolvePredicate | "Resolve past untyped passthroughs" goes through one predicate |
| retypeReconciles | In-place retype must reconcile downstream |
| socketBox12 | The socket box is a deterministic 12×12 |
| anydataWildcard | `anydata`: the rank-≤2 element-agnostic wildcard (D23) |
| portOwnsSocket | An adopting port owns its socket instance |
| trueanyNeedsPassthrough | A `trueany` output implies a `passthrough()` declaration |
| relaysTransparent | Relay nodes are transparent to every static derivation |
| waitForTypeSettle | A derived-type consumer runs only after the wildcard settle |
| frameLabelGrammar | Frame-input labels follow the column-role grammar |
| frameLabelHint | A column-role-labeled frame input carries a matching example hint |
| shareImpl | One implementation, two surfaces |
| implReteFree | A shared implementation is rete-free |
| declareContract | A registration declares its full contract |
| uniqueNameMap | A derived name function is TOTAL and INJECTIVE |
| wholeArrayArgs | Array arguments arrive whole |
| prepByShape | Argument prep matches the function's shape, not its category |
| blockedFailFast | Blocked spellings answer before their arguments are shaped |
| matchNodeLimits | The formula boundary caps what a node's control already bounds |
| hideMatrixFromVendor | Formula.js never sees a matrix, or a tagged Cx (D23 containment) |
| oneBroadcast | One broadcast engine, and the table is the test |
| tripwireVendorDrift | A vendored-engine divergence is owned, and tripwired |
| oneVerbCorpus | The verb pair computes from ONE fixture corpus |
| rowFormulaRefs | In a row formula, a bare name is the WHOLE column; `@` is this row |
| unwiredNotBlank | Unwired is not blank |
| oneErrorKind | One notion of error |
| errorInErrorOut | Error in, error out, without running the node |
| errorsKeepOrigin | Errors carry provenance |
| nullSkippedNotZero | Null is first-class and skipped, not zero |
| errorBeatsMissing | Error beats missing at the same cell |
| kleeneLogic | Logical is a first-class family with Kleene logic |
| keyByValue | Membership keys by VALUE, never identity |
| unitOnValue | The unit is a property of the VALUE |
| perInputUnitBlind | The unit-blind boundary is PER-INPUT |
| unitByGranularity | Units attach at the granularity of homogeneity |
| selectorNamedOp | An op family's selector field is named `op` |
| noDataInComponents | Components never call `node.data()` |
| literalsIffEditable | Inline literal maps are declared iff the card edits them |
| tagSpecialScalars | A special scalar is a TAGGED OBJECT, never a bare array |
| maxRankMatrix | The rank grammar: nothing nests deeper than a matrix |
| freezeVolatilePerCalc | A volatile `data()` freezes its roll on the recalc generation |
| pickVsAggregateErrors | Positional access filters errors per cell; aggregation propagates whole |
| noMixCurrencies | Two different currency codes are incommensurable in EVERY combinator |
| classifyNonFinite | No producer emits a bare non-finite; the producer classifies |
| plainJsonInit | `extractInit` is a fixed point, and JSON-plain |
| saveViaTextForm | The text form is the narrow waist: every `SavedGraph` field, both directions |
| immutableDocStore | `documentStoreCore` transforms are structurally immutable |
| autosaveSlotOrder | Autosave slots: write the older, read the newer, `seq` first and strictly increasing |
| saveBindsMain | Persistence binds MAIN, never the active surface |
| classNameIsType | The class name is the persisted type: kept and unique |
| unknownViaPlaceholder | An unknown node type round-trips losslessly through Placeholder |
| captureBeforeSwap | A canvas-swapping verb captures first and guards the rebuild |
| everyFieldClassified | Every node field is persisted or DELIBERATELY transient |
| observerOwnsSize | `width`/`height` ownership: the observer owns them; size-owners re-consume |
| targetedEqualsFull | The targeted pass is observationally equal to the full pass |
| onlyCalcModeSkips | The calc-mode gate is the ONLY thing that skips a pass |
| refreshOutsideRebuild | A live-data refresh never runs inside a rebuild scope |
| sinkRunButtonOnly | A sink acts only from its Run button, and always loads disarmed |
| effectsEdgeTriggered | An outward effect is edge-triggered, and suppressed during rebuild |
| storesRegisterForget | A node-keyed store registers forget AND forgetAll |

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

### authorRuled — ARR is conferred only by the author, in-session, on this document **[ARR]**
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
*Enforced by:* `rules.test.ts` → "exactly one rule is author-ruled, and it is
authorRuled" — the ARR-uniqueness guard: exactly ONE `[ARR]` mark may exist in this
document, and it must sit on authorRuled. The agent cannot promote a rule to ARR
without that test failing — promotion happens by the author editing (or dictating
the edit of) this file, and the guard's expected count moving with it is part of
that same author-marked change.

**Consequences for the rest of this document:** every "author-gated",
"author ruling", and quoted decision below is now read as INFERRED — real history,
real evidence, no ARR authority. Every rule heading carries its grade (the
2026-07-28 audit): INFERRED where a concrete incident occurred and is named,
DEFAULT where the rule is preventive judgment with no forcing incident. The
DEFAULT set (derivedSocketTypes, oneResolvePredicate, trueanyNeedsPassthrough, frameLabelGrammar, frameLabelHint, oneBroadcast, noDataInComponents, literalsIffEditable, freezeVolatilePerCalc,
immutableDocStore, autosaveSlotOrder, saveBindsMain, classNameIsType, sinkRunButtonOnly) is the thinnest ice: rules held up by the agent's
reasoning without a forcing incident, and the first candidates for either an
enforcing incident or deletion. Note the grade tracks PROVENANCE, not value — a
promoted convention whose failure has never actually happened grades DEFAULT no
matter how load-bearing the reasoning, which is why the 2026-07-28 promotion
sweep grew the set.

**The authorization pass (how a rule becomes permanent).** The intended end state
is that the author walks the rule index above and authorizes each rule by hand.
Per rule, the mechanics are:

1. **Read the rule.** The heading is the claim; the MUST is the exact contract;
   *Why*/*Origin* are the evidence; *Enforced by* is what fails if it's broken.
2. **To authorize it as permanent:** change the grade in its heading to `[ARR]`
   and add its ID to `AUTHOR_MARKED_ARR` in `rules.test.ts` — both halves in the
   SAME author-marked change. The ARR-uniqueness guard enforces the pairing;
   that the author edits the expected list themselves is what makes the mark the
   author's rather than the agent's.
3. **To amend first:** dictate the amendment, then mark the amended rule.
4. **To reject:** the rule is deleted or regraded in the same sitting — never
   left half-authorized.

A rule not yet marked keeps its INFERRED/DEFAULT grade and binds only as the
working agent's inference — open to question on exactly those terms.

---

# SSOT — Derivation and single source of truth

The theme of every architecture bug found to date. A fact that is written down twice
drifts; a property that is hand-maintained gets missed.

### declareOnce — One declaration per fact **[INFERRED]**
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

### overrideInPlace — Where a derivation can't be total, the override lives in the same table **[INFERRED]**
**MUST:** when a derived value can't be computed for every case, the exception is
declared as a FIELD on the same declaration (the `fx` field on an `OP_META` table), never
as a parallel lookup map keyed by the same identity.

*Why:* a parallel map is declareOnce's failure wearing a different hat — it is a second place
that must be kept in step, and it is not next to the thing it modifies.
*Enforced by:* `formulaTier3.test.ts` → "the prose-labelled families — names DECLARED, not
despaced".
*Origin:* D19 2(a) derives a formula name by despacing the node label, which works only
while a label is a name. Three families label themselves in sentences for the dropdown
("Union: in A or B"). `fx` sits on `SET_OP_META` / `SET_RELATION_META` / `FILL_OP_META`.

### noManualList — No hand-kept list of a derivable property **[INFERRED]**
**MUST:** membership sets that encode a property of a declaration (routing, exposure,
capability) are DERIVED from the declarations. A hand-written set is permitted only for
facts that live nowhere else, and it must then be shape-checked (`shapeGuardManualSets`).

*Why:* a hand-kept set fails open. Nothing errors when a name is missing from it — the
behaviour just silently changes.
*Enforced by:* `excelFunctions.ts` `listReturningNames()` / `wholeArgNames()` derive from
`EXCEL_IMPL_META`; `formulaTier3.test.ts` → "the declarations stay honest".
*Exceptions:* `RANGE_FUNCTIONS` (`excelFormula.ts`) is still hand-kept for the Formula.js
half of the surface, because Formula.js publishes no machine-readable signature to derive
from. Shape-guarded by `rangeRouting.test.ts` per `shapeGuardManualSets`. **Removed by:** deriving
argument shape from a signature table, if one is ever authored.
*Origin:* ten functions — `T.TEST`, `F.TEST`, `Z.TEST`, `CHISQ.TEST`, `SUMX2MY2`,
`SUMX2PY2`, `SUMXMY2`, `MODE.SNGL`, `PROB`, `SERIESSUM` — were missing from
`RANGE_FUNCTIONS` and had been silently broadcast element-wise, each returning a
plausible-looking wrong value.

### shapeGuardManualSets — An irreducibly hand-kept set is guarded by SHAPE **[INFERRED]**
**MUST:** where `noManualList` grants an exception, a test asserts the *observable consequence*
of membership, not merely the membership. Assert what the function does, not that its
name appears in a set.

*Why:* checking membership against a hand-written list of the same names proves nothing.
Checking that `T.TEST` returns one number rather than four is a real check.
*Enforced by:* `rangeRouting.test.ts` → "whole-sample functions are range-routed, not
broadcast".

### labelUnenforced — A rule not enforced by a test is debt, and is labelled **[INFERRED]**
**MUST:** each rule here carries `Enforced by:` or `UNENFORCED`. A bug fix ships the check
that would have caught it, or states why it can't be checked.

*Why:* the difference between a spec and a folk memory is whether anything fails when you
break it. `CLAUDE.md` already carries an honest example of the alternative — the
OS-dropdown rule, "widely cited, but no originating incident is on record", 21 call sites
held on precaution.
*Enforced by:* `rules.test.ts` → "every rule labels its enforcement" — the
labelling itself is mechanical (every rule body carries an *Enforced by:* line, tests
or an explicit UNENFORCED). Whether a cited test truly enforces is machine-checked for
QUOTED citations (the arrow → "test name" form must appear in the cited suite) and a
reading job for bare-file citations (Known violations, narrowed 2026-07-29).

### oneMetricImpl — A gating metric has exactly one implementation **[INFERRED]**
**MUST:** a number that gates CI is computed in ONE module. The human-readable report and
the ratchet test call the same function. Neither recomputes it.

*Why:* a report that measures differently from the test is how a ratchet silently stops
ratcheting.
*Enforced by:* `formulaNodeParity.ts` is the single measurement, imported by both
`scripts/formula-node-parity.ts` and `formulaNodeParity.test.ts`; its header states this.
*Origin:* stated as a comment, then violated twice in one session anyway. The measurement
matched a leaf by its host label (reporting nine registered `FILL*` functions as a gap),
and gap A was computed as `!inFormula`, so registering `RUNNINGSUM` made `SCAN` drop out
of the gap it was still in. See `oneThingPerMetric`.

### oneThingPerMetric — A metric measures one thing **[INFERRED]**
**MUST:** a coverage metric that answers two questions is split into two fields. Do not
derive "is this Excel name callable" from "is this node reachable somehow".

*Why:* folding them lets one improvement mask an unrelated regression.
*Enforced by:* `formulaNodeParity.ts` — `inFormula` (reachable by any name) vs
`excelCovered` (every Excel name dispatches), with the reason in the type comment.

### useEveryNotSome — Completeness quantifiers are `every`, not `some` **[INFERRED]**
**MUST:** a claim of the form "this node supports X" over a SET of names is checked with
`every`. `some` is permitted only where partial support is the deliberate, documented
contract.

*Why:* `some` reports a node covered when most of its names still fail.
*Enforced by:* `formulaNodeParity.test.ts` → "excelCovered quantifier is EVERY, not
SOME — one missing name uncovers the node (useEveryNotSome)" — a direct pin on the extracted
`excelCoverage` quantifier (the live catalog can't distinguish the quantifiers while
gap A is empty, so the pin is synthetic by design).
*Origin:* the `some` form hid ten names — the seven B-suffixed text functions,
`ERF.PRECISE`, `ERFC.PRECISE`, `VALUETOTEXT` — each declared against a real node while
the formula surface answered `#NAME?`.

### onePrunePath — Input-cable pruning is ONE loop (`dropInputCables`) **[INFERRED]**
**MUST:** every "these input sockets are going away" moment — a mode/op switch hiding
inputs, a variadic row being deleted, a formula variable disappearing — drops the
affected cables through `components/cablePrune.ts` `dropInputCables`, BEFORE the socket
is hidden or removed. This binds NODE CLASSES as much as components (Computed Column's
side-socket reconcile was the twelfth hand-rolled copy, found 2026-07-31 — in a node
class, exactly where the components-only sweep couldn't see). A file calls
`editor.removeConnection` directly only for a genuinely different shape (cross-graph
port sync, both-direction prunes, type-compat filters, single user-selected cable),
each sanctioned with its reason in the sweep.

*Why:* eleven hand-rolled copies of the loop had drifted on the details that matter —
some snapshotted the connection list before removing, some iterated it LIVE while
awaiting removals; some remembered the active-graph seam (a drill-in edits its own
graph), the next copy wouldn't have. The helper also carries the ordering rule the
copies each half-remembered: prune before the socket goes (removeInput while a cable
references the socket is unsafe — the Interpolate variant-switch lesson), and a hidden
socket with a live cable is an invisible wire.
*Enforced by:* `sourceInvariants.test.ts` → "no component or node class hand-rolls an
input-cable pruning loop" (+ the sanctioned-list honesty check) — the scan walks
`components/`, `nodes/` and `packs/`.
*Origin:* the 2026-07-28 spec-promotion queue — recorded there as six copies; the
unification sweep found eleven.

---

# SOCK — The socket lattice

The lattice is a family × rank product, and its legality rules are DERIVED from that
product rather than enumerated per pair. Full mechanics: `docs/socket-reference.md`,
`CLAUDE.md` "Socket lattice".

### noAutoCross — Type separation: element families never auto-cross **[INFERRED]**
**MUST:** a value of one element family never connects to an input of another. Crossing
requires an explicit Cast node.

*Enforced by:* `socketConnect.test.ts` → "CROSS-family is blocked everywhere EXCEPT
logical↔number (dim-mirrored)".
*Exceptions:* `logical ↔ number` is the ONE bridge (boolean ↔ 0/1), mirrored at every
rank. **Removed by:** nothing — it is the deliberate consequence of Excel treating
TRUE/FALSE as 1/0. Any *second* exception is a lattice design change, not a patch.

### widenNeverNarrow — Dimensional flow: values widen up, never narrow down **[INFERRED]**
**MUST:** scalar → list → matrix → frame is permitted within a family; the reverse is
refused. A list widens into a 2-D input as a ROW.

*Enforced by:* `socketConnect.test.ts` → "WITHIN a family: a value widens UP (+
combo→scalar), and never narrows", "every rank≤2 value (ANY family) widens INTO the 2-D
containers".
*Exceptions:* a COMBO (scalar-or-list) narrows into its element scalar; a plain list does
not. This is what makes a combo a combo. **Removed by:** nothing.

### derivedSocketTypes — Adding a socket type is a derived edit **[DEFAULT]**
**MUST:** a new socket type is added by extending the family/rank product. Cross-type
dimensional edges are explicit in `accepts()` and swept exhaustively by test. A new type
must not require hand-writing its pairs.

*Why:* the lattice has 31 variants; enumerating pairs by hand is quadratic and wrong.
*Enforced by:* `socketConnect.test.ts` → "lattice invariants — TYPE separation +
DIMENSIONAL flow (full sweep)"; `socketFamilyCompleteness.test.ts`.

### wildcardsKeepRank — The wildcard ladder keeps rank **[INFERRED]**
**MUST:** the untyped ladder is `any` (scalar) → `anycombo` (0-or-1-D) → `anylist` (1-D)
→ `anytable` (2-D) → `anydata` (rank ≤ 2) → `trueany` (the adopt-anything supremum).
The two STRICT rank-bearing rungs — `anylist`/`anytable` — keep their rank and adopt
only the element family; the elastic rungs (`any`/`anycombo`/`anydata`) adopt the wired
type verbatim (`adoptTypeForBase`, `RANK_BASES` in the sweep).

*Enforced by:* `socketConnect.test.ts` → "`any` INPUT: family scalars + combos in;
lists/matrices/containers refused", "anylist INPUT", "anylist OUTPUT", "anytable OUTPUT
stays 2-D", "`trueany` bridges everything, both directions".

### adoptKeepsCables — Adoption never drops cables and never persists **[INFERRED]**
**MUST:** `trueany` adoption (`trueAnyAdopt.ts`) resolves a type without disconnecting
anything, and the adopted type is not written to the save file.

*Enforced by:* `trueAnyAdopt.test.ts` → "a Display adopts on both sides and REVERTS
on disconnect", "adoption propagates down a passthrough CHAIN", "two Displays do NOT
share adoption" (the never-drops half), and "adoption never PERSISTS: a save/paste
init carries no adopted type" (adopt → extractInit → assert no adopted type in the
init, reconstructed node starts hollow).

### oneResolvePredicate — "Resolve past untyped passthroughs" goes through one predicate **[DEFAULT]**
**MUST:** every place that needs to see through an untyped hop calls `isWildcardType()`.
No local re-implementation of "is this socket untyped".

*Why:* three subtly different notions of "untyped" is three subtly different bugs.
*Enforced by:* `UNENFORCED`. A grep check was attempted (2026-07-28 enforcement pass):
most wildcard-literal comparisons outside sockets.ts are RENDERING classifiers (glyph
shape, combo drawing, wire-only rows), but not all — `passthrough.ts` `agreeTypes`
carries a semantic `=== "trueany"` veto (deliberately co-located so the socket pass
and display walk can't diverge). A mechanical scan can't separate the classes, so
this stays a reading rule.

### retypeReconciles — In-place retype must reconcile downstream **[INFERRED]**
**MUST:** a node that mutates a socket's `dataType` in place fires no connection event,
so it MUST call `reconcileFcTypes` / `retypeOutputCables`. (Sites include Cast target,
λ-table result, Get Column read-as, Note frontmatter, List/Table Input element type,
Add/Split Column, CableSwitch, Import Obsidian — the completeness scan owns the full
set; this list is examples.)

*Why:* without it, downstream Format Controllers keep stale formats.
*Enforced by:* `fcReconcile.test.ts` → "retypeOutputCables (Cast / LAMBDA / Get Column
shared retype path)" and `noteFcPropagation.test.ts` → "Note frontmatter retype
propagates type to a downstream FC" cover the BEHAVIOUR of the known retypers;
`sourceInvariants.test.ts` → "every socket-retyping file references the reconciler"
covers COMPLETENESS — a source scan requires every file that retypes a socket in
place (`.socket =` / `.setType(` / `.dataType =`) to reference a reconciler, with a
reasoned sanctioned list for the central adoption machinery itself.

### socketBox12 — The socket box is a deterministic 12×12 **[INFERRED]**
**MUST:** the socket span renders `display:block; line-height:0` at a locked 12×12, and
vertical placement is MEASURED per row — never a fixed constant, never a `transform`.

*Why:* `rete-render-utils` measures the span's offset box for cable endpoints, and
`offsetTop` ignores transforms, so rete would misreport the endpoint.
*Enforced by:* `sourceInvariants.test.ts` → "socketBox12 — the socket box's greppable
half": socket.css keeps the deterministic box (display:block, the 12px size variable
on both axes, line-height 0), no INPUT_ROW_TOP-style constant anywhere, no transform
positioning in the socket component. **The RENDERING half stays unenforced** — only a
browser can verify rete measures the box it expects.

### anydataWildcard — `anydata`: the rank-≤2 element-agnostic wildcard (D23) **[INFERRED]**
**MUST:**
- **As an input:** `anydata` accepts every FAMILY value of rank ≤ 2 (scalar / list /
  combo / matrix) plus the lower wildcards (`any`, `anylist`, `anycombo`,
  `anytable`), and REFUSES frames, cubes and the object family (lambda / chart /
  document).
- **As an output:** it flows wherever `anycombo` flows (runtime-shaped, same
  accepted risk).
- Its membership edges are DERIVED additions to `accepts()` per `derivedSocketTypes`, swept by
  the full lattice test.
- A formula surface's variable/side sockets are `anydata`: Expression VARIABLES (the
  D23 lift) and Computed Column SIDE INPUTS (a side value can be a whole list —
  `SUM(list)` — or a row-aligned list read by `@name`). The RESULT socket keeps
  its family instead: the `resultAs` combo socket stays for rank-≤1 results, and
  when a computed result is a MATRIX the node swaps its result socket to the same
  family's matrix rung and reconciles per `retypeReconciles` (`retypeOutputCables`) —
  value-driven, but through the same machinery every in-place retype uses. Family
  typing for downstream FCs survives; the socket never lies about rank.

*Why:* the D23 endpoint is matrices-ONLY. A `trueany` variable would admit frames
and cubes into formulas (out of scope, permanently); `anycombo` refuses the
matrices the decision admits. The lattice needed the one rung between them. The
result is NOT `anydata` because that would trade away the family (`familyOf` =
none) that Format Controllers key on, for a rank the matrix rungs already spell.
*Enforced by:* `socketConnect.test.ts` → "lattice invariants — TYPE separation +
DIMENSIONAL flow (full sweep)" (the anydata cases ride the sweep);
`expressionMatrix.test.ts` → "the connect-time gate (anydataWildcard acceptance)", "a fresh
Expression declares anydata variables" (the lift + the result-rank reconcile).

### portOwnsSocket — An adopting port owns its socket instance **[INFERRED]**
**MUST:** every `MutableSocket`/`AdoptiveSocket` port gets a FRESH instance — never a
module-level shared one. (The `staticTrueAny*`/`trueAnySocket` singleton sits OUTSIDE
this rule's scope: it is a plain immutable `SolenoidSocket`, not a `MutableSocket`,
so the sweep never sees it — immutability by type, not by contract.) A shared mutable socket
means wiring a date into one card retypes ANOTHER card's port, which then coerces its
input under the wrong type and answers a plausible number the user cannot connect to a
cause.

*Enforced by:* `catalogRegistry.test.ts` → "no two instances of a class share a mutable
socket" — two instances of every catalog class, no `MutableSocket` in both.
*Origin:* the Input Switch's old shared `valueSocket` — the incident the AdoptiveSocket
class doc ("One instance per port, never shared") was written against.

### trueanyNeedsPassthrough — A `trueany` output implies a `passthrough()` declaration **[DEFAULT]**
**MUST:** a class with a `trueany` OUTPUT either declares `passthrough()` — the ONE
declaration the five derived-type consumers read (trueany adoption, unit flow, the
frame-shape resolver, the
display-type walk, coerceInputs' keep-tags boundary) — or is sanctioned with the reason
its type resolves another way (the FC is the resolver; Conduit lanes resolve through
conduitTrace; composite boundary ports sync in their own pass; XLOOKUP/NA are genuinely
unknowable). An undeclared forwarder's output stays `trueany` forever: downstream FCs
can't key a family, so a date serial silently renders as its raw number.

*Enforced by:* `catalogRegistry.test.ts` → "every class with a trueany output declares
passthrough()" — a catalog walk with the reasoned sanction list and its honesty check.

### relaysTransparent — Relay nodes are transparent to every static derivation **[INFERRED]**
**MUST:** a value relay (a Conduit lane, a passthrough chain, an IF with one wired
branch) is TRANSPARENT to static resolution: a cable leaving it resolves type, unit
annotation and frame SHAPE from the ORIGINATING source's socket — through chains,
reverting on disconnect — never from the relay's own untyped lane. And a Conduit run is
identified from its ORIGIN: every segment of one run resolves to the same run, so
provenance readings (the Cable inspector's "From") and run-wide actions cannot split by
which segment was clicked.

*Enforced by:* `conduitTrace.test.ts` → "resolveTypedSource — Conduit type tracing"
(lane tracing through chains, loop termination, lane adopt/revert) and "conduitPath —
the whole run a cable belongs to" (run identity); `frameShapePassthrough.test.ts` →
"frame SHAPE survives a passthrough (Bug B)" (through a Display / a Conduit lane / a
half-wired IF); the unit-annotation half: `unitFlowAnnotation.test.ts` → "the lock
survives a chain of passthroughs but BREAKS at a transform", "the lock crosses a
Conduit lane (in_i → out_i), each lane independent".
*Origin:* Bug B — downstream column pickers went empty and formula column references
silently failed to resolve through a passthrough, with no error anywhere.

### waitForTypeSettle — A derived-type consumer runs only after the wildcard settle **[INFERRED]**
**MUST:** any step that reads a RESOLVED socket type and CACHES the answer — the FC
dock loop is the load-path instance (`dockSelf` → `adaptTypeFromConnections` resolves
the HOST socket once, at dock time) — runs AFTER `settleWildcardTypes` on that editor.
On load, `persistence.ts` settles wildcard types before registering FC docks; any new
one-shot consumer of a projected/adopted type joins the same side of the fence.

*Why:* before the settle, a projected wildcard output (INDEX over a frame) still
reads as its upstream's RAW type. A consumer that caches that answer keeps it — the
docked FC adopted `frame`, showed no controls, and nothing re-adapted after the
settle. The failure is a plausible wrong type with no error anywhere, and the
observed "fix" (re-docking by hand) masks the cause, which is the worst possible
diagnostic signal.
*Enforced by:* `fcDockReload.test.ts` → "load order settles wildcard types before
dockSelf — the FC adopts the cell's family, locked to its unit", plus its
inverted-order MECHANISM twin, which pins that the constraint is real and
self-retires if `adaptTypeFromConnections` ever learns to project through an
unresolved wildcard.
*Origin:* the 2026-07-31 "false Frame type on reload" report — a computed column's
unit → INDEX → docked FC chain read `frame` after every reload until re-docked.

### frameLabelGrammar — Frame-input labels follow the column-role grammar **[DEFAULT]**
**MUST:** a frame/2-D input socket's label states WHAT COLUMNS the input expects,
in one grammar:
- **Expects specific columns** → the column roles in expected order, joined by
  `" + "`, each role a Title-case word: `From + To + Value`, `Label + Value`,
  `Date + Value`. A standard column GROUP may compact to its standard initialism
  (`Date + OHLC`) — never spaced-out single letters.
- **No specific columns** (any frame / homogeneous columns) → one plain Title-case
  noun (`Frame`, `Data`, `Series`, `Scores`).
- **Never a shape parenthetical** (`(2-D)`, `(list)`): the socket glyph and the
  Socket Legend already state the shape — restating it in the label violates the
  zero-restating mandate (DESIGN.md §7).
Exception: the λ-table inputs in `nodes/tableLambda.ts` carry the λ ARGUMENT name
and optionality (`Values (value)`, `value2 (optional)`) — an argument-binding hint,
not a shape, scoped to that file.

*Why:* aligned parallel columns arrive as ONE frame input by design (the
aligned-columns rule), so the label is the only place the expected columns can be
read before wiring; two ad-hoc dialects (`From + To + Value` vs `Series (2-D)`)
made the one load-bearing hint unlearnable.
*Enforced by:* `sourceInvariants.test.ts` → "frameLabelGrammar — frame-input labels follow
the column-role grammar" (scans every `frameIn`/`anyTableIn` literal).
*Origin:* backlog item "rigorous multi-column input-socket label syntax"; rule
design delegated by the author 2026-08-05.

### frameLabelHint — A column-role-labeled frame input carries a matching example hint **[DEFAULT]**
**MUST:** every frame/2-D input whose label is a frameLabelGrammar ROLE CHAIN (`Role +
Role …`) declares an example hint for that input key (`static frameHints` on
the node class — `frameHint.ts`), and the hint's column NAMES equal the label's
roles in order, expanding standard initialisms (`OHLC` → Open, High, Low,
Close). The hint's shape rules (3–5 rectangular rows, cells matching the
declared column types) bind every hint, role-labeled or not.

*Why:* the hint is the label's WORKED EXAMPLE — the pair is one contract. A
role-labeled input with no hint silently loses the mechanism new nodes are
expected to carry; a hint whose columns drift from the label shows a
confidently wrong example, which is worse than none.
*Enforced by:* `frameHint.test.ts` → "every role-chain-labeled frame input
declares a hint whose columns match the label" (sweeps the catalog), plus its
shape checks over all hints.
*Origin:* author order 2026-08-05 ("this should be an enforced thing — spec
driven"), upgrading the hint mechanism from convention to contract.

---

# FX — The formula surface

Two surfaces exist for the same functions — the node catalog and the formula language —
and nothing structurally connects them. These rules are what keeps them from drifting.
Program record: `docs/archive/formula-node-parity.md`.

### shareImpl — One implementation, two surfaces **[INFERRED]**
**MUST:** a function callable from BOTH a node and a formula has exactly one
implementation, in a rete-free module (`nodes/listOps.ts`, `textOps.ts`, `financeOps.ts`,
`mathUtils.ts`, `dateSerial.ts`, `convertUnits.ts`, `nodes/matrixOps.ts`,
`nodes/indexAccess.ts`, `cxValue.ts`). Both callers delegate to it.

**MUST (capability parity — the author's standing order, 2026-08-21):** the node must
expose EVERYTHING the formula surface can do for that function. No argument, mode, or
return shape reachable from the formula may be unreachable from the node — the node
carries a socket, a dropdown op, or a control for each. Divergence from Excel or
Formula.js is a judgement call (documented per `nodeExcel` note); our OWN two surfaces
disagreeing is a defect, never shipped. A node that dispatches through `resolveExcelFunction`
passes the function's FULL arg list; a node with its own computation covers every mode the
registration does (prefer routing both surfaces through one shared kernel so they cannot
drift — the REGEX ops compose `regexApply`/`replaceNth`/`regexGroups` on both sides).

*Why:* the two surfaces drifted for exactly as long as they were two implementations.
*Enforced by:* `formulaTier3.test.ts` → "every Tier 3 name computes what its node
computes"; `formulaTier1.test.ts`. **Capability parity** is enforced BEHAVIOURALLY, per
function, by node↔formula agreement tests (`finance.test.ts` DB, `auditFixes.test.ts`
RANDARRAY, `formulaTier1.test.ts` REGEX*, `text.test.ts` SUBSTITUTE, `rangeRouting.test.ts`
TREND, `matrixReshape.test.ts` WRAP) — the ONLY reliable guard, since a missing socket
can't be exercised. `nodeFormulaArgParity.test.ts` is a PARTIAL greppable guard: it fails a
node that dispatches through `resolveExcelFunction` with fewer args than the arity max, but
cannot see a separate-impl or Formula.js-fall-through gap (that scan passed while DB/
RANDARRAY/REGEX were all broken — which is why the behavioural tests are the real line).
*Exceptions:* `SHUFFLE` cannot assert node-equals-formula because it is VOLATILE and the
two surfaces run different volatility clocks deliberately — the node holds its sort keys
until the next recalc, a formula redraws per evaluation. The PERMUTATION is still one
implementation (`shuffleList` takes its keys as an argument); the test asserts a
permutation plus real variation instead of equality. **Removed by:** nothing — this is
what volatile means. Any future volatile function follows the same split.

### implReteFree — A shared implementation is rete-free **[INFERRED]**
**MUST:** a module imported by the formula path must not pull in rete, the socket lattice
or the frame model.

**MUST (every sibling, including the next one):** the rule governs EVERY module in the
shareImpl seam, not just the ones listed there. A new shared module is CREATED under this
rule — check a sibling's header before writing it, and state the constraint in its own
header the way `dateSerial.ts` / `convertUnits.ts` / `listOps.ts` do. `frame.ts` and
`unitColumn.ts` are the two easy traps: both look like value-layer modules and both
reach rete (`frame.ts` → `sockets.ts`; `unitColumn.ts` → `unitBridge.ts` →
`formatAnnotationStore.ts` → `nodes/date.ts`).

**MUST (what to extract):** share only what BOTH surfaces can hold. A node kernel that
also handles frames or cubes does not move whole — a formula holds neither (hideMatrixFromVendor), so
that half stays node-side and calls the shared core (`indexAccess.ts` + the frame/cube
branch in `nodes/list.ts` is the pattern), and a needed dirty helper arrives as an
ARGUMENT rather than an import (`tagFrameCellUnit` into `indexInto`).

*Why:* the headless formula path (`run-graph`, the evaluator) should not load the editor.
*Enforced by:* `formulaPathIsReteFree.test.ts` → "no module reachable from
excelFormula/excelFunctions imports rete or sockets" — walks the import graph (the
frame-model clause is UNENFORCED by the walk — true today, reading rule) — and
fails on any reachable `rete` or `sockets` import.
*Origin:* `interpolateLinear` lived in `stats.ts` and had to move to `mathUtils.ts` before
`INTERPOLATE` could be registered. The rule was VIOLATED while it was unenforced:
`excelFunctions` reached rete through `nodes/date.ts` (the serial helpers) and
`nodes/convert.ts` (the unit table) until both were extracted (`dateSerial.ts`,
`convertUnits.ts`) — found by the enforcement column's own review, which is the argument
for the test. Violated a third time 2026-08-11 by a NEW sibling (`indexAccess.ts`
extracted the INDEX node's `data()` whole, importing `frame.ts`), which is why the rule
now names the create-a-sibling moment and what not to extract.

### declareContract — A registration declares its full contract **[INFERRED]**
**MUST:** every `registerInternal` name has an `EXCEL_IMPL_META` entry declaring
`returns`, `arity`, and where applicable `rank` and `listArgs`. Routing DERIVES from that
entry (`noManualList`); it is never declared twice.

*Enforced by:* `excelFunctions.test.ts` → "every registered internal declares its meta
(declareContract, the registered→declared direction)" — the D10 redirect stubs are out of scope (they
are the gate, not implementations); `formulaTier3.test.ts` → "the declarations stay
honest", "a list-RETURNING function also takes its args whole" (the declared→dispatches
direction).
*Exceptions:* the POSITIONAL lookups (`XLOOKUP`/`XMATCH`/`INDEX`) declare meta but not
`listArgs` — they are routed by `RANGE_POSITIONAL` (skip the error scan) and the flag
would reroute them. **Removed by:** unifying the two routing declarations.

### uniqueNameMap — A derived name function is TOTAL and INJECTIVE **[INFERRED]**
**MUST:** any rule that derives a name (D19 2(a): the node label despaced) must be defined
for every input AND must never map two different things to one name. Both properties are
machine-checked.

*Why:* a naming law without an injectivity check will silently collide, and the collision
is discovered by whoever registers second.
*Enforced by:* `formulaTier3.test.ts` → "the formula namespace stays unambiguous",
including the FULL naming sweep ("uniqueNameMap full sweep"): every OPERATION-kind op name in
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
`INTERPOLATE`. Fill's op now declares `fx: "FILLINTERPOLATE"` per `overrideInPlace`. The full
sweep's first run (2026-07-28) then caught two live wounds the partial sweep missed:
Text Filter's `Contains` op claimed the list-membership `CONTAINS` (fixed by
reclassifying the family operation → argument — the ops are a filter CONDITION), and
the math-fn `round` op's leaf claimed `ROUND`, a name that dispatches the 2-arg Excel
ROUND which REFUSES the leaf's own 1-arg semantics (fixed by deleting the duplicate op —
RoundN at digits 0 is the same capability).

### wholeArrayArgs — Array arguments arrive whole **[INFERRED]**
**MUST:** a function taking a whole 1-D list is routed past the element-wise broadcaster.
A function whose arguments are all scalars but whose RESULT is a list is also marked
never-broadcast.

*Why:* without it the evaluator maps the call element-wise and returns N answers to a
question that has one; with a list-returning function it builds a 2-D value behind the D2
cap's back.
*Enforced by:* `formulaTier3.test.ts` → "the whole-list routing"; `rangeRouting.test.ts`.
(The list-returning sweep iterates `rank === "list"` registrations only — a
`rank: "matrix"` entry is outside the pin; none violates today.)

### prepByShape — Argument prep matches the function's shape, not its category **[INFERRED]**
**MUST:** a routed function declares which null/error policy applies — five exist:
**RANGE_RAW** (cells untouched — the COUNT family, which classifies rather than
computes); **RANGE_POSITIONAL** (positions preserved — lookups/index ops);
**RANGE_ZERO_FILL**; **RANGE_PAIRED** (index-aligned pairwise drop) for term-by-term
functions; and the unnamed DEFAULT (pooled — nulls dropped per array) for
aggregators. Position-preserving whole-list natives bypass `prepRangeArgs` entirely
via `takesWholeArgs`.

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

### blockedFailFast — Blocked spellings answer before their arguments are shaped **[INFERRED]**
**MUST:** an eliminated Excel name (D10) resolves to a `#NAME?` redirect naming the
current function, is dropped from autocomplete and highlighting, and gets no range
routing. The blocklist is DERIVED from `LEGACY_ALIASES`, not hand-pruned.

*Enforced by:* `formulaTier1.test.ts` → "the D10 gate covers the WHOLE blocklist, on
every surface (blockedFailFast)" — every blocked spelling answers `#NAME?` naming its replacement,
none is advertised, none is range-routed; `formulaNodeParity.test.ts` → "never advertises
Formula.js internals as formula functions".

### matchNodeLimits — The formula boundary caps what a node's control already bounds **[INFERRED]**
**MUST:** a generator reachable from a formula enforces `MAX_GENERATED` and answers
`#OVERFLOW!` past it, using the shared constant.

*Why:* a node's Count is a spinner the user watches; a formula field is where a typo asks
for ten million elements with nothing visible to stop it.
*Enforced by:* `formulaTier3.test.ts` → "a generator is capped at the formula boundary".

### hideMatrixFromVendor — Formula.js never sees a matrix, or a tagged Cx (D23 containment) **[INFERRED]**
**MUST:** a rank-2 value reaches a dispatch WHOLE only through a registration
declaring `matrixArgs`. Otherwise: a range aggregate FLATTENS row-major before its
1-D prep; a positional lookup or 1-D whole-list native answers `#SHAPE!`; an
element-wise function broadcasts cell-wise, so the fallthrough only ever receives
scalars. The Formula.js fallthrough stays 1-D permanently.
**MUST (the same principle, per element):** a tagged `Cx` reaches a dispatch only
through a registration declaring `cxArgs` (the IM* family, owned over Cx);
everywhere else a complex operand answers a typed `#TYPE!` naming that family.
Exempt: the `NULL_INSPECTING` value-passers (IF hands a complex branch through;
type predicates must SEE it), the `ERROR_HANDLER_FUNCTIONS` (they return before the
Cx gate — a catcher sees its raw operand), and whole-list natives (position-preserving shape
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

### oneBroadcast — One broadcast engine, and the table is the test **[DEFAULT]**
**MUST:** every element-wise surface (operators, unary, percent, function
broadcasting) routes through `mapCells`. The broadcast semantics live in exactly
one normative table (`archive/17-matrix-formulas.md` Part 2), transcribed row-for-row
into `broadcastRules.test.ts` — changing either without the other fails
(`oneMetricImpl`'s pattern applied to semantics rather than a metric).

*Why:* two broadcasters is how the same expression answers differently by surface —
the exact drift class the parity program exists to close.
*Enforced by:* `broadcastRules.test.ts` → "the eleven rows" (the transcription).

### tripwireVendorDrift — A vendored-engine divergence is owned, and tripwired **[INFERRED]**
**MUST:** where Formula.js diverges from Excel, the registered override is the
Excel-correct answer, backed by the same impl as the node (`shareImpl`) — and the divergence
is pinned BIDIRECTIONALLY: the correctness assertion plus a tripwire asserting FX still
answers wrong, so a vendored-engine update that silently changes behaviour fails the
suite and forces a re-evaluation instead of a silent regression (in either direction).

*Enforced by:* `formulaDivergence.test.ts` → "FX still has the sign bug (tripwire —
re-evaluate the override if this fails)" and its siblings. Tripwire TWINS exist for
MOD, ATAN2, TEXT, VALUE (`VALUE("abc")` is `#VALUE!`, not FX's silent 0),
NUMBERVALUE and DOLLAR; the remaining overrides (QUOTIENT, ROUND, RANK, TRIMMEAN,
PERCENTRANK) are pinned in the Excel-correct direction only — their describe titles
record the FX divergence but no twin asserts FX is still wrong.
*Origin:* author-flagged 2026-06-25; recovered from the audit notes after the original
sweep script was lost — which is why the pins live in the suite now.

### oneVerbCorpus — The verb pair computes from ONE fixture corpus **[INFERRED]**
**MUST:**
- Every frame verb both engines speak is specified by cases in
  `fixtures/frame-verbs/` — recorded WIRE payloads (frames + the op in serde's own
  tagged shape), which BOTH runners deserialize with production code
  (`frameVerbCorpus.test.ts` through the oracle, `corpus_cases` in
  `engine/tests.rs` through Polars).
- A verb without corpus cases does not ship: the completeness guard requires a
  fixture file per verb in `FRAME_OP_KINDS` + `BINARY_VERBS` + the `pipeline`
  fixture (sequential-vs-fused parity), and a new `FrameOp`
  kind fails compile before it fails the guard.
- Verbs only ONE side runs are declared, not skipped: an `ORACLE_ONLY_VERBS` entry
  (pivot) makes cargo assert the engine still does NOT parse the op, so the
  exemption self-destructs if the engine ever learns it.
- **MUST NOT** re-encode a case per side — the corpus format IS the wire format; a
  fixture that parses on one side and not the other is itself the parity failure,
  surfacing at load.

*Why:* the two engines were kept in agreement by hand-mirrored test pairs tied
together by comments; nothing failed when a verb, option or edge landed on one
side only — the drift class the whole parity program exists to close, one seam
over. The corpus's first three runs each caught a REAL divergence the pairs had
missed: a silent null column for an unknown agg op (now `#NAME?` both sides),
NaN passing gt/gte under Polars' total float order, and outer-join row order
(never pinned engine-side).
*Enforced by:* `frameVerbCorpus.test.ts` → "corpus completeness — every verb has
a fixture file" (plus the cases themselves and a corpus-wide input-mutation
check) and `engine/tests.rs` `corpus_cases` — CI runs both suites, so a case
passing one engine and failing the other is a red build. Per-cell SolErrors in
an EXPECT frame ride the wire's download form (`{"__err": code}` — the
aggregate guard's verdicts, guarded on BOTH sides since 2026-07-29); uploads
still degrade error cells to null, so input-error PROPAGATION stays pinned
oracle-side in `frameVerbs.test.ts`, marked as such.
*Origin:* bundle 18 (archived: `archive/18-parity-corpus.md`), landed 2026-07-29.

### rowFormulaRefs — In a row formula, a bare name is the WHOLE column; `@` is this row **[INFERRED]**
**MUST:** inside a computed column's inline expression, a bare identifier (or
`[Name]`) resolves to the WHOLE column as a list; `@name` / `@[Name]` / `[@Name]`
resolves to THIS row's cell — Excel's table-reference semantics exactly (D24). λ
PARAMS stay row-bound (the λ is the per-row interface); bare names and @names in a λ
body become capture sockets. The resolution order is fixed: column → `row`/`rows`
builtins → the definition's own env (λ captures) → the surface's side value. A bare
column reaching scalar position is a LOUD per-row `#SHAPE!` that points at `@` —
never a silent per-row identity.

*Why:* the failure mode of any other resolution is a plausible number, not an error:
under row-bound bare names, `revenue / SUM(revenue)` returned `1.0` per row —
`SUM(revenue)` reduced this row's scalar — and nothing anywhere looked wrong. The
mixed-reference cases that forced the Excel model (`SUMIFS(amt, cat, @cat)`,
filter-A-by-this-row's-B) are impossible to spell if one spelling owns both readings.
*Enforced by:* `nodes/computedColumn.test.ts` → "a bare column name is the WHOLE
column — @revenue-style share-of-total works unwired", "a bare column in scalar
position is a LOUD per-row #SHAPE!, pointing at @", "@[Name] is this row, [Name] the
whole column — for names a variable cannot spell", "a bound variable reads its
picked column — whole for expr vars, this-row for λ params (D24)", "a ZERO-param λ
reads the row via @ — capture sockets grow, columns win over them".
*Origin:* D24 (2026-07-30) — the author's Excel-mixing case ruled out the row-bound
default the first cut shipped.

---

# VAL — Value handling

Full spec: `docs/value-semantics.md` (read "Reading an input" before writing any
`data()`). These are the invariants that spec implies.

### unwiredNotBlank — Unwired is not blank **[INFERRED]**
**MUST:** an absent input (`undefined`) falls back to the node's typed literal. A WIRED
blank (`null`) is a real missing VALUE and propagates — it is never swallowed into the
literal.

*Why:* "absent" is not "unknown". Swallowing a wired blank makes a node answer with a
number the user cannot see on the card.
*Enforced by:* `broadcastContract.test.ts` → "readInput — unwired (undefined) vs
wired-missing (null)", "a WIRED null propagates — NOT swallowed into the literal".

### oneErrorKind — One notion of error **[INFERRED]**
**MUST:** failures flow as a tagged `SolError`. `ISERROR` ⟺ `IFERROR`; the `#N/A` test is
centralized as `isNaError`. A bare `NaN` is not an error.

*Enforced by:* `errorValue.test.ts` → "ISERROR (Test) and IFERROR agree: only a tagged
error counts (a bare NaN does not)". (The centralization clause itself is a reading
rule — nothing fails if a second local `#N/A` comparison appears.)

### errorInErrorOut — Error in, error out, without running the node **[INFERRED]**
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
*Exceptions:* ONE node-side declaration, `SEES_ERRORS` (errorValue.ts), holds every
exempt class: error CONSUMERS (IFError, IsTest), lane RELAYS (Conduit, CableSwitch —
the any-error → all-outputs rule would poison sibling lanes), raw READERS (Display,
Note, Report), and the figure SINK (Chart — renders an error input as an empty figure,
never emits a SolError out a `chart` socket). The formula-side consumer set is
`ERROR_HANDLER_FUNCTIONS` (`IFERROR`/`IFNA`/`ISERROR`/`ISERR`/`ISNA`/`ERROR.TYPE`).
All declared, not ad hoc.
**Removed by:** nothing — a catcher that can't see the error can't catch it.

### errorsKeepOrigin — Errors carry provenance **[INFERRED]**
**MUST:** a minted error is tagged with its node, an untagged input error is tagged with
the slot it arrived on, and an existing origin is NEVER overwritten downstream.

*Enforced by:* `errorValue.test.ts` → "SolError origin (provenance Tier 1)", "preserves the
ORIGINAL origin through a downstream passthrough (never overwrites)".

### nullSkippedNotZero — Null is first-class and skipped, not zero **[INFERRED]**
**MUST:** `null` is a real missing value at every rank. Aggregators SKIP it, Filter drops
it, element-wise math PROPAGATES it. Nothing coerces it to 0.

*Enforced by:* `valueKinds.test.ts` → "forAggregate"; `broadcastContract.test.ts` →
"missing cell propagates as null (null + 10 → null)".
*Exceptions:* Coalesce/Fill is the deliberate OPT-IN to treat a null as something —
that is the node's entire purpose. **Removed by:** nothing.

### errorBeatsMissing — Error beats missing at the same cell **[INFERRED]**
**MUST:** where a cell is both, the error is checked first and propagates unmorphed —
never stringified, never `NaN`, never `[object Object]`.

*Enforced by:* `broadcastContract.test.ts` → "error cell propagates UNMORPHED",
"error beats missing at the same cell (error checked first)"; `valueKinds.test.ts` →
"cellShortCircuit".

### kleeneLogic — Logical is a first-class family with Kleene logic **[INFERRED]**
**MUST:** logicals are a real type with three-valued logic (a null operand yields the
Kleene answer, not `false`), and `logical ↔ number` is the one cross-family bridge
(`noAutoCross`).

*Enforced by:* `valueKinds.test.ts` → "Kleene three-valued logic", "logical ↔ number
coercion".

### keyByValue — Membership keys by VALUE, never identity **[INFERRED]**
**MUST:** any set, dedupe, tally or membership test keys through `setKey`. A JS `Set` over
raw values is a defect wherever a value may be an ARRAY.

*Why:* JS Sets/Maps key OBJECTS by reference, so two equal tagged scalars (a complex —
tagSpecialScalars) from different sources never match without a canonical key.
*Enforced by:* `packs/sets.test.ts` covers the PRIMITIVE behaviour ("counts distinct
values in first-seen order", "counts unique values, skipping nulls, propagating errors");
`nodes/list.test.ts` → "complex numbers compare by VALUE, not object identity (Set-node
fix, keyByValue)" puts distinct `[re, im]` instances through Set / IsIn / Tally — reverting a
consumer to a raw `Set` fails it.
*Origin:* a real Set-node bug; `setKey` was introduced to fix it and now lives in
`listOps.ts` for every membership consumer. (An earlier revision of this document
recorded the complex-tuple case as unpinned — the list.test.ts block already covered it;
CONTAINS was the one consumer still comparing by reference, fixed with the review.)

### unitOnValue — The unit is a property of the VALUE **[INFERRED]**
**MUST:** a unit is a base-SI `UnitCell` AUTHORED at the value's ORIGIN — the Format
Controller (`applyFcUnit`), Convert, or a frame column's declared unit spec (a header
spec or the popup's unit picker → `ColumnUnit`, riding onto a computed column exactly
like a Data column). It rides through passthroughs and selectors and BREAKS at any
transform. DOWNSTREAM, an inherited unit is never re-authored: an FC fed a
unit-carrying value MIRRORS it and LOCKS (`unitLocked = lockedByConvert || forwarding`,
D26 — a unit is first-class like the magnitude; a unit change IS a magnitude change,
so it takes Convert, not a dropdown). There is no graph unit-walk for PROPAGATION;
the one sanctioned graph read is Convert-primacy dictation (`refreshAnnotation`),
which sets the FC's own dropdown and never re-tags a value. The Number node is a
plain literal source.

*Enforced by:* `unitCoercion.test.ts` → "Convert primacy on the outgoing value",
"an FC fed by another FC forwards: → → arrows, dropdown mirrors km and LOCKS",
"an FC fed by a Convert forwards the converted unit: → →, mirrors km and LOCKS",
"an FC FEEDING a Convert is dictated its fromUnit: ← ←, locked to m";
`unitWiring.test.ts`, `unitFlowAnnotation.test.ts`.

### perInputUnitBlind — The unit-blind boundary is PER-INPUT **[INFERRED]**
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
algebra identifiers (isUnitCell / dimOf / magnitudeOf / arithmeticCell /
compareUnits / forAggregateUnits / broadcastUnit / anyDimensioned), with a
sanctioned-list honesty check. The matrix-unit family
(matrixUnitOf / carryMatrixUnit / …) is deliberately outside the consuming set: a D20
matrix unit tags the outer array of a bare-number grid and survives the unit-blind
strip, so a unit-blind reshape carrying it is correct.

### unitByGranularity — Units attach at the granularity of homogeneity **[INFERRED]**
**MUST:** per-element `UnitCell` for a list, per-column `ColumnUnit` for a frame, one
homogeneous unit for a matrix (D20).

*Enforced by:* `unitValue.test.ts` → "per-column frame unit", "homogeneous matrix
unit (D20) — one tag on the array, cells stay bare"; `unitColumn.test.ts` (the
frame-column mechanics end to end); `nodes/computedColumn.test.ts` → "a computed
column's UNIT tag rides onto the derived column, like a Data column's", "a computed
column's unit rides through INDEX and LOCKS a downstream FC" (a DERIVED column
carries the same per-column tag, and it survives projection into a scalar
`UnitCell`).

### selectorNamedOp — An op family's selector field is named `op` **[INFERRED]**
**MUST:** a node whose card carries an op dropdown stores it as `op`. Not `dir`, not
`mode`, not `kind`.

*Why:* the declaration mechanism resolves a live node's current op by reading `inst.op`,
so a family that names it otherwise cannot declare its ops AT ALL — its ops become
unsearchable and unmeasurable, silently.
*Enforced by:* `nodeOps.test.ts` → "coverage — every op selector is classified", "no node
with an op dropdown is missing a declaration" — which catches a family that HAS a
declaration. The blindness half (a family that CANNOT declare because its field is
misnamed) is closed by `sourceInvariants.test.ts` → "every non-arg op picker binds `op`":
a source scan over the component sites, where the misnamed field is still visible. The
contract: an op picker either binds `op` (directly, a per-row `.op` config field, or via
`useNodeField(…, "op")`) or carries the `arg` prop — the machine-readable
"not the family op selector" declaration (criterion comparators, payment timing,
config/data picks). `arg` says ONLY that, never "my ops are arguments": op-vs-arg lives
once, in `kind` on the NODE_OPS declaration, so a control bound to the node's own `op`
may not also carry `arg` — a second companion scan ("a control bound to the node's own
`op` never also carries `arg`") forbids the double assertion, which Sort and Drop Blank
Rows were both making when it was added. BOTH picker components are scanned: `OpSelect` (a dropdown) and
`SegToggle` (a segmented toggle — Sparkline's chart type, Surface's view, the resistor's
band count bind `op` there). The toggle was added to the scan on 2026-08-10; until then a
family could carry its op in a toggle bound to `mode` and be invisible to BOTH halves,
since the coverage check skips a node whose `inst.op` is undefined. A third picker
component would reopen that hole — the scan can only look for the names it is given, so
adding one means adding it to `PICKERS`. The recorded borderline (DATEDIF's `unit` selector — an op dropdown
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

### noDataInComponents — Components never call `node.data()` **[DEFAULT]**
**MUST:** a React component extracts a pure helper instead. `data()` assumes the
engine-driven `coerceInputs` wrapper has run.

*Enforced by:* `sourceInvariants.test.ts` → "no component source calls .data(" — a
source scan over `components/`.

### literalsIffEditable — Inline literal maps are declared iff the card edits them **[DEFAULT]**
**MUST:** a class declares `literals` / `stringLiterals` exactly when its card edits those
values inline. Load restores the maps ONLY onto declaring classes, so a save or seed
cannot hardcode a value the user can't see.

*Enforced by:* `coerceInputs.test.ts` → "every catalog node with a typeable list input
declares stringLiterals" — the IF direction, for typeable-list inputs only (the
general declares-iff-edited IF half is by review). BOTH load paths carry the gate
(persistence.ts AND the composite hydrate — the latter was unguarded until the
2026-08-09 audit). The ONLY-IF direction:
`catalogRegistry.test.ts` → "no class declares a literal map its component never edits" —
every declaring class's registered component source must contain an editing surface
(InlineInputs / ExtensibleInputs / a direct `literals` / `stringLiterals` reference), so
a save cannot restore a value onto a card that can never show it.

### tagSpecialScalars — A special scalar is a TAGGED OBJECT, never a bare array **[INFERRED]**
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
*Enforced by:* `complex.test.ts` → "the tagged representation (tagSpecialScalars)" (+ the
family's behaviour through it); the disambiguation sites above DELETE their special
cases, so a regression to bare arrays fails type-check at the `Cx` type itself.
*Origin:* the complex rebrand (2026-07-28). Complex was the only bare-array scalar in
the value model and the sole reason "a cell may be an array" was ever true.

### maxRankMatrix — The rank grammar: nothing nests deeper than a matrix **[INFERRED]**
**MUST:** a runtime value is a primitive scalar, a tagged scalar (`tagSpecialScalars`), a 1-D
`Array` of cells, or a 2-D `Array` of row-`Array`s. Depth 3+ is not a value —
surfaces that meet one answer `#SHAPE!`. `Array.isArray` at two depths is therefore
the COMPLETE rank test, and no code may carry a private shape-sniffing scheme.

*Why:* this is the invariant that made D23 buildable without a branded-value
wrapper; every new nesting scheme would re-open the ambiguity tagSpecialScalars closed.
(Recursion beyond rank 2 is what CUBES are for — a container, not a value shape.)
*Enforced by:* `broadcastRules.test.ts` → "anything deeper than a matrix is
#SHAPE!"; `complex.test.ts` (the tagged-scalar half).

### freezeVolatilePerCalc — A volatile `data()` freezes its roll on the recalc generation **[DEFAULT]**
**MUST:** a node whose `data()` draws randomness caches the draw and re-rolls only when
`getRecalcGen()` changes. Bare `Math.random()` in `data()` re-rolls on EVERY recompute
pass, so any unrelated edit silently changes the value, F9 stops being the thing that
controls re-rolling, and a Monte Carlo built on it is non-reproducible.

*Enforced by:* `sourceInvariants.test.ts` → "every nodes/packs file calling Math.random
references getRecalcGen" — a source scan with a sanctioned list (composite.ts generates
ids, not values). The volatility CLOCK split between the two surfaces is `shareImpl`'s
SHUFFLE exception.

### pickVsAggregateErrors — Positional access filters errors per cell; aggregation propagates whole **[INFERRED]**
**MUST:** a positional lookup (INDEX, XMATCH, MAKEARRAY reads) propagates ONLY the error
of the cell it actually references — an unreferenced error cell elsewhere in the range
must not blanket-error the call. An AGGREGATE over a range containing an error still
propagates it whole (Excel-correct). Both directions are silently wrong when flipped:
blanket-erroring hides a good answer, under-propagating hides a bad one.

*Enforced by:* `errorFiltering.test.ts` → "positional lookups don't blanket-error on
an unreferenced error cell", "an AGGREGATE over an error range still propagates
(Excel-correct)". This is the per-cell refinement of `errorInErrorOut`'s whole-node rule.

### noMixCurrencies — Two different currency codes are incommensurable in EVERY combinator **[INFERRED]**
**MUST:**
- Exchange rates are out of scope, so every currency shares one `currency` axis at
  scale 1: $5 and 5€ store the same base magnitude, and the display CODE is the real
  unit identity.
- Every unit combinator (`arithmeticCell` — all seven ops — `compareUnits`,
  `forAggregateUnits`) refuses two operands carrying different explicit codes with a
  `#UNIT!` ("no exchange rate"). ×/÷ refuse too: division would mint a RATIO, and a
  unitless $/€ number IS a fabricated exchange rate.
- An UNCODED currency cell (a computed result) adopts leniently.
- A new combinator must register in the policy sweep.

*Why:* the check lived in some combinators and not others, and the split was the worst
one possible: the currency-aware copies of +/−/×/÷ were DEAD CODE (also stale — they
lacked the adoption-scaling author call) while the LIVE path answered `$5 + 5€ = $10`
and `$10 ÷ 5€ = 2:1`. Consolidated to one implementation (`arithmeticCell`, moved
rete-free into unitValue.ts) with the guard up front where no op can miss it — declareOnce
applied to an algebra.
*Enforced by:* `unitCurrencyPolicy.test.ts` → "every arithmetic op refuses mismatched
currencies" (the per-op policy table — completeness: every `ArithmeticOp` must
appear), "the non-arithmetic combinators carry the same policy", "completeness — a
new combinator must join this sweep" (a new `*Units` export fails until it joins),
"the formula surface — codes ride the dim pass (the Expression gap, closed)"
(currency codes ride the dimensional pass — `unitDimExpr` `CodeEnv`, supplied by the
Expression AND the Equation from their inputs' display ids — so formula OPERATORS
refuse a mismatch with the same `#UNIT!`), and "the Equation surface — `=` is itself
a combination" (the Equation compares its two sides' RESULT codes via
`dimEvalWithCode`, since no operator inside either side ever sees both). Recorded
limitation: codes drop at function CALLS — `SUM` over two coded inputs still
combines in a formula; the node-side aggregators refuse.
*Origin:* the 2026-07-28 completeness queue ("currency-mismatch across every unit
combinator"); the sweep's first run found the four live wrong answers above.

### classifyNonFinite — No producer emits a bare non-finite; the producer classifies **[INFERRED]**
**MUST:** a computed number never leaves its producing op as bare `NaN`/`±Infinity` —
the producer classifies via `guardFinite` (valueKinds.ts): `NaN` → `#DOMAIN!`; `±Inf`
from all-FINITE inputs → `#OVERFLOW!`; `±Inf` when an input was already infinite PASSES
(the Constant node's ∞ is first-class). Guarded producers: the element-wise broadcasters
(shared.ts), the formula operators (`applyOp`/unary/percent), `broadcastCall`, the
RANGE dispatch, the frame aggregation path (`guardAgg`, frameVerbs) and the native
engine's result normalizer (frameBackend). A kernel with its own recorded non-finite convention (a quiet null, a
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

### plainJsonInit — `extractInit` is a fixed point, and JSON-plain **[INFERRED]**
**MUST:** for every catalog node, `extractInit(new Ctor(extractInit(n)))` equals
`extractInit(n)` — what a save captures, a load re-applies, and the next save re-captures
identically, including non-default booleans and perturbed literal maps. Every captured
value must also survive `JSON.parse(JSON.stringify(…))`: the file path stringifies each
field, so a `Map`/`Set`/class instance/`Infinity` config silently empties in the save
while the live-object fixed point still holds.

*Enforced by:* `persistenceSweep.test.ts` → "persistence fixed-point sweep (every
catalog node)" (with the perturbation sweep and its reasoned `PERTURB_SKIP` list),
"everything extractInit captures survives a JSON round trip".
*Origin:* v1.0 audit finding 38 — a field captured but not re-applied drops on reload
with nothing to catch it.

### saveViaTextForm — The text form is the narrow waist: every `SavedGraph` field, both directions **[INFERRED]**
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

### immutableDocStore — `documentStoreCore` transforms are structurally immutable **[DEFAULT]**
**MUST:** every transform returns a NEW `SolDoc` for each document it changes.
`documentStore.persist()` decides what to write by OBJECT IDENTITY
(`_lastPersisted.get(id) === doc` skips the write), so an in-place mutation still updates
the screen but is silently never persisted — the edit vanishes on the next reload.

*Enforced by:* `documentStoreCore.test.ts` → "immutableDocStore — every transform returns new
objects, never mutates (identity is the persist signal)" — a deep-freeze walk over
every exported transform (a new in-place write throws on the frozen object; a new
export not in the walk fails the completeness check) + the changed-doc-is-a-new-object
identity assertions.

### autosaveSlotOrder — Autosave slots: write the older, read the newer, `seq` first and strictly increasing **[DEFAULT]**
**MUST:** the two-slot autosave pair obeys three laws:
- it always writes the OLDER slot (a crash mid-write can never destroy the only good
  copy) and reads the newer;
- slot `seq` is a strictly-monotonic in-session counter — never a raw clock read
  (same-millisecond writes must not tie);
- `seq` is the FIRST key of every slot payload, because freshness is read with a
  prefix regex, not a parse — a payload with any other key first reads as an EMPTY
  slot and the rotation silently resurrects the older write.

*Enforced by:* `persistenceCore.test.ts` (the rotation algebra);
`documentStorePersist.test.ts` → "every slot payload the STORE wrote is prefix-readable",
"successive writes to one pair carry strictly increasing seq".

### saveBindsMain — Persistence binds MAIN, never the active surface **[DEFAULT]**
**MUST:** the composite drill-in substitutes editor/area/history through the
`activeGraph.ts` seam for CANVAS operations only; `getEditor()`, serialization, autosave
and load resolve the MAIN graph unconditionally. A save taken while drilled in must
serialize the document, not the open subgraph.

*Why:* the failure is total, silent data loss — an autosave during a drill-in would
write the composite's internal subgraph OVER the document, and the file would be valid.
*Enforced by:* `activeGraph.test.ts` → "CARDINAL: getEditor() (persistence source) stays
MAIN even while drilled in" (+ the per-node ownership resolvers).

### classNameIsType — The class name is the persisted type: kept and unique **[DEFAULT]**
**MUST:** `constructor.name` is the `type` written into every save and the
ctor-registry key loads resolve through (plus a dispatch key — `SEES_ERRORS`, group
collapse, pins). Two consequences:
- production builds must keep class names (`keepNames`);
- no two catalog classes may share a name — the registry is first-wins, so the losing
  class's saves would silently reconstruct as the winner (different sockets,
  plausible wiring, wrong computation; the Placeholder path only fires for an ABSENT
  type, and a collision is indistinguishable from a hit).

*Enforced by:* `sourceInvariants.test.ts` → "vite.config.ts and vitest.config.ts both
declare esbuild keepNames"; `catalogRegistry.test.ts` → "no two catalog classes share a
constructor name".

### unknownViaPlaceholder — An unknown node type round-trips losslessly through Placeholder **[INFERRED]**
**MUST:** loading a save with an unregistered type builds a `PlaceholderNode` that
carries the ORIGINAL type, init, literal maps and derived socket keys, and re-saves as
that original type — never as "PlaceholderNode". The whole dormant-pack story rests on
this: open a doc with a pack off, save it, and the pack's nodes must survive intact.
Its outputs emit `#REF!` so the break is LOUD while it lasts, never a silent blank.

*Enforced by:* `nodes/placeholder.test.ts` → "keeps the original type, init, and
literals for a lossless re-save", "emits a #REF! error on every output (the break is
loud, not silent)"; `persistenceCore.test.ts` → "deriveMissingNodeSockets" (cables to
an unknown type derive its socket keys instead of dropping).

### captureBeforeSwap — A canvas-swapping verb captures first and guards the rebuild **[INFERRED]**
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
*Origin:* audit 21p (the race) and 20p (the refused-doc fallback) — recorded in
`sourceInvariants.test.ts`; the store itself carries only the
store's own comments.

### everyFieldClassified — Every node field is persisted or DELIBERATELY transient **[INFERRED]**
**MUST:** every own field of every catalog node is one of: captured by `extractInit`
(the whitelist, the literal maps, or a bespoke extras block), pattern-transient by
naming convention (`cached*` derived display state, `_*` private runtime machinery),
or listed in the `DELIBERATELY_TRANSIENT` map with the reason it must NOT persist.
A field in none of these is an unmade author decision, and the sweep fails by name.

*Why:* the fixed-point sweep (`plainJsonInit`) proves whitelisted fields round-trip but is
BLIND to a field the whitelist never captured — both sides omit it identically, so the
test passes while the user's setting silently resets on every reload.
*Enforced by:* `persistenceSweep.test.ts` → "everyFieldClassified" — the catalog-wide field
classification, the no-double-claim + stale-entry honesty checks, and the found-bug pin.
*Origin:* the 2026-07-28 triage over all 169 unclassified fields found ONE real bug:
`asofDirection`, an as-of join's user-facing direction dropdown that reset to
"backward" on every save/reload/paste — invisible to plainJsonInit precisely because the
whitelist never saw it. Now whitelisted, pinned.

### observerOwnsSize — `width`/`height` ownership: the observer owns them; size-owners re-consume **[INFERRED]**
**MUST:** `node.width`/`height` are a MEASUREMENT MIRROR — NodeCard's ResizeObserver
overwrites both with rendered pixels every layout (minimap silhouette + cable geometry
read them). Consequences:
- they persist for every node, but only the declared SIZE-OWNER classes (user-dragged
  surfaces: the annotation frames, the composite card, groups, the overlay hosts)
  re-consume `init.width/height`; for everyone else the persisted values are inert
  and the class default + re-measure win;
- a class with a USER size gesture must either re-consume the init or route through
  `nodeSizeStore` (Display's grip — its own persisted channel, `sn.size`);
- nothing else may start consuming the init.

*Why:* dual-use fields drift silently in both directions — a new resizable class that
forgets to re-consume loses the user's drag on reload (the `asofDirection` class of
bug), and a compute class that starts consuming freezes a measured size into layout.
*Enforced by:* `persistenceSweep.test.ts` → "observerOwnsSize" — a behaviour probe
(`new Ctor({width: 777, height: 555})`) over the whole catalog, compared against the
declared owner set in both directions.

---

# ENGINE — Recompute passes

The engine's one observable contract: however a recompute is triggered — full pass,
targeted cone, manual mode, a live-data refresh — the values on screen are the ones a
full clean pass would produce. Every rule here is an equivalence, and every failure
mode is a STALE value standing next to fresh ones with nothing marking it.

### targetedEqualsFull — The targeted pass is observationally equal to the full pass **[INFERRED]**
**MUST:** `downstreamClosure(editor, startId)` equals exactly the set a full pass would
recompute differently — the start node and every transitive dependent, across branches
and joins, terminating on cycles. No more (wasted work is the cheap half) and no less —
a node outside the cone keeps displaying its previous answer with no error. Cycle
handling matches too: the targeted path seeds `#CIRC!` on exactly the SCC members,
like the full pass, instead of recursing to a RangeError.

*Enforced by:* `processTargeted.test.ts` → "downstreamClosure (targeted recompute
cone)" (the closure across branches/joins/cycles); `circularReset.test.ts` →
"closing a cycle with a live cable (targeted topology pass)" (yields `#CIRC!` on the
loop members — audit finding 40, with the rete-engine 2.1.1 recursion bug in the
record).

### onlyCalcModeSkips — The calc-mode gate is the ONLY thing that skips a pass **[INFERRED]**
**MUST:** mode (manual/auto/sketch) × dirty is a real transition matrix: manual mode
marks dirty instead of computing; switching to auto or sketch clears the pending flag
directly and the CALLER owes the catch-up recompute (the store never runs a pass);
an unavailable localStorage degrades to in-memory state — never to a graph that
silently stops recomputing.

*Enforced by:* `calcModeStore.test.ts` → "switching to auto clears a pending dirty
flag (the caller recomputes)", "notifies subscribers on every mode/dirty transition,
and only then", "survives a missing localStorage (the vitest env is node — persist
must not throw)".
*Origin:* shipped in 1.0 with zero direct coverage (v1.0 audit, quality) — the
"silently stops recomputing" failure is invisible by construction.

### refreshOutsideRebuild — A live-data refresh never runs inside a rebuild scope **[INFERRED]**
**MUST:** `refreshConnection` (the manual button and the interval timer) drives its
recompute OUTSIDE `beginGraphRebuild`/`endGraphRebuild`. (Bulk TOPOLOGY operations —
load, paste, undo/redo, composite create/unpack, sweeps — wrap rebuild scopes
deliberately; the rule binds the REFRESH path, which must never be one of them.) A refresh that lands inside a rebuild scope silently swallows the
edge-detection downstream: an Alert watching refreshed live data simply stops firing.

*Enforced by:* `connectionStore.test.ts` → "refreshConnection never enters a
graph-rebuild scope (the only thing that would silently suppress a fire)" + the
rising-edge-through-refresh case. Pairs with `effectsEdgeTriggered` (the suppression this rule
keeps refreshes OUT of is the one loads must stay IN).

---

# EFFECT — External effects

When a node is allowed to do something to the world. The failure modes are inverted
twins: an effect that fires when it shouldn't (a load writes your disk) and an effect
that silently never fires (an alert that misses its edge is a non-event with no
appearance).

### sinkRunButtonOnly — A sink acts only from its Run button, and always loads disarmed **[DEFAULT]**
**MUST:** a node with an irreversible external effect (disk write) never acts from
`data()` — `data()` caches for preview only; the effect lives in `run()`, fired only by
the node's Run button, behind an `enabled` arm flag. The arm flag NEVER persists: it is
excluded from the `extractInit` whitelist so every load path (save reopen, paste,
placeholder restore) starts disarmed — opening a shared file can never write to your
disk.

*Enforced by:* `nodes/sink.test.ts`, `nodes/obsidian.test.ts` (the two families'
behaviour: data() never touches disk, run() gates on the arm, atomic tmp+rename);
`catalogRegistry.test.ts` → "no catalog class persists an `enabled` arm flag, and none
constructs armed" (the catalog-wide quantifier); `sourceInvariants.test.ts` →
"sinkRunButtonOnly — data() never touches disk" (the completeness half: brace-matches every
data() body in nodes/+packs and refuses the write APIs — and `this.run(` in any
file that touches one — with a stays-honest check on the API-name list).

### effectsEdgeTriggered — An outward effect is edge-triggered, and suppressed during rebuild **[INFERRED]**
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

### storesRegisterForget — A node-keyed store registers forget AND forgetAll **[INFERRED]**
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
*Enforced by:* `sourceInvariants.test.ts` → "storesRegisterForget" — every `*Store*.ts` references
the registry or is sanctioned with its reason; every registrant also registers the
bulk reset; the sanctioned list is honesty-checked.
*Origin:* the 2026-07-28 completeness queue ("formatAnnotationStore and standoffs
register neither"); the sweep found dockedNodeStore, compositeStaleStore and
isolateStore missing too.

# Enforcement summary

74 rules.

| Status | Count | Rules |
|---|---|---|
| Enforced | 72 | every rule except the two below |
| Partially enforced | 1 | socketBox12 |
| Unenforced | 1 | oneResolvePredicate |

**The ORIGINAL partially-enforced six all closed**, and sinkRunButtonOnly (which arrived later
with its own domain) closed 2026-07-29 — its data()-never-writes half was per-class
until the sourceInvariants sweep. The original six were the
highest-value gap: in each, the rule was tested for the cases that existed and nothing
failed when a NEW case forgot it — precisely the shape of every bug in the Origin notes.
Two of them (adoptKeepsCables, keyByValue) had been written here as "enforced" on the strength of a
plausible-sounding test file name, and only turned out to be partial because the
enforcement column forced the check. That is the argument for the column. Closed across
the 2026-07-28 passes: adoptKeepsCables (persistence pin), retypeReconciles and noDataInComponents (source scans in
`sourceInvariants.test.ts`), the selectorNamedOp renames + the uniqueNameMap full naming sweep, then the
completeness tranche — perInputUnitBlind (algebra-file scan), selectorNamedOp's blindness (the OpSelect
binding scan + the `arg` contract), literalsIffEditable's only-if (declaring class ⇒ editing
component). oneResolvePredicate was attempted and recorded as genuinely un-greppable (see the rule).

---

# Known violations

The live list of recorded-not-fixed gaps against the rules above. Delete an entry
when it closes (the closures through 2026-07-29 — renames, completeness tranches,
the citation conversion — are in git history and the dev-notes archive).

1. **Citation coverage is mixed (recounted 2026-08-09).** 122 quoted citations
   (the suite → "test name" arrow form) are machine-checked by `rules.test.ts`.
   21 BARE test-suite citations across 20 rules remain reading-verified only
   (the 2026-07-29 read stands; convert opportunistically). Two rules cite an
   implementation MODULE and no suite: oneMetricImpl (enforcement is a shared import —
   `measureParity` into both the report script and the ratchet test, a
   structural fact no test-name quote can express) and oneThingPerMetric (guarded only by
   the ratchet's numbers moving). New rules should quote their describe/it
   names, which buys the machine check for free.
