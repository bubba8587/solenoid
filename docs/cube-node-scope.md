# Cube node scope

The Cube is the recursive container that closes Solenoid's socket lattice (v0.9
"finishes all socket types"). This doc captures the design decisions, the node set,
how it compares to nested-data features in other software, and where those features
frustrate people (so we can avoid the same traps).

Status as of 2026-06-24: value model + depth shipped (inert); producers (Nest Join,
Build Cube), the cube/frame-aware INDEX accessor, and the drill-in popup are built.
Code: `frame.ts` (model + `relateFramesToCube`), `nodes/cube.ts`, `nodes/list.ts`
(INDEX), `components/Cube*.tsx`, `cubePopupStore.ts`.

## What a Cube is

A Cube is a Frame whose cells can each hold ANY value: a scalar, a list, a matrix,
a nested Frame, or another Cube. It is tabular at the top level (named columns,
rows) but heterogeneous per cell, so unlike a Frame it carries no per-column type.
It is the lattice supremum: every lower value (scalar, list, matrix, anytable,
frame) widens UP into a cube input, and a cube output flows only into another cube
or `any` (see `sockets.ts` `accepts()`). Lambda is the one thing it can't hold (a
function, not data). This is what "closes" the type system: any data shape is
expressible by nesting, so no new socket type can ever be required.

Value model: `CubeValue` / `CubeColumn` / `CubeCell` in `frame.ts`. `CubeCell` is
recursive (`FrameCell | FrameValue | CubeValue | CubeCell[]`).

### Depth (cached, cube-in-cube only)

Recursion stays fully legal; we make depth VISIBLE rather than capping it (the
Power Query stance the author chose). Every cube carries a cached `depth`: a flat
cube is 1, a cube holding a cube is 2, and so on. It counts CUBE nesting only: a
nested Frame is a leaf (its cells are flat, it can't nest further), so it adds no
depth. Only a cube-in-a-cube creates the unbounded drill-in worth warning about.
Computed once at construction via the single `makeCube` factory, reading each child
cube's own cached depth, so it is a bottom-up O(cells) stamp, not a re-walk per
level. The popup header shows the depth and highlights it when > 1.

Consequence: a Nest Join-built cube (cells are frames) reads as depth 1, which is
correct: the only thing in it that hides further data is a frame, which is a single
bounded drill-in.

## Why recursive nesting (not a flat list of frames)

The design question was: why a recursive cube instead of a simple `[Frame1 …
FrameN]` list of tables?

1. **A flat list of frames doesn't earn a socket type.** The canvas already holds
   N Frame nodes; a list-of-frames value is just that bag with a wrapper, adding no
   relationship between the tables.
2. **Recursion is a strict superset.** A list of frames is a cube with one column
   and N rows. What recursion adds is putting a sub-table in a cell next to key
   columns in the same row (a Customers cube where each row holds id, name, and an
   orders cell). The flat list can't say "this sub-table belongs to this key"
   without a parallel structure.
3. **Closure at arbitrary depth is the "finishes the lattice" claim.** A one-level
   frame-of-frames couldn't represent Customer -> Orders -> LineItems; recursion
   can, at any depth.

Tension with "relational databases": Codd's model is flat (1NF forbids a table in
a cell), with relationships via keys + JOIN. Nesting is really the document model
(JSON, Mongo, pandas/tidyr). The cube is the nested/document value; classic joins
on flat frames are a separate, future concern.

## Producers (how a cube gets made)

A Rete socket carries one value, and there is deliberately no "list of frames"
socket type (the cube IS that type). So you can't have a generic "Build Cube from a
pile of frames" node fed by one ordinary socket; the carrier would already have to
be a cube. The two honest producers route around that:

- **Nest Join** (`NestJoinNode`): parent frame + child frame + a shared key column
  -> a cube where the parent's columns flow through flat and one nested column holds
  each parent row's matching child rows as a sub-frame (a left nest-join; tidyr
  `nest_join`, Power Query "merge, leave collapsed"). The data-driven path that
  makes the relational case effortless. A FRAME parent makes ONE level of nesting
  (depth 1). **Cube-aware mode (2026-06-29): the Parent socket is now `any`, so feeding a
  previous Nest Join's CUBE descends into its nested sub-frames and nest-joins the child
  into each leaf — deepening one level per call (Customer -> Order -> LineItem).
  Recursive (`relateCubeToFrame`), auto-detecting the nested column.** **Cube CHILD
  (2026-07-05): the Child socket is now `any` too, so the right side can be a pre-built
  CUBE — each parent cell nests a sub-CUBE, keeping the child's own nesting (an
  Orders-with-LineItems cube nests whole under Customers in ONE step). This COMPLEMENTS
  the parent-cube path: both build Customer→Order→LineItem, but parent-cube adds a FLAT
  child one level at a time (incremental), while cube-child nests an ALREADY-assembled
  hierarchy (compositional). `relateFramesToCube` groups the cube child's top-level rows
  by key into sub-cubes (`subCube`); a non-scalar child key cell can't join (dropped).**
  The inverse (a cube-aware Unnest that PEELS one level) is still a follow-up — it needs
  an `any`/cube output, since peeling a depth-2 cube yields a depth-1 cube, not a flat frame.
- **Build Cube** (`BuildCubeNode`): a leading column-name input plus extensible
  `any` cell rows. Each row is one cell of a single column; wire a frame/list/cube,
  or type a scalar into an unwired row. This is the manual general constructor and
  the direct answer to "how does a non-frame get into a cell" (it dodges the
  socket-type limit with multiple sockets, like the variadic IFS/CHOOSE nodes). The
  one-input degenerate case is "wrap a value into a cube".

Group-by-into-nesting was considered and dropped as the headline producer: it
assumes a pre-denormalized flat frame, which is the narrow case. It is just the
degenerate Nest Join where parent and child are the same frame; can add later.

## Accessor (reading a cell back out)

Rather than a bespoke "Get Cell" node (a third name for something Excel users
already have words for), the existing **INDEX** is upgraded to be cube/frame-aware:

- Input and output are `any`. INDEX reads a cell out of ANY container: the nth of a
  list (Excel `INDEX(array, n)`), the (Row, Column) of a matrix, or the cell of a
  Frame / Cube. A nested Frame/Cube cell comes out whole, so you pull a sub-table
  out of a cube and keep working on it. `any -> any` keeps every existing INDEX
  cable valid (an `any` output flows into any input).

By-key reading (find the row where key = X, return another column's cell) is
XLOOKUP's job. **Frame Lookup now does this for a Cube too (2026-07-05):** its source
is an `any` socket, so a Cube flows in and it matches the key in the Cube's TOP-LEVEL
column, returning the matched cell WHOLE (a nested frame/cube comes out intact —
drill in with INDEX). Verb: `lookupCubeCell` (`frameVerbs.ts`). This is the cube half
of the future unified XLOOKUP (below); the full three-way merge of list + frame + cube
into one node is still the follow-up.

## Display (the drill-in popup)

A dedicated `CubePopup` (mounted in App, like `TablePopup`), not an overload of the
flat table editor: that grid's per-cell `<input>` model can't host drill-in cells.
It's a general nested-data viewer with ONE drill stack — every nested container
drills in place via the breadcrumb (no second overlapping window). Each cell shows
via `CubeCellChip`:

- scalar / null / error -> inline text
- Frame -> "[R×C Frame]" chip -> drills a frame view in place
- list / matrix -> chip -> drills a grid view in place
- Cube -> "[R×C×D Cube]" chip -> drills a cube view in place

The breadcrumb pops back up a level (Esc pops one, then closes). The header shows
dims + the cached depth (cube views only), so nesting is never hidden. The result
box of every cube node uses `CubeDisplay` (compact preview + chip), dispatched
through the shared `ResultDisplay` (Frame -> FrameDisplay, Cube -> CubeDisplay, else
ValueDisplay) so any `any`-output node renders the right viewer for free.

## How other software does this, and where it frustrates people

Two families: EMBED (the sub-table lives in the cell) vs REFERENCE (the cell points
at rows elsewhere). The cube is an embedder. The recurring user pain is the
"hidden data" problem, which is exactly why depth is surfaced.

- **Power Query / M** (ships in Excel; the closest cousin). A cell holds a `Table`
  value you click to drill into; "Expand" flattens. Pain points reported: the
  standard expand only works when every nested table has the SAME structure;
  expanding several nested columns at once multiplies rows unexpectedly (one column
  fine, two gives 400 rows from 20 records); deep/XML data forces expand-then-
  expand-again; the robust fixes (dynamic column lists, promote-headers-before-
  expand) aren't in the UI and need hand-written M.
- **R / tidyr list-columns**. `nest()` / `unnest()` over data-frame cells. Pain: a
  column of data frames is easily confused with a "list-column of data frames" and
  `unnest()` behaves differently, an "unnecessary trap" hit by common `fromJSON()`
  output; the column-type distinction isn't well surfaced. tidyr 1.0 reworked the
  syntax to be more predictable.
- **MongoDB / Firestore (documents)**. Full recursion. Production advice itself
  validates the depth worry: Firestore actively discourages deep nesting and steers
  you to subcollections (references); Mongo has a doc-size cap and practical depth
  limits. Deep nesting is hard to read and query.
- **BigQuery (STRUCT / ARRAY, nested + repeated)**. Relational but nestable;
  `UNNEST()` flattens. Pain: UNNEST with a comma acts as a CROSS JOIN and silently
  drops rows without matches (you need LEFT JOIN), a common correctness trap;
  newcomers reach for "flatten everything" as a one-size hammer. Upside: nesting
  avoids repeated data and expensive joins.
- **Excel nested arrays**. The instructive GAP: Excel CANNOT put an array inside an
  array; `=MUNIT({1,2})` and TEXTSPLIT-over-a-range raise `#CALC!` "nested array",
  and BYROW chokes on arrays of arrays. The workaround is refactoring with
  HSTACK/VSTACK/REDUCE/LAMBDA to avoid nesting. So spreadsheet users actively want
  a value that holds nested tables and don't have one. A cube fills this directly.
- **Airtable / Notion / SQL (reference side)**. Airtable linked records store a
  pointer, shown as chips, with the data always visible in its own flat table (the
  deliberate cure for hidden depth); complaints are about performance of heavy
  rollups across links and forms not showing linked fields. Classic SQL stays flat
  (foreign keys + JOIN), 1NF by design.

Takeaways baked into our design: (1) surface depth so nesting is never hidden
(the universal frustration); (2) keep a left-style Nest Join so a no-match parent
keeps an empty sub-frame instead of vanishing (avoids the BigQuery comma-UNNEST
row-drop trap); (3) one obvious reader (INDEX) instead of an unnest/expand maze;
(4) since Excel users literally can't nest arrays today, Build Cube + Nest Join give
them the thing HSTACK/REDUCE gymnastics work around.

### Sources

- Power Query expand limitations: https://exceloffthegrid.com/transform-nested-table/ , https://learn.microsoft.com/en-us/power-query/optimize-expanding-table-columns , https://community.fabric.microsoft.com/t5/Desktop/Expanding-columns-after-a-Query-Merge-increases-number-of-rows/m-p/40389
- tidyr list-columns confusion: https://github.com/tidyverse/tidyr/issues/1112 , https://tidyr.tidyverse.org/articles/nest.html
- Firestore/Mongo nesting guidance: https://docs.cloud.google.com/bigquery/docs/best-practices-performance-nested
- BigQuery UNNEST traps: https://medium.com/data-engineers-notes/pay-attention-to-this-when-unnesting-in-bigquery-c06a1e911bef , https://towardsdatascience.com/bigquery-unnest-how-to-work-with-nested-data-in-bigquery-f27006a64c3/
- Excel nested-array gap (#CALC!): https://support.microsoft.com/en-us/office/-calc-error-nested-array-ffa5997d-a440-4e41-aae9-8b39c4a8dfb9 , https://www.icaew.com/technical/technology/excel-community/excel-community-articles/2024/solving-the-array-of-arrays-issue
- Airtable linked records: https://support.airtable.com/docs/understanding-linked-record-relationships-in-airtable , https://community.airtable.com/base-design-9/base-limits-number-of-records-vs-thin-fact-rows-47416

## The table-verb set (decided 2026-06-25 — all five ship, v1.0)

Build the complete verb set. Two distinct axes — easy to conflate, but different:

- **Join** — flat relational join (inner/left/right/outer), fans out into repeated
  rows. Frame -> Frame.
- **Nest / Unnest** — the flat ⟷ cube bridge, lossless (changes nesting depth).
  Frame ⟷ Cube. **Nest Join** already fuses Join+Nest (ships now); the remaining
  gaps are a standalone **Nest** (group one flat frame by key into cells) and
  **Unnest** (cube -> the flat joined table, the inverse). So `Unnest(Nest Join cube)
  = flat joined table`.
- **Pivot / Unpivot** — the long ⟷ wide reshape (changes orientation, stays flat;
  pivot collapses detail via aggregation). Frame -> Frame. NOT the cube round-trip —
  a common confusion (pivot is reshape, nest is embed).

## Cube-awareness of the flat verbs — DECIDED (author sign-off 2026-06-25)

The v1.0 plan asked: when a flat relational verb (filter, sort, groupBy, …) is handed a
CUBE instead of a Frame, does it operate on the cube's TOP level (the parent rows,
nested cells riding along opaquely) or MAP per nested cell (into each sub-frame)?

**Decision (author): a verb operates on the LEVEL it's handed; reaching INTO nested
cells is always EXPLICIT (Unnest to flatten, or a per-cell map), never an implicit
per-verb "cube mode." Cube verbs PRODUCE cubes that stay nested — they don't map over
and flatten.** This is **already enforced + test-pinned by the socket lattice**, not
just convention: a `cube` OUTPUT flows only into another `cube` or `any`, never a
narrower `frame` (`sockets.ts` `accepts()`; `socketConnect.test.ts` "a cube OUTPUT
preserves nesting"). So a flat verb node (which has a `frameIn`) **cannot receive a
cube at all** — you must `Unnest` it to a frame first. There is no code path for a verb
to silently descend into a cube; the type system forbids it. Rationale:
- **Each verb keeps one job.** Auto-mapping would give every verb two semantics
  (top-level vs per-cell) and a mode toggle — N verbs each growing a cube branch. The
  socket lattice already says a cube is the supremum everything widens into; a verb
  should treat the cube it's given as a table of cells, not silently recurse.
- **The cube's power already lives in the bridge, not in the verbs.** `Nest`/`Unnest`
  change depth; the per-group pipeline is the **polyform / per-cell map** (a sub-graph
  applied to each nested frame — the "a cube IS Group By partitions" framing). That is
  the ONE place "do this to each sub-table" belongs, composably, for ANY verb-chain —
  not re-implemented inside each verb.
- **Matches what already shipped.** INDEX is an explicit cube-aware *accessor*; the
  drill-in popup is explicit. Consistent with "make nesting visible, not magic."

Per-verb, on a cube input (top level = the cube's own columns/rows):
- **select / drop / rename** — top-level on the cube's columns (the nested column is
  just another column; rename it, drop it, reorder it). No per-cell form needed.
- **filter / sort / distinct / head** — top-level on the cube's FLAT columns (filter
  parent rows by a key, sort parents, take the first N parents). To filter/sort rows
  *within* each nested frame, Unnest → verb → (re)Nest, or map the verb per cell.
- **groupBy** — a flatten-first concept; group a flat frame (producing nesting is what
  `nest` is for). On a cube, group its flat columns; nested cells are opaque values.
- **join / append** — top-level (join parents on a key; append stacks parent rows).
  Per-cell join is exotic; not a v1.0 verb mode.
- **pivot / unpivot** — flat-only (reshape). A cube is unnested first if needed.
- **nest / unnest** — the bridge itself; the ONLY verbs that change depth.

Net: NO verb grows a hidden cube branch. The cube is reached through `nest`/`unnest`
and the per-cell map. A future "map over cells" mechanism (apply a verb-chain to each
nested frame, keeping the cube nested) is a deliberate, SEPARATE addition on top of
this baseline — not a per-verb default, and not in v1.0.

## Deferred / follow-ups

- **Unnest** + standalone **Nest** (above) — for now INDEX pulls a sub-frame out and
  the existing frame nodes flatten it manually.
- **INDEX — marked for later (2026-07-01):**
  - **Output socket should be Cube, not singular `any`.** `ListIndexNode` output is `anyOut`
    (`nodes/list.ts:148`); when INDEX pulls a nested cell that is itself a frame/cube the value
    rides `any` fine, but the socket TYPE doesn't express Cube. Same "output can be a cube" issue
    as the unified XLOOKUP — decide whether to retype the output as cube when reading out of a
    cube, or present it cube-capably.
  - **Range inputs / range output — Excel parity to consider.** Excel `INDEX(array, row, [col])`
    returns the ENTIRE column when `row=0` and the ENTIRE row when `col=0` (a spilled range), and
    has a reference form `INDEX(reference, row, col, [area])` usable in range construction
    (`INDEX(…):INDEX(…)`). Solenoid INDEX is cell-only. Consider: `row=0`/`col=0` → return a whole
    row/column as a list (dimensional output); whether INDEX should accept/emit ranges. Pairs with
    XLOOKUP's "return the whole row" question below.
- [done] **Unified XLOOKUP** (author decision 2026-07-01; MERGED 2026-07-06) — the list,
  frame, and cube lookups are now ONE `XLookupNode` (in `frame.ts`, named XLOOKUP). It takes
  an `any` source (Frame / Cube / widened list), names an **In column** + **Return** column,
  and returns the matched cell — or the WHOLE matched row when **Return = `*`** (a single-row
  Frame, or a single-row Cube keeping nested cells intact). NO wire-driven / dropdown mode
  swap: the input surface is fixed. The old two-loose-lists XLOOKUP was DELETED — its two
  arrays must be aligned, and by the standing rule aligned columns belong in a Frame (Build
  Frame two lists, then XLOOKUP). `matchMode` (exact / ≤ / ≥) + `searchMode` (first / last)
  carry across frame & cube; the row-finding is shared by cell- and whole-row-return via
  `lookupFrameRowIndex` / `lookupCubeRowIndex` (zero drift) + `frameRowAt` / `cubeRowAt`.
  (Excel's binary search_mode 2/-2 is omitted — on a materialized column it finds the same
  row a linear scan does.)
- [done] Multi-column Build Cube — the **Cube Columns** node (2026-06-29): N extensible
  `any` column inputs (list → cells, single-col cube → its cells, frame/scalar → one
  cell) + a Names CSV, assembled side by side. Composes with the cell-wise Build Cube
  (which makes one nested column). Idea still on the table: a top-edge column-socket
  "grid" Build Cube as a visual flourish.
- **Cube-aware Unnest** (peel ONE cube level): the inverse of the new cube-aware Nest
  Join. Needs an `any`/cube output (a peeled depth-2 cube is a depth-1 cube, not a flat
  frame), so it's a socket-shape change, not just an engine tweak.
- [done] Cube-aware Nest Join (Customer → Order → LineItem) — `relateCubeToFrame`, 2026-06-29;
  cube-CHILD variant (nest a pre-built cube whole) 2026-07-05 (`relateFramesToCube` + `subCube`).
- [done] Seed demoing Nest Join -> INDEX (Customers/Orders) — `seedGraphs/cubes.json`.
