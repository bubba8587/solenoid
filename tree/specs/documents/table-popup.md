---
aliases: ["Table popup"]
tags: [spec, documents]
---
<!-- [[C58]] tableInputRawText, [[C28]] literalsIffEditable, [[C63]] oneRecordNode, [[D41]] formatFlowsDownstream, [[C54]] noPerCellFormulas, [[C10]] socketLattice, [[C24]] arraySemantics, [[C95]] commitOnEnter, [[E9]] errorsKeepOrigin, [[D18]] frameLabelHint, [[C59]] byteStringOrder, [[C103]] untrustedContentSeams -->

# Spec: Table popup

Serves [[C58]] tableInputRawText, [[C28]] literalsIffEditable, [[C63]] oneRecordNode, [[D41]] formatFlowsDownstream, [[C54]] noPerCellFormulas, [[C10]] socketLattice, [[C24]] arraySemantics, [[C95]] commitOnEnter, [[E9]] errorsKeepOrigin and [[D18]] frameLabelHint. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

The Table popup is the one full-size viewer and editor for a table-shaped value: a list, a matrix or a Frame. It shows the value as a grid, a CSV text block or, on a Frame Input, a one-record form. It sorts, formats, summarizes, copies and exports, and on a literal source it is the editor that writes back to the node. A Cube opens the sibling Cube popup, described at the end. Both sit in the shared popup shell.

Code: `src/graph/components/TablePopup.tsx` (the popup), `src/graph/tablePopupStore.ts` (its state), `src/graph/valuePopup.ts` (the openers), `FrameChip.tsx`, `ArrayChip.tsx`, `TableInputNode.tsx` and `FrameNodes.tsx` (the editing openers), `tableFooterStats.ts` (the summary footer), `PopupShell.tsx`, `PopupResizeGrip.tsx`, `PopupOverflowMenu.tsx` and `PopupPinButton.tsx` (the shell), `popupChrome.css` and `TablePopup.css`, and `CubePopup.tsx` with `cubeCell.tsx` and `cubeEditCell.tsx` (the Cube popup). The helpers it leans on have their own files: `columnSort.tsx`, `gridKeyboard.ts`, `CellEditAffix.tsx`, `CellSuggest.tsx`, `CsvEditor.tsx` and `columnHeadControls.tsx`.

## The store and the openers

`tablePopup` is a module value store (`createValueStore`): `open(state)` replaces the state, `close()` clears it. It has to be a module store because a node card opens it from inside rete's separate React root, while the one `TablePopup` instance is mounted in App. The popup renders nothing while the state is null.

`valuePopup.ts` is the one home for opening a value's data popup, shared by the collapsed chips (`ArrayChip`, `FrameChip`, `CubeChip`) and the Display's corner expand button (`ValueExpandButton`).

- **`popOutKindFor(value)`** names the popup a value has: `frame`, `cube`, `table` (a 2-D array) or `list` (a non-empty 1-D array), from `POP_OUT_KINDS`. A scalar or a chart has none (a chart has its own popup, [[chart-figures]]). `displayPopupCoverage.test.ts` checks that every Display value kind resolves to one of these.
- **`openValuePopup(value, opts)`** is the read-only dispatcher the expand button calls. Editing chips call the typed openers directly so their Save callback keeps its shape.
- **`openFramePopup(frame, opts)`** first resolves a head-N preview (one carrying `__totalRows` and `__ref`) to the whole frame through `readFrame`, so the popup never shows the truncated sample. It opens with the title (the label, else `Frame`), the column names, the column types, `cellType: "number"`, per-column format controls, the column units and the column formats that arrived. When any column carries `raw` text, it passes it as `sourceCells` for the Source view.
- **`openArrayPopup(value, opts)`** opens a table as its rows and a list as one row (`list: true`), titled by the label, else `Table` or `List`. The cell type comes from the declared socket family when known (`complex` shows as text, since complex cells arrive as strings), else from the first cell alone, which matters only for a mixed list (a homogeneous one has a family, blanks and errors not voting): its first cell decides, and a leading `null` reads it as numeric. A numeric table gets one whole-sheet format control (`formatControls: "matrix"`) and its one matrix unit (`matrixUnitOf`). `popupOverrides` merge last.
- **`openCubePopup(cube, opts)`** opens the Cube popup (below).
- **`elemFamilyOfCells(value)`** answers only for a homogeneous container: blanks and errors don't vote, a unit cell counts as a number, and anything mixed or unknown is `undefined`. A chip must not guess, since a date can't be told from a number by its value.
- **The accent.** A popup wears its launching node's accent, read off the host card (`readChipPopupStyle`). With no node context it wears its type's socket color (`accentFallbackVar`): `--sock-frame`, `--sock-cube`, or `--sock-list` for a table or list.

### The chips

- **`FrameChip`** reads `[R×C Frame]`. It counts rows from `__totalRows` when the value is a head-N preview, adds `≈` when the frame is a sketch-mode aggregate (`__approx`, never shown as an exact total), and adds ` ƒ` when the source has computed columns. Its tooltip says Edit or View. A read-only frame opens through `openFramePopup`, the same path as the expand button. A literal source (a `source` plus `onSaveSource`, the Frame Input) opens its own shape inline, described under Modes.
- **`FrameRefChip`** takes a lazy frame ref and collects a head-N preview (`collectPreview`), never the whole frame, so hovering a million-row output stays cheap. While it waits, or when the handle was dropped by a recompute, it shows the placeholder `table…`.

### The on-card previews

`TableDisplay` (lists and matrices), `FrameDisplay` and `CubeDisplay` draw a value on a card as a small grid followed by its chip, all with the same classes, so the collapsed-card CSS can hide the grid and keep only the chip.

| | Compact preview | `full` (a Display) | `peek` (a socket hover) |
|---|---|---|---|
| `TableDisplay` | up to 4 rows by 4 columns | every row and column | up to 5 rows, no chip |
| `FrameDisplay` | the column names over up to 3 rows by 3 columns (`previewRows`, `previewCols` override), `…` for more columns | every column, at most 100 rows | a compact preview with no chip |
| `CubeDisplay` | the column names over up to 3 rows by 3 columns | every column, at most 100 rows | up to 5 rows, no chip |

- On a Display, 2-D data and figures grow the card to fit, a scalar grows up to a cap rather than clipping, and a list wraps as text. An expanded Display of a frame, cube, table or list drops its chip, so it gets a corner expand button instead, in `NodeShell`'s non-scrolling corner-badge slot, pinned while the body scrolls; a chart keeps its own in-figure button. `displayPopupCoverage.test.ts` pins that every Display value kind has a popup.
- A Display is a card, not a data browser, so even `full` caps frames and cubes at 100 rows; the popup is where the rest lives. A `full` grid switches the table layout to `auto`, because a fixed-layout, full-width table inside a card sized to its content grows without bound. With `scroll`, a wide frame scrolls sideways, never down, so the chip stays in view.
- An error value draws its code, with its tooltip; when it has an origin, a click flies to the node that produced it ([[E9]] errorsKeepOrigin).
- No data draws the muted `—`. An editable source never loses its chip, though: text that parses to nothing shows `empty` and the chip, since otherwise the node could never be edited again.
- A `NaN` number is dirty data from an import, not the `#N/A` error: it prints as `NaN`, tinted, with the "Not a number" tooltip. Infinities print as `∞` and `-∞`; other numbers print whole, or to at most three decimals with trailing zeros dropped (the table preview switches extreme magnitudes to scientific notation).
- `TableDisplay` formats its cells with the Format Controller resolved for its host (`resolveDisplayAnnotation`), re-rendering on every FC edit. With an annotation it owns dates and numbers; without one, text passes through, a logical shows TRUE or FALSE and a date table formats its serials. A Chip annotation colors each string from one map over the whole table, so a value has the same color in every cell.
- `FrameDisplay` formats each column with its local pick, else the format it carried in ([[D41]] formatFlowsDownstream), and re-renders when a pick changes in the popup. A pick applies only to the kind of column it fits, so a date style left on a column switched to Number falls back to the type's default rendering. `formatNodeId` names whose picks to read; a Report embed passes the source frame node. A Chip column is keyed on the full column, so colors stay stable across the preview cut.

### The example hint and the value peek

A frame input's example hint ([[D18]] frameLabelHint) draws as the popup grid in miniature, so it reads as "the frame popup, tiny": a solid overlay panel, sunken column heads in the popup's tinted-name recipe (the frame socket hue stands in for the node accent, since the input has no node yet), per-cell gridlines, monospace cells at 8 pixels with numbers right-aligned, and one muted word, `example`, under the rows to say it is not your data. `FrameHintTable` is the one markup, shared by the floating layer and the Inspector, where the same table renders inline at panel scale (11 pixels) as a reference to read.

`FrameHintLayer` floats either the hint or a live value peek (`SocketValuePeek`: the socket's value as a Display scaled to 0.8 from its top-left, at most 260 by 240 pixels, in app-neutral chrome), one at a time. Both are fixed in screen space like a tooltip and never scale with the canvas. The layer is placed after render, when its size is known: 10 pixels left of the socket, flipping to its right when that would leave less than 8 pixels of margin, and centered on the socket's row, clamped 8 pixels inside the viewport. A wheel anywhere hides it, because a zoom would move the socket out from under it; so does any pointer press (the touch dismissal); and a shown layer hides itself after 4 seconds, since touch has no leave event. It takes no pointer events and sits in the 110 to 199 band of the chrome ladder (z-index 120: above the HUD, below modals, [[layout-chrome]]). The triggers are [[touch-gestures]].

## Modes and what Save writes back

The opener's callback sets the mode. The popup is editable when it has `onSaveSource` or `onSaveRaw`, and either makes it a literal-source editor: the grid holds the raw typed text and never coerces it ([[C58]] tableInputRawText). Save calls the first callback present in this order, then closes the popup:

| Callback | Save returns | Built by | Who passes it |
|---|---|---|---|
| `onSaveRaw` | the grid's cells verbatim, `string[][]` | copy of the grid | Table Input; the Obsidian plugin's list and matrix properties |
| `onSaveSource` | `FrameSourceColumn[]` | `buildSourceColumns` | Frame Input; the Obsidian plugin's frame properties |
| none | nothing: a read-only viewer with a Done button | | every read-only chip and the expand button |

- **`buildSourceColumns`** keeps every cell verbatim; coercion happens downstream in `deriveFrame`. Each column carries its trimmed name, its type, its cells (none for a computed column, whose cells derive from the formula), its trimmed `expr` when it has one, and its `unit` when the source is unit-taggable, the column is a number and the unit is not `none`.
- **`buildFrameColumns`** feeds the column summaries of an editable frame popup, parsing each cell. Text keeps its value, blank as null. A logical cell reads `true`/`1` and `false`/`0`, ignoring case; anything else is null. Number and date cells parse as numbers (a date is its serial), a date column falls back to the date parser for typed text, and anything unparseable is `NaN`. A blank is null.

What each node does with the save:

- **Table Input** passes raw cells (or one blank cell), its data type as the cell type, and `onSaveRaw`, which writes `tableText = rawCellsToText(cells)` and recomputes. A number table is unit-taggable and adds `onSaveMatrixUnit`, which writes the node's `unit` and recomputes.
- **Frame Input** opens through `FrameChip` with the raw cells of its source columns, the column names, and `columnTypes` in which a computed column carries its derived type, so its format button offers the family that matches its cells. It passes `unitTaggable`, `editableHeaders`, `onSaveSource`, `onCommitSource`, the Form layout, its λ socket names (`lambdaOptions`), each column's formula (`sourceExprs`) and the derived values of the computed columns (`computedCells`, as many rows as the longer of the source and the derived frame), then any `popupOverrides`. Seeding from raw text is what keeps a typed `1` from becoming `TRUE`. Its `onSaveSource` writes `frameText = frameSourceToText(columns)`, settles downstream types with `reconcileTypesAfterEdit` (a text edit fires no connection event, and a renamed or retyped column can retype a socket that reads it), schedules an autosave and recomputes.
- **The Obsidian plugin** passes `unitTaggable: false` and `noFormulaColumns: true` on frames, and `fixedCols` on a list property's one-column grid ([[obsidian-plugin]]).

### Live commit

`onCommitSource(columns)` writes the source through to the node now, recomputes, and returns a `SourceCommitRefresh`: the fresh derived values of the computed columns and the column types. The open popup swaps them in without a Save and close round trip, and the later Save is a harmless re-commit. It fires when a column's formula commits with a changed text, when a column leaves Fx, and when a computed column's unit changes. A Data column's unit waits for Save. Frame Input's implementation awaits the node's recompute and returns null when the result is not a frame.

## The grid

The grid holds every cell as a string, so a half-typed `-` or an empty cell is legal while editing. On open, `toGrid` turns the value into text: null, missing and `""` are blank; a boolean is `TRUE` or `FALSE`; an error is its code; a unit cell is its magnitude and unit in the display unit (`formatListCell`); a text or logical column keeps the value as text; anything else goes through `formatScalar`. Each column's type is `columnTypes[j]`, else the popup's `cellType`, so a frame can mix types.

- **Labels.** Column heads show the header names, else spreadsheet letters (A to Z, then AA, AB and on). Rows are numbered from 1. The header shows `R×C` (or `N items` for a list), plus ` · first 1,000` when the render is capped.
- **The render cap.** At most `MAX_VISIBLE_ROWS` (1000) rows render; a 250,000-row frame would otherwise put about two million cells in the DOM. Only the render is capped: the sort ranks every row, and Copy, Export, the CSV view and the summary footer read every row.
- **Computed columns** have no raw text. The popup substitutes their derived values into every view, copy path and sort key, renders them read-only through the same formatting path as literal cells, and the keyboard skips them.
- **Column widths.** A number or date column's minimum width is measured from its visible text: the longest text times the monospace advance (13 × 27/42 pixels, from the shipped font metrics) plus 16, applied only above 72 and capped at 200. A text column takes at least 120 pixels from CSS.
- **Read-only cells** render as plain text in a focusable element (`tabIndex -1`), not as a read-only input, which costs about 2.5 times the DOM per cell. They keep keyboard movement.
- **NaN.** In a number or date column, a cell that shows `NaN` is dirty data, not an error: it gets a faint neutral tint, muted italic text and the tooltip "Not a number: an undefined value in the data".
- **Error cells.** A cell whose text is an error code wears the shared `#CODE!` treatment (`sol-error-chip`) with that code's explanation as its tooltip. The test is membership in `ERROR_EXPLANATIONS`, the complete record of codes, so a new code is covered the day it is declared ([[engineering#Lists of names are generated]]).
- **Chip columns.** A text column whose format is the Chip style draws its cells as `CategoryChip` pills, colored by first appearance in source row order, so sorting never recolors a category ([[format-model]]). In an editable cell in Formatted mode the pill overlays the input while it is unfocused and gives way to the raw text on focus.
- **Freeze header.** The header row and the row-number column are sticky. The overflow menu's Freeze header toggle (the setting `tablePopupFrozen`) turns that off so both scroll with the body. The summary footer keeps its own sticky behavior.
- **Header controls.** The column header's layout (type button, name, format button, sort button) and the Fx formula row are [[literal-input-editors]] § The frame popup's column header. The type button cycles Number, Text, Date, Boolean and then, on a literal-source frame editor without `noFormulaColumns`, Fx. Entering Fx adds an empty formula and commits nothing until the formula blurs. Leaving Fx makes the column a Number Data column and commits live. The formula field commits on Enter or blur when its text changed, and Escape restores the last committed formula. How a formula reads its row is [[computed-columns]].
- **Rows and columns.** On an editable grid, Add Row appends a blank row and − Row removes the last one (never the only one). Add Column and − Col do the same for columns, unless `fixedCols` hides them. A column is only ever added or removed at the end, so the other columns' sort keys stay valid; removing a column drops its own sort key.

### Editing a cell

Every editable cell edits through one draft (`editDraft`, a ref, with `editCell` marking which cell), never committing per keystroke, because a commit re-sorts the rows and would move the row out from under the caret.

1. Focus seeds the draft with the cell's raw text.
2. Typing updates the draft. A change on a cell that focus didn't mark marks it, so an edit never lands on an unmarked cell.
3. Blur commits the draft into the grid.
4. Escape while a cell is marked restores the draft, clears the mark and blurs, and the popup stays open. The shell's capture-phase listener sees Escape before the cell does. Escape with nothing being edited closes the popup.

Keys come from `gridKeyOf` and moves from `nextCell` (`gridKeyboard.ts`), over visual rows, so a move follows the sorted order. Ctrl, Meta and Alt combinations are left to the browser. While a cell holds an unsaved change, the arrows, Home and End move the caret, as in Excel's edit mode; Enter, Shift+Enter, Tab and Shift+Tab commit and then move. The target is taken from the visual position before the commit, so a commit that re-ranks a sorted row can leave the focus on a different row; that is accepted. Tab wraps across rows and skips computed columns, and Tab off either end falls through to the browser.

The cell being edited can carry an affix on its right edge:

- **Date and Boolean columns** show the calendar or the checkbox (`CellEditAffix`). The calendar seeds from `dateCellToISO` (below) and a pick writes its text into the cell.
- **Text columns** with existing values show suggestions (`CellSuggest`): the column's distinct values in first-seen order, blanks and error codes left out (`distinctColumnValues`). A bulleted-list opener shows them all, typing filters them in a list hung under the cell above the popup layer, ↑ and ↓ select, and Enter or Tab accepts. The list sees each keydown first. It never opens on focus alone, and anything new still types. It replaces the native `<datalist>`, whose opener and system-drawn list can't be styled.

## Formatted and Source

The Source checkbox appears on a literal-source editor, and on a read-only popup that is a frame or holds dates. Its tooltip says "Show and edit exactly what you typed, instead of formatted values like TRUE/FALSE and dates." on an editor and "Show the source text instead of the formatted value." elsewhere. The grid (raw text) stays the edit and save truth in both modes.

- **Literal source, Formatted:** each raw cell is coerced by its column type and formatted (`coerceFrameCell`, `formatFrameCell`). An editable cell shows the formatted text until focused, then the raw text, and shows the formatted text again after the commit.
- **Literal source, Source:** the raw text throughout.
- **Read-only, Formatted:** a date column formats its serials in the default date format. A blank date cell stays blank, because `Number("")` is 0, a real serial (30-Dec-1899).
- **Read-only, Source:** the typed text from `sourceCells` (a frame's `raw`) when there is one; otherwise the underlying form, so a logical shows `1` or `0` and a date its serial. A purely computed column has no `raw`, so it shows the underlying form.

## Column formats

A popup with `formatControls` offers the Format Controller's picks per column (`"columns"`, a frame) or once for the whole sheet (`"matrix"`, drawn above the grid). They show only in the Grid view and never for a list. A frame's picks sit behind the header's format button ([[literal-input-editors]]). They are display-only: they change what the grid and the CSV view show, never the value, Copy or Export. The Source checkbox wins over them on a read-only grid too, so Source shows what came in and Formatted shows the picks.

**The annotation a column renders with** is its local pick, else the format it carried in, else the type default ([[D41]] formatFlowsDownstream). The local pick is the popup host's entry in `frameFormatStore`, keyed by the derived column name (`"*"` for a matrix, which has no column names). The carried format is `columnFormats`, reported only for a column with no local entry, because the value's stamp already is this node's own pick wherever it made one. The type default is `date_dmy` for a date column and `auto` otherwise, with the column's display unit. A saved format of the wrong kind, a date style on a column switched to Number or the reverse, falls back to the type default.

- **A pick** writes `frameFormatStore.set(node, column, …)` with the current annotation merged under the change, so changing one axis keeps the rest of the inherited format instead of resetting the style to Auto. The unit is never stored there (`unit: "none"`), since a column's unit belongs to its value. The pick lives in a sidecar store that nothing else marks dirty, so the popup schedules an autosave itself, and it recomputes the host, because the format is stamped onto `FrameColumn.format` at compute.
- **The blank pick** deletes the entry, and the column renders what arrives (the carried format, else the type default), keeping its unit.
- **The controls by type:** Date gets `DateStyleSelect`, Boolean `LogicalStyleSelect`, Text `TextCaseSelect` (whose Chip value sets the chip style with no case change), Number `FormatStyleSelect`. Each shows the carried format as a muted hint (`columnFormatRow`).
- **The unit, Number columns only.** On a unit-taggable source the unit picker is live: on a frame it rides the source column (committed live for a computed column, at Save for a Data column); on a matrix it calls `onSaveMatrixUnit` at once. On a derived value with a unit, the picker is shown disabled with the tooltip "Unit: X (inherited from the source)".
- **How a formatted cell renders:** a logical by its logical style (a real boolean or `TRUE`, `FALSE`, `1`, `0` text); a date by its date style, default `date_dmy`; a number by its style with no unit conversion, because the stored magnitude is already in its display unit, and a stale date style on a number column reads as `auto`; text by its letter case alone.

## The Form view

The Form view exists only on a frame-source editor (`onSaveSource`). It shows one record as labeled fields and edits in both display modes, riding the same raw-text grid and the same draft as the grid cells.

- **The cursor** is a source row index, independent of the sort, so it reaches rows past the grid's render cap. A pager (previous, `i / n`, `0 / 0` when empty, next) moves it. Add Record appends a blank record and jumps to it; − Record deletes the current one and is disabled when only one is left. Row order is otherwise untouched, so sort keys stay valid.
- **Placement** follows the Record layout text (`formLayout`, parsed by `parseRecordLayout` with the Record figure's rules, [[chart-figures]] § The Record figure). A layout name matches a column by name, trimmed and ignoring case. A name that matches no column keeps an inert box that shows the layout's hint. A column not in the layout is not shown. An empty layout stacks every column in one column.
- **The layout is authored on the Frame Input card, never in the popup** ([[C63]] oneRecordNode). The card's Form Layout button opens the layout field (`RecordLayoutField`); an unauthored layout stays behind the button so most cards carry no empty text box. The field's hide button sets `layoutHidden`, which keeps the text, and the button then reads Show Form Layout. An emptied layout deletes `stringLiterals.layout`, so the form falls back to stacked. The popup reads the node's `activeLayout`.
- **The look** is the Record card made editable: touching square boxes with the label inside the box and the input as the box's value line.

The entry widget follows the column type:

| Column | Field |
|---|---|
| Computed | Read-only, showing the derived value through the column's format, with an accent dot beside the label. The dot is an SVG circle, never a rounded CSS box: a centered popup sits at a fractional position, where a small box's edges snap per axis and the dot reads as an oval. |
| Boolean | A checkbox. A pick applies at once and writes `TRUE` or `FALSE`. A blank cell shows the indeterminate state, because blank is not FALSE. |
| Date | A text input that edits a draft committed on Enter or blur, with the calendar (`CellEditAffix`) beside it. A native date input controlled per keystroke would wipe a half-typed year. The calendar seeds from `dateCellToISO`, which reads a serial or a parseable date text and gives `YYYY-MM-DD`, or nothing for a blank, unparseable or non-positive date. A pick writes that ISO text, which stays readable in the Source and CSV views. |
| Text, Number | A text input with the same draft. Enter commits by blurring. A text field offers the column's suggestions. |

In Formatted mode each field shows the formatted value until it is focused, and a cell whose text is an image source (`recordImageSrc`) shows the picture as well, as the Record figure does (`.sol-record__img`).

## The CSV view

The CSV view shows the same data as one text block (`CsvEditor`). A frame's block starts with a header line; a plain table or list has none.

- **Its text.** With Source off it is what the grid shows, a column's format picks included. Under Source it is the raw text. The Source checkbox rebuilds the block, unless the block holds text that doesn't fit, which a rebuild would lose.
- **Order.** A read-only block follows the visual sort. An editable block stays in source order, because its text parses straight back into the grid.
- **Editing.** Each change is parsed back into the grid (`parseCsvRows` with blank lines kept, so a blank line is a row of blank cells and only the final newline's phantom row drops; cells are trimmed). A header line parses back into the header names instead of becoming row 0. A change in the column count clears the sort.
- **Column types.** A frame's block settles its column types once, when it is left for Grid or Form or saved from, never per keystroke, which would type a column from a half-typed first value. A column the block added since it opened takes the type its values read as (`columnTypesAfterCsvEdit`, through the CSV reader's `inferColumn`, so only an ISO date reads as a date: [[C44]] dateSerials), and so does every column of a frame that was blank when the block opened (no header name, no cell). The other columns keep their types. A plain table's block has one cell type and settles nothing.
- **Computed columns bind by index,** so while the table has one, text whose rows don't each hold one value per column is refused: the error line "Every row needs the same number of values. This edit can't be saved until they match." shows under the block, Save is disabled, and the table keeps its last valid state until the text fits again. The block highlights computed columns' values in place: a mirror behind a transparent textarea paints the marks, with fields found by `csvFieldSpans`. A textarea can't lock part of its text, so marked text stays typeable and is ignored.
- **Focus and blur.** In Formatted mode an editable block shows its source text while focused and the formatted text again on the way out. Leaving the block rebuilds it when it is formatted or has computed columns, putting the computed values back over anything typed on them. Text that doesn't fit stays, under its error.

## Copy and export

The header's overflow menu (⋯) holds Copy CSV (Copy for a list), Copy as Markdown, Export CSV…, Show or Hide summary footer (frames only) and Freeze or Unfreeze header (Grid view only).

- **What is copied.** Every row of the dataset, never the rendered slice, in the visual sort order. The cells use the type's default format and follow the Source checkbox, but never a column's format picks. In the CSV view, Copy takes the block's text as it stands.
- **A list** copies as one line of values joined by `, `, matching the node's list result box, in sort order when shown as a column.
- **CSV quoting** follows RFC 4180 for every type, not text alone: a formatted number (`1,234.50`) or date carries a comma too and would otherwise split into two fields. Text cells keep their spaces; other cells are trimmed.
- **Formula-injection guard.** Every CSV that leaves the app passes through `csvSafety.ts` ([[C103]] untrustedContentSeams): the Table popup's Copy and Export guard every cell whatever its column type (a mixed list typed by its first cell, or a unit cell's `-5 km`, is text in a numeric column) and the header, a list's Copy included; the Cube popup does the same through the shared `csvField`; the Write File sink guards its text cells and its header. A cell a spreadsheet would evaluate on paste or open, one that starts with `=`, `+`, `-`, `@`, a tab or a carriage return and is not a number once thousands separators are dropped (`isFormulaTrigger`, so a formatted `-1,234.50` stays a number), gets a leading apostrophe. An editable popup skips this, because its CSV view must round-trip typed text exactly.
- **Markdown** is a pipe table: the header names (`Col N` when there are none, `Value` for a list), a `---` separator row, then the rows, with `|` escaped as `\|` and line breaks turned into spaces. A list is one column.
- **Export CSV…** saves the Copy CSV text through the save dialog (`saveCsvFileDialog`), named after the title with each run of characters outside letters, digits, `.`, `_` and `-` replaced by `_`, else `table.csv`.

## Sorting

The sort is visual only: it orders the rendered rows and the read paths, and never touches the grid. It is keyed on the popup state, so a newly opened value starts unsorted. Only the header's sort button sorts ([[literal-input-editors]]), through `columnSort.tsx`.

- The sort ranks every row of the dataset and the render shows the first 1000 of that order, so a sorted 50,000-row frame shows the true top.
- Sort keys come from the raw cell (a computed column from its derived value), never the shown text: a date shown as `20-Mar-2026` sorts by its serial.
- Each rendered row keeps its source index, so the row number and every edit address the real row.
- A list laid across one row has nothing to sort by column, so it shows no sort buttons.
- **The click cycle** is unsorted, ascending, descending, unsorted. Several columns sort at once, as in Excel: priority is the order the keys were added, and changing a column's direction keeps its place. A structural column change remaps the keys by index (`remapSort`), and a key whose column was dropped goes.
- **The key of a cell** (`sortKeyOf`) is a number, a logical as 1 or 0, decimal text read as a number (so a formatted "1,234" sorts numerically, while "0x1F" stays text), other text, an error's code (so failures group together), or nothing for a blank or a Frame, Cube or array cell.
- **The order.** Blanks sink to the bottom in both directions, as in a spreadsheet. Numbers come before all text, and text compares in natural order, case-insensitively ([[C59]] byteStringOrder: "item2" before "item10"). Rows equal on every key keep their source order.

## Lists

A list is one row of N cells. The footer's Row and Column switch lays it across a row or down a column. The switch is display-only: the value stays the flat row, and Copy, the CSV view and Markdown still flatten to the same list. Down a column it renders transposed and is capped at 1000 rows like a tall table. List popups open without a save callback, so the transposed render needs no edit-index remapping.

## The summary footer

Frame popups can show a footer with one statistic per column, toggled from the menu and remembered in the setting `tablePopupSummary`. Each column's statistic is picked from a select laid invisibly over the statistic's name, so the picker never widens the column. Until one is picked, a number column shows Sum and every other column Count.

| Column type | Statistics offered, in order |
|---|---|
| Number | Sum, Average, Min, Max, Median, Range, Std dev, then the common four |
| Date | Earliest, Latest, then the common four |
| Boolean | Checked, Unchecked, then the common four |
| Text | the common four |
| (common) | Count, Distinct, Empty, Errors |

The statistics run over every row: a read-only popup reads its value, an editable one re-parses the grid (`buildFrameColumns`), and a computed column reads its derived values. `describeColumn` supplies the profile (count, distinct, blank, error, mean, min, max, median, standard deviation). Sum adds the finite numbers (`aggregate("sum")`), Range is max minus min, and Checked and Unchecked count the TRUE and FALSE cells (blanks and errors are neither). Earliest and Latest are the column's min and max, shown in the default date format; every other statistic shows through `formatScalar`, and a missing one shows `—`. The result is cached on the identities it reads, so a keystroke or a sort click re-renders without rescanning the grid. A list laid down a column shows no footer.

## The popup shell

`PopupShell` is the shared modal chrome of the value and editor popups: the Table, Cube and chart popups among them.

- **Closing.** A pointer press on the dimmed overlay closes, as do the close button and Escape. A press on the card stops there. Escape goes through a capture-phase listener (`useEscapeToClose`) to `onEscape` when given (the Table popup reverts an edit, the Cube popup pops a level), else to close. The listener lives as long as the shell, so a caller mounts the shell only while the popup is open.
- **The header** holds the title, `headerExtra` (dimensions, badges), then, when the popup has a host node (`pinNodeId`), Go to source and Pin, then `headerActions` (the overflow menu) and the close button. Go to source closes the popup and flies to the node that produced the value, resolved upstream through relays (`resolveValueOrigin`, [[type-propagation-on-in-place-socket-retype#Relays are transparent]]), searching within a drill-in's subgraph when the host lives there. Pin pins the host's value to the HUD (`pinNodeValue`) and shows the pinned state in the accent.
- **The accent.** `popupCardVars` sets `--node-accent`, its contrasting ink `--node-accent-ink`, the darkened `--node-accent-dark` (the light theme's body border, as on the node card), and `--group-color` and `--group-color-dark` for a grouped host, which also adds the group framing (a 2 pixel group-colored body border and the lower-right membership triangle). The edited cell, the format selects, the CSV box and the footer's Save or Done wear the popup's own accent, so a frame popup reads violet like the frame it edits; two unrelated hues on one surface would clash. Only a popup with no host falls back to the app accent. On touch devices the footer's controls shrink so the row and column buttons and Cancel and Save share one row ([[obsidian-plugin]] has the measured sizes).
- **The look** mirrors a node card, so a popup reads as an extension of the node it came from: the card's surface and 6 pixel radius, a header with a 2 pixel accent border on its top and sides, a tinted background and an inset bottom divider, and an uppercase accent-tinted title. The 1 pixel body border (sides and bottom, starting under the header at `--header-h`, which `PopupShell` publishes) is drawn on the card's own box, the same box as the header, so the two edges stay aligned at fractional zoom. In the light theme an ungrouped popup's body border is the darkened accent, as on the node card. The overlay pads the viewport by 10 pixels and the card never exceeds it. Popup buttons and selects use the app font; the grid inputs and the CSV block use the monospace font. On touch devices the header's close and pin targets grow.
- **Resizing.** A popup given `resizable` has a corner grip, the same mark as the node and field grips (`PopupResizeGrip`, the screen-space sibling of `FieldResizeGrip`). The overlay keeps the card centered, so both edges move and the card grows by twice the pointer's travel, clamped between the given minimum and the viewport less 20 pixels. The drag lives at module scope so a re-render mid-gesture can't drop it, and the grip sets `touch-action: none` so a finger drag isn't taken for a scroll. Until the first drag the card keeps its content size (a figure popup passes `initial` to be sized from the start); once sized it is a flex column whose `.sol-popup__scroll` region fills. The Table and Cube popups' minimum is 320 by 220.
- **The overflow menu** closes on a press outside it. It tests the press's composed path, because inside a shadow root (the Obsidian plugin) the event target is the host.
- **Layering.** The overlay sits above the full-screen overlays (Report, Composite editor, Function Reference, z-index 9000) at 9500, so a popup opened from inside one lands on top, and below the transient socket context menu (9999). The header's floating panels (the format panel, the λ list, the suggestions) portal to `<body>` above the popup layer. The Table popup is `min(1100px, 94vw)` wide and its grid scrolls within 56% of the viewport height.

## The Cube popup

`CubePopup` is the one read-only viewer for every nesting kind: a cube, a frame, a list or a grid of cells. A cell that holds a nested container drills deeper in place, pushing a level onto a breadcrumb stack (`cubePopupStore`), so a second window never opens.

- **The drill stack** (`cubePopup`) is `[root, ...drilled]`, and its last entry is the view shown. Each level (`DrillView`) is a `cube`, a `frame`, a `grid` (a list as one row, or a matrix of cells) or a `list` (one row by default, since a list reads as a CSV row, or one item per row through the layout switch). It carries a `label` that is its breadcrumb: the node name at the root, the column name deeper. `drill(view, from)` pushes a level and records `from`, the parent cell (`CellRef`, by source row and, when known, column) it was opened from. `backTo(i)` cuts the stack back to breadcrumb level `i` (0 is the root) and sets that level's `focus` to the cell the next level came from, so the return scrolls back to it. `pinNodeId` is the host node for the header's Pin action, at the root only.

- **Navigation.** With more than one level, a breadcrumb row shows each level's label, and clicking one returns to it. Escape pops one level and closes at the root. Returning scrolls the cell the level was opened from into view and flashes it for 1.2 seconds (`table-popup__cell--return`).
- **The header** shows `R×C` or `N items`, the render-cap note, and for a cube `Depth N` (tooltip: how many levels of cubes it nests, or "A flat cube, with no cube nested inside"). Go to source and Pin show only at the root level.
- **Cells** render through `cubeCell.tsx`, the one place that maps a cell's kind to its look and to what drilling it pushes. A list cell shows in brackets with its first items (`[a, b, c…]`), with more in its tooltip, printed by the column's element type (a date list's serials as dates). A 2-D cell shows its shape (`[3×4 Table]`), and a nested frame or cube its shape too. A nested list's chip is tinted by its element family: the column's declared type when the cube carries one, else its cells, and a mixed list stays untinted. A flat frame cell renders by its column type: a serial as a date in the column's format, a logical as TRUE or FALSE, an error as its red code, a unit cell as `5 km`.
- **Sorting** is keyed on the drill level, so a sort never carries a column index across to an unrelated table. Sort keys come from the raw cells, and the cell renderer is handed the source row, so drilling a sorted row reaches the right value. The render is capped at 1000 rows.
- **Copy and export** (Copy CSV, Copy as Markdown, Export CSV…) emit every row of the current level in sort order. A nested container serializes as its chip token (`[3×2×1 Cube]`, `[5×2 Frame]`, `[a, b, c…]`), never expanded. The header line is always present (`Col N` when the level has no names). CSV quoting and the formula guard are the Table popup's (`csvField`). The file is named after the level's label, else `cube.csv`.
- **Lists** have the same Row and Column switch as the Table popup.

### Editing a Cube Input

A Cube Input's chip opens the popup as an editor bound to the node (an edit binding, `CubeEditBinding`: `records()` and `save(records)`, read and written back whole); its stored truth is `cubeText` ([[literal-input-editors]]). Each level carries the records `path` it shows, and `refresh()` after a save rebuilds every cube, frame and list level from the records along its path. At each editable level (one with a records path), the cells are editing cells (`CubeEditCell`, `ListEditCell`). Every commit patches the records at the cell's path, the popup re-derives its stack from them, and the records re-serialize into `cubeText`.

- **Headers** are editable (`CubeEditHeader`): renaming a key renames it on every row and keeps its position. Enter or blur commits and Escape reverts ([[C95]] commitOnEnter).
- **The footer** (`CubeEditRows`) adds and removes a row (a record, or a list item), and on a table or cube level adds and removes a column (the last key on every row). A new column arrives named `Column N`, for the header to rename.
- Column keys show in first-seen order across the records, the order the cube shows.

## Enforced by

`tests/graph/displayPopupCoverage.test.ts` (every Display value kind has a popup), `tests/graph/nodes/tableInput.test.ts` (raw text survives), `tests/graph/tableFooterStats.test.ts`, `tests/graph/gridKeyboard.test.ts`, `tests/graph/columnSort.test.ts`, `tests/graph/nodes/computedColumn.test.ts` (the λ naming) and `tests/graph/listInputChip.test.ts`.
