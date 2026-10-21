# solenoid-core

A Rust port of Solenoid's headless TypeScript core, built for two targets: WebAssembly for the app
(`npm run build:wasm` writes `src/graph/engineWasm/`) and native for tests (`npm run test:core`).
Experimental, on the `solenoid/tsrs` branch. The method is borrowed from [tsrs](https://github.com/oxc-project/tsrs).

## The rule: the TypeScript is the spec

- The TS on `develop` at the pinned commit below is the specification. Any difference from it
  (a cell, an error's code or message, a thrown error) is a bug in the Rust, even when the Rust answer
  looks more reasonable.
- The port is mechanical. One Rust module per TS file (`frameVerbs.ts` → `frame_verbs.rs`, `excelFormula.ts` →
  `excel_formula.rs`), functions keep their TS names in snake_case and their order of operations, and nothing
  gets redesigned. Internal-only differences (data layout, `Rc` sharing, a faster sort where the comparator is
  provably total) are fine when no answer changes.
- The JavaScript the TS leans on implicitly also gets ported, because it decides answers:
  - `String(x)`, `Number(x)`, `trim` and UTF-16 string order, in `jsnum.rs`.
  - `Array.prototype.sort` that never panics on an inconsistent comparator, in `js_sort.rs`.
  - `toPrecision`, in `unit_value.rs`.
  - V8's `Math.exp`, `log`, `log10`, `log1p`, `pow`, `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `acosh`
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

## What it does and doesn't do

| Capability | Status | Evidence |
| --- | --- | --- |
| Frame verbs: select, drop, rename, sort, distinct, head, filter, filterMulti, groupBy, unpivot, window, fillBlanks, replaceValues, sliceRows | Ported | 256 corpus cases natively; corpus and 600k+ fuzz cases through wasm |
| join (all 8 kinds, unit-scaled keys), append, bindColumns, sample | Ported | as above |
| PIVOTBY: leaf order, subtotals, value sorts, percent-of shares, the pivot-view layout | Ported | 160k random pivots match cells, layout and units |
| Units, formats | Unit-blind, as Polars is: the TS lowers reading and unit scales into the op and restores metadata | `lowerForEngine`, `pivotUnits` |
| Formula tokenizer and parser | Ported whole | 300k random strings, well-formed and broken, give the same tree |
| Row formulas (computed columns): literals, `@column`, scalar side values, constants, every operator | Ported | 300k random computed columns match cells, messages and side sockets |
| Formula functions | 149 ported. Logic: IF IFS AND OR NOT XOR CHOOSE SWITCH, the IFERROR family, the IS tests. Math: ROUND ROUNDUP ROUNDDOWN TRUNC INT ABS SIGN SQRT EXP LN LOG LOG10 MOD POWER QUOTIENT PI SQRTPI DEGREES RADIANS CEILING(.MATH) FLOOR(.MATH) MROUND EVEN ODD. Trig: SIN COS TAN ASIN ACOS ATAN ATAN2 SINH COSH TANH ASINH ACOSH ATANH COT COTH ACOT ACOTH SEC SECH CSC CSCH. Aggregates: SUM MIN MAX AVERAGE MEDIAN PRODUCT STDEV(.S/.P) VAR(.S/.P) COUNT COUNTA COUNTBLANK. Order statistics: LARGE SMALL PERCENTILE(.INC/.EXC) QUARTILE(.INC/.EXC) MODE MODE.SNGL. Criteria: COUNTIF COUNTIFS SUMIFS AVERAGEIF AVERAGEIFS MINIFS MAXIFS, wildcards included. Lookups: XLOOKUP XMATCH (INDEX lowers a role the evaluator doesn't read). Text: LEN CONCAT CONCATENATE TEXTJOIN MID LEFT RIGHT REPLACE UPPER LOWER PROPER TRIM REPT SUBSTITUTE EXACT FIND SEARCH CHAR UNICHAR CODE UNICODE VALUE N T. Dates: DATE YEAR MONTH DAY HOUR MINUTE SECOND TIME DAYS DAYS360 DATEDIF YEARFRAC EOMONTH WEEKDAY WEEKNUM ISOWEEKNUM DATETRUNC FROMEPOCH TOEPOCH WORKDAY(.INTL) NETWORKDAYS(.INTL) | each body is checked directly against its JS one on random arguments; a formula calling anything else runs on the TS |
| Whole-column refs (a bare column name, `[col]`) as a range function's argument: `@x / SUM(x)`, `MAX([x])`, `COUNTBLANK(b)`, `XLOOKUP(@id, id, price)` | Ported, with `prepRangeArgs`' error scan and blank drop, and a call that reads no `@` cell evaluated once | explicit cases plus the fuzzer |
| Readings only chrono-node does (a criterion like `">=3-Apr-2026"`), and PROPER over non-Latin letters | Bail: the row stops and the whole column runs on the TS (`bail()`) | explicit cases |
| A whole column in an argument that takes one value (`LARGE(x, x)` lifts per item) | Not ported: `formulaCallTable` lowers those positions (`scalar`) and the support check sends them to the TS | |
| Whole columns anywhere else (broadcast), lists and matrices, LAMBDA, complex numbers, units in formulas | Not ported: runs on the TS | |
| Expression nodes, the compute pass, node `data()` | Not started | |

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
- Frames cross as columnar buffers: uploading 200k rows takes 52 ms, a full download 43 ms.

| op | JS ms | Rust ms | × |
| --- | ---: | ---: | ---: |
| sort by a number | 133.9 | 44.0 | 3.0 |
| sort by text | 183.3 | 86.4 | 2.1 |
| filter value > 0 | 19.3 | 8.7 | 2.2 |
| filter text contains | 14.5 | 8.3 | 1.7 |
| distinct key | 12.2 | 12.4 | 1.0 |
| group by key: sum, avg, median | 151.4 | 38.3 | 3.9 |
| window: cumsum by cat over day | 131.8 | 71.7 | 1.8 |
| window: rank by cat | 156.5 | 84.8 | 1.8 |
| pipeline: filter, group, sort | 97.1 | 24.8 | 3.9 |
| left join a 1000-row lookup | 95.6 | 20.5 | 4.7 |
| fx: `@value / SUM(value)` | 180.4 | 47.3 | 3.8 |
| fx: `@value * 1.2 + @cat` | 138.5 | 57.3 | 2.4 |
| fx: `IF(@value > 0, ROUND(@value * 1.2, 2), 0)` | 724.7 | 403.1 | 1.8 |
| fx: `@key & "-" & UPPER(@key)` | 356.3 | 290.1 | 1.2 |
| fx: `IFERROR(LN(@value), 0) + MAX(@cat, 10)` | 566.5 | 159.0 | 3.6 |

## Found on the way (fixed in the TS here, worth carrying to develop)

- **SUM over a long column hung.** Formula.js's SUM recurses through `SUM.apply(null, list)`, which throws past
  about 125k values. `SUM(column)` in a computed column over a long table threw in every row, and because a throw
  isn't memoized it re-summed the column per row: quadratic, effectively a hang. SUM is now owned
  (`sumLikeFx`, pinned in `formulaDivergence.test.ts`, listed in `formulajs-divergences.md`), as MIN and MAX
  already were for the same reason.

- **NETWORKDAYS and WORKDAY could hang.** NETWORKDAYS counted day by day up to its end date, so an infinite end
  (a `1e400` cell) never finished. WORKDAY stepped a day at a time from its start, and past 2^53 a step doesn't move
  the day, so a start that was also a holiday never finished either. Both now refuse a date outside the years 1 to
  9999 with `#DOMAIN!`, as WORKDAY already did for its landing day (pinned in `datetimeParity.test.ts`).

## Follow-ups

- **Whole-column formula refs and the array evaluator** (`mapCells`, the range functions over lists).
- **ROUND's `toPrecision`** still formats digits on most inputs. An exact integer-arithmetic version would close
  the gap.
- **Size.** The module is 784 KB raw / 314 KB gzipped after `wasm-opt -O3` (`scripts/build-wasm.mjs`). Size
  modes (`opt-level = "z"`) reach 222 KB gzipped but halve the speed, so they're out. The largest single item left is
  serde's internally tagged `FrameOp` deserializer (67 KB raw): a hand-written `kind` dispatch would trim it.
