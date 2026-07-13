# Bundle 05 — Units by dimensionality (FC A4, the flagship) — ✅ COMPLETE

> **DONE 2026-07-13.** The value engine computes with dimensions end-to-end, the
> Format Controller is VALUE-MUTATING (it authors the value's unit), Convert tags
> its output, the redundant graph unit-walk is gone, and REDUCE/BYROW/BYCOL carry
> units over a 1-D list. All exit criteria met (below). Remaining items are the
> author-present polish tracked in `backlog.md` (per-cell mixed-unit trig; frame
> popup column-unit rendering) — not part of this milestone.


> **Rewritten 2026-07-05.** Phases A–C of the original bundle (the FC function
> model, the visual redesign + SegToggle unification, the docked-FC movement
> audit + mis-dock fix) ALL SHIPPED 2026-07-05 — see `docs/format-model.md`,
> the daytime session digest, and git history. This doc is now ONLY the units
> milestone (the old Phase D). It supersedes the archived `v1.1-plan.md` A4.

**Scope (author, 2026-07-02 — expanded past the original A4 framing): full
dimensional algebra.** True unit calculation: `5 m ÷ 1 s = 5 m/s`; `mass · accel
→ N`. Not just label-carrying.

**Author decisions already on record — don't re-ask:**
- **Per-element list units = TAGGED CELLS** (a list is a ROW and must allow mixed
  units), mirroring how `valueKinds.ts` carries per-cell `null`/`SolError`. The
  "parallel unit array vs tagged cell" fork is CLOSED.
- Matrix = unit-AGNOSTIC always. Frame = units PER COLUMN (a frame row IS a list).
- FCs can tag STRING-LIST header keys; Build Frame / Add Column LOCK each column
  to its header's unit (`[id, Item, Revenue ($0.00)]` + `[5,6,7]` → `[$5.00, …]`,
  the per-column FC locked).

## Foundation already landed (don't rebuild)

- **`src/graph/dimension.ts`** (+ `dimension.test.ts`, 19 tests): exponent-vector
  units + SI scale + affine offset, the ×/÷/^ algebra, commensurability,
  conversion (incl. C/F/K), a unit-expression parser, derived-unit formatting.
  **The Convert node already sources its math from it** — proven load-bearing.
- **`#UNIT!`** exists in `errorValue.ts`.
- **`docs/format-model.md` + `formatModel.ts`** — the render-side model. The units
  work extends the ANNOTATION/value layer; the truth-table gates stay.

## Current state to replace

- Unit is a single scalar per socket/value: `FormatAnnotation.unit: string`
  (`formatAnnotationStore.ts`).
- `src/graph/unitFlow.ts` — the v0.9 walk resolvers. **DELETED, not extended**,
  per the verdict; re-express lock/carry/break on the new type layer. NOTE
  (2026-07-05): the file now ALSO hosts `resolveValueOrigin` (the popup
  "Go to source" upstream walk) — that must survive the replacement (same
  duck-typed per-node rule, different payload).
- `FrameColumn.unit?: UnitSuffix` (`frame.ts`) — vestigial (never written by
  `buildFrame`; only copied by a row-slice helper). Replace with the real
  per-column representation.
- `valueKinds.ts` — the per-cell tag pattern + the `forAggregate` chokepoint to
  mirror: a per-element unit tag rides inside list cells the same way, with its
  own chokepoint every list-consuming node calls.
- **Acceptance:** `seedGraphs/unit-flow.json` — 5 labeled lanes (downstream carry ·
  upstream reach · transform break · Convert forwarding · selector pass-through).
  Must still pass after `unitFlow.ts` is deleted and replaced.

## Foundation layer LANDED 2026-07-12 (pure, tested — wiring pending)

Steps 1/2/3 + 6 shipped as PURE modules (no editor/React/node deps), the same way
`dimension.ts` landed before Convert wired it. They are cherry-pickable and green
but NOT yet wired into the live value engine — that wiring (and steps 4/5/7) is the
author-present half.

- **`src/graph/unitValue.ts`** (+ `unitValue.test.ts`, 21 tests) — steps 1/2/6 core:
  - **`UnitCell`** — the tagged list-element cell (author's tagged-cell decision).
    Stored **base-SI magnitude + dimension vector**; a dimensionless quantity stays
    a bare `number` (so today's untagged lists are unchanged, and `isUnitCell` is a
    clean discriminator). `fromUnit(value, Unit)` normalises to base (consuming the
    affine °C offset). Constructor `tagDim` enforces "dimensionless ⇒ bare number".
  - **Per-cell algebra** — `mulUnits`/`divUnits`/`addUnits`/`subUnits`/`powUnits`/
    `compareUnits`. `5 m ÷ 1 s = 5 m/s`, `mass·accel → N`; `+`/`−`/compare demand
    commensurability (else `#UNIT!`); cancellation free (`5 m ÷ 1 m = 5` bare).
    Base-SI storage makes `+` a plain magnitude add (km + m already unified).
  - **`forAggregateUnits`** (step 6) — the unit-aware sibling of
    `valueKinds.forAggregate`: error propagates, `null` skipped, all present cells
    must share one dimension (mixed → `#UNIT!`); commensurable-but-differently-
    authored cells are already unified by base-SI storage, so "convert if
    commensurable" is automatic.
  - **`ColumnUnit`** — the per-column frame representation (dim + optional display
    unit id). NOT yet on `FrameColumn` (left as the vestigial `UnitSuffix` to avoid
    a mid-flight type change to a hot shared file; wire when producers write it).
- **`src/graph/unitDimExpr.ts`** (+ `unitDimExpr.test.ts`, 20 tests) — step 3: a
  dimensional interpretation `dimEval(Ast, DimEnv)` over `excelFormula`'s AST.
  Operators by the algebra; a per-function signature table (dimensionless-in
  transcendentals; preserve-dim ABS/MIN/MAX/SUM; multiply PRODUCT; SQRT halves;
  `^`/POWER need a constant exponent; IF branch agreement). Returns
  `Dim | #UNIT! | null` (null = indeterminate — drops the unit, not a conflict).

**Still to wire (author-present):** the live broadcast/aggregator paths
(`nodes/shared.ts`) tagging + reading `UnitCell`; `FrameColumn` adopting
`ColumnUnit`; Expression/LAMBDA calling `dimEval` for its result unit; then steps
4/5/7 below. `unitFlow.ts` is UNTOUCHED (step 4 not started).

## LIVE WIRING SHIPPED 2026-07-12/13 (steps 1–7 all wired)

The foundation modules are now WIRED INTO THE VALUE ENGINE and the socket/seed/UI
surfaces. Every build-order step below is done; the value layer computes with units
end-to-end. See `unitWiring.test.ts`, `unitColumn.test.ts`, `unitLattice.test.ts`,
`unitsSeed.test.ts` (45 new tests). Key deltas:
- **`unitBridge.ts`** — FC unit ids ⇄ `dimension.ts` Units (the display-layer ↔
  value-layer lookup). **`unitColumn.ts`** — `Name (unit)` header parser + column
  display helpers.
- **`shared.ts` `broadcastUnit` / `anyDimensioned`** — the dimensional twin of
  `broadcastErr`; plain-number data is byte-identical (gate), units only bite when a
  `UnitCell` is present.
- **`ArithmeticNode`** (+−×÷ mod pow), **`MathFnNode`** (per-op dimensional
  signature), **`ExpressionNode`** (`dimEval` in parallel with the numeric run),
  **`AggregateNode`** + **`SumIfsNode`** (`forAggregateUnits`), **`GetColumnNode`**
  (a unit-locked column tags cells on the way out), **`NumberInputNode`** (a `unit`
  field + picker — the scalar entry point).
- **`FrameColumn.unit`** is now the real `ColumnUnit`; `buildFrame` / `addColumn`
  lock a column from a `Name (unit)` header. Worked example lives in
  `seedGraphs/units-by-dimension.json`.
- **Display**: `unwrapUnitCells` renders a dimensioned cell as "magnitude symbol"
  (5 m/s), or unwraps to a docked FC's display unit; an unannotated `UnitCell`
  renders in its own authored `display` unit (`formatCellWithDisplay`).
- **FC is VALUE-MUTATING (unification landed 2026-07-13)**: `UnitCell` gained an
  optional `display` id; `FormatControllerNode.data()` tags the value via
  `applyFcUnit` (author / re-display / `#UNIT!`), Convert tags its output too, and
  `NumberInput` carries its picked unit as the display id. The redundant graph
  unit-walk (`makeUnitResolver` + the FC forwarding / Convert-lock logic) is
  DELETED — the unit rides the value and breaks at a transform on its own.
  `unitFlow.ts` now carries only the number-FORMAT annotation
  (`makeAnnotationResolver`) + `resolveValueOrigin`. The Unit Flow seed's 5 lanes
  were re-authored to the value-mutating model and pass.
- **LAMBDA hosts**: REDUCE / BYROW / BYCOL run `dimEval` alongside the numeric fold
  (strip → interpret → re-tag; `#UNIT!` on a clash); MAP/MAKEARRAY/SCAN stay
  matrix-agnostic.
- **Step 7 reality**: units ride INSIDE values (runtime tags), so they mint no new
  static socket types and add no `accepts()` edges; the separation is a COMPUTE-time
  `#UNIT!`, machine-checked by `unitLattice.test.ts`'s full dimensional sweep.

## Build order

1. **Value model:** tagged-cell unit on list elements (exponent vector + scale via
   `dimension.ts`); per-column unit on frames; matrices opt out. Save format
   changes freely (pre-alpha — update seeds + tests, no migration).
   → **core shipped in `unitValue.ts`; live-node wiring pending.**
2. **Algebra at the ops:** × adds exponents, ÷ subtracts, +/− requires
   commensurability (else `#UNIT!`), powers scale, cancellation free. Derived-unit
   display (m/s, N, W) is formatting over the vector.
   → **shipped as pure per-cell ops in `unitValue.ts`; wiring into `broadcast*` pending.**
3. **Expression/LAMBDA:** a second dimensional interpretation over the formula AST
   (`excelFormula.ts` `Ast`) — operators by the algebra, catalog functions by
   per-function dimensional signature.
   → **DONE. `unitDimExpr.ts` `dimEval` runs in `ExpressionNode` and the LAMBDA
   hosts REDUCE/BYROW/BYCOL over 1-D lists.**
4. **Replace `unitFlow.ts`:** re-express the v0.9 lock/carry/break semantics on the
   new layer; keep `resolveValueOrigin`; verify against the Unit Flow seed's 5 lanes.
   → **DONE 2026-07-13. The FC is value-mutating; `makeUnitResolver` + the
   forwarding/Convert-lock logic are deleted (the unit rides the value); the number
   FORMAT stays an annotation; `resolveValueOrigin` kept; the 5 lanes re-authored + green.**
5. **FC → header keys:** an FC tags a string-list element; Build Frame /
   Add Column pull + lock the column unit. The worked example above is the
   acceptance demo.
6. **Aggregators:** SUM over mixed units → convert if commensurable, else
   `#UNIT!` (parallel to the element-family `#TYPE!` separation).
   → **shipped as `forAggregateUnits` in `unitValue.ts`; wiring into the reducer
   nodes pending.**
7. **Socket lattice:** units as the finer-grained sibling of element-family
   separation, machine-checked with a `socketConnect.test.ts`-style full sweep.
   → not started (deep `accepts()` change; author-present).

## Exit criteria — ✅ all met

A unit rides per-element through a list and per-column through a frame with true
dimensional algebra (`#UNIT!` on mismatch); `5 m ÷ 1 s` reads `5 m/s`; the
header-list → locked-column worked example loads in a seed; the Unit Flow seed's
5 lanes pass with the graph unit-walk gone (the FC value-mutating); the number
FORMAT stays a display annotation; `resolveValueOrigin` still powers the popup
crosshair.
