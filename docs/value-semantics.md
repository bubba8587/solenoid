# Value semantics — null, NaN, Infinity, and errors, across every domain

The one-stop spec for the value model's special kinds: what each one MEANS, what
produces it, how it propagates through each computation context, and how it renders.
Consolidates the 2026-06-22 array-semantics build (decision arraySemantics) and the 2026-07-02
step-by-step rulings (decisions currentExcelParity–consistencyOverQuirks), all shipped by the 2026-07-04/05 tail
pass. Mechanics/invariants live in `subsystem-invariants.md` "Error values"; this
doc is the SEMANTICS reference.

**Status honesty:** every rule below is **[shipped]** — the core set as of the
2026-07-04/05 1.0-tail build pass (broadcaster contract, guardFinite/#OVERFLOW!,
NaN affordance, readInput, IFS/SWITCH #N/A), the computed-column rules as of the
2026-07-30/31 tableRefSemantics–firstClassUnits run. If a new rule is decided-but-unbuilt, tag it
`[decided <date>]` and carry the build item in the backlog.

## The kinds

| Kind | Meaning | It is… |
|---|---|---|
| value | a real number/string/date/logical/complex | the normal case |
| `null` | **missing** — no value was ever there | data, not a failure |
| `SolError` | **failure** — a computation could not answer (tagged code, 15 incl. `#OVERFLOW!` and the internal `#ERROR!` catch-all) | loud until caught |
| `NaN` | **undefined number that leaked** — not an error, not missing | residue; computation may not produce it (guardFinite) [shipped] |
| `Infinity` | **definable infinity** — deliberately declared (Constant node) or derived from an infinite input | a first-class value [shipped] |

A **complex** value is the tagged object `{ __cx: true, re, im }` (tagSpecialScalars) — never a
bare `[re, im]` array. `Array.isArray` therefore never means "a complex number": an
array is a 1-D list, or a matrix when its own elements are arrays (rank 2 is live
since matricesInFormulas); `isCx` (`nodes/complex.ts`) is the one complex test.

The load-bearing distinctions:

- **null vs error**: a blank cell is *data you don't have*; an error is *an answer that
  failed*. Aggregators skip null but propagate errors; Filter drops null-predicate rows;
  Fill/Coalesce recovers null, IFERROR/IFNA recovers errors. The detect/recover 2×2:
  ISNULL / ISERROR / ISNA × Fill/Coalesce / IFERROR / IFNA. **[shipped]**
- **NaN vs `#N/A`**: unrelated, despite the letters. `#N/A` is a real tagged error
  ("no result exists"), minted by XLOOKUP not-found, the NA node, and IFS/SWITCH
  no-match [shipped]; IFNA catches it. NaN is IEEE float residue with no
  special status (the finding-13 settlement) — IFNA does NOT catch it, and it must
  never render as "N/A" [shipped: renders `NaN` with a muted-chip affordance].
- **Infinity vs overflow**: `10^400` is a really big *number* the app can't represent —
  that's `#OVERFLOW!`, not infinity. Infinity is only ever deliberate. [shipped]

## Production rules — where each kind comes from

- **Errors mint at the failure site, with the specific code**: `#DIV/0!` at the divide,
  `#DOMAIN!` at sqrt/log/pow domain failures, `#N/A` at not-found/no-match, `#SHAPE!`
  at coercion and per row in a computed column (a list-shaped cell result, or an
  `@`-read of a mis-sized list — the DESIGNED loud failure for a bare column name in
  scalar position, tableRefSemantics), `#CIRC!` at engine-cache seeding, `#OVERFLOW!` at
  representation overflow [decided]. Never a raw NaN as a failure signal.
- **Fill's unwired pad is `null`** (first-class missing — author 2026-07-16), NOT
  Excel's `#N/A` for EXPAND's omitted `pad_with`: wire the NA node into Fill to get
  Excel's form (`nodes/matrix.ts`).
- **The non-finite guard** (`guardFinite`, valueKinds.ts) [shipped]:
  for any numeric op — result `NaN` → `#DOMAIN!` (indeterminate: `(-8)^(1/3)`, `∞−∞`,
  `∞/∞`, `0×∞`, or a NaN input entering the op); result `±Inf` from all-FINITE inputs →
  `#OVERFLOW!`; result `±Inf` with an infinite input → passes through (definable).
  Consequence: computation cannot PRODUCE NaN — the remaining NaN sources are all
  data-entry (dirty imported data, an unparseable typed cell via `coerceFrameCell`)
  plus one BUG CLASS: a `UnitCell` that escapes the unit-blind boundary reaches
  `coerceNumber` as NaN (the 2026-07-13 regression `stripUnitCells` exists to
  prevent).
- **null** comes from data (blank cells, CSV holes), from ragged-list padding
  [shipped 2026-07-02], from empty aggregations (`AVG([])`), and from Kleene logic
  that genuinely cannot answer.

## Propagation — by computation context

Which rule applies is decided by the CONTEXT, not the function's name. The contexts:

| Context | Error | null | Where |
|---|---|---|---|
| **Element-wise numeric** (operators, mapped functions) | propagates UNMORPHED, per cell, first-in-arg-order | propagates (`null+5` = `null` — the SQL model, NOT Excel's blank-as-0) | shared broadcasters (`broadcast`/`broadcastErr`/`broadcastCall`) [shipped] |
| **Element-wise logical** (Comparison, BooleanOp, IF, NOT) | propagates unmorphed [shipped] | goes INTO Kleene — `FALSE AND null` = FALSE, `TRUE AND null` = null | `broadcastEl`; Kleene tables in `valueKinds.ts` [shipped] |
| **Reduction / aggregate** (SUM, AVG, formula AND/OR, Aggregate node) | propagates (first error wins) | SKIPPED (Excel range semantics, SQL aggregates) | `forAggregate`, `prepRangeArgs` [shipped] |
| **Paired / index-aligned** (SUMPRODUCT, CORREL, SUMIF…) | propagates | a null in ANY range drops that whole row pairwise; ragged ranges keep the min-length zip (pad-then-drop ≡ truncate) | `RANGE_PAIRED` [shipped] |
| **Positional lookups** (XLOOKUP, XMATCH, INDEX) | propagates | nulls STAY PUT (dropping would shift indices) | `RANGE_POSITIONAL` [shipped] |
| **COUNT family** | classified, not propagated (COUNT skips, COUNTA counts) | COUNTBLANK counts them | `RANGE_RAW` [shipped] |
| **Ragged element-wise zip** | — | pad-to-longest with null; a padded position is missing | all broadcasters [shipped 2026-07-02] |
| **Computed column (per row)** | a ROW-bound error cell (λ param / `@`-read) fails THAT row only; an error inside a whole-column binding flows into the formula, where the aggregate's own rule applies | flows in (ISBLANK sees it); a result of `undefined` reads as blank | `computedColumnCore.ts` `tagComputedCell` (tableRefSemantics; one definition per column, noPerCellFormulas) [shipped] |

The sanctioned divergence (decision oneAnswerOneDivergence): formula `AND(x)` is a *reduction* (nulls
skipped → Excel behavior); the BooleanOp node is *element-wise* (Kleene). Same word,
two contexts, both correct. Any OTHER node-vs-formula disagreement is a bug.

### Scalar operators — the P6 operator-parity table (settled 2026-06-22; shipped at the v1.0 audit, finding 26)

`applyOp` (`excelFormula.ts`). Type-honest: match Excel where sane, diverge where
Excel is incoherent.

- A per-cell error propagates UNMORPHED (broadcast elements reach the operator raw).
- `null` propagates through arithmetic, comparison and `&` (the SQL/pandas/Polars
  model — `null+5` is null, not 5).
- Logicals ride the number bridge in numeric contexts (TRUE = 1).
- `=` / `<>` are TYPE-STRICT with case-INSENSITIVE text (EXACT is the case-sensitive
  escape hatch): `"a" = "A"` is TRUE, `5 = "5"` is FALSE.
- Ordering (`<` `>` `<=` `>=`): numbers numerically, text by dictionary collation,
  CROSS-TYPE → `#TYPE!` (no invented number<text<logical order, no NaN-false).
- `&` renders logicals TRUE/FALSE (not JS "true").

**IF honors a BLANK branch** (the parser's omitted-argument form `IF(x,,y)`): the
blank arrives as null and STAYS null — Solenoid's first-class missing — a deliberate
Excel deviation (Excel's omitted arg IS 0; author chose null, 2026-07-16). Arg-count
defaults keep Excel's shape: `IF(test, then)` with a false test → FALSE.

## Reading an input — a WIRED blank vs the TYPED literal

The table above says how a missing value behaves once it is inside a computation. This
says how it gets there, which is a separate decision every node makes and got wrong for
a long time. **Target this section when writing a new node.**

(There is a SECOND way a value enters a computation since tableRefSemantics — a formula-level
reference resolved against a computed column's row context, not a socket. Its rules
live with the core: precedence is column → `row`/`rows` builtins → the definition's
own env (λ captures) → the surface's side value (`computedColumnCore.ts`); a
reference used outside a row context is a targeted `#REF!`, not `#NAME?`. One trap
for a NEW surface: the core's default when no `sideValue` hook is supplied is `0` —
Frame Input deliberately overrides it with `#REF!`; a surface that forgets the hook
gets a silent zero, the exact confidently-wrong-answer failure this section exists
to prevent.)

### The one rule

Most inputs are BOTH a socket and a field on the card. Read them with `readInput`
(`nodes/shared.ts`):

```ts
const n = readInput(inputs.count, this.literals.count ?? 1);
```

- The slot is **UNWIRED** (`undefined`) → the typed literal. The field on the card is
  the value.
- The slot is **WIRED** → the cable's value wins, **even when it is `null`**. A blank you
  deliberately wired is a fact about the data, not an absence of input.

**Never `inputs.x?.[0] ?? this.literals.x`.** `??` cannot tell "no cable" from "a cable
carrying blank", so it silently substitutes the card's value for the graph's answer —
returning a number the user never asked for and cannot see the origin of. This is the
single most common way a Solenoid node has produced a confidently wrong answer.
`nodes/readInputSweep.test.ts` ratchets the remaining occurrences down and fails on new
ones.

**A WILDCARD slot's literal lives in one of TWO maps.** A slot typed `any`/`trueany` is
element-agnostic, so its typed literal may be a number (`literals`) or text
(`stringLiterals`) — the inline field writes exactly one and clears the other, so the
reader never breaks a tie. Only a node that declares `autoLiterals = true` gets that
field (the value selectors IF/IFS/SWITCH/CHOOSE, whose wildcard rows are value
branches); a wildcard SINK or relay — Display, Cast, Report, Cube — leaves it off and
stays wire-only. The unwired-vs-wired rule above is unchanged; it just reads both maps
(`pickSlot` in `nodes/logic.ts`).

### What a wired blank DOES, by the input's role

Reading the input correctly is half of it; the other half is what the node then does.
Decide by the input's ROLE, not by its type:

| The input is… | A wired blank means | So the node… | Example |
|---|---|---|---|
| an **operand** — the value being computed on | this element is unknown | **PROPAGATES**: blank in, blank out, per cell | `UPPER(blank)` → blank |
| a **mode selector** — basis, delimiter, pattern, weekend code | the mode is unknown | **PROPAGATES** — an unknown rule gives an unknown answer | `TEXTSPLIT(x, blank)` → blank |
| a **shape** — rows, cols, count, wrap width | the result's shape is unknown | **PROPAGATES** | `MAKEARRAY(blank, 3)` → blank |
| a **member of a reduction** — CONCAT's rows, SUM's inputs | one contributor is missing | **SKIPS it**, as SUM skips nulls | `CONCAT(blank, "b")` → `"b"` |
| a **check's parameter** — Expect's bound or pattern | that check cannot be EVALUATED | **skips THAT CHECK** and passes the data through | Expect keeps flowing, reports no violation |
| a **control's bound** — Slider min/max/step | the control still has to work | **falls back to the card's own value** | Slider keeps clamping to its typed bound |
| a **column reference** — which column to sort/group/split/look up by | the target is unknown | **PROPAGATES** — a blank frame out, NOT the frame unchanged | Frame Sort, Get Column, XLOOKUP |
| a **figure's datum** — a chart's values, a KPI's number, a Mermaid source | there is nothing to draw | **PROPAGATES**: renders an EMPTY figure, never a SolError out a `chart` socket | Gauge, KPI, 7-Segment |
| a **presentation annotation** — an options string, decimals, a colour | no styling was given | **falls back to the NEUTRAL default**, never to the card's styling | chart Options, Chart Options builder |
| a **filter predicate** | that row is not known to match | **DROPS the row** | Filter |
| a **filter condition's column or comparison value** | that condition cannot be evaluated, so which rows survive is unknown | **PROPAGATES** — the whole result is blank | Filter, SUMIFS |
| an **optional** input — a bound, a tolerance, a comparison value | see "absent is not unknown" below: still **PROPAGATES** | | Clamp's min, as-of tolerance |

The first row is the default. The rest exist because the alternative is worse in a
specific, checkable way — not as taste:

- A **reduction** that propagated would let one blank void an entire aggregate, which is
  neither Excel's range behavior nor SQL's.
- A **check** that propagated would null out the user's data in order to report a
  violation it could not justify. Undeterminable is not the same as failed.
- A **control** that propagated would drop the value the user physically set. And
  "stop constraining" (`±Infinity`) is not an escape: it breaks
  `<input type="range">`, the play loop's wrap-around, and tornado's sweep bounds.
- A **presentation annotation** looks like a control, and it is the one place the
  control rule does NOT extend. The control fallback exists because the widget cannot
  physically work without a bound; styling always has a working neutral (`{}` options,
  0 decimals), so there is nothing to rescue and falling back to the card would just
  reinstate styling the graph withheld. The test is the widget's, not the input's: can
  it render at all? A Bullet's `max` is the track's scale and it cannot, so `max` is a
  control and keeps the card's bound while the same node's `value` and `target` go
  blank. Three inputs, two dispositions, one node.
- A **filter condition** looks like it should skip, the way a check's parameter does.
  It doesn't, and the difference is what the node OUTPUTS. A check passes the data
  through and reports separately, so skipping costs only the report. A filter's output
  IS the decision — skipping the condition silently returns MORE rows than the graph
  asked for, which reads as a successful unfiltered result rather than a missing one.

An empty STRING deserves its own note, because it is the literal these roles ship with.
`""` is a real value that already means something on almost every frame verb — "no
column chosen, pass the frame through". It is what an UNWIRED slot with an untouched
card reads as, and that reading is unchanged. A cable delivering blank is a different
fact and takes the row's disposition. So read the raw value first and only then `.trim()`
it: `const raw = readInput(inputs.column, this.stringLiterals.column ?? "")` — `null` is
the wired blank, `""` is the untouched card.

### The trap: "absent" is not "unknown"

Most nodes already have a code path for an input being ABSENT, and it is almost always
sitting right next to the read:

```ts
const min = inputs.min?.[0] ?? this.literals.min ?? null;   // null = no floor applied
const rk  = (inputs.rightKey?.[0] ?? …).trim() || lk;       // blank = same key as left
const tol = inputs.tolerance?.[0] ?? this.literals.tolerance; // undefined = exact match
```

That path exists for the **UNWIRED** slot. Routing a wired blank into it looks like
reuse and is a semantic change: *"the user didn't supply this"* and *"the graph computed
this and got nothing"* are different facts, and only the first means omitted.

So Clamp with a wired blank `min` is **blank**, not unclamped. An as-of Join whose
`tolerance` arrives blank is **blank**, not an exact-match join. A KPI whose `prev`
arrives blank shows **no comparison**, not a comparison against the card's number. The
unwired readings — no floor, exact match, no delta — are unchanged, because those are
what an unwired slot still means.

This is the same core rule as everywhere else. It gets its own section because the
absent-branch is already written, which makes the wrong answer the path of least
resistance. **An existing comment that says "unwired/blank → default" predates this
spec and conflates the two cases; the spec wins.**

`readInput` already separates them, and this is the mechanism to use when an input has
a genuine omitted reading. Pass the literal through WITHOUT an `?? default` and you get
three distinct states back:

```ts
const end = readInput(inputs.end, this.literals.end as number | undefined);
//  undefined → unwired, nothing typed  → OMITTED: slice to the end of the list
//  null      → a cable carrying blank  → UNKNOWN: blank out
//  a number  → wired or typed          → use it
```

Excel's own omitted-argument readings live in the `undefined` branch, and only there:
INDEX's omitted axis meaning "the whole row/column", Slice's open end, an as-of Join's
exact-match tolerance, a Sequence with no stop yet. Writing `?? 0` or `?? 1` on the
literal collapses `undefined` into a value and throws that distinction away — so only
add a default when the input genuinely has no omitted reading.

### Where the blank check GOES

Two placement rules, both found by sweeping `finance.ts` (73 reads, ~20 multi-op hosts).
Neither is about which disposition to take — both are about a guard that takes the right
disposition in the wrong place, which typechecks and is silently wrong.

**An error outranks an unknown.** A node that both null-guards its scalars and inspects a
list for `SolError`s must run the error check FIRST. `#DIV/0!` reaching MIRR's cashflows
and a blank reaching its `finrate` is not a blank result — it is `#DIV/0!`, because that
is what `installErrorGuards` would return if the error had arrived on any other input.
Guard order is the only thing deciding this, so put the error branch above the blank one.

**Scope the guard to the ACTIVE op.** On a multi-op node, only the inputs the current op
actually reads can make the result unknown. A guard hoisted above the `switch` that ANDs
together every op's inputs turns a blank on an input this op ignores into a blank answer —
TBILLYIELD does not read `discount`, so a blank there must not null it. Either put the read
and its guard inside the branch, or read op-dependently first
(`const a = this.op === "disc" ? readInput(inputs.pr, …) : readInput(inputs.investment, …)`)
and guard the result. The inputs every op shares (`basis`, `frequency`) can still be
guarded once, up top.

### Writing a new node

1. Read every input through `readInput`. If an input is genuinely not a card field,
   there is no literal and nothing to swallow.
2. For each input, name its ROLE from the table and take that disposition. Place the
   guard per "Where the blank check goes" — after any error branch, inside the op branch.
3. **Check what CONSUMES the value, not just `data()`.** The Slider bug was invisible in
   its own method: three other call sites — a DOM attribute, a wrap-around, and a
   sensitivity sweep in another file — each assumed a finite bound. If a node publishes
   a field others read (`effectiveMin`, `cachedResult`), the disposition has to survive
   at those call sites too.
4. Pin BOTH halves in a test: a wired blank does the right thing, **and** an unwired slot
   still uses the literal. A fix that propagates unconditionally breaks every typed
   default just as badly as the bug it replaces. Worked examples of each row of the
   table live in `nodes/wiredNull.test.ts`.

## Boundaries and bridges

- **Logical↔number bridge** (`coerceInputs.ts`): 0/1 ↔ FALSE/TRUE; **NaN → null**
  (unknown truth value — R/pandas lineage) [shipped 2026-07-04]; aligned with
  `coerceLogical` (one spec).
- **The unit-blind boundary** (`unitBridge.ts` `stripUnitCells`, applied per-input in
  `coerceInputs`) [shipped 2026-07-13]: the dimension algebra runs only in
  `unitAware = true` nodes; every OTHER node receives plain numbers in the display
  magnitude the user sees (a `passthrough()` node keeps tags only on its spec-named
  inputs). Without the strip, a `UnitCell` reaches `coerceNumber` as NaN and a
  comparison/threshold/chart silently breaks. See also `subsystem-invariants.md`
  "Unit flow".
- **Wired null vs unwired input** (`readInput`, shared.ts) [shipped]: `undefined` (unwired) falls
  back to the node's literal; a WIRED `null` propagates as missing. The `?? literal`
  read idiom must not swallow wired nulls.
- **IPC / frame boundary** [shipped 2026-07-05, B-1b — supersedes the old
  NaN→null normalization]: non-finite crosses BOTH directions as the tagged
  `{"__nf":"inf"|"-inf"|"nan"}` sentinel; a per-cell SolError uploads as
  `{"__err":code}` (engine degrades it to null — Polars-typed columns can't hold
  errors — but the contract is explicit). Frame cells hold real ±Inf; NaN is
  present-but-dirty: counted, tail-sorted, failing predicates, poisoning
  aggregates to `#DOMAIN!`. Aggregates apply the scalar guard in both backends
  (SUM of ∞ is ∞; ±Inf from all-finite → `#OVERFLOW!` — engine-side classified
  at the materialization boundary via a base-column scan; JS oracle inside
  `aggregateGroup`, covering pivot totals too).
- **List ops vs relational verbs** (excelComparisons's line, second instance): list UNIQUE never
  dedupes error cells (each is an independent problem — the sanity-check reading)
  [shipped 2026-07-04]; frame Distinct dedupes by error CODE (errors as values, SQL
  identity semantics).
  List/frame Sort both put nulls AND errors LAST, both directions, stably [shipped
  2026-07-02].

## Display

- **null** → a scalar renders as the muted em-dash; a list/frame CELL renders the
  word `null` (muted) [shipped].
- **SolError** → the red error badge with its code [shipped]; `#OVERFLOW!` is in the
  inventory (15 codes, `errorValue.ts`) and toured in the error-showcase seed
  [shipped].
- **NaN** → literal `NaN` with a QUIET affordance: muted background tint (not error
  red, not ArrayChip-like) + fixed-text structural tooltip [shipped].
  Never "N/A".
- **Infinity** → the `∞` glyph (`-∞` negative), in `formatScalar` and list previews
  (`format.ts`) [shipped 2026-08-05].

## Pointers

Decisions: arraySemantics (the value model), currentExcelParity (current-Excel-only parity), oneAnswerOneDivergence (surface
harmony + the reduction/element-wise line), excelComparisons (comparisons vs identity; list vs
relational), consistencyOverQuirks (engine consistency over Excel quirks) in `decisions.md`.
Mechanics: `subsystem-invariants.md` "Error values". Known open divergence: the
mode-selector-on-a-wired-blank AUTHOR CALL in `backlog.md` (text.ts/date.ts
literal fallback vs this doc's propagate row).
