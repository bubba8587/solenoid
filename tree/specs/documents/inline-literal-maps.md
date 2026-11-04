---
aliases: ["Inline literal maps"]
tags: [spec, documents]
---
<!-- [[C28]] literalsIffEditable -->

# Spec: Inline literal maps

Serves [[C28]] literalsIffEditable. It covers what the system does and blocks, and the decision each behavior serves.

A **literal** is a value the user types straight into a card's input row instead of wiring a cable to it. A card keeps its literals in one or both of two fields:

- `literals`, a map from input key to number;
- `stringLiterals`, a map from input key to raw text (CSV-typed lists, column pickers, text rows).

An unwired input reads its literal; a wired input always reads its cable.

The governing convention: **a node class declares a literal map if and only if its card edits it inline.** Everything below follows from that.

## Load restores literals only onto declaring classes

When `persistence.ts` loads a saved node, it copies the saved `literals` and `stringLiterals` onto the new node only when the class already has that field as an object (`typeof anyNode.literals === "object"`). A field the class does not declare is dropped.

A wire-driven card declares neither map. The Equation family (Equation, TVM, Triangle Solver) is the main case: its variables are known only through cables, and `equation` (`crates/solenoid-core/src/nodes/formula.rs`) has no literal fallback. So a hand-written save or seed cannot plant a hardcoded known that the user can neither see nor edit on the card.

Tests: `persistenceSweep.test.ts`: for every catalog node, perturbed literals survive a construct cycle.

## Seeds are checked when they are written

A seed node whose `literals` or `stringLiterals` target a class that does not declare that map fails at authoring time instead of being silently dropped on load. A seed that needs a fixed value on a wire-driven card wires a visible input card (a Value Input and the like) instead.

Tests: `seeds.test.ts` ("authored literals land on inline-editable (declaring) classes only").

## A typeable list implies the declaration

A socket of type `strlist`, `datelist` or `logicallist` (the `TYPEABLE_LIST` set of the core's input boundary, `crates/solenoid-graph/src/boundary.rs`) is typeable: the card shows a CSV editor for it. Any node with such an input must declare `stringLiterals`, because the editor stores its raw text there. When the input is unwired, the input boundary parses that text with `parseListLiteral` (`listLiterals.ts`) and injects the list as the input's value (for a node ported to Rust, `coreHeader` in `nodeOnCore.ts` sends the parsed list); blank text injects nothing, and a wired cable always wins. List Input sets `ownsListLiterals` and reads its rows itself ([[C58]] tableInputRawText). A `numlist` input is typeable the same way, but only when the node opts in by putting that input's key in its `stringLiterals`.

Tests: `coerceInputs.test.ts`: a sweep constructs every catalog entry and fails for any node with a typeable input and no `stringLiterals`, so a new node cannot silently lose the user's typed CSV on reload; a `numlist` is typeable only where the node opts in; `parseListLiteral` per list type; and the typed list injected for an unwired input, a wired value winning.

## One field per input

**What a card computes from is what it shows.** An unwired input has exactly one field, and that field names the one place its value lives and how it is read. The core holds the one table (`nodes/fields.rs`, `field_of(card class, declared rung)`), and every reader goes through it:

- **The canvas** draws the field the table names (`literalFieldOf`, which asks the core over wasm), in every row host alike: the fixed rows, the extensible rows and the paired rows.
- **A body** reads an unwired input through it (`Call::unwired`): a number, a logical as TRUE or FALSE, text as keyed, a keyed value as its kind, or a date's text. A typed list reaches the body through the boundary as if wired.
- **A load** drops each saved value its input's field doesn't read (`pruneLiterals`), so nothing survives in a map no field shows.

The fields: `number` (the number field, `literals`), `logical` (the TRUE/FALSE checkbox Value Input's Boolean uses, `literals` as 1 or 0), `text` (`stringLiterals` as keyed), `csv` (a list keyed as comma-separated text), `keyed` (a wildcard slot's keyed text and kind, [[#Wildcard slots]]), `date` (a date keyed as text, Expect's bounds) and `none` (wire-only). A card's class decides only which wildcard and date slots take a field; the rung decides the rest.

- *Exception:* card bodies still read the literal maps directly in places, and some cards draw their own editors for inputs the table calls wire-only (Filter's, Frame Filter's and SUMIFS's value rows, Expression's and LAMBDA's variables, REDUCE's initial value, IsClose, Contains, IFERROR, the IS tests, Interpolate), so loads don't prune yet. **Removed by:** the sweep that moves every body onto `Call::unwired`, puts those cards' fields in the table and turns pruning on, guarded by a test that every seed and every class default keeps its values through a prune.

**Reopen if:** a card needs an unwired value that no field shows.

## Defaults are real values; examples are placeholders

A class that initializes a map, such as `literals = { rate: 0.05, … }`, declares a starting value the card computes with, shown in its field. A value that only shows what to key in (IFS's outputs, SWITCH's cases) is a placeholder instead (`static fieldPlaceholders`, `pairPlaceholders`): muted text in the empty field that never reaches the answer.

## Which field a row edits

An unwired input row's field is picked by its socket type, and the field decides which map it writes.

```mermaid
flowchart TD
    row["an unwired input row"] --> t{"its socket type"}
    t -->|"number, numlist"| nf["a number field"] --> lit["literals"]
    t -->|"string, strcombo"| tf["a text field<br>or a column picker"] --> sl["stringLiterals"]
    t -->|"strlist, datelist, logicallist,<br>an opted-in numlist"| csv["a CSV field"] --> sl
    t -->|"any, anycombo, anydata, trueany"| w{"the node opts in?"}
    w -->|"a keyed card"| keyed["the keyed field and its<br>kind button"] --> sl
    w -->|"a text card"| txt["a text field, as typed"] --> sl
    w -->|neither| wire["wire-only"]
    t -->|"anything else"| wire
```

In `InlineInputs` (the fixed rows of most cards):

| Socket type | Field | Map |
|---|---|---|
| `number`, and `numlist` unless opted in | number field | `literals` |
| `string`, `strcombo` | text field, or a column picker when the node declares that key as a Frame column picker | `stringLiterals` |
| `strlist`, `datelist`, `logicallist`, an opted-in `numlist` | CSV field, with no quote marks, which would suggest one string | `stringLiterals` |
| `any`, `anycombo`, `anydata`, `trueany` on a keyed card | the keyed field and its kind button (below) | `stringLiterals`, the kind in `literalKinds` |
| `any`, `anycombo`, `anydata`, `trueany` on a text card (Replace Values) | text field, kept exactly as keyed | `stringLiterals` |
| anything else | none | none |

A combo (`numlist`, `strcombo`, `anycombo`) edits in place as a scalar; it becomes a list only when a cable brings one.

`ExtensibleInputs` (rows that can be added and removed) and `PairedExtensibleInputs` draw the same field for each row; a wire-only row shows its row number.

## Wildcard slots

A card's wildcard rows take keyed values when the core's table names it a keyed card (`KEYED` in `nodes/fields.rs`). The value selectors are, since their wildcard rows are value branches, and so are the Cube builders, whose rows are cells. A wildcard sink or relay (Display, Cast, Report) leaves it off and stays wire-only. The opt-in covers `any`, `anycombo`, `anydata` and `trueany`; a list or a matrix still arrives only by wire.

A card whose op reads a wildcard slot as text is a text card instead (`TEXT` in `nodes/fields.rs`): its rows get the plain text field, so a space, `007` or `1.50` reaches the op exactly as typed rather than trimmed or read as a number. Replace Values' Find and Replace take this field; a wired value of any type still connects.

Tests: `cubeLiteralCells.test.ts`: an unwired wildcard row on the Cube builders takes a number or a text cell, and removing a row drops its keyed text and kind.

**The kind shows before the text is read** ([[C10]] socketLattice: text becomes another kind only where the type shows on screen). The keyed field (`KeyedField`) keeps the text exactly as keyed in `stringLiterals`, and the Frame column's type button sits to its right (`sol-coltype`, the same button and icons): a click cycles Number, Text, Date and Boolean, Number when none is picked, and the pick is saved in the init field `literalKinds`. Nothing guesses the kind from the text, so `12` keyed as Text is the text `"12"`, and a SWITCH case of `12` matches only what its kind says. Text shows in quote marks and a Date shows the date format as its placeholder.

- **One reader per kind, the Frame Input cell's** ([[C58]] tableInputRawText): the core reads a slot through `Call::keyed` (`keyed_value` over `frame_cell_of`), and a body that runs in JavaScript (Script) through `readKeyed`, on the same readers over wasm. Text the kind can't read is `#TYPE!` naming it; blank is unset. Flipping the kind rereads the same text.
- **The socket takes the kind's color while unwired.** Once a kind is picked or text is keyed, the Type Settle adopts the unwired input to that kind (`keyedRestType`, the input fact's `rest`), so the socket and whatever its passthrough feeds show the value's type. A cable decides once wired, and acceptance still goes by the declared base, so any cable connects.
- **No drag-to-scrub** on this field.
