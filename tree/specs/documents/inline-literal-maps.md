---
aliases: ["Inline literal maps"]
tags: [spec, documents]
---
<!-- [[C28]] literalsIffEditable -->

# Spec: Inline literal maps

Serves [[C28]] literalsIffEditable. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

A **literal** is a value the user types straight into a card's input row instead of wiring a cable to it. A card keeps its literals in one or both of two fields: `literals`, a map from input key to number, and `stringLiterals`, a map from input key to raw text (CSV-typed lists, column pickers, text rows). An unwired input reads its literal; a wired input always reads its cable.

The governing convention: **a node class declares a literal map if and only if its card edits it inline.** Everything below follows from that.

## Load restores literals only onto declaring classes

When `persistence.ts` loads a saved node, it copies the saved `literals` and `stringLiterals` onto the new node only when the class already has that field as an object (`typeof anyNode.literals === "object"`). A field the class does not declare is dropped.

A wire-driven card declares neither map. The Equation family (Equation, TVM, Triangle Solver) is the main case: its variables are known only through cables, and `EquationNode.data()` has no literal fallback. So a hand-written save or seed cannot plant a hardcoded known that the user can neither see nor edit on the card.

## Seeds are checked when they are written

`seeds.test.ts` rejects any seed node whose `literals` or `stringLiterals` target a class that does not declare that map, so the mistake fails loudly at authoring time instead of being silently dropped on load. A seed that needs a fixed value on a wire-driven card wires a visible input card (Number Input and the like) instead.

## A typeable list implies the declaration

A socket of type `strlist`, `datelist` or `logicallist` (the `TYPEABLE_LIST` set in `coerceInputs.ts`) is typeable: the card shows a CSV editor for it. Any node with such an input must declare `stringLiterals`, because the editor stores its raw text there. When the input is unwired, `coerceInputs` parses that text with `parseListLiteral` and injects the list as the input's value; blank text injects nothing, and a wired cable always wins. A `numlist` input is typeable the same way, but only when the node opts in by putting that input's key in its `stringLiterals`.

The `FLAT_CATALOG` sweep in `coerceInputs.test.ts` constructs every catalog entry and fails for any node with a typeable input and no `stringLiterals`, so a new node cannot silently lose the user's typed CSV on reload.

## Defaults are allowed

A class that initializes a map with defaults, such as `literals = { rate: 0.05, … }`, is declaring an editable input with a starting value, which is exactly what the convention permits. A wildcard input row keeps its typed cell in exactly one of the two maps; the editor clears the other.
