# Bundle 02 — Static shape-checking pass (Bet 3)

**Source:** `future-directions.md` Bet 3. **Verdict:** IN. **Depends on:** nothing.
**Gates:** bundle 08 (transpiler needs range→typed-frame conversion), bundle 09
(subgraph typed boundary), bundle 13's report-file typed refs.

## What exists today

The type system checks one plug against one socket at cable-draw time only. It does
NOT carry a whole table's shape (column names + types) down a chain.

**The verb engine to build `shapeOf` siblings for** — every function is in
`src/graph/frameVerbs.ts` (this is the JS reference oracle the Rust/Polars backend is
parity-tested against — module header, `frameVerbs.ts:1-7`, states this explicitly):

| Verb | Function | Line |
|---|---|---|
| Sort | `sortByColumn(f, by, dir)` | 110 |
| Distinct | `distinctRows(f, columns?)` | 126 |
| Head | `headRows(f, n)` | 138 |
| Filter | `filterRows(f, column, op, value)` | 188 |
| Group By | `groupByFrame(f, keys, aggs)` | 262 |
| Select | `selectColumns(f, names)` | 294 |
| Drop | `dropColumns(f, names)` | 303 |
| Rename | `renameColumns(f, map)` | 311 |
| Split Column | `splitColumn(f, column, delimiter, names?)` | 322 |
| Add Index | `addIndexColumn(f, name, start)` | 340 |
| Join | `joinFrames(left, right, opts)` | 378 |
| Unpivot | `unpivotFrame(f, idCols, valueCols, ...)` | 436 |
| Pivot | `pivotFrame(f, spec)` | 583 |
| Nest | `nestFrame(f, keyCols, nestedName)` → CubeValue | 721 |
| Unnest | `unnestCube(c, nestedColumn)` | 753 |
| Frame Lookup | `lookupFrameCell(...)` | 807 |
| Append | `appendFrames(frames)` | 827 |
| dispatcher | `applyVerb(f, op: FrameOp)` | 851 |

`FrameOp` union: `frameVerbs.ts:43-53`. `AggSpec`/`AggOp`: `frameVerbs.ts:32-56`. These
two types are the contract a `shapeOf(op, inputShapes)` sibling must mirror per-kind —
one shape-computation arm per `FrameOp` member.

**Socket lattice / element types** — `src/graph/sockets.ts`: `SocketDataType` union at
lines 17-43. Element families: `number, string, date, complex, logical`. Dimension
wrappers (`Dim`, line 96): `scalar, list, combo, matrix`, mapped per-family via `FAMILIES`
(lines 98-104, e.g. `number: {scalar:"number", list:"list", combo:"numlist",
matrix:"table"}`). Non-family types: `anytable`, `frame`, `cube`, `lambda`, `any`.
Helpers: `is2DType` (173), `isDateType` (182), `accepts`/`canConnect`/`areCompatible`
(195-240). Socket instances at 259-283 (`frameSocket`, `cubeSocket`, etc.). **A shape is:
column name + one of these element-family types — reuse this taxonomy, don't invent a
new type universe.**

**Cable inspector (extension point)** — `src/graph/components/CableInspector.tsx`.
Renders on single-cable selection via `renderWireValue` (lines 23-49): dispatches by
value shape (`isCubeValue`→`CubeChip`, `isFrameRef`→`FrameRefChip`, `isFrameValue`→
`FrameChip`, arrays→`ArrayChip`). **It shows a value chip today, not column name/type
text — no existing type-name row.** Add the shape display either inside the frame
branches (lines 31-32) or as a new row alongside `.solenoid-cable-inspector__wire`
(lines 141-144, styled via `cableInspector.css`).

**Parity test harness (two unrelated things share the name "parity" — don't confuse
them):**
- `scripts/parity.ts` — an Excel-function-gap report (lists unimplemented Excel
  functions from `EXCEL_GAP`, `nodeExcel.ts:527`). Not a Rust/JS behavioral test.
- **Actual Rust↔JS behavioral parity**: Rust verb impls live in `src-tauri/src/engine.rs`
  (`verb_select` 482, `verb_drop` 494, `verb_rename` 508, `verb_sort` 530, `verb_distinct`
  564, `verb_head` 585, `verb_filter` 632, `aggregate_group` 718, `verb_group_by` 781,
  `verb_unpivot` 844, `verb_join` 891, `append_frames` 972; IPC entries `engine_apply`
  1103, `engine_join` 1124, `engine_append` 1145). Rust unit tests:
  `src-tauri/src/engine/tests.rs` (~28 `#[test]` fns, one per verb/edge case). JS-side
  wire-shape tests: `src/graph/polarsBackend.test.ts` (`describe("PolarsBackend — verb
  command shapes")`, lines 69-149 — verifies JS sends the right op, not output equality).
  JS oracle behavior tests: `src/graph/frameBackend.test.ts` (`describe("framePreview —
  head-N shaping")`, `describe("JsFrameBackend — handle lifecycle + materialization")`).
  **Follow the `frameBackend.test.ts` naming convention** for the new shape-checker test
  file, e.g. `src/graph/frameShape.test.ts`, `describe("shapeOf — <verb> — <case>")`.

## Build order

1. Define the shape type: `{ columns: { name: string; type: ElementFamily }[] }` reusing
   `sockets.ts`'s element-family names (number/string/date/logical/complex), not a new
   taxonomy.
2. Write `shapeOf(op: FrameOp, inputShapes): Shape` covering every entry in the table
   above — one arm per `FrameOp` variant, mirroring the real verb's column-reshaping
   logic without touching data.
3. Static walk: propagate `shapeOf` forward from every source node across the graph —
   pure, no engine call, no IPC.
4. Extend `CableInspector.tsx`'s `renderWireValue` (or add a sibling row) to show the
   computed shape for table cables.
5. Add `src/graph/frameShape.test.ts` (new file), following the `frameBackend.test.ts`
   `describe`/`it` convention, asserting both backends (`engine.rs`'s `verb_*` fns and
   `frameVerbs.ts`'s JS oracle) produce output matching the ONE declared static shape —
   a disagreement is now a caught seam error, not a silent divergence.
6. Later (not blocking exit criteria): refuse-to-run mode for a graph whose static shapes
   don't line up.

## Exit criteria

Every table cable has a statically-computed shape (columns + element types) visible
before running, shown in `CableInspector`; a new parity test (`frameShape.test.ts`)
checks both backends against the one declared shape for every verb in the table above.
