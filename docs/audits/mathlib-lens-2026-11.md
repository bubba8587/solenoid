# Mathlib as a lens on Solenoid (research, 2026-11)

Point-in-time research, not a plan: what `leanprover-community/mathlib4` (Lean's machine-checked math library) has
already worked out that bears on Solenoid's value model, engine and process. Nothing here is decided; a finding that
should change the product goes to the inbox or the backlog. Test prototypes live only on the `research/mathlib-lens`
branch, never on `develop`.

Mathlib is never a dependency: it reasons about exact reals, not IEEE doubles, and has no units, finance or runnable
statistics. Its value is that it names structures Solenoid rebuilt by hand, and a name brings the full set of laws,
which shows where Solenoid is inconsistent. Every correspondence below holds only approximately over floats, which is
why `exact_sum.rs` and `roundAtLargerTerm` exist.

## Findings

### F1. Dates and temperature readings are both torsors, handled by two different rules

- Mathlib: `AddTorsor` (`Mathlib/Algebra/Torsor/Defs.lean`): point − point is a difference, point + difference is a
  point. `Mathlib/LinearAlgebra/AffineSpace/Combination.lean`: any combination of points whose weights sum to 1 is a
  point independent of where zero is (`weightedVSubOfPoint_vadd_eq_of_sum_eq_one`); weights summing to 0 give a
  difference.
- Solenoid, temperatures: `affine_weight` (`crates/solenoid-core/src/unit_dims.rs`) is that theory: weight 1 a
  reading, 0 a delta, else `#UNIT!`. `(a + b) / 2` over two °C readings is a reading.
- Solenoid, dates: `date_op` (`crates/solenoid-core/src/date_values.rs`) checks each operator alone, so `d1 + d2` is
  `#TYPE!` (pinned in `tests/fuzz_formulas.rs` `dates_through_every_operator_row`), and `(d1 + d2) / 2` errors while
  `AVERAGE(d1, d2)` is a date and `d1 + (d2 - d1) / 2` works.
- [[D115]] datesArePoints says the date rule and the temperature rule agree. In this case they don't.
- Directions: dates reuse `affine_weight` (one rule, one home), or temperatures go operator-local. D115's own
  reopen condition (date − date as a duration with a unit) is the full torsor: dates over time durations, so
  `date + 3 h` works and `date + 5 m` is `#UNIT!`. Time of day is another torsor (unruled in `date-values`).
- Status: read from code and tests, not yet run as a side-by-side test.

### F2. Floor does not commute with conversions

- Mathlib: `Counterexamples/MapFloor.lean`: an order-preserving ring map need not preserve floor (off by one).
  `FloorRing` (`Mathlib/Algebra/Order/Floor/Defs.lean`) is defined as a Galois connection, which yields its laws.
- Solenoid hit the float version: 20 °F through base SI reads 19.999…, fixed by `roundAtLargerTerm`. Every snapping
  function after a conversion is a risk spot: INT, FLOOR, ROUND, DATETRUNC, WEEKNUM, bins.
- Test idea: for each snapping f and each display unit, f(read-back(x)) = f(x) on keyed values; plus the Galois laws
  (idempotent, monotone, floor(x + n) = floor(x) + n).

### F3. Kinds of nothing: identities versus junk

- Mathlib sets x/0 = 0, √(−1) = 0, log 0 = 0, a singular matrix's inverse = 0 (junk, never meant to be read), and
  separately the defaults the algebra forces: empty sum 0, empty product 1, det of 0×0 is 1, max of nothing is a new
  bottom (`WithBot`), not 0.
- Proposed rule of thumb for [[D96]] emptySlotShowsItsValue Fallbacks: a Fallback is safe when it is the identity of
  the operation the field feeds (0 into a sum, 1 as a divisor); where nothing has an identity, the field wants to be a
  Behavior or Required. A 0 feeding MAX or SQRT is junk.
- Solenoid's AVG([]) = null is better than mathlib's `Finset.expect` of empty (0) and than Excel.
- Unverified aside: a Frame with no columns can't hold a row count (it lives on the columns); mathlib's
  `Matrix (Fin 5) (Fin 0)` keeps the 5.

### F4. Aggregates have an algebra

- `exact_sum.rs` makes SUM order-free (a sum over a multiset) and `remove` makes it a group, which is what lets windows
  slide.
- Classes: group (SUM, COUNT: removable); semilattice (MIN, MAX: not removable, but double counting is harmless);
  tuple monoid (AVERAGE, VAR: count, sum, sum of squares); holistic (MEDIAN).
- A declared kind per aggregate would say which PIVOTBY and Rollup totals are honest (an average of averages is not),
  which can update incrementally ([[C120]] linearWork) and which parallelize.
- Test idea: mathlib's `Multiset` is a list up to permutation, so every order-free verb must survive a row shuffle.

### F5. The lattice and the Type Settle as order theory

- Diamonds: two coercion paths to one type must agree. Spot-checked list→matrix→frame against list→frame (both a single
  row): they agree. Test idea: every A→B→C in `accepts` equals A→C on sampled values ([[C10]] socketLattice).
- Termination: if each settle pass only moves types up a finite-height order, the Knaster–Tarski / Kleene fixed point
  (`Mathlib/Order/FixedPoints.lean`) guarantees termination and the caps (32, 8) are computable; the alternation of two
  systems is Bekić's principle. Run-time types ([[C136]] typesKnownAfterCalc) and the `trueany` veto may break that.
- Confluence: `coreSettle.test.ts`'s reverse-order run is an empirical Church–Rosser check (`Relation.church_rosser`,
  `Mathlib/Logic/Relation.lean`).
- Kleene logic is the most-defined monotone extension of AND and OR when unknown sits below TRUE and FALSE. The same
  view gives some cycles a least fixed point (`x = x OR TRUE` is TRUE) and numeric loops a convergence condition
  (`ContractingWith`).

### F6. Smaller observations

- Unit exponents are `f64` compared with `==` (`dim_equal`, `unit_dims.rs`): `m^0.1 · m^0.2 + m^0.3` would be `#UNIT!`.
  Mathlib would use ℤ or ℚ. Low risk (halves are exact).
- Schedule's forward pass is max-plus (tropical) algebra (`Mathlib/Algebra/Tropical/Basic.lean`).
- Run modes as functors and monads: By Row maps, Scenarios is the list monad, Monte Carlo binds in a probability monad
  (`PMF`, `Mathlib/Probability/ProbabilityMassFunction/Monad.lean`). For bundle 12's uncertain values: the value is a
  distribution, and ± or a range are two ways to key one in. The graph's fan-out knows shared inputs, which naive
  interval arithmetic gets wrong.
- Equation solver: the quadratic sniff guesses polynomiality by probing; a ring normalizer (mathlib's `ring`) decides
  it ([[C47]] equationNode). `root_holds` is already the answer-plus-cheap-check pattern of `linarith`/`polyrith`.

### F7. DTE and mathlib

| DTE / Solenoid | mathlib |
|---|---|
| a leaf's MUST cited by its test | a theorem and its proof |
| `*Unenforced:*`, Leaves the code breaks | `sorry`, `Wanted/` (`proof_wanted`), tech-debt counters |
| floor specs' `covers:` globs | the `DirectoryDependency` linter |
| the TS→Rust freeze, cover, delete | Mathport and its alignments |
| [[B7]] preAlphaBreakFreely | dated `deprecated` everywhere |

Worth borrowing: a counterexamples set (tests that fail if a rejected rule comes back, as `Counterexamples/` keeps
proofs that tempting ideas are false), and search by type (Loogle, `exact?`): "what takes a Frame and gives a number".

## Open threads (for the next passes)

1. Run F1 as a test on the branch: `(d1 + d2) / 2` beside `(a + b) / 2` over °C.
2. Prototype the F5 coercion-commutes sweep.
3. Prototype the F4 shuffle sweep over the order-free verbs and aggregates.
4. Classify every aggregate in `call_traits.json` by algebraic kind (F4).
5. Audit P7 Fallbacks against the identity rule (F3).
6. Read `settle.rs`: is adoption monotone? (F5)
7. Demonstrate the F6 exponent case in a test.
8. Unread mathlib areas: matrix conventions (det, inverse, rank) against MDETERM/MINVERSE; distribution
   parameterizations against `dists.rs`; variance conventions; GCD, LCM, MOD and QUOTIENT against `Int.emod`, `fmod`,
   `tdiv`; regular expressions (`Mathlib/Computability`) against `excel_regex.rs`; polynomial roots and `ring`;
   intervals (`Mathlib/Order/Interval`) for uncertain values.
9. Cycles as least fixed points (F5), and tropical sensitivity for Schedule (F6).

## Pass log

- **Pass 0 (2026-11-06, interactive):** the findings above, from the docs, the core's code and a read of mathlib.
