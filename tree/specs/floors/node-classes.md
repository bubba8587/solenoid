---
aliases: ["Node classes and op modules"]
tags: [spec, floors]
---
<!-- [[C34]] classNameIsType, [[D50]] everyFieldClassified, [[C29]] plainJsonInit, [[D20]] declareContract, [[D10]] onePrunePath, [[D42]] perInputUnitBlind, [[D46]] freezeVolatilePerCalc, [[C28]] literalsIffEditable; covers: src/graph/nodes/*.ts -->

# Spec: Node classes and op modules

What every node class and op module under `src/graph/nodes/` is built to. A file that implements a specific mechanism (units, dates, errors, a family's merge) cites that leaf in its own header; this spec is the floor, and its `covers:` line is what `dte blast` and `dte coverage` read instead of a citation per file.

A **node class** is the headless model of one card: its sockets, its saved fields and its `data()`, which computes outputs from inputs. An **op module** (`*Ops.ts`) holds the pure calculations a class and its formula functions share.

1. **The class name is the persisted type.** It is kept and unique, so renaming a class changes the save format ([[C34]] classNameIsType). A saved type the app does not know loads as a Placeholder card and saves back out as itself, losing nothing ([[C35]] unknownViaPlaceholder).
2. **Every field is either persisted or deliberately transient**, and the persistence sweep (`persistenceSweep.test.ts`) knows which ([[D50]] everyFieldClassified). `extractInit` is a fixed point, so saving a freshly loaded node yields the same init, and its output is plain JSON ([[C29]] plainJsonInit).
3. **A formula registration declares its full contract** in `EXCEL_IMPL_META`: return type, arity, rank and list arguments. Routing is derived from that declaration, never from a hand-kept list ([[D20]] declareContract, [[D4]] noManualList).
4. **`data()` reads inputs the value-semantics way** (`docs/value-semantics.md`, "Reading an input"): a null is skipped, not treated as zero ([[D36]] nullSkippedNotZero); an error beats a missing value in the same cell ([[D37]] errorBeatsMissing); a producer turns a non-finite result into a classified error rather than emitting it bare ([[D48]] classifyNonFinite); and an input ignores units only where that input is declared unit-blind ([[D42]] perInputUnitBlind).
5. **A socket that is about to disappear loses its cables first**: a method that removes sockets returns the departing keys so the caller runs `dropInputCables` before `removeInput` ([[D10]] onePrunePath). A socket retyped in place reconciles everything downstream ([[D16]] retypeReconciles).
6. **A literal map exists if and only if the card edits it inline** ([[C28]] literalsIffEditable; [[inline-literal-maps]]). A wildcard input row keeps its typed cell in exactly one of `literals` and `stringLiterals`.
7. **A volatile `data()` freezes its random draw per recalc**: it keys the draw on the recalc generation (`getRecalcGen` in `process.ts`), so every read within one recalc sees the same value, and never calls a bare `Math.random()` ([[D46]] freezeVolatilePerCalc).
8. **An op module imports nothing from rete and serves both surfaces** ([[D19]] implReteFree, [[C17]] shareImpl): the node's `data()` and the formula registration call the same function.
9. **A variant is a selector on the existing card, never a sibling node** ([[B11]] maximalMerge). An op is a different function; an argument is a parameter of the same function ([[C26]] opArgDistinct).
