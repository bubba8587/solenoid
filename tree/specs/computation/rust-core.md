---
aliases: ["Rust core"]
tags: [spec, computation]
---
<!-- [[C130]] rustCore, [[D99]] rustIsSpec, [[D98]] wholeColumnFallback -->

# Spec: the Rust core

Serves [[C130]] rustCore, [[D99]] rustIsSpec and [[D98]] wholeColumnFallback. `crates/solenoid-core` is a Rust port of the headless TypeScript core, built for two targets: WebAssembly for the app (`npm run build:wasm` writes `src/graph/engineWasm/`) and native for tests (`npm run test:core`). The method is borrowed from [tsrs](https://github.com/oxc-project/tsrs).

## The rule: the Rust is the spec ([[D99]] rustIsSpec)

- The core is the one implementation. A change in behaviour is made in the Rust, together with the fixtures it
  changes, in the same commit.
- The port began as a mechanical copy of the TypeScript, so the Rust keeps the TS's names (in snake_case) and order of
  operations wherever a fixture depends on them.
- Moving off the TypeScript, subsystem by subsystem:
  1. Freeze: the TS's answers on the differential tests' inputs are written to fixture files (`fixtures/core/`).
  2. Cover: the core answers every case the subsystem's callers make, so nothing falls back.
  3. Delete: the TS implementation, its fallback and its differential test go, and the fixtures stay as the test.
- The JavaScript semantics the frozen answers carry stay ported, because they decided those answers:
  - `String(x)`, `Number(x)`, `trim` and UTF-16 string order, in `jsnum.rs`.
  - `Array.prototype.sort` that never panics on an inconsistent comparator, in `js_sort.rs`.
  - `toPrecision`, in `unit_value.rs` (17 correctly rounded digits decide the cut unless they read as a possible tie, and Clinger's fast path turns them back into a number); `toFixed` and `toExponential`, exact ties rounding up, in `jsnum.rs`.
  - V8's `Math.hypot` (Kahan-compensated), and V8's `Math.exp`, `log`, `log10`, `log1p`, `pow`, `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `acosh`
    and `atanh`, in `fdlibm.rs`. These are fdlibm with V8's own tweaks, because
    the platform libm is off by an ulp on some inputs.
  - A JS exception (a function that throws) ends the row's evaluation.
- Table-driven facts stay in the TS and get *lowered* into the call, as unit scales are for Polars:
  - `withUnitScales` / `pivotUnits` lower unit scales.
  - `formulaCallTable` lowers argument roles, empty-slot readings, the null rule and range vs broadcast.
  - The Rust carries only the mechanics and the function bodies.
- Correctness rests on the conformance checks, not review:
  - `npm run test:core` runs the shared corpus (`fixtures/frame-verbs`) natively.
  - `tests/graph/wasmEngine.test.ts` runs the following through the real wasm module and backend wrapper,
    compared with the TS:
    - the corpus
    - seeded random frames under random verb chains, joins, appends and binds
    - random pivots (cells, layout record, units)
    - random formula strings (parse trees)
    - random computed columns (cells, error messages, side sockets)
    - bit-exact math probes
  - To widen a run: `FUZZ_RUNS=100000 FUZZ_SEED=7 npx vitest run tests/graph/wasmEngine.test.ts`.
- Where JS engines disagree among themselves (a sort whose comparator is inconsistent, such as NaN in a pivot
  sort field), there's no single answer to match, so the fuzzers leave it out.

## Tracking develop

Pinned upstream: `develop` @ `31ce0f7`.

On each rebase, list what moved in the ported TS, then port each change, run the checks above and move the pin:

```
git diff 31ce0f7..develop -- src/graph/frameVerbs.ts src/graph/frame.ts src/graph/frameBackend.ts \
  src/graph/valueKinds.ts src/graph/stringOrder.ts src/graph/unitValue.ts src/graph/pivotLayout.ts \
  src/graph/excelFormula.ts src/graph/excelFunctions.ts src/graph/inputRoles.ts src/graph/emptySlots.ts \
  src/graph/computedColumnCore.ts src/graph/nodes/statsOps.ts src/graph/nodes/mathUtils.ts \
  src/graph/nodes/dateOps.ts src/graph/nodes/dateSerial.ts src/graph/excelCriteria.ts \
  src/graph/nodes/textOps.ts package.json fixtures/frame-verbs
```

The Formula.js bodies (CEILING, FLOOR, MROUND, EVEN, ODD, SWITCH, REPLACE and the pass-throughs) follow the version
`package.json` pins: a bump means re-reading them.

Moved on develop since the pin (checked at `55ee047`): PIVOTBY's `details` (a Details field lists each row group's
source rows in the view's layout). The engine's layout doesn't carry them yet, so a pivot that asks for details runs on
the TS (`pivotNeedsOracle` in `frameBackend.ts`); porting them means adding `sources` to the leaf rows and the detail
columns to `engine_pivot_layout`.

## What it does and doesn't do

| Capability | Status | Evidence |
| --- | --- | --- |
| Frame verbs: select, drop, rename, sort, distinct, head, filter, filterMulti, groupBy, unpivot, window, fillBlanks, replaceValues, sliceRows | Ported | 256 corpus cases natively; corpus and 600k+ fuzz cases through wasm |
| join (all 8 kinds, unit-scaled keys), append, bindColumns, sample | Ported | as above |
| dropBlankRows, addIndex, splitColumn, mergeColumns | Ported; Polars lacks them, so on desktop with Polars on they run on the oracle | corpus cases plus the verb fuzzer |
| PIVOTBY: leaf order, subtotals, value sorts, percent-of shares, the pivot-view layout | Ported | 160k random pivots match cells, layout and units |
| Units, formats | Unit-blind, as Polars is: the TS lowers reading and unit scales into the op and restores metadata | `lowerForEngine`, `pivotUnits` |
| Formula tokenizer and parser | Ported whole | 300k random strings, well-formed and broken, give the same tree |
| Row formulas (computed columns): literals, `@column`, scalar side values, constants, every operator | Ported | 300k random computed columns match cells, messages and side sockets |
| Formula functions | 384 ported (the six list shapers below included; the Formula.js pass-throughs live in `formulajs.rs`). Logic: IF IFS AND OR NOT XOR NAND NOR XNOR CHOOSE SWITCH CLAMP BETWEEN ISBOOLEAN ISCLOSE, the IFERROR family, the IS tests. Math: ROUND ROUNDUP ROUNDDOWN TRUNC INT ABS SIGN SQRT EXP LN LOG LOG10 MOD POWER QUOTIENT PI SQRTPI DEGREES RADIANS CEILING(.MATH) FLOOR(.MATH) MROUND EVEN ODD HYPOTENUSE STANDARDIZE FISHER SLN. Trig: SIN COS TAN ASIN ACOS ATAN ATAN2 SINH COSH TANH ASINH ACOSH ATANH COT COTH ACOT ACOTH SEC SECH CSC CSCH. Aggregates: SUM MIN MAX AVERAGE MEDIAN PRODUCT STDEV(.S/.P) VAR(.S/.P) COUNT COUNTA COUNTBLANK AVEDEV GEOMEAN HARMEAN DEVSQ SKEW(.P) KURT PTP IQR MAD SEM CV RMS GCD LCM. Paired: CORREL PEARSON RSQ KENDALL COVAR COVARIANCE.P/.S SLOPE INTERCEPT STEYX. Order statistics: LARGE SMALL PERCENTILE(.INC/.EXC) QUARTILE(.INC/.EXC) PERCENTRANK(.INC/.EXC) RANK(.EQ/.AVG) TRIMMEAN MODE MODE.SNGL. Criteria: COUNTIF COUNTIFS SUMIFS AVERAGEIF AVERAGEIFS MINIFS MAXIFS, wildcards included. Finance: PMT FV PV NPER IPMT PPMT NPV RATE DB DDB SYD VDB EFFECT NOMINAL PDURATION RRI DOLLARDE DOLLARFR ISPMT FVSCHEDULE CUMIPMT CUMPRINC IRR MIRR XNPV XIRR, the coupon family (COUPDAYBS COUPDAYSNC COUPNCD COUPPCD COUPNUM), bonds and bills (ACCRINTM INTRATE RECEIVED YIELDDISC TBILLEQ TBILLPRICE TBILLYIELD PRICEMAT YIELDMAT PRICE YIELD DURATION MDURATION ODDFPRICE ODDFYIELD ODDLPRICE ODDLYIELD) and the return ops (MAXDRAWDOWN CAGR VOLATILITY SHARPE SORTINO), COUPDAYS DISC PRICEDISC (their dates in local time through `zone.rs`, the host's `Date` and `Intl`, and text through `date_parse.rs`, V8's `Date.parse`); ACCRINT stays on the TS (its `new Date(x)` and Formula.js YEARFRAC are not ported). Lists to one value: WAVG WVAR WSTDEV COUNTDISTINCT ARGMAX ARGMIN LENGTH CONTAINS. Distributions (`dists.rs`, the mathUtils kernels and `DIST_SPECS`): NORM(.S).DIST/.INV, T.DIST(.RT/.2T), T.INV(.2T), CHISQ.DIST(.RT)/.INV(.RT), F.DIST(.RT)/.INV(.RT), GAMMA, BETA, LOGNORM .DIST/.INV, WEIBULL, EXPON, BINOM.DIST/.INV, POISSON, HYPGEOM, NEGBINOM. Lookups: XLOOKUP XMATCH INDEX (a whole column as the TS's one-column table; a list of positions stays on the TS). Text: TEXT FIXED TEXTBEFORE TEXTAFTER REVERSETEXT PADTEXT TRUNCATETEXT NUMBERVALUE ORDINAL LEN CONCAT CONCATENATE TEXTJOIN MID LEFT RIGHT REPLACE UPPER LOWER PROPER TRIM REPT SUBSTITUTE EXACT FIND SEARCH CHAR UNICHAR CODE UNICODE VALUE N T DOLLAR, and the text utilities REGEXTEST REGEXREPLACE REGEXEXTRACT (one match; the list modes stay on the TS) ENCODEURL DECODEURL ENCODEBASE64 DECODEBASE64 HASH UNACCENT SLUGIFY SPELLNUMBER VALUETOTEXT TEMPLATE (`text_ops.rs`, `hash_ops.rs`). A regex runs in `regress`'s non-Unicode mode over UTF-16 units, as `new RegExp(p)` reads it; a pattern either engine reads differently (a quantified assertion, `\u{…}`, a caseless match outside ASCII) goes to the TS. Dates: DATE DATEVALUE TIMEVALUE YEAR MONTH DAY HOUR MINUTE SECOND TIME DAYS DAYS360 DATEDIF YEARFRAC EOMONTH WEEKDAY WEEKNUM ISOWEEKNUM DATETRUNC FROMEPOCH TOEPOCH WORKDAY(.INTL) NETWORKDAYS(.INTL) EDATE TIMEZONECONVERT | each body is checked directly against its JS one on random arguments; a formula calling anything else runs on the TS |
| Whole-column refs (a bare column name, `[col]`) as a range function's argument: `@x / SUM(x)`, `MAX([x])`, `COUNTBLANK(b)`, `XLOOKUP(@id, id, price)`, `INDEX(price, XMATCH(@id, id))`, `WAVG(price, qty)` | Ported, with `prepRangeArgs`' error scan, blank drop and row pairing, and a call that reads no `@` cell evaluated once | explicit cases plus the fuzzer |
| Readings only chrono-node does (a criterion like `">=Apr 3, 2026"`, `DATEVALUE("3rd April 2026")`) | Bail: the row stops and the whole column runs on the TS (`bail()`). The core reads the shapes it carries (`chrono_reading` in `excel_criteria.rs`): a bare number (never a date), `3-Apr-2026` with `-`, `/` or a space, and an ISO day then " and …" | explicit cases |
| A whole column in an argument that takes one value (`LARGE(x, x)` lifts per item) | Not ported: `formulaCallTable` lowers those positions (`scalar`) and the support check sends them to the TS | |
| Operators and calls over whole columns (`mapCells`, `broadcastCall`): `SUM((amount > 0) * amount)`, `SUM(IF(x > 0, x, 0))`, `COUNT(IFERROR(1 / x, ""))`, `WORKDAY(@start, 5, holidays)` | Ported where the list feeds a range function (and a holiday list anywhere). A whole column is a one-column matrix in the TS; a function Solenoid doesn't know answers `#SHAPE!` there, so `formulaCallTable` lowers `mapsColumns` | explicit cases plus the fuzzer |
| Wired LAMBDA columns: a bare λ column (params bound to same-named columns) and λ calls inside a formula (`λ1(@x, 2)`), captures riding as side values | Ported: a λ is lowered as params, body and captured values (`lowerLambdas`); a call's arguments must be single values, so a λ handed a whole column runs on the TS | the wired-LAMBDA fuzzer: random params and bodies, bare and called |
| Units in a computed column | Outside the evaluator: the column's unit and the reading refusal (`readingsRefusal`) sit around the call, so a unit-carrying column runs on the engine | |
| FILTER, UNIQUE, SORT, SORTBY, TAKE, DROP inside a range function: `SUM(FILTER(amount, region = @region))`, `COUNTA(UNIQUE(region))`, `AVERAGE(TAKE(SORT(x, 1, -1), 3))` | Ported (`shapers.rs`, over `listOps.ts`' grid rules: a whole column is a one-column table). The support check takes one only where a range function that flattens its lists reads it, or as another one's data; a list answer, an operator over one, a lookup reading one, and DROP's columns argument stay on the TS | the shaper fuzzer: random chains in random range functions |
| List answers (spills), matrices, complex numbers, applying a λ over a list (MAP, BYROW) | Not ported: runs on the TS | |
| Expression nodes, the compute pass, node `data()` | Not started | |

## Fallback ([[D98]] wholeColumnFallback)

`computeColumnOnEngine` answers null, and the TypeScript computes the column, in two ways:

- **Before running:** the support check (`supported` in `excel_formula.rs`) refuses an unported function, a whole column anywhere a list can't go (a lifted argument, a lookup's spill, a list of INDEX positions), a λ handed a whole column or called from inside another λ's body, or an apply.
- **While running:** a body that meets a reading only the TypeScript makes calls `bail()` (a date only chrono-node parses, a loop past a million steps, text a numeric body would add as text); the row stops and `formula_column` answers `Unsupported`.

## Where it runs

- **Frame verbs:** `initFrameBackend` picks Polars on desktop when it's on. Otherwise it uses this engine in
  wasm when Settings → Rust engine is on (the default). Otherwise it uses the JS oracle.
  - The wasm engine holds every cell kind, so unlike Polars it needs no oracle fallback for text or logical errors.
- **Pivot and computed-column formulas:** these run on the wasm engine wherever it's on, desktop included, beside
  Polars:
  - `pivotOnEngine` serves the PIVOTBY node and GroupBy with totals.
  - `computeColumnOnEngine` serves the Computed Column node and Frame Input's computed columns.
  - Both answer null for anything outside the ported surface, and the TS runs it.

## Performance (200k rows × 5 columns, Node, best of 3)

Run it with `BENCH=1 npx vitest run tests/graph/wasmEngineBench.test.ts`.

- A verb row is the op plus a 100-row preview, with the frame already in wasm.
- An fx row includes uploading its columns and downloading the answer.
- Frames cross as columnar buffers: uploading 200k rows takes 55 ms, a full download 55 ms.

| op | JS ms | Rust ms | × |
| --- | ---: | ---: | ---: |
| sort by a number | 139.6 | 47.3 | 3.0 |
| sort by text | 180.9 | 88.6 | 2.0 |
| filter value > 0 | 14.7 | 8.9 | 1.7 |
| filter text contains | 13.4 | 8.0 | 1.7 |
| distinct key | 8.8 | 7.1 | 1.2 |
| group by key: sum, avg, median | 145.9 | 34.3 | 4.3 |
| window: cumsum by cat over day | 136.1 | 71.0 | 1.9 |
| window: rank by cat | 165.3 | 72.4 | 2.3 |
| pipeline: filter, group, sort | 99.1 | 24.7 | 4.0 |
| left join a 1000-row lookup | 105.6 | 20.9 | 5.1 |
| fx: `@value / SUM(value)` | 198.8 | 31.8 | 6.3 |
| fx: `@value * 1.2 + @cat` | 145.4 | 42.5 | 3.4 |
| fx: `IF(@value > 0, ROUND(@value * 1.2, 2), 0)` | 926.3 | 112.5 | 8.2 |
| fx: `@key & "-" & UPPER(@key)` | 373.6 | 205.9 | 1.8 |
| fx: `IFERROR(LN(@value), 0) + MAX(@cat, 10)` | 662.5 | 146.7 | 4.5 |
| fx: `IF(@value > PERCENTILE(value, 0.9), "top", PROPER(@key))` | 1048.7 | 192.0 | 5.5 |
| fx: `SUMIFS(value, key, "k1*") + DATEDIF(45000, 45000 + @cat, "md")` | 988.6 | 175.0 | 5.7 |

## Follow-ups

- **Size.** The module is 1.2 MB raw / 487 KB gzipped after `wasm-opt -O3` (`scripts/build-wasm.mjs`). `regress`
  is vendored in `crates/vendor/regress` with one patch, the `no-property-escapes` feature: `\p{…}` parses only in
  Unicode mode, which Solenoid never uses, and refusing it drops the property tables (82 KB gzipped). The case-folding
  tables stay. UNACCENT and SLUGIFY decompose through `nfd_table.rs` (`scripts/gen-nfd-table.mjs`, from Node's own
  NFD, every code point, combining classes read off its reordering; 19 KB gzipped) instead of `unicode-normalization`. Size
  modes (`opt-level = "z"`) cut it by a fifth but halve the speed, so they're out. Ops arrive as `TaggedOp`, which reads
  the TS's `{ kind, ... }` as serde's external tagging, because the derived internally tagged form was the largest
  function. What's left is spread thin: `call_function` (53 KB before opt), the pivot, the command dispatcher.
- **What the core still leaves to the TS** is `fixtures/core/bails.json`, a ratchet the conformance suite holds
  (`CORE_BAILS_WRITE=1` rewrites it; its numbers only fall). Each entry needs a real answer before its TS goes:
  criteria whose text reaches chrono-node (the *IF/*IFS family), and the few frozen columns and formulas those
  reach. The suite pins `TZ=UTC`, so the zone readings (`zone.rs`) meet other zones only in the live fuzzers.
- **Lone surrogates** can't cross into wasm, whose strings are UTF-8: a frame or formula holding one stays on the
  TS (`crossesWhole`, `wellFormed` in frameBackend.ts). Once the TS goes, the core needs a rule for them, such as
  reading one as U+FFFD at the boundary, which is the author's call.
- **Formulas run on the core** wherever it is loaded: `compileEvaluator` calls `evaluateOnCore` (coreValues.ts) and
  keeps `evalAst` only for a bail, a value that can't cross, and a computed column's TS fallback row; a wired LAMBDA's
  body too (`compilePositional`), at about 9 µs a call against the TS's 6. A pack's JS function is called back on
  the TS (`syncExternalNames`). `CORE_EVAL=1 npx vitest run --project shared` loads the core into every test file, so
  the whole hand-written suite checks the Rust evaluator too.
- **CI** runs the core's own tests (`engine-test.yml`, job `core`), and `wasmStamp.test.ts` fails when
  `crates/solenoid-core` changed without `npm run build:wasm` (the build writes `source-stamp.txt`).
