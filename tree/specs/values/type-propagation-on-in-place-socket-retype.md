---
aliases: ["Type propagation on in-place socket retype"]
tags: [spec, values]
---
<!-- [[D16]] retypeReconciles, [[D17]] relaysTransparent, [[C8]] declareOnce -->

# Spec: Type propagation on in-place socket retype

Serves [[D16]] retypeReconciles. The static shape walk serves [[D17]] relaysTransparent (passthroughs forward the shape) and [[C8]] declareOnce (`frameShape()` and `columnPickers()` are each a node's one declaration). It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

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

## The rule: an in-place retype re-drives FC adaptation

Any code that changes a socket's `dataType` in place must re-drive FC adaptation, through `fcReconcile.ts`:

- **`reconcileFcTypes(editor, area)`** is the shared sweep: re-adapt every FC's type, re-project annotations, refresh Convert's unit arrows, re-render. The canvas connection pipe calls it, and so does any manual retype. It doesn't recompute; the caller owns `processGraph`.
- **`retypeOutputCables(editor, area, nodeId, outKey)`** runs after an output socket is swapped. It reads the new type off the already-swapped socket, keeps each outgoing cable the new type can still feed (an `any` input always survives, and so does same-family widening), drops only the ones that no longer fit, then calls `reconcileFcTypes`. Cast, `ResultTypeToggle` and Get Column use it. The Note's `commitFields` does the same for each retyped key.

`concreteTypeOfOutput` walks through wildcard passthroughs (a Display fed by a date reads as a date) but stops at a node with its own concrete output type. So a retype ends at the first node that types the value itself, like a math node that always outputs a number. That's correct, not a gap.

## Passthrough is one declaration (`nodes/passthrough.ts`)

A node that forwards a value to an output (a selector, a pure passthrough, an element-agnostic reshape) declares it once through `passthrough(): PassthroughSpec[]`: `{ output, inputs (the value branches), combine: single | agree | active, selected?() (the data-aware branch), pure? }`.

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

Machine-checked by `passthroughSystem.test.ts`, `trueAnyAdopt.test.ts` and `matrixUnitPolicy.test.ts`.

## Frame shape is declared per producer (`nodes/frameShapeHook.ts`)

A node that emits a Frame states its output columns once, through `frameShape(outKey, ctx)`. It computes them from the wired input shapes (`ctx.inputShape`) and its own literals on unwired sockets (`ctx.wired`), or returns `null` where only the data can settle the column set: a fetched document, a type inferred from cells, a matrix's width. A misconfigured verb throws the same `#REF!` or `#VALUE!` its run would, and the resolver swallows that to `null`. A rule that can't mirror its verb exactly declares nothing instead of a wrong name.

`frameShapeResolver.ts` is only the walk: memo and cycle guard, the Conduit lane case, `passthrough()` forwarding, then the hook. It knows no node classes.

**Column pickers** use the same idea. A node whose string literal names a column of an incoming Frame declares it once through `columnPickers()` (`nodes/columnPickerHook.ts`): the literal's key and the Frame input it belongs to. The shared `ColumnPickerField`, rendered by `InlineInputs` for those keys, offers that Frame's static column names (`frameShapeResolver` → `columnNamesOf`) with a free-text fallback, and commits the same string literal, so the socket and literal model doesn't change. Declare it next to `frameShape()`. Sort, Join and Get Column use it.

Machine-checked by `frameShapeCoverage.test.ts` (every catalog Frame output has a rule, forwards one, or is a named data-dependent producer) and `frameShapeRules.test.ts` (one case per rule).

## Three derived-type systems, one settle point

1. **Conduit lanes** (`conduitTrace.ts`).
2. **FC adoption** (above).
3. **trueany adoption** (`trueAnyAdopt.ts`). Every `AdoptiveSocket`, the marker subclass that `trueAnyIn` / `trueAnyOut` create per port, adopts the wired cable's type and goes back to its declared `base` when disconnected. The default base is `trueany`. A narrower base, `anytable` or `anylist` (`adoptiveTableIn` / `adoptiveListIn`, used by Build Frame and Frame from Lists to learn a matrix's or list's element family, `date` included), keeps the port restricted to that rung while it still adopts the concrete wired type.
   - Inputs always adopt. Outputs adopt only where that's honest: Display, Expect and Input Switch in One mode pass through; IF, IFERROR, CHOOSE, SWITCH and IFS adopt when every wired branch agrees; INDEX projects its container's family onto its own rank, reading a Frame's per-column family off the static shape.
   - XLOOKUP's result is `staticTrueAnyOut`, the shared singleton that never changes, because a Cube cell's type varies by row.

**`settleWildcardTypes(editor)`** alternates the Conduit and trueany passes until both settle, and it is the one entry point. `reconcileFcTypes` and the load path (`persistence.ts`) both go through it, so the connection pipe, Note retypes, paste and load all settle the same way.

**Order matters.** A one-shot consumer that caches a resolved type, like the FC dock loop on load, runs after the settle. `persistence.ts`'s rebuild tail is hydrate → settle → dock, pinned by `fcDockReload.test.ts`, which guards against a false Frame type on reload.

A socket type can also come from static config (INDEX's Column literal, and the frame shape every verb's literal config feeds). So the literal commit paths (`InlineInputs` set / setStr, `useNodeField`, the Frame Input source editor) call `reconcileTypesAfterEdit` (fcReconcile), which runs the settle and pays for the full FC reconcile only when a type actually changed.

**Invariants:**

- Adoption never drops cables. It is derived state, and the mismatch scan flags a cable that no longer fits. Only an explicit user retype goes through `retypeOutputCables`.
- Adopted types are never saved. They're worked out from the wiring on load.
- An adopting port owns its socket instance, since a shared one would leak adoption between cards ([[E6]] portOwnsSocket).
- A drilled-into composite settles its inner editor itself (`composite.ts` `settleInternalTypes`: the same joint settle plus boundary adoption). The main canvas pipe never touches the inner editor.

Machine-checked by `trueAnyAdopt.test.ts`.

## Enforcement

`noteFcPropagation.test.ts` (a Note retyped from date to number re-adapts both a direct FC and one behind a passthrough) and `fcReconcile.test.ts` (`retypeOutputCables` keeps a cable into an `any` input and drops an incompatible typed one).
