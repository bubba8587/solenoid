---
aliases: ["Frame model and relational verbs"]
tags: [spec, computation]
---
<!-- [[C16]] polarsEngine, [[D29]] oneVerbCorpus, [[C24]] arraySemantics, [[C45]] excelComparisons, [[C59]] byteStringOrder, [[D76]] textMinMax, [[D48]] classifyNonFinite, [[D49]] textPredicateNeedsText, [[E2]] cubeNeverNarrowsToFrame, [[D11]] noAutoCross, [[C25]] firstClassUnits, [[C64]] decisionMatrixFamily, [[C8]] declareOnce, [[D46]] freezeVolatilePerCalc -->

# Spec: Frame model and relational verbs

Serves [[C16]] polarsEngine, [[D29]] oneVerbCorpus, [[C24]] arraySemantics (and its children [[D36]] nullSkippedNotZero, [[D37]] errorBeatsMissing, [[D48]] classifyNonFinite, [[D49]] textPredicateNeedsText, [[D76]] textMinMax), [[C45]] excelComparisons, [[C59]] byteStringOrder and [[E2]] cubeNeverNarrowsToFrame. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

A Frame is Solenoid's table: named, typed columns of cells. The relational verbs (select, sort, filter, group, join and the rest) take Frames and return new ones. They run on two engines behind one seam: a pure JavaScript implementation on the web, called the oracle because it is the one definition every engine must match, and native Polars on desktop. A shared corpus of cases holds the two to identical answers. A Cube is the Frame's nested sibling, whose cells may hold lists and whole tables.

| File | Holds |
|---|---|
| `src/graph/frame.ts` | The Frame and Cube values, builders, type inference, Nest Join |
| `src/graph/frameVerbs.ts` | The verbs (the oracle), the eager table tools and the analysis verbs |
| `src/graph/frameBackend.ts` | The seam, lazy refs, materialization, sketch mode |
| `src/graph/nodes/frame.ts` | The verb cards |
| `src-tauri/src/engine.rs` | The native Polars engine |
| `fixtures/frame-verbs/` | The shared parity corpus |

Computed columns (Frame Input's Fx column and the Computed Column node, `computedColumnCore.ts`) have their own spec, [[computed-columns]]. Static schema prediction lives in `frameShape.ts`, whose `shapeOf(op, input)` must report exactly the columns a real `preview()` would.

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

Column lookup is exact and case-sensitive everywhere a verb needs a column (`requireColumn`); a missing name is `#REF!` with the message `column "<name>" not found`. The looser `getColumn` (used by Get Column and the `column` backend call) trims the name, matches exactly, and otherwise accepts a bare integer string as a 1-based column index. The engine's `engine_column` follows the same rule.

`addColumn(f, name, values, type = "number")` appends a column, or replaces the column already holding that name in place. A `Name (unit)` suffix is split off first and tags a number column with the unit; an appended name is de-duplicated with `makeHeaders`, and a replaced column drops its `raw`.

### Building a Frame

| Builder | Input | Rule |
|---|---|---|
| `buildFrame(matrix, names?)` | A numeric row-major matrix | Every column is number; a missing cell is `null`; `Name (unit)` headers lock units. The column count comes from the matrix alone. |
| `frameFromInput(headers, matrix)` | The same, from a card with a header list | The column count is the larger of the header count and the widest row, so named but empty columns survive a short or empty body. |
| `buildFrameTyped(matrix, names?, colType?)` | A matrix of any cells | Each column through `typedColumn`; `colType` (the matrix's element family) applies to every column, and null means infer per column. |
| `frameFromCells(headers, rows)` | CSV rows | Each column through `inferColumn`; the width is the larger of the header and the widest row. |
| `frameFromRecords(records)` | JSON array of objects | Columns are the union of keys in first-seen order. |
| `frameFromRows(rows, headers?)` | JSON array of arrays | Positional columns. |
| `frameFromColumnar(obj)` | `{ col: [values] }` | A scalar value becomes a one-row column. |

`colTypeForSocket(dataType)` turns a socket's element family into a column type: number, string, date or logical, and null for a wildcard rung or `complex`, where the caller falls back to inference.

Going the other way, `splitFrame(f)` returns `{ matrix, headers }`. The headers are always every column name. The matrix is null when any column is a string column (a date column does not block it, since its cells are serials); otherwise a logical cell is 1 or 0 and any other non-number is `NaN`.

For display, `formatFrameCell(type, v, format?)` shows an error as its code, a logical as `TRUE`/`FALSE`, and a finite date serial through the format annotation's date pattern or the default `DD-MMM-YYYY`; anything else is returned as is. `frameToGrid` builds the popup's row-major grid: a blank is `""`, a logical is `TRUE`/`FALSE`, and an error cell passes through.

### Type inference

There are four entry paths, and they do not infer the same way.

| Path | Used by | Rule |
|---|---|---|
| `inferColumn(name, cells)` | CSV import (`frameFromCells`), JSON records, arrays and columnar objects, cube-to-frame reads, Unnest | A cell is blank when it is `null`, `undefined` or whitespace text. If every non-blank cell is a JS boolean, the column is logical. Else if every one reads as a number, number. Else if every one is the text `TRUE` or `FALSE` (any case), logical. Else if every one is an unambiguous ISO date, date (cells become serials). Else string, with each cell trimmed. An all-blank column is string. `raw` keeps each cell's trimmed text. |
| `typedColumn(name, cells, length, knownType)` | Build Frame from a matrix or lists, flat cube to frame | A known type from the socket wins; it is the only way to recover date. Without one, inference goes by runtime type and preserves it: all numbers is number, all booleans is logical, anything else is string (the string `"1"` stays text). Cells are then coerced to the column type: a string column stringifies, a logical column reads a non-boolean as true only for the text `true`, and a number or date cell that cannot become a number is `NaN`. Errors and blanks pass through. |
| `coerceFrameCell(type, raw)` via `deriveFrame` | Frame Input (the column type is stored, never inferred) | Blank text is `null`. A string column keeps the text verbatim. A logical column goes through `coerceLogical`. A number column parses the trimmed text or is `NaN`. A date column tries a number, then `parseDate`; a parse error (such as `#AMBIGUOUS!`) is kept as that error cell, and a non-finite result is `NaN`. |
| `inferColType` inside `parseFrameSource` | A hand-typed or CSV-shaped `frameText` | Type only, cells kept raw: number, then logical, then ISO date, then string, over trimmed non-blank cells. |

"Reads as a number" (`cellToNumber`) accepts a finite number, a boolean (as 1 or 0), a `UnitCell` (its display magnitude), or trimmed text that `Number()` parses to a finite value. Commas are stripped only when they sit in genuine thousands positions (`^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$`), so the European `3,5` stays text instead of reading as 35. A column whose non-blank cells are all JS booleans infers logical before the number test runs; a mix of booleans and numbers reads as number with 1/0 cells. A 0/1 column stays number, because inference reads only the literals `TRUE`/`FALSE` as logical.

`inferColumn` also recovers units. When any cell is a `UnitCell` (a Cube column read back), `matrixCellsFromList` unwraps the cells to their display magnitudes before inference and returns the one unit they share, which tags the resulting number column; cells that disagree give no unit. So a Frame to Cube to Frame round trip keeps its units.

Inference is deliberately conservative, and `coerceLogical` (`valueKinds.ts`) is the liberal reading for the explicit paths (Cast to Boolean, Get Column's read-as Logical, a Frame Input logical column, a filter value). It reads a boolean as itself; a finite number as true when non-zero; the text `true` or `false` in any case, or text that parses to a finite number; and anything else as null, meaning not readable as a logical, which each caller interprets.

An unambiguous ISO date is `YYYY-MM-DD` with an optional ` ` or `T` time `hh:mm[:ss[.f]]` and an optional `Z` or `±hh[:]mm` zone, and it must parse to a finite serial. Bare years and slash dates such as `1/2/26` never infer as dates; Get Column's read-as converts those explicitly.

### Native file readers

Both readers are desktop only and read `folder/name`, joined the same way the CSV Connection node's `readFileText` joins them, so both file sources share one target-folder setting.

- **CSV** (`engine_read_csv`, called through `readCsvFrame`). Polars reads the file with a header row and types the columns itself, mapped by kind: Boolean is logical, String is string, and every numeric dtype is number. Then `infer_iso_date_columns` applies the ISO gate above to the remaining string columns: a column becomes date only when every non-blank cell parses and at least one does, so an all-blank column stays text and one non-conforming cell keeps the whole column text. Zone-less text reads as UTC wall-clock (the same calendar date on every machine, as `parseDateToSerial` reads it); an explicit zone is an absolute instant, so `02:00+02:00` is midnight UTC. Where the two parsers could differ, the native one is the stricter: it rejects hour 24 and a fraction without seconds. The result comes back collected, as typed columns, so the file text never crosses IPC.
- **Parquet** (`engine_read_parquet`, the Parquet Connection node). The frame goes straight into the engine store and the command returns a handle; it never passes through JS. Columns keep the file's own types, narrowed to the engine's three: Boolean is logical, String is string, `Date` becomes a serial (Unix days plus 25569, since serial 1 is 1900-01-01 and the Unix epoch is serial 25569), `Datetime` becomes a fractional serial by its time unit, and every other physical type is cast to a float number column.

### Frame Input's source

Frame Input is the editable literal table. Its stored text is never rewritten; the typed Frame flowing downstream is derived from it at compute time.

- `FrameSource` is a list of `{ name, type, cells, unit?, expr? }`: `cells` are the raw typed strings, never coerced; `unit` is a Format Controller unit id; `expr` makes the column computed ([[computed-columns]]), and its raw cells are then ignored.
- `deriveFrame(source)` coerces every cell through `coerceFrameCell` and keeps the raw strings as `raw`, so a read-only viewer still shows the literal source. A `unit` applies only to a number column, through `columnUnitFromSpec`.
- `frameText` is stored as JSON: `[{ name, type, cells, unit?, expr? }]` (`frameSourceToText`; `unit` and `expr` only when set). `parseFrameSource` reads it back, running the names through `makeHeaders`; an unrecognized `type` reads as number, and a blank `expr` is dropped. It also reads a typed-`values` JSON (the form `frameColumnsToInputText` writes for a caller holding a typed Frame), stringifying the values back to raw cells with booleans as `TRUE`/`FALSE`. Anything else, malformed JSON included, goes to the CSV reader, where each cell is trimmed and `inferColType` picks the type. `frameFromInputText` is `deriveFrame` of `parseFrameSource`.

### Nulls, errors and non-finite numbers

`null` is an empty cell. It is skipped by aggregates, dropped by comparisons, sorted last, and is its own key in grouping and dedupe ([[D36]] nullSkippedNotZero). A `SolError` in a cell is a present value: it is not blank, it propagates through aggregates, sorts last, and keys by its code ([[D37]] errorBeatsMissing). `±Infinity` is a real value in a number column. `NaN` is present but dirty: it is counted, it is not blank, it sorts into the tail, it fails every predicate except `neq`, and it poisons an aggregate to `#DOMAIN!`.

### Units and formats

A number column is locked to a unit by a `Name (unit)` header at build time (`buildFrame`, `buildFrameTyped`, `addColumn`: the parenthetical is stripped from the name before de-duplication) or by a Frame Input column's `unit` field. Crossing into a Cube, a locked column's cells become per-cell base-SI `UnitCell`s (`cubeCellsFromColumn`, the one bridge); reading a cube column back through `inferColumn` recovers a uniform unit.

The `format` annotation is stamped on a node's FrameValue outputs by the input-coercion wrapper from `frameFormatStore`, per node and column; a nearer pick overrides a farther one. Picks are keyed `<nodeId>::<columnName>`, so a pick survives a column reorder but stays with the name, and the annotation's own `unit` field is ignored, since a column's unit belongs to its value. The store's `load` replaces the whole set, and its caller has already rewritten node ids after an id remap. The table popup's column-format row and its inherit hint are [[format-model]]. Unit and format behavior per verb is listed under each verb; unit rules themselves belong to [[unit-flow]].

### Frames and Cubes

A Cube never enters a Frame socket ([[E2]] cubeNeverNarrowsToFrame). A verb card that accepts a Cube declares a cube-adoptive input with `noWidenInputs` and either runs its own cube branch (the cube row verbs under Eager verbs outside the seam) or calls `flatCubeToFrame(cube, only?)`, which types each column through `typedColumn` with the cube column's carried type and reads a column of `UnitCell`s in their shared unit, which the column then carries (`matrixCellsFromList`, as `inferColumn` does); cells that disagree read as bare base-SI values with no unit. `only` picks the columns: all of them, the named ones (`#REF!` for a missing name), or `"scalar"` (every column without nested cells). A list, Frame or Cube cell in a picked column is `#SHAPE!` (`Column "<name>" holds nested cells; this reads flat rows`). GROUPBY picks its keys and value column (its scalar columns while unconfigured); PIVOTBY, SUMIFS and Chart read `"scalar"`, so a list column is simply not a field. `frameToCube` goes the other way: depth 1, element type and format carried, locked cells tagged.

### The Cube value

A Cube is a `CubeValue`: `{ __cube: true, columns: CubeColumn[], depth }`, recognized by its `__cube` brand (`isCubeValue`). A cell (`CubeCell`) is any value, recursively: a Frame cell, a whole Frame, a Cube, a `UnitCell`, or a list of cells. A Cube is heterogeneous per cell ([[D43]] unitByGranularity), so a dimensioned cell carries its unit as a value, a base-SI `UnitCell`.

A `CubeColumn` is `{ name, cells, type?, format? }`. `type` is the element type carried over from a source Frame column, so a flat Cube still renders dates and logicals; it is a display hint, not a promise that every cell matches. `format` is the Cube counterpart of `FrameColumn.format`: a producing verb can stamp a date pattern on a column (a Minutes-mode Schedule stamps `DD-MMM-YYYY HH:mm` on Start and Finish).

- **Depth.** `depth` is cached at construction, bottom-up, so it never needs a re-walk: a Cube's depth is 1 plus the deepest Cube found in any of its cells. A Cube cell contributes its own cached depth, a list cell contributes the deepest of its items, and everything else, a nested Frame included, contributes nothing. So a flat Cube is depth 1 and a Cube of Cubes is depth 2. `makeCube` is the only constructor, so every Cube carries its depth.
- **Rows.** The row count is the longest column (`cubeRowCount`).
- **Constructors.** `cubeFromColumns(cols)` names the columns through `makeHeaders` and keeps each `type` and `format`. `cubeFromRows(rows, headers?)` builds from a row-major grid, padding short rows with `null`. `toCube(v)` widens any value, mirroring the Frame widening in `coerceInputs`: a Cube passes, a Frame goes through `frameToCube`, a 2-D array is a grid, a 1-D list is one row, and a scalar is 1×1. `cubeColumnFromValue(v)` reads one wired value as a Build Cube column: a list gives its elements, a single-column Cube gives that column's cells (so a cell-wise Build Cube pipes straight in), a Frame, matrix or scalar is one cell holding it, and `null` is no cells.
- **Row subsets.** `selectCubeRows(cube, indices)` keeps whole rows by index, with nested cells carried by reference, so the Cube row verbs reorder rows without Polars ever seeing a nested cell. An index past the end gives a blank row.

**Records to a Cube.** `recordsToCube(records, picks?)` is the rows-of-objects reader that frontmatter and the vault readers share. Columns are the keys in first-appearance order, named through `makeHeaders`. A list value becomes a list cell (never joined into text); a list whose present items are all objects becomes a nested Cube, a `null` beside the objects counting as an empty record; a single object becomes a one-row nested Cube. A column of scalars takes the user's pick from `picks` (the Solenoid Properties plugin's `columnTypes`) over inference, and a picked column's cells cross the type's own value boundary, `coerceFrameCell`, as a Frame Input cell would: what the type cannot read becomes `NaN`, never a silent blank ([[D72]]). An unpicked scalar column keeps its cells as they came and takes `inferColumn`'s type as its hint.

### Nest Join

`relateFramesToCube(parent, child, key, nestedName)` relates two tables on a shared key column into a Cube: every parent column, then one nested column (default name `items`, names through `makeHeaders`) whose cell on each parent row holds the child rows with a matching key. It returns `null` when either side lacks the key column. The parent's columns cross through `cubeCellsFromColumn`, so their units are tagged.

- A Frame child's matching rows form a sub-frame that keeps each column's type, unit, format and `raw`; a Cube child's matching rows form a sub-cube (`selectCubeRows`), keeping its own nesting.
- Keys compare as quantities: a logical keys as 1 or 0, a `UnitCell` keys by its dimension and base-SI magnitude (so `5 km` matches `5000 m` but not `5 kg` or a bare `5`), a currency keys by its display code as well (no exchange rates, so $5 ≠ 5€), and a dimensionless ratio keys as its bare magnitude. A number in a unit-locked column is converted to its base-SI quantity first, so it matches a `UnitCell` of the same quantity.
- A blank or error key never matches, as in Join, and a nested Frame, Cube or list cell is never a key.

`relateCubeToFrame(parent, child, key, nestedName)` deepens a chain by one level per call. It finds the first parent column holding a Frame or Cube cell (the first, so a hand-built Cube with several is deterministic) and relates inside each cell, recursing through nested Cubes; with no such column it returns the parent unchanged.

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

In the sketch calculation mode, a flush first asks the backend for a deterministic sample of the plan's base handle (`SKETCH_SAMPLE_ROWS = 10,000`; evenly strided rows `floor(i × total / n)`, order kept, never random). The factor is `total / sampled`. When the plan contains a `groupBy`, the output columns of the last `groupBy`'s `sum` and `count` aggregates are multiplied by the factor at read time, and the collected value carries `__approx`. Scaling is never written into backend data, because a re-upload carries only plain columns and would lose the `__approx` mark. The sampled handle is temporary and dropped once the plan has run.

The aggregate guard classifies non-finite aggregate results at read time ([[D48]] classifyNonFinite). For a handle produced by a plan with a `groupBy`, any aggregate output column holding a non-finite number is passed through `guardFinite`, with an infinite input assumed when the source column on the base handle contains `±Infinity`. The guard's record is keyed to the unsampled base handle, so the source scan survives the sample's drop. A tail rebased onto a flushed prefix that held the `groupBy` inherits the prefix's guard and sketch records, so a card downstream of GROUPBY classifies and scales exactly as the GROUPBY card does. On the JS backend the oracle has already classified every aggregate, so the guard is a no-op there. `clearCollectMemo` and `dropFrameRef` drop these records with their handles.

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

Handles are `jsf:<n>`. Each method calls the oracle (`applyVerb`, `joinFrames`, `appendFrames`, `bindColumns`, `sampleFrame`) and registers the result. A sourced frame is held through a `WeakRef` so the finalization drop can fire; a derived frame is held strongly until its owner drops it. `collect` returns the stored object itself, and `preview` is `framePreview`, the shape the native engine also returns (a row reads `null` past a short column's end, and the schema carries each column's unit and format).

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

Cells cross as JSON. Upload direction (`encodeWireCell`): a finite number, string, boolean or `null` as is; a non-finite number as `{"__nf": "inf" | "-inf" | "nan"}`; a SolError as `{"__err": code}`. Only name, type and values cross: `unit`, `format` and `raw` are not sent and do not come back. The Polars backend puts `unit` and `format` back itself: each handle keeps a row-less copy of its frame's columns, every verb that makes a new handle is run over those copies with the same JS verbs, and a collected, previewed or read column takes the unit and format of the copy with the same name and type. So a unit survives exactly the verbs it survives on the web. `raw` is not restored. The one place a unit changes values is readings on an offset scale, so before sending, `lowerForEngine` (`frameBackend.ts`) runs each op against the copy it will meet and writes the column's `readingScale` onto every groupBy aggregate and window over readings (`withReadingScales`). The engine coerces each cell by the declared column type (`json_to_cell`):

| Column type | Accepts | Everything else |
|---|---|---|
| logical | a boolean; a number (non-zero is true); text `true`/`false`/`1`/`0` after trim, any case | `null` |
| string | text | `null` |
| number, date | a number; a boolean as 1/0; text parsed after trimming and removing every comma; the `__nf` sentinel | `null`, including `{"__err": …}` |

Download direction (`num_to_json`): an integral number within the safe range as a JSON integer, other finite numbers at shortest round-trip precision, `±Infinity` and a canonical `NaN` as the `__nf` sentinel, and the engine's four reserved NaN payloads as `{"__err": "#DOMAIN!" | "#OVERFLOW!" | "#DIV/0!" | "#UNIT!"}`. The JS side decodes both sentinels back (`decodeWireCell`). A failed command rejects with `{ __solError: true, code, message }` (`IpcError` in `ipc.rs`), the same shape as the web side's tagged `SolError`, so a failure crossing IPC arrives as a value the app already renders and IFERROR can catch. `toSolError` accepts only canonical codes and maps anything else to `#ERROR!`. An unexpected engine failure is `#ERROR!` (`IpcError::internal`). `engine_ping` returns `{ name: "solenoid-engine", version, backend: "polars" }`. `engine_drop` is fire-and-forget: its failure is ignored.

What this means for a frame computed natively: a per-cell error in an input becomes a blank for every native verb (so `isblank` selects it and Distinct merges it with blanks), and a column's unit, format and source text are gone after any native verb. The error-predicate filter is routed to the oracle for this reason (see Filter).

### Native execution and fusion

`engine_apply_many` threads one Polars `LazyFrame` plus the tracked names and Solenoid types through the whole plan (`apply_step`) and collects once. Polars dtypes cannot tell number from date, so each stored frame keeps a `SolType` per column and every step computes its output types by the oracle's rules. The steps that build lazily are `select`, `drop`, `rename`, `sort`, `head`, `sliceRows`, `groupBy`, `window`, `fillBlanks`, `replaceValues`, a comparison `filter`, and a `filterMulti` whose conditions are all comparisons. The steps that need a row scan collect their own input, run a hand-written verb and resume lazily from the result: `distinct`, `unpivot`, a `filter` that needs a text scan, and a `filterMulti` with any text-scan condition. Join, append and bind columns run as separate commands. The store lock is held only to clone a frame out (a cheap `Arc` clone), and a poisoned lock is recovered. The engine has no pivot op: PIVOTBY's totals, sorts and percent-of are richer than the engine's op set, so the pivot runs in the oracle on both platforms (see pivot).

The engine cannot store an error cell, so it carries three error verdicts as reserved quiet-NaN bit patterns: `#DOMAIN!` (`0x7ff8_0000_0000_0d01`), `#OVERFLOW!` (`…0f02`) and `#DIV/0!` (`…0d03`). A genuine data NaN is always the canonical `0x7ff8000000000000`, so the payloads cannot collide with real values. Inside the engine a marked cell behaves exactly like NaN, which is how the oracle's error cells behave where it matters (sort tails them, comparisons drop them, keys mask them), and `num_to_json` turns the exact bits into `{"__err": code}` on download. Arithmetic on a marked cell turns it back into a plain NaN, which at worst re-guards to `#DOMAIN!` at the next aggregation where the oracle would propagate the original code; this approximation affects only chains of aggregates.

### The parity corpus

Every verb in `FRAME_OP_KINDS` and the binary verbs `join`, `append`, `bindColumns` has a fixture file in `fixtures/frame-verbs/<verb>.json`, plus `pipeline.json` ([[D29]] oneVerbCorpus). A file is `{ verb, cases: [{ name, frames, op, expect | expectError }] }`: `frames` maps names to wire frames (`in` for unary verbs, `left`/`right` for join, any names listed in `op.frames` for append and bind columns), `op` is the wire op (for join `{ kind: "join", …JoinOpts }`, for a pipeline `{ kind: "pipeline", ops }`), `expect` is a wire frame and `expectError` an error code. Exactly one of `expect` and `expectError` is present; case names are unique per file.

`scripts/fuzz-frame-verbs.ts` writes random cases for every unary verb, pipelines, join (cross included), append and bind columns as `fuzz-*.json` files with the oracle's answers; `cargo test corpus_cases` then hunts divergences, and a find is kept as a hand-named case. `frameVerbCorpus.test.ts` runs each case through the oracle (a pipeline applies its ops one after another); `corpus_cases` in `src-tauri/src/engine/tests.rs` deserializes the same files with the production `WireFrame`, `WireOp` and `WireJoinOpts` types and runs them through the engine (a pipeline through `apply_ops`, fused). Comparison is on name, type and values; `-0` compares equal to `0` and error cells compare by code. `ORACLE_ONLY_VERBS` (`["pivot"]`) makes the cargo runner assert that the op still does not parse as a `WireOp`. The completeness test fails if a verb in the inventory lacks a file or a file names a verb outside it; `FRAME_OP_KINDS` is checked against the `FrameOp` union at compile time.

## Rules shared by every verb

- **Structural failures throw.** A verb throws a tagged SolError (missing column `#REF!`, type conflict `#TYPE!`, bad configuration `#VALUE!`, unknown aggregate `#NAME?`); the calling card turns the throw into its output value (`runVerb`, `materialize`, the runners).
- **Row verbs select indices.** Sort, distinct, head and filter compute a list of row indices and rebuild every column from it (`reorderRows`), so a column's type, unit and format ride along.
- **Identity keys.** Distinct, GROUPBY, Window partitions and Join keys encode each cell with `encodeCell`, a type-tagged tuple serialized as JSON: `["n"]` for null, `["b", v]`, `["#", v]` for a finite number, `["#", "nan" | "inf" | "-inf"]` for a non-finite, `["s", text]`, `["e", code]` for an error. So `1` and `"1"` differ, `null` differs from `0` and `""`, two nulls are equal, the three non-finites are three keys, and an error keys by its code. The non-finites need their named tokens because `JSON.stringify` writes all three as `null`; the tokens sit under the `#` tag, so a string cell spelling `inf` cannot collide. Keys compare case-sensitively ([[C45]] excelComparisons). The engine's `key_json` produces the identical string (integral numbers within the safe range print without a decimal point, as JavaScript prints them, so `-0` keys as `0`; other numbers use the shortest round-trip form).
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

`{ kind: "select", columns }`. Keeps the named columns in the order given. A repeated name keeps its first occurrence only, on both engines (Polars refuses a duplicate selection outright). Any unknown name is `#REF!`. Columns keep their type, unit, format and `raw`. An empty list yields a frame with no columns; the Keep card instead passes its input through when its list is empty.

### drop

`{ kind: "drop", columns }`. Removes the named columns; a name not present is ignored. The remaining columns keep their order and everything they carry. Dropping every column leaves a frame with no columns. `drop` with an empty list is the no-op `passFrame` uses.

### rename

`{ kind: "rename", map }` (old name to new name). Every column's proposed name is `map[name]` or its own name; the whole list then goes through `makeHeaders`, so a collision renames the later column (renaming `a` to `b` in `a, b` gives `b, b2`) and every name is trimmed. A key naming no column does nothing. Column order is unchanged. The Rename card pairs its From and To lists by index and skips a pair with an empty side; with no complete pair it passes through.

### sort

`{ kind: "sort", by, dir: "asc" | "desc" }`. Orders rows by one column. Present values compare within the column's type: numbers and dates numerically, strings by code-unit order, logicals false before true. Blank cells, error cells and `NaN` form a tail that comes last in both directions, in input order. `NaN` must be pulled into the tail explicitly: every comparison with it is false, so a subtraction comparator would place it by input position. `±Infinity` sorts as a real magnitude. Ties keep input order (the sort is stable in both directions). The engine sorts by a key expression (logical cast to 0/1, `NaN` mapped to null) with a row index as an ascending tiebreak. The Frame Sort card passes through when the column is blank.

`sortedIndexOrder` is the shared index math: the frame sort and `sortCube` both call it, so a Frame and a Cube of the same data sort identically. `distinctIndexOrder` plays the same role for Distinct.

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

The Frame Filter card: each condition row is a column, an op and a value (`readFilterValue` stringifies a wired scalar, and an error value becomes its code). A wired blank column, or a wired blank value for an op that takes one, makes both outputs blank. A row whose literal column is empty, or whose literal value is empty for an op that takes one, is skipped. With no complete rows, Kept is the input and Dropped is blank. Kept and Dropped are both permanent outputs: `filterMulti` and the same op with `complement: true`. Dropped follows the same stale-pass and previous-ref lifecycle as `emitFrame` (its own `_refDropped`) but collects no preview, so it stays a lazy ref until a consumer collects it. A list-cell op on a frame input is `#SHAPE!`, telling the user to connect a Cube. Any `iserror`/`noterror` condition makes the card collect its input and run `filterRowsMulti` in the oracle on both platforms. A Cube input runs `filterCube` (see Eager verbs).

The card's op list is `FILTER_OP_OPTIONS_WITH_ERROR` (the base `FILTER_OP_OPTIONS` plus `noterror` and `iserror`), and `FILTER_OP_OPTIONS_WITH_LIST` adds the four list-cell ops for a Cube input. The error ops stay off the base list so SUMIFS, which shares it, never offers them. The value-free ops (`VALUELESS_FILTER_OPS`: the blank and error ops and `listEmpty`) hide the Value field and ignore a wired value. The case toggle (Aa) shows only for the ops where case matters (`TEXT_MATCH_OPS`: `eq`, `neq`, `contains`, `startsWith`, `endsWith`); numeric, date and logical comparisons ignore it.

### groupBy

`{ kind: "groupBy", keys, aggs: [{ column, op, as }] }`. One output row per distinct key tuple (keyed by `encodeCell`), in first-seen order; a null key is its own group, and each non-finite key value is its own group. Output columns are the key columns (type and unit kept, format dropped), each holding the group's first-seen cell, then one column per aggregate named `as`. All output names go through `makeHeaders`, so an aggregate named after a key becomes `k2` and the key keeps its name. An unknown key or aggregate column is `#REF!`.

`aggregateGroup(cells, op, type?)`:

| Op | Result | Empty group | Output type | Unit kept |
|---|---|---|---|---|
| `count` | Count of non-null cells (errors and `NaN` count) | 0 | number | no |
| `sum` | Sum | 0 | number | yes |
| `avg` | Mean | null | number | yes |
| `min`, `max` | Minimum, maximum; over a text column, the first and last text in code-unit order | null | the source type (a date stays a date; a logical returns TRUE/FALSE; text stays text) | yes |
| `product` | Product | 1 | number | no |
| `median` | Middle value; an even count averages the middle pair `(lo + hi) / 2` | null | number | yes |
| `mode` | Most frequent value, ties to the first occurrence | null | number | yes |
| `stdev`, `var` | Sample (n − 1); null under two points | null | number | no |
| `stdevp`, `varp` | Population (n); 0 for one point | null | number | no |
| `percentof` | null (it needs a total set; only Pivot computes it) | null | number | no |

Every op but `count` reads only numeric cells: logical cells count as 1/0 and text cells contribute nothing (so a text column sums to 0). The exception is `min` and `max` over a text column ([[D76]] textMinMax): they compare the group's cells as text by code unit ([[C59]] byteStringOrder), the order Sort uses, so the comparison is case-sensitive and a number stored as text orders as text (`"10"` before `"9"`). A column mixing numbers and text is already a text column (`typedColumn`), so it follows the same rule. Blanks and empty strings are skipped, and a group with nothing else is blank. The caller passes the column type, since the cells alone cannot tell a text column from a number column holding one stray string. An error cell anywhere in the group makes the result that error (the first in row order). Then the non-finite guard: a `NaN` input makes the group `#DOMAIN!`, checked before aggregating because a `NaN` inside a reduce gives an order-dependent answer; a `NaN` result is `#DOMAIN!`; an infinite result from all-finite inputs is `#OVERFLOW!`; an infinite result when an input was infinite passes. The guard lives inside `aggregateGroup`, so pivot's re-aggregating totals get it too. Variance is the sequential two-pass form (sum, mean, sum of squared deviations) and median the midpoint `(lo + hi) / 2`; the engine runs both as per-group functions in the same operation order, because Polars' own `var()` and `median()` differ in the last digits. An op name outside the list is `#NAME?` (`Unknown aggregation "<op>"`) for the whole verb; the engine checks this before running, the oracle when it first aggregates a group with numeric cells.

**Readings on an offset scale** (a °C or °F column) answer as a formula does ([[C25]] firstClassUnits, [[unit-flow]]); `aggUnitPlan` in `frameVerbs.ts` holds the rule. `sum`, `product` and `percentof` are `#UNIT!` in every group, since the op, not a cell, is at fault, and the column carries no unit. `stdev` and `stdevp` are a delta in kelvin and `var` and `varp` a squared one: the value scales by the unit's scale per power (5/9 for °F) and the column unit is the bare temperature dimension. `count` is plain; the rest stay readings in the column's unit. The op carries the scale as `readingScale` on each aggregate; the oracle reads it off the column's unit when absent.

`aggregateGroup` is exported: Cube Rollup (`cube.ts`) runs it and `aggUnitPlan` over a nested sub-frame's column, passing that column's type and unit, so a roll-up and a GROUPBY agree on every op's edge cases and units. A nested cube's column reads its tagged cells in one unit first (`matrixCellsFromList`). A roll-up that produced any text cell is a string column; otherwise it is number, carrying the unit its rows agree on. The Window verb's `group_min`, `rolling_min`, `cummin` and their max twins do not share it and stay numeric.

The engine groups with `group_by_stable` on derived key expressions (a float key split into its finite value and a non-finite class token: a finite `x` is `(x, null)`, `±∞` and `NaN` are `(null, "inf" | "-inf" | "nan")`, a null is `(null, null)`) so buckets match `encodeCell`, and each output key is the group's first-seen original cell. `count` counts the raw column whatever its type; on a string column `min` and `max` are Polars' string `min()` and `max()` over the non-empty cells (UTF-8 byte order, which matches code-unit order outside the astral plane), and every other op is the empty-group constant (0 for sum, 1 for product, blank otherwise). The guard wraps every aggregate over a number or date column except `count` and `percentof`, and its `#DOMAIN!` and `#OVERFLOW!` results travel as reserved NaN payloads (see Native execution). A min or max over a logical column is cast back to TRUE/FALSE.

The GROUPBY card sends one aggregate over its Aggregate column with `as` equal to that column's name. With a totals depth other than 0 it collects its input and runs `pivot` with that column as the only value field and no column fields (the totals re-aggregate the source). A Cube input is flattened with `flatCubeToFrame`. With no keys or no column it passes through. The GROUPBY and Pivot cards' aggregate selector derives from `AGG_OP_META` ([[C8]] declareOnce) and leaves out the `pivotOnly` ops, which only the pivot assembly can run.

### unpivot

`{ kind: "unpivot", idColumns, valueColumns, variableName?, valueName? }`. Wide to long: for each input row, in order, one output row per value column, in the listed order. Output columns are the id columns (type and unit kept), a string column named `variableName` (default `variable`) holding the value column's name, and a column named `valueName` (default `value`) holding the cell. All names go through `makeHeaders`. The value column takes the value columns' shared type, and their unit when they all share one. Value columns of different types are `#TYPE!` (`Unpivot value columns must share a type (…)`); an unknown column is `#REF!`. The card passes through when Melt is empty.

### pivot (oracle only)

`{ kind: "pivot", rowFields, colFields, values, funcs, rowTotalDepth?, colTotalDepth?, rowSort?, colSort?, relativeTo?, filter? }`, Excel's PIVOTBY. It runs in the oracle on both platforms (the engine has no pivot op), always eagerly on a collected frame.

**Setup.** Blank field names are dropped. No value fields is `#VALUE!` (`PIVOTBY needs at least one value field`); an unknown field is `#REF!`. `funcs[i]` applies to `values[i]`, falling back to `funcs[0]`, then `sum`. `filter`, when present, keeps only source rows whose mask entry is `true`.

**Axes.** Each axis (rows, columns) has leaf groups: the distinct field tuples among the kept rows. Leaves are ordered hierarchically: each field level ranks its values by first appearance across the whole axis, and tuples sort by those ranks level by level, so each outer group stays contiguous. An axis with no fields has one anonymous leaf.

**Sorting.** `rowSort` and `colSort` are signed 1-based indices into `[fields…, values…]`; negative means descending. A field index re-ranks that level by value (the column type's comparator, blanks and errors last), and descending reverses that level's whole order, which puts blanks first. A value index reorders the leaves by that value's aggregate over the whole axis (a `percentof` scores by sum), `NaN` or error scores last, and only when the axis has more than one leaf; it reorders leaves flatly.

**Totals.** `rowTotalDepth`/`colTotalDepth`: 0 adds nothing, 1 adds a grand total, 2 or more adds subtotals too, and a negative depth places totals before their groups. Totals need at least one field on the axis. Subtotal levels are `min(|depth| − 1, fields − 1)`; for each prefix length p from 1 to that, every contiguous run of leaves sharing a p-field prefix gets a subtotal slot. By default a subtotal follows its run's last leaf, inner levels first, and the grand total comes last; placed at top, a subtotal precedes its run's first leaf, outer levels first, and the grand total comes first.

**Cells.** A cell for value v over a set of row slots and column slots aggregates the source cells of every covered leaf pair with that value's function, so totals re-aggregate the source (a grand average is the average of all source rows). A combination with no source rows is blank. `percentof` is `SUM(cell) / SUM(total set)`, where `relativeTo` picks the total set: 0 the column total, 1 the row total, 2 the grand total, 3 the parent column group (leaves sharing all but the last column field), 4 the parent row group. A zero denominator is blank; an error cell propagates.

**Output.** One key column per row field (names through `makeHeaders`), then one body column per column slot and value. Key cells: a leaf shows its tuple; a subtotal shows its prefix, `Total` in the next field, and blanks after; the grand row shows `Grand Total` in the first key column. A key column that receives a `Total` or `Grand Total` marker becomes a string column, its other cells formatted as display text (`formatFrameCell`: dates as `DD-MMM-YYYY`, logicals as `TRUE`/`FALSE`). A body header is the column tuple's values, each through `String()` (a date shows its serial, a blank shows `null`), joined with ` | ` (`Grand Total` for the grand slot, the prefix plus `Total` for a subtotal), followed by ` | <value name>` when there is more than one value; with no column fields and one value it is the value's name. Body headers go through `makeHeaders`. Body columns are number typed, except a `min` or `max` over a text value column, which is a string column ([[D76]] textMinMax); a value sort on such a body reads it as blank. They carry the value column's unit for sum, avg, min, max and median.

The PIVOTBY card forwards its input unchanged when it has no value fields, and drops field references to columns the input no longer has. Its per-field value exclusions (keys formed by `pivotCellKey`: blank as `""`, an error as its code, a logical as `TRUE`/`FALSE`, anything else `String()`) are combined with the wired logical mask into `filter`. With a lazy input it reads the schema through a zero-row preview and fetches only the columns the pivot and the filter editor use. Each compute stashes `sourceColumns` (every column's name, type and up to 200 first-seen distinct keys), so the editor popup lists fields without fetching; with a lazy input only the fetched columns get distinct keys, and the rest keep an empty key list.

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

Output type: `lag`, `lead`, `first` and `last` take the value column's type; everything else is number. The unit is kept for the cumulative, lag, lead, diff, rolling, group sum/avg/min/max, first and last functions. Over readings on an offset scale (`readingScale`, as on groupBy), `cumsum`, `rolling_sum`, `group_sum`, `share` and `pct_change` are `#UNIT!` in every row, and `diff` is a delta in kelvin. The engine evaluates each function with Polars `.over()` after sorting by the order key with a row-index tiebreak, then sorts back by the index; its two `#DIV/0!` cells travel as a reserved NaN payload. An unknown function name is `#VALUE!` on both engines. Where Polars' window functions differ from the oracle, the engine masks explicitly: an all-blank partition's `group_sum` is blank (Polars sums it to 0); the zero denominators become the `#DIV/0!` payload; `cummin`/`cummax` over a prefix of only `+∞`/`−∞` read back as that infinity, not the largest finite float Polars seeds them with; and the rolling functions fill blanks with each op's identity before rolling (`rolling_avg` divides a rolling sum by a rolling count), because Polars' null-aware rolling min and max are broken. `ntile` floors through an integer cast. No partition is one group keyed by a constant column, since `.over()` a literal breaks `first` and `last`, and the output computes under a temporary name, so `as` may name a column the function reads.

The Window card always sends `orderDir: "asc"`, derives `as` from the function label and Value column when the name is blank, sends `n` only for the functions that read it, and passes through when a value-reading function has no Value column. A Cube input stays a Cube: `windowCube` (below) appends the column, and the output socket adopts the input's rank.

### fillBlanks

`{ kind: "fillBlanks", columns, dir: "down" | "up" }`. In each listed column (every column when the list is empty), a `null` cell takes the nearest present value above (`down`) or below (`up`); a leading (or trailing) run stays blank. Error cells are values: they neither fill nor get filled. An unknown column is `#REF!`.

### replaceValues

`{ kind: "replaceValues", column, find, replaceWith, mode: "cell" | "substring" }`. Targets one column, or every column when `column` is blank. An empty `find` is the identity. An unknown column is `#REF!`. Matching is case-sensitive except for logicals.

- `substring`: in string columns only, every literal occurrence of `find` inside a text cell is replaced (no regex).
- `cell`: a whole cell matches when a number (or date serial) equals `Number(find.trim())` (a non-numeric find matches no number), a logical's `TRUE`/`FALSE` equals `find` in upper case, or a string equals `find` exactly. Blank and error cells never match. The replacement is coerced to the column type: blank text becomes `null`; a number or date column needs a finite number, and otherwise that column is left unchanged; a logical takes `true`/`1` or `false`/`0` (any case), anything else `null`; a string column takes the text verbatim. So Replace Values never writes a `NaN` into a number column, since a `NaN` cell is neither a value, a blank nor an error that anything downstream could read.

The card's Find and Replace take a wired value of any type, stringified by `readFilterValue`.

### join

`joinFrames(left, right, { leftKey, rightKey, how, asofDirection?, asofTolerance?, rightKeyScale?, rightKeyOffset? })`. The key columns must exist (`#REF!`) and share a type (`#TYPE!`, `Join keys must share a type ("<l>" vs "<r>")`); a Cross join needs neither. Keys of two types could never match, since element families never cross on their own ([[D11]] noAutoCross), so the join refuses instead of returning a silent empty result.

Keys with units compare as quantities ([[C25]] firstClassUnits): `5 km` matches `5000 m`. When both key columns carry a unit and the units differ, `joinKeyTransform` reads the right key in the left key's unit as `right × scale + offset` (the offset is for temperatures). It treats each display unit as affine to base SI, `base = a·x + b`, measuring `a` and `b` by tagging 0 and 1 with `tagFrameCellUnit`; then `scale = a_right / a_left` and `offset = (b_right − b_left) / a_left`. The transform is applied to a number key only. Keys that measure different things, or two different currencies, are `#UNIT!` (`Join keys measure different things (<l> and <r>). Convert one key first`). A unit on only one side converts nothing. Explicit `rightKeyScale`/`rightKeyOffset` override the derived transform; the native engine never sees units, so `PolarsBackend.join` derives the transform from its schema shadows and always sends it.

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

The engine joins on masked temporary key columns (non-finite masked to null, because Polars would otherwise match `inf` with `inf` and `NaN` with `NaN`), so the real key columns ride through untouched. It adds a row index to each side and sorts the result into the oracle's order (driving side first, the other side's order within a fan-out), coalesces a right join's key by hand, and selects every output column by name before renaming it to the oracle's layout. It builds `outer` as a left join followed by an anti-join tail of the unmatched right rows, whose key is filled from the right and whose other left columns are blank. It runs as-of as a hand-written binary search that mirrors the oracle step for step, because Polars' as-of kernel breaks `nearest` ties differently, excludes exact key ties by default and treats non-finite keys its own way. An unknown `how` is `#VALUE!` on both engines.

The Join card: a blank Right key reuses the Left key; a blank Left key yields nothing unless the join is Cross; Tolerance is read only for as-of, and a wired blank there (or a wired blank key) makes the output blank.

### append

`appendFrames(frames)`. Stacks frames in order, matching columns by name. The output columns are the union of names in first-seen order; a frame lacking a column contributes blanks for its rows. A name with different types in two frames is `#TYPE!` (`append: column "<n>" is <t1> in one frame and <t2> in another`); nothing is coerced. Columns carry name, type and values only. The card stacks its wired rows in row order and passes a single frame through.

### bindColumns

`bindColumns(frames)`. Places every column of every frame side by side in order, names through `makeHeaders`; the row count is the longest frame's, and shorter frames pad with blanks. A frame with no columns contributes nothing. Columns carry name, type and values only. The card passes a single frame through.

## Eager verbs outside the seam

These run only in the oracle, on the collected value, on both platforms. They have no `FrameOp` and no corpus file.

### Verbs on a Cube

| Verb | Function | Contract |
|---|---|---|
| Cube column verbs | `selectCubeColumns`, `windowCube` | The Columns and Window cards on a Cube input. `selectCubeColumns` keeps the listed columns in the listed order (a missing name is `#REF!`) or drops the listed ones (missing names ignored). `windowCube` reads only the partition, order and value columns (each through the scalar reading below, so a list or table cell in one of them is `#SHAPE!`) plus a hidden row index that keeps the row count when the function reads no column, runs `windowFrame` over them, and appends the result as a cube column, replacing one of the same name. Every other column, nested cells included, rides through, so a vault table (whose `tags`, `links` and `embeds` are lists) runs a rolling average and trims to flat columns for a chart. |
| Cube row verbs | `sortCube`, `distinctCube`, `sliceCube`, `filterCube` | The row verbs on a Cube input. Row order comes from the same index functions the frame verbs use, computed over a scalar reading of the needed column (`inferColumn`; a list or table cell in it is `#SHAPE!`); every column, nested cells included, rides along by reference. Distinct keys every column, nested cells encoded structurally. `filterCube` adds the list-cell ops: a non-list cell counts as a one-item list and a blank as empty; membership folds case unless `matchCase`; any and all split the value on commas. |

### Nest and Unnest

`nestFrame(f, keyColumns, nestedName = "items")` groups one flat Frame into a Cube: one row per distinct key tuple (by `encodeCell`, first-seen order), then a nested column whose cell holds that group's rows of every non-key column as a sub-frame (type, unit and format kept). The key columns carry their type, so a date key stays date-matchable in a Cube XLOOKUP. Names go through `makeHeaders`, and a blank nested name is `items`. It is the single-table sibling of Nest Join and the inverse of Unnest. A missing key is `#REF!`.

`unnestCube(c, nestedColumn)` peels one level off a nested column (`#REF!` when it is missing). Each nested cell votes for a kind: a non-empty list votes list, a Frame votes table, a Cube votes cube, and an empty list votes nothing, since it means "no children". Two kinds is `#TYPE!` (`nested cells must all be lists, all tables, or all cubes`). With no votes, the list path runs if any cell is a list, else the table path.

| Path | Result |
|---|---|
| List | A Frame. Each parent row repeats once per item, and the item sits under the same column name (so a Predecessors list round-trips into the Schedule Links input). An empty or missing list keeps its row once with a blank, so a task with no predecessors survives. Every column is re-inferred. |
| Table | A Frame. Each parent row repeats once per child row, with the child's columns appended (their schema from the first Frame cell; a child lacking one is blank there). A row with no child rows is dropped. Parent columns are re-inferred, child columns keep their type, and names go through `makeHeaders`. |
| Cube | A Cube one level shallower. As the table path, with the schema from the first Cube cell, carried types kept, and each child's own nested columns left nested. |

### Table tidies

The Power Query column and row tools. Each returns a new Frame, and names go through `makeHeaders`.

| Function | Card | Rule |
|---|---|---|
| `splitColumn(f, column, delimiter, names?)` | Split Column | Splits a column's text on `delimiter` into N string columns, N being the largest part count over the rows; a short row pads with blanks, and a blank or error cell gives blanks. The new columns replace the source in place, named from `names` (trimmed) or `<column> 1` … `<column> N`. An empty delimiter changes nothing. |
| `addIndexColumn(f, name, start)` | Add Index | Prepends a number column counting up from `start` in steps of 1, named `name` trimmed (default `Index`). The index name is de-duplicated first, so an existing column with that name is the one renamed. |
| `mergeColumns(f, columns, separator, name)` | Merge Columns | Needs at least two columns (`#VALUE!`, `Merge needs at least two columns`). Joins each row's cells as display text (`formatFrameCell`, so a date merges as its date text and an error as its code; a blank contributes `""`) with `separator` into one string column named `name` trimmed (default `Merged`), placed where the first source sat. The sources are removed. It is the inverse of Split Column. |
| `promoteHeaders(f)` | Headers | The first row becomes the column names (a blank or error cell becomes `Col{i}`, any other cell its display text trimmed). Column types stay and the first row is removed. An empty frame is unchanged. |
| `demoteHeaders(f)` | Headers | The column names become a first row, and every column becomes a string column named `Col1`, `Col2` and so on (the header row is text, so a typed column would be mixed). Cells become display text; blanks and errors pass through. |
| `dropBlankRows(f, mode)` | Drop Blank Rows | `all` drops only rows where every cell is blank (spacer rows); `any` keeps only complete rows. An error cell is a value, not a blank. |

`distinctColumnValues(cells, isExcluded?)` feeds a constrained-entry list: the distinct cell texts of one column in first-seen order, skipping blanks (`null` or `""`) and anything `isExcluded` rejects (the caller passes error codes).

### Lookup over a table

The XLookup card finds a row in a Frame or a Cube. A Frame is converted with `frameToCube` first, so one path serves both. `asLookupSource(v)` normalizes the card's input: a Cube or Frame passes, a matrix becomes a Frame by rows, and (as fallbacks, since the card's shape guard already refuses them) a flat list becomes a one-row Frame and a scalar a 1×1 Frame.

`lookupRowIndex(cube, lookupColumn, lookup, matchMode = "exact", searchMode = "first")` returns the matching 0-based row, or −1.

1. The key column must exist (`#REF!`). Only top-level columns are searched, never nested cells.
2. The key type is the column's carried type, so a date column matches an ISO date lookup. A hand-built Cube column with no type falls back to `inferCubeKeyType`: all numbers is number, all booleans is logical, and anything else (text, containers, a mix of numbers and booleans, or nothing) is string. Blanks and errors are ignored, and inference never gives date, since a date and a number are the same serial.
3. The lookup arrives as text and is parsed by the key type: logical through `coerceLogical` (unreadable is false), date as a serial when it is plain digits and otherwise through `parseDateToSerial`, number through `Number()`, string as is.
4. The match is delegated to the formula surface's `xmatchIndex`, so the card and XLOOKUP cannot drift. A string key matches case-insensitively. A blank, error or container key cell never matches.

| Mode | Values | Meaning |
|---|---|---|
| `matchMode` | `exact` (default), `nextSmaller`, `nextLarger` | Excel's match_mode 0, −1 and 1. The approximate modes fall back to the closest key ≤ or ≥ the lookup only when there is no exact match. They need a number or date key (`#VALUE!`, `Approximate lookup requires a numeric or date column`) and a finite lookup, or nothing matches. |
| `searchMode` | `first` (default), `last` | Excel's search_mode 1 and −1: which of several equal keys wins. An approximate match already picks the closest key. |

`lookupCell(cube, lookupColumn, returnColumn, …)` returns the matched row's cell in the return column whole, so a nested Frame or Cube comes out intact; `undefined` on no match, and `#REF!` for a missing return column, checked even when nothing matched. The whole-row return (`Return = *`) is `frameRowAt` (a one-row Frame, `raw` dropped) or `cubeRowAt` (a one-row Cube, each cell whole, types kept).

## Analysis verbs

These also run in the oracle on the collected value, on both platforms.

### Reconcile

`reconcileFrames(left, right, { leftKey, rightKey, priceColumn?, qtyColumn? })` compares a before table (left) with an after table (right) row by row on a key. Both keys must exist (`#REF!`).

- **Keys.** Keys are indexed as in Join, so a blank, error or non-finite key is not matched. Keys are visited in first-seen order, left first, then keys found only on the right.
- **Columns.** A shared column is a left non-key column that the right also has by name. A non-key column on only one side is listed in the summary (`removedColumns`, `addedColumns`) and never drives a row's status, since it would apply to every matched row equally.
- **Rows.** For each key, duplicate rows pair up by position; the extra rows on the longer side are their own added or removed rows, so the row total stays exact. A row present only on the right is `added`, only on the left `removed`; a matched row is `changed` when any shared column differs (two blanks are equal, and an error cell is never unchanged) and `unchanged` otherwise. A row whose key is blank, an error or a non-finite number cannot be matched, so it is emitted after the rest (left rows, then right) as `skipped`.
- **Output.** The key column (the left key's name and type, filled from whichever side has the row), `Status`, then per shared column `<name> (before)` and `<name> (after)`, plus `<name> Δ` (after − before when both are numbers) for a number column; then `<name> (removed)` holding the before values and `<name> (added)` holding the after values. Names go through `makeHeaders`. The summary counts `added`, `removed`, `changed`, `unchanged` and `skipped`.
- **Price, volume, mix.** When `priceColumn` and `qtyColumn` both name shared columns that are numbers on both sides, the summary adds `pvm`. Per row, a factor on a side where the row is absent is a genuine 0 (a new or removed row); a present cell that is not a number is unknown, and the row is left out of the decomposition and counted in `excluded`. Over the included rows: `totalBefore = Σ P0·Q0`, `totalAfter = Σ P1·Q1`, `price = Σ (P1−P0)·Q0`, `volume = Σ (Q1−Q0)·P0`, `mix = Σ (P1−P0)·(Q1−Q0)`, and `delta = totalAfter − totalBefore`, which the three terms sum to exactly.

### Decision Matrix and Decision Sensitivity

`decisionMatrix(f, weights, normalize, breakdown = false, normalizeOverrides = {})` scores and ranks a Frame of options ([[C64]] decisionMatrixFamily).

1. **Columns** (`decisionColumns`). The label is the first string column, if any; the criteria are every other number or logical column. A date column is never a criterion, since a serial is not a score. No criteria is `#VALUE!` (`Decision Matrix needs at least one numeric criterion column`), and an error cell in a criterion is returned as the result. Without a label column the options are `Option 1`, `Option 2` and so on.
2. **Cells.** A finite number scores as itself, a logical as 1 or 0, and a blank, text or non-finite cell as 0 (not yet scored).
3. **Normalize**, per criterion (`normalizeOverrides[name]`, else `normalize`): `none` keeps the raw value; `max` divides by the column's largest absolute value (all zero stays zero), landing in [0, 1], or [−1, 1] with negatives; `rank` scores each value by the fraction of the other rows it strictly beats, `count(o < v) / (n − 1)`, so ties share and a lone row is 1. So normalized columns of any mode stay comparable.
4. **Score.** A weight that is not a finite number is 1. `Score = round4(Σ effective × weight / Σ |weight|)`, or 0 when the weights sum to 0. `round4` rounds to 4 decimals on compute, not display, and turns −0 into 0, so two options that print the same score share a rank.
5. **Rank** is the competition rank on the rounded score, highest first: equal scores share a rank and the next distinct score skips past them.
6. **Output**, best first: the label column (its own name, or `Option`), then with `breakdown` each criterion's signed contribution `round4(effective × weight / Σ |weight|)`, which sum to the Score and show a negative-weight criterion as the penalty it is, then `Score` and `Rank`. Names go through `makeHeaders`, so a criterion named `Score` or `Rank` cannot collide.

`resolveDecisionWeights(weightsFrame, criteria)` aligns a weights frame to the criteria by name. The first string column holds the criterion names, matched trimmed and case-insensitive, first row winning. The weight is the number column named `Weight`, `Weights` or `Value`, else the first number column; a cell that is not a finite number (a logical counts as 1 or 0) gives 1, as does a criterion the frame omits or an unwired frame. An optional column named `Norm` sets per-criterion overrides through `parseNormalize`, which lowercases, strips `÷` and spaces, and reads `raw` or `none`, `max` or `divmax`, and `rank`; anything else inherits the default.

`decisionSensitivity(scores, scenarios, normalize)` reruns the matrix once per scenario. Scenarios is the weights frame widened: the first string column names the criteria, each number column is one scenario named by its header, and one optional `Norm` column applies to all of them. No number column is `#VALUE!` (`Scenarios needs a number column per scenario`). When no row is named after any criterion every weight would default to 1 and every scenario would agree, so that is `#VALUE!` too (`No Scenarios row is named after a criterion`). A criterion a scenario omits weighs 1. The result is a Cube with one row per scenario: `Scenario` (the header), `Winner` (the top option, or every option tied at rank 1 joined with ` = `), `Margin` (`round4(top − runner-up)`, blank with one option) and `Ranking` (the scenario's full label · Score · Rank frame, nested).

### Allocator

`allocateFrame(f, mode, amount)` spreads an amount across categories within each one's range, through `allocate` (`allocateOps.ts`, no solver). Columns are found by trimmed, case-insensitive name: the weight column is `weight`, `weights` or `value`; the range is `min` and `max`, falling back to the first two number columns that are not the weight column. Without both it is `#VALUE!` (`Allocator needs a min and a max number column`). Every min and max cell must be a finite number (`#VALUE!`, `Allocator: every min must be a number`; an error cell is returned as itself). A weight that is not a finite number is 1, and ordered weights ride this column rather than a wired list. The category name is the first string column, else `Item 1`, `Item 2` and so on.

The output is `<name column or Category>` · `Allocation` · `Share`. Allocation comes first among the numbers, so a wired chart plots it, and carries the min column's unit and format. Share is each allocation's raw fraction of the total (0 when the total is not positive), to be formatted as a percent downstream. Comparing prices against the range is left to a join or computed column downstream.

The kernels (`allocate(mode, mins, maxs, weights, amount)`) are three closed-form modes, each exact. Each row's range is normalized first, so a row whose min exceeds its max uses the smaller as the floor and the larger as the ceiling. Weights are read as non-negative (a non-finite or non-positive weight is 0), and when every weight is 0 they all become 1, so dividing by Σw is safe.

- **`budget`** (Fit budget, a water-filling fixed point) spends `amount` in proportion to weight, each category clamped to [min, max]. A clamped category is fixed and the remaining budget redistributes among the still-free ones, pass after pass; each pass fixes at least one category or finishes. When the free categories have no weight, the remainder splits equally among them. A budget at or below Σmin gives every floor, and one at or above Σmax gives every ceiling.
- **`minTarget`** (Min for target, a fractional knapsack) finds the least spend that reaches a weighted value Σwᵢaᵢ ≥ `amount`. Floors come first; then the extra value is bought from the highest-weight category (most value per dollar) up to its ceiling, spilling to the next. A target unreachable even at every ceiling returns every weighted category at its ceiling as a best effort.
- **`minProportional`** (Min proportional, `amount` ignored) finds the least spend keeping each aᵢ proportional to wᵢ above the floors: `k = maxᵢ(minᵢ / wᵢ)` and `aᵢ = clamp(k·wᵢ)`. A zero-weight category cannot be proportional to 0, so it takes its floor.

### Group Cost Settle

The Group Cost Settle card answers who pays whom in the fewest transfers, with no solver. Its kernels are `nodes/settleOps.ts`, and both modes feed one greedy core, `minTransfers(balances)`:

1. Balances for the same name net first, so nobody ever pays themselves.
2. Creditors (net above half a cent) and debtors are each sorted largest first with a stable sort, so ties keep input order and the result is deterministic.
3. The biggest creditor takes from the biggest debtor until one of them is even, and every amount rounds to cents.

**Totals mode** (`settleGroup(rows)`): each row is a name, what they paid, and an optional `share` weight (1 is an equal share). Weights apply when any row carries one (or when the card's `split` asks for them), and then a blank, negative or non-finite weight counts as 1; otherwise everyone owes an equal share. A person's fair share is `paid total × weight / Σ weights`, their net is `paid − share` (positive is owed, negative owes), and a non-finite paid amount counts as 0.

**Ledger mode** (`settleLedger(expenses)`): each expense is an amount fronted by one or more payers and split equally among its beneficiaries. Payers and beneficiaries are independent name sets, and a null beneficiary list means the whole group, everyone named anywhere in the ledger. Every named person is registered before any split is computed, so a whole-group split covers the full roster rather than only the people seen so far. The roster is in first-appearance order (payers before beneficiaries, row by row); duplicate names within one expense count once; an expense with no payers or no beneficiaries is skipped. Each expense credits its payers an equal part of the amount and debits its beneficiaries an equal part. The per-person paid totals, fair shares and nets round to cents, and the nets feed `minTransfers`. Ledger mode is equal-split only.

### Payoff Planner

The kernels are `nodes/payoffOps.ts`, a month-by-month amortization with no solver. Each debt has a name, a balance, an APR and a minimum monthly payment. An APR is a fraction (0.18), and a value of 1 or more reads as a percent (18); the monthly rate is APR / 12, and a negative or non-finite APR is 0.

`payoffOrder` ranks the debts head first: avalanche by the monthly rate the plan charges, highest first (so 18 and 0.24 compare correctly), and snowball by balance, smallest first. Ties keep input order.

Each month of `payoffPlan(debts, extra, order)`:

1. Interest accrues on every open debt, and every open debt gets its minimum, never more than it owes.
2. The pot is the extra, plus each cleared debt's minimum (only for a debt that was open at the start; a debt that started clear frees nothing), plus the unused part of any minimum larger than its balance.
3. The pot pays the head debt and cascades down the order.

A balance at or below half a cent counts as clear. The plan answers the months until the last debt clears, the schedule of balances (`[month][debt]`, month 0 the starting balances, rounded to cents), per debt the month it cleared (0 for one already clear) and its interest, and the total interest. Past 600 months (`MAX_MONTHS`) the payments never clear a debt: the kernel throws naming the first such debt in the order, and the card answers `#VALUE!`.

### Earned Value

The kernels are `nodes/earnedValueOps.ts`. They are unit-free, magnitudes in and metrics out; the card carries the Cost column's currency onto the money columns. Per task:

- BAC (budget at completion) is the Cost column.
- BCWS (planned value, PV) is BAC times the planned fraction.
- BCWP (earned value, EV) is BAC × percent complete / 100.
- ACWP (actual cost, AC) is the Actual cost column when present, else BCWP.

The planned fraction (`plannedFraction`) is the share of the baseline span, counted in working days, elapsed by the status date: 0 without a baseline or on or before its start, 1 on or after its finish, and otherwise `count(start, status) / count(start, finish)`. The card injects the engine's `Calendar.countBetween` (inclusive of both ends) as the counter, so weekends and holidays match the schedule.

The metrics are SV = BCWP − BCWS, CV = BCWP − ACWP, SPI = BCWP / BCWS, CPI = BCWP / ACWP, EAC = BAC / CPI (or BAC when CPI is unknown or not positive, assuming the rest runs to budget), VAC = BAC − EAC and TCPI = (BAC − BCWP) / (BAC − ACWP). A ratio whose denominator is 0 is null and draws blank. Project totals compute each ratio from the summed components, never by averaging the tasks' ratios, the project-management convention.

### K-Means, PCA and Logistic Regression

The kernels are `nodes/mlOps.ts` and take rows × features numbers; the frame cards pick the numeric columns and drop rows with a blank.

- **`kmeans(points, k)`** runs Lloyd's algorithm from k-means++ seeding, with `nInit` restarts (default 10) of up to `maxIter` iterations (default 300), and keeps the run with the lowest inertia (the sum of squared distances to the assigned centers). The generator is seeded (`mulberry32`, default seed `0x5eed`), so a recalculation repeats itself ([[D46]] freezeVolatilePerCalc). A cluster that empties re-seeds at a random point. Labels are 1-based and renumbered by first appearance, so the same partition always reads the same. No points, or k below 1 or above the point count, answers null.
- **`pca(points, { standardize })`** takes the principal components of the covariance matrix, centered as sklearn and `prcomp` do, through `matEigh`; with `standardize` it uses the correlation matrix, dividing each feature by its sample standard deviation (or 1 when that is zero). `scores` is rows × components; `loadings` is features × components, each column a unit-length axis whose largest-magnitude entry is positive; `variance` is each component's variance in descending order (negative values floor at 0); and `ratio` is its share of the total. Fewer than two rows answers null.
- **`logisticFit(X, y)`** is unregularized maximum likelihood by iteratively reweighted least squares on `[1 | X]` against a 0/1 target (R `glm(binomial)`, statsmodels `Logit`), up to 100 iterations until the largest coefficient change is below 10⁻¹⁰. Coefficients are the intercept first, then one per feature. It also gives Wald standard errors from the final information matrix, z-scores, two-sided normal p-values, the fitted P(y = 1) per row in input order, and the log-likelihood. No rows, a mismatched target, no more rows than columns, a constant target or a singular system answer null. Perfectly separable data reaches the iteration cap with huge coefficients and `converged: false`, like glm's warning.

### Describe and Correlation Matrix

`describeColumn(values, type)` profiles one column, for the Describe card and the table popup's summary footer: `count` (present cells, errors included), `blank`, `error` (the error cells among `count`) and `distinct` (distinct present non-error values, type-aware, so `1` and `"1"` differ). A number column adds `mean`, `std` (sample), `min`, the quartiles `q25`, `median`, `q75` (PERCENTILE.INC, pandas' linear method) and `max`, over its finite numbers. A date column adds only `min` and `max`, as serials. Other columns leave the statistics blank.

`describeFrame(f)` returns one row per input column: `column`, `type`, `count`, `blank`, `distinct`, `mean`, `std`, `min`, `25%`, `50%`, `75%`, `max`.

`correlationMatrix(f, method)` compares every pair of number columns by `pearson`, `spearman`, `kendall` or `covariance` (the sample covariance), like pandas `df.corr` and `df.cov`. Each pair uses only the rows where both cells are finite numbers (pairwise complete), so a patchy frame still answers; a pair with too little data or no variance is blank. The output is a `column` string column naming the variables, then one number column per variable.
