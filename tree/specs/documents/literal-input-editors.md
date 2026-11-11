---
aliases: ["Literal input editors"]
tags: [spec, documents]
---
<!-- [[C28]] literalsIffEditable, [[C58]] tableInputRawText -->

# Spec: Literal input editors

Serves [[C28]] literalsIffEditable and [[C58]] tableInputRawText. It covers what the system does and blocks, and the decision each behavior serves.

## The popup is the editor for rank-2+ literal sources

Three literal sources edit through the table popup:

- **Table Input**: raw cells, through `onSaveRaw`.
- **Frame Input**: the literal-source grid, through `onSaveSource` / `onCommitSource`.
- **Cube Input**: the cube popup in edit mode. A nested cell drills to an editable list, table or Cube level on the breadcrumb, in one window and never a popup above a popup, with each level bound to a records path.

Table Input and Frame Input open that popup two ways: the chip at the foot of the value box, and the Edit Frame or Edit Table button at the top of the card (`CardOpenButton`, DESIGN.md § Buttons). Both call one opener (`openArrayPopup` with the card's `popupOverrides`; `openFrameChipPopup` in `FrameChip.tsx`), so the two can't drift. Cube Input keeps its chip alone.

The stored truth is always text on the node (`tableText`, `frameText`, `cubeText`), the rule [[C58]] tableInputRawText sets for Table Input. A Save rewrites that text and recomputes; it never writes a derived value back.

**Reopen if:** a literal source grows its own editor widget instead of binding the popup, or an editor writes a derived value back.

Tests: `literalEditors.test.ts`: Cube Input's source text (records, then `{ columns, rows }` once a column is typed or computed, nested tables' types under their records path), the records-path reads and copy-on-write writes the drill uses, a cell switched between a value, a list, a table, a Frame and a Cube, and Cube Input's typed and formula columns.

## The frame popup's column header is one row

On an editable Frame the order is type button → name → paintbrush → sort. On a read-only Frame it is name → paintbrush → sort. The paintbrush carries no chevron, since it costs every column its width.

- **A long name wraps to two lines** at word breaks, never mid-word, rather than widening its column: a read-only name wraps at 14em and clips past two lines, and an editable name is a textarea (`HeaderNameField`) that grows to two lines, turns back into one line that scrolls inside the field while focused, commits on Enter by blurring and reads a pasted line break as a space.

- **Only the sort button sorts**, in table and Cube popups alike. It is drawn on every sortable column, stays quiet until it carries a direction (then takes the surface's accent), and a click anywhere else in the header does nothing. The header reserves the button's room (`--sortpad`). How the sort orders rows is [[table-popup#Sorting]].
- **The paintbrush** (the shared `PaintbrushIcon`, the Format Controller's icon) opens the column's Format Controller picks (style, the inherited-format hint, unit) in a dropdown panel, tinted once this node has made a pick. There is no format row under the header; a matrix keeps its one whole-sheet pair above the grid.
- **Fx lives inside the type button.** On a Frame Input the cycle is Number / Text / Date / Boolean / Fx, and leaving Fx lands on a Number Data column. An Fx column has no type to pick, since its type is inferred from the cells, and it grows a second header row holding the column's formula, committed on Enter or blur.
- **LAMBDA inputs have no picker of their own.** While the formula field is focused, the LAMBDA socket names (`λ1`, `λ2`) list below it; picking one types it at the caret, replacing a half-typed name there, and the field keeps focus. The name typed in the formula reaches that λ. A formula that is only the name binds the λ's parameters to columns by name ([[C50]] lambdaBindsByName), and `λ1(@price, @qty)` calls it with positional arguments like any LAMBDA call. A named socket with nothing wired leaves the column blank. The stored column carries `expr` alone.
- **Both floating panels portal to `<body>`**, fixed under their anchor, above the popup layer and clamped into the viewport. Rendered in place, they would take header space and be clipped by the grid's scroll container. `useHangUnder` places a panel under its anchor, or above it when there is no room below, re-places it on any scroll or resize, keeps it hidden until first placed, and carries the popup's accent, which a portal would otherwise lose. A press inside a panel stops there, since a portal's React events still bubble to the popup card (`columnHeadControls.tsx`).

**Reopen if:** a column gains a source control outside the type button, or the format picks return to a row of their own.

Tests: `computedColumn.test.ts` ("wired λ"): a λ's parameters bind to columns by name and the λ wins over the inline formula.

## List Input is not one of them

This is [[C28]] literalsIffEditable. List Input's rows are typed on the card and are its only editor, and every row's values concatenate into one flat list. A gap between commas in a row (`1,,3`) is a blank item that holds its place, as a wired blank does ([[C24]] arraySemantics); a trailing comma adds nothing, and a row of only commas is empty (`list_row_items`). The card hosts no chip of its own: the value box draws the list, and its chip opens the ordinary list value popup view-only. The popup has no save callback, but it keeps the shell's resize grip, the Row / Column switcher and copy, and its Source view shows the typed items, the one thing the card hands it ([[C58]] tableInputRawText).

**Reopen if:** the popup gains a save callback for it.

Tests: `listInputChip.test.ts`: one flat list in row order, no chip of the card's own and only the typed text handed to the popup, each item's text kept beside its value, and the typed text read inside the engine.
