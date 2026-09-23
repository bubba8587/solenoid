---
aliases: ["Value semantics"]
tags: [spec, values]
---
<!-- [[C24]] arraySemantics, [[D33]] unwiredNotBlank, [[D36]] nullSkippedNotZero, [[D37]] errorBeatsMissing, [[D38]] kleeneLogic, [[D51]] oneAnswerOneDivergence, [[C45]] excelComparisons, [[C46]] consistencyOverQuirks, [[C14]] currentExcelParity, [[C22]] rowFormulaRefs -->

# Spec: Value semantics

Serves [[C24]] arraySemantics (the value model), [[D33]] unwiredNotBlank, [[D36]] nullSkippedNotZero, [[D37]] errorBeatsMissing, [[D38]] kleeneLogic, [[D51]] oneAnswerOneDivergence (one answer per computation, and the reduction versus element-wise line), [[C45]] excelComparisons (comparisons versus identity, list versus relational), [[C46]] consistencyOverQuirks and [[C14]] currentExcelParity. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

This is the one reference for the value model's special kinds: what each means, what produces it, how it propagates in each kind of computation, and how it renders. The mechanics (the error guard, the per-cell contract, the bounded scan) are [[error-values]]; this file is the meaning. Every rule here is built. A rule that is decided but not yet built gets a `[decided <date>]` tag here and an item in the backlog.

## The kinds

| Kind | Meaning | It is |
|---|---|---|
| value | a real number, string, date, logical or complex | the normal case |
| `null` | **missing**: no value was ever there | data, not a failure |
| `SolError` | **failure**: a computation could not answer (a tagged code, one of 16, including `#OVERFLOW!` and the internal `#ERROR!` catch-all) | loud until caught |
| `NaN` | **an undefined number that leaked**: neither an error nor missing | residue; a computation may not produce it (`guardFinite`) |
| `Infinity` | **a definable infinity**: declared on purpose (the Constant node) or derived from an infinite input | a first-class value |

A **complex** value is the tagged object `{ __cx: true, re, im }` (tagSpecialScalars), never a bare `[re, im]` array. So `Array.isArray` never means "a complex number": an array is a 1-D list, or a matrix when its own elements are arrays (rank 2 is allowed by [[C15]] matricesInFormulas). `isCx` (`nodes/complex.ts`) is the one complex test.

Three distinctions carry the most weight:

- **Null versus error.** A blank cell is data you don't have; an error is an answer that failed. Aggregators skip null but propagate errors, Filter drops rows whose predicate is null, Fill and Coalesce recover null, and IFERROR and IFNA recover errors. Detection and recovery form a 2 × 2: ISNULL, ISERROR and ISNA detect; Fill, Coalesce, IFERROR and IFNA recover.
- **NaN versus `#N/A`.** Unrelated, despite the letters. `#N/A` is a real tagged error ("no result exists"), minted by an XLOOKUP miss, the NA node, and IFS or SWITCH with no match; IFNA catches it. NaN is IEEE float residue with no special status. IFNA does not catch it, and it never renders as "N/A": it renders as `NaN` with a muted chip.
- **Infinity versus overflow.** `10^400` is a real, very large number the app can't represent, which is `#OVERFLOW!`, not infinity. Infinity is only ever deliberate.

## Where each kind comes from

- **Errors are minted at the failure, with the specific code.** `#DIV/0!` at the divide; `#DOMAIN!` at a sqrt, log or pow domain failure; `#N/A` at not-found or no-match; `#SHAPE!` at coercion, and per row in a computed column (a list-shaped cell result, or an `@`-read of a mis-sized list, which is the deliberate loud failure for a bare column name in scalar position, [[C22]] rowFormulaRefs); `#CIRC!` at engine cache seeding; `#OVERFLOW!` at representation overflow. A raw NaN is never a failure signal.
- **Fill's unwired pad is `null`** (first-class missing, the author's call), not the `#N/A` Excel's EXPAND uses for an omitted `pad_with`. Wire the NA node into Fill to get Excel's form (`nodes/matrix.ts`).
- **The non-finite guard** (`guardFinite`, `valueKinds.ts`) applies to every numeric op:
  - a `NaN` result is `#DOMAIN!` (indeterminate: `(-8)^(1/3)`, `∞−∞`, `∞/∞`, `0×∞`, or a NaN input entering the op);
  - a `±Infinity` result from all-finite inputs is `#OVERFLOW!`;
  - a `±Infinity` result with an infinite input passes through, since it is definable.

  So a computation cannot produce NaN. The remaining NaN sources are data entry (dirty imported data, or an unparseable typed cell through `coerceFrameCell`) and one class of bug: a `UnitCell` that escapes the unit-blind boundary reaches `coerceNumber` as NaN, which `stripUnitCells` exists to prevent.
- **`null`** comes from data (blank cells, CSV holes), from padding a ragged list, from an empty aggregation (`AVG([])`), and from Kleene logic that really cannot answer.

## Propagation, by context

Which rule applies is decided by the kind of computation, not by the function's name.

| Context | An error | A `null` | Where |
|---|---|---|---|
| **Element-wise numeric** (operators, mapped functions) | propagates unchanged, per cell, the first in argument order | propagates (`null + 5` is `null`: the SQL model, not Excel's blank-as-0) | the shared broadcasters (`broadcast`, `broadcastErr`, `broadcastCall`) |
| **Element-wise logical** (Comparison, BooleanOp, IF, NOT) | propagates unchanged | goes into Kleene logic: `FALSE AND null` is FALSE, `TRUE AND null` is null | `broadcastEl`; the Kleene tables in `valueKinds.ts` |
| **Reduction or aggregate** (SUM, AVG, the formula AND and OR, the Aggregate node) | propagates, the first error wins | skipped (Excel's range behavior, SQL aggregates) | `forAggregate`, `prepRangeArgs` |
| **Paired, index-aligned** (SUMPRODUCT, CORREL, SUMIF…) | propagates | a null in any range drops that whole row pairwise; ragged ranges keep the shortest zip (pad-then-drop is the same as truncating) | `RANGE_PAIRED` |
| **Positional lookups** (XLOOKUP, XMATCH, INDEX) | propagates | nulls stay put, since dropping them would shift indices | `RANGE_POSITIONAL` |
| **The COUNT family** | classified, not propagated (COUNT skips, COUNTA counts) | COUNTBLANK counts them | `RANGE_RAW` |
| **A ragged element-wise zip** | — | pads to the longest with null; a padded position is missing | every broadcaster |
| **Computed column, per row** | a row-bound error cell (a λ parameter or an `@`-read) fails that row only; an error inside a whole-column binding flows into the formula, where the aggregate's own rule applies | flows in (ISBLANK sees it); a result of `undefined` reads as blank | `computedColumnCore.ts` `tagComputedCell` ([[C22]] rowFormulaRefs, [[C54]] noPerCellFormulas) |

The one sanctioned divergence ([[D51]] oneAnswerOneDivergence): the formula `AND(x)` is a reduction, so it skips nulls as Excel does, while the BooleanOp node is element-wise and uses Kleene logic. Same word, two contexts, both correct. Any other disagreement between a node and a formula is a bug.

**Scalar operators.** The operator table (`applyOp`: errors first, then `null` propagating, the logical bridge, case-blind `=`, code-unit ordering with `#TYPE!` across types) and blank arguments (a blank slot is `null` unless `BLANK_ARG_TYPES` types it, so `IF(x,,y)` answers `null`, not 0) are in [[formula-language]].

## Reading an input: a wired blank versus the typed literal

The table above says how a missing value behaves once it is inside a computation. This section says how it gets there, which is a separate decision every node makes and which nodes long got wrong. **Read this section before writing a new node.**

A value can also enter a computation through a reference resolved against a computed column's row, rather than through a socket ([[C22]] rowFormulaRefs). Its resolution order and what a miss answers are in [[computed-columns]]. A new surface must supply the core's `sideValue` hook and answer a miss explicitly, as Frame Input does with `#REF!`; the core supplies no default of its own.

### The one rule

Most inputs are both a socket and a field on the card. Read them with `readInput` (`nodes/shared.ts`):

```ts
const n = readInput(inputs.count, this.literals.count ?? 1);
```

- When the slot is **unwired** (`undefined`), the typed literal is the value: the field on the card is the input.
- When the slot is **wired**, the cable's value wins, **even when it is `null`**. A blank you deliberately wired is a fact about the data, not an absence of input.

**Never write `inputs.x?.[0] ?? this.literals.x`.** `??` can't tell "no cable" from "a cable carrying blank", so it silently puts the card's value in place of the graph's answer: a number the user never asked for, with an origin they can't see. This is the most common way a Solenoid node has produced a confidently wrong answer. `nodes/readInputSweep.test.ts` ratchets the remaining occurrences down and fails on new ones.

**A wildcard slot's literal lives in one of two maps.** A slot typed `any` or `trueany` is element-agnostic, so its typed literal may be a number (`literals`) or text (`stringLiterals`). The inline field writes exactly one and clears the other, so the reader never has to break a tie. Only a node that declares `autoLiterals = true` gets that field: the value selectors IF, IFS, SWITCH and CHOOSE, whose wildcard rows are value branches. A wildcard sink or relay (Display, Cast, Report, Cube) leaves it off and stays wire-only. The unwired-versus-wired rule is unchanged; it just reads both maps (`pickSlot` in `nodes/logic.ts`).

### What a wired blank does, by the input's role

Reading the input correctly is half of it; the other half is what the node then does. Decide by the input's role, not its type:

| The input is | A wired blank means | So the node | Example |
|---|---|---|---|
| an **operand**, the value computed on | this element is unknown | **propagates**: blank in, blank out, per cell | `UPPER(blank)` is blank |
| a **mode selector**: basis, delimiter, pattern, weekend code | the mode is unknown | **propagates**, since an unknown rule gives an unknown answer | `TEXTSPLIT(x, blank)` is blank |
| a **shape**: rows, columns, count, wrap width | the result's shape is unknown | **propagates** | `MAKEARRAY(blank, 3)` is blank |
| a **member of a reduction**: CONCAT's rows, SUM's inputs | one contributor is missing | **skips it**, as SUM skips nulls | `CONCAT(blank, "b")` is `"b"` |
| a **check's parameter**: Expect's bound or pattern | that check can't be evaluated | **skips that check** and passes the data through | Expect keeps flowing and reports no violation |
| a **control's bound**: Slider min, max, step | the control still has to work | **falls back to the card's own value** | the Slider keeps clamping to its typed bound |
| a **column reference**: which column to sort, group, split or look up by | the target is unknown | **propagates**: a blank Frame out, not the Frame unchanged | Frame Sort, Get Column, XLOOKUP |
| a **figure's datum**: a chart's values, a KPI's number, a Mermaid source | there is nothing to draw | **propagates**: renders an empty figure, never a `SolError` out a `chart` socket | Gauge, KPI |
| a **presentation annotation**: an options string, decimals, a color | no styling was given | **falls back to the neutral default**, never to the card's styling | chart Options, the Chart Options builder |
| a **filter predicate** | that row is not known to match | **drops the row** | Filter |
| a **filter condition's column or comparison value** | the condition can't be evaluated, so which rows survive is unknown | **propagates**: the whole result is blank | Filter, SUMIFS |
| an **optional** input: a bound, a tolerance, a comparison value | still unknown (see "Absent is not unknown") | **propagates** | Clamp's min, an as-of tolerance |

The first row is the default. The others exist because the alternative is worse in a specific, checkable way, not as a matter of taste:

- A **reduction** that propagated would let one blank void a whole aggregate, which is neither Excel's range behavior nor SQL's.
- A **check** that propagated would null out the user's data to report a violation it could not justify. Undeterminable is not the same as failed.
- A **control** that propagated would drop the value the user physically set. "Stop constraining" (`±Infinity`) is no escape either: it breaks `<input type="range">`, the play loop's wrap-around and the Tornado sweep's bounds.
- A **presentation annotation** looks like a control, and it is the one place the control rule does not extend. The control fallback exists because the widget can't work without a bound. Styling always has a working neutral (`{}` options, 0 decimals), so there is nothing to rescue, and falling back to the card would bring back styling the graph withheld. The test is the widget's, not the input's: can it render at all? A Bullet's `max` is the track's scale, and without it the Bullet can't render, so `max` is a control and keeps the card's bound while the same node's `value` and `target` go blank. Three inputs, two dispositions, one node.
- A **filter condition** looks as though it should skip, the way a check's parameter does. It doesn't, and the difference is what the node outputs. A check passes the data through and reports separately, so skipping costs only the report. A filter's output is the decision itself: skipping the condition silently returns more rows than the graph asked for, which reads as a successful unfiltered result rather than a missing one.

**An empty string** needs its own note, because it is the literal these roles ship with. `""` is a real value that already means something on almost every frame verb: "no column chosen, pass the Frame through". It is what an unwired slot on an untouched card reads, and that reading is unchanged. A cable delivering blank is a different fact and takes the row's disposition. So read the raw value first and only then `.trim()` it: in `const raw = readInput(inputs.column, this.stringLiterals.column ?? "")`, `null` is the wired blank and `""` is the untouched card.

### Absent is not unknown

Most nodes already have a code path for an absent input, and it usually sits right next to the read:

```ts
const min = inputs.min?.[0] ?? this.literals.min ?? null;   // null = no floor applied
const rk  = (inputs.rightKey?.[0] ?? …).trim() || lk;       // blank = same key as left
const tol = inputs.tolerance?.[0] ?? this.literals.tolerance; // undefined = exact match
```

That path exists for the unwired slot. Routing a wired blank into it looks like reuse but changes the meaning: "the user didn't supply this" and "the graph computed this and got nothing" are different facts, and only the first means omitted.

So Clamp with a wired blank `min` is **blank**, not unclamped. An as-of Join whose `tolerance` arrives blank is **blank**, not an exact-match join. A KPI whose `prev` arrives blank shows **no comparison**, not a comparison against the card's number. The unwired readings (no floor, exact match, no delta) are unchanged, because that is what an unwired slot still means.

This is the same rule as everywhere else. It gets its own section because the absent branch is already written, which makes the wrong answer the easiest one to write. An existing comment that says "unwired or blank means default" conflates the two cases; this spec wins.

`readInput` already separates them, and it is the tool for an input with a real omitted reading. Pass the literal through without a `?? default` and you get three distinct states back:

```ts
const end = readInput(inputs.end, this.literals.end as number | undefined);
//  undefined → unwired, nothing typed  → omitted: slice to the end of the list
//  null      → a cable carrying blank  → unknown: blank out
//  a number  → wired or typed          → use it
```

Excel's own omitted-argument readings live in the `undefined` branch, and only there: INDEX's omitted axis meaning the whole row or column, Slice's open end, an as-of Join's exact-match tolerance, a Sequence with no stop yet. Writing `?? 0` or `?? 1` on the literal collapses `undefined` into a value and throws the distinction away, so add a default only when the input really has no omitted reading.

### Where the blank check goes

Two placement rules, both found by sweeping `finance.ts` (73 reads, about 20 multi-op hosts). Neither is about which disposition to take. Both are about a guard that takes the right disposition in the wrong place, which typechecks and is silently wrong.

- **An error outranks an unknown** ([[D37]] errorBeatsMissing). A node that both null-guards its scalars and inspects a list for `SolError`s runs the error check first. `#DIV/0!` reaching MIRR's cash flows while a blank reaches its `finrate` is not a blank result: it is `#DIV/0!`, because that is what `installErrorGuards` would return had the error arrived on any other input. Guard order alone decides this, so put the error branch above the blank one.
- **Scope the guard to the active op.** On a multi-op node, only the inputs the current op reads can make the result unknown. A guard hoisted above the `switch` that combines every op's inputs turns a blank on an input this op ignores into a blank answer: TBILLYIELD does not read `discount`, so a blank there must not null it. Either put the read and its guard inside the branch, or read op-dependently first (`const a = this.op === "disc" ? readInput(inputs.pr, …) : readInput(inputs.investment, …)`) and guard the result. Inputs every op shares (`basis`, `frequency`) can still be guarded once, up top.

### Writing a new node

1. Read every input through `readInput`. An input that is not a card field has no literal and nothing to swallow.
2. Name each input's role from the table and take that disposition. Place the guard as "Where the blank check goes" says: after any error branch, inside the op's branch.
3. **Check what consumes the value, not only `data()`.** The Slider's wired-blank bug was invisible in its own method: three other call sites (a DOM attribute, a wrap-around, and a sensitivity sweep in another file) each assumed a finite bound. If a node publishes a field others read (`effectiveMin`, `cachedResult`), the disposition has to hold at those call sites too.
4. Pin both halves in a test: a wired blank does the right thing, and an unwired slot still uses the literal. A fix that propagates unconditionally breaks every typed default as badly as the bug it replaces. Worked examples of each row of the table are in `nodes/wiredNull.test.ts`.

## Boundaries and bridges

- **The logical and number bridge** (`coerceInputs.ts`): 0 and 1 map to FALSE and TRUE, and **NaN maps to null** (an unknown truth value, as in R and pandas), consistent with `coerceLogical`.
- **Text on a number port** (`coerceInputs.ts` `numericCells`): only a wildcard cable can land text or a complex on a number-family input. It is `#TYPE!`, per cell on a list or matrix port and for the whole node on a scalar port, never a parsed number ([[B17]] typedValueModel). Pinned in `coerceInputs.test.ts`.
- **The unit-blind boundary, and wired null versus unwired**, are arrival coercion and `readInput`: [[compute-pass]], "Arrival coercion", with the unit rules in [[unit-flow]].
- **The IPC and frame boundary.** Non-finite numbers and per-cell errors cross the wire as tagged sentinels, and aggregates apply the scalar non-finite guard in both backends: [[frame-verbs]], "The FrameBackend seam".
- **List ops versus relational verbs** ([[C45]] excelComparisons). List UNIQUE never dedupes error cells, since each is an independent problem, while frame Distinct dedupes by error code (errors as values, SQL identity). List and Frame Sort both put nulls and errors last, in both directions, stably.

## Display

- **`null`**: a scalar renders as the muted em dash; a cell in a list or Frame renders the word `null`, muted.
- **`SolError`**: the red badge with its code. All 16 codes are in `errorValue.ts`, and `#OVERFLOW!` is toured in the error showcase seed.
- **`NaN`**: the literal `NaN`, shown quietly with a muted background tint (not error red, not chip-like) and a fixed structural tooltip. Never "N/A".
- **`Infinity`**: the `∞` glyph (`-∞` when negative), in `formatScalar` and list previews (`format.ts`).

## Open divergence

A mode selector on a wired blank: `text.ts` and `date.ts` fall back to the literal, where the table above says propagate. It awaits the author's call.
