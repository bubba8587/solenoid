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

  **Census of every range function** (pass 2, `every_range_function_over_nothing`, one argument holding two blanks or
  an empty list; functions that need a second argument answer `#VALUE!` and are left out):
  - the identity, correctly: SUM, COUNT, COUNTA, SUMSQ, SUMPRODUCT (0), MULTINOMIAL (1), CONCAT and TEXTJOIN (`""`);
  - an honest blank: about 45 statistics (AVERAGE, MEDIAN, the STDEV and VAR families, the percentiles and quartiles,
    GEOMEAN, HARMEAN, SKEW, KURT, CORREL and the regression pairs, the rank tests);
  - a made-up 0: PRODUCT, MAX, MIN;
  - an error where an identity exists: AND (identity TRUE), OR and XOR (FALSE), all `#VALUE!` as in Excel; GCD
    (identity 0) and LCM (1), `#VALUE!` (mathlib: `Finset.gcd ∅ = 0`, `Finset.lcm ∅ = 1`).

  PRODUCT, MAX and MIN over nothing make up a 0, the confident number the value model otherwise refuses. It also
  sits badly beside formula-language's own reason for `0^0 = 1` ("the empty product is 1"), while `PRODUCT()` is 0.
  A one-line rule would cover all of them: **over nothing, an aggregate answers its identity where it has one, and
  blank where it has none**, so PRODUCT is 1 and MAX and MIN are blank. That breaks Excel parity for three functions
  ([[A5]] excelParity, [[A6]] divergeByDesign), so it is the author's call. Sized: three certain changes (PRODUCT to
  1, MAX and MIN to blank) and five judgment calls (AND's vacuous TRUE may read worse to a user than an error;
  GCD and LCM of nothing are rarely asked). Proposed inbox item
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
  could run through `ExactSum` as SUM does (**verified feasible**, pass 2, `exact_sums_of_squares_are_order_free`:
  over 4000 shuffled pairs, today's SUMSQ and DEVSQ disagreed with themselves 2119 times, the same sums through
  `ExactSum` (DEVSQ over the exact mean) 0 times); the variance family could sum its squared deviations exactly over the
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
- **Read** (pass 3, `settle.rs`): each adoption pass recomputes every port from what currently feeds it (it assigns,
  it never joins with the old type), visiting cards in graph order. On a graph without loops that makes each port's
  type a function of the ports upstream of it, so the answer is fixed by the wiring by induction on depth: order
  independence there is a theorem, not luck, and monotonicity is not needed. Only the pass count depends on order:
  one pass when the cards are listed with the wiring, one per card of the longest passthrough chain when listed
  against it. Loops (the `#CIRC!` members) are the only place an answer could depend on order or fail to settle.
- **Verified** (pass 3, `crates/solenoid-graph/tests/mathlib_lens_settle.rs`): a number source feeding a chain of
  N passthroughs settles to `number` at every N when listed with the wiring; listed against it, it settles up to
  N = 256 and leaves the tail `trueany` from N = 257. 256 is the real cap (8 rounds of 32 passes, since a round that
  still changed starts another), not the 32 the spec names. Consequences: (1) a free speedup and a correctness fix
  in one: visiting the cards in topological order (the engine already orders them for the pass) settles any graph
  without loops in one pass, and leaves the caps guarding only loops; (2) socket-lattice req. 9's "at most 32 passes"
  and "a chain of N passthroughs settles in at most N passes" should say 256 and "listed against the wiring". A
  257-card backwards chain is not a real graph, but a large graph built bottom-up costs one pass per level today.
- **Loops, verified** (pass 4, `a_loop_through_an_agreeing_card`, `a_loop_of_passthroughs_alone`): an IF-like card
  whose one branch is a number and whose other branch is its own output fed back through a passthrough has two
  consistent typings, "all unknown" and "all number". The settle picks "all unknown" (`trueany`) in all three visit
  orders tried, and a bare loop of two passthroughs stays `trueany` too. In order terms it computes the least fixed
  point starting from unknown, the cautious answer, and the `trueany` veto in the vote is what keeps it there. That
  is fine: loop members compute as `#CIRC!`, so there is no value whose type could be wrong.
- **Coercions along paths, verified** (pass 6, `coercions_agree_along_widening_paths`, `coerce_all` natively, 15
  sample values, every widening chain A to B to C among the concrete types): of 405 paths, 301 agree and 104 don't.
  None is unexplained:
  - 85 cross the logical bridge: 5 through a logical socket is TRUE, then 1. The bridge is lossy, so logical and
    number reach each other both ways without being the same type, and coercions through it can't agree. Expected
    and by design; the spec should say the agreement holds for paths that don't cross the bridge.
  - 10 differ only in metadata: through a Frame, a Cube's column keeps its type (`Number`); straight to a Cube it has
    none. Harmless, and the Frame route is the better one.
  - 9 are a real if minor incoherence: the matrix rungs of the logical, string and date families don't shape what
    arrives (`logicaltable | strtable | datetable => cells()`, `boundary.rs`). A string wired into a `strtable` socket
    arrives as a bare string, a list as a list, while number's `table` rung widens both to a matrix. So a body on such
    an input can receive rank 0, 1 or 2 depending on the route. socket-lattice § Enforcement says those rungs pass
    values through "since their producer already shaped them"; the sweep shows a widening cable is a producer that
    didn't. The `socket-lattice` paragraph written on develop this session ("Coercions agree along paths ...
    spot-checked") needs both refinements.
- **The widening preorder now has a native test** (pass 4, `widening_is_a_preorder_and_narrowing_does_not_compose`,
  against `lattice.rs` itself rather than the fixture): over the 25 concrete types, `can_connect` is reflexive,
  widening composes through every chain, the seven narrowing edges are exactly the combo-to-scalar ones, and
  `list` to `numlist` to `number` connects hop by hop while `list` to `number` does not. Ready to move to develop
  as the test socket-lattice § The shape of what connects says it lacks.
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

### F8. Matrix conventions, and a scale bug in MDETERM and MINVERSE

- Mathlib: the determinant is defined for every square matrix and is a polynomial in its entries: singular matrices
  have determinant 0, the 0×0 matrix has determinant 1 (`Matrix.det_isEmpty`), and scaling a matrix by c scales the
  determinant by cⁿ (`Matrix.det_smul`). The inverse of a singular matrix is 0 by convention
  (`Matrix.nonsing_inv_apply_not_isUnit`), junk in our sense.
- **Verified** (pass 2, `matrix_conventions`): MDETERM of a singular matrix (`[[1, 2], [2, 4]]`, `[[0]]`) is
  `#DIV/0!` "Matrix is singular", where the determinant is 0 (Excel answers 0). The spec documents it
  (formula-language § Matrices and dynamic arrays: "answer `#DIV/0!` for a singular one"), but it is not in
  `excel-divergences.md`, and a determinant of 0 is an answer, not a division.
- **Verified, and worse:** the pivot check is absolute (`max_val < 1e-14`, `mat_det` in `fns_matrix.rs`), so the
  answer depends on the scale of the numbers. `MDETERM([[1e-15]])` is `#DIV/0!` (the determinant is 1e-15), and
  the diagonal matrix of 1e-15 and 1e15, whose determinant is exactly 1 and whose inverse is exact, is `#DIV/0!` for
  both MDETERM and MINVERSE. A matrix keyed in small units (a strain, a probability product, a currency in millions)
  can hit it. `det(cA) = cⁿ det(A)` is the law a fix would be tested against: a relative pivot test (against the
  column's or matrix's scale) for MINVERSE, and for MDETERM no test at all (a zero pivot means the determinant is 0).
- **Scale sweep, verified** (pass 3, `matrix_functions_under_scaling`, `_one_row_scaled`, `_one_column_scaled`, a
  well-conditioned symmetric 3×3, checked against each function's scaling law to 1e-9):
  - uniform scaling c·A from 1e-12 to 1e15: every function keeps its law; at 1e-15, MDETERM, MINVERSE and SOLVE fail.
    PINV, MATRIXRANK and EIGENVALUES keep their law at every scale (their cutoffs are relative to the matrix).
  - one variable in other units (a column scaled by c): SOLVE fails from c = 1e-13 (its cutoff is an absolute 1e-12,
    `solve_linear`), MDETERM and MINVERSE from 1e-15 (an absolute 1e-14).
  - one equation in other units (a row scaled by c): partial pivoting rescues it until 1e-15.
  - the regressions (pass 4, `regression_under_scaled_x`): SLOPE, INTERCEPT, LINEST, TREND and RSQ keep their laws
    with x scaled anywhere from 1e-15 to 1e12; they center the data, so no cutoff is involved. LINEST is single-x
    (`[slope, intercept, R²]`, as formula-language documents), so multiple regression has no case to probe.
  - So the trouble is three functions, two absolute cutoffs. Coefficients typed in SI base units reach these scales
    (picofarads, nanoseconds squared, Boltzmann's constant at 1.4e-23). The fix shape is the one MATRIXRANK already
    uses (`tol * scale`), and the law sweep is the test that would hold it.
- **The Equation card, verified wrong answer** (pass 5, `equation_with_small_knowns`, the card body through
  `nodes::reply`, [[C47]] equationNode): `C = k * x * x * x` with k = 1e-15 and C = 8e-15 answers **x = 8**; the
  answer is 2. At k = 1 down to 1e-12 it answers 2 (by bisection, 2.000000000000284), and `C = k * x^3`, where x
  appears once and isolation inverts it, answers 2 at every k. The cause, read from `nodes/formula.rs`: the quadratic
  sniff's tolerance and `root_holds` both floor their scale at 1 (`jmax(&[1.0, ...])`), so when every residual is
  below about 1e-9 the cubic passes as a line, `solve_linear` gives −c/b = 8, and the plug-back check accepts a
  residual of 5e-13 as zero. The spec's own words ("a miss beyond 10⁻⁹ of the local scale") intend a relative test;
  the floor of 1 makes it absolute for small equations. The law a fix would be tested against: an equation's
  solutions don't change when both sides are multiplied by the same nonzero k. A quadratic with tiny k
  (`0 = k * (x*x - 5x + 6)`) still solves to 2 and 3, so only the "not a polynomial" check is fooled.
- **The Equation's other layers** (pass 6, same test): a tiny pole equation `0 = k/(x-3) + k/(x-3)` with k ≤ 1e-12
  answers the right outcome for the wrong reason, `#SOLVE!` "the quadratic's discriminant is negative" (the sniff
  took it for a quadratic; at k = 1 it says "No solution found between ±10¹²"). A tiny exponential
  (`0 = k*EXP(x) - 2k + 0*x`) solves to ln 2 at every k, because EXP's growth pushes a probe past the floor. A real SI
  equation with the unknown twice, a diode with series resistance (`I = Is*(EXP((V - I*R)/Vt) - 1)`, Is = 1e-14),
  solves to 0.000115080558, matching an independent bisection to 1e-12. So the floor bites only when every residual
  at the probe points is below about 1e-9: tiny polynomial-looking or flat equations.
- Read, not run: the MDETERM *card* answers 1 for a 0×0 matrix (`nodes/matrix.rs`, mathlib's convention), while the
  formula `MDETERM` of an empty list is `#SHAPE!`; whether a card can ever receive a 0×0 matrix is unchecked.
- This is the pass's strongest result: a backlog-grade bug, not a research question. It belongs in `docs/backlog.md`
  on develop once the author has seen it (passes don't touch develop).

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

3. Extend the shuffle sweep (F4) to the frame verbs: Group By, Pivot, Rollup, Distinct, and the criteria aggregates.
4. Classify every aggregate in `call_traits.json` by algebraic kind (F4).
5. Audit P7 Fallbacks against the identity rule (F3).
6. F5 follow-ups: a loop through a Conduit (the lane typing alternates with adoption); can it oscillate across the
   8 rounds?
7. The empty-aggregate rule (F3): the cards (Aggregate) and the frame verbs (Group By over an empty group, Rollup)
   over nothing; the formula functions are censused.
8. F8 follow-ups: whether the MDETERM and MINVERSE *cards* share `mat_det`; a list of every tolerance in the core
   with a floor of 1 or an absolute cutoff (`1e-9`, `1e-12`, `1e-14` greps), each classed relative or absolute.
1. F5 follow-up: which card bodies read a `strtable`, `datetable` or `logicaltable` input, and do they all handle a
   scalar or a list arriving there?
9. Unread mathlib areas: distribution parameterizations against `dists.rs`; variance conventions; regular expressions (`Mathlib/Computability`) against
   `excel_regex.rs`; polynomial roots and `ring`; intervals (`Mathlib/Order/Interval`) for uncertain values.
10. Cycles as least fixed points (F5), and tropical sensitivity for Schedule (F6).

## Pass log

- **Pass 0 (2026-11-06, interactive):** the findings above, from the docs, the core's code and a read of mathlib.
- **Spec pass (2026-11-06, interactive):** the definitions moved into the specs on develop; the lattice preorder check.
- **Pass 1 (2026-11-06 07:40 UTC):** added `crates/solenoid-core/tests/mathlib_lens.rs` (4 probes, all pass). Verified F1
  (dates refuse the midpoint readings take), the F6 exponent case end to end, the shuffle sweep over 21 aggregates
  (9 order-free, 12 move in the last bits), division and rounding conventions (MOD and QUOTIENT break the division
  law), and empty aggregates (PRODUCT, MAX, MIN make up a 0). Old threads 1 and 7 closed and the list renumbered.
- **Pass 2 (2026-11-06 08:40 UTC):** three more probes. Censused every range function over nothing (F3); showed
  `ExactSum` makes SUMSQ and DEVSQ order-free (F4); found MDETERM and MINVERSE answer `#DIV/0!` for singular
  matrices and, through an absolute pivot tolerance, for well-conditioned matrices of small or mixed-scale numbers
  (F8, new). Matrix conventions moved out of the unread list.
- **Pass 3 (2026-11-06 09:40 UTC):** scale-law sweep over six matrix functions (F8: SOLVE, MDETERM, MINVERSE
  break at 1e-13 to 1e-15 through absolute cutoffs; PINV, rank and eigenvalues hold), and the settle read plus a
  native probe (F5: the answer is fixed by the wiring on graphs without loops; listed against the wiring, chains past
  256 cards are left untyped; a topological visit order settles in one pass). Threads 6 and 8 rewritten.
- **Pass 4 (2026-11-06 10:40 UTC):** settle on loops (least fixed point, `trueany`, order-independent), the widening
  preorder as a native test against `lattice.rs` (holds), and the regressions under scaled x (hold; only SOLVE,
  MDETERM and MINVERSE break). Threads 2 closed; 6 and 8 rewritten.
- **Pass 5 (2026-11-06 11:45 UTC):** drove the Equation card natively with scaled knowns: a silent wrong answer
  (x = 8 for a true 2) when every term is around 1e-15 and x appears more than once, from a tolerance floored at 1
  (F8). Thread 8 rewritten toward the numeric layer's pole test, which has the same floor.
- **Pass 6 (2026-11-06 12:45 UTC):** the coercion sweep over 405 widening paths (104 differ: 85 by the lossy bridge,
  10 metadata, 9 from the unshaped non-number matrix rungs), and the Equation's other layers (a tiny pole errors with
  the wrong message; exponentials and a real diode equation solve right). Threads 1 and 8 rewritten.
