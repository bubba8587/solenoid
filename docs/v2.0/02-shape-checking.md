# Bundle 02 — Static shape-checking pass (Bet 3)

**Source:** `future-directions.md` Bet 3. **Verdict:** IN. **Depends on:** nothing.
**Gates:** bundle 08 (transpiler needs range→frame typing), bundle 09 (subgraph typed
boundary), bundle 13's report-file typed refs, and every "verdict pending" item that
leans on it (#2 publish, #5-as-ecosystem if ever revisited).

## What exists today

The type system checks one plug against one socket at cable-draw time. It does **not**
carry a whole table's shape (column names + types) down a chain — you only discover a
Join produced a duplicate column name, or a mismatched key, by *running* it. This is
also where the desktop (Polars) and web (JS) engines have historically drifted, caught
only by hand-written parity tests.

## The change

A pure function per verb: `shapeOf(verb, inputShapes) -> outputShape`, plus a static
walk over the graph that propagates shapes ahead of execution — reusing the same verb
definitions the relational engine already has (`frameVerbs.ts`).

## Build order

1. Define the shape type: column names + element types (reuse the existing element-family
   taxonomy from the socket lattice — number/string/date/logical/complex — not a new
   type universe).
2. Write `shapeOf` for every verb in `frameVerbs.ts` (Filter, Sort, Join, Group By,
   Append, Distinct, Rename, Select, Drop, Pivot, Unpivot, Nest, Unnest, Frame Lookup,
   Split Column, Add Index) — each verb already knows how it reshapes a table; this
   lifts that knowledge into a standalone function, not a side effect of running it.
3. Static walk: given a graph, propagate `shapeOf` forward from every source node,
   producing a shape for every table cable. Pure, no engine call.
4. Surface it: show the computed shape at the cable inspector that already exists (hover
   a cable, see its type today — extend to show column names/types for table cables).
5. Parity gate: both backends (Rust/Polars, JS oracle) must produce output matching the
   ONE declared shape. Where they don't, that's now a caught seam error instead of a
   silent divergence — wire this into the existing cargo/vitest parity-test harness.
6. Later (not blocking exit criteria): refuse-to-run mode — a graph whose static shapes
   don't line up (e.g., a Join on mismatched key types) errors before any engine call.

## Exit criteria

Every table cable in a graph has a statically-computed shape (columns + types) visible
before running; both backends are checked against that one declared shape in the parity
suite; the cable inspector shows it. Refuse-to-run is a stretch goal, not required to
close this bundle — later bundles (08, 09, 13) only need the shape *computation*, not
the refusal behavior.

## Note for downstream bundles

Bundle 08 (transpiler) needs this for turning `.xlsx` ranges into typed frames. Bundle 09
needs it for the subgraph's typed input/output boundary. Both can start their own
non-shape-dependent groundwork in parallel with this bundle, but their shape-typed pieces
block on this landing.
