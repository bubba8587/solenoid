# Type resolution & the coercion boundary — consolidation plan

**Live working doc.** Opened 2026-07-25 after the author's call: *"it seems like our systems
have become very convoluted."* A read-only audit of the wildcard ladder + the coercion
boundary followed. This records the MAP, the TARGET, and the work items, so the effort
survives across sessions and nothing gets dropped between them.

**STATUS 2026-07-25: all five work items are DONE.** What remains is the parking lot at
the bottom — bugs found during the audit whose solution wasn't clear. Move this doc to
`archive/` once those are resolved or explicitly parked. The "Current state" section below
is the AUDIT-TIME snapshot, kept as the before-picture; the item notes record what changed.

---

## Why this exists

Nothing here is a bad line of code. The problem is that **four or five subsystems each
independently answer the same question** — *"what type does this output actually carry?"* —
and they have drifted apart. That drift is invisible from any single `data()`, which is why
the two bugs that prompted this (a Bool list reading as numeric; YEAR emitting a 1-element
list) each took a long trace through nodes that all turned out to be individually correct.

The lesson worth keeping: **when a shape or type looks wrong, read the boundary
(`coerceInputs`) and the resolvers before reading any node's `data()`.**

---

## Current state (verified 2026-07-25, not from memory)

### The five graph walks

| Walk | File | Lines | Resolves | Reads `passthrough()` |
|---|---|---|---|---|
| `reconcileTrueAnyTypes` / `settleWildcardTypes` | `trueAnyAdopt.ts` | 139 | socket TYPE (writes it) | yes |
| ~~`displayedType`~~ | `components/valueDisplayFormat.ts` | — | **reads the socket now** (item 5) | n/a |
| `conduitPath` | `conduitTrace.ts` | 184 | conduit lane type/route | partial |
| `makeAnnotationResolver` | `unitFlow.ts` | 268 | FC annotation + units | yes |
| `makeFrameShapeResolver` | `frameShapeResolver.ts` | 174 | frame column shape | **no** |

`coerceInputs.ts` (430) and `sockets.ts` (489) sit under all of them.

### The wildcard ladder

`any` (rank 0) → `anylist` (1) → `anytable` (2), with `trueany` as the supremum (D17/D18).
Adoption (`AdoptiveSocket`) mutates a port's type to the wired cable's, reverting on
disconnect; never persisted, re-derived after load/paste.

Two projection helpers, ~8 lines each, near-identical with subtly different tie-breaks:
`adoptTypeForBase` (input side; a higher-rank wire keeps its own type) and
`projectTypeToBase` (output side; clamps in BOTH directions, and a family-less type reverts
to the base).

### The coercion boundary

`coerceValue` is a 20-case switch. Four separate opt-outs sit on top of it:

| Knob | Users | What it skips |
|---|---|---|
| `rawInputs` | 3 | all coercion (node branches on runtime shape) |
| ~~`noWidenInputs`~~ | ~~1 (Expression)~~ | **deleted by item 3** — the `anycombo` rung says it |
| `unitAware` | 10 files | the unit-strip, on every input |
| `passthrough()` spec inputs | many | the unit-strip, per named input |

### Measured dead weight

| Export | Uses in `src` | Note |
|---|---|---|
| `staticTrueAnyIn` (`shared.ts:46`) | **0** | never had one |
| `anyListOut` (`shared.ts:57`) | **0** | superseded by `adoptiveListOut` (15 uses) |
| `anyTableOut` (`shared.ts:64`) | **0** | superseded by `adoptiveTableOut` (6 uses) |
| `anyOut` | 1 (Regex) | the `anycombo` hole, output side |
| `staticTrueAnyOut` | 1 (XLOOKUP) | the last genuinely-static output |

---

## Desired end state

**One declaration. One resolver. One boundary. A complete ladder.**

1. **One declaration.** `passthrough()` stays the ONLY place a node states how its output
   relates to its inputs — including `project` for an EXTRACTION (INDEX). A new
   type-agnostic node is one method, and no resolver needs editing.

2. **One resolver.** Adoption computes the concrete type and WRITES it to the socket.
   Every consumer — display, units, conduit trace, frame shape — READS the socket. No
   consumer re-walks the graph to re-derive what adoption already computed.
   **Corollary, and this is the part that's broken today:** when adoption says `trueany`
   it means *genuinely unknown*, and every consumer must honour that rather than
   substituting a guess of its own.

3. **One boundary, uniform.** `coerceValue` keys off ONE type per input — the declared
   base, uniformly, with no adopted-vs-base split — and its rank rules (widen a scalar
   into a list rung, collapse a singleton at a rank-0-capable rung) derive from the rung
   rather than being hand-written per type where that's avoidable.

4. **A complete ladder where every rung earns its place:**
   `any` (0) → **`anycombo` (0-or-1)** → `anylist` (1) → `anytable` (2) → `trueany` (⊤).
   With `anycombo` present, `noWidenInputs` has no remaining user and goes away.

---

## Work items — do these INDIVIDUALLY, one commit each

- [x] **1. Fix the IF display bug.** DONE 2026-07-25. `displayedType` now runs the SAME
  `resolvePassthroughType` + `agreeTypes` the adoption pass runs, instead of a hand-rolled
  loop over every incoming connection returning the first non-wildcard type. Two bugs
  closed: the disagreeing-selector one (Bug A), and a latent one where a SIDE input (an
  Expect's `min`) could supply the display type because the loop didn't consult the spec's
  value branches. `agree` moved from `trueAnyAdopt.ts` to `passthrough.ts` as `agreeTypes`
  so there is one combine rule. Item 5 can now delete the walk outright rather than
  reconcile two rules.
- [x] **2. Delete the dead exports.** DONE 2026-07-25. `staticTrueAnyIn`, `anyListOut`,
  `anyTableOut` — plus the `anyListSocket` SINGLETON, which the first three were the last
  users of. The `anylist` TYPE is very much alive (19 adoptive ports); it was the shared
  non-adoptive INSTANCE that had been orphaned by the 2026-07-15 adoptive migration, and
  leaving it was a trap: constructing a port from it would silently opt that port out of
  adoption. `staticTrueAnyOut` (XLOOKUP's, the last genuinely-static output) gained a
  doc comment saying when to reach for it versus `trueAnyOut` + `project`.
- [x] **3. Add the `anycombo` rung.** DONE 2026-07-25 (author approved the trade). The
  element-agnostic COMBO: accepts exactly what `anylist` accepts, but a scalar reaches
  `data()` as a SCALAR, and its OUTPUT may be a scalar so it also reaches a scalar input.
  Retired **`noWidenInputs`** (Expression's variables declare `anycombo` — the socket now
  states what a node used to override) and **`anyOut`** (Regex drew a scalar CIRCLE on a
  port that can spill a list; both factories are gone). Glyph: a gray split square whose
  lower half is the fill's systematic `-ring` shade — the gray family distinguishes rungs
  by SHAPE, so a [gray, gray] split would have been indistinguishable from `anylist`
  (DESIGN.md's Sibling Rule: a darker shade, never a new hue). D18 amended.
  Two things the machinery caught, worth noting as evidence the guards work: tsc proved
  two of my new `accepts()` branches UNREACHABLE (the single `outT === "anycombo"` rule
  already covered the 2-D containers), and `formatModel.test.ts`'s exhaustive
  `Record<SocketDataType, …>` forced an explicit FC-family decision for the new rung
  (`none`, like `anylist`) instead of letting it default silently.
- [x] **4. Normalize `coercionType`.** DONE 2026-07-25. One line, no exception: every
  adoptive port coerces on its BASE. The container rungs are unchanged (a scalar still
  widens into an `anylist` op); `trueany` now coerces to NOTHING, which is the honest
  reading of a port declaring it handles any shape — and all 19 of them are passthroughs,
  selectors, container builders or inspectors, i.e. nodes that branch on raw shape anyway.
  **Why it was safe:** the adopted type IS the upstream socket's type, so
  `coerceValue(adopted, value)` was coercing a value to the type it already had — identity
  in every correct case. It only did anything when a producer's declared type and its
  runtime value DISAGREED, and then it silently laundered the mismatch at every consumer.
  Removing it is a deliberate trade: a producer emitting the wrong shape for its socket is
  now VISIBLE instead of quietly corrected, which is the point of the whole effort.
  **What it fixed:** the same class of bug as the reported YEAR one — with `datelist`
  adopted, a scalar into INDEX was laundered to `[scalar]`, so `INDEX([all])` handed back
  a list of one where a scalar went in. Pinned. **Bug D is closed by this.**
- [x] **5. Fold `displayedType` into adoption.** DONE 2026-07-25. The graph walk is
  DELETED — `displayedType` now just reads the output socket (`outKey` still names WHICH
  socket on a multi-output card; it never traverses). Adoption already computes the answer
  and writes it there, so the walk was a second opinion on a settled question, and the
  one place it differed it was WRONG (item 1's IF bug).
  **The precondition is now machine-checked** by the new `passthroughOutputMutable.test.ts`:
  every passthrough whose output is a WILDCARD carries a MutableSocket, so adoption can
  write to it. (`reconcileOnce` skips a non-mutable socket silently — it would compute the
  type and throw it away, and nothing would error; the dot would just never colour.) The
  sweep found exactly one node with a concrete passthrough output — Fill/Coalesce, which is
  numeric throughout and declares `passthrough()` purely so UNITS ride across it — so the
  invariant is stated as "wildcard ⇒ mutable", not "always mutable".
  **What this exposed:** three display tests, one of them PRE-EXISTING, never ran
  `settleWildcardTypes` and so were exercising the walk rather than the shipped path. They
  now call it, exactly as `reconcileFcTypes` does on every connection change. Same smell
  the List Input audit recorded for `wrapNodeData`: a test that skips the boundary isn't
  testing what ships. Worth remembering that deleting redundant machinery is how you find
  tests that were quietly depending on it.
  Net: valueDisplayFormat.ts −51/+22 lines, and the walk count drops from five to four.

---

## Parking lot — found during the audit, solution not yet clear

### ~~Bug A~~ — FIXED 2026-07-25 by item 1; the open question below survives it
**Verified live at the time.** With a `date` on `then` and a `number` on `else`: adoption correctly
leaves the socket `trueany`; `displayedType` returns `date` (first connection wins,
`valueDisplayFormat.ts:148`). That feeds `nodeOutputIsDate` → `dateFormatDisplay`, so a
number flowing out the else-branch renders as `20-Mar-2026`. A wrong VALUE on screen, not
a tint.
**Still open after the fix:** display now honours adoption and falls back to raw numbers,
which is correct but loses date formatting in the common case where the branches agree at
RUNTIME while disagreeing statically (an IF picking between a date and a `#N/A` fallback,
say). A data-aware read — `selected()`, which IF already tracks for units — is the likely
answer, and would let display follow the branch actually taken. Not attempted: it makes
display depend on computed state, so it needs a decision about re-render timing.

### Bug B — `frameShapeResolver` doesn't read `passthrough()`
It is the one walk that never consults the declaration, so a frame routed through a
Display / IF / Expect loses static column-shape resolution (the shape row in the Cable
Inspector goes blank). Unconfirmed whether that's deliberate — it may predate the 2026-07-15
unification. **Needs:** confirm the symptom, then decide whether shape belongs in the
unified resolver (item 5) or stays separate because it propagates FORWARD from sources
rather than backward from a consumer.

### Bug C — the two projection helpers can disagree
`adoptTypeForBase` and `projectTypeToBase` both project a type onto a base's rank with
different tie-breaks (see Current state). No known bug, but nothing forces them to stay
consistent, and a rank-crossing reshape reads its type through BOTH on a round trip.
**Needs:** a property test asserting they agree wherever both apply, or a merge into one
function with an explicit direction flag.

### ~~Bug D~~ — FIXED 2026-07-25 by item 4
Because `coercionType` reads the ADOPTED type for a `trueany`-based input (item 4), an
input's runtime coercion shape depends on what happens to be wired upstream — state that
is re-derived after every load/paste and never persisted. No live bug found, but this is
the mechanism that made the YEAR shape bug invisible from every `data()`. Item 4 removes
it; recorded here in case item 4 turns out to be too risky and the hazard has to be
documented instead.

---

## Ground rules for this effort

- Every item lands with tsc clean and the full suite green, and its own commit.
- No item may quietly widen: if a fix needs a decision the author hasn't made, it comes
  back here as a parking-lot entry rather than being guessed at.
- `decisions.md` gets an amendment whenever an item changes a recorded ruling (D17/D18
  are the ones in range).


---

## Scoreboard (what the five items actually moved)

**Deleted:** `noWidenInputs` · `anyOut` · `anyListOut` · `anyTableOut` · `staticTrueAnyIn` ·
`anyListSocket` · the duplicate `agree` · the adopted-vs-base coercion exception ·
`displayedType`'s graph walk.

**Added:** the `anycombo` rung (a deliberate trade — a socket type for a flag) ·
`agreeTypes` (shared) · `project` on `PassthroughSpec` · `comboOfType` ·
`passthroughOutputMutable.test.ts` (the guard that makes "adoption is the resolver" hold).

**Bugs closed:** an `IF` over a date and a number rendering the number as a date · an
Expect's side input supplying the display type · Bug D (coercion depending on derived
adopted state) · a second YEAR-class laundering (a scalar into INDEX becoming a
1-element list) · Regex drawing a scalar circle on a port that spills lists.

**Target-state progress:** *one declaration* ✅ (`passthrough()`, now with `project`) ·
*one resolver* ✅ (adoption writes, everything reads — walks 5 → 4) · *one boundary* ✅
(uniform base coercion; the singleton-collapse rule derives from the rung) ·
*complete ladder* ✅ (`any` → `anycombo` → `anylist` → `anytable` → `trueany`).

The four remaining walks are `reconcileTrueAnyTypes` (the resolver — correct), plus
`conduitPath`, `makeAnnotationResolver` and `makeFrameShapeResolver`, which resolve
DIFFERENT things (route, annotation, column shape) rather than duplicating type
resolution. Bug B below is the one that may still be a genuine duplicate.
