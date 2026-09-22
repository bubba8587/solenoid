---
aliases: ["Frame model and relational verbs"]
tags: [spec, computation]
---
<!-- [[C16]] polarsEngine, [[D29]] oneVerbCorpus, [[C24]] arraySemantics, [[C45]] excelComparisons, [[C59]] byteStringOrder, [[D49]] textPredicateNeedsText, [[E2]] cubeNeverNarrowsToFrame -->

# Spec: Frame model and relational verbs

Serves [[C16]] polarsEngine, [[D29]] oneVerbCorpus, [[C24]] arraySemantics (and its children [[D36]] nullSkippedNotZero, [[D37]] errorBeatsMissing, [[D48]] classifyNonFinite, [[D49]] textPredicateNeedsText), [[C45]] excelComparisons, [[C59]] byteStringOrder and [[E2]] cubeNeverNarrowsToFrame. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

Code: `src/graph/frame.ts` (the value), `src/graph/frameVerbs.ts` (the verbs, called the oracle: the one definition every engine must match), `src/graph/frameBackend.ts` (the seam, lazy refs, materialization), `src/graph/nodes/frame.ts` (the verb cards), `src-tauri/src/engine.rs` (the native Polars engine), `fixtures/frame-verbs/` (the shared corpus). Computed columns (Frame Input's Fx column and the Computed Column node, `computedColumnCore.ts`) have their own spec and are only pointed at here. Static schema prediction lives in `frameShape.ts`, whose `shapeOf(op, input)` must report exactly the columns a real `preview()` would.

## The Frame value

### Shape

A Frame is a `FrameValue`: `{ __frame: true, columns: FrameColumn[] }`. The `__frame` brand is how every consumer recognizes a Frame on an `any` cable (`isFrameValue`); nothing sniffs structure. Three optional fields exist only on a value produced at a materialization boundary:

| Field | Set when | Meaning |
|---|---|---|
| `__totalRows` | a head-N card preview | The true row count; only the first N rows are in `columns`. |
| `__ref` | the same preview | The lazy handle it came from, so the grid popup and Copy CSV fetch the whole frame instead of exporting the preview. |
| `__approx` | a sketch-mode aggregate | `{ factor }`: sum and count columns were scaled up from a sample; the chip must never present them as exact. |

A `FrameColumn` is:

| Field | Type | Meaning |
|---|---|---|
| `name` | string | Unique within the frame (see Names). |
| `type` | `"number" \| "string" \| "date" \| "logical"` | The column's element family. A date column holds day serials; the tag is the only thing that says those numbers are dates ([[C44]] dateSerials). |
| `values` | `FrameCell[]` | One cell per row: `number \| string \| boolean \| null \| SolError`. |
| `unit` | `ColumnUnit`, optional | Only on a number column. The cells stay the bare magnitudes as typed, in the display unit, not base SI ([[D43]] unitByGranularity). |
| `format` | `FormatAnnotation`, optional | The display format stamped by the producing node; never saved. |
| `raw` | `string[]`, optional | The source text per cell before type inference, present only on a source frame (Frame Input, an import). A blank cell's raw entry is `""`. |

### Rows

A frame has no row identifier. A row is a position. The row count is the length of the longest column (`frameRowCount`), and a read past the end of a shorter column is `null` (`cellAt`), so ragged columns behave as if padded with blanks. The native engine pads ragged columns with nulls on upload. Every verb returns a new frame and leaves its inputs untouched; the corpus runner checks this for every case.

A verb that moves or rewrites cells (sort, distinct, head, filter, slice, fill, replace, drop blank rows, and every verb built on `reorderRows`) drops `raw`, because a derived column has no source text that lines up with its values.

### Names

`makeHeaders(names, ncols)` is the one naming rule, used by every builder and every verb that emits new names. It returns exactly `ncols` names: each given name is trimmed; a blank becomes `Col{i+1}` (1-based position); a repeat takes the smallest free integer suffix starting at 2 (`Date, Name, Date` becomes `Date, Name, Date2`). Names are processed left to right, so the later of two colliding columns is the one renamed. The Rust engine's `make_headers` is the same algorithm.

Column lookup is exact and case-sensitive everywhere a verb needs a column (`requireColumn`); a missing name is `#REF!` with the message `column "<name>" not found`. The looser `getColumn` (used by Get Column and the `column` backend call) trims the name, matches exactly, and otherwise accepts a bare integer string as a 1-based column index.

### Type inference

There are four entry paths, and they do not infer the same way.

| Path | Used by | Rule |
|---|---|---|
| `inferColumn(name, cells)` | CSV import (`frameFromCells`), JSON records, arrays and columnar objects, cube-to-frame reads, Unnest | A cell is blank when it is `null`, `undefined` or whitespace text. If every non-blank cell is a JS boolean, the column is logical. Else if every one reads as a number, number. Else if every one is the text `TRUE` or `FALSE` (any case), logical. Else if every one is an unambiguous ISO date, date (cells become serials). Else string, with each cell trimmed. An all-blank column is string. `raw` keeps each cell's trimmed text. |
| `typedColumn(name, cells, length, knownType)` | Build Frame from a matrix or lists, flat cube to frame | A known type from the socket wins; it is the only way to recover date. Without one, inference goes by runtime type and preserves it: all numbers is number, all booleans is logical, anything else is string (the string `"1"` stays text). Cells are then coerced to the column type: a string column stringifies, a logical column reads a non-boolean as true only for the text `true`, and a number or date cell that cannot become a number is `NaN`. Errors and blanks pass through. |
| `coerceFrameCell(type, raw)` via `deriveFrame` | Frame Input (the column type is stored, never inferred) | Blank text is `null`. A string column keeps the text verbatim. A logical column goes through `coerceLogical`. A number column parses the trimmed text or is `NaN`. A date column tries a number, then `parseDate`; a parse error (such as `#AMBIGUOUS!`) is kept as that error cell, and a non-finite result is `NaN`. |
| `inferColType` inside `parseFrameSource` | A hand-typed or CSV-shaped `frameText` | Type only, cells kept raw: number, then logical, then ISO date, then string, over trimmed non-blank cells. |

"Reads as a number" (`cellToNumber`) accepts a finite number, a boolean (as 1 or 0), a `UnitCell` (its display magnitude), or trimmed text that `Number()` parses to a finite value. Commas are stripped only when they sit in genuine thousands positions (`^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$`), so the European `3,5` stays text. A column whose non-blank cells are all JS booleans infers logical before the number test runs; a mix of booleans and numbers reads as number with 1/0 cells. A 0/1 column stays number.

An unambiguous ISO date is `YYYY-MM-DD` with an optional ` ` or `T` time `hh:mm[:ss[.f]]` and an optional `Z` or `±hh[:]mm` zone, and it must parse to a finite serial. Bare years and slash dates such as `1/2/26` never infer as dates; Get Column's read-as converts those explicitly. The native CSV reader (`engine_read_csv`, desktop only) lets Polars type numbers and booleans, then applies the same ISO gate to its remaining string columns (`infer_iso_date_columns`); zone-less text reads as UTC wall-clock, and a column with one non-conforming cell stays text.

`frameText` is stored as JSON: `[{ name, type, cells, unit?, expr? }]`, cells being the raw typed strings. `parseFrameSource` also reads a typed-`values` JSON (stringifying the values back to raw cells, booleans as `TRUE`/`FALSE`) and falls back to the CSV reader for anything else. An unrecognized `type` reads as number.

### Nulls, errors and non-finite numbers

`null` is an empty cell. It is skipped by aggregates, dropped by comparisons, sorted last, and is its own key in grouping and dedupe ([[D36]] nullSkippedNotZero). A `SolError` in a cell is a present value: it is not blank, it propagates through aggregates, sorts last, and keys by its code ([[D37]] errorBeatsMissing). `±Infinity` is a real value in a number column. `NaN` is present but dirty: it is counted, it is not blank, it sorts into the tail, it fails every predicate except `neq`, and it poisons an aggregate to `#DOMAIN!`.

### Units and formats

A number column is locked to a unit by a `Name (unit)` header at build time (`buildFrame`, `buildFrameTyped`, `addColumn`: the parenthetical is stripped from the name before de-duplication) or by a Frame Input column's `unit` field. Crossing into a Cube, a locked column's cells become per-cell base-SI `UnitCell`s (`cubeCellsFromColumn`, the one bridge); reading a cube column back through `inferColumn` recovers a uniform unit.

The `format` annotation is stamped on a node's FrameValue outputs by the input-coercion wrapper from `frameFormatStore`, per node and column; a nearer pick overrides a farther one. Unit and format behavior per verb is listed under each verb; unit rules themselves belong to [[unit-flow]].

### Frames and Cubes

A Cube never enters a Frame socket ([[E2]] cubeNeverNarrowsToFrame). A verb card that accepts a Cube declares a cube-adoptive input with `noWidenInputs` and either runs its own cube branch (the cube row verbs under Eager verbs outside the seam) or calls `flatCubeToFrame(cube, only?)`, which types each column through `typedColumn` with the cube column's carried type and reads a `UnitCell` as its bare base-SI value (the unit is not recovered). `only` picks the columns: all of them, the named ones (`#REF!` for a missing name), or `"scalar"` (every column without nested cells). A list, Frame or Cube cell in a picked column is `#SHAPE!` (`Column "<name>" holds nested cells; this reads flat rows`). GROUPBY picks its keys and value column (its scalar columns while unconfigured); PIVOTBY, SUMIFS and Chart read `"scalar"`, so a list column is simply not a field. `frameToCube` goes the other way: depth 1, element type and format carried, locked cells tagged.

## Lazy frames

### FrameRef

A Frame on a cable between verb cards is usually a `FrameRef`: `{ __frameRef: FrameHandle, __plan: FrameOp[] }`. The handle names a frame stored in the backend; the plan is a queue of unary ops not yet run. `isFrameRef` tests for the `__frameRef` key. A consumer never reads a handle's data except through the boundaries below.

| Runner | Input | Result |
|---|---|---|
| `runFrameUnary(input, op)` | a FrameRef | A new ref with the same handle and `op` appended. No backend call. |
| | a FrameValue | The value is uploaded (`source`) and the result is `{ handle, plan: [op] }`. |
| `runFrameJoin`, `runFrameAppend`, `runFrameBindColumns` | any mix | Each input is resolved to a handle (flushing a ref, uploading a value), the backend runs the verb now, and the result is a ref with an empty plan. |

Uploads are cached by FrameValue identity (a `WeakMap`), so a source node that re-emits the same object each pass is uploaded once; Frame Input keeps its emitted object stable for this reason. A `FinalizationRegistry` drops the backend copy when the FrameValue is collected. A rejected upload is evicted so the next pass retries.

Every runner catches a throw and returns it as a `SolError` value (`asErrorValue`: a SolError passes through, anything else becomes `#ERROR!` with the message).

### Flushing

`flushRef(ref)` turns a ref into a real handle with one `applyMany(handle, plan)` call. An empty plan returns the handle as is. Results are memoized per ref object, never per handle, because two refs may share a handle with different plans. Within one compute pass, a flush looks for the longest plan already flushed on the same base handle that is a strict prefix of this plan (ops compared by object identity) and applies only the remaining tail to that result, so a chain of N previewing cards costs one op per card. The rebase is skipped when the tail contains a `groupBy`, because the aggregate guard needs the plan's base handle.

### Materialization boundaries

| Boundary | Call | Result |
|---|---|---|
| Full collect | `readFrame(v)` | A FrameValue. Memoized per ref per pass, so a ref fanned out to several consumers collects once. A FrameValue, `null` or SolError passes through. |
| Card preview | `collectPreview(out, n = 100)` | If the frame has at most `n` rows, the full frame (through `readFrame`). Otherwise a FrameValue of the first `n` rows with `__totalRows` set to the true count and `__ref` set to `out`. |
| Schema | `collectPreview(ref, 0)` | Column names and types with no rows. Pivot uses it. |
| One column | `backend.column(handle, name)` | One `FrameColumn` or `null`. Get Column, Pivot and the aggregate guard use it. |

Both collect paths apply sketch scaling and then the aggregate guard (below) before returning, both keyed by the flushed handle. A consumer that awaits a boundary wraps it in `materialize(p)`, which returns a throw as a SolError instead of letting it escape `data()` (where the error guard would flatten it to `#ERROR!`).

### Who receives a ref

`LAZY_FRAME_NODES` (`coerceInputs.ts`) lists the classes whose `data()` receives a FrameRef as is: `DistinctNode`, `HeadNode`, `SortFrameNode`, `FilterFrameNode`, `JoinNode`, `ColumnsNode`, `GroupByFrameNode`, `UnpivotNode`, `AppendNode`, `BindColumnsNode`, `RenameNode`, `FillBlanksNode`, `ReplaceValuesNode`, `WindowNode` (the verb cards), plus `GetColumnNode`, `SumIfsNode`, `TableInfoNode`, `WriteFileNode`, `PivotNode` and `SlicerNode`, which read through the column, preview or read-at-Run primitives instead of a full collect. For every other node, the coercion wrapper sees a ref among the inputs and collects it with `readFrame` before calling `data()`. `lazyChain.test.ts` requires every class that emits a ref to be in the set.

### Verb card lifecycle

A verb card's `data()` calls `beginPass(this)` before its first await, runs its runner, and hands the result to `emitFrame(node, gen, out)`. `emitFrame` collects the card preview into `cachedResult`, keeps the output ref in `node._ref`, drops the card's previous ref if it differs, and returns `{ frame: out }`. If a newer pass started while this one awaited (`gen !== node._gen`), the result is discarded, its ref dropped unless it is the live one, and `{ frame: null }` returned. A card with nothing to do forwards a ref through `passFrame`, which appends an empty `drop` so the forwarded ref has a non-empty plan and so does not own the upstream handle.

Ownership: only a ref with an empty plan owns its handle (`dropFrameRef` drops nothing else), which in practice means a binary verb's output. Handles created by flushing are owned by the per-pass memo: `clearCollectMemo()`, called at the start of every `processGraph` pass and every `computeAll`, drops every handle the previous pass flushed and clears all memos. A preview's `__ref` still works after that, because its plan re-flushes from the base handle.

### Sketch mode and the aggregate guard

In the sketch calculation mode, a flush first asks the backend for a deterministic sample of the plan's base handle (`SKETCH_SAMPLE_ROWS = 10,000`; evenly strided rows `floor(i × total / n)`, order kept, never random). The factor is `total / sampled`. When the plan contains a `groupBy`, the output columns of the last `groupBy`'s `sum` and `count` aggregates are multiplied by the factor at read time, and the collected value carries `__approx`. Scaling is never written into backend data.

The aggregate guard classifies non-finite aggregate results at read time ([[D48]] classifyNonFinite). For a handle produced by a plan with a `groupBy` (or rebased onto one), any aggregate output column holding a non-finite number is passed through `guardFinite`, with an infinite input assumed when the source column on the base handle contains `±Infinity`. On the JS backend the oracle has already classified every aggregate, so this is a no-op there.

## The FrameBackend seam

### Interface

All methods are async except `drop`, because the native backend is IPC.

| Method | Contract |
|---|---|
| `source(frame)` | Store an eager frame, return a new handle. |
| `apply(handle, op)` | Run one op, return a new handle; the input handle stays valid. |
| `applyMany(handle, ops)` | Run a whole plan in one round trip (the fusion primitive). |
| `join(left, right, opts)` | The Join verb. |
| `append(handles)` | Stack by column name. |
| `bindColumns(handles)` | Side by side by position. |
| `preview(handle, n)` | `{ schema: [{name, type}], rows (row-major, first n), rowCount, truncated }`; `truncated` is `rowCount > n`. |
| `collect(handle)` | The whole frame. |
| `column(handle, name)` | One column by `getColumn` rules, or `null`. |
| `drop(handle)` | Free the handle; a no-op on an unknown handle. |
| `sample(handle, n)` | `{ handle, factor }` as in sketch mode; `factor` 1 and the same handle when nothing was sampled. |

A missing handle is `#REF!` (`frame handle <h> not found (dropped or never created)`).

### Choosing the backend

`frameBackend()` starts as the `JsFrameBackend`. At startup `initFrameBackend()` checks `engineAvailable()` (the desktop shell); if `engine_ping` reports `backend: "polars"`, it calls `engine_clear` (a webview reload would otherwise orphan every stored frame) and swaps in the `PolarsBackend`. Any failure keeps the JS backend. A swap (`setFrameBackend`, `resetFrameBackendToJs`) clears every handle-keyed cache, because handle strings are unique only within one backend instance.

### JsFrameBackend

Handles are `jsf:<n>`. Each method calls the oracle (`applyVerb`, `joinFrames`, `appendFrames`, `bindColumns`, `sampleFrame`) and registers the result. A sourced frame is held through a `WeakRef` so the finalization drop can fire; a derived frame is held strongly until dropped. `collect` returns the stored object itself.

### PolarsBackend and the wire

Handles are `plf:<n>`, held in a process-global store in the Rust process. The Tauri commands and their argument names:

| Command | Arguments | Returns |
|---|---|---|
| `engine_source` | `frame: { columns: [{name, type, values}] }` | handle |
| `engine_apply` | `handle, op` | handle |
| `engine_apply_many` | `handle, ops` | handle |
| `engine_join` | `left, right, opts: { leftKey, rightKey, how, asofDirection?, asofTolerance?, rightKeyScale?, rightKeyOffset? }` | handle |
| `engine_append` | `handles` | handle |
| `engine_bind_columns` | `handles` | handle |
| `engine_preview` | `handle, n` | `{ schema, rows, rowCount, truncated }` |
| `engine_collect` | `handle` | `[{name, type, values}]` |
| `engine_column` | `handle, name` | a column or `null` |
| `engine_sample` | `handle, n` | `{ handle, factor }` |
| `engine_drop`, `engine_clear` | `handle` / none | nothing |
| `engine_read_csv`, `engine_read_parquet` | `folder, name` | columns / handle |

An op is the `FrameOp` object itself, tagged by `kind` with the same camelCase field names (serde's `#[serde(tag = "kind")]` on `WireOp`); optional fields default when absent. There is no `pivot` variant.

Cells cross as JSON. Upload direction (`encodeWireCell`): a finite number, string, boolean or `null` as is; a non-finite number as `{"__nf": "inf" | "-inf" | "nan"}`; a SolError as `{"__err": code}`. Only name, type and values cross: `unit`, `format` and `raw` are not sent and do not come back. The Polars backend puts `unit` and `format` back itself: each handle keeps a row-less copy of its frame's columns, every verb that makes a new handle is run over those copies with the same JS verbs, and a collected, previewed or read column takes the unit and format of the copy with the same name and type. So a unit survives exactly the verbs it survives on the web. `raw` is not restored. The engine coerces each cell by the declared column type (`json_to_cell`):

| Column type | Accepts | Everything else |
|---|---|---|
| logical | a boolean; a number (non-zero is true); text `true`/`false`/`1`/`0` after trim, any case | `null` |
| string | text | `null` |
| number, date | a number; a boolean as 1/0; text parsed after trimming and removing every comma; the `__nf` sentinel | `null`, including `{"__err": …}` |

Download direction (`num_to_json`): an integral number within the safe range as a JSON integer, other finite numbers at shortest round-trip precision, `±Infinity` and a canonical `NaN` as the `__nf` sentinel, and the engine's three reserved NaN payloads as `{"__err": "#DOMAIN!" | "#OVERFLOW!" | "#DIV/0!"}`. The JS side decodes both sentinels back (`decodeWireCell`). A failed command rejects with `{ __solError: true, code, message }`; `toSolError` accepts only canonical codes and maps anything else to `#ERROR!`. An unexpected engine failure is `#ERROR!` (`IpcError::internal`).

What this means for a frame computed natively: a per-cell error in an input becomes a blank for every native verb (so `isblank` selects it and Distinct merges it with blanks), and a column's unit, format and source text are gone after any native verb. The error-predicate filter is routed to the oracle for this reason (see Filter).

### Native execution and fusion

`engine_apply_many` threads one Polars `LazyFrame` plus the tracked names and Solenoid types through the whole plan (`apply_step`) and collects once. Polars dtypes cannot tell number from date, so each stored frame keeps a `SolType` per column and every step computes its output types by the oracle's rules. The steps that build lazily are `select`, `drop`, `rename`, `sort`, `head`, `sliceRows`, `groupBy`, `window`, `fillBlanks`, `replaceValues`, a comparison `filter`, and a `filterMulti` whose conditions are all comparisons. The steps that need a row scan collect their own input, run a hand-written verb and resume lazily from the result: `distinct`, `unpivot`, a `filter` that needs a text scan, and a `filterMulti` with any text-scan condition. Join, append and bind columns run as separate commands. The store lock is held only to clone a frame out (a cheap `Arc` clone), and a poisoned lock is recovered.

### The parity corpus

Every verb in `FRAME_OP_KINDS` and the binary verbs `join`, `append`, `bindColumns` has a fixture file in `fixtures/frame-verbs/<verb>.json`, plus `pipeline.json` ([[D29]] oneVerbCorpus). A file is `{ verb, cases: [{ name, frames, op, expect | expectError }] }`: `frames` maps names to wire frames (`in` for unary verbs, `left`/`right` for join, any names listed in `op.frames` for append and bind columns), `op` is the wire op (for join `{ kind: "join", …JoinOpts }`, for a pipeline `{ kind: "pipeline", ops }`), `expect` is a wire frame and `expectError` an error code. Exactly one of `expect` and `expectError` is present; case names are unique per file.

`frameVerbCorpus.test.ts` runs each case through the oracle (a pipeline applies its ops one after another); `corpus_cases` in `src-tauri/src/engine/tests.rs` deserializes the same files with the production `WireFrame`, `WireOp` and `WireJoinOpts` types and runs them through the engine (a pipeline through `apply_ops`, fused). Comparison is on name, type and values; `-0` compares equal to `0` and error cells compare by code. `ORACLE_ONLY_VERBS` (`["pivot"]`) makes the cargo runner assert that the op still does not parse as a `WireOp`. The completeness test fails if a verb in the inventory lacks a file or a file names a verb outside it; `FRAME_OP_KINDS` is checked against the `FrameOp` union at compile time.

## Rules shared by every verb

- **Structural failures throw.** A verb throws a tagged SolError (missing column `#REF!`, type conflict `#TYPE!`, bad configuration `#VALUE!`, unknown aggregate `#NAME?`); the calling card turns the throw into its output value (`runVerb`, `materialize`, the runners).
- **Row verbs select indices.** Sort, distinct, head and filter compute a list of row indices and rebuild every column from it (`reorderRows`), so a column's type, unit and format ride along.
- **Identity keys.** Distinct, Group By, Window partitions and Join keys encode each cell with `encodeCell`, a type-tagged tuple serialized as JSON: `["n"]` for null, `["b", v]`, `["#", v]` for a finite number, `["#", "nan" | "inf" | "-inf"]` for a non-finite, `["s", text]`, `["e", code]` for an error. So `1` and `"1"` differ, `null` differs from `0` and `""`, two nulls are equal, the three non-finites are three keys, and an error keys by its code. Keys compare case-sensitively ([[C45]] excelComparisons). The engine's `key_json` produces the identical string (integral numbers print without a decimal point, `-0` keys as `0`).
- **Comparisons fold case; keys do not.** String `eq`/`neq` and the text predicates in Filter lowercase both sides with the plain Unicode lowercase (`toLowerCase` / Rust `to_lowercase`) unless `matchCase` is set. String ordering (`lt`, `gt`, sort) never folds.
- **String order.** Every data sort and ordered comparison compares strings by UTF-16 code units (`compareStrings`, JavaScript `<`), which matches Polars' UTF-8 byte order outside the astral planes ([[C59]] byteStringOrder).
- **New names go through `makeHeaders`.** Any verb that combines or invents column names de-duplicates them left to right.

## Verb contracts

### Summary

| Verb | Card | Native | Refuses with |
|---|---|---|---|
| `select` | Columns (Keep) | lazy | `#REF!` unknown column |
| `drop` | Columns (Drop) | lazy | nothing |
| `rename` | Rename | lazy | nothing |
| `sort` | Frame Sort | lazy | `#REF!` |
| `distinct` | Distinct | row scan | `#REF!` |
| `head` | Head (First N) | lazy | nothing |
| `sliceRows` | Head (Last N, Skip first N, Rows M to N) | lazy | nothing |
| `filter` | none emits it | lazy or row scan | `#REF!`, `#TYPE!` |
| `filterMulti` | Frame Filter, Slicer | lazy or row scan | `#REF!`, `#TYPE!` |
| `groupBy` | GROUPBY | lazy | `#REF!`, `#NAME?` |
| `unpivot` | Unpivot | row scan | `#REF!`, `#TYPE!` |
| `pivot` | PIVOTBY, GROUPBY with totals | oracle only, on both platforms | `#REF!`, `#VALUE!` |
| `window` | Window | lazy | `#REF!`, `#VALUE!` (unknown function) |
| `fillBlanks` | Fill Down | lazy | `#REF!` |
| `replaceValues` | Replace Values | lazy | `#REF!` |
| `join` | Join | command | `#REF!`, `#TYPE!`, `#UNIT!`, `#VALUE!` |
| `append` | Append | command | `#TYPE!` |
| `bindColumns` | Bind Columns | command | nothing |

### select

`{ kind: "select", columns }`. Keeps the named columns in the order given. A repeated name keeps its first occurrence only. Any unknown name is `#REF!`. Columns keep their type, unit, format and `raw`. An empty list yields a frame with no columns; the Keep card instead passes its input through when its list is empty.

### drop

`{ kind: "drop", columns }`. Removes the named columns; a name not present is ignored. The remaining columns keep their order and everything they carry. Dropping every column leaves a frame with no columns. `drop` with an empty list is the no-op `passFrame` uses.

### rename

`{ kind: "rename", map }` (old name to new name). Every column's proposed name is `map[name]` or its own name; the whole list then goes through `makeHeaders`, so a collision renames the later column (renaming `a` to `b` in `a, b` gives `b, b2`) and every name is trimmed. A key naming no column does nothing. Column order is unchanged. The Rename card pairs its From and To lists by index and skips a pair with an empty side; with no complete pair it passes through.

### sort

`{ kind: "sort", by, dir: "asc" | "desc" }`. Orders rows by one column. Present values compare within the column's type: numbers and dates numerically, strings by code-unit order, logicals false before true. Blank cells, error cells and `NaN` form a tail that comes last in both directions, in input order. Ties keep input order (the sort is stable in both directions). The engine sorts by a key expression (logical cast to 0/1, `NaN` mapped to null) with a row index as an ascending tiebreak. The Frame Sort card passes through when the column is blank.

### distinct

`{ kind: "distinct", columns? }`. Keeps the first occurrence of each distinct row, in input order, keyed with `encodeCell` over the listed columns or every column. The kept rows are whole rows. An unknown listed column is `#REF!`. Frame Distinct merges error cells with the same code, unlike list UNIQUE ([[C45]] excelComparisons). The card sends no `columns` (whole-row distinct).

### head

`{ kind: "head", n }`. The first `trunc(n)` rows, clamped to `[0, rowCount]`; a negative `n` gives no rows and the schema is kept.

### sliceRows

`{ kind: "sliceRows", mode, n, to? }`. A contiguous window `[start, end)` from `sliceBounds`, with `N = max(0, trunc(n))`:

| Mode | Window |
|---|---|
| `first` | `[0, min(rows, N))` |
| `last` | `[max(0, rows − N), rows)` |
| `skip` | `[min(rows, N), rows)` |
| `range` | `[max(0, trunc(n) − 1), min(rows, trunc(to ?? n)))`, 1-based inclusive rows `n` through `to` |

An inverted window is empty. The Head card sends `head` for First N and `sliceRows` for the other three; it reads `to` only in range mode.

### filter and filterMulti

`{ kind: "filter", column, op, value, matchCase? }` keeps rows whose cell passes one predicate. `{ kind: "filterMulti", combine: "and" | "or", conditions: [{ column, op, value, matchCase? }], complement? }` keeps rows passing every condition (`and`) or any condition (`or`). With no conditions it is the identity under both combines; `complement` then gives the empty frame with the schema kept. With `complement` it keeps exactly the rows the plain filter drops: the row complement, not the negated predicate, so a row whose predicate was unknown lands in the complement. Kept rows stay in input order. An unknown column is `#REF!`, checked for every condition before any row is tested.

A text predicate (`contains`, `startsWith`, `endsWith`) on a column that is not string is `#TYPE!` ([[D49]] textPredicateNeedsText), and the message names the column, its type and the two fixes: a Computed Column such as `TEXT(@<col>, "@")`, or Cast to Text. The List Filter and the *IFS criteria use the list twin, `requireTextList`. One such condition fails the whole filter, under `or` too.

`passesFilter(cell, op, value, type, matchCase)`:

1. The list-cell ops (`listContains`, `listContainsAny`, `listContainsAll`, `listEmpty`) never match a frame cell.
2. `iserror` keeps error cells; `noterror` keeps everything else, blanks included.
3. `isblank` keeps `null` cells; `notblank` keeps everything else (an error cell and `NaN` are present).
4. Otherwise a blank or error cell fails, and a `null` value matches nothing.
5. Text predicates compare the cell text with the value text, both folded unless `matchCase`.
6. On a string column, `eq`/`neq` compare folded text unless `matchCase`; `lt`/`lte`/`gt`/`gte` compare by code-unit order without folding.
7. On a number or date column, the cell is compared numerically with the value parsed from its trimmed text by `Number()`, with no comma stripping; a value that is blank or does not parse to a finite number matches no rows (under `or`, other conditions still can). A date column compares against a serial; date text is not parsed.
8. On a logical column, the cell is 1 or 0 and the value goes through `coerceLogical` (`TRUE`/`FALSE` in any case, or any number, non-zero being true), so `eq 12` matches TRUE rows.

The engine keeps the same keep-set. Comparisons build a Polars expression; text predicates, and string `eq`/`neq` without `matchCase`, run as an in-engine row scan over the string column (`filter_needs_text_scan`). A `NaN` cell is masked out of `gt`/`gte`, which Polars' total float order would otherwise pass. `iserror`/`noterror` have no native meaning, because errors arrive as blanks.

The Frame Filter card: each condition row is a column, an op and a value (`readFilterValue` stringifies a wired scalar, and an error value becomes its code). A wired blank column, or a wired blank value for an op that takes one, makes both outputs blank. A row whose literal column is empty, or whose literal value is empty for an op that takes one, is skipped. With no complete rows, Kept is the input and Dropped is blank. Kept and Dropped are both permanent outputs: `filterMulti` and the same op with `complement: true`. A list-cell op on a frame input is `#SHAPE!`, telling the user to connect a Cube. Any `iserror`/`noterror` condition makes the card collect its input and run `filterRowsMulti` in the oracle on both platforms. A Cube input runs `filterCube` (see Eager verbs).

### groupBy

`{ kind: "groupBy", keys, aggs: [{ column, op, as }] }`. One output row per distinct key tuple (keyed by `encodeCell`), in first-seen order; a null key is its own group, and each non-finite key value is its own group. Output columns are the key columns (type and unit kept, format dropped), each holding the group's first-seen cell, then one column per aggregate named `as`. All output names go through `makeHeaders`, so an aggregate named after a key becomes `k2` and the key keeps its name. An unknown key or aggregate column is `#REF!`.

`aggregateGroup(cells, op)`:

| Op | Result | Empty group | Output type | Unit kept |
|---|---|---|---|---|
| `count` | Count of non-null cells (errors and `NaN` count) | 0 | number | no |
| `sum` | Sum | 0 | number | yes |
| `avg` | Mean | null | number | yes |
| `min`, `max` | Minimum, maximum | null | the source type (a date stays a date; a logical returns TRUE/FALSE) | yes |
| `product` | Product | 1 | number | no |
| `median` | Middle value; an even count averages the middle pair `(lo + hi) / 2` | null | number | yes |
| `mode` | Most frequent value, ties to the first occurrence | null | number | no |
| `stdev`, `var` | Sample (n − 1); null under two points | null | number | no |
| `stdevp`, `varp` | Population (n); 0 for one point | null | number | no |
| `percentof` | null (it needs a total set; only Pivot computes it) | null | number | no |

Every op but `count` reads only numeric cells: logical cells count as 1/0, text cells contribute nothing (so a text column sums to 0 and has a null min). An error cell anywhere in the group makes the result that error (the first in row order). Then the non-finite guard: a `NaN` input makes the group `#DOMAIN!`; a `NaN` result is `#DOMAIN!`; an infinite result from all-finite inputs is `#OVERFLOW!`; an infinite result when an input was infinite passes. Variance is the sequential two-pass form (sum, mean, sum of squared deviations), and the engine uses the same operation order so results match to the last digit. An op name outside the list is `#NAME?` (`Unknown aggregation "<op>"`); the engine checks this before running, the oracle when it first aggregates a group with numeric cells.

The engine groups with `group_by_stable` on derived key expressions (a float key split into its finite value and a non-finite class token) so buckets match `encodeCell`. It cannot store an error cell, so the guard's `#DOMAIN!` and `#OVERFLOW!` results travel as reserved NaN bit patterns that decode to error cells on download.

The GROUPBY card sends one aggregate over its Aggregate column with `as` equal to that column's name. With a totals depth other than 0 it collects its input and runs `pivot` with that column as the only value field and no column fields (the totals re-aggregate the source). A Cube input is flattened with `flatCubeToFrame`. With no keys or no column it passes through.

### unpivot

`{ kind: "unpivot", idColumns, valueColumns, variableName?, valueName? }`. Wide to long: for each input row, in order, one output row per value column, in the listed order. Output columns are the id columns (type and unit kept), a string column named `variableName` (default `variable`) holding the value column's name, and a column named `valueName` (default `value`) holding the cell. All names go through `makeHeaders`. The value column takes the value columns' shared type, and their unit when they all share one. Value columns of different types are `#TYPE!` (`Unpivot value columns must share a type (…)`); an unknown column is `#REF!`. The card passes through when Melt is empty.

### pivot (oracle only)

`{ kind: "pivot", rowFields, colFields, values, funcs, rowTotalDepth?, colTotalDepth?, rowSort?, colSort?, relativeTo?, filter? }`, Excel's PIVOTBY. It runs in the oracle on both platforms (the engine has no pivot op), always eagerly on a collected frame.

**Setup.** Blank field names are dropped. No value fields is `#VALUE!` (`PIVOTBY needs at least one value field`); an unknown field is `#REF!`. `funcs[i]` applies to `values[i]`, falling back to `funcs[0]`, then `sum`. `filter`, when present, keeps only source rows whose mask entry is `true`.

**Axes.** Each axis (rows, columns) has leaf groups: the distinct field tuples among the kept rows. Leaves are ordered hierarchically: each field level ranks its values by first appearance across the whole axis, and tuples sort by those ranks level by level, so each outer group stays contiguous. An axis with no fields has one anonymous leaf.

**Sorting.** `rowSort` and `colSort` are signed 1-based indices into `[fields…, values…]`; negative means descending. A field index re-ranks that level by value (the column type's comparator, blanks and errors last), and descending reverses that level's whole order, which puts blanks first. A value index reorders the leaves by that value's aggregate over the whole axis (a `percentof` scores by sum), `NaN` or error scores last, and only when the axis has more than one leaf; it reorders leaves flatly.

**Totals.** `rowTotalDepth`/`colTotalDepth`: 0 adds nothing, 1 adds a grand total, 2 or more adds subtotals too, and a negative depth places totals before their groups. Totals need at least one field on the axis. Subtotal levels are `min(|depth| − 1, fields − 1)`; for each prefix length p from 1 to that, every contiguous run of leaves sharing a p-field prefix gets a subtotal slot. By default a subtotal follows its run's last leaf, inner levels first, and the grand total comes last; placed at top, a subtotal precedes its run's first leaf, outer levels first, and the grand total comes first.

**Cells.** A cell for value v over a set of row slots and column slots aggregates the source cells of every covered leaf pair with that value's function, so totals re-aggregate the source (a grand average is the average of all source rows). A combination with no source rows is blank. `percentof` is `SUM(cell) / SUM(total set)`, where `relativeTo` picks the total set: 0 the column total, 1 the row total, 2 the grand total, 3 the parent column group (leaves sharing all but the last column field), 4 the parent row group. A zero denominator is blank; an error cell propagates.

**Output.** One key column per row field (names through `makeHeaders`), then one body column per column slot and value. Key cells: a leaf shows its tuple; a subtotal shows its prefix, `Total` in the next field, and blanks after; the grand row shows `Grand Total` in the first key column. A key column that receives a `Total` or `Grand Total` marker becomes a string column, its other cells formatted as display text (`formatFrameCell`: dates as `DD-MMM-YYYY`, logicals as `TRUE`/`FALSE`). A body header is the column tuple's values, each through `String()` (a date shows its serial, a blank shows `null`), joined with ` | ` (`Grand Total` for the grand slot, the prefix plus `Total` for a subtotal), followed by ` | <value name>` when there is more than one value; with no column fields and one value it is the value's name. Body headers go through `makeHeaders`. Body columns are number typed and carry the value column's unit for sum, avg, min, max and median.

The PIVOTBY card forwards its input unchanged when it has no value fields, and drops field references to columns the input no longer has. Its per-field value exclusions (keys formed by `pivotCellKey`: blank as `""`, an error as its code, a logical as `TRUE`/`FALSE`, anything else `String()`) are combined with the wired logical mask into `filter`. With a lazy input it reads the schema through a zero-row preview and fetches only the columns the pivot and the filter editor use.

### window

`{ kind: "window", partitionBy, orderBy?, orderDir?, fn, column?, as, n? }`. Adds one column computed per partition and writes it back in the original row order; every other column is unchanged. Partitions are distinct `partitionBy` tuples by `encodeCell` (empty means the whole frame). Within a partition, rows are ordered by `orderBy` (blank, NaN and error keys last, stable, `desc` reversing present keys; a NaN key ranks blank, as Sort reads it) or kept in input order. `N = max(1, round(n ?? 1))`. An unknown partition, order or value column is `#REF!`. An existing column named `as` (or `fn` when `as` is blank) is removed and the new one appended last.

Values: the arithmetic functions read a numeric view of `column`: a number is present (an infinity included), a logical is 1 or 0, and NaN or text counts as blank; `lag`, `lead`, `first` and `last` read the raw cells. An error anywhere in the partition's value column makes every row's result that error for the cumulative, difference, rolling, group, share, first and last functions.

| Function | Result per row (p is the 1-based position in the ordered partition, m its size) |
|---|---|
| `row_number`, `cumcount` | p |
| `rank` | Competition rank on the order key (ties share the first tied position); p without an order column; blank key gives blank |
| `dense_rank` | Rank counting distinct keys; p without an order column; blank key gives blank |
| `percent_rank` | `(rank − 1) / (ranked − 1)`, `ranked` being the rows with a present key; 0 when `ranked ≤ 1` |
| `ntile` | `floor((p − 1) × N / m) + 1` |
| `cumsum`, `cumavg`, `cummin`, `cummax` | Over the present values up to this row; blank when this row's value is blank |
| `lag`, `lead` | The value N rows before or after, raw (a blank included); blank past the edge |
| `diff` | This value minus the previous row's; blank when either is blank |
| `pct_change` | `(cur − prev) / prev`; blank when either is blank (checked first); `#DIV/0!` when prev is 0 |
| `rolling_sum`, `rolling_avg`, `rolling_min`, `rolling_max` | Over the present values among the last N rows; blank until p ≥ N and when this row's value is blank |
| `group_sum`, `group_avg`, `group_min`, `group_max` | The partition aggregate on every row; blank when the partition has no present value |
| `group_count` | Count of present values (0 when none) |
| `share` | This value over the partition's sum; blank when this value is blank (checked first, so an all-blank partition is all blank); `#DIV/0!` when the sum is 0 |
| `first`, `last` | The partition's first or last value in order, on every row |

Output type: `lag`, `lead`, `first` and `last` take the value column's type; everything else is number. The unit is kept for the cumulative, lag, lead, diff, rolling, group sum/avg/min/max, first and last functions. The engine evaluates each function with Polars `.over()` after sorting by the order key with a row-index tiebreak, then sorts back by the index; its two `#DIV/0!` cells travel as a reserved NaN payload. An unknown function name is `#VALUE!` on both engines.

The Window card always sends `orderDir: "asc"`, derives `as` from the function label and Value column when the name is blank, sends `n` only for the functions that read it, and passes through when a value-reading function has no Value column. A Cube input stays a Cube: `windowCube` (below) appends the column, and the output socket adopts the input's rank.

### fillBlanks

`{ kind: "fillBlanks", columns, dir: "down" | "up" }`. In each listed column (every column when the list is empty), a `null` cell takes the nearest present value above (`down`) or below (`up`); a leading (or trailing) run stays blank. Error cells are values: they neither fill nor get filled. An unknown column is `#REF!`.

### replaceValues

`{ kind: "replaceValues", column, find, replaceWith, mode: "cell" | "substring" }`. Targets one column, or every column when `column` is blank. An empty `find` is the identity. An unknown column is `#REF!`. Matching is case-sensitive except for logicals.

- `substring`: in string columns only, every literal occurrence of `find` inside a text cell is replaced (no regex).
- `cell`: a whole cell matches when a number (or date serial) equals `Number(find.trim())` (a non-numeric find matches no number), a logical's `TRUE`/`FALSE` equals `find` in upper case, or a string equals `find` exactly. Blank and error cells never match. The replacement is coerced to the column type: blank text becomes `null`; a number or date column needs a finite number, and otherwise that column is left unchanged; a logical takes `true`/`1` or `false`/`0` (any case), anything else `null`; a string column takes the text verbatim.

The card's Find and Replace take a wired value of any type, stringified by `readFilterValue`.

### join

`joinFrames(left, right, { leftKey, rightKey, how, asofDirection?, asofTolerance?, rightKeyScale?, rightKeyOffset? })`. The key columns must exist (`#REF!`) and share a type (`#TYPE!`, `Join keys must share a type ("<l>" vs "<r>")`); a Cross join needs neither.

Keys with units compare as quantities ([[C25]] firstClassUnits): `5 km` matches `5000 m`. When both key columns carry a unit and the units differ, `joinKeyTransform` reads the right key in the left key's unit as `right × scale + offset` (the offset is for temperatures). Keys that measure different things, or two different currencies, are `#UNIT!` (`Join keys measure different things (<l> and <r>). Convert one key first`). A unit on only one side converts nothing. Explicit `rightKeyScale`/`rightKeyOffset` override the derived transform; the native engine never sees units, so `PolarsBackend.join` derives the transform from its schema shadows and always sends it.

Matching: key cells match by `encodeCell` identity, case-sensitive. A `null`, error or non-finite key never matches anything, including another of its kind; such rows still flow through the outer sides. Units on key columns are not consulted.

Output layout for the equality and as-of joins: every left column, then every right column except the right key, names through `makeHeaders` (a colliding right column becomes `name2`). The key appears once, under the left key's name, filled from whichever side has the row. Unmatched cells are `null`. Every column keeps its unit and format; the key keeps the left key's.

| `how` | Rows |
|---|---|
| `inner` | For each left row in order, one row per matching right row in right order (fan-out). |
| `left` | As inner, plus each unmatched left row once, in place. |
| `right` | For each right row in order, one row per matching left row in left order, or the right row alone. |
| `outer` | The left join's rows, then each right row that matched no left row, in right order. |
| `semi` | Left rows with a match, in order, no fan-out, left columns only. |
| `anti` | Left rows without a match (null and non-finite keys included), in order, left columns only. |
| `asof` | Every left row once, in order, paired with at most one right row (no fan-out). |
| `cross` | Every left row with every right row, left-major; all columns of both sides, names through `makeHeaders`; no keys. An empty side gives no rows and the full header. |

As-of: both keys must be number or date (`#VALUE!`, `As-of join requires a numeric or date key`). Right rows with a finite key are sorted ascending (ties by row order). `backward` (the default) takes the last right key ≤ the left key; `forward` the first right key ≥ it; `nearest` whichever is closer, with a tie going backward. An exact key tie matches. When `asofTolerance` is set, a pick farther than it is no match. A left row with a blank or non-finite key has no match.

The engine joins on masked temporary key columns (non-finite masked to null), adds a row index to each side and sorts the result into the oracle's order, builds `outer` as a left join followed by an anti-join tail, and runs as-of as a hand-written binary search that mirrors the oracle. An unknown `how` is `#VALUE!` on both engines.

The Join card: a blank Right key reuses the Left key; a blank Left key yields nothing unless the join is Cross; Tolerance is read only for as-of, and a wired blank there (or a wired blank key) makes the output blank.

### append

`appendFrames(frames)`. Stacks frames in order, matching columns by name. The output columns are the union of names in first-seen order; a frame lacking a column contributes blanks for its rows. A name with different types in two frames is `#TYPE!` (`append: column "<n>" is <t1> in one frame and <t2> in another`); nothing is coerced. Columns carry name, type and values only. The card stacks its wired rows in row order and passes a single frame through.

### bindColumns

`bindColumns(frames)`. Places every column of every frame side by side in order, names through `makeHeaders`; the row count is the longest frame's, and shorter frames pad with blanks. A frame with no columns contributes nothing. Columns carry name, type and values only. The card passes a single frame through.

## Eager verbs outside the seam

These run only in the oracle, on the collected value, on both platforms. They have no `FrameOp` and no corpus file.

| Verb | Function | Contract |
|---|---|---|
| Cube column verbs | `selectCubeColumns`, `windowCube` | The Columns and Window cards on a Cube input. `selectCubeColumns` keeps the listed columns in the listed order (a missing name is `#REF!`) or drops the listed ones (missing names ignored). `windowCube` reads only the partition, order and value columns (each through the scalar reading below, so a list or table cell in one of them is `#SHAPE!`), runs `windowFrame` over them, and appends the result as a cube column, replacing one of the same name. Every other column, nested cells included, rides through, so a vault table (whose `tags`, `links` and `embeds` are lists) runs a rolling average and trims to flat columns for a chart. |
| Cube row verbs | `sortCube`, `distinctCube`, `sliceCube`, `filterCube` | The row verbs on a Cube input. Row order comes from the same index functions the frame verbs use, computed over a scalar reading of the needed column (`inferColumn`; a list or table cell in it is `#SHAPE!`); every column, nested cells included, rides along by reference. Distinct keys every column, nested cells encoded structurally. `filterCube` adds the list-cell ops: a non-list cell counts as a one-item list and a blank as empty; membership folds case unless `matchCase`; any and all split the value on commas. |
| Nest | `nestFrame` | One Cube row per distinct key tuple (first-seen), the other columns nested as a sub-frame cell per group (default name `items`). |
| Unnest | `unnestCube` | Peels one level of a nested column: frame cells flatten to a Frame, cube cells to a shallower Cube, and a list column explodes to one row per item under the same name. A mix of lists, frames and cubes is `#TYPE!`. A row with an empty table is dropped; a row with an empty list keeps a blank. Flat columns are re-inferred. |
| Split Column, Add Index, Merge Columns, Headers, Drop Blank Rows | `splitColumn`, `addIndexColumn`, `mergeColumns`, `promoteHeaders`, `demoteHeaders`, `dropBlankRows` | The Power Query column and row tidies; each documents its rules at its function. |
| XLOOKUP over a table | `lookupRowIndex`, `lookupCell` | Delegates the match to the formula surface's `xmatchIndex`, so the card and XLOOKUP cannot drift; a string key matches case-insensitively. |

Reconcile, Describe, Correlation Matrix, Decision Matrix and Allocator also live in `frameVerbs.ts`; their contracts belong to their nodes.
