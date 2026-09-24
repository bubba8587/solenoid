---
aliases: ["Add menu"]
tags: [spec, canvas]
---
<!-- [[D5]] searchWiderThanLabel, [[C19]] namingModel, [[D22]] oneNamePerCard -->

# Spec: Add menu

Serves [[D5]] searchWiderThanLabel; the names it shows follow [[C19]] namingModel and [[D22]] oneNamePerCard. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

The Add menu is the panel a user opens to place a new card. With the search box empty it shows the catalog as a tree of categories; as soon as the user types, it shows one ranked list of every row that matches. The catalog is declared in `nodeCatalog.ts` and assembled by `catalogUtils.ts`; op families are declared in `nodeOps.ts`; search is `catalogSearch.ts` and `fuzzy.ts`; the panel is `AddNodeMenu.tsx`. `catalogSearch.test.ts`, `fuzzy.test.ts` and `nodeOps.test.ts` pin the behavior.

## The catalog tree

`NODE_CATALOG` is a tree of three kinds of entry:

- a **category** (`CatalogCategory`): a labeled folder of children, with an optional description shown on hover;
- a **pair** (`CatalogPair`): two leaves drawn side by side in one row, used for opposites;
- a **leaf** (`NodeCatalogEntry`): one card type the user can place.

Leaves are hand-placed in the tree. Many are built by small helpers (`arithLeaf`, `mathLeaf`, `seriesLeaf` and the like) that read the label and description from the family's `OP_META` table. Some families' leaf `type` strings do not follow their op names (`nth-large`, `t-test-paired`, `date-value`), because `NODE_EXCEL` keys on them.

The tree is curated to read well: general plotters stay at the top of Visuals while specialist figures cluster by what they show, and everyday table verbs stay at the top of Tables & Frames while column surgery, reshaping and comparison fold into subcategories.

### Leaf fields

| Field | Meaning |
|---|---|
| `type` | The catalog key. Internal, never shown ([[C19]] namingModel). |
| `label` | The name shown in the menu and, by default, on the card ([[D22]] oneNamePerCard). |
| `description` | Shown on hover in the menu, on the card header and in the Inspector. |
| `create` | Builds a fresh node. |
| `accent` | The node-kind accent, drawn as a filled rounded rectangle on the row; it marks user-input nodes. |
| `parity` | `true` (the default) when the node fully matches its Excel counterparts; `false` when it has known limitations. |
| `hidden` | The type stays registered so saved graphs load, but it is left out of the menu and the Function Reference, so no new one can be made. |
| `packs` | The ids of the packs contributing the node, set by the catalog builder; empty means built in. |
| `hiddenOps` | The family's ops with no leaf of their own, derived from `NODE_OPS` and never set by hand, so the `{ }` mark can never claim something the menu contradicts. |
| `hideOpsMark` | Hides the `{ }` mark while keeping the ops in `hiddenOps` and in search. |
| `excel` | The node's own Excel equivalents (`ExcelEquiv`: `excel`, `syntax`, and a `parity` and `note` that override the leaf's for that one function). The Function Reference generates from these; none means a Solenoid-native node. |
| `keywords` | Space-separated search words, matched by search and never shown ([[D5]] searchWiderThanLabel). |
| `fx` | The formula names the leaf answers to when the despaced label cannot be its name, because of punctuation or because one node splits into several functions. |

## Building the catalog

`buildCatalog(activeOnly)` assembles the tree the app uses:

1. Deep-clone `NODE_CATALOG`, leaves included, so the build can splice children and write `packs` without changing the shared tree.
2. Tag each leaf named in `NODE_PACK_TAGS` with its packs.
3. Append each leaf's `NODE_EXCEL` equivalents to any `excel` it already carries, so a pack node's inline list is kept.
4. Insert each pack placement (`packPlacements`) at its target category path, creating categories as needed. A placement with no path goes to Docs & Files. Packs therefore never add a top-level category. A type that is already in the tree gains the pack as another owner; a pack copy of a core node is ignored with a console warning.
5. Apply the op declarations (below).
6. With `activeOnly`, drop every leaf that is `hidden` or whose packs are all inactive, then every empty category. A pair that loses one half becomes a single leaf, since a one-child pair would break the grid. Without it, only empty categories are pruned.

The Packs category is declared empty so it sits last among the core categories; the build fills it per active pack and prunes it when no pack targets it. Docs & Files, as the placement fallback, is never empty.

`FLAT_CATALOG` maps every type to its leaf, built with `buildCatalog(false)`: every pack, active or not, and hidden entries included, so a saved graph always resolves its types. The Composite Input and Composite Output markers are hidden leaves that exist only for this: they live inside a composite, never on the main canvas, but `hydrate()` rebuilds them from a snapshot. `classifyType` calls a type `matcher` when `CATALOG_TO_EXCEL` gives it Excel names and `core` otherwise; pack nodes are classified by their pack.

`addNodeByCatalogType(type)` places a leaf from outside the menu: it creates the node, hydrates a composite that ships a pending internal snapshot (Query does), adds it, centers it in the view (default size 180 by 160), recomputes and selects it.

## Op families

An **op family** is one card class whose `op` field picks among several operations, each an Add-menu name and a formula function. A family that picks an argument instead (a sort order, an aggregator) is not declared anywhere ([[C26]] opArgDistinct, `DESIGN.md` § Op pickers). `NODE_OPS` holds one `NodeOpsDecl` per family:

| Field | Meaning |
|---|---|
| `type` | The catalog type of the host leaf, the one that carries the `{ }` mark when ops are hidden. |
| `ctor` | The class, matched with `instanceof`. A match on the constructor's name would break in a minified build. |
| `ops`, `create` | The op list and a builder for one op. A declaration has both or neither, since an op row with no builder could not be placed. A family whose every op already has its own leaf declares neither; it contributes only its class, which says what the dropdown picks between. |
| `leafOps` | The ops that have a hand-written leaf of their own. `nodeOps.test.ts` checks them against the catalog. |
| `expose` | `collapsed` (the default) or `leaves`. |
| `mark` | `false` hides the `{ }` mark. |

Each op (`OpEntryDecl`) has an `op`, a `label`, an optional `fx` and optional `keywords`. `fromMeta` reads them from a family's `OP_META` table, taking the op's name rather than any operator glyph the dropdown shows. `fx` is the formula name ([[C51]] formulaNaming), declared only where despacing the label would not give it: a prose label, or a bare label whose family word lives in the node title. The Distribution family's ops are the distributions; each op's `fx` is its first Excel spelling, dotted, and its `keywords` hold all of them, so typing "norm.inv" or "weibull" lands on the right row. The curve or inverse choice is the `form` argument, not an op.

A family's **hidden ops** (`hiddenOps`) are the ops with no leaf of their own: every op not in `leafOps`, or, when `leafOps` is absent, every op except the **primary op**, the one the host leaf itself creates. `primaryOpOf` finds it by constructing the host and reading its `op`, cached per type, so a declaration can never disagree with the code; a host that fails to construct has no primary op. The Rank & Percentile class is one family declared three times, on the PERCENTILE, PERCENTRANK and QUARTILE leaves, each listing its `.INC` and `.EXC` pair and sharing one `leafOps` list, so each `.EXC` row rides the right host ("PERCENTILE: PERCENTILE.EXC").

`applyNodeOps` applies each declaration that has hidden ops and a builder. For `collapsed`, it records the hidden ops on the host (`hiddenOps`), which shows the `{ }` mark unless `mark` is false. For `leaves`, it inserts a generated leaf for each hidden op right after the host, looking inside pairs as well as categories.

## The search rows

`flattenLeaves` turns the tree into the flat list that search scores. Each entry carries its leaf plus its category path, the labels of the categories it sits under, outermost first. Beyond the tree's own leaves, it adds two kinds of generated row:

- **Hidden-op rows.** Each hidden op gets a row built by `opEntry`, with type `` `${host}__op-${op}` ``. Picking the row places the host card already set to that op. Folding a family onto one card therefore never makes an op unfindable.
- **Excel-alias rows.** For each Excel name in `CATALOG_TO_EXCEL` that the leaf answers to, `excelEntry` adds a row with type `` `${host}__excel-${name}` ``, unless the name is already worn: the leaf's own label, one of its hidden ops' labels, or any other card's or op's label in the catalog, so "Group Lists: GROUPBY" never sits beside the GROUPBY card. Each Excel name appears at most once per leaf in `NODE_EXCEL`. The match ignores case and a trailing parenthetical, so "T.TEST (paired)" already answers to T.TEST and "DATE (Build)" to DATE. The label is `` `${hostLabel}: ${name}` `` ("Table Size: ROWS"), so a user who types the Excel name sees it on the row they get. When the host label is itself a function name (all capitals, digits and dots, like "AVERAGE" or "LINEST"), the prefix would only repeat itself, so the label is the alias alone ("AVERAGEA"); the description still names the host. A family's primary op gets no hidden-op row, so an Excel name that is the primary op (Type Check's ISNUMBER) still gets its alias row.

Both kinds are views of the host leaf ([[#The search rows]]): they spread the host and replace only what must differ. Both are generated at search time and never inserted into the tree, so code that walks the catalog does not count them as extra nodes. Neither carries the host's `keywords`, and neither carries the host's hidden-op list or its `{ }` mark, since a row that is one op has nothing folded up. A hidden-op row does carry the op's own `keywords`.

**MUST:** a hidden-op row is built from the host leaf plus the op's own declaration (`opEntry` spreading `...host`), never as a second hand-written catalog entry, and what the row must not inherit is named at that call site. Why: every property the leaf owns (label stem, pack, accent, description) has to follow the leaf automatically, or the menu and the card drift apart ([[engineering#One declaration per fact]]); the exceptions belong in the same function rather than a parallel table. The exception list blocks the host's `keywords`, not the op's own: blocking every `keywords` value once pushed per-op Excel spellings into the visible label.

## Scoring a row

`scoreLeaf(query, row)` returns a score, higher is better, or null when the row does not match. `searchLeaves` drops the nulls and sorts the rest best first.

Two texts are built from the row, and both are deliberately wider than what the menu renders:

- The **haystack**: label, description, Excel names, category path, the type with `-` and `_` read as spaces, and `keywords`.
- The **word list**: the words of the label, the label with any leading op glyph stripped ("+ Add" becomes "Add"), the type words, `keywords`, the category path, the Excel names and the row's **retired names**: every `LEGACY_ALIASES` name whose replacement is one of the row's Excel names, its stripped label or its op name (MATCH on XMATCH, FLOOR.PRECISE on FLOOR, DSUM on SUM). The formula surface refuses those names with "Use X", so the menu lands them on X's card. Words split on anything that is not a letter, digit or dot, so a hyphenated query ("k-means") lands word by word.

En and em dashes in either text, and in the query, read as plain hyphens, so "savitzky-golay" finds a keyword spelled with an en dash.

The query splits on the same separators, and every query word must land on the row on its own, or the row is out. A word lands in one of two ways:

1. As a **subsequence** of the haystack: its letters appear in order, not necessarily together (`fuzzyScore`, which ignores whitespace in the query). Each matched letter scores 1, or 3 when it directly follows the previous match.
2. As a **word hit** against the word list (`tokenWordScore`): 150 for an exact word, 100 for a word prefix, 90 for a word within one edit. One edit is a Damerau-Levenshtein distance of one: one letter substituted, inserted or deleted, or two neighbors swapped (`withinOneEdit`). The one-edit match applies only to query words of 4 or more letters, so "sun" does not reach "sum".

A word that scores 90 or more as a word hit counts that score alone. Otherwise it counts its subsequence score plus any word score. The words' scores add up. Word order is therefore free ("input frame" finds Frame Input), and a one-letter typo ("frane input") still ranks its target first instead of losing to rows whose long descriptions happen to contain the letters.

On top of the word total, the row gets the best **whole-query bonus** from its fields (`fieldScore`): 1000 plus the subsequence score for an exact match, 400 for a prefix, 150 for a match at the start of any space-separated word, and the bare subsequence score otherwise. The fields are:

- the label; the label followed by the category path; the type words; `keywords`; the label with its op glyph stripped (without the strip, "Add Column" would outrank the Add card for "add");
- for a generated `Host: Name` row, the part after the colon, so an exact hit on an op's name ranks like an exact hit on a leaf's own label;
- each Excel name, scored 10 lower so an exact label still wins a tie;
- each retired name, scored 20 lower, so a row that wears the name itself ("Sparkline: Column" for COLUMN) keeps first place.

Finally, when the whole query has 4 or more characters and is within one edit of the label, the stripped label or an Excel name, the bonus is at least 200. A typo of the name itself ("sunm" for SUM) therefore outranks a row that only carries the corrected word somewhere in its type or keywords (IMSUM's `cx-binary-sum`).

## Two search fields, two weights

`keywords` scores as a full-weight field beside the label. It never renders, so it is where alternate spellings live. Excel names from `CATALOG_TO_EXCEL` score 10 below the label. A hidden-op row does not inherit its host's `keywords`: those describe the whole family, so every sibling row would match them identically and the ops would stop being told apart. It does carry the op's own `keywords`, which is where a family declares per-op alternate spellings. An argument's words go on the host leaf's `keywords`, never into op rows.

## The menu panel

The panel opens at a screen point and clamps inside the viewport with an 8px margin. Once shown, it only ever moves up or left, never back down or right, so it does not jump as search results come and go. On desktop the search box takes focus when the panel appears; on touch (`IS_COARSE`) it does not, since the on-screen keyboard would cover the category list.

**The tree.** Pairs flatten into two half rows so the keyboard reaches every leaf and the grid lays the halves into its two columns. A category's submenu opens beside its row, on the right unless it would leave the viewport, then on the left, clamped with the same margin; the root predicts its submenu side from its own position. Hovering a category opens it. Clicking one **pins** it: while pinned, hover moves only within that subtree, so moving the mouse elsewhere does not collapse it. Typing, or any tree arrow key, releases the pin.

**Keys in the tree.** Up and down move by row, keeping the column within a pair. Left and right first move to a pair's partner; otherwise the arrow toward the submenu side enters a category and the other arrow backs out, so they swap when submenus open on the left. Enter enters a category or picks a leaf.

**Keys in search.** Up and down move through the results, keeping the active row scrolled into view, Enter picks it, and Escape clears the query. Escape with an empty query, or a pointer press outside the panel and its submenus, closes the menu. The outside-press listener is on the capture phase, because React Flow's handlers stop a canvas mousedown before it bubbles.

**Row marks.** A leaf with hidden ops and no `hideOpsMark` shows the `{ }` mark: `▶` means a category and parentheses would read as formula syntax, so ops take braces. The mark is rendered, not part of the label, so search and the card header keep the clean name. It is hidden from screen readers, and its hover title is the generic "Node contains multiple operations". It sits between the label and the pack dot in the label's ink and weight; hovering the mark itself lifts and boxes it, cueing the tooltip. A pack node shows a small dim dot at the row's trailing edge, titled with its packs. A user-input node's accent highlight is an inset rounded-rect pseudo-element behind the word, in the same accent-tinted text as the node header label, and it suppresses the row-wide hover fill.

**The panel's look.** The panel wears the shared overlay chrome (overlay background, the thicker overlay border, the modest overlay shadow). Its height cap matches the default tree's height (about 12 items plus the search field), bounded by `min(…)` for short screens, so the search-results panel is about the same size as the tree and the default tree fits without a scrollbar. The panel clips (radius plus `overflow: hidden`) and `__scroll` scrolls inside it. A submenu panel is positioned by script with inline `position: fixed`, so it can clamp and flip against the viewport.

`addMenuRequest` lets code outside Canvas open the menu at screen coordinates. Registrations nest: the composite drill-in registers over the main canvas, and unregistering restores the previous opener.

## Quick-wire filtering

Quick-wire is a setting (`quickWire`, off by default). With it on, a cable dropped on empty canvas, while the canvas is not locked, opens the Add menu at the drop point, and the picked card is wired to the cable's origin on the first compatible socket on the opposite side (`firstCompatibleSocketKey`): an input when the cable came from an output, an output when it came from an input.

`FlowSurface` passes `compatibleTypes` from `quickWireCompatibleTypes(buildCatalog(true), origin, side)`: the type of every row, generated rows included, whose card, freshly created, has an opposite-side socket that `canConnect` accepts (`filterByCompatibleSocket`). Each type's socket signature is read from one throwaway `create()` and cached for the app's lifetime, since a type's initial sockets never vary. The menu still shows the whole catalog but dims every row outside the set (`--incompatible`, 30% opacity). Every pick, by click or key, goes through one `select` gate that refuses a dimmed row, and a dimmed row's hover fill is suppressed. A card created from a cable dragged out of an input meets the drop point with its output edge: once the card has rendered, it shifts left by its own width.

## Why one long label widens the whole menu

`.solenoid-add-menu__scroll` is a two-column CSS grid (`grid-template-columns: auto auto`) so the two halves of a pair share column tracks. Every child that is not a pair half (`--half`) spans both columns (`grid-column: 1 / -1`), and a spanning item's natural width is split across both auto tracks. Rows are `white-space: nowrap` and the panel has no `max-width`. The panel is therefore as wide as its widest single row. The tree view hides this because it renders one category at a time; search renders every matching row at once, so the widest row in the whole catalog can set the width on the first keystroke.

## Catalog checks

`validateCatalog()` runs in development and only warns, never throws, so a stale entry cannot break the app. It reports every `NODE_EXCEL` type with no catalog node, and flags menu shape over a catalog built with every pack: a category with more than 12 rows (a pair counts as one row) or nested deeper than 3 submenu levels. The shape limits are advice, since packs extend the catalog at runtime and may push a category over.

## Naming a placed node

A placed node knows only its class and its `op`. The catalog lookups index every leaf once, by constructing it, under `` `${ctor.name}::${op}` `` and under `` `${ctor.name}::` `` for op values no leaf enumerates. A leaf that fails to construct is skipped without breaking the others.

- `describeNode` gives the catalog description.
- `nodeName` gives the catalog label, skipping generated `__op-` rows. A cleared card title falls back to it, so the header never collapses to zero height.
- `catalogTypeOf` gives the catalog type, which `NODE_EXCEL` and the pack metadata are keyed by.
- `nodeDisplayName` is the name every surface shows ([[D22]] oneNamePerCard). `catalogUtils` binds it into `nodeNamer` at load, so modules below it in the import graph reach it through `displayNameOf`.
- The title a placed node shows ([[D22]] oneNamePerCard) is `nodeDisplayName`: the user's own label if they typed one, else `nodeName` (op-aware, skipping the generated "Host: Op" search rows), else the class name. No class hardcodes a family title: every op family sets `this.label = init?.label ?? ""`, and no component syncs a label when the op changes, so the title follows the current op on its own. Every surface that names a node (header, Navigator, Inspector, cable inspector, history digest, popup titles) reads it.
- A leaf name is a title, so it carries no glyph prefix ("+ Add") and no hint ("ROUND to N digits"), and an "X / Y" row that creates only X is split into two leaves (`leafOps`).
- The hover type-hint (`.solenoid-node__type-hint`) shows the op-agnostic family name from `nodeTypeName`: the class name with its `Node` suffix removed and spaces added ("Series", "Math FX"). A family name that reads wrong is fixed by renaming the class (`MathFnNode` to `MathFXNode`), never with an override map.

### Where each name comes from ([[C19]] namingModel)

| Name | Home | Shown on |
|---|---|---|
| **Name** | the catalog leaf label (`nodeCatalog.ts`), or for an op family the current op's label; the title rules are [[D22]] oneNamePerCard | card title, Navigator, Inspector title, Problems, Pins, Comments, status bar, Isolate, cable inspector, history and popup titles, all through `nodeDisplayName` (the user's own label wins) |
| **Family name** | `nodeTypeName`, derived from the class name | only the card's hover type-hint, under the exception in [[D22]] |
| **Excel names** | `NODE_EXCEL[type]` | Inspector Excel rows; the description's closing "Excel: X."; and Add-menu search, as a row that shows the name ("Table Size: ROWS", built by `excelEntry` in the hidden-op row shape) whenever the Excel name is not already the row's own name or one of its ops |
| **Op names** | the family's `OP_META` label, read by `nodeOps` | the op dropdown; hidden-op search rows ("Host: Op"); the card title when the op has its own leaf |
| **Formula name** | `fx ?? despace(label)` in `nodeOps` | the formula surface; letter case per [[D23]] capsClaimsFunction |
| **Socket labels** | `addInput` / `addOutput` | the card's rows; bare nouns, with hints in `socketDocs` (`socket-reference.md` §8) |
| **Description** | the catalog or `OP_META` description | menu row, header hover, Inspector; voice per `DESIGN.md` §7 |

The class name, the rete `super()` name and the registry type key are internal and never shown. `nodeTypeName` (`nodeNamer.ts`) is the last-resort fallback for a node with no catalog entry (a Placeholder, a composite boundary). Modules below `catalogUtils` in the import graph (`errorValue`, `groupCollapse`) reach the same derivation through `displayNameOf`, which `catalogUtils` binds at load. Nothing else reads `constructor.name` for display; the enforcing test lists the two sanctioned uses that are not for display.

## Invariants

- A rendered label carries only what a reader needs to pick the row. Alternate spellings, Excel function names above all, go in `keywords`, which scores at full weight and never renders ([[D5]] searchWiderThanLabel).
- A hidden-op row's label is `` `${hostLabel}: ${opLabel}` `` (`opSearchLabel`) and nothing else, so renaming a card renames its op rows.
- A card's formula name (`fx`) is independent of its label. It stays declared wherever removing the spaces from the label would not produce it ([[engineering#An override lives on the declaration it overrides]], [[formula-language#Derived names are unique]]).
- Every op is reachable: it either has a row of its own or is the family's primary op. The primary op is found by constructing the leaf and reading its `op` (`primaryOpOf`), never declared by hand.
