# Bundle 15 — Domain verticals: engineering calc, BOM/costing, Parquet

**Source:** scope-features #15 (IN), #16 (IN), #34 (IN). Grouped as "positioning + a few
nodes on machinery that already exists" — none of the three depend on each other.

## #15 — Engineering & scientific calculations (the MathCAD seat) (IN)

**Depends on:** bundle 05 (units-by-dimensionality) — this vertical's entire pitch rests
on units-as-values being real, not a side-system. Sequence after bundle 05 lands (at
least Phase D).

**Why Solenoid is close:** a unit system that travels with values already exists
(`unitFlow.ts` today, replaced by bundle 05's type-layer version), plus a Convert node —
the single hardest thing to retrofit, already built.

**Build:** an engineering seed doc that leans hard on units + Convert, demonstrating a
"unit mismatch is an error, not a coercion" mode (bundle 05's `#UNIT!`). Not a new
engine — a seed + a library of domain constants/formulas + print-quality output
(bundle 13's report/static-HTML export). See if an actual engineer flinches at it or
leans in — this is a positioning bet more than a code bet.

## #16 — Bills of materials, recipes, nested-thing costing (IN)

**Depends on:** nothing new — the Cube (recursive nested-table container) already
exists and is the hard part.

**Build:** a bill-of-materials seed built on the Cube, with a leaf-change → watch-it-
ripple demo (change the price of one screw, watch every product that uses the assembly
that uses it update). Pairs naturally with bundle 09's what-if/goal-seek ("what does
hitting a target cost roll down to?") and bundle 04's provenance ("this total moved
because that leaf moved") — neither is a hard dependency for the seed itself, but both
sharpen the demo if available. Small-to-moderate stretch — this is mostly positioning +
a few Cube-aware nodes, not new architecture.

## #34 — Parquet & Arrow (IN)

**Depends on:** nothing — nearly free on desktop.

**Build:**
1. Enable Parquet read/write as a cargo feature flag (currently only `lazy` + `strings`
   are compiled in) — Polars reads Parquet natively.
2. Wire it as a source node and, once bundle 07's sinks land, an output.
3. This is the same "direct file→engine path, never materializes in JS" pattern bundle
   06's WS-E direct-CSV-reader item wants — build them together or at least share the
   plumbing; don't duplicate the file→engine path logic.
4. Typed columns arrive intact (no CSV-style inference step needed).

## Exit criteria

An engineering-calc seed exists demonstrating units-as-values + Convert with loud
mismatch errors; a BOM/nested-costing seed on the Cube demonstrates leaf-change ripple;
Parquet read/write works as a native cargo-flag feature sharing the direct-file-to-engine
path with the CSV reader work in bundle 06.
