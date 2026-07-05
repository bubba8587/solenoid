# Bundle 15 — Domain verticals: engineering calc, BOM/costing, Parquet

**Source:** scope-features #15 (IN), #16 (IN), #34 (IN).

## #15 — Engineering & scientific calculations (the MathCAD seat) (IN)

**Depends on:** bundle 05 Phase D (units-by-dimensionality) — sequence after it lands.

**Grounding — the existing Convert node to extend, not replace:** `src/graph/nodes/
convert.ts:131`, `export class ConvertNode extends ClassicPreset.Node`. Supporting types
above it: `ConvertCategory` union (lines 9-11: angle/length/mass/temperature/time/area/
volume/speed/energy/pressure), `ConvertUnitDef` interface (13-19), `CONVERT_CATEGORY_LABELS`
(25-36), `CONVERT_UNIT_DEFS` record (38+, e.g. `m`/`km`/`in`/`ft` with `toBase`/`fromBase`
closures). **The engineering vertical should extend `CONVERT_UNIT_DEFS`/`ConvertCategory`
directly** rather than building new conversion infra.

**Build:** an engineering seed doc leaning on units + Convert (bundle 05's `#UNIT!`
error on mismatch), a library of domain constants/formulas (extend `CONVERT_UNIT_DEFS`),
print-quality output via bundle 13's report/static-HTML export. Not a new engine.

## #16 — Bills of materials, recipes, nested-thing costing (IN)

**Depends on:** nothing new.

**Grounding — the existing Cube node classes:** `src/graph/nodes/cube.ts` (190 lines),
three classes:
- `BuildCubeNode` (line 24) — manual cell-wise cube constructor, `data()` at 68-77.
- `NestJoinNode` (line 88) — parent/child frame → nested Cube via a key column; `data()`
  at 106-124, uses `relateCubeToFrame`/`relateFramesToCube` from `../frame`. **This is
  the node the BOM/costing vertical builds on** — a parent (assembly) + child (parts)
  join is exactly the nested-BOM shape.
- `CubeColumnsNode` (line 136) — column-wise cube assembly; `data()` at 177-188.

**No existing BOM/costing-specific helper** — costing logic is new, layered on
`NestJoinNode`'s nested-frame shape (e.g. a roll-up aggregation over nested cells, using
the existing Cube traversal/aggregation machinery rather than new Cube mechanics).

**Build:** a bill-of-materials seed built on `NestJoinNode`, with a leaf-change →
watch-it-ripple demo. Pairs with bundle 09's what-if/goal-seek and bundle 04's
provenance — neither a hard dependency for the seed itself.

## #34 — Parquet & Arrow (IN)

**Depends on:** nothing.

**Grounding — confirmed current Cargo features:** `src-tauri/Cargo.toml:37`:
```
polars = { version = "0.46", default-features = false, features = ["lazy", "strings"] }
```
Only `lazy`+`strings` enabled; no mention of `parquet` anywhere in `src-tauri` (not even
commented out) — must be added fresh to this features list, same edit point as bundle
12's `asof_join`/`decimal` additions (coordinate all three feature-flag additions into
one `Cargo.toml:37` edit if these bundles land close together).

**Build:**
1. Add `"parquet"` to the features list at `Cargo.toml:37`.
2. Wire Parquet read/write as a source node and (once bundle 07's sinks land) an output.
3. Share the direct-file→engine path with bundle 06's direct-CSV→Polars-reader work
   (both bypass the JS `csv.ts`/`frameFromCells` inference step described in bundle 06's
   grounding) — build the underlying "native file → engine, never materializes in JS"
   plumbing once, feed both CSV and Parquet through it.
4. Typed columns arrive intact — no inference step needed, unlike CSV.

## Exit criteria

An engineering-calc seed demonstrates units-as-values + Convert (extended
`CONVERT_UNIT_DEFS`) with `#UNIT!` on mismatch; a BOM/nested-costing seed built on
`NestJoinNode` demonstrates leaf-change ripple; Parquet read/write works via the
`"parquet"` Cargo feature, sharing the direct-file-to-engine plumbing with bundle 06's
CSV reader.
