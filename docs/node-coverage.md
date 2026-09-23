# Node coverage

This is the inventory of Solenoid's cards: what each one does as a user sees it, grouped by family, with the notes a newcomer would not guess. `nodeCatalog.ts` is the source of truth for the catalog itself: the Add menu and the in-app Function Reference (Ctrl+/) are generated from it, so a node's catalog `description` is its Reference entry. Mechanics that need a spec of their own live in `tree/specs/`, and each entry here points at it. Update this file when the catalog changes meaningfully.

## How the catalog is organized

**Multi-op declarations (`nodeOps.ts`).** There is one declaration per op family, a node class with an `op` field.

- `expose` is the menu axis. `"collapsed"`, the default, gives one Add-menu leaf with every op reachable from search ("Chart: Column"). `"leaves"` generates a leaf per op. A family earns per-op leaves deliberately; the default keeps dropdowns from spraying the tree.
- The `{ }` marker is derived, never declared. It shows when the node has ops without a leaf of their own; `mark: false` suppresses it for labels that already enumerate ("GCD / LCM").
- There is no semantic axis. A family is in `nodeOps.ts` because its `op` values are ops. An argument (a sort order, an aggregator, a view) is stored under its own name, picked with `ArgSelect` or `SegToggle`, and not declared ([[C26]] opArgDistinct; `DESIGN.md` § Op pickers).

**The Add-menu row budget.** A category pane holds about 12 rows before it needs a scrollbar, so a pane growing past about 12 folds its tail into subcategories rather than staying flat. This rule is behind every catalog regrouping (charts, statistics, hyperbolics, bitwise, the frame verbs, and control widgets folded into Input so Packs could have a top-level row). A new node that flattens a pane back past the budget brings the scrollbar back.

### Node design rules

These are the author's standing calls about the shape of a card.

- **Scalars get fine-grained one-op nodes; lists and tables get bundled, task-shaped nodes with op selectors** (one Aggregate with an op selector, not five separate sum and average nodes). A variant is a mode or op selector on the existing card, never a sibling node ([[B11]] maximalMerge).
- **Aligned parallel columns are one Frame input, not parallel list sockets** (charts, SUMIFS, the frame verbs). Outputs follow the same rule: correlated lists (the t and y of a solution, the parts of a decomposition) leave as one Frame, never as parallel list sockets. This is about row-aligned data, a value per row; that is why the Allocator's per-category weights are a Weight column, not a socket. A vector that runs orthogonal to the Frame, one value per column like Decision Matrix's per-criterion weights, is not parallel data and stays a list socket.
- **A node that takes a user formula takes it as a LAMBDA input** (`lambdaIn` + `lambdaSig` + `resolveFn`, the λ family in `tableLambda.ts`), never as a string socket holding an expression.
- **Meaningful differences from Excel**, especially ones that change an output, go in the catalog as `parity: false` with a note (`nodeExcel.ts`).

### Labeled slots versus a list input

This is the variadic-node rule (background in `docs/archive/node-arity-audit.md`). A variadic node uses individually labeled, individually wireable scalar rows (the `ExtensibleInputs` / `PairedExtensibleInputs` pattern), not a single list or table socket, when each input plays a distinct role: positional (CHOOSE's value per index) or paired (IFS and SWITCH's condition and result). The label is the affordance: it says what each slot does and what an edit affects, while a raw list of paired values hides the pairing. Separate sockets also let each input come from a different upstream card.

Use a single list socket only when the elements are interchangeable: all the same role, where order may matter but identity and pairing don't (SUM, AVERAGE, AGGREGATE, the List literal). The litmus test: if explaining the list takes "the 2nd element means X, the 3rd means Y", it should be labeled slots.

### Picking a socket by the input's role

The socket type both gates connections (`canConnect`) and drives coercion at the engine boundary (`coerceInputs.ts`), so it must match what `data()` actually consumes. Every node input has been audited against its `data()`.

- **Element-wise operand**, paired with each element through a broadcaster: the family's combo, `numlist`, `strcombo`, `datecombo`, `logicalcombo` or `complexcombo`. An operand can be a per-element vector, as in Excel's `=ROUND(A1:A10, B1:B10)` or `=LEFT(A1:A10, B1:B10)`.
  - This covers Arithmetic's `a` and `b`; the secondary operands `RoundN.digits`, `Clamp.min` / `max`, `MRound.multiple` and `Gcd.b`; every date operand (DatePart, DateAdd, DateDiff, DATEDIF, WORKDAY, NETWORKDAYS, DATE, TIME); every text operand (UPPER, LEN, LEFT / MID / RIGHT, FIND, SUBSTITUTE, REPLACE, REPT, CHAR / CODE, TEXTAFTER / BEFORE, EXACT, NUMBERVALUE, ROMAN / ARABIC, FIXED, DOLLAR, ENCODEURL, Reverse Text, Spell Number); and every complex operand (COMPLEX, IM Unpack, the IM unary and binary ops, IMPOWER, Quadratic Roots).
  - All five families are swept, so a combo rung with no node using it is a bug, not a gap.
  - Don't narrow these to the scalar rung: that breaks list broadcasting. The combo is pure widening. It accepts everything the scalar did and feeds everything the scalar fed (combo to scalar is an explicit lattice edge), so switching one breaks no existing cable.
- **Structural control parameter** (a count, index, window size, polynomial or Bessel order, numeric base, mode or type flag): `number`, or a scalar `string`. It has no per-element meaning, so a list there is a real mistake the socket should block. The test is whether the value describes one operation over the whole input or varies per element. Examples: `Take.count`, `Running.window`, `Combinatorics.n` / `k`, `BaseConvert.from` / `to`, `Slice.start` / `end`, distribution evaluation points and parameters, every finance scalar (rate, nper, pmt, pv, fv, basis), WEEKDAY's `return_type`, YEARFRAC's `basis`, WORKDAY's `weekend_code`, NUMBERVALUE's separators. A per-element numeric operand is not this: `LEFT.n`, `MID.start` / `len`, `REPLACE.start` / `num_chars`, `REPT.times` and `FIXED.decimals` are combos.
- **1-D list or sample data**: `list` (`strlist`, `datelist`). Stats samples, cash-flow arrays (NPV, IRR, XIRR), Filter's `mask`.
- **2-D matrix**: `table` (numbers), `strtable` (text), `datetable` (dates), `complextable` (complex). A **table with named columns** is `frame`. Matrix ops take `table` and Frame ops take `frame`. A 2-D output never narrows into a 1-D or 0-D input, and a lower rank widens up: a list into a matrix or Frame (as a single row), a matrix into a Frame.
  - Element-agnostic 2-D inputs use the grid socket `anyTableIn` (TRANSPOSE, HSTACK, CHOOSEROWS / COLS, reshape-flatten, the MAP / BYROW / REDUCE values). They render as a grid, and a 1-D list widens in.
  - TableInfo (ROWS, COLUMNS) is `frame`-typed, so a matrix, list or scalar widens in.
  - Get Column can read a column as Boolean: a logical column leaves as a real logical list, with 0/1 and true/false converted.
- **Recursive nested table**: `cube`, the top of the lattice. A Frame whose cells can hold any value, a nested Frame or Cube included.
  - Producers: **Nest Join** (nests two Frames on a shared key into a Cube of sub-frames, tidyr's `nest_join`, the dual of a flat Join) and **Build Cube** (extensible `trueany` cells into one column, each cell any value). Nest Join also takes a Cube as parent and nests one level deeper into its sub-frames; a wired parent that is neither is `#TYPE!`, and an unwired parent gives blank.
  - **Cube Columns** builds a Cube from extensible `trueany` rows, one row per column: a wired list gives its elements as the cells, a single-column Cube gives that column's cells, and a Frame or scalar gives one cell. Shorter columns pad with blanks, and an unnamed column is `Col<n>`.
  - Access: **INDEX** is `trueany` in and out and reads a cell out of a list, matrix, Frame or Cube; a nested Frame or Cube comes out whole. A blank or 0 Row gives the whole column and a blank or 0 Column the whole row (Excel's `INDEX(range, 0, col)`); both blank passes the container through. Slices follow the accessor conventions: a Frame row is a one-row Frame (Get Row), a Frame column is a list (Get Column), Cube slices stay Cubes with nested cells whole, and matrix slices are 1-D lists. The Row and Column fields default empty, with an `[all]` placeholder.
  - **Cube Rollup** (`CubeRollupNode`) goes the other way: it aggregates a column inside each row's nested sub-frame (the full 12-op AggOp set, reusing GROUPBY's `aggregateGroup`) and flattens the Cube back to a Frame with the roll-up appended. That is the bill-of-materials shape: an assembly's cost is the SUM of its nested parts. See the rollup row in the `cubes` seed.
  - Display: `CubeDisplay` and the drill-in `CubePopup`, which shows depth and lets every nested cell (Cube, Frame, list) drill in place along one breadcrumb. The cached `depth` counts Cube-in-Cube only; a nested Frame is a leaf. Full detail: `docs/archive/cube-node-scope.md`.
- **Genuinely type-agnostic**: the wildcard ladder ([[D15]] wildcardsKeepRank). `any` (a gray circle, one value of any family), `anycombo`, `anylist` and `anytable` (its 1-D and 2-D siblings), `anydata` (anything up to a matrix) and **`trueany`** (a hollow gray circle), which accepts anything.
  - `trueany`: Cast, Display, the Test inspector, Input Switch, unwired Conduit lanes, the selectors, Report references, Placeholder and composite ports.
  - Expression's variable inputs are `anydata`: scalars, lists and matrices in, Frames and Cubes never ([[C15]] matricesInFormulas). LAMBDA's capture sockets stay `anylist`.
  - The polyform producers declare their output element type with a Number / Text / Date / Auto result-type selector that swaps the output socket at the node's rank (Auto is `any` at scalar or combo rank and `anytable` at matrix rank). A matrix result swaps to the family's matrix rung in place ([[D16]] retypeReconciles).
  - REDUCE's iterable `values` and the MAP and BYROW table inputs are `anyTableIn` grids; the scalar seed is `anylist`.

The governing principle: keep types separate (a Cast crosses element families, and logical to number is the one bridge) and let dimensions flow (lower ranks widen into `anytable` and `frame`). The spec is `../tree/specs/values/socket-lattice.md`, machine-checked by the full sweep in `socketConnect.test.ts`.

## Scalar

- Input, Constant, Arithmetic (all ops), Math functions, Rounding, Trig, Hyperbolic, Logarithms, Combinatorics, Bitwise, Engineering.
- **Trig angle mode.** A Math node's trig ops carry a deg / rad / Auto SegToggle. Auto, the default, reads the incoming unit, so a °-tagged value computes in degrees and anything else in radians, as in Excel; Rad and Deg pin it. Forward trig converts the input, and inverse trig converts the result and tags the `deg` unit. `trigMode.ts` resolves it at recompute time, the one place compute reads units.
- **Comparison and Boolean logic** emit the first-class logical type (purple, TRUE/FALSE, converting to and from 1/0). AND, OR and NOT are Kleene three-valued on `null`.
  - **`BooleanOpNode`**: AND, OR, XOR, NAND, NOR and XNOR as reducers over extensible operand rows, all emitting logical, so switching the op never swaps the socket. Operand inputs are `logicalcombo`, since a Boolean op takes Booleans; a number still bridges in (0/1 to FALSE/TRUE). The rows are wire-only, like IF's condition: you wire in a comparison or test.
  - **`NotNode`**: a unary element-wise flip.
- **The value selectors**, all variadic: **IF** (`IfNode`, a value passthrough, `util`-colored like its siblings, not logical), **IFS** (any number of condition and value pairs, plus an Otherwise fallback), **SWITCH** (any number of when and then pairs between a fixed `expr` and `default`) and **CHOOSE** (add and remove value rows over a fixed `index`). They use labeled rows, not list sockets (see *Labeled slots* above and `docs/archive/node-arity-audit.md`).
- IFERROR and NA.
- **Type Check** (`IsTestNode`): an op dropdown of ISNUMBER, ISNULL, ISBLANK, ISERROR, ISNA, ISLOGICAL, ISTEXT and ISNONTEXT. The `islogical` op value keeps its name, and its label is ISLOGICAL, the real Excel name ([[D23]] capsClaimsFunction). ISNULL is the per-cell missing test, which is not the same as unwired. Every check tests per cell to any depth, Frames included. It doubles as the error-inspection surface (`../tree/specs/values/error-values.md`).
- **ISEVEN / ISODD** (`IsEvenOddNode`): one parity node with an even / odd toggle, emitting TRUE/FALSE (not 1/0) and broadcasting over a list. It lives in the Logic menu.
- **Alert**: watches a value and, on a changed trigger, shows a toast and logs to the Alerts HUD (`../tree/specs/computation/alert-node-alerts-hud.md`).
- **Between** (inclusive Low ≤ Value ≤ High) and **Is Close** (|A − B| ≤ tolerance): `numListIn` predicates that broadcast like Comparison, with `logicalcombo` out.

## Lists

- **Literal** and **Series**: one list-generator node with Range, SEQUENCE, LinSpace, Geometric, Fibonacci and Repeat as ops. Start is shared, so switching ops keeps the cable.
- **Aggregate** (`AggregateNode`): a fixed-op 1-D reducer with 20 ops (sum, avg, min, max, count, countdistinct, median, product, stdev, var, geomean…). It isn't called Reduce, so it can't be confused with the REDUCE LAMBDA helper, which takes a table.
- **List Filter**: 1-D only, filtering a list against its own values with the Frame Filter's condition engine (extensible AND / OR op and value rows, text ops, Match case), on an `anylist`. Tables go to Frame Filter, which a matrix enters with auto-named columns Col1…N. The permanent `Dropped` output is the exact complement.
- **Fill** (`FillNode`): the missing-value node, with ops constant, ffill, bfill, mean, median, mode, interpolate, drop and coalesce. Per-cell errors pass through, and the statistics impute from the present values. Coalesce reads its Else rows in order: a wired row contributes its list and may lengthen the output, an unwired row's typed number broadcasts to every position without lengthening it, and an untouched row contributes nothing. A wired blank Fill value fills missing cells with blank, not the number typed on the card.
- List Sort, Reverse, Slice, Unique, Diff, Interleave, Pad, Shuffle, NthElement, Index, Length, Contains, NthValue, ArgMin / ArgMax, SumProduct. Take and Drop are the one rank-preserving `TakeDropNode` under 2-D Tables ▸ Select: a list, matrix or scalar in, the same rank out.
- **Position-only ops are passthroughs.** Reverse, Slice, Shuffle, NthElement, Interleave and Pad are element-agnostic `anylist` ops. The single-input ones (Reverse, Slice, Shuffle, NthElement, Pad, plus the matrix ops TRANSPOSE, CHOOSEROWS / COLS, TAKE / DROP and EXPAND) have adoptive inputs and outputs and a `passthrough()` declaration, so a reversed or transposed date list stays a date list with date formatting downstream. The multi-input rungs of the append ladder (Concat Lists, Interleave, VSTACK / HSTACK) declare `agree` over their rows, and the rank-changing TOCOL and WRAP ops declare a rank projection. See `nodes/passthrough.ts` and `../tree/specs/values/type-propagation-on-in-place-socket-retype.md`.
- **Set** (`SetsNode`): one card for eight ops. The four operations (union, intersection, difference A ∖ B, symmetric difference) give a list; the four relations (equal, subset A ⊆ B, superset A ⊇ B, disjoint) give TRUE or FALSE, and the output socket swaps between list and logical with the op (`applySetOp`, as Split Frame swaps its Matrix). Members compare by value (`setKey`, so two equal complex numbers match), in first-seen order with UNIQUE's dedupe. Blank and error cells are never members; an operation still passes an error cell through, except intersection. The empty set follows set theory: it is a subset of anything, disjoint with anything, and equal only to itself. With neither side wired, a relation is blank. Excel ships only UNIQUE. Is In and Tally, which share the membership rules, are in the Sets & Membership pack.
- **Concat Lists**: the 1-D rung of the append ladder. Any number of element-agnostic `anylist` rows joined in row order; a scalar widens to a one-item list.
- **Running** (`RunningNode`): an aggregate per element over a window ending at it. The Window input is always there: 0, the default, is cumulative from the start, and N slides over the last N elements, running short at the start ([[C60]] oneRunningNode). Seven aggregators, picked as the `agg` argument: sum, avg, min, max, median, product, stdev. On the formula surface it is one function, `RUNNING(op, list, [window])`, with the aggregator as a string argument ([[C26]] opArgDistinct).
- **Rank & Percentile**: one order-statistics node with LARGE / SMALL, RANK.EQ / AVG and PERCENTILE / QUARTILE / PERCENTRANK, including the INC and EXC forms, as ops. Each takes a list and one scalar (a k, a value, a p or a quartile) and gives a number; PERCENTILE and PERCENTRANK are each other's inverse. RANK and PERCENTRANK share the Value key. Missing cells are skipped and errors propagate. An out-of-range INC quartile is blank on the card, where the QUARTILE formula gives `#DOMAIN!`: a deliberate difference.
- Normalize (a 0–1 / z toggle), Standardize, Correl, Covariance, Fisher. Standardize's zero sigma and Fisher's out-of-domain value (outside −1 to 1) are per-cell errors in a list.
- **The pair policy.** Correl, Covariance, Regression, Forecast and Interpolate read two lists pairwise, shared with their formulas (`pairPresent`): the first cell error propagates, a pair missing either side drops, and ragged tails truncate.
- **Regression:** LINEST (a linear / exponential toggle that absorbs LOGEST; the three outputs retitle between slope / intercept / R² and m / b / R²-log, with keys unchanged so cables survive; the exponential fit needs every y above 0, else `#DOMAIN!`, and zero X variance is `#DIV/0!`), FORECAST.LINEAR (a linear / exponential toggle that absorbs TREND and GROWTH; X may be a scalar or a list and the result mirrors its shape; an unwired X predicts nothing, zero X variance is `#DIV/0!`, and too few points stay empty), STEYX, Poly Fit, Grid Interpolate.
- **Interpolate**: two modes, and the mode swaps the whole socket set. List interpolates y for a query X between known (x, y) points, clamping at the ends; a blank query stays blank in place, and no known points give an empty list. Grid fills the blanks of a Z table, with optional Xs and Ys lists beside it (unwired means 1, 2, 3…, a wired blank gives a blank result); its Forecast checkbox, on by default, also extrapolates linearly beyond the known data, and the filled table keeps the input's unit. The grid mechanics are `../tree/specs/computation/bordered-grid-fill.md`.
- **Transform** (each also a formula): DIFF (a Δ / % / ∇ gradient toggle), Shift (blank, or wrap like `numpy.roll`), Bin (digitize), EWMA, Convolve, Integrate (trapz), Run Lengths (rle, into a value and count table). **Build:** Combinations (a combos / perms toggle, capped at 10k rows). Toggle cards share `makeToggleNodeComponent` (`standardNode.tsx`).
- **Mode**: one mode gives a scalar and a tie gives the full list, so no arbitrary tie-break is needed (this supersedes Excel's MODE.SNGL / MODE.MULT split). Missing cells are never counted.
- **From the Python and R survey** (`python-r-gap.md`), Tier 1: Aggregate gained PTP, IQR, MAD, SEM, CV and RMS; Correl gained SPEARMAN and KENDALL; Bin gained a quantiles mode (NTILE); Outliers (z, IQR or MAD, into one Value / Outlier frame); Spectrum (FFT); Text Similarity and Fuzzy Match (Text ▸ Measure & Encode); Forecast (ETS) under Regression; and Hypothesis Test gained ANOVA, Kruskal–Wallis, Mann–Whitney, Wilcoxon, Fisher exact, KS, two-proportion z and binomial (with table sockets for the k-group ops, each column a group).
- **Tier 2:** Lists gained Smooth (Savitzky–Golay / LOWESS / Gaussian, op-owned parameter sockets), Find Peaks, the ARGMAX ops ARGSORT / ARGSORT DESC / WHICH (sockets retype with the op) and Polynomial Roots (Complex); Finance gained Returns; Regression gained Decompose (classical seasonal); Text gained Pad Text, Truncate Text, Template, Hash, UUID, UNACCENT / SLUGIFY on Text Transform and Base64 on the URL-encode card; Tables gained K-Means, PCA, Logistic Regression (Analyze), Bind Columns (Append's positional sibling, a backend verb on both engines) and Join `how = cross`.
- **Forecast (ETS)**: Holt–Winters. The forecast and its ± interval leave as one Frame; the detected season is its own scalar output. A series too short for the season falls back to trend only.
- **Decompose**: trend, seasonal and residual leave as one Frame.
- **ODE Integrate** (RK4): the derivative is a LAMBDA of (t, y), inline or wired (a wired LAMBDA binds by name and wins over the inline text). t and y leave as one Frame. A step whose derivative is not a number stops the run with `#DOMAIN!`.

## Statistics and distributions

- **Hypothesis Test** is one node ([[B11]] maximalMerge): Z.TEST, T.TEST (paired, equal variance, Welch), F.TEST and CHISQ.TEST as ops, plus the Tier 1 tests above. Every op emits a p-value. The two-sample ops share the `a` / `b` keys, so a switch keeps the cables and only the row labels change. The Z test's σ, when unwired, is Excel's omitted argument (the sample standard deviation); a wired blank σ gives a blank result.
- **Distribution**: one node for every probability distribution ([[C61]] oneDistributionNode). A distribution dropdown (normal, standard normal, **PHI** (φ, the standard-normal density), **GAUSS** (Φ − ½, the 0-to-x half-area; PHI and GAUSS are single-input forms), t, chi-squared, F, beta, gamma, lognormal, Weibull, exponential, binomial, Poisson, hypergeometric, negative binomial) plus a form dropdown (CDF / PDF / PMF / the tails / the inverse / Sample; GAUSS carries the one "Φ − ½" form).
  - The first input follows the form: an x for the curves, a probability for an inverse (default 0.95), a count for Sample (default 100). A distribution switch swaps the parameter inputs. `DIST_SPECS` in `nodes/distributionOps.ts` is the single source.
  - Sample's draws re-roll once per recalculation, like RAND, and are otherwise stable, seeded from the node id so two cards never share a stream ([[D46]] freezeVolatilePerCalc).
  - BINOM.DIST.RANGE stays its own node.

## Finance

- **TVM**: one acausal Equation node covering PMT, PV, FV, NPER and RATE. Wire four of rate, nper, pmt, pv and fv, and the fifth solves (nper and rate numerically, taking the root closest to zero). The payment-timing dropdown is configuration, not a variable: it swaps the locked relation without changing a socket. A rate of 0 uses the exact limit form, `pv + pmt*nper + fv = 0`.
- **Compound Growth** (fv = pv·(1+rate)^nper; covers PDURATION and RRI) and **Effective Rate** (EFFECT / NOMINAL): locked Equation presets.
- **NPV** and **IRR**, each with a Periodic / Dated SegToggle. Dated reveals a Dates input and is XNPV / XIRR ([[B11]] maximalMerge). A blank cash flow counts as zero, since dropping it would shift every later flow. The Dates list is typeable. XNPV truncates flows and dates to equal length; XIRR discounts by the year fraction `(date − first date) / 365`. Too few points give a blank. An error in either list outranks everything; a blank date gives a blank result. An IRR or XIRR that does not converge is `#CONV!` (Excel's #NUM!).
- MIRR, FVSCHEDULE, ISPMT (a signed cash flow, `pv·rate·(per/nper − 1)`: ISPMT(0.1, 1, 3, 8000000) = −533,333.33), DOLLARDE / DOLLARFR, DURATION / MDURATION, the COUPON functions.
- **Depreciation**: one node ([[B11]] maximalMerge) with SLN, DB, DDB, SYD and VDB as ops. The rows are the shared cost, salvage and life, then each method's own tail (period and factor; VDB takes a start and end period range). DB needs cost and salvage above 0, and its period runs 1 to life; the partial year after life is not offered, since Formula.js refuses it too.
- **Payment Breakdown**: IPMT and PPMT (one period, with Period and FV) and CUMIPMT and CUMPRINC (a range, Start and End period inclusive, FV 0) on one card. Signs follow Excel: interest on a positive-PV loan is an outflow, CUMIPMT(0.05, 12, 1000, 1, 12) = −353.90 and CUMPRINC = −1000.
- **Spec-table cards** (Discount Security, Accrued Interest, Bond Pricing, Payment Breakdown): the op switch keeps the inputs both ops share, cables and literals included, drops the rest and orders the sockets for the new op. Accrued Interest's ACCRINT shows Frequency; ACCRINTM does not. Bond Pricing is PRICE / YIELD plus the odd-first (issue, first coupon) and odd-last (last interest) forms; an unwired issue date is the settlement date, and a wired blank one gives a blank.
- **Returns**: log / simple / cumulative, drawdown, max drawdown, CAGR, volatility, Sharpe and Sortino. The op owns the risk-free and periods-per-year sockets and the output rank (scalar or list).
- **Amortization Schedule**.

## Text

- Text Input, case and trim transforms, CONCAT, TEXTJOIN / SPLIT, LEN, FIND / SEARCH, SUBSTITUTE / REPLACE, TEXTAFTER / BEFORE, **Regex** (REGEXTEST / EXTRACT / REPLACE), VALUE / NUMBERVALUE, TEXT / DOLLAR / FIXED, ROMAN / ARABIC, CHAR / CODE, ENCODEURL.
- **Every element-wise text node broadcasts.** Operands are `strcombo` / `numlist`, and a wired list spills element-wise, Excel-array-formula style (`=UPPER(A1:A10)`). There is no separate Text Map ("UPPER (list)") node: Text Transform with a list wired in does that job.
- **The exceptions are deliberate:**
  - CONCAT / TEXTJOIN reduce a set to one string (Excel's CONCAT flattens an array rather than spilling).
  - TEXTSPLIT and Text Filter already map 1-D to 1-D. Broadcasting would need a rank-2 result, and the lattice has no 1-D to 2-D edge for it.
  - A separator or pattern that selects a mode (NUMBERVALUE's separators, Text Filter's pattern) stays a scalar, like the date family's basis and weekend code. A wired blank there propagates: TEXTSPLIT(x, blank) is blank.
  - Text Input and Promo are literal sources, one value each.
  - Regex stays on the wildcard ladder because its element type depends on the op. It emits `anycombo` rather than `any`, so its dot doesn't draw a scalar circle on a port that can spill a list.
- **Text Transform**: UPPER, LOWER, TRIM, PROPER, CLEAN, UNACCENT and SLUGIFY. PROPER capitalizes after any non-letter, as Excel does.
- **CONCAT** skips a blank row rather than propagating it; **TEXTJOIN** ignores empties by default, matching the formula's fallback ([[D51]] oneAnswerOneDivergence).
- **LEFT / RIGHT / MID**: MID with a length of 0 is `""`, as in Excel.
- **FIND / SEARCH**: an absent substring is `#VALUE!` "Find text not found within the text", per cell.
- **SUBSTITUTE**: an instance of 1 or more replaces only that occurrence; blank or 0 replaces every one. Regex REPLACE's occurrence works the same way, like the REGEXREPLACE formula.
- **TEXTAFTER / TEXTBEFORE**: a blank delimiter is a per-cell blank. **CHAR**: an out-of-range code point is a per-cell blank. **EXACT** emits a logical.
- **NUMBERVALUE**: the separators default to `.` and `,` (a blank field shows the default). It strips group separators, normalizes the decimal, drops all whitespace, then peels trailing `%` signs (each divides by 100). The parse is strict: `12x` is `#VALUE!`, and an empty cell is blank.
- **FIXED / DOLLAR**: decimals truncate toward zero, default 2, and a negative count rounds left of the point: FIXED(12345.678, −2) = "12,300", DOLLAR gives "$12,300".
- **ROMAN** spans 1–3999, else `#VALUE!`; **ARABIC** gives blank for empty text and `#VALUE!` for a non-Roman character.
- **Template**: `{name}` inserts the input of that name and `{name:0.00}` formats it with a TEXT code; each new name grows an `anydata` input, persisted as `sideVars` so saved cables find their sockets. Numbers format through TEXT (General without a code) and a date-typed input through the date format. A list on any placeholder broadcasts, with scalars repeating.
- **UUID**: a fresh random v4 per recalculation, a volatile source like RAND. **Hash**.
- **Cast-to-text patterns** (`formatNumberPattern`, shared with TEXT): `""` or `general` is the default string, `0` / `0.00` fixed decimals, `0%` / `0.00%` a percentage.
- **Promo**: an easter-egg tagline source with no inputs, re-rolling on recalculation.

## Date and time

- TODAY / NOW, DATE / TIME construct (an out-of-range year is a per-cell `#DOMAIN!`), date parts, WEEKNUM / WEEKDAY / ISOWEEKNUM (return type is a scalar mode), DATEDIF, date formatting.
- **Parse text**: DATEVALUE and TIMEVALUE as one node. The op swaps the output between a date and a 0–1 time fraction and retypes the output cables. Blank text gives a blank; unparseable text is `#VALUE!`.
- **Date difference**: DAYS, DAYS360, YEARFRAC and the DATEDIF units. DATEDIF "D" is deliberately not an op, since it duplicates DAYS, though the formula still takes all six unit strings. The basis input appears only for the ops that read it.
- **EDATE / EOMONTH**: EDATE clamps to the target month's last day (31 January + 1 month is 28 or 29 February). Start's date style carries to the result.
- **Workdays**: one node ([[B11]] maximalMerge) with WORKDAY and NETWORKDAYS as inverse forms. The op swaps Days and End date and retypes the output between date and number through `retypeOutputCables`. Holidays is a list parameter, consulted whole for every result, and each holiday covers its whole calendar day. `weekend_code` takes Excel's numbers (1 is Saturday and Sunday, then 2–7 and 11–17; an unknown code is Saturday and Sunday); the 7-character weekend string isn't supported. WORKDAY keeps Start's date style; NETWORKDAYS is a count.
- **Epoch ↔ Date** and **Truncate Date** (floor to the start of the period, or ceiling to the start of the next).
- **Time Zone Convert** (Timesavers pack): see *Packs*.

## Complex numbers

- COMPLEX build and unpack, 16 unary ops, 4 binary ops, IMPOWER.
- The family broadcasts with its own zip (ragged tails pad blank, per-cell errors and blanks propagate) and has no finite guard: the complex ops keep their own conventions (IMDIV by zero is NaN + NaN·i). IMPOWER mixes a complex z with a real n.
- **Quadratic Roots**: both roots of ax² + bx + c as complex numbers, the companion to the Equation card's real-only quadratic (which gives `#SOLVE!` for a negative discriminant). a = 0 is a per-cell `#DOMAIN!`.
- **Polynomial Roots**: the coefficient list, highest degree first (numpy.roots), leading zeros ignored; every root as a complex list, plus the real ones alone.

## Frames and tables

**Build Frame** / **Frame from Lists**: the matrix ⇄ frame constructors, both type-by-adoption.
- Build Frame puts headers on a table to make a Frame. Frame from Lists turns N typed lists into a mixed Frame. Adding columns is other nodes' job.
- Their value inputs are adoptive sockets (`adoptiveTableIn` / `adoptiveListIn`: an `AdoptiveSocket` with an `anytable` / `anylist` base instead of `trueany`). They accept any element family and adopt the wired cable's concrete type through `settleWildcardTypes`, so a `datetable` / `datelist` gives date columns.
- This is the only way `date` survives, because a serial is indistinguishable from a number at the value level.
  - `colTypeForSocket` maps the adopted socket to a `FrameColType`. It returns `null` for a not-yet-adopted `anytable` / `anylist` or for `complex`, which falls back to value inference.
  - `typedColumn` / `buildFrameTyped` (core `frame.ts`) do the typing. A numeric matrix still routes through the unchanged `buildFrame`.
  - There is no `columnFromCells`, and Frame from Lists does not deliver dates as numbers to retype downstream.
- Headless (`run-graph.ts`, no settle pass) degrades to value inference (date to number).

**Split Frame** (`SplitFrameNode`): Frame to Matrix + Headers, with a column-type filter SegToggle (All / Num / Date / Bool / Text). Filtering to a type pulls just those columns out of a mixed Frame (which plain All can't: any text column makes the number matrix null); both Matrix and Headers are filtered. The Matrix output socket type tracks the filter (`splitMatrixOutput`, swapped in place through `applySplitColType`, like Get Column's read-as): number or all is `table`, date is `datetable` (serials), bool is `logicaltable` (1/0), text is `strtable` (a real string matrix). `colType` persists through `extractInit`.

**Table verbs** (`nodes/frame.ts` + `frameVerbs.ts`, the relational family; mechanics in `../tree/specs/computation/frame-verbs.md`):
- **The verbs:** Get Column (read-as retypes, Boolean included), Get Row, Add Column, Frame Filter, Frame Sort, Join (including as-of, semi and anti modes), GROUPBY, Append, Distinct, Head, PIVOTBY, Unpivot, Nest and Unnest; the cleanup verbs (Fill Down, Replace Values, Drop Blank Rows, Keep Columns and Drop Columns, Rename, Split Column, Merge Columns, Add Index, Headers); Reconcile; and the Cube family (Nest Join, Build Cube, Cube Columns, Cube Rollup).
- **Add Column** is Cube-adoptive, like Computed Column: a Cube in appends the new column per row, carries the nested columns through by reference, and comes out a Cube (`cubeWithColumn`).
- **Add Index** has a two-way option (the author's call): the same data indexed on both axes as a matrix with coordinate borders, exactly the grid that Surface, Contour and Grid Interpolate read. A wired matrix widens to Col1…N and gets row and column indices counting from Start.
- **Frame XLOOKUP's `search_mode`** decides which row wins on duplicate keys: "first" (the default, Excel's mode 1) scans top to bottom, and "last" (mode −1) bottom up. Excel's binary modes (2 and −2) are left out on purpose: on a materialized column, a binary search over sorted data finds the same row a linear scan does, so it would be a speed setting with no different result, and the scan is always linear.
- **Frame XLOOKUP** takes a Frame or a Cube and looks it up as a Cube either way, so the row finder and cell getter never fork. A scalar or bare list is `#VALUE!` ("XLOOKUP needs a table or Cube"), never widened to a one-row table. Return `*` gives the matched row whole, a Frame row from a Frame and a Cube row from a Cube. A list of lookup values spills one result per value, as the formula does, and a blank value in the list gives blank. An If-not-found that parses as a number comes out as a number; an empty one gives `#N/A`.
- **Reconcile** classifies each key as added (right only), removed (left only), changed (a shared column differs) or unchanged, with before, after and Δ for each shared number column. When both a price and a quantity column are named, and are numbers on both sides, it splits the total (price × qty) change into the standard price, volume and mix variances: price = (P1−P0)·Q0, volume = (Q1−Q0)·P0, mix = (P1−P0)·(Q1−Q0), which sum exactly to P1·Q1 − P0·Q0. The Summary output is heading-free Markdown, so it reads as plain text in a hero box and renders formatted through a markdown Format Controller. It counts added, removed, changed and unchanged keys, adds a skipped count when rows could not be matched (so a shrunk output is not mistaken for a clean reconciliation), lists one-sided columns as `+name` and `−name` (so an all-unchanged result is not read as identical frames), and notes under the price, volume and mix line how many rows with a blank or errored price or quantity the variance excludes.
- **Computed Column** (`ComputedColumnNode`; [[C22]] rowFormulaRefs, [[C54]] noPerCellFormulas) adds one defined column mid-pipeline, from an inline formula or a wired λ, and is why Frames stay out of formulas ([[C15]] matricesInFormulas): the row loop lives here. Frame Input's **Fx** column is the same model. Name resolution, per-row errors, type inference, side inputs and placement are `../tree/specs/computation/computed-columns.md`.
- **Query** is a Composite shaped for data transformation: a verb chain inside, in Manual refresh mode, the Power Query shape ([[C53]] queryIsCompositePreset).
- **Describe** (pandas describe, one row per column), **Correlation Matrix** (df.corr / df.cov: Pearson, Spearman, Kendall or covariance, pairwise-complete) and **Window** (the per-group transform column: running, rank, lag, lead, diff, pct_change, rolling, group total, share, first, last, with partition and order, original row order kept; a lazy FrameOp, Polars `.over()` on desktop and the oracle on web, with a `window.json` parity fixture).

**Frame Input's column sources.** Frame Input is a literal source for Data columns: it stores the raw text you typed and derives the typed Frame at compute time, and the popup's Source checkbox shows that raw text on every frame node (`FrameColumn.raw`). Each column is either **Data** (typed cells) or **Fx** (a row-wise formula, `expr` on `FrameSourceColumn`, which may call one of the card's λ inputs by its socket name; `../tree/specs/computation/computed-columns.md`). The chip's **ƒ** marks a table with Fx columns.
- The popup's **Form view** edits one record at a time; its mechanics are `../tree/specs/documents/table-popup.md` § The Form view. In the card's Form layout, each field's hide mark sits in the box's top-right corner, the one the resize grip leaves free; hiding a field keeps its text, and the card offers the field back.

**Cube Input** (`nodes/cube.ts` `CubeInputNode`, `components/CubeInputNode.tsx`): the fourth literal source beside Table, Frame and List Input. The author's rule: "no in-cell string lists, that is what the cube is for".
- The stored truth is `cubeText` (persisted; JSON rows of records, where a value is a scalar, a list, or a list of records). The cube derives at compute through `recordsToCube` (a list value is a list cell). Bad text gives one `#VALUE!` with the reason.
- The card is the grid preview plus the cube chip, with no text field (the author's call). The popup carries the corner resize grip the table popup has (`PopupShell` `resizable`). Wide tier: any cube-socket node, like frame nodes (`nodeWide`).
- **Editing:** the cube popup is the editor, in one window (`cubePopupStore.edit`, `CubeEditBinding` = records() / save(); every drill level carries a records `path`; `components/cubeEditCell.tsx`).
  - A scalar cell edits inline (Enter or blur commits; Escape reverts).
  - A nested cell drills on the breadcrumb, never a popup above a popup. A list cell opens an editable list level (one item per row), a frame-shaped record list an editable table level, and a cube-shaped one a cube level with the same rules.
  - Every level has `+ Row` / `− Row`. Table and cube levels add `+ Col` / `− Col` (the last key on every row; new ones arrive as "Column N") and editable column headers (a rename changes the key on every row).
  - Every commit patches the records at its path (`literalEditors.ts`: `getAtPath` / `setAtPath` / `recordsShape` / `parseCellText`), and `cubePopup.refresh()` re-derives the whole stack. It is checked on a phone viewport (touch-sized cells and buttons).
- **List Input**: each row is a comma-separated list typed on the card, and a wired row replaces that row's text; the rows concatenate in order, and only rows with text or a cable contribute. A wired value is converted to the card's element type, never filtered, and blank and error cells pass through in place. The typed rows are its only editor: the value box's chip opens the ordinary list popup view-only (`../tree/specs/documents/literal-input-editors.md` § List Input is not one of them).
- Seed: `product-launch-gantt.json` (tasks as a Cube Input; the critical-path Filter reads Schedule's cube). Tests: `literalEditors.test.ts`.

### Planners

**Payoff Planner** (`nodes/frame.ts` `PayoffPlannerNode` + the pure `nodes/payoffOps.ts`, frame kind, Table verbs › Plan): rows are debts.
- Columns: the first text column names them, then `Balance` / `APR` (a fraction, or a percent of 1 or more) / `Min`, or else the first three number columns in that order.
- Inputs: `extra` (a number literal) is the monthly amount on top of the minimums. `start` is a date; unwired, it is the first of this month.
- `order` is Avalanche (highest APR first) or Snowball (smallest balance first), through ArgSelect (`PAYOFF_ORDER_META`). `mode` is Summary (Debt · Months · Interest · Payoff date) or Schedule (Month · a balance column per debt).
- Month by month, interest accrues, every open debt gets its minimum, and the extra plus every freed minimum cascades down the order. A plan whose payments never cover the interest is `#VALUE!` naming the debt (600-month cap).
- Balance's unit and format ride onto the money columns.
- Seed: `planners.json` (avalanche and snowball side by side). Tests: `payoffOps.test.ts`, `nodes/payoffPlanner.test.ts`.

**Group Cost Settle** (`nodes/frame.ts` `SettleNode` + the pure `nodes/settleOps.ts`, frame kind, Table verbs › Plan): rows are people.
- `mode` is Totals or Transactions. Switching it retypes the single `in` socket in place (People Frame or Ledger Cube), so a wired cable survives; a cable the new type no longer accepts is ghosted for a one-click reconnect and feeds nothing, so the card shows empty.
- **Totals** reads a people Frame. The first text column names them, `Paid` (or the first number column) is what each paid, and an optional `Share` column weighs what each owes (blank means 1). Two rows with the same name (trimmed, case-insensitive, first spelling shown) are one person whose Paid and Share add up, so nobody settles against themselves. `split` is Equal split or By Share (SegToggle; persisted) and applies to Totals only.
- **Transactions** reads a ledger Cube, one row per expense: an Amount column (Amount, Cost, Total, Price or Spend), a Paid by column and an optional For column, whose cell is a list, one name or comma-separated names; a blank For splits among everyone. It is equal split only. A refund is a negative row and settles like any other; a row with no payer is skipped.
- Each person is netted against their fair share (paid total × weight / Σ weights). Then the biggest creditor takes from the biggest debtor. That gives the fewest transfers a greedy pass can, exact to the cent (a residual cent lands on the last transfer).
- Outputs: `transfers` (From · To · Amount) and `net` (Person · Paid · Owes · Owed · Net). Net is each person's fair share, their true cost. Net − Paid above zero is still owed to the group (Owes), below zero comes back (Owed, negative), and one of the two is always 0; in an equal-split Totals run every Net matches. The money unit and format (Paid's in Totals; in Transactions the first per-cell currency found on Amount, a mixed-currency ledger being out of scope) ride onto every money column.
- Seed: `planners.json`. Tests: `settleOps.test.ts`.
- Hours balancing is the **Allocator**, not a separate node. Its copy says "range" (a price, hours, anything you spread), and people with Min · Max · Weight in `hr` over a 160 h budget use the same card.

**Allocator** (`nodes/frame.ts` `AllocatorNode` + the pure `nodes/allocateOps.ts`, frame kind, Table verbs › Plan): rows are categories with a range and a weight, and three modes (Fit budget, Min for target, Min proportional) spread an amount across them. The kernels are in `../tree/specs/computation/frame-verbs.md`.
- In Min proportional mode the card hides the amount field, since the mode uses neither budget nor target, but the amount socket stays, so a wired cable never ends on an undrawn dot.

### Schedule

`nodes/schedule.ts` + `scheduleCpm.ts`, which binds the cube to `@solenoid/schedule-engine` in `packages/schedule-engine/`; frame kind, Table verbs › Plan. The critical-path method over a tasks cube, on the `../tree/specs/computation/schedule-and-gantt.md` contract. The rows come as a cube because Predecessors is a list cell (or a nested Task · Type · Lag table) and nesting is the WBS; a Frame widens in, and then its scalar Predecessors cell is one name.
- **Core columns:**
  - Task: `Task` / `name` / `title` or the first text column. Names are unique, matched trimmed and case-insensitive.
  - Duration: `Duration` / `days` or the first number column, in days. Blank or 0 is a milestone. An hour-united column converts through `hours`.
  - Predecessors: a list cell of names is FS with lag 0, and a text cell is one name, never split. A nested Task · Type · Lag table gives FS / SS / FF / SF with lags and leads. It is never a grammar string.
- **Optional one-rule columns** (§ 4.1):
  - Start is a floor. Finish is a ceiling (negative float, nothing moves). Deadline is a flag (`Late`). Manual is a pin (predecessors ignored, successors still driven). Complete is 0–100. Project gives the gantt sections.
  - A Tasks / Children / Subtasks column holding a nested table is the WBS. A parent is a summary: dates roll up, its float is the children's least, a link on it bounds every leaf beneath it, and a link from it reads the roll-up.
- **Per-task columns:**
  - ALAP starts the task at its late start, critical. A deadline pulls it earlier.
  - Actual start pins the early start; out-of-sequence is allowed.
  - Elapsed makes every day count.
  - Weekend / Hours / Holidays are the row's own calendar over the project's. Links cross calendars by instant, and a nested Predecessors table's Elapsed column makes a lag count calendar days.
  - Work / Units are effort-driven (rule 16). Resource / Units feed the figure's histogram.
  - Active = FALSE keeps inactive rows in place.
  - Repeat + Every turns a recurring row into a phase of N occurrences k calendar days apart (Project's recurring task).
- **Inputs:** `start` (wire-only; unwired is today, a wired blank schedules nothing), `holidays`, `weekend_code` (WORKDAY.INTL, literal 1), `status` (wire-only; with it, the unfinished part of a started task is scheduled after that day), `hours` (8), and `links` (an optional flat Dependencies frame, the § 10 two-frame form: Successor · Predecessor · Type · Lag rows added to the tasks' predecessors).
  - The `links` successor column may be named Successor, Task or To, and its predecessor column Predecessor, Predecessors, From, After or Depends on; the plural lets an Unnest of Schedule's own Predecessors list read straight back in. Names resolve across the whole WBS. A row whose successor is not a task is a `#VALUE!` naming it, an unknown predecessor is caught by the engine's unknown-predecessor check, and a blank or half-filled row is skipped.
- **Card toggles:**
  - Working | Calendar days.
  - Days | Minutes precision. Minutes is Project's model: intervals come from `hours`, with an 08:00 start and a lunch hour for an 8-hour day. An FS successor starts the same afternoon, a finish is the end of the last working minute, durations and lags may be fractions of a day, and a date-only ceiling means the end of that day.
  - Critical paths: One path | Every path (multiple critical paths) | Longest path (P6).
  - Split the rest | Move the whole: a started task's remainder after the status date is either split from its done part (Project's default) or the whole task moves. A split task carries a Segments table the figure draws as parts.
- **Outputs:**
  - `cube`: every level of the input with `Start · Finish · Float · Critical · Free Float · Early Start · Early Finish · Late Start · Late Finish · Driving · Late` appended (plus `WBS · Level · Summary` when nested). A typed Start / Finish column is replaced in place by the scheduled one, and a floor that held reads as typed. In Minutes mode every appended date column carries the app's datetime pattern (`05-Jan-2026 13:00`); Days mode stays date-only. A level with no Duration column gets one when it has a summary row, whose Duration cell is the working days its children span; a `Segments` column (a nested Start · Finish table) is appended only when some row is split; and a recurring row's generated occurrences get a Tasks column the input lacked.
  - `finish`.
  - `diagnostics` (Check · Task · Detail under plain names; declared `frameShape`): no predecessor / no successor with phase links inherited, negative float, high float, held by a typed start, past deadline, lead, lag, link type, broken link, long task, manual, should have started / finished, finished early.
  - `gantt` (Mermaid): `excludes weekends, <holidays>`, `section` per Project, `crit` / `milestone` / `done` / `active`, nested indent, exclusive ends.
  - `mspdi`: Project XML through `writeMspdi`. Write File saves it.
- **Errors:** a cycle, an unknown predecessor, a duplicate name, a bad duration, or an unreadable or ambiguous date gives one `#VALUE!` (or the `#AMBIGUOUS!`) naming the row, on every socket (the aggregate rule).
- **Engine** (`packages/schedule-engine/src/`, MIT, no Date object):
  - `calendar`: a unit index space, negative for leads, with a day layer and a minute layer.
  - `graph`: flattens the WBS into a name-keyed DAG (Kahn).
  - `cpm`: forward and backward passes, total and free float per link, the driving predecessor, roll-ups, Complete versus the status date.
  - `diagnostics`, `mermaid`.
  - `predecessors`: the `3FS+2d` grammar (import only), plus the grid text.
  - `mspdi`: the Project XML pj14 read. It covers outline nesting, link codes 0=FF / 1=FS / 2=SF / 3=SS, lag in tenths of a minute, the eight constraint types onto Start / Finish / Manual, and the base calendar's weekdays, exceptions and working times. Unmodelled fields are named in `unsupported`.
  - `xml`: a small reader.
  - Formats (`packages/schedule-engine/src/formats.ts`): GanttProject `.gan` and Primavera XER read (Local File's plan socket, by extension), and MSPDI write (round trip pinned).
- **Corpus:** `fixtures/schedule/`, hand-authored MSPDI whose stored dates the engine reproduces in both modes. `divergences.json` names any field it may not.
- Not built (named, not hidden): resource leveling.
- Seeds: `product-launch-gantt` (three phases, SS+2, FS−3, a deadline, a pinned task, progress against a status date, Holidays, Earned Value) and `kitchen-remodel-tasknotes` (live TaskNotes). Tests: `packages/schedule-engine/src/*.test.ts` (engine, minutes, mspdi), `scheduleCpm.test.ts`, `nodes/schedule.test.ts`.

### Earned Value

`nodes/earnedValue.ts` + the pure `nodes/earnedValueOps.ts`, frame kind, Table verbs › Plan: EVM over a scheduled cube.
- **Inputs:**
  - `schedule`: a Schedule cube. It reads Task, Complete 0–100, a Cost column named Cost / Budget / BAC or the `cost` literal, an Actual cost column, and Start / Finish.
  - `baseline`: a second scheduled cube joined by name. Its Cost is the budget (BAC) and its Start / Finish set the planned pace. Unwired, or for a task it lacks, the schedule is its own baseline.
  - `status`: a wire-only date. Unwired, it is today; a wired blank means no status yet.
  - `holidays` and `weekend_code`: the working calendar, the same vocabulary the schedule used.
  - `cost`: the column-name literal.
- **Per task, as of the status date:**
  - BCWS = baseline cost × the fraction of the planned working days elapsed, counted on the working calendar above, so a holiday inside a task's span is not planned progress.
  - BCWP = cost × Complete. ACWP = the Actual cost column, else BCWP.
  - Then SV / CV, SPI / CPI (null when their denominator is 0), EAC = BAC ÷ CPI, VAC, TCPI.
- **Outputs:**
  - `frame` = Task · BCWS · BCWP · ACWP · SV · CV · SPI · CPI · EAC · VAC · TCPI (declared `frameShape`). The money columns carry the Cost column's currency through the `...unit` copy idiom; the indices stay unitless. The card keeps its inputs' units (the per-input unit strip is off), or the currency would be gone before the computation.
  - `spi` · `cpi` · `eac` totals as scalars. Each total ratio comes from the summed components, never averaged. EAC carries the unit through `tagFrameCellUnit`.
- Seed: `earned-value.json`. Tests: `nodes/earnedValueOps.test.ts`, `nodes/earnedValue.test.ts`.

### Decision support

- **Decision Matrix** (`DecisionMatrixNode`, frame kind, in the Table verbs menu): a port of the author's Decision Matrix Bases View Obsidian plugin. It scores and ranks a Frame of options (rows) by criteria (number or logical columns, not date; an optional leading text column names the options).
  - The Scores input also takes a Cube: its scalar columns are the criteria, and its list or nested columns are ignored like dates. The output is always a fresh ranking Frame (Option · [criteria when Breakdown] · Score · Rank).
  - The score is a weighted average, `Σ(value × weight) / Σ|weight|`. A negative weight penalizes a lower-is-better criterion.
  - Rank is competition rank on the score rounded to 4 decimal places, so display and rank can never disagree ([[C64]] decisionMatrixFamily).
  - **Weights ride a criterion-keyed `weights` frame** (`Criterion · Weight · Norm`). The weights are orthogonal to the score rows, one per criterion column, so they key by criterion name, never by a positional list.
  - `resolveDecisionWeights` (`frameVerbs.ts`) aligns the weights frame to the detected criteria by name. The first text column is Criterion. The number column named Weight / Value (else the first number column) is the weight. An optional Norm text column is parsed by `parseNormalize` (Raw / none, ÷Max / max, Rank). Unwired, or for a criterion the frame omits, the weight is 1 with the default normalization.
  - The card keeps only the node-wide defaults:
    - The `normalize` SegToggle: none / ÷max / rank. **÷max is the node default** ([[C64]] decisionMatrixFamily), because raw values silently degenerate the moment criteria mix scales. ÷max and rank both land in 0 to 1, so mixed-mode columns stay comparable: weights, not scale, decide influence.
    - `detail` (Summary / Breakdown). Breakdown inserts each criterion's **signed contribution**, effective × weight / Σ|weight|, so the columns sum to the Score and a negative-weight column reads as the penalty it is. It never shows the bare normalized value.
  - The node's own `frameShape()` declares the static output shape (label · [criteria] · Score · Rank).
- **Decision Sensitivity** (`DecisionSensitivityNode`) is the companion. Feed it the same Scores and a Scenarios frame.
  - The Scenarios frame is the weights frame widened: rows are criteria, each number column is one scenario named by its header, and one optional Norm column is shared.
  - A criterion a scenario omits gets 1. If no criterion row matches at all, the result is `#VALUE!` (the renamed-criteria trap).
  - It emits a **Cube**: Scenario · Winner · Margin · Ranking, where Ranking is the full ranking frame nested per cell (drill in).
  - Margin = top − runner-up (decisiveness). A dead tie for first lists every tied option in Winner ("A = B").
- Verbs: `decisionMatrix` / `decisionSensitivity` / `resolveDecisionWeights` in `frameVerbs.ts` (`decisionMatrix.test.ts`).
- **Seed** `decision-matrix.json`, held to the engine by `decisionSeed.test.ts` (winner order, the flip, the exact tie, the report wiring):
  - One criterion comes from a Note's frontmatter frame (rows-of-objects: prose is the judgment, rows are the data), left-joined by name.
  - The weights and the transposed scenarios are Frame Inputs.
  - The podium is a Columns node (keep [Option, Score]) → Chart (labeled bars), beside a radar off the Join.
  - A Report memo pulls `=winner` (INDEX 1,1), the podium figure, and the contributions table.

### Aggregation

- **Group Lists**: a 1-D parallel-list group and aggregate (keys and values outputs).
- **GROUPBY**: groups a Frame's rows by key columns and aggregates.
- **SUMIFS** ([[C49]] filterOneJob): a conditional aggregate over one Frame.
  - An op selector (SUMIFS / COUNTIFS / AVERAGEIFS / MINIFS / MAXIFS), a Values-column field (hidden for COUNTIFS), and extensible criteria rows (column, test and value, AND like Excel's *IFS).
  - Empty-match parity: AVERAGEIFS gives #DIV/0!, MINIFS / MAXIFS give 0. A missing column is #REF!.
  - Parallel lists route through Frame from Lists (the aligned-columns rule).
- **PIVOTBY** is full Excel `=PIVOTBY`. The engine is `pivotFrame(f, PivotSpec)` in `frameVerbs.ts`. Background: the PIVOTBY full-Excel-parity entry in `archive/dev-notes-history.md`.
  - Multiple row, column and value fields (composite `"East | A"` headers).
  - A per-value function from the expanded set (SUM / AVERAGE / COUNT / MIN / MAX / PRODUCT / MEDIAN / MODE / STDEV.S-P / VAR.S-P / PERCENTOF).
  - Grand totals and subtotals (row and column depth, top or bottom) that re-aggregate the source.
  - Value and field sort, a filter mask, and % running totals (`relativeTo`).

## 2-D tables

Node kind `table`, with the gold accent the table socket shares (`NODE_KIND_SLOTS` in `nodes/shared.ts`).

- **Table Input** grid: a literal source on Frame Input's model. Raw text is the stored truth, bad cells derive to NaN with the quiet affordance, and the grid editor edits the Source text. One element type per table, picked by a Num / Text / Date / Bool SegToggle that retypes the output socket in place; the header accent tracks it.
- MMULT, MDETERM, MINVERSE, MUNIT, TRANSPOSE. TRACE, MATRIXRANK and NORM are MDETERM card ops; the op switch retypes the output between number and table.
- **VSTACK / HSTACK**: the 2-D rungs of the append ladder ([[C48]] appendLadder). N extensible `anytable` rows stack in row order, a list counts as one row, and ragged inputs pad with #N/A cells like Excel.
- WRAPROWS / COLS (leftover cells pad with #N/A, Excel's default pad_with), TOCOL / ROW, CHOOSEROWS / COLS.
- **TAKE / DROP**: one rank-preserving card for the 1-D and 2-D forms. A list, matrix or scalar goes in and the same rank comes out. The sign of the count is the direction, and 0 means an omitted argument.
- **EXPAND**: grows to R×C, filling with the wired Fill or #N/A. Shrinking is #VALUE!.
- ROWS / COLUMNS, DIAGONAL (numpy.diag; off-diagonal 0 or blank, MUNIT's toggle), OUTER, Cross Product (3-vectors).
- Solve A·x = b, Eigen (symmetric, Jacobi).

## Input and control

- Number Input, Boolean Input, Slider (its ◄/► step buttons are the "stepper"), RandBetween, RandArray, Sequence.
- **Angle Dial**: degrees 0–359, snapping to its step (default 15).
- **Date Input**: type any date (ISO, day-first numeric, ordinals, month names, through the shared chrono-backed `parseDate`) or use the native calendar. It renders DD-MMM-YYYY and keeps exactly what you typed, never discarding an unparseable entry (which gives a blank). An ambiguous numeric like 3/4/2026 gives `#AMBIGUOUS!`, never a guess. Relative phrases resolve only when Settings ▸ Data ▸ Relative dates is on ([[D54]] relativeDatesOptIn).
- **Date Range**: a start and end date, default today to a week out; picked out of order, the two swap.
- **XYPad**: drag a 2-D handle to get X and Y in [0, 1].
- **Slicer**: a Frame in, and a button per distinct, sorted, non-blank value of the picked column (blank means the first column). Pressed buttons keep exactly the matching rows; an empty selection passes every row. On a lazy upstream it reads only the schema and the picked column and pushes the filter into the verb chain, so the whole Frame never collects.
- **ColorPicker**: RGB / HSV sliders with gradient-painted tracks, or a Hex text field as a third mode.
  - An output-format dropdown picks hex or rgb, CSS-valid only (no `hsv()` / `hsl()`). The output socket sits on the swatch row below the dropdown.
  - Conversions go through the `colord` lib. It feeds Chart Builder's Color.
- **ColorBlend** (kind `string`): two CSS color-string inputs, typeable or wired, and a blend-mode dropdown (mix, multiply, screen, overlay, soft and hard light, darken, lighten, difference, exclusion, dodge, burn).
  - It uses the W3C separable formulas per RGB channel, with A as the backdrop. Hex comes out on a ColorPicker-style swatch row.
  - Unparseable input gives `#VALUE!`. `colord` loads the `names` plugin globally, so "tomato" parses.
- **Save Times**: the last autosave and the last write-to-file as two date serials, per document, read through the leaf `saveTimeStore` seam. Refresh and Save buttons sit on the rows.
- **Input Switch** (`CableSwitchNode`), not the logical SWITCH: extensible adoptive slots, each with an editable title (else "Input N"). One mode routes the active input through unchanged, keeping its type and unit. Many mode collects the checked inputs, in slot order, into a Cube of name and value rows. Removing a slot keeps the chosen input chosen.
- **Draw-your-data inputs:**
  - **Point Plotter**: click points on a pad (axis ranges default 0 to 10); stored as `x, y` text lines trimmed to 4 decimals; out comes an X · Y Frame.
  - **Curve**: drag control points; a monotone cubic through them (Fritsch–Carlson, so it never overshoots, flat beyond the ends; a duplicate x keeps the last point) sampled at 2 to 1000 points (default 32) into an X · Value Frame. It keeps at least two control points (its endpoints can't be removed), and the spline draws live on the card.
  - **Grid Painter**: paint a rows × columns grid (1 to 64 each, default 6 × 8) with the brush value; stored as CSV text; unpainted cells are blank, not zero.

## Output

- **Display**, and **Cast**: universal type conversion to number, text, date, complex or Boolean, item by item on lists. The Boolean target gives a real `logical` from "TRUE" / "FALSE" text or a nonzero number, through `coerceLogical`. The Cast card is 252 px wide (`.solenoid-node--cast`) so all five segments of its type selector fit, since SegToggle segments never wrap. An expanded Display showing a Frame or table grows to fit it (`--display-grow`: `width: max-content` over a 180 px floor, so a short result never collapses to a stub and no inline width is pinned); if Display widths are ever pinned, the floor must become `max(180px, max-content)`. A Display showing a scalar grows to fit the number up to 360 px, then ellipsizes (`--display-grow-scalar`); a manual resize lifts the cap.
- **Visual nodes** (`nodes/visual.ts`, the `display` kind, drawn with recharts unless noted). Each figure node is terminal: it emits a chart value on the `chart` socket and never passes its input through, so each one embeds in a Report like a chart. The figure mechanics are `../tree/specs/computation/chart-figures.md`.
  - **Sparkline**: an inline line, column or win-loss view of a list.
  - **Chart**: 11 kinds (column, bar, line, area, pie, radar, radial bar, funnel, scatter, composed, bubble).
  - **Merge Plots**: overlays several x/y-plane charts on one plot, each keeping its own mark and styling; a polar or payload figure is refused with `#TYPE!`.
  - **Histogram**: 1-D bins one list into columns; 2-D bins paired X and Y into a density plot.
  - **Gauge**: a value on a fixed scale, with a Dial / Bar style selector. Dial reads the value as a fraction (1 = 100%, fixed at 0 → 100%) and minifies to a square; Bar is a 0 → Max track with a target tick, and absorbed the former Bullet node. **KPI** is the stat card with a prior-value comparison.
  - **Heatmap**: a table in, the same table passed through, drawn on the card as a cool-to-warm color grid. It is the one visual node that is a passthrough, not a chart value.
  - **Mermaid** (`MermaidNode`, a wide card) is the one figure that isn't recharts. Mermaid.js source text in (typed on the card or wired to `source`), a `MermaidValue` out the `chart` socket (a sibling brand to `ChartValue`, in `mermaidValue.ts`). `MermaidView.tsx` imports mermaid (heavy: d3 and dagre) only when a diagram is on screen.
  - **Record**: Frame rows as labeled boxes on a text-defined grid, with four views on one op selector: **Card** (one row, picked by the pager or a wired 1-based `Row`), **Gallery**, **Board** (lanes keyed by a `Group by` column) and **List**. The card itself never draws the grid; the drawn figure appears wherever the chart output goes. Seed: `record-cards`.
  - The rest of the figure catalog: Boxplot, Candlestick, Surface (with Contour as its Flat view: one node, two leaves), Waterfall, Waffle, Calendar (heatmap), Vector Field, and the Proportion category (the Proportion node with Treemap and Waffle layouts on an `op` selector, plus Sankey).
- **The standing rule:** rich visuals are node outputs flowing the `chart` socket, never Report markdown features; Reports stay plain text plus embeds. A LAMBDA wired into a Report renders as KaTeX through the same inline-reference path (`inlineRefDisplay.tsx`).
- **Chart UI and options.** Twelve figures take an `options` string (`key=value;…`, matplotlib's names, [[C96]] chartOptionsAreMatplotlib), typed inline or built by the **Chart Builder** node. The keys, which figure reads which, the Chart card's pickers and the render paths are in the chart-figures spec.
- Every family's combo socket (`strcombo`, `datecombo`, `complexcombo`, `logicalcombo`) mirrors `numlist`: scalar or list, drawn as a two-color split square.
- **Find** (under Lists): XLookup, XMatch. Convert (unit conversion) sits under Output. Classic MATCH / VLOOKUP / HLOOKUP are omitted; XLOOKUP / XMATCH supersede them. XMatch carries the same `search_mode` as the frame XLOOKUP (First / Last, which duplicate wins; binary ±2 omitted for the reason under *Table verbs*), so the two lookups and their formula forms take the same two mode arguments. The shared kernel is `xmatchIndex` (`listOps.ts`).

### Gantt

`nodes/gantt.ts`: a scheduled project drawn as a Gantt chart, with bars, milestone diamonds, summary brackets, dependency arrows, the critical path, a today or status line, and shaded non-working days.
- A Schedule `cube` goes in, plus an optional baseline table and Holidays / Weekend for the shading (the Schedule node's calendar vocabulary). It computes no dates itself and only reads the columns Schedule appended; `ganttPayloadFromSchedule` builds the data-only payload, and the figure lays it out at its width. A scheduling failure on the cube passes through as the output. Status is wire-only; unwired, there is no status line.
- It emits a `chart` value of kind `gantt`. Like Record, the card carries the [Chart] chip and never draws the timeline; the figure draws in Display, the popup and Reports, windowing its rows in the popup.
- Layout and headless SVG live in `@solenoid/gantt-layout`, the React view in `@solenoid/gantt-react`. The popup has a Copy SVG action, and the export paths pull that SVG through the `data-chart-svg-provider` seam.
- Options include `layout=calendar` (the month-grid sibling), `histogram=on` (a resource band under the timeline from Resource and Units columns, with over-allocation marked), `fit=page` (export fit for long spans) and `minutes=on`. A task's Segments draw as split bars. The tree grid has a keyboard map (arrows, Home / End, Left / Right fold a phase, Enter toggles) behind `.nokeys`.
- A composite's By-Row mode iterates a Cube's rows too (one single-row Cube per pass, nested cells kept), so a portfolio Cube of projects schedules row by row. Seeds: `product-launch-gantt` (also as a calendar) and `kitchen-remodel-tasknotes`.

## Formula

- **Expression** takes a formula like `a * b + 1`, and each variable becomes an input socket. Its inputs are `anydata`: a single value, a 1-D list or a 2-D matrix. Frames and Cubes never enter a formula ([[C15]] matricesInFormulas); per-row math on a Frame is a Computed Column. The evaluation, units and result-socket mechanics are `../tree/specs/computation/formula-language.md`.
- `pi`, `tau`, `e` and `phi` are constants, not variables (`FORMULA_CONSTANTS` in `excelFormula.ts`). `extractVariables` skips them, so every formula surface sees them.
- **Variable descriptions:** each variable can carry a prose description (`varDescriptions`), kept out of the formula string so KaTeX never renders it. It shows as a hover tooltip on the card and an editable legend under the KaTeX in the formula popup. Expression, Equation and LAMBDA share that popup; some pack presets (Ohm's Law, ideal gas) ship descriptions. A LAMBDA wired into a Report renders as KaTeX with a muted "where:" legend of those descriptions.
- **LAMBDA**: the parameters (comma-separated) stay unbound, and every other variable and `@name` grows a capture input (`row` and `rows` are builtins and capture nothing). Captures resolve at compute, so a consumer never reaches back into the graph. There is no recursion and no lambda returning a lambda. A broken LAMBDA (a bad parameter name, a syntax error) sends a tagged error down its cable, so the consumer's error guard chains it. Consumers bind parameters by name ([[C50]] lambdaBindsByName): a name the consumer offers that the LAMBDA uses without declaring becomes a captured 0, and the card advises, showing the signature like `acc, x, [i]`. The output keeps its identity while nothing changes.
- **The LAMBDA helpers** are MAP, BYROW, BYCOL, REDUCE, SCAN and MAKEARRAY, each running an inline formula or a wired LAMBDA. SCAN folds like REDUCE from Initial but emits the accumulator after every cell, in the input's shape: a running total is `acc + value`, a running max `MAX(acc, value)`. Running covers the common aggregates without a formula, and REDUCE gives only the final value. MAP zips up to three tables; a second or third table must match the first's shape or be 1×1, and a 1×1 table broadcasts, standing in for a captured constant. REDUCE and SCAN fold row-major from Initial, as Excel does, and their Values input widens any shape to a matrix.
- **Polyform:** a Number / Text / Date / Auto result-type selector on Expression, the LAMBDA helpers and LAMBDA lets them loop any Excel function over arrays of any element type (`UPPER(name)`, `first & " " & last`, `DATE(y,m,d)`), and the output socket changes to match. LAMBDA's capture sockets are `anylist`.

**Script** (`ScriptNode`, `nodes/script.ts`, [[C66]] scriptNode; the bounded form of out-of-scope §4): a JavaScript function expression as a node. It is named Script, not Code, because CODE is the Excel node ([[D21]] noExcelNameClash). The sandbox, arguments and result coercion are `../tree/specs/computation/script-sandbox.md`.
- **Inputs.** Its parameter names are `trueany` inputs, re-derived on commit (`applyScriptChange`, Expression's mechanic).
  - With `autoLiterals`, an unwired parameter takes a typed number or text. Unwired and untyped is `undefined`, and a wired blank is `null`.
  - A wired Frame (materialized in full) or Cube arrives as the same rows-of-objects (`scriptArgToJs`). LAMBDAs, charts and documents error before the run, and an error anywhere in an argument becomes the result without running.
- **The return value types itself.** `scriptCoerce.ts` folds it onto the value model; there is no declared result type.
  - Numbers, text and Booleans are their own families. A `Date` or `Solenoid.date(serial)` is a date.
  - Rows of `{name: value}` objects build a Frame with typed columns, and rows nesting rows or lists build a Cube.
  - NaN is `#DOMAIN!`, unsupported values are `#TYPE!`, and anything beyond the accepted shapes is `#SHAPE!`. A list, table or Frame column mixing families is `#AMBIGUOUS!`. Ragged rows are padded with null.
  - The result socket reconciles family and rank off the value.
- A volatile source (Math.random, Date.now, argless `new Date`, …) grows the shared Recalculate button (`scriptIsVolatile`).
- It runs in the sandbox Worker under a 1 s wall clock.

**Equation** (`EquationNode`, `equationSolve.ts`, [[C47]] equationNode): the acausal sibling of Expression. The solver is `../tree/specs/computation/equation-solver.md`.
- Type a relation (`V = I * R`). Every variable gets an input and an output socket, plus a fixed logical **Check** output (output key `holds`). A variable is known only through its cable.
- **Exactly one unknown** (unwired) is solved:
  - Symbolic AST isolation when the unknown appears once (`+-*/^`, POWER / LOG, EXP / LN, SQRT, trig and hyperbolic, DEGREES / RADIANS, unary minus, %). The isolated form unparses to a formula and recompiles, so list broadcasting is free.
  - Otherwise, a residual that is quadratic in the unknown (numerically probed, any arrangement) solves by the quadratic formula and yields every real root as an ascending list (x² = 36 gives [−6, 6]). A double root is a scalar, and a negative discriminant is #SOLVE!.
  - Anything else falls to a numeric log-grid and bisection fallback on the LHS − RHS residual (scalar only, `#SOLVE!` when there is no real root).
- **All variables known:** Check is a relative-tolerance (1e-9) truth check, broadcasting per element.
- Inversion takes principal branches (sqrt, ASIN).
- Wired variables pass through to their outputs, so the node doubles as a labeled junction.

## Connections and sinks

The shared fetch machinery (cache keys, background fetches, status, the network gate, HTTP) is `../tree/specs/computation/live-connections.md`. A connection card saves only its reference, never the data, and every refreshing card carries an auto-refresh interval in minutes (0 is off) that the component times.

- **Web Source**: a URL fetched to a Frame. It reads JSON when the content type says so, else when the URL ends in `.json`, else when the text starts with `[` or `{`; otherwise CSV. CSV takes the first row as headers and infers each column's type, so text columns stay text. JSON may be an array of records (the keys, in first-appearance order, are the columns), an array of arrays (positional Col1, Col2…), an array of scalars (one column) or a columnar object (`{a: [1, 2], b: ["x"]}`); any other shape is an error. On desktop the request is native, with no cross-origin block.
- **Import HTML**: the Nth `<table>` on a page (1-based) as a Frame. The first row becomes headers only when the page marks it as a header row (a `<thead>` or all `<th>` cells). **Import XML**: an XPath query over a page, giving each matched node's trimmed text as a list.
- **Data Feed** (`nodes/dataFeed.ts`): one node for every market and economic data provider (the presets in `dataProviders.ts`): a series id or ticker, an optional Start / End (ISO; End before Start is refused) and frequency, and the provider's API key from `apiKeyStore` when it needs one ([[C105]] apiKeysStayLocal). Switching the provider clears the frequency and date refinements, since they are provider-specific and a stale one would build a bad URL, and fetches again.
- **Local File**: a file named relative to the target folder in Settings. The extension picks the reader (`.parquet` through the native engine, anything else as CSV), so the card has no format control.
  - It is desktop only, except for the bundled demo vault, which the web app reads (CSV only) through the in-memory file provider ([[C1]] demoVault).
  - Parquet needs the native engine. It is read in Rust, so typed columns arrive intact, and it comes out as a lazy frame handle so a verb chain never re-uploads it; a failed Parquet read flows downstream as `#REF!`. A CSV is parsed in Rust on desktop (the file text never crosses IPC) and in JavaScript on the web; a failed CSV read is blank.
  - A Project XML, GanttProject or Primavera file (by extension), or a Smartsheet-style CSV whose Predecessors use row numbers, also comes out a `plan` cube socket (`planImport.ts`). The outline becomes nesting, names are resolved from row numbers at the border, typed links become a Task · Type · Lag table, and the flat outline goes on `frame`.
  - `planNotes` carries what an MSPDI read could not model; the status line lists it as "Not carried over".
- **Geocode**: a place name to latitude, longitude and IANA time zone, from Open-Meteo, keyless. The Place input is a wireable socket row, so a Text Input or a frame cell drives it exactly as a typed name does. Several matches fill a pick list on the card (blank picks the top match), stored by its label; the card's rows read the same pick the node computes, and changing the pick needs no new fetch. The card is 240 px wide (`.solenoid-node--geocode`), matching Weather, so an IANA zone and a full match label ("Boise, Idaho, United States") fit.
- **Weather** (Open-Meteo): a Daily frame (Date · Rain mm · Rain % · High · Low · ET₀ mm · Condition, past and future days in one frame) and the Now temperature and condition. Latitude and longitude are wireable socket rows, driven by Geocode's outputs or typed fallbacks. The °C/°F toggle sets the API's unit and tags the temperatures with it, so the unit carries downstream. The Daily frame's columns are declared up front, so downstream pickers know them before the fetch lands; until then, or after a failure, the output is blank.
- **Holidays** (Nager.Date): a year's public holidays (year 0 is the current one) for an ISO country code as a Date · Name · Local frame, a Dates list feeding NETWORKDAYS / WORKDAY, and the whole days to the next holiday. The region (US-CA) is optional and filters without a new fetch.
- **Currency** (Frankfurter ECB FX): a **Spot / History** `mode` swaps the sockets in place, pruning the departing cables first ([[D10]] onePrunePath).
  - Amount is a wireable number row and From and To are wireable currency dropdowns, where a cable overrides the pick. The card previews the typed amount while the socket carries the true, possibly wired, one.
  - Spot: Amount / From / To → Converted (authored with the target currency as a unit, the same path Convert takes, [[C25]] firstClassUnits), plus Rate and As-of. The amount applies without a new fetch.
  - History: From / To and a date range → a Date · Rate `frame` to chart. History has no Amount, since a rate series has nothing to scale. The range defaults to the last 90 days, filled only into blank fields; a wired date wins, and a wired blank blanks the result. The range fetch sits behind the same network gate ([[C103]] untrustedContentSeams).
- **Vault Folder** (`nodes/connection.ts` `VaultFolderNode` + the pure `vaultCube.ts` / `mdbaseTypes.ts` / `obsidianTypes.ts` / `dailyNotesConfig.ts`; in the Connections › Obsidian menu with the other vault nodes): an Obsidian folder becomes one `cube`, a row per note. Rows are never saved; reopening re-reads the vault.
  - Columns: the Bases `file.*` built-ins (path / name / folder / ext / size / created / modified / tags / links / embeds / date) plus the frontmatter union. Scalars are typed, lists become list cells, and rows-of-objects become nested frames.
    - Built-in columns come first, then frontmatter columns in first-seen order across notes. A `tags` key folds into the built-in column; any other key that clashes with a built-in name is dropped, the built-in winning. `size` falls back to the text's UTF-8 length and `created` / `modified` to null when the disk gives none. A link or embed column holds each `[[target]]` with its `|alias` and `#heading` dropped.
    - Widening across rows: kinds that all agree keep that kind, mixed or empty become string, and an ISO datetime string upgrades to date. A list column carries its element type, which the list cell tints and prints by. A rows-of-objects key becomes a nested cube (`recordsToCube`), a picked plugin column type beating inference; a matrix stays rows of cells, a flat list is one row, and a stray array in a scalar column collapses to its first cell.
  - Typing per key: mdbase, then `.obsidian/types.json`, then a guesser widened across rows; the Solenoid Properties plugin's column picks type a frame property's columns. mdbase collections are found per folder (an `mdbase.yaml` plus its `_types` folder, which is never read as notes), and a note takes the collection with the longest matching folder prefix.
    - An mdbase collection (mdbase-spec v0.3) is a folder with `mdbase.yaml` and a `_types/` folder of markdown type files (`kind: mdbase.type`, a `match.path_glob` relative to the collection root, and a JSON Schema under `schema.value`). A note takes the first type whose glob matches, where `**` spans folders and `*` stays within one. An unknown `spec_version` or an unparseable schema gives no types and no error. Write Properties validates a value against the matched type's type, enum, min and max; a null value passes there, since a missing required key is checked per row. mdbase declares no matrices.
    - In `.obsidian/types.json`, Obsidian's `multitext` is a list and `list` is accepted as a synonym; an unknown type name gives no hint and falls through to the guesser, and a malformed file reads as no hints.
  - The date-from-name column uses the file-name format (moment tokens, the daily-note set); blank means the daily-notes format when the folder is the daily-notes folder. An unknown token is matched literally, and a name that does not match, or yields no day, gives null.
  - **`folder` and `glob` are wireable string inputs.** A cable drives which subfolder and name filter to read; otherwise the card's dropdown and field do (they disable when wired). The glob (`*`, `?`) matches the file's base name, case-insensitive. `data()` resolves each, and `load()` reads the resolved values.
  - Include-body puts the body in a **`note-body`** column, the reserved property Write Properties round-trips as the note's body.
  - There is no per-node vault: the vault nodes use the app-wide `obsidianVault` setting.
  - It is a desktop-only local read (no network gate). On web it shows "Reading a vault is available in the desktop app only", except for the demo vault. `statVaultFile` backs created / modified.
- **Import Obsidian Note**: see *Obsidian* below.
- **Write File** (CSV / JSON / Text): disk writes fire only from the node's Run button ([[C38]] sinkRunButtonOnly). The format is an argument ([[C26]] opArgDistinct).
  - CSV is RFC 4180 through Papa Parse, each cell formatted as displayed, text cells neutralized against spreadsheet formula injection ([[C103]] untrustedContentSeams).
  - JSON is an array of row records, the shape Web Source reads back; only dates (ISO, a time kept) and error cells become strings.
  - Text writes a wired string verbatim (Schedule's `mspdi` Project XML), so the input becomes a string socket in that mode; switching across that boundary retypes it and prunes the cable.
  - A lazy upstream is read in full only at Run. Browse picks a path in a Save dialog without writing.
- **Data Quality**: **Expect** and **Tornado**.
  - **Expect** passes its value through unchanged, type and unit included, and never blocks it. Its checks: not-null (on by default; a per-cell error fails it too), unique (a Frame's rows; a list's values, blanks skipped), range (a missing bound skips only that bound), regex (text cells only; an empty or invalid pattern skips) and in-list (a wired list or the card's comma-separated list, compared by text, so number 5 matches text "5"; blank cells pass). A Frame checks every cell. A wired blank parameter skips its check rather than falling back to the card. An incoming error passes through without a badge. A failure badges the card and fires a warning Alert when the set of failing checks changes.
  - **Tornado**: a sensitivity sweep figure. It passes its value through, so it sits inline in a chain. A Run perturbs every Number and Slider upstream and ranks them by raw swing, recording the swept input range and whether the width came from a slider or a number; a leaf whose result goes non-finite at an extreme is kept and marked, never dropped. The sweep is `tornadoRun.ts`.
- **Canvas and meta**: **Session History** (a live, sockets-free undo / redo log that holds no state and regenerates from the history snapshot on every render), **Presentation** (an ordered list of steps, each a title and an explicit set of cards, stepped by pan and zoom only; isolate, highlight and dim are separate mechanisms it leaves alone).

### Headless seam

`fileBridge.ts` has an injectable `FsProvider` (`setFsProvider`; `hasFs()` means the desktop shell or an installed provider).
- The vault readers and writers (`listVault*`, `readVaultFile`, `statVaultFile`, `readTextFilePath`, `writeTextFilePath`, `ensureDir`, `pathExists`, `joinPath`, binaries) route through it. The Obsidian sinks and readers gate on `hasFs()` instead of the shell.
- `scripts/run-graph.ts` flags:
  - `--vault <path>` installs the Node provider and points the Obsidian nodes at it.
  - `--tasknotes <url>` lets Node's fetch reach the plugin.
  - `--run <sink name>` arms and runs one named sink after the compute. It is the Run button's headless equivalent ([[C38]] sinkRunButtonOnly).
- With a vault or url, the runner awaits every background load (`connectionStore.trackInflight` / `whenConnectionsSettled`) and computes again, so the printed values include what was read.
- Test: `scripts/run-graph-vault.test.ts` over `demo-vault/` (a read, and a `--run` write into a temp copy).
- Dialogs and the OS opener stay desktop-only.

### Obsidian

**Import Obsidian Note** is a Note (`NoteNode`) with a source path and a read-only body; the body persists, so a loaded document shows the imported content on the web too.
- **The source note is a wireable identity.** It has a `path` output (vault-relative, `.md` included, matching a Vault Folder cube's `path`) and a `path` input that loads that note in the background, replacing the picked one (`loadFromWire`: read the file, adopt the body and frontmatter sockets, recompute; the VaultFolder guard pattern). A wired path may be vault-relative or a bare note name, resolved case-insensitively from anywhere in the vault, as Obsidian resolves `[[Name]]`. An unreadable note keeps the current body.
  - The note's own title (its file name) renders at the top of the card body, and the card label adopts it while the label is the default.
  - `NoteNode.reservedOutputs()` keeps the path output through `syncFields`.
- **Reload cadence:** `refreshMinutes` (persisted; 0 is off). The picker's foot carries "every N min", and the component reruns `reload()` on the cadence while a file is picked (desktop). The watcher hook waits on the Stage-0 desktop watcher.
- **Midnight rollover** (R5, `volatileDates.ts`):
  - `hasVolatileDates(nodes)` spots `TODAY()` / `NOW()` in an `expr` or a Frame's formulas, and a relative Date Input phrase.
  - `armMidnightRollover` (installed by App) runs `requestRecalc()` at each local midnight when one exists. There is no setting.
  - Tests: `volatileDates.test.ts`.

**Open in Obsidian.** `obsidianLinks.ts` builds `obsidian://open?vault=<vault folder base name>&file=<vault-relative, no .md>`, and `openExternal` launches it (the opener capability is widened to `obsidian://**`). It appears on the Import Obsidian Note header (when a file is picked), on Write to Obsidian after a successful Run (`lastWritten`, transient) and on the Vault Folder card.

**Write to Obsidian** (`WriteObsidianNode`, `nodes/obsidian.ts`) is one vault sink with a Target dropdown: Auto (a wired Document writes a note, wired rows write properties), Note or Properties. `data()` only plans; the write fires only from Run ([[C38]] sinkRunButtonOnly), which is refused while disarmed, on the read-only demo vault, off desktop, or with no vault set.

- **Note target.**
  - **Modes.** `mode` is overwrite | append | block on the card (SegToggle; persisted). A missing note is created in every mode. `mergeNoteText` (`obsidianWrite.ts`) is the pure merge.
    - `block` splices the assembled markdown between `%% solenoid:begin <node name> %%` and `%% solenoid:end %%` (`managedBlock.ts` `spliceBlock`). Markers in a code fence are text, and a begin with no end gets a fresh pair. Content carrying `%%` outside a fence is refused with the line, so nothing invisible is written.
    - `append` adds after one blank line.
  - **The target is a single vault-relative `path`**: a wireable `string` input, set by an InlineInputs literal or else a cable (a Vault Folder row's `path`).
    - A **Browse** chooser lists the vault's notes (the Import picker).
    - A `folder/name` path splits: the last segment is the name (`.md` stripped), and the leading folder prepends to the subfolder `<select>`. `renderedTarget()` does the split. A blank name falls back to the card's label.
    - A mail-merge batch names each note by its page, so a blank name still writes (`writeDocumentToVault`). A batch that hit the page cap reports "500 of N"; a merge with no rows writes nothing and says so.
    - There is no `{{date}}` / `{{daily}}` template grammar, `date` input or `nameTemplate.ts`. To date a note, wire a formatted date into `path`.
  - Preview names the action (Create, Overwrite, Append to, Rewrite the block in) and the size.
  - Tests: `managedBlock.test.ts`, `obsidianWriteModes.test.ts`.
- **Properties target.** A `cube` of rows (a Frame widens) goes to notes' YAML frontmatter, keyed by a `path` column. There is no separate `WritePropertiesNode`.
  - A **`note-body`** column writes each note's body (`setBody`), and the frontmatter block stays byte-identical.
  - **One YAML writer.** The pure `frontmatterPatch.ts` is the one writer of a note's YAML ([[C101]] onePatchPath). `patchFrontmatter` edits line-level over the raw text:
    - A present key's whole span (its line and every indented line under it) is replaced.
    - A missing key appends before the closing fence, and a note with no block gets one.
    - Untouched bytes stay identical.
    - An opening fence with no closing fence counts as no block: the text is left untouched and a fresh block is written above it.
    - The keys written are the `keys` CSV when given, else every column except `path` and the read-only file built-ins (`BUILTIN_READONLY`: path, name, folder, ext, size, created, modified, links, embeds, date), which describe the file rather than the note. A row with no `path` cell is skipped.
    - The `note-body` column is written when `keys` is blank or names it, one plan row per note whose cell is text. `setBody` ends the body with exactly one newline, whatever the cell carried, so a read, write, read cycle is a fixed point, and a CRLF note stays CRLF.
  - Everything renders in **Obsidian's block style**: a list as a `- ` block, rows as `- k: v` items, a list field as a nested block. That is the spelling the Properties editor writes back, so a note Solenoid wrote and one Obsidian rewrote look the same.
  - `cellToYaml` normalizes a cube cell: dates by the column type (unquoted), a string naming a note in the cube's own `path` or `name` column becomes a `[[link]]`, a nested Frame or Cube becomes rows.
  - `data()` plans the **`plan`** frame (path · key · before · after · action, pending).
  - **Preview** reads each note, resolves add / update / unchanged / refused / unreadable, and fills the current value.
  - **Run** (armed only, gated on `hasFs()` so headless `--run` drives it) patches and writes atomically.
    - It registers a new key's type in `.obsidian/types.json` (`addMissing`; a list column is `multitext`, number `number`, logical `checkbox`, date `date`, anything else `text`) and bumps an existing `dateModified` / `updated`. Registration never fails the write.
    - It is **mdbase-aware**: it walks up for the note's `mdbase.yaml` / `_types` and refuses a row breaking type / enum / min / max / required, with the reason in the plan's `action` (`mdbaseSchemaFor` + `validateAgainst`).
  - `writeBase` (off by default; a card toggle) also writes a `<node>.base` Bases view over the folder; that companion never fails the write either.
  - Tests: `frontmatterPatch.test.ts`, `baseView.test.ts`, and the mdbase-validation slice in `vaultCube.test.ts`.
- **Links both ways.** Write to Obsidian has a **Link to graph** toggle (`stamp`, off by default, opt-in). When on, Preview names the `Solenoid/<doc>.md` stub before Run, and on Run it patches `solenoid: "[[Solenoid/<doc>]] › <node>"` onto the written note (through `frontmatterPatch`) and creates or refreshes that stub note (`type: solenoid`, `nodes:`, `writes:`, `updated:`; the body lists what the graph writes where, plus the `run-graph --run` line). Only a single-page write is stamped, and stamping never fails the write. Pure `graphStub.ts` (`buildStub` / `mergeStub` / `stubLink`), tests `graphStub.test.ts`.

**TaskNotes** (`nodes/taskNotes.ts` + the pure `taskNotesApi.ts`, input kind, Connections › Obsidian menu): the TaskNotes plugin over its local HTTP API.
- Settings: `Settings ▸ Obsidian ▸ TaskNotes API`, default `http://localhost:8080`. A URL typed without a scheme (`localhost:8080`) gets `http://`, and trailing slashes are dropped. The bearer token lives in `apiKeyStore("tasknotes")`, typed on the card, never in the settings file.
- One node, with a `provider` select that reshapes the sockets:
  - **Tasks** → a `tasks` cube: path · title · status · priority · due · scheduled · completed · timeEstimate · trackedMinutes · archived; then projects · contexts · tags · blockedBy as list cells; timeEntries (Start · End · Minutes · Description) and complete_instances (Date) as nested frames; created · modified; then every user field as its own column in first-seen order. Dates read from `YYYY-MM-DD` or an ISO datetime, and a blank or unreadable one is null. A link-valued field (`[[Name]]`, `[[folder/Name|alias]]`, a bare `folder/Name` path with the .md extension) reads as `Name`. A user field keeps its scalars as typed, a list becomes a list cell, and an object becomes its JSON text, so no key is ever dropped.
  - **Calendar** → `from` / `to` date inputs (unwired: a year either side of today, since the API needs a bounded window; a wired blank fetches nothing; the two swap into order) and an `events` frame (Title · Start · End · Source).
  - **Stats** → one `stats` frame, Status · Count, with a row each for total, completed, active, overdue and archived.
- It pages `GET /api/tasks` (200 per page) until `hasMore` is false. An envelope with `success: false` throws its error text, which surfaces in the status line: a 401 reads "Token rejected. Paste the plugin's API token.", and an unreachable plugin says to install it and turn on its HTTP API.
- The Web Source background fetch, keyed on provider, url and window, rides the network gate ([[C103]] untrustedContentSeams). The demo vault's canned replies parse in the same pass with no network, so a seed computes on its first fetch ([[D62]] demoVaultResolution).
- The provider switch prunes departing cables through `dropInputCables` + `dropStrandedFrontmatterCables` ([[D10]] onePrunePath).
- Tests: `taskNotesApi.test.ts` (one fixture per endpoint), `nodes/taskNotes.test.ts`.
- Not yet: the calendar-events source shape beyond title / start / end / source.

**Write Tasks** (`nodes/taskNotes.ts` `WriteTasksNode`, sink kind, Connections › Obsidian menu): rows (a `cube`; a Frame widens) go to the TaskNotes API.
- A row with a `path` → `PUT /api/tasks/:id` (URL-encoded path). A row without one → `POST /api/tasks` from its title. Nothing to send → skip.
- The fields sent are the writable task keys present (`WRITABLE_TASK_KEYS`: title · details · status · priority · due · scheduled · tags · contexts · projects · recurrence · recurrence_anchor · timeEstimate · blockedBy), narrowed by the card's comma-separated `keys` literal (blank sends every writable column present).
  - `cellToTaskField` turns serials into `YYYY-MM-DD`, arrays or comma text into arrays, and blocked-by names into `[[Name]]` FINISHTOSTART links. Numbers are sent as minutes, a blank cell sends nothing for that key, and a nested table has no API field.
  - `path` always addresses the task and is never sent as a field, and a create needs a title. The reply to a create or update is read for the task's path when present.
  - Read-only columns (trackedMinutes, nested tables) never send.
- `data()` caches and emits the **`plan`** frame (path · title · action · fields).
- **Preview** reads each update row's task and marks `unchanged` / `unreadable`; new rows clear it.
- **Run** (armed only, [[C38]] sinkRunButtonOnly; `enabled` never persists) sends the rest and reports created / updated / failed, naming the first failures.
- The pure half is in `taskNotesApi.ts`; `fetchJson` (POST / PUT) is in `httpBridge.ts`. Tests: `taskNotesWrite.test.ts`.
- Not yet: `/api/nlp/create` for a single text column; a `stamp` toggle (the Link to graph stamp stays off for task notes anyway).

## Annotation

The mechanics of Notes, Reports, Knap, mail merge, vault writes and export are `../tree/specs/documents/reports-and-notes.md`.

- **Note**: a free-floating sticky note with a markdown title and body, drag and tint.
  - **Frontmatter sockets.** A Note is sockets-less by default. If its body opens with an Obsidian-style `---`-fenced YAML frontmatter block, each key becomes a typed output socket (the guessed type is persisted and overridable per key), so the Note doubles as a typed-record or constants source (`noteFrontmatter.ts`).
  - A key whose value is a list of maps emits a **frame** output, with columns from the row keys. Any YAML spelling works: Obsidian's block rows, `- {k: v}` inline, or `[{k: v}, …]` flow (`noteFrontmatter.ts` reads through the `yaml` package).
  - It emits a **cube** output when any row value is a list (`after: [B, C]` or a nested `- ` block). `recordsToCube` in `frame.ts` is the rows-to-cube shape the vault readers share: a list value is a list cell, never joined into text. This is the Script node's `{name: value}` row shape, so a Note can seed a table with no Frame from Lists.
  - **Knap inside frontmatter.** A quoted tag value (`total: "{{ price | round }}"`, with the note's other fields as its variables) puts its rendered value on the socket, typed by the render's plain-scalar guess (or the key's pin). Knap has no arithmetic, only variables, comparisons and filters. The document carries the rendered block, and the socket retypes through the same reconcile as a body edit (`renderedFields`, a microtask).
    - A Report using such a note as its template defaults an unwired input to the rendered value.
    - An unquoted tag is a YAML flow map, so the socket emits `#SYNTAX!` "Knap vars in frontmatter require quoted "{{var}}" syntax" (`knapUnquoted`). There is no pre-parse rewrite: quoting is the spelling, and the removed `{{daily}}` grammar stays removed (the author's call).
    - Tests: `annotation.test.ts`, `report.test.ts`.
- **Note and Report bodies are Knap templates** (knap.md, the Obsidian template language; `knapTemplate.ts`, the `knap` package; [[C68]] knapIsTheDocumentSyntax). Knap is the authoring syntax; `` `=name` `` survives only as the internal span below.
  - `{{ name }}`, `{% if %}` / `{% for %}`, `{% set %}` and the standard filter set (`date`, `table`, `join`, `number_format`, `wikilink`, `yaml_property`…) render at compute into the `document` output.
  - A Note's variables are its own frontmatter fields (no inputs minted; dates as ISO text so `date:` formats them).
  - A Report's root variables mint `trueany` inputs, one socket per name, in first-use order.
  - **In a Report a bare `{{ name }}` embeds the wired value as the canvas shows it**: an FC-formatted scalar, a scrollable frame grid, a chart figure, a KaTeX lambda, a Mermaid diagram, a wired Note as a block. `{{ name | highlight }}` is the tinted text form.
    - `embedBareVariables` rewrites those tags to the internal `` `=name` `` / `` `=name!` `` span before the render, and the span resolves by kind afterwards (`inlineRefDisplay.tsx` on screen, `obsidianMarkdown.ts` at write, `reportExport.ts` at export).
  - Any other use of the name (a filter, a loop, a condition, dot access) reads the data form: Frames and Cubes as rows of `{column: value}`, a wired document as its body text, a date serial as ISO text only when the source socket is a date type, a chart as null.
  - A syntax error is `#SYNTAX!` on the document with `line:column`. The card and overlay preview show the same lines.
  - A body with nothing left for the engine after the rewrite (prose and embeds) stays synchronous.
  - Knap 0.4 rejects the `{{-` trim dashes its README lists.
- **Report**: a markdown document edited in the overlay; the canvas card is only an anchor, and unlike a Note it has no frontmatter outputs. Two fixed inputs:
  - **Template** takes a wired Note (a vault template through Import Obsidian Note, or a canvas Note) as the text instead of the body.
    - Its root variables mint the sockets, persisted as `sideVars` so restored cables find them before the first compute. `data()` reconciles them through `dropInputCables` when the template changes.
    - Its own frontmatter fills any input left unwired, and the overlay shows it read-only.
    - A Note's document carries its raw body as `source` for this. A Note keeps a bare tag naming no field literal (`renderKnap keepUnknown`), so a template note reads as a template on the canvas and round-trips to the vault intact.
  - **Records** is the mail merge (Word's term for the merge list, chosen over "Rows" as the primary keyword; the author's call).
    - A Frame or Cube renders one page per row (`renderKnapPages`: `record` and `index` in scope beside the inputs, `MAX_PAGES` 500), each named by the report's `pageName` Knap (blank uses the index).
    - The document carries `pages` and a body of the pages joined by a rule. Write to Obsidian writes one note per page (stamping skipped for a batch).
  - `template` and `records` are variable names too. Bare, they embed the note or the Frame; filtered or looped, they read the source text or the records.
  - Fixture: `tests/fixtures/mail-merge.json`. The Report showcase keeps a merge group. Write File writing the same pages to a plain folder is parked in the Write mega-merge (backlog).
- **Seeds** lean on the shaping filters (`sort:("col","desc")`, `slice`, `where:("col", v)`, `map:x => x.col`, `unique`, `sum:"col"`, `list:numbered`). The showcase, the decision memo and the mail merge each carry a sorted, sliced or filtered passage. `knap-upstream.md` lists the knap 0.4 bugs the seeds steer around.
- **Overlay chrome:**
  - The source pane tints Knap tags (`knapHighlight.ts`, a highlighted backdrop under a transparent textarea).
  - A Filters button lists every standard filter with its example (`standardFilterMetadata`) and inserts `| filter` at the caret.
  - A merge previews one page at a time with a stepper.
- **Image** (in the Add menu's Other category): a free-floating picture. Attach a local file or paste a web URL; it has a height field and no socket or data.
  - A web `url` round-trips through the JSON save (and copy and paste) through `extractInit`. A local file is read to a base64 `dataUrl` that is deliberately not persisted (the save is plain JSON, so image bytes never enter it), and `dataUrl` stays out of the `extractInit` whitelist. On desktop the file is bundled beside the document and `assetPath` persists (`../tree/specs/documents/save-format.md`); on the web a local attach is session-only. The `src` getter is `dataUrl || url`: a fresh local attach wins, and setting one source clears the other.
  - The height field uses `useDraftCommit` (commit on Enter or blur), not a live onChange, since a live-clamped number input can't be cleared to retype.
- **File Link** (in Other): a link to a file on disk, with a title, a preview row and an Open button. No sockets, no data.
  - It stores the path, not the bytes. Desktop persists the absolute `path`, and Open launches it in the OS app through `openPath` (needs `opener:allow-open-path`).
  - A web attach is session-only, since the browser has no path: Open works this session, and only `fileName` survives a reload, after which the card shows the name with nothing to open.
  - Attaching fills a blank or default title with the file name minus its extension, and the badge shows the extension.
  - It is a fixed-width card, deliberately not a SIZE_OWNER.
- **SVG Picker** (`nodes/annotation.ts` `SvgPickerNode`, `components/SvgPickerNode.tsx`, kind `input`, in Other): an interactive picture and visual slicer. Load an SVG, either a local `.svg` read as text or a web URL fetched to text. It is inlined into the well, so its inner shapes are hoverable and clickable.
  - **Click a shape or layer and the `Layer` string output emits its name** (element `inkscape:label` / `data-name` / `aria-label` / `id`, human label first, walking up to the nearest named ancestor; pure `svgLayer.ts`, `resolveLayer`). Wire that into a Filter to slice a dataset by the clicked region: a clickable map or floor plan as a data selector.
  - Clicking the current pick clears it. The pick is `null` (missing) until made.
  - It also flows the picture out the `chart` object socket as an `SvgValue` (`svgValue.ts`: source, selection and hover color). A Report, Display, Input Switch or Composite boundary renders it through the shared read-only `SvgFigure.tsx`, highlighting the same layer.
  - The hover and selection highlight is an imperative `filter: drop-shadow` glow in the adjustable color, not per-move React state.
  - Persistence: the markup lives in `stringLiterals.source` (the Mermaid pattern: text, no bundling, unlike Image). `url` / `hoverColor` / `selectedLayer` round-trip through `INIT_FIELD_ORDER`.
  - A cross-origin URL fetch can be CORS-blocked; a local-file attach always works. A failed fetch leaves an inline hint.
  - Tests: `svgLayer.test.ts`, `svgPicker.test.ts`.
- **Format Controller** (catalog label "Format"): a docked node that sets a socket's number format, and authors a unit only onto a unit-less value. Fed an already-united value, it mirrors the unit and locks ([[C25]] firstClassUnits: only Convert changes a unit). `formatModel.ts` is the control truth table.

**Conduit**: a block bundler (up to 8 lanes, one rotation angle) whose outputs travel as a single Ribbon cable.

## Packs

Add-on node bundles in `src/graph/packs/`. Pack nodes live in per-pack files (`packs/electricity.ts`, …), not `nodeCatalog.ts`: each pack file is its own inventory (formula entries, custom-node placements, Format Controller units and formats), and every pack has a vitest file asserting its formulas against reference values. Registration and activation are `packs.ts`; the authoring guide is `docs/pack-architecture.md`.

**Authoring shapes** (`packs/packShared.ts`, [[C76]] formulaPackDefault, [[C79]] packActivationIsPresentation):
- A pack file imports only `packShared`, its `<id>Formulas.ts`, `rete-nodes` and type-only app seams, never core internals. `<id>Formulas.ts` holds the pack's `formulas` and imports only rete-free kernels ([[D19]] implReteFree).
- A formula preset is pure data compiled into a locked Expression (or, with `equation: true`, a locked Equation, one relation replacing several solved forms), so it saves as a plain Expression and reloads even with its pack off. Presets carry no accent; the Add-menu highlight is for key nodes. Seeded `literals` let an idiom be a configuration of an existing preset rather than a sibling (Fiscal Quarter's start month of 1); an unseeded variable is 0.
- A real node class is for what the formula engine can't do: a list reducer, root-finding, a fact table, a custom widget.
- A pack's formula functions (`PackFormula`) are always registered for resolution and advertised only while the pack is active. Their names follow [[C51]] formulaNaming, and `formulaExtensions.ts` refuses to shadow a core name.
- `tags` claim existing core types, hidden when every claiming pack is off; `dependsOn` activates the packs this one needs; a placement with no path lands under "Docs & Files". HYPOTENUSE (TwoInputMath's `hypot` op) is claimed by both Geometry and Timesavers, and the catalog dedupes it by type.

The built-in set. Geometry and Common Excel Timesavers ship on; the rest ship off.

- **Geometry** (on): 27 formula presets (areas and volumes, circles and arcs, solids) + HYPOTENUSE + **Triangle Solver**, plus a DMS format and turn and px units. Trig is in radians.
  - Triangle Solver is the Equation card's pattern: every part (sides a, b, c and angles A, B, C in degrees) is an input and an output, known only through its cable, plus a logical Valid check and the triangle drawn to scale. The angle outputs carry the real `deg` unit per output (`annotationFor`), so they read as degrees downstream and a trig node in Auto mode picks them up; the sides stay bare. An angle wired in any angle unit reads as degrees.
  - Any three parts including one side solve the rest, plus area and perimeter (SSS, SAS, ASA, AAS). Fewer than three passes through quietly. More than three solves from a side-rich subset and checks the extras, like Equation's all-known mode (relative tolerance 1e-6). Three angles, the ambiguous SSA case, and impossible parts (a non-positive side, an angle outside 0–180°, angles summing to 180°, the triangle inequality) are honest errors (`#SOLVE!` or `#DOMAIN!`).
  - Its sockets are `numlist` like the rest of the Equation family: parallel lists broadcast to a triangle per index (the longest list sets the length, scalars repeat, a short list leaves that part absent), Valid becomes a logical list, and the figure draws index 0. An errored part fails that triangle.
- **Common Excel Timesavers** (on): reclassification tags on existing core nodes (so nothing disappears by default; the fundamental list ops Range, LinSpace, Reverse, Slice and Length stay core), 11 presets (Percent Change, CAGR, Ordinal, Clean Whitespace, Mask, word and occurrence counts; the date helpers Quarter with a fiscal start month, Days in Month, Age and Nth Weekday), and:
  - **Reverse Text** (Excel has no string reverse; surrogate pairs such as emoji stay intact).
  - **Spell Number** (a number in English words, cardinals to the trillions, decimals digit by digit, negatives prefixed; or an ordinal, 42nd). Its kernel is in `textOps.ts`, so the SPELLNUMBER formula never loads the editor.
  - **Time Zone Convert** (formula `TIMEZONECONVERT(datetime, from_zone, to_zone)`, the one shared kernel `convertZone`; pure `Intl`, DST-correct at the instant). The result defaults to a datetime display style (`annotationFor`), which a docked Format Controller overrides. From and To take Geocode's time zone or a typed IANA name, with suggestions from `timeZone.ts` `IANA_ZONES`. It stays blank until every part is present.
  - **World Clock** (a zones list to a Place · Local frame of the current local time in each; pure `Intl`, DST-correct; it recomputes with the graph, with no live tick; the Zones field shares the IANA suggestions).
  - **QR Code** (text, URL, Wi-Fi join or vCard to an `ImageValue` on the chart socket; `qrcode` is lazy-loaded, and the SVG build is `qrCode.ts`).
- **Electricity & Circuits**: 23 presets (SI units) + Electrical FC units and an SI-prefix format (3 significant figures, 4700 is "4.7k"). Ohm's Law and dBm ↔ Watts are locked Equation presets (solve any way, or truth-check). Custom nodes:
  - **Parallel Combine**: 1/Σ(1/x), a node because it reduces a list and the formula engine is element-wise. Errors propagate and blanks are skipped; empty is blank; any 0 gives 0 (a 0 Ω branch); cancelling reciprocals are `#DIV/0!`.
  - **E-Series Value**: the nearest IEC 60063 preferred value by ratio (log) distance, looking into the neighboring decades (9.8 snaps to 10). E3 to E24 are the published tables, which deviate from the geometric series; E48 and E96 follow 10^(k/N).
  - **AWG Wire**: diameter (mm), area (mm²) and copper resistance (Ω/km). Ampacity comes from the NEC 310.16 copper 75 °C column, for the table's integer gauges only, else blank. Outside 4/0 (−3) to 40 is `#DOMAIN!`; fractional gauges are allowed.
  - **Resistor Color Code**: 4- or 5-band dropdowns and a live band glyph, giving ohms and tolerance (IEC 60062).
- **Electromagnetism** (depends on Electricity): 20 presets (CODATA 2018 constants baked in, SI units, radians; Wavelength ↔ Frequency is an Equation preset), the **Physics Constant** node (CODATA 2018, several exact since the 2019 SI redefinition, grouped Universal, Electromagnetic, Atomic and Physico-chemical; its unit rides downstream like an FC lock, as a custom suffix because units like J·s are not FC unit ids) and **EM Spectrum Band** (a frequency or wavelength to Radio…Gamma; visible light names its color; emits both quantities through c).
- **Health & Fitness**: 21 presets (BMI / BSA / IBW, body fat, BMR / TDEE, cardio, clinical; metric inputs; a sex-specific equation ships as two presets, never a hidden ± input) and **Heart-Rate Zones**: age, an optional resting HR and an optional max override (else 220 − age; wire the pack's Tanaka node) give a five-zone Low / High Frame (Z1 Recovery 50–60 %, Z2 Endurance 60–70, Z3 Tempo 70–80, Z4 Threshold 80–90, Z5 Maximum 90–100 of max), switching to Karvonen (heart-rate reserve) when a resting HR is given. It needs a max above 0 and a resting HR between 0 and it; the HEARTRATEZONES formula gives the five rows as a matrix, since Frames stay out of formulas.
- **Fluid Mechanics**: 20 presets (SI; g = 9.80665 m/s²), pressure, flow and viscosity FC units, and:
  - **Friction Factor (Colebrook)**: the friction factor, a node because Colebrook–White is implicit. It iterates from the Swamee–Jain seed, hands off to laminar 64/Re below Re 2300, and is `#DOMAIN!` unless Re > 0 and 0 ≤ ε/D < 1.
  - **Pipe Roughness**: a 13-material ε table in mm; with a diameter it also emits ε/D for Colebrook or Swamee–Jain.
- **Thermodynamics & Air**: 18 presets (SI; kelvin where the physics needs absolute temperature, °C only where the correlation is °C-native), Energy FC units, **Standard Atmosphere** (US Standard Atmosphere 1976, −2 to 86 km, from the layer formulation rather than a transcribed table; a geometric altitude converts to geopotential) and **Vapor Pressure** (Antoine, nine substances, with each normal boiling point solved from the same coefficients). The four solved ideal-gas forms are one pV = nRT Equation preset.
- **Sets & Membership**: Is In (a logical mask aligned to Values, with Set's membership rules; a blank or error in Values passes through per cell) and Tally (distinct values counted into a Value · Count Frame in first-seen order, skipping blanks and errors; its TALLY formula returns only the counts, since the Frame can't cross the formula surface). It claims the core COUNT DISTINCT aggregate op. Semi and anti join modes are core Join.
- **Earth & Sky**: 8 presets (great-circle distance by haversine, bearing, gravity, orbits; degrees at every socket, meters) and three NOAA nodes: **Sun Position**, **Sunrise / Sunset** (zenith 90.833°; polar day or night leaves sunrise and sunset blank with a day length of 24 or 0; its formulas are SUNRISE, SUNSET and DAYLENGTH) and **Moon Phase** (the mean synodic month from a reference new moon, good to about half a day: fine for calendars, not for eclipses).
- **Chemistry Basics**: 11 presets (grams, moles, liters) + Chemistry FC units, and:
  - **Element**: 118 IUPAC abridged weights (an element with no stable isotope carries its bracketed mass number); the mass output carries g/mol per output (`annotationFor`), the atomic number stays bare. The card opens a picker popup: fuzzy search (symbol exact, then symbol prefix, name prefix, name substring, atomic number) and the clickable 18-column periodic table itself (symbols only; the current pick and best match accented).
  - **Molar Mass**: a formula parser. `formula = segment (('·' | '.' | '*') segment)*`, `segment = count? unit+`, `unit = (element | '(' unit+ ')' | '[' unit+ ']') count?`. Counts may be decimal, a hydrate segment may open with a multiplier (CuSO4·5H2O), and an unknown two-letter symbol retries as one letter. A bad formula is `#VALUE!` naming the problem.
  - Moles ↔ Mass and pH ↔ [H⁺] are Equation presets.
- **Data Science**: K-Means, PCA, Logistic Regression and the nonparametric hypothesis tests (Kruskal–Wallis, Mann–Whitney, Wilcoxon, Fisher exact, KS) as pack placements; the mainstream tests (z, t, F, chi-squared, ANOVA, proportion, binomial) stay core.
- **Scientific Computing**: Spectrum, Smooth, Find Peaks, Convolve, ODE Integrate, Solve, Eigen, Polynomial Roots, Fit Distribution and Decompose as pack placements. The pack placements' catalog type strings never change, because saves and formula names key on them.

Composite-shaped pack ideas are planned, not built: `docs/pack-composite-plans.md`.
