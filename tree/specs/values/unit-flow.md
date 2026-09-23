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

## Dimensions (`dimension.ts`)

The foundation under every unit. It imports nothing from the editor, React or any node.

- **A dimension** (`Dim`) is a map of exponents over the base axes, with an absent key meaning 0. The base axes (`BASE_DIMS`) are SI's seven (length, mass, time, current, temperature, amount, luminous) plus three first-class app axes: angle, currency and information.
- **A custom unit** (a free-text FC unit) gets its own axis, `custom:<name>` (`customDim`), so it stays first-class in the algebra ([[C25]] firstClassUnits). The axis name is trimmed and lowercased, so two FCs that differ only in case add instead of raising `#UNIT!`; the typed casing survives on the annotation's display id. Every dimension operation folds over every axis present in either operand, so a custom axis is never dropped.
- **A unit** (`Unit`) is a dimension plus its relation to base SI: a linear `scale` and, for temperatures only, an affine `offset`. An offset unit converts but can't be multiplied, divided or raised to a power: `unitMul`, `unitDiv` and `unitPow` answer `null`, which callers surface as `#UNIT!`.
- **Commensurable** means the same dimension, so a conversion factor exists. `convert(value, a, b)` goes through base SI with both offsets and answers `null` when the units are incommensurable or the result is not finite; the caller turns that into `#UNIT!`.
- **`UNITS`** is the one table of unit magnitudes, keyed by canonical symbol, with every `scale` relative to base SI; the Convert node's category table takes its factors from here. It holds the dimensionless `1` and `%` (0.01), length (m, in, ft, yd, mi), mass (g, kg, t, lb, oz, stone), time (s, min, h, day, wk, yr), A, mol, cd, angle (rad, deg, grad), temperature (K, and the affine degC, degF), information (bit, byte), currency (`¤`), and the derived Hz, N, Pa, J, W and the litre (`L_vol`). Derived units carry their full dimension so the algebra and the formatter recognize them.
- **`parseUnit(expr)`** reads a unit expression ("m/s", "kg*m/s^2", "km/h", "m2"). A bare recognized symbol short-circuits, which keeps affine units that a product would reject. Otherwise the grammar is factors joined by `*` or `·`, with at most one `/` denominator; a factor is a symbol with an optional `^n` or trailing-digit power, resolved against `UNITS`, the litre (`L` or `l`), or one SI prefix (`SI_PREFIXES`, yotta to yocto, `u` and `µ` both micro, `da` tried first) on a linear base symbol. Anything unrecognized gives `null`.
- **`formatDim(dim)`** is the display symbol: a named derived unit where one matches exactly (N, Pa, J, W, Hz, V, Ω, most specific first), otherwise a product of base symbols (m, kg, s, A, K, mol, cd, rad, ¤, bit), base axes first and then custom axes by name so the label is stable, with `^n` powers and one `/` for the negative exponents. A dimensionless value gives `""` and shows bare.

## Unit algebra (`unitValue.ts`)

The value-side model is small and strict. Every tagged value stores its magnitude in base SI.

### The cell

- A `UnitCell` is `{ __unitCell: true, value, dim, display?, ratio? }`. `value` is always base SI; `display` is the unit id the value was authored to render in, and without one the value renders its dimension's derived symbol (`formatDim`: "m/s", "N").
- A dimensionless quantity is never a `UnitCell`; it stays a bare `number`, so `isUnitCell` is a clean test. `tagDim(value, dim, display?)` is the one constructor, and every algebra result goes through it, so a dimensionless result always collapses to a bare number.
- The one exception is a **pure ratio** (`10 m ÷ 2 m`), minted by `tagRatio` with an empty `dim` and `ratio: true`. It is known to be dimensionless, so an FC can't relabel it with a physical unit, and it renders as `5:1`. Bare ÷ bare stays a bare number.
- `fromUnit(value, unit)` converts a named-unit magnitude to base SI and consumes any affine (temperature) offset there, so a stored value stays linear and `+` and `−` stay plain adds. `withDisplay` is the FC and Convert re-display path, a no-op on anything that isn't a cell.
- `dimOf` answers dimensionless for `null`, a `SolError` or anything non-numeric; `magnitudeOf` answers `NaN` for anything non-numeric, which is safe because the caller's `cellShortCircuit` runs first.

### Combining two operands (`arithmeticCell`, `compareUnits`)

The dimensional half of an element-wise op sees only present operands, since the per-cell contract ([[error-values]]) runs first. In order:

1. **Different currency codes** give `#UNIT!` in every op, checked up front so no op below can forget it ([[D47]] noMixCurrencies).
2. **A dimensionless operand adopts** the other side's display unit for `+`, `−` and `mod`: `adoptMagnitude` multiplies it by that unit's scale, never its affine offset, because the bare number is read as a delta. In a comparison it is read as a reading instead (`adoptReading`, offset included), so `25 °C > 30` is FALSE. `×` and `÷` keep the face value, since a bare factor is a factor (`$5 × 2 = $10`).
3. **Add, subtract and mod** need equal dimensions, or one dimensionless side; otherwise `#UNIT!`. The result keeps `display` from the first operand that has one.
4. **Two absolute temperatures** (an affine display such as °C or °F on both cells) combine to a delta: `25 °C − 20 °C` is 5 K, never −268 °C, so the affine display drops and the base unit renders. One absolute reading plus a bare delta keeps the reading (`20 °C + 5 = 25 °C`).
5. **Multiply, divide, quotient and power** are refused on an affine display ("Convert the temperature to kelvin first"), because an offset reading is not a magnitude. `×` and `÷` keep a display unit only when the result stays in an operand's dimension; `5 m × 3 s` fits neither and shows the derived symbol. A division that cancels the dimension between cells mints a pure ratio. Division or quotient by zero is `#DIV/0!`. An exponent must be dimensionless, or the result is `#UNIT!`.
6. **Comparison** refuses two different real dimensions and two currency codes with `#UNIT!`, and otherwise hands the comparator the two base magnitudes, adopting as in step 2.

The display-id resolvers (`setDisplayScaleResolver`, `setDisplayOffsetResolver`) start on `parseUnit` and are upgraded by `unitBridge.ts` at module load, so every display id the bridge knows resolves.

### Reducing a list (`forAggregateUnits`)

The unit-aware twin of `forAggregate`, run first by a list reducer:

1. A `SolError` anywhere returns that error; missing values are dropped.
2. A first pass finds the list's one real dimension and its display; a second real dimension is `#UNIT!` ("Can't aggregate mixed units"), and two different explicit currency codes are `#UNIT!` too.
3. A second pass reads the magnitudes, with each dimensionless cell adopting the list's display unit. Because the dimension is found before any magnitude is read, a leading bare number can adopt a unit that appears later in the list.

The reducer re-tags its result with `tagDim` from the returned `dim` and `display`.

### Column and matrix units

- A `ColumnUnit` is `{ dim, display? }`: one unit for a homogeneous Frame column, with the cells as bare magnitudes in that display unit (the derived form when `display` is absent). `sameColumnUnit` compares both fields.
- A matrix carries one `ColumnUnit` for the whole grid under a non-enumerable Symbol property, so it is invisible to iteration and JSON. It is lossy by design: any fresh array drops it, so unit-aware matrix ops re-tag explicitly, and persistence comes from the producing node. `withMatrixUnit` sets the tag on the same array it returns (a dimensionless unit clears it), `carryMatrixUnit` copies a tag from a source onto a fresh array, and `sharedMatrixUnit` claims a unit only when every part carries the same one, since a km grid stacked on a mi or untagged grid has no honest unit.
- `columnUnitFromSpec(spec)` (`unitColumn.ts`) resolves a header or Format Controller unit spec to a `ColumnUnit`. A spec containing `$`, `€`, `£` or `¥` is that currency (`usd`, `eur`, `gbp`, `jpy`), so a format spec like `$0.00` means dollars. Otherwise the number-format characters (`0`, `#`, `,`, `.` and spaces) are stripped, and the remaining token, which keeps `/`, `^`, letters and `%` (`m/s`, `m^2`, `%`), must be a Format Controller unit id, or the spec names no unit and the result is null.
- `parseColumnUnitFromHeader(header)` splits a trailing `(spec)` off a header; when the spec names no unit, the whole trimmed header stays the name.
- `columnUnitLabel` shows the display id when it maps to a Format Controller unit, else the derived symbol of the dimension vector (`m/s`, `N`).
- `tagFrameCellUnit` carries the display id into the `UnitCell`, because every currency shares one dimension axis and its identity is the id (`$` versus `€`). `matrixCellsFromList` strips the unit (returns none) when the tagged cells disagree.

### The unit-aware broadcaster

`broadcastUnit` (`shared.ts`) is the dimensional twin of `broadcastErr`: its per-cell function sees raw `number | UnitCell` operands, and its plain-number path matches `broadcastErr` exactly, so an untagged graph is unaffected. Its `guardCell` applies `guardFinite` to a cell's magnitude (an overflowing dimensioned product still becomes `#OVERFLOW!`), keeps `display`, and keeps a ratio cell's ratio brand.

## Currency: the display code is the identity

There are no exchange rates (`unitValue.ts` `currencyMismatch`). Every currency sits on the single `currency` base axis at scale 1 (unitBridge's DIRECT), so `$5` and `5€` store the same base magnitude, and a plain magnitude compare, add or aggregate would call them equal. So two currency cells with different explicit `display` codes are incommensurable:

- `compareUnits` (behind `ComparisonNode`, which is `unitAware`) returns `#UNIT!`. Equality then answers FALSE for `=` and TRUE for `≠`, and ordering (`<`, `>`) passes the `#UNIT!` on.
- `arithmeticCell` has the guard up front, so every op errors, including multiply and divide, which would otherwise invent an exchange rate. `forAggregateUnits` returns `#UNIT!` too.
- A currency cell with no code, such as a computed `currency` result, adopts the other side's code.

Every other dimension works on plain magnitudes, since km and m already differ in scale. `ComparisonNode` being `unitAware` is also what makes `5 km = 5000 m` compare in base SI. A dimensionless operand adopts the other side's unit in a compare (`$5 > 1000` compares 5 with 1000), matching the additive rule. Machine-checked by `unitValue.test.ts` (the currency block) and `logic.test.ts` ("ComparisonNode is unit-aware").

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

## Formula dimensions (`unitDimExpr.ts`)

`dimEval(ast, env, codes?)` is a second reading of a parsed formula (the numeric evaluator's `Ast`): it works out the dimension the result carries and never computes a value. `env` maps each named input to its dimension (an absent name is dimensionless); `codes` maps a pure-currency input to its display code, because a currency's identity is its code ([[D47]] noMixCurrencies) and the numeric evaluator can't see codes. It answers one of three things:

- a `Dim`, the determined result dimension (`{}` is dimensionless);
- a `SolError`, a real dimensional conflict (`#UNIT!`: meters plus seconds, SIN of a length, comparing incommensurable quantities, two currency codes);
- `null`, indeterminate (a non-constant exponent, an unknown function, IF branches that disagree). The caller drops the unit rather than guessing; no error is raised.

**Leaves.** Numbers, logicals, text, a blank argument, and `@`-row and whole-column references are dimensionless, since a Frame's unit lives on the column, not the cell ([[D43]] unitByGranularity). A name reads `env` and `codes`. Unary `±` and `%` keep the argument's dimension. A computed-lambda application is indeterminate, since its body is not visible.

**Operators.**

| Operator | Rule |
|---|---|
| `×`, `÷` | multiply or divide the dimensions; two different currency codes are `#UNIT!`, since a quotient would invent an exchange rate; a code carries only while the result stays in the coded operand's dimension |
| `+`, `−` | equal dimensions keep them (and either code); a dimensionless side adopts the other side; two different real dimensions, or two codes, are `#UNIT!` |
| `^` | a constant exponent (a pure-number subtree folded by `constNum`, such as `1/2`) raises the dimension; otherwise determinable only for a dimensionless base, else indeterminate |
| `&` | dimensionless |
| comparisons | dimensionless; `#UNIT!` only for two different real dimensions or two codes; an indeterminate side compares fine |

**Functions** (names case-insensitive). Codes drop at a function call; only dimensions flow into it.

| Class | Functions | Rule |
|---|---|---|
| dimensionless in and out | SIN, COS, TAN, CSC, SEC, COT (which also take a pure angle), ASIN, ACOS, ATAN, ATAN2, SINH, COSH, TANH, ASINH, ACOSH, ATANH, ACOT, EXP, LN, LOG, LOG10 | a dimensioned argument is `#UNIT!`; an indeterminate argument is skipped |
| dimensionless result, any arguments | COUNT, COUNTA, ISNUMBER, ISBLANK, ISERROR, SIGN, LEN, EXACT | they count, test or read a sign; a conflict inside an argument still propagates |
| preserve the shared dimension | ABS, MIN, MAX, MEDIAN, SUM, AVERAGE, AVG, ROUND, ROUNDUP, ROUNDDOWN, MROUND, CEILING, FLOOR, INT, TRUNC, MOD | mixed dimensions are `#UNIT!` |
| PRODUCT | | multiplies the argument dimensions |
| SQRT | | halves the exponents |
| POWER | | only the exponent's dimension is visible, not its value, so it is determinable only for a dimensionless base |
| IF | | the then-branch's dimension when there is no else or both agree; disagreeing branches are indeterminate, not a conflict |
| anything else | | indeterminate |

`dimEvalWithCode` returns the dimension with its code, for a caller whose top level is itself a combination, so no operator inside either side ever sees both codes. `formulaResultDim` folds a conflict into `null`; use `dimEval` when the conflict must surface as an error.

## Expression

`dimEval` (`unitDimExpr.ts`) sets the result dimension. A dimensionless argument adopts, under `+` and in the dimension-preserving functions alike (ROUND's digits, MIN(5 km, 3)). When every united input reads in ONE linear display unit, the formula runs on the displayed numbers: `5 km + 3` is 8 km, `5 km > 3000` is FALSE and `5 km & "x"` is "5x", as on Arithmetic and Comparison. A result `k` powers of that unit converts back by scale^k. Mixed units or a derived form run on base SI. An affine unit (°C, °F) is classified statically (`affineWeight` in `unitDimExpr.ts`): each subexpression carries its point weight, the sum of its coefficients on the readings. A reading is 1, a difference or a bare number 0, and a reading scales only by a constant, so `(a + b) / 2` is 1 again. MIN, MAX, MEDIAN and AVERAGE keep their arguments' weight (a bare constant beside readings is a reading); SUM adds them and refuses a list of readings; ROUND and its kin keep their first argument's; IF needs its branches to agree; any other function of a reading is `#UNIT!`. The formula then runs once on the readings: weight 1 is a reading (`a + 5` is 25 °C), 0 a difference in the base unit (`b - a` is 10 K), anything else `#UNIT!` (`a * 2`, `b / a`, `SUM(a, b)`). Machine-checked: `unitWiring.test.ts`.

## LAMBDA hosts over a 1-D list

REDUCE, BYROW and BYCOL strip tagged cells to plain magnitudes for the numeric fold: in the display unit the tagged cells share (so a bare `+ 1` means 1 km, and a result `k` powers of that unit converts back by scale^k), else in base SI. Over an affine unit the fold is classified as Expression is, with `values` a list of readings and REDUCE's `acc` and `value` both readings; REDUCE must answer a reading each step (`MAX(acc, value)`), so `acc + value` is `#UNIT!`. They run `dimEval` (`unitDimExpr.ts`) with the fold and aggregate variables bound to the element's dimension to get the result's dimension, and re-tag the result, keeping `display` when the dimension is unchanged. Mixed units or a clash inside the formula give `#UNIT!`, and a formula that yields a plain count (COUNT) strips to a plain number. MAP, MAKEARRAY and SCAN ignore units on matrices (`tableLambda.ts`).

## The display bridge (`unitBridge.ts`)

The bridge maps the FC's unit ids (`UNIT_ANNOTATIONS`, [[format-model]]) and every other registered display id onto the dimensional `Unit`s above.

- **`fcUnitToUnit(id)`** resolves an id, memoized: `none`, `custom` and `""` are `null`; otherwise the first hit among `DIRECT`, `parseUnit` (through `PARSE_AS`) and the registered extras. `DIRECT` holds what `parseUnit` can't spell: the currencies (usd, eur, gbp, jpy, all on the single `currency` axis at scale 1, since there are no exchange rates), ha, ac and the US liquid gallon. `PARSE_AS` renames ids whose parse string differs (hr → h, ms1 → m/s, kmh → km/h, mph → mi/h, b → byte, kb / mb / gb / tb → kbyte / Mbyte / Gbyte / Tbyte, L and mL through the parser's litre case); any other id is its own parse string.
- **`registerDisplayUnits(units)`** is the seam for display ids authored elsewhere (Convert's units, for one), so a `UnitCell.display` can hold any id a node sets while the bridge never imports `nodes/*`. It clears the memo, since an id may already be cached as unresolvable.
- `fcUnitDim` is an id's dimension (dimensionless when unknown); `isDimensionalFcUnit` is true only for an id with a real dimension. `fcUnitIdForUnit(u)` finds the FC id for a `Unit`: an exact scale and offset match first, else the first id of the same dimension, else none (the value shows its derived symbol).
- **`displayMagnitudeOf(cell)`** is a cell's magnitude in its own display unit (5 km gives 5, not 5000), or its base magnitude with no usable display. **`stripUnitCells(v)`** replaces every `UnitCell`, at the top level or nested in arrays, with that magnitude, and returns the same reference when nothing is dimensioned. It is the unit-blind boundary ([[compute-pass]], "Arrival coercion").
- At module load the bridge upgrades `unitValue`'s scale and offset resolvers to `fcUnitToUnit`, so adoption knows the full FC table and not only the `dimension.ts` spellings. The bridge is on every compute path, so the upgrade always happens.

## Authoring a unit

Two authors change a value's unit on purpose: the FC, through `applyFcUnit`, and Convert.

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
| a numeric matrix that already carries a grid unit | the cell rules: an incommensurable unit is `#UNIT!`, a commensurable one re-displays by rescaling the as-typed cells. The FC mirrors and locks a grid's unit as it does a cell's |
| text or a Frame | passes through, and any existing tag rides on |

`null` and `SolError` values pass untouched. A custom free-text unit becomes a `customDim` axis with no display id, so `formatDim` renders the name. A value counts as a matrix when any element is an array, and it is tagged only when the first non-blank cell of its first row is a number.

Convert authors the same way: base-SI plus the target unit's display, and `#UNIT!` when an input that already has a dimension clashes with the target.

### Convert

Convert (`nodes/convert.ts`) is `unitAware` and works per cell through `broadcastUnit`. Its conversion math is `dimension.ts` ([[C8]] declareOnce); each unit's `category` only groups the dropdown.

- A from and to unit that measure different things give one `#N/A` for the whole output, at every rank ([[D69]] convertBadPickIsNA).
- A dimensioned cell whose dimension matches the target is re-displayed in the target unit; a mismatched one is `#UNIT!`.
- A plain number is read as the from-unit and converted; a result too large to represent is `#OVERFLOW!`.
- Its `unit` getter answers the to-unit as an FC unit id (`none` when there is no FC twin), so an FC's `refreshAnnotation` treats Convert as a unit forwarder.
- `syncUnitArrows` sets the imposing-arrow markers (`imposesUp`, `imposesDown`) from whether `in` and `out` are wired, not from whether an FC sits beside them.

**Every Convert unit id must be registered with the display bridge** (`unitBridge.ts`). Then a `UnitCell.display` that Convert set (yd, psi, km_h…) resolves at render time even with no FC-registry twin. Unregistered, the downstream value box shows the base-SI derived symbol and Convert loses control of the value's unit.

## The format annotation

### Per-node rule (`makeAnnotationResolver.compute`)

For one output, the first rule that applies decides:

1. **Convert** (duck-typed: string `fromUnit` and `toUnit`) drops the inherited format. It sets a new unit and rescales the number, so the old precision no longer fits. It is the one transform that drops.
2. **A per-output producer** (`hasAnnotationFor`, `annotationFor(outKey)`) locks each output's own format, such as a Triangle angle's ° or an inverse-trig result in degrees. When it returns none for an output, the rule falls through to the transform carry below. So a Triangle side or Element Z stays bare (no `formatCarry`), while MathFn's abs and round still carry, which is how abs(−5%) stays a percent.
3. **An FC that may inherit** (`resolveAnnotation`) merges the format arriving at its `in` with its own unit ([[format-model]], "Inheriting the format"); it wins wherever it is present.
4. **An FC or node-level producer** (`hasAnnotation`) locks its own `annotation()`.
5. **A passthrough** (`isPassthroughNode`, from the one `passthrough()` declaration; Display and the selectors) carries its input's format. The data-aware `selectedPassInput` picks the branch the node actually computed, so `IF(true, km, mi)` follows `then`. When the pick is undetermined, `passInputKeys` names the value branches and their annotations combine: every present one must share the same unit, format and custom unit, or the result is none. A passthrough with no value keys carries its first input's annotation.
6. **A Conduit lane** `out_i` inherits `in_i`, duck-typed on `cachedLane`, on purpose with no `passthrough()` declaration.
7. **Anything else is a transform** and carries the format only where the node declares that the op keeps the value's meaning. `carriedFormat` reads `formatCarryForOutput`, whose per-op map lives in the node's op table. An undeclared transform carries nothing, so multiply, divide, power, count, variance, product, rates, z-scores and finance outputs show plain. The output socket's declared element family must exist (a wildcard, a Frame or a lambda carries no format), and among the declared inputs the first one that is wired, annotated and of that same family wins; the copy has `unit: "none"` and no custom unit, because the unit is value-level ([[D40]] unitOnValue). Two or more date-styled operands make a span (date − date, NETWORKDAYS) and carry nothing ([[D41]] formatFlowsDownstream).

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

### The resolver

`makeAnnotationResolver(editor)` is pure and duck-typed. It indexes the connections by source and by target once, since a per-hop scan would cost boxes × cables, memoizes each output, and answers none on a cycle.

- `outAnnotation(nodeId, outKey)` applies the per-node rule; `inAnnotation(nodeId, inKey)` is the `outAnnotation` of the cable's source.
- `downstreamAnnotation(nodeId, outKey)` follows the cables forward: the first consumer that is an FC answers (its `resolveAnnotation` or `annotation()`), a pure passthrough is walked through on each of its outputs, and anything else ends the walk.
- `sharedAnnotationResolver(editor)` shares one resolver per editor for the current microtask and rebuilds it on the next. It can't be cached on the connection version, because annotations change on any pass; within one commit the graph is fixed.
- `resolveValueOrigin(editor, nodeId)` is the popup's "Go to source" walk upstream, the same rule with a different payload. It steps through an FC by `in`, through a passthrough by its selected branch, or by its one connected value branch (none or several is ambiguous and stops there), or by its first connected input when it has no value keys (Display). It stops at Convert, at an undetermined selector, and at any transform or source, which is the origin.

## A Frame's per-column format rides the value

`FrameColumn.format` flows downstream like `FrameColumn.unit`, not through the annotation resolver. The coercion wrapper's output step (`coerceInputs.ts` `wrapNodeData`, the one seam every node's `data()` result passes, a composite's inner editor included) stamps each emitted Frame with that node's own `frameFormatStore` picks, memoized on the Frame's identity so the backend's upload cache still hits.

- Verbs that spread columns carry it. A column a verb builds takes a source column's format only where it already takes the unit (nest, the Allocator's Allocation).
- `frameFormatStore` is the one saved home, keyed by the node that picked. `format` is worked out on every compute and never saved.
- Readers take the local pick first and the carried one second (`FrameDisplay.annFor`, the popup's format row).
- Machine-checked by `frameColumnFormat.test.ts`.

## The one compute-time unit read (`trigMode.ts`)

A Math node's trig op in **Auto** angle mode computes in degrees when the value feeding it carries a `deg` format annotation, from a producer that emits bare degrees (Triangle Solver, inverse trig in degrees), read through `makeAnnotationResolver.inAnnotation`. An angle with a real dimension is already stored in base radians, so `MathFnNode`'s unit-aware path computes on its magnitude directly. Only a `deg` annotation switches the op to degrees; a `grad` annotation reads as radians, because the toggle offers no gradian mode and a Convert bridges it. `resolveTrigModes(editor)` runs from `processGraph` before the engine pull, stamps a transient `_resolvedAngleMode`, and returns only the nodes whose resolved mode changed. Machine-checked by `trigMode.test.ts`.

## Enforcement

`unitFlowAnnotation.test.ts` (the format direction rules and `applyFcUnit`'s value-changing cases), `unitFlowSeed.test.ts` (one `it` per captioned behavior in the **Unit Flow** seed, A to J), `convert.test.ts` (Convert tags its output) and `tableLambda.test.ts` (units through LAMBDA hosts).

## Related

What an annotation renders is a separate model: [[format-model]] and `formatModel.ts`. That covers the per-family control truth table (which FC controls exist for each socket type, hidden and inert rather than disabled and visible), the one precision × style rule, and the advanced tier (grouping, negative styles, K/M/B scale). `formatModel.test.ts` checks the whole `SocketDataType` union against it.
