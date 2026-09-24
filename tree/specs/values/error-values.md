---
aliases: ["Error values"]
tags: [spec, values]
---
<!-- [[C24]] arraySemantics, [[D34]] oneErrorKind, [[D35]] errorInErrorOut, [[E9]] errorsKeepOrigin, [[D69]] convertBadPickIsNA -->

# Spec: Error values

Serves [[C24]] arraySemantics, [[D34]] oneErrorKind, [[D35]] errorInErrorOut and [[E9]] errorsKeepOrigin. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one. The semantics (what null, NaN, Infinity and each error mean, and how they propagate by context) are [[value-semantics]]; this file is the mechanics.

Failures in Solenoid are values. A node that cannot answer returns a tagged error, the error travels down the cables like any other value, and the value box shows it as a red badge until something catches it.

## Errors are values

A `SolError` (`errorValue.ts`) is a tagged plain object, `{ __solError: true, code, message, origin? }`, not a class instance, so it survives `structuredClone` and never trips a cross-module `instanceof`. `solError(code, message)` mints one and `isSolError(v)` tests for the tag. The `message` is a short structural explanation ("Division by zero") that is safe for a tooltip; `ERROR_EXPLANATIONS` holds the longer per-code text that inspection surfaces show, so the badge and the producer's message stay terse.

### The codes

The set is Excel-style `#CODE!`, but more specific than Excel's seven, following SQLSTATE class 22 and OpenFormula Err:5xx. `SolErrorCode` is the union.

| Code | Meaning | Maps to |
|---|---|---|
| `#DIV/0!` | division by zero | Excel; SQLSTATE 22012; Err:532 |
| `#N/A` | no data, or a lookup miss | Excel; SQLSTATE 02000 |
| `#DOMAIN!` | an input outside a function's domain, such as √−1 | splits Excel's #NUM!; SQLSTATE 2201E / 2201F; Err:503 |
| `#CONV!` | an iterative solver did not converge (IRR) | splits Excel's #NUM!; Err:523 |
| `#OVERFLOW!` | a finite computation whose true answer is a number too big for the float type (2^5000), or a generator asked for more elements than its cap | splits Excel's #NUM!; SQLSTATE 22003; Err:512 |
| `#SYNTAX!` | formula text did not parse | splits Excel's #VALUE!; Err:516 |
| `#VALUE!` | wrong type, or operand misuse | Excel; SQLSTATE 22018 |
| `#TYPE!` | the wrong element type for the op | Solenoid only; Excel folds it into #VALUE! |
| `#SHAPE!` | a list or matrix dimension mismatch | no Excel scalar equivalent; nearest is #SPILL! |
| `#UNIT!` | incommensurable units in an op: the same element type, the wrong dimension (`dimension.ts`) | Solenoid only |
| `#NAME?` | an unknown name | Excel; Err:525 |
| `#REF!` | a dangling reference | Excel; Err:524 |
| `#CIRC!` | a circular dependency | Err:522; Excel only warns |
| `#SOLVE!` | the Equation node found no root (`equationSolve.ts`) | Solenoid only |
| `#AMBIGUOUS!` | a date string could read as either D/M or M/D (`dateSerial.ts`) | Solenoid only |
| `#ERROR!` | an unexpected internal failure; the guard's catch-all | Err:517 |

IFERROR catches every code; IFNA and ISNA match only `#N/A`.

### The guard

`installErrorGuards(node)` wraps every node's `data()` at `nodecreated` (the call sequence is in [[compute-pass]], "The error guard"). An error in means that error out, without running the node. A `data()` that throws degrades to a local `#ERROR!`, so one bad node can't half-kill a recompute pass; a thrown `SolError` (a verb reporting a missing column or a bad shape) is kept as itself. `cachedResult` mirrors the error, so the value box renders the red code badge (`ValueDisplay`, with the structural message as its tooltip). A figure card's own field is cleared too (`cachedChart` gets the error, `cachedPayload` becomes `null`), so it never keeps drawing the last good figure.

### Nodes that see raw errors

`SEES_ERRORS` names the classes, by constructor name, whose `data()` receives error values instead of short-circuiting ([[D35]] errorInErrorOut):

- **IFERROR and the IS-checks** consume errors; that is their whole job.
- **Conduit and CableSwitch** route lanes independently, and the any-error-to-every-output rule would poison sibling lanes.
- **Display** reads `cachedValue`, not the `cachedResult` the guard mirrors to, so it has to run on the raw error to both show the badge and forward the error on `out`. Most nodes render `cachedResult` and show propagated errors already; the gap is only the minority that render `cachedValue`, `cachedList` or `cachedText`.
- **Report**'s inline refs are independent lanes too. **Note** is output-only and is listed only to keep its read path uniform.
- **Composite** and its **output marker** are a subgraph boundary: an error crosses into the members, whose own guards apply, so an IFERROR inside catches it and a lane that never reads it keeps its value, as unpacked. The output marker has no outputs of its own, so short-circuiting it would turn an arriving error into a blank.
- **Chart** is a figure sink: it renders an errored input as an empty figure and never sends a `SolError` out its `chart` socket.

### Producers and provenance

A node returns `solError(...)` where the failure is a real error, never `null`; `null` stays the legitimate blank.

Every error carries an `origin` ([[E9]] errorsKeepOrigin): `nodeId`, `nodeName` (the node's title, or its type name when untitled), `inputSlot` (set only when the origin was tagged at a relay rather than where it was minted) and `rowIndex` (for a per-cell error in a list or Frame column). The guard sets it once, at the mint site or at the first relay that sees it untagged, and never overwrites it, so a chain of passthroughs still points at the original producer. Tagging copies only what it changes and returns the value untouched when nothing is untagged, so the error-free path costs nothing.

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

One rule per output cell, decided before the op, is built into every element-wise broadcaster (`shared.ts` `broadcast`, `broadcastErr`, `broadcastCells` and `broadcastUnit`; `excelFormula.ts` `broadcastCall` and the operators; `logic.ts` `broadcastEl`):

1. a `SolError` operand gives that error unchanged, the first in argument order;
2. otherwise a `null` operand gives `null`;
3. otherwise compute.

Every broadcaster zips ragged lists to the longest, and a padded position is `null`. `broadcastCells` is the broadcaster for the non-numeric families: text operands are mixed and the result is often another family, so it opens up the element type (`string | number | boolean`) and is overloaded by arity so each call site keeps precise operand types.

The shared helpers are `cellShortCircuit` (the full rule) and `cellError` (errors only, for the Kleene logic family, which feeds `null` to its own function) in `valueKinds.ts`. So a list cell behaves exactly like a scalar or a ragged pad: `[1, #DIV/0!, 3] + 10` keeps the error, and `[1, null, 3] + 10` gives `[11, null, 13]`. `broadcastCall` skips the null short-circuit for the `NULL_INSPECTING` predicates (ISBLANK, ISNUMBER…) that need to see the blank.

**`guardFinite`** (`valueKinds.ts`) means a computation never yields a bare NaN or Infinity. Per result, and aware of its inputs:

- NaN becomes `#DOMAIN!`;
- ±Infinity from all-finite inputs becomes `#OVERFLOW!` (one code, which splits out Excel's #NUM!, ERROR.TYPE 6);
- ±Infinity when an input was already infinite passes, since the Constant node's ∞ is a real value: ∞ + 5 = ∞, 2 × ∞ = ∞, 5 / ∞ = 0.

It runs at the producing op, so Expression's `tagResult` trusts it. The guarded producers are the element-wise broadcasters (`shared.ts`), the formula operator `applyOp`, `broadcastCall`, the RANGE dispatch, the frame aggregation path (`guardAgg`, frameVerbs) and the native engine's result normalizer (frameBackend). A kernel with its own recorded non-finite convention (a quiet null, a tagged error, IMDIV's `cx(NaN, NaN)`) is the deliberate alternative, not an exemption ([[D48]] classifyNonFinite). Both engines mask a non-finite join key to unmatchable. Expression trusts the guard: a surviving ∞ passes, and a stray NaN nets to `#DOMAIN!`. `0^0 = 1`, as in JS and Polars, while Excel gives #NUM! (`parity: false` on the pow leaf).

**Scalar reads** use `readInput(wired, literal)` (`shared.ts`) for data inputs, so a wired `null` propagates instead of being swallowed by the literal. Config inputs (base, digits, order, counts) keep their defaults. `readInputSweep.test.ts` is the zero-floor ratchet across `nodes/*.ts`, and the full rules are [[value-semantics]] "Reading an input". Machine-checked by `broadcastContract.test.ts`.

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
- **Computed columns.** A column may be computed from an inline `expr`, which calls a wired λ by its socket name ([[literal-input-editors]]). `FrameInputNode.data()` derives computed columns in dependency order, refuses cycles (`#REF!` "Circular computed columns"), caches by identity (`_computedFrom`), and carries the source unit onto the derived column. The row rules (a bare name is the whole column, `@` is this row, bracket references; [[C22]] rowFormulaRefs) live in the shared `computedColumnCore.ts`, so this surface and the Computed Column node can't disagree. The popup edits definitions through the live-commit seam (`tablePopupStore` `SourceCommitRefresh` / `onCommitSource`): a blur or pick recomputes through the real engine and refreshes the open popup.
- **`FrameColumn.raw?: string[]`** carries each cell's typed text, before inference, for source Frames. `inferColumn` fills it, so every CSV, Web and Import Frame has it, and `deriveFrame` carries Frame Input's cells. **Keep `raw` row-aligned:** a transform that changes a column's rows or values drops or remaps `raw`. The Slicer and Get Row remap it to the surviving or picked rows; the relational verbs that move or rewrite cells, and Add Column's replace, drop it ([[frame-verbs]]). A stale `raw` misaligns the Source view.
- **Table Input** uses the same model. `tableText` is raw text, and `tableRawCells` / `deriveTable` (`matrix.ts`) derive the typed matrix through the same `coerceFrameCell` (blank → null, a bad number or date → NaN, a bad logical → null). The grid popup edits raw cells through the lean `onSaveRaw` mode, never a parse-and-serialize round trip. One `dataType` SegToggle (number, text, date, logical) retypes the output socket in place (`retypeOutputCables`).

The popup's Source and Formatted views, the Form view's fields, the cell affixes and suggestions, and the CSV view's rules are in [[table-popup]].

## Model fuzzing

`runModelFuzz()` (`modelFuzz.ts`) looks for inputs a user could plausibly type that break the graph downstream. It perturbs every leaf source of the main graph, meaning a Number Input, Slider Input or Text Input with no inputs, through 120 samples each (`SAMPLES_PER_LEAF`), and scans the downstream cone (`downstreamClosure`) after each targeted recompute.

- **Samples.** They come from a fixed-seed generator (`mulberry32(0x5EEDF022)`), so a run is reproducible, which is what makes a "no findings" result trustworthy. The type is never fuzzed. Numbers are always finite: a fixed set of edge values (0, ±1, ±0.0001, ±100, ±1e6, 1e-8), then random magnitudes from about 0.001 to about 1e6 with a random sign. Strings are a fixed set of awkward words (empty, whitespace, emoji, 200 characters, a newline, "50%", "1,234.56" and others), then random printable ASCII.
- **What counts as bad.** A node is bad when a cached result field (`cachedResult`, `cachedValue`, `cachedString`, `cachedText`, `cachedList`, `cachedMatrix`, `cachedHeaders`, checked generically so no per-class list is needed) holds a tagged error, a leaked NaN (reported as `#VALUE!`) or an infinity (reported as `#OVERFLOW!`). `guardFinite` means a computation never yields a bare non-finite, and `null` is a legitimate missing value, never a defect. Lists, matrix rows and Frame columns are scanned under the bounded scan above (`sampledCellIndices`), since this runs on every downstream node for every sample. An Expect node is never a finding: the fuzzer feeds exactly the out-of-range values Expect exists to reject. Findings are deduplicated by node and code.
- **The Clamp suggestion.** For a code a min or max bound can plausibly fix (`#VALUE!`, `#OVERFLOW!`, `#DOMAIN!`, `#DIV/0!`, `#CONV!`; structural codes such as `#REF!` or `#NAME?` are not), the finding suggests splicing a Clamp before the node's first number or number-list input. Across every clean sample the fuzzer records the range of values arriving on that input, and a non-degenerate finite range (min below max) seeds the Clamp's bounds; a single-point range would pin the value, so it seeds nothing. This is a heuristic: a Clamp imposes only min and max, so it cannot exclude a bad interior point.
- **The run.** The whole sweep runs inside one compute bracket, so the compute curtain stays up between the per-sample passes, and inside the rebuild gate, which lets sampled passes run in manual-calc mode and keeps Alert and Expect from firing on samples. Each leaf's original value is restored, and recomputed, on every exit path.
- **`insertClampBefore(nodeId, socketKey, bounds?)`** splices a Clamp onto the cable feeding that input (nothing when it is unwired), placed midway between the two cards and 60 units above, with the bounds written as its min and max literals. An unwired min or max input reads those literals, so the Clamp arrives configured rather than as a pass-through.

## Enforcement

The **Errors, Null & Logic** seed (`seedGraphs/null-and-logical.json`) tours the codes: one row per code of the set current when it was built, each wired producer → Display → ISERROR, so the error shows its badge, propagates, and the ISERROR check explains it. `#ERROR!` is the unreachable internal catch-all, noted in the seed, and `#TYPE!`, `#UNIT!` and `#SOLVE!` aren't toured. The `#CIRC!` row loops back through an upside-down Conduit.

- `errorSeed.test.ts` loads that JSON, runs it through a real editor and engine (coercion, guards and the cycle cache-seeding), and asserts every ISERROR reports its row's code, so a wrong socket key or a silently null producer fails CI instead of showing blank in the app.
- `seeds.test.ts` validates structure.
- `errorIntegration.test.ts` locks the engine paths: coercion `#SHAPE!`, LAMBDA → MAP `#NAME?`, Display showing and forwarding, and cycle cache-seeding.
