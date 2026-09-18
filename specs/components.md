<!-- [[C27]] noDataInComponents, [[C95]] commitOnEnter, [[D10]] onePrunePath, [[C37]] observerOwnsSize, [[B3]] sameNodeEverywhere, [[B14]] oneDesignSystem, [[C43]] oneFlowSurface; covers: src/graph/components/*.tsx, src/graph/flow/*.tsx, src/graph/*.tsx -->

# Spec: Components

What every React component in the app is built to. A component that implements a specific mechanism cites that mechanism's leaf in its own header; this spec is the floor every one of them stands on, and its `covers:` line is what `dte blast` and `dte coverage` read instead of a citation per file.

1. **A component never computes.** It renders what the model already holds and never calls `node.data()`; a value it shows arrives through the engine's cache or a store ([[C27]] noDataInComponents; enforced by the `sourceInvariants` sweep).
2. **A text edit commits on Enter or clickaway**, never per keystroke: `useDraftCommit` / the draft-commit fields own the mirror and the recompute; a raw `<input onChange>` never calls `processGraph` ([[C95]] commitOnEnter; sweep-enforced). Discrete picks apply immediately.
3. **A socket that is about to disappear loses its cables first**, through `dropInputCables`, never a hand-rolled loop ([[D10]] onePrunePath; sweep-enforced).
4. **`width`/`height` belong to the ResizeObserver**; only a declared size-owner re-consumes `init.width/height`, and a user size gesture routes through `nodeSizeStore` ([[C37]] observerOwnsSize).
5. **Every render is boundaried** (`ErrorBoundary` per node and per app root), so one throwing card never blanks the canvas (`specs/react-flow-surface-contract.md`, [[C43]] oneFlowSurface).
6. **Visual, layout and copy choices follow DESIGN.md** ([[B14]] oneDesignSystem): the op/arg split ([[C26]] opArgDistinct), the socket glyph table, the voice rules for every string, even-sized icons, no native dialogs ([[C106]] noNativeDialogs).
7. **A node looks and behaves the same wherever it renders** ([[B3]] sameNodeEverywhere): marketing scenes and popups mount the real component, never a redrawn copy.
8. **Pointer handling keys on pointer type** ([[C93]] gestureByPointerType): a drag-interactive control stops propagation; read-only chrome uses `stopDragStart`; nothing swallows a second finger ([[C92]] pinchUnvetoable).
9. **Adding a node component** goes through the `add-node` skill: the class, the component, the catalog row and the Add-menu entry land together ([[C8]] declareOnce: the catalog is the one declaration).
