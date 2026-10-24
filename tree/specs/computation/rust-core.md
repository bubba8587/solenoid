---
aliases: ["Rust core"]
tags: [spec, computation]
---
<!-- [[C130]] rustCore, [[D99]] rustIsSpec -->

# Spec: the Rust core

Serves [[C130]] rustCore and [[D99]] rustIsSpec. `crates/solenoid-core` is Solenoid's headless core (it began as a port of the TypeScript one), built for two targets: WebAssembly for the app, linked into the graph engine's module (`npm run build:wasm` writes `src/graph/engineWasm/`, [[graph-core]] § The module), and native for tests (`npm run test:core`). The method is borrowed from [tsrs](https://github.com/oxc-project/tsrs).

## The rule: the Rust is the spec ([[D99]] rustIsSpec)

- The core is the one implementation. A change in behaviour is made in the Rust, together with the fixtures it
  changes, in the same commit.
- The port began as a mechanical copy of the TypeScript, so the Rust keeps the TS's names (in snake_case) and order of
  operations wherever a fixture depends on them.
- Moving a TS copy onto the core:
  1. Freeze: the TS's answers on its tests' inputs are written to fixture files (`fixtures/core/`).
  2. Cover: the core answers every case the copy's callers make.
  3. Delete: the TS copy and its differential test go, and the fixtures stay as the test. `FREEZE_CORE=1` re-answers
     every suite's frozen cases on the core and writes them back (`FREEZE_CORE=frame-fns,columns` only those), which is
     how a deliberate change in behaviour moves a fixture.
- Gone so far: the error guard and arrival coercion (into the graph module, [[graph-core]]), the formula evaluator, the parser, every function body and Formula.js, the computed-column row path,
  the pack functions' JavaScript, the JS frame verbs and their backend, the card bodies ([[node-bodies]]), the
  statistics kernels (`statsOps.ts`) and the table popups' footer profile. The TS keeps the editor's walkers over the
  core's tree (variables, LaTeX, steps) and the op modules the
  components and the canvas still read.
- The JavaScript semantics the frozen answers carry stay ported, because they decided those answers:
  - `String(x)`, `Number(x)`, `trim` and UTF-16 string order, in `jsnum.rs`.
  - `Array.prototype.sort` that never panics on an inconsistent comparator, in `js_sort.rs`.
  - `toPrecision`, in `unit_value.rs` (17 correctly rounded digits decide the cut unless they read as a possible tie, and Clinger's fast path turns them back into a number); `toFixed` and `toExponential`, exact ties rounding up, in `jsnum.rs`.
  - V8's `Math.hypot` (Kahan-compensated), and V8's `Math.exp`, `log`, `log10`, `log1p`, `pow`, `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `acosh`
    and `atanh`, in `fdlibm.rs`. These are fdlibm with V8's own tweaks, because
    the platform libm is off by an ulp on some inputs.
  - A JS exception (a function that throws) ends the row's evaluation.
- A function's dispatch facts, argument roles and empty-slot readings live in `data/call_traits.json` (first frozen
  from the TS's call table; the tests read it through `tests/graph/callTraits.ts`). The names the editor offers come
  from the core (`engine_function_names`); the TS keeps only each name's arity and signature hint
  (`excelFunctions.ts`, `formulaSignatureTable.ts`).
- Correctness rests on the conformance checks, not review:
  - `tests/graph/coreConformance.test.ts` replays the frozen answers in `fixtures/core/`: every function body on random
    and edge arguments, 18k formulas over values, 15k computed columns, 12k verb pipelines, 6k parser trees (checked
    against the TS parser on all 49k formulas the fixtures hold before it went), 3k pack calls; V8's `Math` is
    checked live, and `corePlatform.test.ts` holds UNACCENT to Node's NFD and a caseless backreference to V8.
  - Every test file loads the core (`tests/setup/graphEngine.ts`), so the hand-written suite's
    formulas check the Rust evaluator too.
  - `npm run test:core` runs the frame-verb corpus (`fixtures/frame-verbs`) natively.

## Tracking develop

Pinned upstream: `develop` @ `31ce0f7`.

`develop` still runs the TypeScript copies this branch deleted. On each rebase, list what moved in them, port each
change into the Rust (and the fixtures it moves), run the checks above and move the pin. Nothing ports back: the TS
copies here are gone.

```
git diff 31ce0f7..develop -- src/graph/frameVerbs.ts src/graph/frame.ts src/graph/frameBackend.ts \
  src/graph/valueKinds.ts src/graph/stringOrder.ts src/graph/unitValue.ts src/graph/pivotLayout.ts \
  src/graph/excelFormula.ts src/graph/excelFunctions.ts src/graph/inputRoles.ts src/graph/emptySlots.ts \
  src/graph/computedColumnCore.ts src/graph/formulaExtensions.ts src/graph/packs src/graph/nodes/statsOps.ts \
  src/graph/nodes/mathUtils.ts src/graph/nodes/dateOps.ts src/graph/nodes/dateSerial.ts src/graph/excelCriteria.ts \
  src/graph/nodes/textOps.ts src/graph/csv.ts src/graph/financeUnits.ts src/graph/nodes/settleOps.ts \
  src/graph/nodes/payoffOps.ts src/graph/nodes/financeOps.ts src/graph/nodes/listOps.ts src/graph/nodes/fitOps.ts \
  src/graph/nodes/hashOps.ts src/graph/nodes/chartOptions.ts src/graph/cxValue.ts fixtures/frame-verbs
```

A Formula.js bump on `develop` changes nothing here: its bodies were ported once and the Rust is their spec.

Moved on develop since the pin (checked at `3a6a667`): nothing in the files above that isn't mirrored. The last were
the finance functions' currency ([[D101]] financeCarriesMoney, `finance_units.rs`) and PIVOTBY's `details` ([[C128]]
pivotDetails): the core's layout gives each leaf row its source rows and carries the Details columns, whose formats
the TS lends from the frame the pivot read (`adoptPivot`).

## What runs on the core

| Surface | Where | Evidence |
| --- | --- | --- |
| Frame verbs, joins, appends, binds, PIVOTBY | the core in wasm, on the web and desktop alike, units and formats included: a frame's columns carry them into the core and each verb decides its own | the corpus natively; frozen verb pipelines; the verb tests through `tests/graph/coreVerbs.ts` |
| A cube's row verbs (sort, filter, distinct, head, window) | the card bodies (`nodes/verbs.rs`): the scalar columns run through the frame verb, which answers the rows they keep or the window's column, and the nested cells ride along by them; list conditions read the nested cells | the frozen card cases (`fixtures/core/nodes/`) |
| The formula parser, for the evaluator and the editor (`parseFormula`, `engine_formula_parse`) | `excel_formula.rs` | 6k frozen trees (`formula-trees`) |
| The evaluator (`evalAst`): operators, broadcasting, argument roles, the IFERROR family, `routeCall`'s ladder, LAMBDA values, MAP BYROW BYCOL REDUCE SCAN MAKEARRAY GROUPBY | `eval.rs` | 18k frozen formulas; the whole suite |
| Every function body in the registry | `excel_functions.rs` and the `fns_*.rs` modules; dates read the host's zone and IANA zones through `zone.rs` (`Intl` in wasm, jiff's bundled tzdb natively, with the names only ICU takes mapped beside it) and text dates through `date_parse.rs` | the frozen function-body cases |
| Computed columns: whole columns as one-column tables, `@name`, side values of any shape, wired LAMBDAs and their captures | `eval::column`, `engine_compute_column` | 15k frozen columns |
| The Expression card and every `compileEvaluator` | `evaluateOnCore` (`coreValues.ts`) | as above |
| The dataflow engine, the compute pass (its walks, seeding, invalidation, fetch and render set) and its state (calc mode, dirty flag, recalc generation, rebuild scopes, single flight), node and cable ids | `crates/solenoid-graph` on Ruggine, in the same wasm module ([[D102]] graphOnCore, [[graph-core]]) | Ruggine's oracle against rete-engine; `dataflowEngine.test.ts`; the session's native tests; the whole suite |
| The input boundary every node's call goes through: the error guard and arrival coercion ([[compute-pass]] § The per-node wrappers) | `boundary.rs` in the graph module, over the app's JavaScript values | the frozen boundary answers (`boundary-*`, `coreBoundary.test.ts`); the whole suite |
| Node `data()` | the card bodies ([[node-bodies]]); a body over a list runs its loop on the core | `fixtures/core/nodes/` ([[node-bodies]]); each family's tests |
| Frame computations no formula shares: headers, Describe, Correlation Matrix, Reconcile, Nest's grouping, XLOOKUP over a frame, Get Row, Get and Add Column's naming, Build and Split Frame, Frame from Lists, the Decision Matrix and its flip points, the Allocator, the Payoff Planner, the Choice Ladder (its plan, and its ladder beside it as `ladderWire` lays it out), Group Cost Settle's totals and its ledger, Amortization, K-Means, PCA, logistic regression. A thrown error crosses as itself; a card with several outputs gets them side by side in one frame | `frame_fns.rs`, `decision.rs`, `planners.rs`, `ladder.rs`, `engine_frame_fn`, `frameFnOnCore` (`frameBackend.ts`) | the frozen frame-function cases |
| A pack's formula functions (ELEMENT, SUNRISE, ESERIESVALUE and kin), always known, advertised only while their pack is on | `fns_packs.rs`, over the cards' kernels (`nodes/packs.rs`); a pack's TS declares each one's name, arity and hint (`packs/*Formulas.ts`) | 3k frozen pack-call formulas (`pack-calls`) |
| A formula's unit reading ([[unit-flow]] § Formula dimensions, § Expression): its result dimension (`dimEvalWithCode`) and its point weight over readings (`affineWeight`), for every caller: Expression, the LAMBDA folds, a computed column's unit plan (`planColumnUnits`, Frames and Cubes alike, its named LAMBDAs crossing as `fns`) and Equation. A caller with no formula text (Equation's isolated side) sends its tree, as the TS `Ast` object (`Ast::from_json`) | `unit_dims.rs` (a finance call's money through `finance_units.rs`, [[D101]] financeCarriesMoney); `engine_dim_eval` and `engine_affine_weight` are the conformance suite's way in | 18k frozen formula dimensions (`unit-dims`), 6k through named LAMBDAs (`unit-dims-fns`), 17k frozen weights (`affine-weights`), each replayed as text and as a tree |
| Expression's unit wrapper ([[unit-flow]] § Expression) once its inputs are read: the dimension check, the one shared display unit the formula runs in, the point weight over readings, the inputs in their shown magnitudes (`displayMagnitudeOf`), the evaluation and the result's unit. Each cell's display unit crosses with its dimension beside its scale and offset (`displayDim`) | `unit_expression.rs`, called by Expression's body on the core (`nodes/formula.rs`, [[node-bodies]]) | 6k frozen Expressions over generated unit inputs (`expression-units`) |
| REDUCE, BYROW and BYCOL's unit wrapper ([[unit-flow]] § LAMBDA hosts) over an inline formula: the cells' one dimension, the display unit they share, the fold on the stripped magnitudes, the point weight over readings and the result's re-tagging | `unit_fold.rs`, called by those cards' bodies on the core (`nodes/matrix.rs`, [[node-bodies]]) | 5k frozen folds over generated unit tables (`fold-units`), also replayed through the nodes' `data()` |
| List bodies over values with a unit (`UNIT_READY`): the ones that move cells without reading them, the shapers SORT, SORTBY, UNIQUE, TAKE and DROP (a unit cell sorts after the logicals and ties with its kind; UNIQUE keys it by base magnitude at 15 digits and dimension), FILTER (a unit cell as a condition is `#VALUE!`), and RUNNING, which reads each cell's display unit from the wire (its scale and offset as the TS resolves them) | `V::Unit`, `unit_lists.rs`, `coreValue(v, true)` and `readReply` (`coreValues.ts`) | 4k frozen calls (`unit-lists`), 5k frozen shaper calls (`unit-shapers`), 4k frozen FILTER calls (`unit-filters`), 6k frozen RUNNING calls with and without units (`unit-running`) |
| CSV text, on the `csv` crate: the rows under each option, a file's typed frame (`csvToFrame`), a Frame Input's CSV text, and the Sink's CSV ([[frame-verbs]] § Reading CSV text). A 50 MB file reads into a typed frame in about 1.7 s in Node, from 4.1 s on Papa Parse and `inferColumn`; its rows alone in about 1.1 s | `csv.rs`, `engine_csv_frame` and `engine_csv_rows` (the columnar hand-off), `engine_csv_source`, `engine_csv_text` | 11k frozen row readings, 2.9k frozen frames and as many Frame Input sources, 800 frozen writes (`csv-*`, the core's own answers), over generated CSV and the repo's own files |

## Nothing falls back

The core is the only evaluator. A reading it doesn't make is an answer, never a hand-off: free text that only
chrono-node read as a date is not a date (DATEVALUE answers an error, a criterion compares it as text); a loop past
a cap, a value nested past a table and a regex past the core's limits answer an error that says so; a name the core
doesn't know is #NAME?. Text crosses well formed: a lone surrogate reads as U+FFFD at the boundary (`toWellFormed`,
`coreValues.ts`). A formula over a value with a unit it doesn't take is #VALUE! (the cards run their unit wrappers on
the core, `unit_expression.rs` and `unit_fold.rs`). A wired LAMBDA crosses with the captures its body reads
(`readValues`: the numbers they show, or a computed column's unit plan's magnitudes) and, beside them, the same
captures with their units (`capturedValues`), which the core's unit plan (`nodes/columns.rs`) reads.

## Where it runs

- **Everything:** formulas, computed columns, frame verbs, pivots and card bodies run on the core in wasm on every
  platform, desktop included: one build, one answer ([[C130]] rustCore). The app's first render waits for it with no
  deadline (`main.tsx`), since the cards' bodies run on it ([[node-bodies]]). The desktop shell adds only what a
  browser can't do; for tables that is reading a Parquet file (`crates/solenoid-parquet`, [[frame-verbs]] § Reading
  Parquet).
- **Speed** (2026-10-23, one chain of filter, computed column, group with sum, mean and median, join to a 1,000-row
  lookup, sort; the frame already resident): at 1M rows 160 ms in wasm under Node and 210 ms natively. Polars, as
  the desktop ran it, took 1.17 s, nearly all of it the computed column's round trip out of Polars and back (its
  verbs alone were 60 ms, the core's 90 ms in wasm). Reopen [[C130]] if a table people open is slow in wasm.
- **A trap** (an abort, a stack overflow, anything escaping the module mid-call) leaves the instance's stack pointer
  where it stopped, so the instance is dropped and the compiled module instantiated afresh, the graph with it, as
  [[graph-core]] § Traps says; the core numbers its handles past the dead one's (`engine_handle_base`). The call that
  trapped answers #ERROR! (`onCore`); a frame the verb backend held in the dead instance is gone, so a verb over it
  answers #REF! until the document reloads. `engine_trap` is the tests' trigger (`coreTrap.test.ts`).

## Performance (200k rows × 5 columns, Node, best of 3)

Run it with `BENCH=1 npx vitest run tests/graph/wasmEngineBench.test.ts` (2026-10-23).

- A verb row is the op plus a 100-row preview, with the frame already in wasm.
- An fx row includes uploading its columns and downloading the answer.
- Frames cross as columnar buffers: uploading 200k rows takes about 55 ms, a full download about 70 ms.
- Run to run the times move by about 20% on a shared machine. `examples/colbench.rs` counts a formula column's
  instructions natively under callgrind, which doesn't move.

| op | ms |
| --- | ---: |
| sort by a number | 28.8 |
| sort by text | 76.9 |
| filter value > 0 | 6.3 |
| filter text contains | 4.8 |
| distinct key | 3.9 |
| group by key: sum, avg, median | 24.8 |
| window: cumsum by cat over day | 56.0 |
| window: rank by cat | 62.8 |
| pipeline: filter, group, sort | 22.0 |
| left join a 1000-row lookup | 18.7 |
| fx: `@value / SUM(value)` | 64.3 |
| fx: `@value * 1.2 + @cat` | 35.6 |
| fx: `IF(@value > 0, ROUND(@value * 1.2, 2), 0)` | 113.9 |
| fx: `@key & "-" & UPPER(@key)` | 119.8 |
| fx: `IFERROR(LN(@value), 0) + MAX(@cat, 10)` | 107.5 |
| fx: `IF(@value > PERCENTILE(value, 0.9), "top", PROPER(@key))` | 217.4 |
| fx: `SUMIFS(value, key, "k1*") + DATEDIF(45000, 45000 + @cat, "md")` | 224.5 |

Before the JS verbs went, the same ops ran 1.3 to 5 times slower on them.

## Follow-ups
- **Load time is the module's bytes.** A `<link rel="preload">` for the wasm was measured and dropped (2026-10-22): under
  4 Mbps throttling the first render came 0.4 s later, since the wasm then shares the link with the entry scripts the
  render also waits for. What would move it is a smaller module, or a first render that doesn't wait for the core.
  Size against speed was measured too (2026-10-22): rustc's `opt-level = "z"` cuts the module from 860 KB to 650 KB
  gzipped but runs formula columns 1.5 to 3 times slower; `"s"` saves 11% for about a third slower; `wasm-opt`'s level
  moves it under 1%. It stays at 3. What's big after rustc: the dispatch functions `wasm-opt` inlines into, `.rodata`
  (the call table's JSON among it) and serde's derive for `FrameOp`.
- **A function call costs about 1,100 to 2,000 instructions a row** (`ABS(@value)` 1,140, `PROPER(@key)` 1,820,
  `ROUND(@value, 2)` 2,000), against about 490 for an operator (`@value * 1.2`), counted natively by `colbench` under
  callgrind. A name resolves once: `route` (`excel_functions.rs`) gives it its arm of `call_function`'s match (an `F`)
  or the module that holds its body, and the call path's per-name facts (eta host, LAMBDA host, memo shaper, branch
  selector, ported) sit in its `Traits` as `fast`, so no string is compared per row; that cut `ABS` from 1,440.
  What's left is spread thin: each call's argument vector, the call site's cache lookup, the column lookup by name.
- **Size.** The module is 4.8 MB raw / 1.7 MB gzipped (2026-10-23, the pack functions in) after `wasm-opt -O3` (`scripts/build-wasm.mjs`), every function body, the evaluator, the unit dimension algebra, V8's `Date.parse` and the full NFD table included. HASH's digests and base64 run on `md-5`, `sha1`, `sha2`, `crc32fast` and `base64` (20 KB gzipped; `hash_ops.rs` keeps the FNV-1a lines and base64's whitespace, URL-safe, padding and byte-order-mark rules), the hash maps on `rustc-hash`. `regress`
  is vendored in `crates/vendor/regress` with two patches. Its non-Unicode Canonicalize (`fold_code_point`, which a caseless backreference compares by) reads as V8's: a non-ASCII unit never goes to ASCII (`ſ` and `s` don't match each other), and a unit whose full uppercase is two units stays itself (`ᾳ` and `ᾼ` don't), from a 102-unit table taken from V8 (`corePlatform.test.ts` checks every BMP unit against V8). The `no-property-escapes` feature: `\p{…}` parses only in
  Unicode mode, which Solenoid never uses, and refusing it drops the property tables (82 KB gzipped). The case-folding
  tables stay. UNACCENT and SLUGIFY decompose through `nfd_table.rs` (`scripts/gen-nfd-table.mjs`, from Node's own
  NFD, every code point, combining classes read off its reordering; 19 KB gzipped) instead of `unicode-normalization`. Size
  modes (`opt-level = "z"`) cut it by a fifth but halve the speed, so they're out. Ops arrive as `TaggedOp`, which reads
  the TS's `{ kind, ... }` as serde's external tagging, because the derived internally tagged form was the largest
  function. What's left is spread thin: `call_function` (53 KB before opt), the pivot, the command dispatcher.
- **Text is always well formed** (the author, 2026-10-22). A slice or match that halves a surrogate pair answers
  U+FFFD for the half (`from_utf16` in `excel_functions.rs` and `text_ops.rs`), and text holding a lone surrogate reads
  as U+FFFD where it crosses into wasm, whose strings are UTF-8 (`toWellFormed`, `coreValues.ts`;
  `coreSurrogates.test.ts`): `LEFT(t,2)&RIGHT(t,2)` over `"a😀b"` answers `a��b`, and Distinct merges two lone
  halves into one U+FFFD. The rule has no leaf yet.
- **CI** runs the core's own tests (`engine-test.yml`, job `core`), and `wasmStamp.test.ts` fails when
  `crates/solenoid-core` changed without `npm run build:wasm` (the build writes `source-stamp.txt`).
- **A card mapping a body over a list runs its loop on the core** ([[C120]] linearWork): over 50,000 items UPPER takes
  about 30 ms (develop: 23), ROUND about 36, ISEVEN about 27 (`BENCH=1 npx vitest run tests/graph/cardBatchBench.test.ts`).
  A wired LAMBDA's captures: a list of 64 or more crosses once and the core holds it by id while the JS list lives
  (`envValue` in `coreValues.ts`, `HELD` in `eval.rs`), and `engine_eval` keeps its last 16 formulas parsed with their
  range memo (`eval::formula`), so `x - AVERAGE(vals)` over 3,000 items reads `vals` once: about 50 ms, from 1.9 s
  (develop: 8 ms).
