---
aliases: ["Type propagation on in-place socket retype"]
tags: [spec, values]
---
<!-- [[D16]] retypeReconciles, [[C10]] socketLattice, [[C8]] declareOnce -->

# Spec: Type propagation on in-place socket retype

Serves [[D16]] retypeReconciles. The static shape walk serves [[C10]] socketLattice (passthroughs forward the shape) and [[C8]] declareOnce (`frameShape()` and `columnPickers()` are each a node's one declaration). It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

## The trap

A Format Controller has no fixed type. It adopts the concrete type flowing into it, and picks a date format for a date type. `adaptTypeFromConnections` calls `concreteTypeOfOutput`, which walks upstream through passthrough wildcard sockets (all six family-less rungs, through `isWildcardRung`, since a rank with no family answers nothing) and reads the live socket `dataType`. That re-adaptation runs from the canvas's `connectioncreated` / `connectionremoved` pipe.

Several nodes change an output socket's type in place from a UI control: **Cast**'s target, the **LAMBDA** and **Expression** result type (`ResultTypeToggle`), **Get Column**'s read-as, and a **Note**'s frontmatter. An in-place retype fires no connection event, so without help the downstream FCs keep formatting by the old type. A date serial retyped to a number would still render as a date.

## Control-driven socket swaps

A node's own op, mode or argument field can swap that node's sockets in place. This is an established pattern; grep `setOp`, `setMode` and `keysDroppedBySwitch` before claiming a node can't retype on a mode. A swap can change an input socket, an output socket or both, and can add or remove whole input rows. It is separate from wildcard adoption (`trueAnyAdopt`), which the wiring drives and no field touches.

**The recipe:**

1. The class exposes `setOp` / `setMode`, which changes `this.inputs` / `this.outputs` (`addInput` / `removeInput`, or `out.socket = spec.socket`), and `keysDroppedBySwitch(next)`, naming the input keys the swap removes.
2. On the toggle, the component first calls `dropInputCables(id, departing)` ([[D10]] onePrunePath). Otherwise a removed socket leaves an invisible live cable.
3. Then it calls `setOp` / `setMode`,
4. then `rerenderNode`,
5. and after an output swap only, `retypeOutputCables`, because the swap fired no connection event.

**Examples:** `WorkdaysNode` (Days ↔ End-date input, date ↔ number output), `SettleNode` (people-frame ↔ ledger-cube input on its `mode`), `RecordNode` (Row and Group-by sockets per op), `ReturnsNode`, the finance nodes and `date.ts` (output family), `CableSwitchNode` (One ↔ Many output), and `Expression`, `composite` and `formatController` (`setType`).

## The result-type selector (`ResultTypeToggle`)

A polyform producer computes through a runtime-polymorphic lambda or formula, so its element type can't be inferred. The user declares it instead (`ResultType`: Number, Text, Date or Auto), and the output socket swaps at the node's own dimensionality (`ResultDim`). `resultSocket(dim, t)` is the one table, used both to build the port (`resultOut`) and to swap it in place:

| Dimensionality | Nodes | Number | Text | Date | Auto |
|---|---|---|---|---|---|
| `scalar` | REDUCE | `number` | `string` | `date` | `any` |
| `combo` | Expression, BYROW, BYCOL | `numlist` | `strcombo` | `datecombo` | `anycombo` |
| `matrix` | MAP, MAKEARRAY | `table` | `strtable` | `datetable` | `anytable` |

The combo Auto rung is `anycombo`, not `any`: an Auto result is a list whenever a list variable broadcasts, and `any` would let it reach strict scalar inputs.

## The rule: an in-place retype re-drives FC adaptation

Any code that changes a socket's `dataType` in place must re-drive FC adaptation, through `fcReconcile.ts`:

- **`reconcileFcTypes(editor, view)`** is the shared sweep. The canvas connection pipe calls it, and so does any manual retype. It doesn't recompute or bump the connection version; the caller owns `processGraph`. In order:
  1. `settleWildcardTypes` first, so the FCs resolve against settled types.
  2. Re-render every Conduit when lane types changed, and every node whose adoption changed, then rebuild the cables once rather than once per connection.
  3. Refresh every Convert's unit arrows (`syncUnitArrows`) before the FCs, so the chain settles in one sweep.
  4. For every FC: `adaptTypeFromConnections`, `refreshAnnotation`, re-render.
  5. If any FC retyped, re-render the cables again on the next animation frame, since a retyped socket's cables stay detached until their paths recompute.
- **`retypeOutputCables(editor, area, nodeId, outKey)`** runs after an output socket is swapped. It reads the new type off the already-swapped socket, keeps each outgoing cable the new type can still feed (an `any` input always survives, and so does same-family widening), drops only the ones that no longer fit, then calls `reconcileFcTypes`. An adoptive input is judged by its `base`, not the type it adopted from this very cable: a rank-2 result retyped onto a Display that adopted the rank-1 type keeps the cable and re-adopts ([[socket-lattice#The wildcard ladder keeps rank]]). Cast, `ResultTypeToggle` and Get Column use it. The Note's `commitFields` does the same for each retyped key.

`concreteTypeOfOutput` walks through wildcard passthroughs (a Display fed by a date reads as a date) but stops at a node with its own concrete output type. So a retype ends at the first node that types the value itself, like a math node that always outputs a number. That's correct, not a gap.

## Passthrough is one declaration (`nodes/passthrough.ts`)

A node that forwards a value to an output (a selector, a pure passthrough, an element-agnostic reshape) declares it once through `passthrough(): PassthroughSpec[]`: `{ output, inputs (the value branches), combine: single | agree | active, selected?() (the data-aware branch), pure? }`. `inputs` lists only the value branches, never a selector's condition or Expect's min, max and pattern.

`agreeTypes` encodes each branch as `null` when unwired (it casts no vote) or as its socket type. A wired branch whose type is `trueany` (statically unknowable) vetoes, so the result is `trueany`, because a typed agreement would format that value wrongly. No wired branch, or branches that differ, also give `trueany`. The socket pass and the display walk both call this one function, so they cannot diverge.

**Who reads it:**

- trueany type adoption: `trueAnyAdopt` `reconcileOnce`, through `resolvePassthroughType` with the `agree` rule;
- unit flow: `unitFlow` reads `selected()` first, else combines over the inputs, and `pure` drives the downstream FC-segment walk;
- the frame-shape resolver: `frameShapeResolver` `passthroughForOutput`, which column pickers and INDEX's frame projection depend on;
- coerceInputs' keep-tags boundary: `unitAware || isPassthroughNode`;
- `ValueDisplay`'s carried-annotation branch: `isPassthroughNode`;
- the FC's `refreshAnnotation` check for a Convert ahead: `isPurePassthroughNode`.

The FC's own type-adapt walk doesn't read it: `concreteTypeOfOutput` walks upstream on socket `dataType` through `isWildcardRung`. One declaration exists because separate markers for type and for units drifted: Expect, CableSwitch and IFERROR once passed type but not units.

**Who declares it:**

- Display and Expect: pure, `single`.
- IF, IFERROR, CHOOSE, SWITCH and IFS: `agree` over the value branches.
- CableSwitch in One mode: `active`.
- The element-preserving same-rank ops (Reverse, Slice, Take, Drop, Shuffle, NthElement, Pad, TRANSPOSE, CHOOSEROWS / COLS, table TAKE / DROP, EXPAND): `single`, with adoptive inputs and outputs so the output forwards the input's type.
- The append ladder: `agree` over its extensible rows, re-read every pass so a new row is a value branch right away (Concat Lists in 1-D; VSTACK and HSTACK in 2-D).
- The rank-crossing reshapes (WRAPROWS, WRAPCOLS, TOCOL, TOROW): `single`. `projectTypeToBase` lands the element family on the output's own rank.
- **INDEX**, an extraction that forwards a value out of its container rather than the container: `single` plus a `project(t, ctx)` that drops the rank and keeps the element family. The combo rung means exactly "one cell or a whole axis, decided at runtime". `ctx` (`ProjectContext`) is what the projection may consult beyond the socket type: the static frame `Shape` arriving on an input (from `frameShapeResolver`, supplied by the adoption pass) and whether an input is wired. A Frame's socket carries no family, but each named column does, so a blank or 0 Column gives the whole row, still a `frame`; Column = c gives that column's family at the combo rung; and `trueany` appears only where the type really is unknown (a wired Column, an upstream shape that can't be resolved, a `dynamic` shape, an out-of-range index, a Cube cell).
- A generative output (XLOOKUP's value-dependent result, MAP's formula-typed result, sources) declares nothing and stays static.

**Passthrough alone is the wrong tool when the forwarded value crosses a unit granularity** ([[D43]] unitByGranularity). Keeping tags would carry per-item `UnitCell`s into a matrix, which the model forbids. So the rank-crossing nodes (WRAPROWS, WRAPCOLS, and the stackers, whose `anytable` rows accept a list) are `unitAware = true` and reduce each input themselves: `matrixCellsFromList` gives bare magnitudes plus the one shared unit, tagged with `withMatrixUnit`. In coerceInputs, `unitAware` wins over the passthrough keep-tags branch, so the two work together.

### A trueany output declares its passthrough

**MUST:** a class with a `trueany` output either declares `passthrough()` or is listed with the reason its type resolves another way: the FC is the resolver, Conduit lanes resolve through `conduitTrace`, composite boundary ports sync in their own pass, and XLOOKUP and NA are unknowable. A forwarder that skips the declaration leaves its output `trueany` forever, so downstream FCs can't key a family and a date serial silently shows as its raw number.

### Relays are transparent

**MUST:** a value relay (a Conduit lane, a passthrough chain, an IF with one wired branch) is transparent to static resolution. A cable leaving it resolves its type, unit annotation and frame shape from the originating source's socket, through chains and reverting on disconnect, never from the relay's own untyped lane. A Conduit run is identified by its origin, so every segment of one run resolves to the same run, and provenance readings (the Cable inspector's "From") and run-wide actions can't differ by which segment was clicked.

When a relay answered from its own untyped lane, downstream column pickers went empty and formula column references silently failed to resolve through a passthrough, with no error anywhere.

Machine-checked by `passthroughSystem.test.ts`, `trueAnyAdopt.test.ts` and `matrixUnitPolicy.test.ts`.

## Frame shape is declared per producer (`nodes/frameShapeHook.ts`)

A node that emits a Frame states its output columns once, through `frameShape(outKey, ctx)`. It computes them from the wired input shapes (`ctx.inputShape`) and its own literals on unwired sockets (`ctx.wired`), or returns `null` where only the data can settle the column set: a fetched document, a type inferred from cells, a matrix's width. A misconfigured verb throws the same `#REF!` or `#VALUE!` its run would, and the resolver swallows that to `null`. A rule that can't mirror its verb exactly declares nothing instead of a wrong name.

### Static shape rules (`frameShape.ts`)

A `Shape` is `{ columns: { name, type }[], dynamic? }`. `dynamic` means the output's column count depends on the data: `columns` lists what is known ahead of running, and more may appear at compute time. `shapeOf(op, input)` is the static twin of `applyVerb` in `frameVerbs.ts`, with one arm per `FrameOp` kind, and its columns must be exactly what a real `preview()` reports. Nest, Unnest and Frame Lookup are not frame shapes and have no rule. A column a rule needs that the input lacks throws `#REF!` ("column … not found").

| Verb | Output shape |
|---|---|
| select | the named columns, first occurrence only, in the order named |
| drop | the input minus the named columns |
| rename | renamed through the map, made unique by `makeHeaders` |
| sort, distinct, head, filter, filterMulti, sliceRows | the input unchanged |
| fillBlanks, replaceValues | the input unchanged, after checking the target columns exist |
| groupBy | the key columns, then one column per aggregate named by its `as`; min and max keep the source column's type and every other aggregate is a number; names made unique |
| unpivot | the id columns, a `string` variable column (`variableName`, default "variable") and a value column (`valueName`, default "value") typed like the first value column (number when none) |
| pivot | the row-field columns only, flagged `dynamic`, since the cross-tab width depends on the data; no value field is `#VALUE!` |
| window | the input without any column of the new name, plus the new column (`as`, else the function name): lag, lead, first and last take the value column's type, everything else a number |

Four verbs have their own entry points:

- `shapeOfJoin(left, right, opts)` checks both keys, then gives the left columns only for semi and anti (a filter, not a widening join), otherwise the left columns followed by the right's non-key columns, names made unique. It mirrors `joinFrames`.
- `shapeOfAppend(shapes)` is the union by name in first-seen order; a shared name with two different types is `#TYPE!`.
- `shapeOfAddIndex(input, name)` puts one number column first (`name`, default "Index"), names made unique.
- `shapeOfSplitColumn(input, column, delimiter)` drops the split column and flags `dynamic`, because the part count is the maximum across rows; an empty delimiter returns the input.

`shapeOfFrameValue(f)` reads a literal frame's shape. `emptyFrameOf(shape)` builds a zero-row frame, so a producer whose columns never depend on row data can declare its shape by running its own verb instead of keeping a second copy of the rule that could drift. `columnNamesOf(shape)` lists a shape's column names for the column picker: empty for an unknown shape, and the known columns for a `dynamic` one, with free text still open.

`frameShapeResolver.ts` is only the walk: pure, with no engine call and no IPC, and `null` means unknown. It knows no node classes beyond the Conduit. `makeFrameShapeResolver(editor).outShape(nodeId, outKey)` indexes the connections by target once, memoizes per output and answers `null` on a cycle. Per output, in order:

1. **A Conduit lane** `out_i` forwards `in_i` verbatim. It is named here because the Conduit declares no `passthrough()`; `conduitTrace` owns lane routing.
2. **A node with both a `passthrough()` and a `frameShape()`** runs its hook: it adds or reshapes columns while still forwarding the input's rank (Computed Column or Add Column over a Cube), so its own columns win over the forwarded shape.
3. **A pure forwarder** (`passthrough()` only) flows the input shape, so a Frame routed through a Display, IF or Expect keeps its static shape for every verb downstream. `single` reads its one input; `active` reads the input at the clamped `activeIndex()` (the first when none); `agree` needs every wired branch to have the same column names and types in order, and is unknown otherwise or when nothing is wired.
4. **Otherwise** the `frameShape()` hook, given `inputShape(key)` and `wired(key)`, or unknown for a node with neither declaration.

Anything a rule throws becomes `null`, just as a bad config shows an error value at runtime rather than crashing.

**Column pickers** use the same idea. A node whose string literal names a column of an incoming Frame declares it once through `columnPickers()` (`nodes/columnPickerHook.ts`): the literal's key and the Frame input it belongs to. The shared `ColumnPickerField`, rendered by `InlineInputs` for those keys, offers that Frame's static column names (`frameShapeResolver` → `columnNamesOf`) with a free-text fallback, and commits the same string literal, so the socket and literal model doesn't change. Declare it next to `frameShape()`. Sort, Join and Get Column use it.

Machine-checked by `frameShapeCoverage.test.ts` (every catalog Frame output has a rule, forwards one, or is a named data-dependent producer) and `frameShapeRules.test.ts` (one case per rule).

## Three derived-type systems, one settle point

1. **Conduit lanes** (`conduitTrace.ts`). A Conduit's lane sockets are all wildcards (`trueany` until settled), so typing a leaving value by its JS value would be lossy (a date is a number, a Frame an object). `resolveTypedSource` traces each lane back through any chain of Conduits to its real source, so the type passes through unchanged; a depth cap of 16 keeps a Conduit loop (a `#CIRC!` graph) from trapping the walk. Each pass (`reconcileConduitTypesOnce`) mutates each lane's `MutableSocket` in place and reports whether any type changed, and an unwired lane reverts to `trueany`. `reconcileConduitTypes` repeats the pass until nothing changes, so a chain of Conduits settles in as many passes as it is deep; its cap of 32 passes sits well above any real chain and also bounds a `#CIRC!` loop. The caller owns re-rendering, recomputing and re-validating the downstream cables and FCs.
2. **FC adoption** (above).
3. **trueany adoption** (`trueAnyAdopt.ts`). Every `AdoptiveSocket`, the marker subclass that `trueAnyIn` / `trueAnyOut` create per port, adopts the wired cable's type and goes back to its declared `base` when disconnected. The default base is `trueany`. A narrower base, `anytable` or `anylist` (`adoptiveTableIn` / `adoptiveListIn`, used by Build Frame and Frame from Lists to learn a matrix's or list's element family, `date` included), keeps the port restricted to that rung while it still adopts the concrete wired type.
   - Inputs always adopt. Outputs adopt only where that's honest: Display, Expect and Input Switch in One mode pass through; IF, IFERROR, CHOOSE, SWITCH and IFS adopt when every wired branch agrees; INDEX projects its container's family onto its own rank, reading a Frame's per-column family off the static shape.
   - XLOOKUP's result is `staticTrueAnyOut`, the shared singleton that never changes, because a Cube cell's type varies by row.
   - The cube-family pair lets a row verb hand back the rank it received. `cubeAdoptIn` (base `cube`, which accepts a Frame or a Cube) with a `single` passthrough into `tableAdoptOut` gives a Frame out for a Frame in and a Cube out for a Cube in. The output's base is `frame`, not `cube`, so an unadopted output (a fresh node, or a static `validateText` check before adoption runs) reads as a Frame and still feeds a frame-only consumer (GROUPBY, Pivot, Join) as well as a cube one; a wired Cube adopts it to `cube`.
   - `anyTableIn` and `anyListIn` adopt only for display: acceptance is unchanged, and coercion treats the adopted type exactly like the base rung ([[compute-pass]]). `anyComboIn` accepts what `anyListIn` does but lets a scalar reach `data()` as a scalar, for a producer whose rank follows its input. `adoptiveDataOut` (base `anydata`) adopts the input's rank and element family together, so a same-rank op (TAKE, DROP) hands back a list for a list and a matrix for a matrix.

**`settleWildcardTypes(editor)`** alternates the Conduit and trueany passes until both settle, and it is the one entry point. `reconcileFcTypes` and the load path (`persistence.ts`) both go through it, so the connection pipe, Note retypes, paste and load all settle the same way.

**Order matters.** A one-shot consumer that caches a resolved type, like the FC dock loop on load, runs after the settle. `persistence.ts`'s rebuild tail is hydrate → settle → dock, pinned by `fcDockReload.test.ts`, which guards against a false Frame type on reload.

A socket type can also come from static config (INDEX's Column literal, and the frame shape every verb's literal config feeds). So the literal commit paths (`InlineInputs` set / setStr, `useNodeField`, the Frame Input source editor) call `reconcileTypesAfterEdit` (fcReconcile), which runs the settle and pays for the full FC reconcile only when a type actually changed (the reconcile settles again, a no-op fixpoint, and owns the renders).

**Invariants:**

- Adoption never drops cables. It is derived state; only an explicit user retype goes through `retypeOutputCables`. A cable adoption leaves ill-typed is not flagged on the canvas: it keeps delivering, and the consumer's coercion is the only check (text on a number port is `#TYPE!`, `coerceInputs.ts` `numericCells`; the other families pass the value through).
- Adopted types are never saved. They're worked out from the wiring on load.
- An adopting port owns its socket instance, since a shared one would leak adoption between cards ([[socket-lattice#Each port owns its socket instance]]).
- A drilled-into composite settles its inner editor itself (`composite.ts` `settleInternalTypes`: the same joint settle plus boundary adoption). The main canvas pipe never touches the inner editor.

Machine-checked by `trueAnyAdopt.test.ts`.

## Enforcement

`noteFcPropagation.test.ts` (a Note retyped from date to number re-adapts both a direct FC and one behind a passthrough) and `fcReconcile.test.ts` (`retypeOutputCables` keeps a cable into an `any` input and drops an incompatible typed one).
