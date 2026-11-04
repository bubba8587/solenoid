---
aliases: ["Rust core"]
tags: [spec, computation]
---
<!-- [[C130]] rustCore, [[D99]] rustIsSpec -->

# Spec: the Rust core

Serves [[C130]] rustCore and [[D99]] rustIsSpec. `crates/solenoid-core` is Solenoid's headless core (it began as a port of the TypeScript one), built for two targets: WebAssembly for the app, linked into the graph engine's module (`npm run build:wasm` writes `src/graph/engineWasm/`, [[graph-core]] § The module), and native for tests (`npm run test:core`). The method is borrowed from [tsrs](https://github.com/oxc-project/tsrs).

## The Rust is the spec

- The core is the one implementation. A change in behaviour is made in the Rust, together with the fixtures it changes, in the same commit.
- The port began as a mechanical copy of the TypeScript, so the Rust keeps the TS's names (in snake_case) and order of operations wherever a fixture depends on them.
- Moving a TS copy onto the core:
  1. Freeze: the TS's answers on its tests' inputs are written to fixture files (`fixtures/core/`).
  2. Cover: the core answers every case the copy's callers make.
  3. Delete: the TS copy and its differential test go, and the fixtures stay as the test. `FREEZE_CORE=1 npx vitest run tests/graph` re-answers every suite's frozen cases on the core and writes them back (`FREEZE_CORE=frame-fns,columns` only those), which is how a deliberate change in behaviour moves a fixture. Natively, `FREEZE_NATIVE=function-bodies,expressions cargo test --release --test conformance` (or `=1`) rewrites only the answers that moved in the suites that load their own file (`check_or_freeze`, `tests/conformance.rs`), with no wasm build between; the wasm replay then holds the module to them. Card fixtures still re-freeze through `FREEZE_CORE=nodes`. Freezing stays in the JS harness, since it is what turns a JS value into a case: a suite that freezes answers every case through the wasm build, where its replay otherwise takes a sample. `cargo test --release --test conformance` then holds the native build to the new files.

```mermaid
flowchart LR
    ts["a TypeScript copy<br>and its tests"] -->|"1. freeze"| fx["its answers written<br>to fixtures/core/"]
    fx -->|"2. cover"| rust["the core answers<br>every caller's case"]
    rust -->|"3. delete"| gone["the TS copy and its differential<br>test go; the fixtures stay"]
    gone --> change["later changes: edit the Rust,<br>FREEZE_CORE re-answers its fixtures,<br>one commit"]
```

- Gone so far: the graph model, the dataflow engine, the compute pass and its state, the error guard and arrival coercion, the socket lattice, the Type Settle and Conduit lanes, the format-annotation walk, the Format Controller reconcile and the text save form (into the graph module, [[graph-core]]), the scheduler ([[schedule-and-gantt]]), display formatting, typed-text reading, the data providers' parsing, the formula evaluator, the parser, every function body and Formula.js, the computed-column row path, the pack functions' JavaScript, the JS frame verbs and their backend, the node bodies ([[node-bodies]]), the statistics kernels (`statsOps.ts`), the table popups' footer profile and chrono-node's reading of relative dates (`relative_date.rs`). The TS keeps the editor's walkers over the core's tree (variables, LaTeX, steps) and the op modules the components and the canvas still read.
- The JavaScript semantics the frozen answers carry stay ported, because they decided those answers:
  - `String(x)`, `Number(x)`, `trim` and UTF-16 string order, in `jsnum.rs`.
  - A stable sort that never panics on an inconsistent comparator, in `sort.rs`.
  - `toPrecision`, in `unit_value.rs` (17 correctly rounded digits decide the cut unless they read as a possible tie, and Clinger's fast path turns them back into a number); `toFixed` and `toExponential`, exact ties rounding up, in `jsnum.rs`.
  - The transcendental functions (`exp`, `log`, `pow`, the trig and hyperbolic ones) run on the `libm` crate, which answers the same bits natively and in wasm, where Rust's own `f64` methods call the platform's library and differ in the last place; `pow` follows IEEE 754 (`1^y` is 1, `0^0` is 1). `clippy.toml` in the core and the graph bars those `f64` methods from shipped code, so a call can't slip back to the platform's answer. `hypot_all` takes any number of arguments, Kahan-compensated.
  - A JS exception (a function that throws) ends the row's evaluation.
- A function's dispatch facts, argument roles and empty-slot readings live in `data/call_traits.json` (first frozen from the TS's call table; the tests read it through `tests/graph/callTraits.ts`). The names the editor offers come from the core (`engine_function_names`); the TS keeps only each name's arity and signature hint (`excelFunctions.ts`, `formulaSignatureTable.ts`).
- Correctness rests on the conformance checks (the Tests below), not on review.
- A Rust test finds its fixtures from the crate's folder as `cargo test` sets it when the test runs, never as it was when the binary was built: `scripts/check-rust.sh` shares one build directory across checkouts and worktrees, and cargo reuses a test binary built in another checkout, so a path fixed at compile time would read that checkout's fixtures, or a folder that is gone.

Tests:

- `conformance.rs` (solenoid-core) replays the frozen answers in `fixtures/core/` natively, every case through the commands the wasm build reaches. Its helpers turn a fixture's encoded values into what the JS sends and the core's reply into what the JS compares, so a case passes natively exactly where it passes in wasm. It covers every function body on random and edge arguments, 18k formulas over values, 15k computed columns, 12k verb pipelines, 26k frame functions, 6k parser trees (checked against the TS parser on all 49k formulas the fixtures hold before it went), 3k pack calls, formula dimensions and affine weights, the unit-aware bodies, wrappers and folds, typed date text and dimension labels. `SUITE=columns,verbs cargo test --release --test conformance` runs only those suites.
- `coreConformance.test.ts` replays every 50th case of the same suites through the wasm build, which shows it answers as the native one, and a suite that freezes answers every case. The suites a TS caller builds the cases for (card shapes, verb shapes, FC tagging, column inference, the boundary's literals and throws) replay in JS only.
- `corePlatform.test.ts`: where the core ports a table the platform holds, it is checked against the platform: UNACCENT against Node's NFD, over every code point of the scripts whose letters carry marks (Latin and its extensions, combining marks, Greek, Cyrillic, Hangul). A Unicode version change shows on the bleeding-edge branch, which moves the normalization crate and Node together.
- `properties.rs` (solenoid-core): the laws between answers over seeded random cases, where the fixtures pin chosen answers (`PROP_CASES=1000000` runs more, `PROP_SEED=n` starts elsewhere).
- `rustTestPaths.test.ts`: no Rust test fixes its fixtures' path at compile time.
- Every test file loads the core (`tests/setup/graphEngine.ts`), so the hand-written suite's formulas check the Rust evaluator too, and `npm run test:core` runs the frame-verb corpus (`fixtures/frame-verbs`) natively.

## What runs on the core

| Surface | Where | Evidence |
| --- | --- | --- |
| Frame verbs, joins, appends, binds, PIVOTBY | the core in wasm, on the web and desktop alike, units and formats included: a frame's columns carry them into the core and each verb decides its own | the corpus natively; frozen verb pipelines; the verb tests through `tests/graph/coreVerbs.ts` |
| A cube's row verbs (sort, filter, distinct, head, window) | the node bodies (`nodes/verbs.rs`): the scalar columns run through the frame verb, which answers the rows they keep or the window's column, and the nested cells ride along by them; list conditions read the nested cells | the frozen node cases (`fixtures/core/nodes/`) |
| The formula parser, for the evaluator and the editor (`parseFormula`, `engine_formula_parse`) | `excel_formula.rs` | 6k frozen trees (`formula-trees`) |
| The evaluator (`Eval`): operators, broadcasting, argument roles, the IFERROR family, `route_call`'s ladder, LAMBDA values, MAP BYROW BYCOL REDUCE SCAN MAKEARRAY GROUPBY | `eval.rs` | 18k frozen formulas; the whole suite |
| Every function body in the registry | `excel_functions.rs` and the `fns_*.rs` modules; dates read the host's zone and IANA zones through `zone.rs` (IANA zones from jiff's bundled tzdb in every build, with the names only ICU takes mapped beside it; the local zone is the host's) | the frozen function-body cases |
| Computed columns: whole columns as one-column tables, `@name`, side values of any shape, wired LAMBDAs and their captures | `eval::column`, `engine_compute_column` | 15k frozen columns |
| The Expression card and every `compileEvaluator` | `evaluateOnCore` (`coreValues.ts`) | as above |
| The dataflow engine, the compute pass (its walks, seeding, invalidation, fetch and render set) and its state (calc mode, dirty flag, recalc generation, rebuild scopes, single flight), node and cable ids | `crates/solenoid-graph` on netcore-rs, in the same wasm module ([[C130]] rustCore, [[graph-core]]) | netcore-rs's oracle against rete-engine; `dataflowEngine.test.ts`; the session's native tests; the whole suite |
| The input boundary every node's call goes through: the error guard and arrival coercion ([[compute-pass]] § The per-node wrappers) | `boundary_core.rs` over core values for a card whose body is on the core, called in Rust ([[graph-core]] § Direct calls); `boundary.rs` over the app's JavaScript values for every other card | the frozen boundary answers (`boundary-*`, `coreBoundary.test.ts`); the whole suite |
| Node `data()` | the node bodies ([[node-bodies]]); a body over a list runs its loop on the core | `fixtures/core/nodes/` ([[node-bodies]]); each family's tests |
| Frame computations no formula shares: headers, Describe, Correlation Matrix, Reconcile, Nest's grouping, XLOOKUP over a frame, Get Row, Get and Add Column's naming, Build and Split Frame, Frame from Lists, the Decision Matrix and its flip points, the Allocator, the Payoff Planner, the Choice Ladder (its plan, and its ladder beside it as `ladder_from_wire` lays it out), Group Cost Settle's totals and its ledger, Amortization, K-Means, PCA, logistic regression. A thrown error crosses as itself; a card with several outputs gets them side by side in one frame | `frame_fns.rs`, `decision.rs`, `planners.rs`, `ladder.rs`, `engine_frame_fn`, `frameFnOnCore` (`frameBackend.ts`) | the frozen frame-function cases |
| A pack's formula functions (ELEMENT, SUNRISE, ESERIESVALUE and kin), always known, advertised only while their pack is on | `fns_packs.rs`, over the cards' kernels (`nodes/packs.rs`); a pack's TS declares each one's name, arity and hint (`packs/*Formulas.ts`) | 3k frozen pack-call formulas (`pack-calls`) |
| A formula's unit reading ([[unit-flow]] § Formula dimensions, § Expression): its result dimension (`dim_eval_with_code`) and its point weight over readings (`affine_weight`), for every caller: Expression, the LAMBDA folds, a computed column's unit plan (`plan_column_units`, Frames and Cubes alike, its named LAMBDAs crossing as `fns`) and Equation. A caller with no formula text (Equation's isolated side) sends its tree, as the TS `Ast` object (`Ast::from_json`) | `unit_dims.rs` (a finance call's money through `finance_units.rs`, [[C25]] firstClassUnits); `engine_dim_eval` and `engine_affine_weight` are the conformance suite's way in | 18k frozen formula dimensions (`unit-dims`), 6k through named LAMBDAs (`unit-dims-fns`), 17k frozen weights (`affine-weights`), each replayed as text and as a tree |
| Expression's unit wrapper ([[unit-flow]] § Expression) once its inputs are read: the dimension check, the one shared display unit the formula runs in, the point weight over readings, the inputs in their shown magnitudes (`displayMagnitudeOf`), the evaluation and the result's unit. Each cell's display unit crosses with its dimension beside its scale and offset (`displayDim`) | `unit_expression.rs`, called by Expression's body on the core (`nodes/formula.rs`, [[node-bodies]]) | 6k frozen Expressions over generated unit inputs (`expression-units`) |
| REDUCE, BYROW and BYCOL's unit wrapper ([[unit-flow]] § LAMBDA hosts) over an inline formula: the cells' one dimension, the display unit they share, the fold on the stripped magnitudes, the point weight over readings and the result's re-tagging | `unit_fold.rs`, called by those nodes' bodies (`nodes/matrix.rs`, [[node-bodies]]) | 5k frozen folds over generated unit tables (`fold-units`), also replayed through the nodes' `data()` |
| List bodies over values with a unit (`UNIT_READY`): the ones that move cells without reading them, the shapers SORT, SORTBY, UNIQUE, TAKE and DROP (a unit cell sorts after the logicals and ties with its kind; UNIQUE keys it by base magnitude at 15 digits and dimension), FILTER (a unit cell as a condition is `#VALUE!`), and RUNNING, which reads each cell's display unit from the wire (its scale and offset as the TS resolves them) | `V::Unit`, `unit_lists.rs`, `coreValue(v, true)` and `readReply` (`coreValues.ts`) | 4k frozen calls (`unit-lists`), 5k frozen shaper calls (`unit-shapers`), 4k frozen FILTER calls (`unit-filters`), 6k frozen RUNNING calls with and without units (`unit-running`) |
| The graph's derived state: the socket lattice, the Type Settle with Conduit lanes, the format annotations, the Format Controller reconcile, the walks through Conduits, and the text save form | `crates/solenoid-graph` (`lattice.rs`, `settle.rs`, `annotate.rs`, `fc.rs`, `conduit.rs`, `text_form.rs`; [[graph-core]] § Phase D, § Phase E) | the frozen lattice, settle, annotation, reconcile, Conduit-walk and text-form answers (`fixtures/core/*.json.gz`) |
| Display formatting ([[C118]] formatTravelsWithValue) and typed-text reading ([[C58]] tableInputRawText): a number as the General style or a format annotation shows it, a date serial in a pattern, a typed number or logical | `card_helpers.rs`, `value_kinds.rs`, through the module's `fmt_scalar`, `fmt_annotated`, `fmt_date`, `read_decimal`, `read_logical` ([[format-model]]) | the frozen number formats (`number-format`, `coreCardHelpers.test.ts`) |
| The data providers' replies (Open-Meteo, Nager.Date, Frankfurter) read into their cards' outputs; the cards fetch and cache the text | `providers.rs` | the frozen provider readings (`providers`, `coreProviders.test.ts`) |
| The project scheduler: CPM, calendars, the schedule file formats | `crates/solenoid-schedule`, linked by the core ([[schedule-and-gantt]]) | its own native tests |
| CSV text, on the `csv` crate: the rows under each option, a file's typed frame (`csvToFrame`), a Frame Input's CSV text, and the Sink's CSV ([[frame-verbs]] § Reading CSV text) | `csv.rs`, `engine_csv_frame` and `engine_csv_rows` (the columnar hand-off), `engine_csv_source`, `engine_csv_text` | 11k frozen row readings, 2.9k frozen frames and as many Frame Input sources, 800 frozen writes (`csv-*`, the core's own answers), over generated CSV and the repo's own files |

## Nothing falls back

The core is the only evaluator. A reading it doesn't make is an answer, never a hand-off: text outside the date reader's closed list of shapes is not a date (DATEVALUE answers an error, a criterion compares it as text); a loop past a cap, a value nested past a table and a regex past the core's limits answer an error that says so; a name the core doesn't know is #NAME?. Text is always well formed: a slice that would halve a surrogate pair takes the whole character, as Excel's LEFT does (`from_utf16` in `excel_functions.rs` and `text_ops.rs`), so `LEFT(t,2)&RIGHT(t,2)` over `"a😀b"` answers `a😀😀b`; and text holding a lone surrogate reads with U+FFFD for it where it crosses into wasm, whose strings are UTF-8 (`toWellFormed`, `coreValues.ts`), so Distinct merges two lone halves into one U+FFFD. The rule has no leaf yet. A formula over a value with a unit it doesn't take is #VALUE! (the cards run their unit wrappers on the core, `unit_expression.rs` and `unit_fold.rs`). A wired LAMBDA crosses with the captures its body reads (`readValues`: the numbers they show, or a computed column's unit plan's magnitudes) and, beside them, the same captures with their units (`capturedValues`), which the core's unit plan (`nodes/columns.rs`) reads.

Tests: `coreSurrogates.test.ts`: a cut that would halve an emoji takes it whole and whole cuts keep it, and a lone surrogate reads as U+FFFD in a formula's text, its values and a Frame's cells.

## Where it runs

```mermaid
flowchart LR
    subgraph web["a browser"]
        wa["the app"]
    end
    subgraph desk["desktop (Tauri)"]
        wv["the app in a webview"]
        shell["the native shell:<br>what a browser can't do"]
    end
    mod["one wasm module:<br>formulas, verbs, pivots,<br>nodes, the graph"]
    wa --> mod
    wv -->|"fetched from the app's origin"| mod
    shell -->|"a Parquet file, as one buffer<br>of the columnar hand-off"| wv
```

- **Everything:** formulas, computed columns, frame verbs, pivots and nodes run on the core in wasm on every platform, desktop included: one build, one answer ([[C130]] rustCore). The app's chrome renders while it loads and the canvas waits for it (`useCoreReady`, [[graph-core]]), since the nodes run on it ([[node-bodies]]), so on a slow link the chrome comes up long before the whole module has arrived. The module loads when the entry scripts ask for it, with no `<link rel="preload">`: a preload brought the cards slightly sooner on a fast link but held the chrome back on a slow one, sharing the link with the entry scripts. The desktop shell adds only what a browser can't do; for Frames that is reading a Parquet file (`crates/solenoid-parquet`, [[frame-verbs#Reading Parquet]]). Its webview fetches the module from the app's own origin, so the CSP's `connect-src` carries `'self'` (`tauri.conf.json`).
- **Speed:** a million-row Frame chain (filter, computed column, group with sum, mean and median, join to a 1,000-row lookup, sort; the frame already resident) runs in well under a second in wasm, faster than Polars ran it on the desktop, where nearly all the time was the computed column's round trip out of Polars and back. Reopen [[C130]] if a Frame people open is slow in wasm.
- **Size:** the core is wasm32, so everything it holds at once (the frames the verb backend keeps, the values on cables, a verb's working copies) shares one 4 GiB memory, on desktop as on the web. A cell costs 16 bytes there, plus its text for a text cell, so a frame of a few tens of millions of cells fits and a hundred million is near the edge; the JavaScript side's own copy lives outside it. Running out traps (below). Polars kept a desktop frame native with no such ceiling; reopen [[C130]] if a Frame people open runs out. A Parquet file crosses from the shell as one buffer of the columnar hand-off (`Columnar::to_bytes`, `binaryFromBytes`), not JSON.
- **A trap** (an abort, a stack overflow, anything escaping the module mid-call) leaves the instance's stack pointer where it stopped, so the instance is dropped and the compiled module instantiated afresh, the graph with it, as [[graph-core#Traps]] says; the core numbers its handles past the dead one's (`engine_handle_base`). The call that trapped answers #ERROR! (`onCore`); a frame the verb backend held in the dead instance is gone, so a verb over it answers #REF! until the document reloads. `engine_trap` is the tests' trigger.

Tests:

- `desktopCsp.test.ts`: the desktop policy lets the webview fetch the module (`connect-src 'self'`) and run it.
- `coreTrap.test.ts`: a trap answers its own call and leaves later calls on a working core, and a lazy frame left in a dead instance rejects its preview with #REF!.
- `coreLimits.test.ts`: inputs a person can type or wire that once trapped the module (a stack overflow, an index past a ragged row, an unbounded allocation), hung it or took quadratic time each answer promptly.

## Performance

Code: `tests/graph/wasmEngineBench.test.ts`.

`BENCH=1 npx vitest run tests/graph/wasmEngineBench.test.ts` times the frame verbs and formula columns on the core in wasm over 200k rows × 5 columns in Node, best of 3, and prints the table; a plain run skips it. The latest figures are in `docs/dev-notes.md`.

- A verb row is the op plus a 100-row preview, with the frame already in wasm.
- An fx row includes uploading its columns and downloading the answer.
- Frames cross as columnar buffers, so uploading or downloading 200k rows takes tens of milliseconds.
- **A name dispatches as text** below `call_function` (`route`, then each module's `match`), and stays so: a cheap function answers in tens of nanoseconds natively, lookups included, and a body's own work is most of a slower function's time. A name's per-call facts are resolved once into `Traits.fast`, and a card reads its options into an enum or a function once per call, never per item ([[C120]] linearWork).
- Run to run the times move by about 20% on a shared machine. `examples/colbench.rs` counts a formula column's instructions natively under callgrind, which doesn't move.

## Follow-ups

- **Load time is the module's bytes.** A preload doesn't help (§ Where it runs). What would move it is a smaller module, or a first render that doesn't wait for the core. Smaller builds cost speed: rustc's `opt-level = "z"` cuts the module by about a quarter but runs formula columns 1.5 to 3 times slower, `"s"` saves about a tenth for about a third slower, and `wasm-opt`'s level moves it under 1%, so size modes are out. `opt-level = 2` is a few percent smaller than 3 and runs the same on every verb, formula column and pass benchmark, so the build uses 2. Per-dependency levels change nothing under LTO. What's big after rustc: the dispatch functions `wasm-opt` inlines into, `.rodata` (the call table's JSON among it) and serde's derive for `FrameOp`.
- **A function call costs about 1,100 to 2,000 instructions a row** (`ABS(@value)` 1,140, `PROPER(@key)` 1,820, `ROUND(@value, 2)` 2,000), against about 490 for an operator (`@value * 1.2`), counted natively by `colbench` under callgrind. A name resolves once: `route` (`excel_functions.rs`) gives it its arm of `call_function`'s match (an `F`) or the module that holds its body, and the call path's per-name facts (eta host, LAMBDA host, memo shaper, branch selector, ported) sit in its `Traits` as `fast`, so no string is compared per row. What's left is spread thin: each call's argument vector, the call site's cache lookup, the column lookup by name.
- **One file.** The module loads whole, not split into pieces loaded on first use: no part of it is more than about 7% of the total, so splitting would save little, and the first screen already waits only on what drawing the graph needs.
- **Size.** The module a browser downloads is built with `wasm-opt -O3` (`scripts/build-wasm.mjs`) and holds every function body, the evaluator, the unit dimension algebra, V8's `Date.parse` and the Unicode tables; its current size is in `docs/dev-notes.md`. HASH's digests and base64 run on `md-5`, `sha1`, `sha2`, `crc32fast` and `base64` (`hash_ops.rs` keeps the FNV-1a lines and base64's whitespace, URL-safe, padding and byte-order-mark rules), the hash maps on `rustc-hash`. Regular expressions run on `fancy-regex` (its Unicode tables included) under Excel's PCRE2 reading ([[formula-language]] § the text kernels). UNACCENT and SLUGIFY decompose through `unicode-normalization`, PROPER's letters come from `unicode-general-category`, SIMILARITY's Levenshtein, OSA and ratio run on `strsim` (its Jaro–Winkler adds a 0.7 cutoff, so ours stays), and UUID builds on `uuid`. Ops arrive as `TaggedOp`, which reads the TS's `{ kind, ... }` as serde's external tagging, because the derived internally tagged form was the largest function. What's left is spread thin: `call_function`, the pivot, the command dispatcher.
- **CI** runs each crate's own tests (`engine-test.yml`, jobs `core`, `graph`, `schedule` and `parquet`), and `wasmStamp.test.ts` fails when the module's sources changed without `npm run build:wasm` (the build writes `source-stamp.txt`; [[graph-core#The module]]).
- **A card mapping a body over a list runs its loop on the core** ([[C120]] linearWork). A wired LAMBDA's captures: a list of 64 or more crosses once and the core holds it by id while the JS list lives (`envValue` in `coreValues.ts`, `HELD` in `eval.rs`), and `engine_eval` keeps its last 16 formulas parsed with their range memo (`eval::formula`), so `x - AVERAGE(vals)` over 3,000 items reads `vals` once, not once per item. `BENCH=1 npx vitest run tests/graph/cardBatchBench.test.ts` times UPPER, ROUND and ISEVEN over 50,000 items called from JavaScript (`data()` to `nodeOnCore`); the app's pass calls direct cards in Rust instead, so `passBench.test.ts` is the bench for the app's speed ([[graph-core#Performance]]).
