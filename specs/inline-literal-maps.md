<!-- [[C28]] literalsIffEditable -->

# Spec: Inline literal maps

Serves [[C28]] literalsIffEditable. The mechanics a builder implements: what the system does and blocks, with the decision each behaviour serves. Lifted from `docs/subsystem-invariants.md` § Inline literal maps; a WHY that is not in a node belongs in one.

`literals` / `stringLiterals` are the per-node inline-typed values (number rows,
CSV-typeable lists, column pickers). The governing convention: **a node class
DECLARES the map field iff its card edits it inline.** Everything hangs off that:

- **Load restores a saved literal map ONLY onto a declaring class**
  (`persistence.ts` load, `typeof anyNode.literals === "object"` gate). A
  wire-driven card — the Equation family (Equation, TVM, Triangle Solver) —
  declares neither, so a hand-authored save/seed cannot plant a hardcoded known
  the user can't see or edit on the card (the PF "TVM fv: 0" bug). Equation
  variables are known ONLY through cables; the literal fallback was deleted from
  `EquationNode.data()` outright.
- **Seeds are checked at authoring time**: `seeds.test.ts` rejects any seed
  node whose `literals`/`stringLiterals` target a non-declaring class — fail
  loud there instead of silently dropping on load. Wire a visible input node
  (Number Input etc.) instead.
- **A typeable-list input implies the declaration**: any node with a
  `strlist`/`datelist`/`logicallist` input must declare `stringLiterals`
  (the CSV editor stores raw text there; `coerceInputs` injects the parsed
  list when unwired) — machine-checked by the `FLAT_CATALOG` sweep in
  `coerceInputs.test.ts`, so a new verb-style node can't silently lose the
  user's typed CSV on reload.
- Node-specific DEFAULTS stay legitimate: a class initializing
  `literals = { rate: 0.05, … }` is declaring editable-with-a-default, which is
  exactly what the convention permits.
