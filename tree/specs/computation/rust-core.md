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
| Node `data()` | moving onto `callCore` (`coreValues.ts`), node family by node family | each family's tests, with and without `CORE_EVAL` |
| Frame computations no formula shares: headers, Describe, Correlation Matrix, Reconcile, Nest's grouping, XLOOKUP over a frame, Get Row, Get and Add Column's naming, Build and Split Frame, Frame from Lists, the Decision Matrix and its flip points, the Allocator, the Payoff Planner, Group Cost Settle's totals and its ledger (a ledger holding lists stays with the TS), Amortization, K-Means, PCA, logistic regression. A thrown error crosses as itself; a card with several outputs gets them side by side in one frame | `frame_fns.rs`, `decision.rs`, `planners.rs`, `engine_frame_fn`, `frameFnOnCore` (`frameBackend.ts`) | the frozen frame-function cases |
| A formula's unit reading ([[unit-flow]] § Formula dimensions, § Expression): its result dimension (`dimEval`) and its point weight over readings (`affineWeight`), for Expression, the LAMBDA folds and a computed column over °C. The numbers still cross unit-blind; the display-unit choice and the re-tagging stay on the TS, and Equation still calls the TS `dimEval` on its own ASTs | `unit_dims.rs`, `engine_dim_eval`, `engine_affine_weight`, `formulaDim` and `formulaAffineWeight` (`unitDimExpr.ts`) | 18k frozen formula dimensions (`unit-dims`), 17k frozen weights (`affine-weights`) |
| A pack's formula functions | the TS, by design: a pack registers JS at run time, and the core calls it back (`syncExternalNames`) | |

## Fallback ([[D98]] wholeColumnFallback)

A body meeting a reading the core doesn't make yet calls `bail()`, and the whole formula or column runs on the
TypeScript, never part of it: chrono-node's free-text dates in criteria, INDEX with a list of positions,
REGEXEXTRACT's list modes, a loop past a step cap, a value nested past a table. A value that can't cross (a unit cell,
a frame, text with a lone surrogate) keeps its call on the TS: a `UnitCell` has no wire form yet, so a node handing
one to `callCore` (RUNNING over a united list, the list verbs) or a computed column's united side value runs there. `bails.json` counts what's left.

## Where it runs

- **Frame verbs:** `initFrameBackend` picks Polars on desktop when it's on. Otherwise it uses this engine in
  wasm when Settings → Rust engine is on (the default). Otherwise it uses the JS oracle.
  - The wasm engine holds every cell kind, so unlike Polars it needs no oracle fallback for text or logical errors.
- **Formulas, computed columns, pivots:** on the wasm core wherever it's on, desktop included, beside Polars. The app's
  first render waits for it (`main.tsx`, at most four seconds), so the first calc runs on it.

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

- **Size.** The module is 1.9 MB raw / 680 KB gzipped after `wasm-opt -O3` (`scripts/build-wasm.mjs`), every function body, the evaluator, V8's `Date.parse` and the full NFD table included. `regress`
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
- **CI** runs the core's own tests (`engine-test.yml`, job `core`), and `wasmStamp.test.ts` fails when
  `crates/solenoid-core` changed without `npm run build:wasm` (the build writes `source-stamp.txt`).
