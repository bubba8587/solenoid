# Solenoid — Formula Engine: Array Semantics & Adjacent Gaps (scoping)

Scoping doc, **no build commitment**. Started as "make the Expression node aggregate a list"
and turned into an audit of the shared formula engine (`excelFormula.ts`) and everything that
rides on it. The headline fix is real but it's one of **seven** related problems that all live
in the same ~40 lines + the host nodes' invocation conventions — so this scopes the cluster,
not just the one bug, because patching them piecemeal would make the coherence problem worse.

Companion: `docs/timesavers-pack-proposal.md` §2 (where the limitation first surfaced — it
gates how many timesaver nodes can be pure formula-data), `docs/excel-pain-points.md`
(Excel's own gaps, several of which we currently re-import here).

---

## 0. The engine is a chokepoint — leverage *and* amplified risk

`excelFormula.ts` (`parseExpr` → `compileFormula` → `dispatch` to **Formula.js**) is the single
compiler behind **Expression, LAMBDA, MAP, BYROW, BYCOL, REDUCE, MAKEARRAY** and every
formula-data pack node (Geometry, the proposed Timesavers). One fix here propagates to all of
them; one regression here does too. That cuts both ways and is the reason to get the *model*
right once rather than point-patch `broadcastN`.

---

## 1. The primary problem (recap, tightened)

`expression.ts`'s `broadcastN` (`:31`) applies **one blanket policy**: if any input is an array,
run the whole compiled formula once per element (`Array.isArray(a) ? a[i] : a`, `:38`). So an
array variable is destructured to scalars *before the formula sees it* — an Expression node is
strictly element-wise and **cannot aggregate a list** (`x / SUM(x)` can't work: `x` is needed
both element-wise and whole). The decision of "broadcast vs pass-whole" must be made **per
call-site** (Excel's grammar-of-arrays), not per node or per variable. Verified feasible: see
problem **P1** — the engine *already* aggregates correctly in another host.

---

## 2. Adjacent problems surfaced by poking around

### P1 — Four different array conventions over one engine (the real systemic issue)

The compiled formula is invoked **differently by every host**, so the same text means different
things:

| Host | Invocation | What `SUM(v)` means |
|---|---|---|
| **Expression** | `broadcastN(compiled, args)` (`expression.ts:127`) | broadcast → **broken** (sums one scalar at a time) |
| **MAP** | per-cell `fn(x, …)` (`tableLambda.ts:142`) | element-wise per cell |
| **BYROW/BYCOL** | per-vector `fn(vec)` (`tableLambda.ts:189`) | **aggregates the row** — works! |
| **REDUCE** | fold `fn(acc, x, i)` (`tableLambda.ts:241`) | running accumulation |

`tableLambda.ts:189` is the proof the fix is feasible with zero new Formula.js work: handed the
**whole vector**, `SUM(v)` returns the right scalar. But it also exposes that **array semantics
live in each host node's calling convention, not in the engine.** There is no single array model;
there are four ad-hoc ones. The fix should *unify* these (one evaluation core in
`excelFormula.ts`, host nodes select a **mode**), not add a fifth bespoke path to `broadcastN`.

### P2 — The function classification is broader than "scalar aggregators"

The call-site decision needs a set of **range-taking** functions, and it's wider than the sum/avg
family:
- **Scalar-returning aggregators:** `SUM, AVERAGE, MIN, MAX, COUNT*, STDEV, MEDIAN, SUMPRODUCT…`
- **Array-returning** range functions: `UNIQUE, SORT, FILTER, TRANSPOSE, SEQUENCE…` (so the
  evaluator must be value-polymorphic **scalar | array**, not "reduce to scalar" — `COUNTA(UNIQUE(x))`
  needs an array flowing *into* a scalar aggregator).
- **Logical reducers:** `AND, OR` over a list must reduce, not broadcast (today they'd broadcast).

So the classification is "**signature takes a range**," default **broadcast**, and the value
model is polymorphic. (Mitigation for misclassification risk: default everything to broadcast;
whitelist the ~25 range functions; table-test them.)

### P3 — Ragged-list silent truncation (against our own ethos)

Both `broadcastN` (`:34`) and the numeric `broadcast` (`shared.ts:97`) do
`len = lists.reduce(min)` — mismatched-length inputs are **silently truncated to the shortest**.
This is exactly the silent-wrong-answer failure mode `excel-pain-points.md` says Solenoid exists
to prevent. Decision needed: error (`#N/A`/a `#SHAPE!`-style tag), pad, or keep-and-document.
It lives in the same code the fix rewrites, so decide it now.

### P4 — 2-D / matrix inputs to Expression mis-broadcast

`broadcastN` is 1-D: for a `number[][]` input, `a[i]` is a **row**, fed whole to a scalar fn.
And Expression's variable sockets are `anyIn` (`expression.ts:94`), which `coerceInputs` passes
through **unflattened** (the `any`/default branch, `coerceInputs.ts:51` — unlike the `numlist`
branch that flattens a table at `:36`). So wiring a table into an Expression silently
mis-evaluates. The array model has to state a matrix policy (flatten? row-map? reduce-all, like
REDUCE does?), not leave it accidental.

### P5 — In-formula errors aren't tagged (a hole in the flagship error system)

`installErrorGuards` makes errors-in → errors-out at the **node boundary**, but errors *generated
inside* a formula are dropped:
- `1/0` → JS `Infinity` → `guard` (`expression.ts:20`) → **`null`**, no `#DIV/0!`.
- `SQRT(-1)` / `LN(0)` → `NaN` → `null`, no `#NUM!`/`#DOMAIN!`.
- **Formula.js's own error returns** (it yields `#N/A`, `#VALUE!` as strings/objects) are **not**
  converted to `SolError` — `excelFormula.ts`'s `dispatch` (`:237`) only throws on *unknown
  function*, and `guard` lets a string pass through as text. So a formula's `#N/A` becomes literal
  text `"#N/A"`, not a tagged error.

`errorValue.ts` already defines `#DIV/0!`, `#NUM!`, `#DOMAIN!`, `#N/A`. The Expression node is the
one place in the app that *computes* but doesn't tag — and the evaluator rewrite is the natural
seam to close it.

### P6 — Operator semantics diverge from Excel

`js()` codegen (`excelFormula.ts:222-231`) compiles operators to raw JS:
- `=`/`<>` → `===`/`!==`: **case-sensitive and type-strict**. Excel `=` is **case-insensitive**
  for text (`"a"="A"` is TRUE) and type-coercing; dates-as-`Date`-objects compare by **reference**.
- `<`,`>`,`<=`,`>=` → JS operators: string comparison is **UTF-16 lexicographic, case-sensitive**;
  Excel is case-insensitive with a number<text<logical ordering.
- `&` → `String(l)+String(r)`: `String(true)` → `"true"` (Excel `"TRUE"`); an unwired blank
  defaults to `0` (`expression.ts:125`) so it concats as `"0"`, not `""`.

Minor for a math-first tool, but it quietly breaks the "type *real* Excel formulas" promise the
moment text/logic is involved. Separable from the array work; lower priority; flagged so it's not
forgotten.

### P7 — Boolean results collapse to null

`guard` (`expression.ts:20-24`) returns a value only if it's a string or finite number — a
**boolean** (a bare comparison like `a>b`, or `ISNUMBER(x)`) falls through to `null`/`NaN`. So an
Expression whose result *is* a logical can't output `TRUE`/`FALSE` (or `1`/`0`). Works only when
wrapped (`IF(a>b,1,0)`). Decide: map booleans to `1`/`0`, or to a logical type, as part of the
value model.

### P8 — Minor / note-level
- **Unwired variable silently defaults to `0`** (`expression.ts:125`) — computes rather than
  signalling a missing input (mild silent behavior).
- **`resultAs` isn't validated against the actual value** — declare `number`, return a string, and
  it flows out a number socket (downstream `coerceInputs` may or may not catch).
- **Reserved constant names shadow variables** — a variable named `e`/`pi`/`phi` is swallowed by
  `FORMULA_CONSTANTS` (documented, but a footgun).

---

## 3. Why these cluster — and the shape of the right fix

P1–P7 all live in the same place: the **value model** of the formula engine (how scalars, arrays,
matrices, booleans, and errors flow through operators and function calls) is currently smeared
across `broadcastN`, `guard`, `js()`, `dispatch`, and four host-node calling conventions. There
is no one model. That's why "make Expression aggregate" can't be a 5-line `broadcastN` tweak
without deepening P1.

**Recommended shape (design, not code):**

1. **One value-polymorphic evaluation core in `excelFormula.ts`** — returns `scalar | array
   | matrix`; scalar ops/functions **broadcast**, range-signature functions receive arrays
   **whole** (P1/P2), made per call-site (Excel grammar-of-arrays). This is the existing scalar
   `ev` tree-walker (`:400`) generalized to `unknown`, *or* an array-aware codegen — the
   tree-walker is the lower-risk host since operator semantics can be defined once.
2. **Host nodes select a mode**, they don't hand-roll invocation: Expression = auto
   (broadcast + aggregate per call-site); MAP = per-cell; BYROW = per-vector; REDUCE = fold.
   Collapses the four conventions in P1 into one core with parameters.
3. **Tag errors in the core** (P5): `#DIV/0!` on divide-by-zero, `#NUM!`/`#DOMAIN!` on non-finite
   from a domain violation, and **convert Formula.js error returns to `SolError`**.
4. **Decide the cross-cutting policies** the model now has to state explicitly: ragged inputs
   (P3), matrix handling (P4), boolean output (P7).
5. **Strict-superset guarantee:** a formula with no range functions and no errors must evaluate
   byte-identically to today — the regression firewall, enforced by the existing
   `excelFormula.test.ts` plus new array/aggregate/error cases. (Operator-parity work in P6 is the
   one piece that's *intentionally* a behavior change, so gate it separately.)

---

## 4. Open decisions (genuinely the author's call)

**RESOLVED 2026-06-22 (author) — see dev-notes "Array-semantics policy DECISIONS":**
- **First-class `null` (missing value)** added as a value kind distinct from `SolError` and from
  `0` — rendered literally as `null`, allowed in lists, matches Polars `null` / pandas `NaN` /
  SQL `NULL`. Aggregators **skip `null`**; a `SolError` in a list **propagates** (missing ≠
  broken). This **relaxes** the old "lists never carry errors" invariant — lists may now carry
  `null` (skipped) and `SolError` (propagated) as distinct kinds.
- **Ragged lists (P3):** → **pad to longest with `null`** (was: silent-truncate-to-shortest).
  Length-1 still broadcasts.
- **Boolean output (P7):** → **a real first-class logical type** (a full socket family, not just
  render). Renders `TRUE`/`FALSE`; **coerces to `1`/`0`** in any arithmetic/aggregator context
  (Excel + Polars model). Bare logical results (`a>b`, `ISNUMBER`, `AND`/`OR`) stop collapsing to
  null. Socket **color = purple** (the `purple` palette slot — same one the `logic` node-kind
  already uses, so logical *type* and logic *kind* align). Gets scalar/array/matrix variants
  auto-shaded like every other socket family (`--sock-logical` + list/table siblings).

- **Matrix in Expression (P4):** → **element-wise preserves 2-D shape; aggregators reduce the
  WHOLE matrix to a scalar (reduce-all).** Matches Excel (`=A1:C2-AVERAGE(A1:C2)` spills 2-D;
  `SUM(A1:C2)` is a grand total), NumPy/R defaults, and REDUCE. So `x - AVERAGE(x)` over a matrix
  = centering. **Per-axis (row/col) aggregation stays the explicit job of BYROW/BYCOL/ByAxis — NOT
  Expression** (keeps Expression's rule simple: aggregators collapse everything, everything else
  keeps its shape). Replaces the current loud `#SHAPE!` placeholder.
- **Variable-binding scope (clarified, author 2026-06-22):** Expression binds a variable to the
  **whole input** (Excel grammar-of-arrays); the **MAP/lambda family binds to the current
  element** (per-cell). So `x - AVERAGE(x)` legitimately differs: Expression over a list →
  centering; MAP over a list → all zeros (AVERAGE of a 1-element scope is itself). This is NOT the
  P1 inconsistency — it's the defining contract of each host (MAP ≡ Expression applied per element)
  and matches Excel exactly (`MAP(arr,LAMBDA(x,x-AVERAGE(x)))` = zeros vs `arr-AVERAGE(arr)` =
  centered). Both still run the ONE unified core; they differ only in the binding mode the host
  selects (P1 recommendation #2). Optional self-doc nicety: hint in MAP when an aggregator wraps
  its scalar loop var.

- **Operator parity (P6) → RESOLVED (author 2026-06-22): type-honest, match Excel where it's
  sane, diverge where it's incoherent / where our richer types beat it.**
  - **`=` / `<>`:** stays type-strict (already matches Excel — `1="1"` is FALSE in both) and
    becomes **case-insensitive for text** (Excel parity). The `EXACT` node remains the
    case-sensitive escape hatch (mirrors Excel's own = / EXACT split).
  - **`<` `>` `<=` `>=`:** numbers as-is; text via dictionary collation (`Intl.Collator`,
    case-insensitive, NOT raw UTF-16 code units); logicals coerce to 1/0. **Cross-type ordering
    (number vs text etc.) → `#TYPE!` error** — don't invent Excel's number<text<logical order, and
    don't return JS's silent NaN-false. (`#TYPE!` already exists: "wrong element type for the op".)
  - **`&` concat:** logicals render `TRUE`/`FALSE` (string context — display form, not 1/0);
    errors propagate; **`null` propagates** (`null & "x"` → `null`), consistent with element-wise
    arithmetic. `TEXTJOIN` over a list **skips** `null` (aggregator). Unwired blank concats as `""`
    (the unwired-input default, see below), not `"0"`.
  - **`null` in element-wise arithmetic → propagates** (`null + 5` → `null`), matching
    SQL/pandas/R/Polars (Excel is the only outlier, only because it has no real null — resolving to
    0 would re-open the false-zero hole P3's null was created to close). **Unwired/empty inputs are
    separate** ("no operand provided") and default to identity (`0` for `+`), so `5 + <unwired>` =
    `5` keeps the Excel feel — that's the P8 unwired-default knob, NOT null semantics. Opt into
    "missing as 0" explicitly via a **Coalesce/Fill node** (spec below).

- **REDUCE/lambda migration (P1):** fully move BYROW/MAP/REDUCE onto the unified core, or only
  share the core and keep their thin mode wrappers? (Recommend the latter — same core, mode per
  host.) _(Largely settled in the 2026-06-21 unification.)_
- **Sequencing:** classification table + core evaluator (behind tests) → swap Expression's
  compute path → migrate the lambda family onto modes → error tagging → (separately, later)
  operator parity.

---

## 5. Payoff recap

Beyond correctness, landing P1/P2 converts a chunk of `docs/timesavers-pack-proposal.md`'s
`[C]`/`[M]` reducers (% of total, normalize, z-score, weighted average, count-distinct,
conditional-aggregate) into free `[F]` formula-data presets, and P5 plugs the Expression-shaped
hole in the error system. The single highest-value item is **P1's unification** — it's the
difference between "the formula engine has one coherent array model" and "four nodes that each
guess." Everything else is a policy decision layered on that core.
