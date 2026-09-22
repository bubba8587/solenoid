<!-- [[C24]] arraySemantics -->

# Spec: Error values

Serves [[C24]] arraySemantics. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one. The semantics (what null, NaN, Infinity and each error mean, and how they propagate by context) are `docs/value-semantics.md`; this file is the mechanics.

## Errors are values

Failures flow as tagged `SolError` values: Excel-style `#CODE!`, but a more specific set drawn from SQLSTATE class 22 and OpenFormula Err:5xx. The codes are `#DIV/0!`, `#N/A`, `#DOMAIN!`, `#CONV!`, `#OVERFLOW!`, `#SYNTAX!`, `#VALUE!`, `#TYPE!`, `#SHAPE!`, `#UNIT!`, `#NAME?`, `#REF!`, `#CIRC!`, `#SOLVE!`, `#AMBIGUOUS!` and the internal catch-all `#ERROR!`. The `SolErrorCode` union and the full mapping table are in the `errorValue.ts` module header.

- **The guard.** `installErrorGuards(node)` wraps every node's `data()` at `nodecreated`. An error in means that error out, without running the node. A `data()` that throws degrades to a local `#ERROR!`, so one bad node can't half-kill a recompute pass. `cachedResult` mirrors the error, so the value box renders the red code badge (`ValueDisplay`, with the structural message as its tooltip).
- **Nodes that see raw errors.** IFERROR, the IS-checks and the lane routers (Conduit, CableSwitch) register to receive errors instead of short-circuiting. So does Display (`SEES_ERRORS`): its value box reads `cachedValue`, not the `cachedResult` the guard mirrors to, so it has to run on the raw error to both show the badge and forward the error on `out`. Most nodes render `cachedResult` and show propagated errors already; the gap is only the minority that render `cachedValue`, `cachedList` or `cachedText`.
- **Producers.** A node returns `solError(...)` where the failure is a real error, never `null`; `null` stays the legitimate blank.

## The value model inside containers

Lists, matrices and Frames carry three distinct kinds besides values ([[C24]] arraySemantics):

- a first-class `null`: missing, rendered `null`, skipped by aggregators, dropped by Filter's predicate, propagated by element-wise math;
- per-cell `SolError`s, which propagate;
- a first-class logical: the purple socket family, TRUE/FALSE, converting to and from 1/0.

`valueKinds.ts` is the core: `isMissing`, `forAggregate` (skip null, propagate errors), and the Kleene `kleeneAnd` / `kleeneOr` / `kleeneNot`. `FrameColumn` has a `logical` column type and per-cell errors, and the table popup edits number, text, date and logical columns. `IS.TEST` (ISNULL and the type checks) tests per cell to any depth, Frames included. Saving needs no new format: computed values regenerate, and a Frame Input's logical and null cells round-trip through `frameText`. In the popup grid an error cell shows its code as text, not a badge.

### Element-wise math tags per-cell errors the same as scalars

A condition that is a tagged error at scalar level (÷0 is `#DIV/0!`, a domain miss is `#DOMAIN!`, overflow is `#OVERFLOW!`) is the same tag inside a list, per cell. No node may collapse a per-item error to NaN or null.

- The mechanism is `broadcastErr`, the sibling of `broadcast` in `nodes/shared.ts`. Its element function may return a `SolError`, and the call site maps the producer's domain-`null` sentinel through `?? errFactory()`.
- Arithmetic, Math (MathFn), TwoInputMath (LOG), Standardize and Fisher use `broadcastErr`; Convert gets the same behavior through `broadcastUnit`.
- `broadcast` doesn't collapse to NaN either: every result passes `guardFinite`, so a NaN result is `#DOMAIN!` per cell. Only an explicit function returning null stays blank.
- A whole-node error, like Convert's incommensurable unit pick ([[D69]] convertBadPickIsNA), stays a single value at every rank.

### The per-cell contract and the non-finite guard

One rule per output cell, decided before the op, is built into every element-wise broadcaster (`shared.ts` `broadcast` / `broadcastErr`, `excelFormula.ts` `broadcastCall` and the operators, `logic.ts` `broadcastEl`):

1. a `SolError` operand gives that error unchanged, the first in argument order;
2. otherwise a `null` operand gives `null`;
3. otherwise compute.

The shared helpers are `cellShortCircuit` (the full rule) and `cellError` (errors only, for the Kleene logic family, which feeds `null` to its own function) in `valueKinds.ts`. So a list cell behaves exactly like a scalar or a ragged pad: `[1, #DIV/0!, 3] + 10` keeps the error, and `[1, null, 3] + 10` gives `[11, null, 13]`. `broadcastCall` skips the null short-circuit for the `NULL_INSPECTING` predicates (ISBLANK, ISNUMBER…) that need to see the blank.

**`guardFinite`** (`valueKinds.ts`) means a computation never yields a bare NaN or Infinity. Per result, and aware of its inputs:

- NaN becomes `#DOMAIN!`;
- ±Infinity from all-finite inputs becomes `#OVERFLOW!` (one code, which splits out Excel's #NUM!, ERROR.TYPE 6);
- ±Infinity when an input was already infinite passes, since the Constant node's ∞ is a real value: ∞ + 5 = ∞, 2 × ∞ = ∞, 5 / ∞ = 0.

It runs at the producing op (the broadcasters, `applyOp`, `broadcastCall`), so Expression's `tagResult` trusts it: a surviving ∞ passes, and a stray NaN nets to `#DOMAIN!`. `0^0 = 1`, as in JS and Polars, while Excel gives #NUM! (`parity: false` on the pow leaf).

**Scalar reads** use `readInput(wired, literal)` (`shared.ts`) for data inputs, so a wired `null` propagates instead of being swallowed by the literal. Config inputs (base, digits, order, counts) keep their defaults. `readInputSweep.test.ts` is the zero-floor ratchet across `nodes/*.ts`, and the full rules are `value-semantics.md` "Reading an input". Machine-checked by `broadcastContract.test.ts`.

### Producers of each code

- **finance:** IRR, RATE and XIRR not converging → `#CONV!`; MIRR with same-sign cash flows → `#DIV/0!`; MIRR overflow → `#OVERFLOW!`.
- **scalar:** Combinatorics out of domain → `#DOMAIN!`; overflow → `#OVERFLOW!`.
- **Convert:** an incommensurable unit pick → `#N/A`; overflow → `#OVERFLOW!`.
- **stats:** zero variance in Correl, Standardize, Forecast or Regression → `#DIV/0!`; a Fisher or Percentile domain miss → `#DOMAIN!`; Rank, PercentRank or FIND finding nothing → `#N/A`.
- **cast and text:** parse failures → `#VALUE!`.
- **date:** unparseable non-empty text in DATEVALUE or TIMEVALUE → `#VALUE!`; blank stays blank.
- **matrix:** singular → `#DIV/0!`; non-conformable or non-square → `#SHAPE!`.
- **list:** INDEX out of range → `#REF!`.

The only deliberate null-on-failure sentinels left are the discrete-distribution pmf and cdf helpers (`dist-discrete.ts`), where an argument outside the support is blank by design, not a failed computation. A `broadcast` or `.map` over a list keeps per-item `null`s; only a scalar result becomes a `SolError`. `Displayable` (`standardNode.tsx`) includes `SolError`, so a producer using `makeNodeComponent((n) => n.cachedResult)` renders the badge with no extra work.

## Detect and recover: one notion of error

Detection and recovery form a 2 × 2 over missing (`null`) and error (`SolError`):

| | missing | error |
|---|---|---|
| **detect** | ISNULL (per cell, deep, `isMissing`) | ISERROR (`isSolError`), ISNA (`isNaError`) |
| **recover** | Fill (`FillNode`: constant, ffill, bfill, mean, median, mode, interpolate, drop, coalesce) | IFERROR, IFNA (per cell) |

These must hold across all of them:

1. A tagged `SolError` is the only definition of an error, so ISERROR and IFERROR agree exactly (`isSolError`). A bare NaN is not an error; `guardFinite` classifies non-finite results first, so an untagged NaN never reaches these nodes.
2. A `null` is not an error in any of them. It passes through IFERROR and IFNA, and it is what Fill targets. A real "not found" is a tagged `#N/A` (XLOOKUP, for one), not `null`.
3. The `#N/A` test lives in one place, `isNaError` (`errorValue.ts`), shared by ISNA and IFNA so they can't drift.
4. An error consumer reading a wired input that may be `null` uses `readInput`, never `inputs.x?.[0] ?? literal`, which treats a delivered `null` as absent and hides the missing cell.

Fill and IFERROR split cleanly: Fill never touches errors and IFERROR never touches null. Fill's `coalesce` op is IFERROR's shape applied to `null`. Coalesce takes any number of inputs: FillNode's Else rows are extensible (`e0`, `e1`… with CHOOSE-style `valueKeys` round-tripping), the first present value of the List and then each Else wins per position, and a typed literal on an unwired Else row is a last-resort constant, broadcast.

## Shape errors are part of this system

The central input coercion (`coerceInputs.ts`) wraps every node's `data()` inside the error guard: the canvas installs coercion first and the guard second. A narrowing failure throws `ShapeError`, which reaches the guard's catch, where `fromThrown` (matched by `e.name`, with no import coupling) maps it to a tagged `#SHAPE!`. So a dimension mismatch renders the badge and propagates like every other error; there is no separate shape-error path.

The shared result displays all tolerate a `SolError` in `cachedResult` and render the badge instead of crashing: `ValueDisplay`, `TableDisplay`, `FrameDisplay` and the collapsed GroupNode readout. A new custom result display gets an `isSolError(v)` branch up front.

## A formula node keeps both signals

Expression, LAMBDA, MAP, BYROW, BYCOL, MAKEARRAY, REDUCE and Filter set a rich inline `cachedError` string (an authoring hint on the card, like `Shape mismatch (3×2 vs 2×2)`) and also return a propagating `SolError` whose code matches the failure: `#SYNTAX!` for a bad formula, `#VALUE!` for arity or evaluation, `#NAME?` for a bad parameter, `#SHAPE!` for dimensions, `#OVERFLOW!` for too large. `cachedResult` stays `null` on these, so the box shows the richer inline message, while the returned value carries the code (its message is the tooltip) downstream. A blank formula stays `null`, a legitimate no-value, never an error.

## `#CIRC!` is engine-level, not a producer

The pull-based DataflowEngine resolves a node's inputs recursively before calling its `data()`, so a dependency loop makes `engine.fetch` deadlock forever instead of throwing. `processGraph` finds the loops' real members up front with Tarjan SCC (`graphCompute.ts` `loopMembers`: nodes in a strongly connected component of two or more, or a self-loop) and pre-seeds the engine's result cache (`engine.cache.add(id, …)`, a documented public field) with a `#CIRC!` for each.

A downstream node then resolves a member straight from the cache instead of recursing in, so it computes normally and shows the propagated `#CIRC!`; only the actual members dead-end. Seed only the SCC members, never their descendants, which would blank their own computation. The connection guard already blocks self-loops on creation; multi-node loops are caught here.

## Per-cell errors surface through a bounded scan

`reportOut` (the error sink behind the Problems panel) and `modelFuzz.badValue` find a per-cell error inside a list, matrix or Frame, not just a top-level `SolError`, through `findCellError` (`errorValue.ts`). A full rows × cols scan of every node every pass costs too much, so the scan is capped: `sampledCellIndices(len)` checks the head (`CELL_SCAN_HEAD` = 64) plus a stride sample of the tail (`CELL_SCAN_STRIDE_SAMPLES` = 32), a constant per container, with matrix rows recursing under the same bound.

An error on every row, the common case of a bad transform, is always caught by the head. A lone bad cell buried past the head, between two strides, can be missed; that is the accepted cost of a constant-time check per output. `modelFuzz` reuses the same bound (`badValue` → `collectFinite` / `sampledCellIndices`). Nulls are not flagged, since a missing value is legitimate. See `cellErrorScan.test.ts`.

## Literal sources: coercion happens at the value boundary

An input node never rewrites what you type. Storage and computed value are separate.

- **Frame Input** stores a raw `FrameSource` in `frameText`: per column `{name, type, cells: string[]}`, plus the column-source fields `unit?` and `expr?`, exactly as typed. `deriveFrame` produces the typed `FrameValue` (booleans, date serials) at compute time through `coerceFrameCell`, which shares `coerceLogical`. `parseFrameSource` and `frameSourceToText` load and store, and `frameFromInputText = deriveFrame ∘ parseFrameSource`. Old typed-`values` JSON and legacy CSV still parse, with cells kept raw.
- **Computed columns.** A column may be computed from an inline `expr`, which calls a wired λ by its socket name (`specs/literal-input-editors.md`). `FrameInputNode.data()` derives computed columns in dependency order, refuses cycles (`#REF!` "Circular computed columns"), caches by identity (`_computedFrom`), and carries the source unit onto the derived column. The row rules (a bare name is the whole column, `@` is this row, bracket references; [[C22]] rowFormulaRefs) live in the shared `computedColumnCore.ts`, so this surface and the Computed Column node can't disagree. The popup edits definitions through the live-commit seam (`tablePopupStore` `SourceCommitRefresh` / `onCommitSource`): a blur or pick recomputes through the real engine and refreshes the open popup.
- **`FrameColumn.raw?: string[]`** carries each cell's typed text, before inference, for source Frames. `inferColumn` fills it, so every CSV, Web and Import Frame has it, and `deriveFrame` carries Frame Input's cells. **Keep `raw` row-aligned:** a transform that changes a column's rows or values drops or remaps `raw`. Filter and Get Row remap it to the surviving or picked rows, and Add Column's replace drops it. A stale `raw` misaligns the Source view.
- **Table Input** uses the same model. `tableText` is raw text, and `tableRawCells` / `deriveTable` (`matrix.ts`) derive the typed matrix through the same `coerceFrameCell` (blank → null, a bad number or date → NaN, a bad logical → null). The grid popup edits raw cells through the lean `onSaveRaw` mode, never a parse-and-serialize round trip. One `dataType` SegToggle (number, text, date, logical) retypes the output socket in place (`retypeOutputCables`).

### The popup's Source and Formatted views

- **The Formatted / Source toggle** shows on every frame popup (Grid, CSV and Form). Source mode renders `raw` verbatim; a purely computed column with no `raw` falls back to the underlying form (a date's serial, a logical's 1/0). The per-column format and unit row works on computed columns too.
- **The Form view edits in both modes, like the grid.** With Source off, each field shows its formatted value, and an image cell shows its picture (`recordImageSrc`, the Record figure's `.sol-record__img`), until the field is focused; then it shows the raw text. With Source on it shows raw text throughout.
- **Date fields** are text inputs (a draft, committed on Enter or blur) with a calendar beside them, never a native date input controlled per keystroke, which wiped half-typed years. In the grid, the same calendar and a Boolean's checkbox appear at the right edge of the one cell being edited (`CellEditAffix.tsx`).
- **Text suggestions** use the same edge (`CellSuggest.tsx`, which replaces the native `<datalist>`, whose opener and OS-drawn list can't be styled). A bulleted-list opener shows every existing value, typing filters them in a list hung under the cell above the popup layer, ↑ ↓ select, and Enter or Tab accepts. It never opens on focus alone, and anything new still types.
- **Computed columns are marked in every view:** tinted read-only cells in the grid, an accent dot beside the field's label in the Form, and highlighted values in the CSV view (`CsvEditor.tsx`: a mirror behind a transparent textarea, with fields located by `csvFieldSpans`). A textarea can't lock part of its text, so marked text stays typeable and is ignored, since a computed column has no cells; leaving the block rebuilds the text and puts the computed values back. The Form's dot is an SVG circle, never a rounded CSS box: a centered popup sits at a fractional position, where a small box's edges snap per axis and the dot reads as an oval.
- **The CSV view.** With Source off, its text is what the grid shows, a column's FC picks included; Copy and Export stay on the type's default format, and the Source toggle rebuilds the block. In Formatted mode the block edits like a grid cell: the whole text shows its source while focused and the formatted text again on the way out. Because computed columns bind by index, CSV text whose rows don't each hold one value per column is refused while the table has a computed column: an error line under the block says so, Save is disabled, and the table keeps its last valid state.

## Enforcement

The **Errors, Null & Logic** seed (`seedGraphs/null-and-logical.json`) tours the codes: one row per code of the set current when it was built, each wired producer → Display → ISERROR, so the error shows its badge, propagates, and the ISERROR check explains it. `#ERROR!` is the unreachable internal catch-all, noted in the seed, and `#TYPE!`, `#UNIT!` and `#SOLVE!` aren't toured. The `#CIRC!` row loops back through an upside-down Conduit.

- `errorSeed.test.ts` loads that JSON, runs it through a real editor and engine (coercion, guards and the cycle cache-seeding), and asserts every ISERROR reports its row's code, so a wrong socket key or a silently null producer fails CI instead of showing blank in the app.
- `seeds.test.ts` validates structure.
- `errorIntegration.test.ts` locks the engine paths: coercion `#SHAPE!`, LAMBDA → MAP `#NAME?`, Display showing and forwarding, and cycle cache-seeding.
