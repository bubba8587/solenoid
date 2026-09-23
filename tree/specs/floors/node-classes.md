---
aliases: ["Node classes and op modules"]
tags: [spec, floors]
---
<!-- [[C34]] classNameIsType, [[D50]] everyFieldClassified, [[C29]] plainJsonInit, [[D20]] declareContract, [[D10]] onePrunePath, [[D42]] perInputUnitBlind, [[D46]] freezeVolatilePerCalc, [[C28]] literalsIffEditable, [[C35]] unknownViaPlaceholder, [[D16]] retypeReconciles, [[D33]] unwiredNotBlank; covers: src/graph/nodes/*.ts -->

# Spec: Node classes and op modules

Serves [[C34]] classNameIsType, [[D50]] everyFieldClassified, [[C29]] plainJsonInit, [[D20]] declareContract, [[D10]] onePrunePath, [[D42]] perInputUnitBlind, [[D46]] freezeVolatilePerCalc and [[C28]] literalsIffEditable, with [[C35]] unknownViaPlaceholder, [[D16]] retypeReconciles and [[D33]] unwiredNotBlank.

This is the floor every node class and op module under `src/graph/nodes/` is built to. A file that implements a specific mechanism (units, dates, errors, a family's merge) cites that leaf in its own header. This spec's `covers:` line is what `dte blast` and `dte coverage` read instead of a citation in every file.

A **node class** is the headless model of one card: its sockets, its saved fields and its `data()`, which computes outputs from inputs. An **op module** (`*Ops.ts`) holds the pure calculations that a class and its formula functions share.

## Identity and persistence

- **The class name is the persisted type.** It is kept and unique, so renaming a class changes the save format ([[C34]] classNameIsType).
- **An unknown saved type loads as a Placeholder** and saves back out as itself, losing nothing ([[C35]] unknownViaPlaceholder). `PlaceholderNode` is not in the Add-menu catalog; only the loader builds one. It keeps the original type, init and literal maps verbatim, rebuilds the saved socket keys (adoptive inputs, `trueany` outputs) so the cables survive, and every output emits `#REF!` naming the missing type.
- **Every field is either persisted or deliberately transient**, and the persistence sweep (`persistenceSweep.test.ts`) knows which ([[D50]] everyFieldClassified). `extractInit` is a fixed point, so saving a freshly loaded node gives back the same init, and its output is plain JSON ([[C29]] plainJsonInit).
- **Extensible rows rebuild their exact keys.** A card with addable rows (value rows `v0`, `v1`, …, or paired rows such as `column0` and `value0`) takes the saved keys from `valueKeys` on load and paste and rebuilds exactly those, never a fresh sequence; paired cards read the ids through `pairIdsFromKeys`. Otherwise saved literals and cables stop lining up with their rows. A row's insertion order is its meaning (stack order, concatenation order, left to right).

## Formula registrations and op modules

- **A formula registration declares its full contract** in `EXCEL_IMPL_META`: return type, arity, rank and list arguments. Routing is derived from that declaration, never from a hand-kept list ([[D20]] declareContract, [[D4]] noManualList).
- **An op module imports nothing from rete and serves both surfaces** ([[D19]] implReteFree, [[C17]] shareImpl): the node's `data()` and the formula registration call the same function.
- **A variant is a selector on the existing card, never a sibling node** ([[B11]] maximalMerge). An op is a different function; an argument is a parameter of the same function ([[C26]] opArgDistinct).

## Reading inputs

- **`data()` reads inputs the value-semantics way** ([[value-semantics]], "Reading an input"):
  - a null is skipped, not treated as zero ([[D36]] nullSkippedNotZero);
  - an error beats a missing value in the same cell ([[D37]] errorBeatsMissing);
  - a producer turns a non-finite result into a classified error rather than emitting it bare ([[D48]] classifyNonFinite);
  - an input ignores units only where that input is declared unit-blind ([[D42]] perInputUnitBlind).
- **Wired beats literal, even when blank.** A connected cable's value wins even when it carries null; only an unwired slot falls back to the card's typed literal ([[D33]] unwiredNotBlank). So a card tests connection presence (`readInput`, or `inputs[key]?.length`), never `?? literal`, which would hide a wired blank behind the literal. A wildcard slot on an `autoLiterals` card reads through `pickSlot`, which applies the same rule over both literal maps.
- **A unit-aware class sets `unitAware = true`.** It then receives `UnitCell` tags intact and runs the dimension algebra itself ([[unit-flow]]); every other class sees bare magnitudes.
- **A class that takes a Cube as is lists the input in `noWidenInputs`**, so the coercion wrapper skips rank widening there and the class runs its own Cube branch ([[frame-verbs]] § Frames and Cubes).
- **A volatile `data()` freezes its random draw per recalc.** It keys the draw on the recalc generation (`getRecalcGen` in `process.ts`), so every read within one recalc sees the same value, and it never calls a bare `Math.random()` ([[D46]] freezeVolatilePerCalc). The raw draw is what freezes; live inputs such as bounds apply to it on every call, so a new bound rescales the same draw instead of rerolling.

## Sockets

- **A socket that is about to disappear loses its cables first.** A method that removes sockets returns the departing keys, so the caller runs `dropInputCables` before `removeInput` ([[D10]] onePrunePath).
- **A socket retyped in place reconciles everything downstream** ([[D16]] retypeReconciles). Swapping `socket` on an existing input or output fires no connection event, so the method that does it (`setOp`, `setMode`, `setDataType`) says so, and the caller follows with `retypeOutputCables` for outputs, or prunes an input's incompatible cables before the swap.
- **A literal map exists if and only if the card edits it inline** ([[C28]] literalsIffEditable; [[inline-literal-maps]]). A wildcard input row keeps its typed cell in exactly one of `literals` and `stringLiterals`.
- **Socket docs are opt-in and live on the class.** A node class may declare a static `socketDocs` map (socket key to one plain-English sentence beyond the type name) for the Inspector's per-socket detail, read through `socketDocFor(node, key)`. It has the same declare-on-the-class shape as `frameHints` and `literals`, so the text sits beside the sockets it documents and survives minification. Most sockets need none, since the label plus `SOCKET_TYPE_LABELS` already describes them.
