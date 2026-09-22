---
aliases: ["Unit flow"]
tags: [spec, values]
---
<!-- [[C25]] firstClassUnits, [[D40]] unitOnValue, [[D41]] formatFlowsDownstream, [[D43]] unitByGranularity, [[D47]] noMixCurrencies -->

# Spec: Unit flow

Serves [[C25]] firstClassUnits and its policies [[D40]] unitOnValue, [[D41]] formatFlowsDownstream, [[D43]] unitByGranularity, [[D47]] noMixCurrencies. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

There are two layers. **The unit is a property of the value**: it travels as data on the value itself. **The number format** (style, precision, negatives, K/M/B) is a separate display annotation that an FC locks onto its own segment and sends down the stream. Nothing walks the graph to propagate units; `makeAnnotationResolver` (pure, duck-typed, memoized, cycle-guarded) resolves the format, forward and back.

## The unit on the value

- **What it is.** A base-SI `UnitCell` (`unitValue.ts`) with an optional `display` id.
- **Who sets it.** Only the value's origin:
  - an FC, through `applyFcUnit` in `FormatControllerNode.data()`;
  - Convert, in its `data()`;
  - the column-unit surfaces, a `Name (unit)` header spec or the popup's per-column unit dropdown, stored as a `ColumnUnit` that computed columns carry too (`unitColumn.ts`);
  - Table Input's own unit picker (the `author` policy in `matrixUnitPolicy.test.ts`).
  The Number node is a plain literal source and sets nothing.
- **How it travels.** The tag rides through anything that passes the value along. A transform works the dimension out again through the algebra (`tagDim`) and keeps an operand's `display` when the result's dimension matches it (`$5 + 2 = $7`, `2 × 3 m = 6 m`). A result whose dimension fits neither operand falls back to its derived-symbol form.

### `applyFcUnit(value, fcUnitId, customUnit?)`

The value-side author, in `unitBridge.ts`. The third argument is the custom-name path; a two-argument call silently drops custom units.

| Input | Result |
|---|---|
| a dimensionless number + a real unit | a base-SI `UnitCell` that reads the magnitude as that unit: `5` + km is 5000 m, displayed as km |
| a dimensioned cell + a commensurable unit | re-display: the base stays, `display` changes |
| a dimensioned cell + an incommensurable unit | `#UNIT!`. A real dimension clash is reported, never silently overwritten |
| a pure ratio | `#UNIT!`. Its units canceled, so it can't be relabeled |
| a non-blank **custom** name | an opaque `customDim` tag. Only `none` or a blank custom name passes through |
| a numeric **matrix** | tagged through `withMatrixUnit` on a freshly `slice()`d outer array; never tag the shared cached array |
| text or a Frame | passes through, and any existing tag rides on |

Convert authors the same way: base-SI plus the target unit's display, and `#UNIT!` when an input that already has a dimension clashes with the target.

**Every Convert unit id must be registered with the display bridge** (`unitBridge.ts`). Then a `UnitCell.display` that Convert set (yd, psi, km_h…) resolves at render time even with no FC-registry twin. Unregistered, the downstream value box shows the base-SI derived symbol and Convert loses control of the value's unit. `guardCell` (`shared.ts`) keeps `display` through the broadcaster.

## The format annotation

### Per-node rule (`makeAnnotationResolver.compute`)

- **Convert** drops the inherited format. It sets a new unit and rescales the number, so the old precision no longer fits. It is the one transform that drops.
- **Per-output producer** (`hasAnnotationFor`, `annotationFor(outKey)`): each output carries its own lock. When it returns none for an output, it falls through to the transform carry below. So a Triangle side or Element Z stays bare (no `formatCarry`), while MathFn's abs and round still carry, which is how abs(−5%) stays a percent.
- **FC or node-level producer** (`hasAnnotation`) locks its own format.
- **Passthrough** (`isPassthroughNode`, driven by the one `passthrough()` declaration; Display and similar) carries its input's format. `passInputKeys` names the value branches, and the data-aware `selectedPassInput` picks the branch it actually computed, so `IF(true, km, mi)` follows `then`. An undetermined pick combines, and a conflict gives none.
- **Conduit lanes:** `out_i` inherits `in_i`, duck-typed on `cachedLane`, on purpose with no `passthrough()` declaration.
- **Anything else is a transform** and carries the format only where the node declares the op keeps the value's meaning. `carriedFormat` reads `formatCarry()`, whose per-op map lives in the node's op table. An undeclared transform carries nothing, so multiply, divide, power, count, variance, product, rates, z-scores and finance outputs show plain. Among the declared inputs, the first wired, annotated input of the same element family wins, and the copy has `unit: "none"`. Two date-styled operands make a span (date − date, NETWORKDAYS) and carry nothing ([[D41]] formatFlowsDownstream).

### Both directions, bounded only upstream

- **Downstream:** a box after the FC inherits through `inAnnotation`, walking back through passthroughs and through declared meaning-preserving transforms, with no limit until a nearer FC overrides.
- **Upstream:** a box before a trailing FC, even several hops back, inherits through `downstreamAnnotation`, walking forward through pure passthroughs only and stopping at the first transform. A format chosen after a transform says nothing about the value before it.
- Both are derived on read, so a box's own direct FC (`getForNode`) always wins, and two FCs in one segment don't overwrite each other.

### Who writes and who derives

- An FC's `refreshAnnotation` writes its format annotation onto its immediate input-source box, one hop, into `formatAnnotationStore`, keyed `nodeId::socketKey`. `findDockTarget` snaps to the nearest socket.
- The unit lock states are live, derived from the value in `data()` plus `refreshAnnotation`'s check for a Convert ahead:
  - `lockedByConvert`: the Convert ahead dictates the FC's from-unit.
  - `forwarding`: the incoming value already carries a unit, so the dropdown mirrors it and locks. An inherited unit belongs to the value and was set elsewhere in the chain; Convert is the tool for changing it.
  - Only an FC on a value with no unit sets one freely.
- **Reading:** a hero row's `ValueDisplay` names its `socketKey` and reads only that socket's annotation. `DisplayNode` reads `getForNode ?? inAnnotation("in") ?? downstreamAnnotation("out")`. A `UnitCell` with no annotation renders in its own `display` unit (`formatCellWithDisplay` in `valueDisplayFormat.ts`); an annotated one unwraps to the annotation's unit, which the FC keeps in sync with `display`.

## The one compute-time unit read (`trigMode.ts`)

A Math node's trig op in **Auto** angle mode computes in degrees when the value feeding it carries a `deg` format annotation, from a producer that emits bare degrees (Triangle Solver, inverse trig in degrees), read through `makeAnnotationResolver.inAnnotation`. An angle with a real dimension is already stored in base radians, so `MathFnNode`'s unit-aware path computes on its magnitude directly. `resolveTrigModes(editor)` runs from `processGraph` before the engine pull and stamps a transient `_resolvedAngleMode`. Machine-checked by `trigMode.test.ts`.

## Currency: the display code is the identity

There are no exchange rates (`unitValue.ts` `currencyMismatch`). Every currency sits on the single `currency` base axis at scale 1 (unitBridge's DIRECT), so `$5` and `5€` store the same base magnitude, and a plain magnitude compare, add or aggregate would call them equal. So two currency cells with different explicit `display` codes are incommensurable:

- `compareUnits` (behind `ComparisonNode`, which is `unitAware`) returns `#UNIT!`. Equality then answers FALSE for `=` and TRUE for `≠`, and ordering (`<`, `>`) passes the `#UNIT!` on.
- `arithmeticCell` has the guard up front, so every op errors, including multiply and divide, which would otherwise invent an exchange rate. `forAggregateUnits` returns `#UNIT!` too.
- A currency cell with no code, such as a computed `currency` result, adopts the other side's code.

Every other dimension works on plain magnitudes, since km and m already differ in scale. `ComparisonNode` being `unitAware` is also what makes `5 km = 5000 m` compare in base SI. A dimensionless operand adopts the other side's unit in a compare (`$5 > 1000` compares 5 with 1000), matching the additive rule. Machine-checked by `unitValue.test.ts` (the currency block) and `logic.test.ts` ("ComparisonNode is unit-aware").

## LAMBDA hosts over a 1-D list

REDUCE, BYROW and BYCOL strip tagged cells to base-SI magnitudes for the numeric fold, run `dimEval` (`unitDimExpr.ts`) with the fold and aggregate variables bound to the element's dimension to get the result's dimension, and re-tag, keeping `display` when the dimension is unchanged. Mixed units or a clash inside the formula give `#UNIT!`, and a formula that yields a plain count (COUNT) strips to a plain number. MAP, MAKEARRAY and SCAN ignore units on matrices (`tableLambda.ts`).

## One idea, a carrier per rank

A unit attaches where values are guaranteed to match ([[D43]] unitByGranularity):

| Rank | Carrier | Cells |
|---|---|---|
| scalar | a value-level `UnitCell` | base SI |
| list | a `UnitCell` per cell, mixed allowed | base SI |
| frame | a `ColumnUnit` on `FrameColumn.unit` | as typed |
| matrix | one `ColumnUnit` for the whole grid, as a non-enumerable Symbol tag (`unitValue.ts`) | as typed |
| cube | per cell, like a list; a dimensioned cell is a base-SI `UnitCell` (`CubeCell` includes it) | base SI |

`cubeCellsFromColumn` tags a Frame column into the Cube, and `inferColumn` recovers a uniform column unit on the way back (`cellToNumber` and `cellKeyId` read the display magnitude).

**Watch the storage split.** Scalar and list `UnitCell.value` is base SI, but frame and matrix cells are as typed, so crossing between them converts: `tagFrameCellUnit` goes from as-typed to a base `UnitCell`, and `displayMagnitudeOf` and `matrixCellsFromList` go from base to as-typed.

**The matrix tag is lossy**, since any array rebuild drops the Symbol. So every matrix op declares a policy:

- **carry**: structural reshapes.
- **carry-if-uniform**: VSTACK and HSTACK (`sharedMatrixUnit`).
- **convert**: rank changes cross carriers. TOCOL and TOROW go to a list (`taggedListFromMatrix`); WRAPROWS and WRAPCOLS come from a list (`matrixCellsFromList`).
- **strip**: MMULT, MDETERM, MINVERSE.
- **na**, and **author** (Table Input).

A new algebra op sets `unitAware = true`. A new numeric-matrix input is re-carried across `toMatrix` in `coerceValue`'s `table` case. `matrixUnitPolicy.test.ts` tests each policy and fails the build when a `matrix.ts` node takes a matrix without a declared policy. A `MatrixValue` wrapper was rejected ([[D43]]): the fragility is confined to rebuild sites, so a declared policy plus the guard beats churning the universal `toMatrix` and `toScalar` coercers.

## A Frame's per-column format rides the value

`FrameColumn.format` flows downstream like `FrameColumn.unit`, not through the annotation resolver. The coercion wrapper's output step (`coerceInputs.ts` `wrapNodeData`, the one seam every node's `data()` result passes, a composite's inner editor included) stamps each emitted Frame with that node's own `frameFormatStore` picks, memoized on the Frame's identity so the backend's upload cache still hits.

- Verbs that spread columns carry it. A column a verb builds takes a source column's format only where it already takes the unit (nest, the Allocator's Allocation).
- `frameFormatStore` is the one saved home, keyed by the node that picked. `format` is worked out on every compute and never saved.
- Readers take the local pick first and the carried one second (`FrameDisplay.annFor`, the popup's format row).
- Machine-checked by `frameColumnFormat.test.ts`.

## Enforcement

`unitFlowAnnotation.test.ts` (the format direction rules and `applyFcUnit`'s value-changing cases), `unitFlowSeed.test.ts` (one `it` per captioned behavior in the **Unit Flow** seed, A to J), `convert.test.ts` (Convert tags its output) and `tableLambda.test.ts` (units through LAMBDA hosts).

## Related

What an annotation renders is a separate model: `docs/format-model.md` and `formatModel.ts`. That covers the per-family control truth table (which FC controls exist for each socket type, hidden and inert rather than disabled and visible), the one precision × style rule, and the advanced tier (grouping, negative styles, K/M/B scale). `formatModel.test.ts` checks the whole `SocketDataType` union against it. `resolveValueOrigin`, in the same file as the resolvers, is the popup's "Go to source" upstream walk: the same per-node rule with a different payload.
