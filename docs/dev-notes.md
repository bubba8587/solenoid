# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### SESSION DIGEST (2026-11-05: P7, what an empty card field is; cloud session)
- **Every card field declares what it is when empty** ([[D96]] emptySlotShowsItsValue, rewritten at the author's direction; [[inline-literal-maps#What an empty field is]]): a Fallback (muted, upright, computed with), a Behavior (`[word]`), an Example (italic, the card answers blank) or Required. The core's table (`EMPTY`, `EMPTY_BY_OP`, `SOLVERS` in `nodes/fields.rs`) and settings' roles hold it; `Call::unwired` applies it; `emptyFieldShown` draws it. `read_num` and its hidden defaults are gone; `emptyFieldKinds.test.ts` fails an undeclared field.
- **A formula's empty slot reads its card's Fallback** where Excel's empty value would error (`CARD_FALLBACK_SLOT`, the call table's `blanks`), and every card is held to its formula twin's empty reading.
- **The walk itself, its rulings and the judgement calls for the author to look over:** `docs/p7-walk.md`. Out of scope until reopened: a cable carrying a blank, the formula variables (`x`).
- **Date-family cards dropped the 210px medium tier**; the tier stays, empty.

### SESSION DIGEST (2026-11-04/05: typed card inputs, one field per input, cell collapse; cloud session)
- **Keyed vs typed** (`glossary.md`): *keyed* is keyboard entry, *typed* is having a type.
- **A wildcard slot's keyed value is read as the kind its button shows**, never guessed from the text: the Frame column's type button rides the field (Number, Text, Date, Boolean), the text stays as keyed, and the unwired socket takes the kind's color (the settle's rest type). `parseAuto` is gone ([[C10]] socketLattice, [[C58]] tableInputRawText; [[inline-literal-maps#Wildcard slots]]).
- **Comparison and Between take any value** ([[D124]] comparisonFunctions): A, B and Value are `anycombo`, Low and High `any`; complex numbers stay equal-or-not with ordering refused.
- **One field per unwired input, decided by the core's table** (`nodes/fields.rs`; [[inline-literal-maps#One field per input]]): the canvas draws the field it names, every body reads through it (the saved maps are private to `fields.rs`), every restore path prunes what no field reads, and `graphValidate` flags a saved value nothing reads. A logical input's field is Value Input's checkbox. Example defaults became placeholders where a blank doesn't error (IFS, SWITCH, Molar Mass, Alert and others); 0s and 1s stay.
- **Value Input:** its type is `OpCycle`, the type button in the op accent beside the field (DESIGN.md § Op pickers). **Cell collapse** (`NodeShell cellCollapse`, `CollapsedCell`): Value Input, Constant, Physics Constant and TODAY/NOW collapse to their value cell, tinted and edged in the header's stroke; Value Input's cell is edited as a Frame cell ([[components#Card chrome]]).
- **SWITCH and IFS:** a pair's × rides the rule above it. The socket legend puts Complex after Boolean. Accent text at full strength is `--node-accent` itself, already themed (DESIGN.md's ladder).
- **Open from this session:** strict Logical/Date reads in Value Input; a warning (or a literal syntax) for a date-shaped formula like `01-Feb-1992`; the × treatment for Filter, Sort and SUMIFS pairs.

### SESSION DIGEST (2026-11-04: typed criteria, the comparison functions, the Sets pack; cloud session)
- **A criterion is an operator and a typed value** ([[D123]] typedCriteria, F8): `">="&DATE(…)` and `"<="&cutoff` in a criterion's place compare with the date; criterion text against dates that reads as a date or a serial is `#TYPE!` naming the joined form; the SUMIFS card's rows run the same kernel (`excel_criteria::card_criterion`). [[formula-language#Criteria]].
- **One comparison kernel** (`compare.rs`, [[D124]] comparisonFunctions): the operators, IS, ISNOT, ABOVE, BELOW, ATLEAST, ATMOST, BETWEEN(values, low, high) and the Comparison and Between cards. Comparison, Between and Sets joined Is In and Tally in the Sets pack ("Sets & Comparisons"), on by default.

### SESSION DIGEST (2026-11-04: a volatile Script holds its result until F9; cloud session)
- **A Script whose source draws or reads the clock holds its answer until F9 or Recalculate** ([[C23]] calcModes, P6): `scriptIsVolatile`'s scan decides, and the card reuses its result while the recalc generation, the source and the arguments (compared by value) stay the same. Spec: `../tree/specs/computation/script-sandbox.md` § The source.

### SESSION DIGEST (2026-11-04: the spec ↔ test pass over computation/; cloud session)
- **Each computation spec's sections name their tests** and the tests cite them as `[[spec#Heading]]`; reasons and facts said only in test comments moved into the specs. Dated figures that sat in `../tree/specs/computation/rust-core.md`, as measured:
  - Load (2026-10-25): at 4 Mbps the chrome comes up at about 3 s where it waited about 13 s for the whole module; a `<link rel="preload">` brought the cards about 6% sooner at 40 Mbps but held the chrome back half a second at 4 Mbps (2026-10-22: the first render 0.4 s later). The 1.5.0-era `.deb` was 24 MB with Polars; on the core alone it is 18 MB.
  - Speed (2026-10-23, the million-row chain): 160 ms in wasm under Node, 210 ms natively; Polars as the desktop ran it 1.17 s (its verbs alone 60 ms, the core's 90 ms in wasm).
  - `wasmEngineBench` (2026-10-23, 200k rows × 5 columns, best of 3, ms): sort by a number 28.8, by text 76.9; filter value > 0 6.3, text contains 4.8; distinct key 3.9; group by key with sum, avg and median 24.8; window cumsum by cat over day 56.0, rank by cat 62.8; filter, group, sort 22.0; left join a 1000-row lookup 18.7; fx `@value / SUM(value)` 64.3, `@value * 1.2 + @cat` 35.6, `IF(@value > 0, ROUND(@value * 1.2, 2), 0)` 113.9, `@key & "-" & UPPER(@key)` 119.8, `IFERROR(LN(@value), 0) + MAX(@cat, 10)` 107.5, `IF(@value > PERCENTILE(value, 0.9), "top", PROPER(@key))` 217.4, `SUMIFS(value, key, "k1*") + DATEDIF(45000, 45000 + @cat, "md")` 224.5. Uploading 200k rows about 55 ms, a full download about 70 ms. Before the JS verbs went, the same ops ran 1.3 to 5 times slower on them.
  - Dispatch (2026-10-25): ABS 22 ns natively, PERMUTATIONA (first in its module's match) 129 ns; resolving per-name facts once into `Traits.fast` cut `ABS(@value)` from 1,440 instructions a row to 1,140.
  - Build size: `opt-level = "z"` 860 KB against 650 KB gzipped (2026-10-22); `opt-level = 2` 1.26 MB against 1.31 MB for 3 with brotli (2026-10-25). The module (2026-10-25): 4.6 MB raw, 1.7 MB gzipped, 1.26 MB brotli; HASH's crates add 20 KB gzipped; `call_function` is 53 KB before `wasm-opt`.
  - `cardBatchBench` over 50,000 items: UPPER about 30 ms (develop then: 23), ROUND about 36, ISEVEN about 27; `x - AVERAGE(vals)` over 3,000 items about 50 ms, from 1.9 s (develop then: 8 ms).
  - CSV: a 50 MB file reads into a typed frame in about 1.7 s in Node, from 4.1 s on Papa Parse and `inferColumn`; its rows alone in about 1.1 s.
### SESSION DIGEST (2026-11-04: the spec ↔ test pass over values, documents and floors; cloud session)
- **Each spec section names its tests, and each test cites its section** (`[[spec#Heading]]`) across `tree/specs/values/`, `tree/specs/documents/` and `tree/specs/floors/`; the tests' reasons moved into the specs.
- **Load measurements moved out of** `../tree/specs/documents/graph-load-teardown-performance.md`, which keeps the claims and how to measure:
  - The layout batch, on personal-finance (154 cards, production build, desktop CPU): forced layouts 860 to 306, React commits 1,070 to 645, load 6.9 s to 6.0 s. React Flow's own per-card measuring (`updateNodeInternals`) was about 0.7 s of a 241-card load.
  - The web node budget, measured 2026-10-05 in phone emulation (412 × 915, DPR 2.6, CPU 4×), personal-finance tiled, a 30-step drag at zoom 0.6:

    | Nodes | Load | Pan, frame p50 | Card drag, frame p50 / p95 |
    |---|---|---|---|
    | 154 | 8.9 s | 100 ms | 17 / 67 ms |
    | 308 | 17.9 s | 167 ms | not measured |
    | 462 | 34.1 s | 250 ms | 17 / 183 ms |
    | 616 | 53.4 s | not measured | 333 / 1333 ms |
  - The Decision Matrix scenario battery (`decisionIntuition.test.ts`, its first 63 scenarios answered under each normalization, from `../tree/specs/computation/frame-verbs.md` § Decision Matrix): `max` missed 3, `range` 9, `rank` 10.

### SESSION DIGEST (2026-11-04: dates before 1900, the date tests, Expect's date bounds; cloud session)
- **Days before 1900 are dates everywhere** ([[D119]] datesBefore1900; `../tree/specs/values/date-values.md` § Days before 1900): EDATE, the coupon and discount functions, TEXT, the Date Range card (a blank field is now null, day 0 a date) and the table popup's picker take them, from 01-Jan-0001 (`FIRST_SERIAL`/`END_SERIAL`). Fixed on the way: a year in 1 to 99 read off a date became 19xx (`date_utc`, which moved EOMONTH, WEEKNUM, ISOWEEKNUM, DATETRUNC), YEARFRAC truncated a negative fractional serial toward 0, and typed date text refused a year below 1000. `tests/dates_before_1900.rs` checks every date function, operator row and date card 400 to 1,600 years back against today.
- **The formula fuzz takes dates** (`tests/fuzz_formulas.rs`): every operator row and function class of date-values.md, and no function hands a date back as its serial. The divergence list is now `../tree/specs/computation/excel-divergences.md`, holding formula-language's deliberate differences, D115's breaks and D119's. **Open:** B16's wikilink still names `formulajs-divergences` (ring B to fix; `docsPointers.test.ts` fails until then).
- **Expect's Min and Max take the value's kind** ([[D120]] rangeBoundsTakeTheValuesKind, new): they turn `date` when In is a date (`ExpectNode.settleFollowers`, called by `settleWildcardTypes`; a cable the new type refuses is dropped in `reconcileFcTypes`), date bounds are typed as dates beside the number bounds (`dateLiterals`), and a date against number bounds or the reverse is `#TYPE!` (`../tree/specs/values/type-propagation-on-in-place-socket-retype.md` § An input that follows another).

### SESSION DIGEST (2026-11-04: Delayed Pass; cloud session)
- **Delayed Pass landed** ([[D118]] delayedPass, new, the author's ask): a loop through its `In` steps once per recalculation instead of `#CIRC!`. The engine never fetches `In` (a per-node port selection in `model.rs`), the loop finder skips cables into it, and `advanceDelayedPasses` hands each card its next value after every app pass. Spec: `../tree/specs/computation/compute-pass.md` § Delayed Pass.
- **Open:** no composite run mode advances a Delayed Pass card yet (it answers Start there), and its value isn't saved, so a reopened document starts over.
- The overnight Hold card, the C23 contest record and the control-flow write-up were reverted at the author's word (`033aab0`).

