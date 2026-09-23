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

A class that initializes a map with defaults, such as `literals = { rate: 0.05, … }`, is declaring an editable input with a starting value, which is exactly what the convention permits.

## Which field a row edits

An unwired input row's field is picked by its socket type, and the field decides which map it writes.

In `InlineInputs` (the fixed rows of most cards):

| Socket type | Field | Map |
|---|---|---|
| `number`, and `numlist` unless opted in | number field | `literals` |
| `string`, `strcombo` | text field, or a column picker when the node declares that key as a Frame column picker | `stringLiterals` |
| `strlist`, `datelist`, `logicallist`, an opted-in `numlist` | CSV field, with no quote marks, which would suggest one string | `stringLiterals` |
| `any`, `anydata`, `trueany` on a node with `autoLiterals` | the auto field (below) | either |
| anything else | none | none |

A combo (`numlist`, `strcombo`) edits in place as a scalar; it becomes a list only when a cable brings one.

In `ExtensibleInputs` (rows that can be added and removed), `string` and the list types `numlist`, `strlist`, `datelist`, `logicallist` get the text field, typed as CSV for a list. `anylist`, `anytable`, `table`, `frame`, `cube`, `logicalcombo`, `lambda` and `chart` rows are wire-only and show their row number, because a typed literal means nothing for them. A wildcard row is wire-only unless the node sets `autoLiterals`. Every other row gets the number field.

## Wildcard slots

A node opts its wildcard rows into typed literals with `autoLiterals` (`AutoLiteralHost`, `takesAutoLiteral`). The value selectors opt in, since their wildcard rows are value branches, and so do the Cube builders, whose rows are cells. A wildcard sink or relay (Display, Cast, Report) leaves it off and stays wire-only. The opt-in covers `any`, `anydata` and `trueany`; a list or a matrix still arrives only by wire.

The auto field (`InlineAutoField`) holds a number or text. An entry that reads as a number (`Number(t)`, not `parseFloat`, so "12abc" is text) commits as a number into `literals`; anything else commits as text into `stringLiterals`, and the quote marks appear to show which landed, since a SWITCH case of `12` is not a case of `"12"`. The field keeps the number field's drag-to-scrub while it holds a number. Each commit deletes the key from both maps before writing one, so a wildcard slot lives in exactly one map and a reader never has to break a tie.
