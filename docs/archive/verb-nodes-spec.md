# Verb-node spec — for author sign-off (WS3 node wiring)

The pure engine (`frameVerbs.ts`) is built + tested. This proposes the NODES that
expose each verb, with every UX choice resolved against existing Solenoid patterns,
so once you sign off, building is mechanical (no design left to invent). Each node's
`data()` is a thin sync call to the matching `frameVerbs` function (no async/handles
until the Polars desktop path — nodes stay on the current eager engine).

**UX vocabulary reused** (so these feel native, zero new affordances):
- **Column reference** → a `strIn("Column")` (typed OR wired), exactly like **Get Column**.
- **Column LIST** → `strListIn` (a wired/typed string list), like **Build Frame** headers.
- **Op / mode pick** → a `SegToggle` (like Get Column's read-as, Aggregate's op).
- **Variadic rows** → `ExtensibleInputs` (flat) / `PairedExtensibleInputs` (pairs), like CHOOSE/IFS.
- Frame in/out → `frameIn`/`frameOut`; Cube → `cubeIn`/`cubeOut`.

Category in the Add menu: a new **Table / Relational** group (or fold into the existing
Frame group — your call).

## The nodes

| Node | Inputs | Param control | Output | Verb | Status |
|---|---|---|---|---|---|
| **Filter Frame** | `frame` | `strIn` Column · `SegToggle` op (= ≠ > ≥ < ≤ · contains/startsWith/endsWith) · value (typed/wired) | `frame` | `filterRows` | net-new (FilterNode is matrix-only; this is the named-column path) |
| **Sort Frame** | `frame` | `strIn` Column · `SegToggle` Asc/Desc | `frame` | `sortByColumn` | net-new |
| **Distinct** | `frame` · `strListIn` On (empty = all cols) | — | `frame` | `distinctRows` | net-new (frame analog of UNIQUE) |
| **Head** | `frame` · `numIn` Rows | — | `frame` | `headRows` | net-new |
| **Select Columns** | `frame` · `strListIn` Keep | — | `frame` | `selectColumns` | net-new |
| **Drop Columns** | `frame` · `strListIn` Drop | — | `frame` | `dropColumns` | net-new |
| **Rename Columns** | `frame` | `PairedExtensibleInputs` old→new | `frame` | `renameColumns` | net-new |
| **Group By (Frame)** | `frame` · `strListIn` Group by | `ExtensibleInputs` of agg rows: `strIn` Column + `SegToggle` op (sum/avg/min/max/count) + `strIn` As | `frame` | `groupByFrame` | net-new (generalizes 1-D Group By) |
| **Join** | `left` · `right` | `strIn` Left key · `strIn` Right key · `SegToggle` how (inner/left/right/outer) | `frame` | `joinFrames` | net-new |
| **Append** | variadic `frame` rows (`ExtensibleInputs`) | — | `frame` | `appendFrames` | net-new |
| **Pivot** | `frame` | `strIn` Index · `strIn` Columns · `strIn` Values · `SegToggle` agg | `frame` | `pivotFrame` | net-new |
| **Unpivot** | `frame` · `strListIn` Id cols · `strListIn` Value cols | (optional `strIn` variable/value names) | `frame` | `unpivotFrame` | net-new |
| **Nest** | `frame` · `strListIn` Keys | `strIn` Nested name | `cube` | `nestFrame` | net-new (standalone sibling of Nest Join) |
| **Unnest** | `cube` | `strIn` Nested column | `frame` | `unnestCube` | net-new |

## Decisions baked in (flag any to change)
- **Column references are typed/wired strings, not dropdowns.** Matches Get Column. A
  live dropdown of the incoming frame's column names would be nicer but is a NEW
  affordance (the node would have to read its upstream schema at render) — propose as a
  later polish, not v1.
- **Filter is single-predicate** (chain Filter Frames for AND — the SUMIFS pattern).
  Two-predicate AND/OR like the matrix FilterNode can be added if you want it.
- **The fold-ins (Filter/Sort/XLookup matrix-or-list versions) STAY as separate nodes.**
  The existing `FilterNode`/`SortNode` operate on lists/matrices; these new nodes are the
  FRAME-column path. Not a rename/replace — additive. (Re-pointing the existing nodes'
  frame branch through the verbs is a later, riskier consolidation.)
- **No error display work needed** — `installErrorGuards` already wraps every `data()`, so
  a `#REF!`/`#TYPE!` from a verb (bad column / type clash) shows the red badge for free.

## Build order (once approved)
1. The parameterless / simple ones first (Distinct, Head, Select, Drop) — prove the
   wiring (class + component + 3 registrations + catalog) end-to-end on the lowest-UX node.
2. Then the SegToggle ones (Sort, Filter, Join, Pivot).
3. Then the variadic ones (Rename, Group By, Append, Unpivot) — `ExtensibleInputs`.
4. Nest/Unnest (cube sockets).
Each its own commit, `tsc` + `vitest` + a full `.exe` build before hand-off so the
running app can be eyeballed.
