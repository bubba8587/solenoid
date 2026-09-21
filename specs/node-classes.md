<!-- [[C34]] classNameIsType, [[D50]] everyFieldClassified, [[C29]] plainJsonInit, [[D20]] declareContract, [[D10]] onePrunePath, [[D42]] perInputUnitBlind, [[D46]] freezeVolatilePerCalc, [[C28]] literalsIffEditable; covers: src/graph/nodes/*.ts -->

# Spec: Node classes and op modules

What every node class and op module under `src/graph/nodes/` is built to. A file that implements a specific mechanism (units, dates, errors, a family's merge) cites that leaf in its own header; this spec is the floor, and its `covers:` line is what `dte blast` and `dte coverage` read instead of a citation per file.

1. **The class name is the persisted type**, kept and unique; a rename is a save-format change ([[C34]] classNameIsType). An unknown type loads as a Placeholder and re-saves as itself ([[C35]] unknownViaPlaceholder).
2. **Every field is persisted or deliberately transient**, declared in the persistence sweep ([[D50]] everyFieldClassified); `extractInit` is a fixed point and JSON-plain ([[C29]] plainJsonInit).
3. **A registration declares its full contract** (`EXCEL_IMPL_META`: returns, arity, rank, list args) and routing derives from it ([[D20]] declareContract, [[D4]] noManualList).
4. **`data()` reads inputs the value-semantics way** (`docs/value-semantics.md` § Reading an input): null is skipped not zeroed ([[D36]]), an error beats a missing cell ([[D37]]), a producer classifies a non-finite ([[D48]] classifyNonFinite), and an input is unit-blind only per declared input ([[D42]] perInputUnitBlind).
5. **A socket that is about to disappear loses its cables first** ([[D10]] onePrunePath), and an in-place retype reconciles downstream ([[D16]] retypeReconciles).
6. **A literal exists iff the socket is editable** ([[C28]] literalsIffEditable); a wildcard row's typed cell lives in exactly one literal map.
7. **A volatile `data()` freezes its draw on the recalc generation** ([[D46]] freezeVolatilePerCalc): no bare `Math.random()`.
8. **An op module is rete-free and shared by both surfaces** ([[D19]] implReteFree, [[C17]] shareImpl): the node's `data()` and the formula registration call the same kernel.
9. **A variant is a selector on the existing card, never a sibling node** ([[B11]] maximalMerge); an op is a function, an arg is a parameter ([[C26]] opArgDistinct).
