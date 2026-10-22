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
  1. Freeze: the TS's answers on the differential tests' inputs are written to fixture files (`fixtures/core/`):
     `FREEZE_CORE=1` rewrites every suite, `FREEZE_CORE=frame-fns,columns` only those.
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
- Facts the TS keeps in tables are frozen into the core, not passed per call: `data/call_traits.json` holds every
  function name's dispatch facts, argument roles and empty-slot readings (frozen from `formulaCallTable` by
  `tests/graph/coreCallTable.test.ts`); unit scales are still lowered into a verb (`withUnitScales`, `pivotUnits`).
- Correctness rests on the conformance checks, not review:
  - `tests/graph/coreConformance.test.ts` replays the frozen answers in `fixtures/core/`: every function body on random
    and edge arguments, 18k formulas over values, 15k computed columns, 12k verb pipelines; V8's `Math` is checked live.
  - `fixtures/core/bails.json` caps how many frozen cases each suite may leave to the TS (`CORE_BAILS_WRITE=1`
    rewrites it; its numbers only fall).
  - `CORE_EVAL=1 npx vitest run --project shared` loads the core into every test file, so the hand-written suite's
    formulas check the Rust evaluator too.
  - `npm run test:core` runs the frame-verb corpus (`fixtures/frame-verbs`) natively; `tests/graph/wasmEngine.test.ts`
    still fuzzes verbs, pivots and the parser against the TS while the TS exists
    (`FUZZ_RUNS=100000 FUZZ_SEED=7 npx vitest run tests/graph/wasmEngine.test.ts` widens a run).
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

## What runs on the core

| Surface | Where | Evidence |
| --- | --- | --- |
| Frame verbs, joins, appends, binds, PIVOTBY | the core in wasm; Polars on desktop where it is on | the corpus natively; the verb and pivot fuzzers; frozen verb pipelines |
| The formula parser | `excel_formula.rs` | the parser fuzzer |
| The evaluator (`evalAst`): operators, broadcasting, argument roles, the IFERROR family, `routeCall`'s ladder, LAMBDA values, MAP BYROW BYCOL REDUCE SCAN MAKEARRAY GROUPBY | `eval.rs` | 18k frozen formulas; the suite under `CORE_EVAL=1` |
| Every function body in the registry | `excel_functions.rs` and the `fns_*.rs` modules; dates read the host's zone through `zone.rs` and text dates through `date_parse.rs` | the frozen function-body cases |
| Computed columns: whole columns as one-column tables, `@name`, side values of any shape, wired LAMBDAs and their captures | `eval::column`, `engine_compute_column` | 15k frozen columns |
| The Expression card and every `compileEvaluator` | `evaluateOnCore` (`coreValues.ts`) | as above |
| Node `data()` | moving onto `callCore` (`coreValues.ts`), node family by node family; an error argument reads as the formula's call reads it, first found, and a range function's list cells too (`argumentError`, `engine_call` with `scan`) | each family's tests, with and without `CORE_EVAL`; `callCore.test.ts` |
| Frame computations no formula shares: headers, Describe, Correlation Matrix, Reconcile, Nest's grouping, XLOOKUP over a frame, Get Row, Get and Add Column's naming, Build and Split Frame, Frame from Lists, the Decision Matrix and its flip points, the Allocator, the Payoff Planner, Group Cost Settle's totals and its ledger (a ledger holding lists stays with the TS), Amortization, K-Means, PCA, logistic regression. A thrown error crosses as itself; a card with several outputs gets them side by side in one frame | `frame_fns.rs`, `decision.rs`, `planners.rs`, `engine_frame_fn`, `frameFnOnCore` (`frameBackend.ts`) | the frozen frame-function cases |
| A pack's function, registered in JS at run time: the core evaluates its arguments and calls the TS back for the call itself (its roles, blank slots and ladder on the TS); the same whole column row after row is one call | `external.rs`, `callFromCore` (`excelFormula.ts`), `globalThis.__solenoidCallExternal` | the frozen pack-call formulas |
| A formula's unit reading ([[unit-flow]] § Formula dimensions, § Expression): its result dimension (`dimEval`) and its point weight over readings (`affineWeight`), for Expression, the LAMBDA folds and a computed column over °C. Outside Expression and the folds the numbers still cross unit-blind, and Equation still calls the TS `dimEval` on its own ASTs | `unit_dims.rs`, `engine_dim_eval`, `engine_affine_weight`, `formulaDim` and `formulaAffineWeight` (`unitDimExpr.ts`) | 18k frozen formula dimensions (`unit-dims`), 17k frozen weights (`affine-weights`) |
| Expression's unit wrapper ([[unit-flow]] § Expression) once its inputs are read: the dimension check, the one shared display unit the formula runs in, the point weight over readings, the inputs in their shown magnitudes (`displayMagnitudeOf`), the evaluation and the result's unit. Each cell's display unit crosses with its dimension beside its scale and offset (`displayDim`) | `unit_expression.rs`, `engine_expression_units`, `expressionUnitsOnCore` (`coreValues.ts`), `ExpressionNode.data()` | 6k frozen Expressions over generated unit inputs (`expression-units`) |
| REDUCE, BYROW and BYCOL's unit wrapper ([[unit-flow]] § LAMBDA hosts) over an inline formula: the cells' one dimension, the display unit they share, the fold on the stripped magnitudes, the point weight over readings and the result's re-tagging | `unit_fold.rs`, `engine_fold_units`, `foldOnCore` (`tableLambda.ts`) | 5k frozen folds over generated unit tables (`fold-units`), also replayed through the nodes' `data()` |
| List bodies over values with a unit (`UNIT_READY`): the ones that move cells without reading them, the shapers SORT, SORTBY, UNIQUE, TAKE and DROP (a unit cell sorts after the logicals and ties with its kind; UNIQUE keys it by base magnitude at 15 digits and dimension), FILTER (a unit cell as a condition is `#VALUE!`), and RUNNING, which reads each cell's display unit from the wire (its scale and offset as the TS resolves them) | `V::Unit`, `unit_lists.rs`, `coreValue(v, true)` and `readReply` (`coreValues.ts`) | 4k frozen calls (`unit-lists`), 5k frozen shaper calls (`unit-shapers`), 4k frozen FILTER calls (`unit-filters`), 6k frozen RUNNING calls with and without units (`unit-running`) |
| A pack's formula functions | the TS, by design: a pack registers JS at run time, and the core calls it back (`syncExternalNames`) | |

## Fallback ([[D98]] wholeColumnFallback)

A body meeting a reading the core doesn't make yet calls `bail()`, and the whole formula or column runs on the
TypeScript, never part of it: chrono-node's free-text dates in criteria, INDEX with a list of positions,
REGEXEXTRACT's list modes, a loop past a step cap, a value nested past a table, a slice or match that halves a
surrogate pair (`from_utf16` in `excel_functions.rs` and `text_ops.rs`; `coreSurrogates.test.ts` reads it raw, since
the conformance `canon()` makes every frozen string well formed). A value that can't cross (a unit cell,
a frame, text with a lone surrogate) keeps its call on the TS; so does a pack call whose arguments or answer can't
cross (a LAMBDA, a unit cell), or one made where the core runs natively. A `UnitCell` crosses only into `callCore`, as
`{__unit}` (`V::Unit`, with its display unit's scale, offset and dimension beside a display id), and only the bodies in
`UNIT_READY` (`unit_dims.rs`) take it: REVERSE, SLICE, NTHELEMENT, INTERLEAVE, CONCATLISTS, PADLEFT, PADRIGHT, which
move values without reading them, SORT, SORTBY, UNIQUE, TAKE and DROP, FILTER (a unit cell as a condition is
`#VALUE!`, as `ifTest` reads it) and RUNNING (`unit_lists.rs`); any other call holding one bails, and a
formula or computed column over one stays on the TS. Expression is the exception: with a unit cell among its
inputs it sends the whole wrapper to `engine_expression_units`, and runs its TS wrapper where that bails (a unit cell
nested past a table, a formula the core leaves to the TS). REDUCE, BYROW and BYCOL over a table holding a unit cell
send theirs to `engine_fold_units`; a wired LAMBDA (its closure and captures), a unit inside a cell or in REDUCE's
list initial, and a step that throws keep the TS wrapper. `bails.json` counts what's left.

## Where it runs

- **Frame verbs:** `initFrameBackend` picks Polars on desktop when it's on. Otherwise it uses this engine in
  wasm when Settings → Rust engine is on (the default). Otherwise it uses the JS oracle.
  - The wasm engine holds every cell kind, so unlike Polars it needs no oracle fallback for text or logical errors.
- **Formulas, computed columns, pivots:** on the wasm core wherever it's on, desktop included, beside Polars. The app's
  first render waits for it (`main.tsx`, at most four seconds), so the first calc runs on it.
- **A trap** (an abort, a stack overflow, anything escaping the module mid-call) leaves the instance's stack pointer
  where it stopped, so `engineWasm.ts` drops it and instantiates the compiled module afresh (`__wbg_reset`, which
  `scripts/build-wasm.mjs` appends to wasm-bindgen's glue), numbering its handles past the dead one's
  (`engine_handle_base`). The call that trapped answers on the TS (`onCore`); a frame the verb backend held in the
  dead instance is gone, so a verb over it answers #REF! until the document reloads. `engine_trap` is the
  tests' trigger (`coreTrap.test.ts`).

## Performance (200k rows × 5 columns, Node, best of 3)

Run it with `BENCH=1 npx vitest run tests/graph/wasmEngineBench.test.ts`.

- A verb row is the op plus a 100-row preview, with the frame already in wasm.
- An fx row includes uploading its columns and downloading the answer.
- Frames cross as columnar buffers: uploading 200k rows takes about 55 ms, a full download about 55 ms.
- Run to run the times move by about 20% on a shared machine. `examples/colbench.rs` counts a formula column's
  instructions natively under callgrind, which doesn't move.

| op | JS ms | Rust ms | × |
| --- | ---: | ---: | ---: |
| sort by a number | 93.0 | 30.5 | 3.0 |
| sort by text | 183.5 | 65.3 | 2.8 |
| filter value > 0 | 9.6 | 5.2 | 1.9 |
| filter text contains | 8.3 | 4.2 | 2.0 |
| distinct key | 7.7 | 6.2 | 1.3 |
| group by key: sum, avg, median | 98.0 | 28.5 | 3.4 |
| window: cumsum by cat over day | 85.5 | 36.5 | 2.3 |
| window: rank by cat | 106.2 | 44.1 | 2.4 |
| pipeline: filter, group, sort | 78.4 | 14.5 | 5.4 |
| left join a 1000-row lookup | 81.9 | 16.8 | 4.9 |
| fx: `@value / SUM(value)` | 141.7 | 86.3 | 1.6 |
| fx: `@value * 1.2 + @cat` | 104.9 | 35.0 | 3.0 |
| fx: `IF(@value > 0, ROUND(@value * 1.2, 2), 0)` | 413.0 | 97.1 | 4.3 |
| fx: `@key & "-" & UPPER(@key)` | 238.9 | 115.8 | 2.1 |
| fx: `IFERROR(LN(@value), 0) + MAX(@cat, 10)` | 433.2 | 121.6 | 3.6 |
| fx: `IF(@value > PERCENTILE(value, 0.9), "top", PROPER(@key))` | 606.9 | 200.7 | 3.0 |
| fx: `SUMIFS(value, key, "k1*") + DATEDIF(45000, 45000 + @cat, "md")` | 483.7 | 235.8 | 2.1 |

## Follow-ups

- **Load time is the module's bytes.** A `<link rel="preload">` for the wasm was measured and dropped (2026-10-22): under
  4 Mbps throttling the first render came 0.4 s later, since the wasm then shares the link with the entry scripts the
  render also waits for. What would move it is a smaller module, or a first render that doesn't wait for the core.
  Size against speed was measured too (2026-10-22): rustc's `opt-level = "z"` cuts the module from 860 KB to 650 KB
  gzipped but runs formula columns 1.5 to 3 times slower; `"s"` saves 11% for about a third slower; `wasm-opt`'s level
  moves it under 1%. It stays at 3. What's big after rustc: the dispatch functions `wasm-opt` inlines into, `.rodata`
  (the call table's JSON among it) and serde's derive for `FrameOp`.
- **A function call costs about 1,000 instructions a row** in the dispatch ladder (argument roles, blank slots,
  broadcasting, the error guard), against about 450 for an operator. Each call site's name and facts resolve once per
  column already; resolving its route the same way (which rungs can apply to it at all) is the next cut.
- **Size.** The module is 2.3 MB raw / 835 KB gzipped after `wasm-opt -O3` (`scripts/build-wasm.mjs`), every function body, the evaluator, the unit dimension algebra, V8's `Date.parse` and the full NFD table included. `regress`
  is vendored in `crates/vendor/regress` with two patches. Its non-Unicode Canonicalize (`fold_code_point`, which a caseless backreference compares by) never takes a non-ASCII unit to ASCII, as V8's doesn't, so `ſ` and `s` don't match each other. The `no-property-escapes` feature: `\p{…}` parses only in
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
- **CI** runs the core's own tests (`engine-test.yml`, job `core`), and `wasmStamp.test.ts` fails when
  `crates/solenoid-core` changed without `npm run build:wasm` (the build writes `source-stamp.txt`).
- **Crossing per call is slow where a card maps a body over a list** ([[C120]] linearWork): about 4 µs an item, so
  UPPER over 50,000 items is 278 ms against 23 ms on develop. A wired LAMBDA's captures no longer cost that: a list of
  64 or more crosses once and the core holds it by id while the JS list lives (`envValue` in `coreValues.ts`, `HELD`
  in `eval.rs`), and `engine_eval` keeps its last 16 formulas parsed with their range memo (`eval::formula`), so
  `x - AVERAGE(vals)` over 3,000 items reads `vals` once: about 50 ms, from 1.9 s (develop: 8 ms).
