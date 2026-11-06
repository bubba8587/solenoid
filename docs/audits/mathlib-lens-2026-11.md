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
- Status: **verified** (pass 1, `crates/solenoid-core/tests/mathlib_lens.rs` `midpoints_of_dates_and_readings`):
  `(a + b) / 2` is `#TYPE!` over two dates and 25 °C over 20 °C and 30 °C; `a + (b - a) / 2` and `AVERAGE(a, b)` are
  the midpoint for both; `a + b` and `a * 2` are refused for both. Side fact: a reading minus a reading comes back as
  10 K with no display id, matching unit-flow's "Δ°C not built yet". The inbox item `dates-weigh-as-points` (on
  develop) carries the choice.

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
- **Empty aggregates, verified** (pass 1, `division_and_rounding_conventions`, over a list of two blanks and over
  no arguments):

  | Aggregate | Answer over nothing | The identity | Class |
  |---|---|---|---|
  | SUM, COUNT | 0 | 0 | identity (law-preserving) |
  | AVERAGE, MEDIAN, GEOMEAN | blank | none | honest blank |
  | PRODUCT | 0 | 1 | junk (Excel's answer) |
  | MAX, MIN | 0 | none (−∞ / +∞, mathlib's `WithBot` / `WithTop`) | junk (Excel's answer) |

  PRODUCT, MAX and MIN over nothing make up a 0, the confident number the value model otherwise refuses. It also
  sits badly beside formula-language's own reason for `0^0 = 1` ("the empty product is 1"), while `PRODUCT()` is 0.
  A one-line rule would cover all of them: **over nothing, an aggregate answers its identity where it has one, and
  blank where it has none**, so PRODUCT is 1 and MAX and MIN are blank. That breaks Excel parity for three functions
  ([[A5]] excelParity, [[A6]] divergeByDesign), so it is the author's call: proposed inbox item
  `aggregates-of-nothing` (not written, since passes don't edit `tree/`).
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
- **Shuffle sweep, verified for the formula aggregates** (pass 1, `aggregates_survive_a_shuffle`, 300 shuffles each,
  exact equality): SUM, COUNT, MIN, MAX, AVERAGE, MEDIAN, MODE.SNGL, GCD and LCM never move. PRODUCT, SUMSQ, DEVSQ,
  VAR.S, VAR.P, STDEV.S, STDEV.P, AVEDEV, GEOMEAN and HARMEAN move in the last bits (relative 3e-16 to 4e-15),
  SKEW by 6e-14 and KURT by 2e-12. Mathematically every one is a function of the multiset, so each move is float
  order, not meaning. Consequences: a Group By, a rolling window or a sorted criteria scan of these can disagree with
  a fresh formula in the last digits, which the spec promises only for the exact totals. SUMSQ and DEVSQ are sums and
  could run through `ExactSum` as SUM does; the variance family could sum its squared deviations exactly over the
  exact mean it already takes; PRODUCT and the means of logs need a different trick (sorted or compensated), or an
  accepted tolerance. Not yet swept: the frame verbs (Group By, Pivot, Rollup, Distinct) under a row shuffle.

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

- Unit exponents are `f64` compared with `==` (`dim_equal`, `unit_dims.rs`). **Verified** (pass 1,
  `fractional_exponents_compare_exactly`): `m^0.1 · m^0.2` has exponent 0.30000000000000004, and the formula
  `a^0.1 * a^0.2 + a^0.3` over a length is `#UNIT!` "Can't add values with different units", while
  `a^0.5 * a^0.5 + a` and `SQRT(a) * SQRT(a) + a` work. Mathlib would use ℤ or ℚ; rational exponents (or rounding an
  exponent to a small denominator) would close it. Low real-world risk.
- **Division conventions** (pass 1, verified): MOD floors (sign of the divisor, mathlib's `Int.fmod`), QUOTIENT
  truncates (`Int.tdiv`), as Excel. So the pair breaks the division law every mathlib pair keeps
  (`Int.fdiv_add_fmod`: d·q + r = n): `3 * QUOTIENT(-7, 3) + MOD(-7, 3)` is −4, not −7. `INT(n / d)` is the quotient
  that pairs with MOD. Parity keeps both as they are; the useful change is a hint in MOD's or QUOTIENT's description,
  and a law test that pins which pairs hold. ROUND is half away from zero (Excel), where mathlib's `round` is half up.
  GCD of a negative is `#DOMAIN!` (Excel's `#NUM!`); mathlib's `Int.gcd` takes absolute values.
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

## Landed in the specs (develop 4b7b526, 2026-11-06)

The vocabulary from F1, F3 (Kleene), F4 and F5 is now spec text: `value-semantics` § Points and differences (the one
home for point kinds and point weight) and the Kleene paragraph, `socket-lattice` § The shape of what connects and the
Type Settle as a fixed point, `unit-flow` (dimensions as exponent vectors, offset units as point scales, why snapping
needs the read-back rounding), `formula-language` "What a total can be built from", glossary entries, and the inbox
item `dates-weigh-as-points` for F1. A pass should build on those, not redo them.

**New, verified against `fixtures/core/lattice.json.gz`:** over the 25 concrete socket types, `connects` minus the 7
combo-to-scalar narrowing edges is reflexive and transitive (a preorder); with them, 11 chains fail to compose
(`list` reaches `numlist`, `numlist` reaches `number`, `list` does not reach `number`). Wildcards don't compose either.
No test holds it yet: a candidate prototype (thread 2b).

## Open threads (for the next passes)

1. Prototype the F5 coercion-commutes sweep.
2. A test holding the widening preorder and the non-composing narrowing edges (from the lattice fixture).
3. Extend the shuffle sweep (F4) to the frame verbs: Group By, Pivot, Rollup, Distinct, and the criteria aggregates.
   Also try `ExactSum` under SUMSQ and DEVSQ in the prototype and see whether they stop moving (F4).
4. Classify every aggregate in `call_traits.json` by algebraic kind (F4).
5. Audit P7 Fallbacks against the identity rule (F3).
6. Read `settle.rs`: is adoption monotone? (F5)
7. The empty-aggregate rule (F3): list every aggregate's answer over nothing (the cards too, and the frame verbs),
   to size the proposal.
8. Unread mathlib areas: matrix conventions (det, inverse, rank) against MDETERM/MINVERSE; distribution
   parameterizations against `dists.rs`; variance conventions; regular expressions (`Mathlib/Computability`) against
   `excel_regex.rs`; polynomial roots and `ring`; intervals (`Mathlib/Order/Interval`) for uncertain values.
9. Cycles as least fixed points (F5), and tropical sensitivity for Schedule (F6).

## Pass log

- **Pass 0 (2026-11-06, interactive):** the findings above, from the docs, the core's code and a read of mathlib.
- **Spec pass (2026-11-06, interactive):** the definitions moved into the specs on develop; the lattice preorder check.
- **Pass 1 (2026-11-06 07:40 UTC):** added `crates/solenoid-core/tests/mathlib_lens.rs` (4 probes, all pass). Verified F1
  (dates refuse the midpoint readings take), the F6 exponent case end to end, the shuffle sweep over 21 aggregates
  (9 order-free, 12 move in the last bits), division and rounding conventions (MOD and QUOTIENT break the division
  law), and empty aggregates (PRODUCT, MAX, MIN make up a 0). Old threads 1 and 7 closed and the list renumbered.
