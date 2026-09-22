<!-- [[D5]] searchWiderThanLabel -->

# Spec: Add menu

Serves [[D5]] searchWiderThanLabel. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

The Add menu is the panel a user opens to place a new card. With the search box empty it shows the catalog as a tree of categories; as soon as the user types, it shows one ranked list of every row that matches. The code lives in `AddNodeMenu.tsx`, `catalogSearch.ts`, `fuzzy.ts` and `nodeOps.ts`, and `catalogSearch.test.ts`, `fuzzy.test.ts` and `nodeOps.test.ts` pin its behavior.

## The catalog tree

`NODE_CATALOG` is a tree of three kinds of entry: a **category** (a labeled folder of children), a **pair** (two leaves drawn side by side in one row) and a **leaf** (one card type the user can place). The tree is exactly what the menu renders when the search box is empty.

## The search rows

`flattenLeaves` turns the tree into the flat list that search scores. Each entry carries its leaf plus its category path, the labels of the categories it sits under, outermost first. Beyond the tree's own leaves, it adds two kinds of synthetic row:

- **Hidden-op rows.** A family is several operations folded onto one card, with an op picker on the card. An op that has no leaf of its own is a hidden op (`hiddenOps`), and each one gets a row built by `opEntry`, with type `` `${host}__op-${op}` ``. Picking the row places the host card already set to that op. Folding a family onto one card therefore never makes an op unfindable.
- **Excel-alias rows.** For each Excel name in `CATALOG_TO_EXCEL` that the leaf answers to, `excelEntry` adds a row with type `` `${host}__excel-${name}` ``, unless the name already matches the leaf's own label or one of its hidden ops' labels. The match ignores case and a trailing parenthetical, so "T.TEST (paired)" already answers to T.TEST. The label is `` `${hostLabel}: ${name}` `` ("Table Size: ROWS"). When the host label is itself a function name (all capitals, digits and dots, like "AVERAGE" or "LINEST"), the label is the alias alone ("AVERAGEA"). A family's primary op gets no hidden-op row, so an Excel name that is the primary op (Type Check's ISNUMBER) still gets its alias row.

Both kinds are generated at search time and never inserted into the tree, so code that walks the catalog does not count them as extra nodes. Neither kind carries the host's `keywords`, and neither carries the host's hidden-op list or its ops mark (the `{ }` badge that says a card folds several ops), since a row that is one op has nothing folded up.

## Scoring a row

`scoreLeaf(query, row)` returns a score, higher is better, or null when the row does not match. `searchLeaves` drops the nulls and sorts the rest best first.

Two texts are built from the row, and both are deliberately wider than what the menu renders:

- The **haystack**: label, description, Excel names, category path, the type with `-` and `_` read as spaces, and `keywords`.
- The **word list**: the words of the label, the label with any leading op glyph stripped ("+ Add" becomes "Add"), the type words, `keywords`, the category path and the Excel names. Words split on anything that is not a letter, digit or dot.

En and em dashes in either text, and in the query, read as plain hyphens, so "savitzky-golay" finds a keyword spelled with an en dash.

The query splits on the same separators, and every query word must land on the row on its own, or the row is out. A word lands in one of two ways:

1. As a **subsequence** of the haystack: its letters appear in order, not necessarily together (`fuzzyScore`). Each matched letter scores 1, or 3 when it directly follows the previous match.
2. As a **word hit** against the word list (`tokenWordScore`): 150 for an exact word, 100 for a word prefix, 90 for a word within one edit. One edit is a Damerau-Levenshtein distance of one: one letter substituted, inserted or deleted, or two neighbors swapped (`withinOneEdit`). The one-edit match applies only to query words of 4 or more letters, so "sun" does not reach "sum".

A word that scores 90 or more as a word hit counts that score alone. Otherwise it counts its subsequence score plus any word score. The words' scores add up. Word order is therefore free ("input frame" finds Frame Input), and a one-letter typo ("frane input") still ranks its target first instead of losing to rows whose long descriptions happen to contain the letters.

On top of the word total, the row gets the best **whole-query bonus** from its fields (`fieldScore`): 1000 plus the subsequence score for an exact match, 400 for a prefix, 150 for a match at the start of any word, and the bare subsequence score otherwise. The fields are:

- the label; the label followed by the category path; the type words; `keywords`; the label with its op glyph stripped;
- for a generated `Host: Name` row, the part after the colon, so an exact hit on an op's name ranks like an exact hit on a leaf's own label;
- each Excel name, scored 10 lower so an exact label still wins a tie.

Finally, when the whole query has 4 or more characters and is within one edit of the label, the stripped label or an Excel name, the bonus is at least 200. A typo of the name itself ("sunm" for SUM) therefore outranks a row that only carries the corrected word somewhere in its type or keywords.

## Two search fields, two weights

`keywords` scores as a full-weight field beside the label. It never renders, so it is where alternate spellings live. Excel names from `CATALOG_TO_EXCEL` score 10 below the label. A hidden-op row does not inherit its host's `keywords`: those describe the whole family, so every sibling row would match them identically and the ops would stop being told apart. It does carry the op's own `keywords`, which is where a family declares per-op alternate spellings.

## Quick-wire filtering

Quick-wire is a setting (`quickWire`, off by default). With it on, a cable dropped on empty canvas opens the Add menu at the drop point, and the picked card is wired to the cable's origin on the first compatible socket on the opposite side (`firstCompatibleSocketKey`): an input when the cable came from an output, an output when it came from an input.

The menu dims rows it considers incompatible (`--incompatible`, 30% opacity, not clickable) using the `compatibleTypes` set that `FlowSurface.tsx` passes, and `AddNodeMenu` tests each row's catalog `type` against that set. `FlowSurface` currently fills the set with the origin socket's data type, which never equals a catalog type, so the comparison does not do what its name says. `filterByCompatibleSocket` in `catalogSearch.ts` is the intended test: a row qualifies when its card, freshly created, has an opposite-side socket that `canConnect` accepts, with each type's socket signature built once and cached for the app's lifetime. Only its test calls it today.

## Why one long label widens the whole menu

`.solenoid-add-menu__scroll` is a two-column CSS grid (`grid-template-columns: auto auto`) so the two halves of a pair share column tracks. Every child that is not a pair half (`--half`) spans both columns (`grid-column: 1 / -1`), and a spanning item's natural width is split across both auto tracks. Rows are `white-space: nowrap` and the panel has no `max-width`. The panel is therefore as wide as its widest single row. The tree view hides this because it renders one category at a time; search renders every matching row at once, so the widest row in the whole catalog can set the width on the first keystroke.

## Invariants

- A rendered label carries only what a reader needs to pick the row. Alternate spellings, Excel function names above all, go in `keywords`, which scores at full weight and never renders ([[D5]] searchWiderThanLabel).
- A hidden-op row's label is `` `${hostLabel}: ${opLabel}` `` (`opSearchLabel`) and nothing else, so renaming a card renames its op rows.
- A card's formula name (`fx`) is independent of its label. It stays declared wherever removing the spaces from the label would not produce it ([[D3]] overrideInPlace, [[C18]] uniqueNameMap).
- Every op is reachable: it either has a row of its own or is the family's primary op. The primary op is found by constructing the leaf and reading its `op` (`primaryOpOf`), never declared by hand.
