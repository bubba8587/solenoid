<!-- [[C28]] literalsIffEditable -->

# Spec: Literal input editors

Serves [[C28]] literalsIffEditable. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

## The popup is the editor for rank-2+ literal sources

Three literal sources edit through the table popup:

- **Table Input**: raw cells, through `onSaveRaw`.
- **Frame Input**: the literal-source grid, through `onSaveSource` / `onCommitSource`.
- **Cube Input**: the cube popup in edit mode. A nested cell drills to an editable list, table or Cube level on the breadcrumb, in one window and never a popup above a popup, with each level bound to a records path.

The stored truth is always text on the node (`tableText`, `frameText`, `cubeText`). A Save rewrites that text and recomputes; it never writes a derived value back.

**Reopen if:** a literal source grows its own editor widget instead of binding the popup, or an editor writes a derived value back.

## The frame popup's column header is one row

The author's call. On an editable Frame the order is type button → name → paintbrush and chevron → sort. On a read-only Frame it is name → paintbrush → sort.

- **Only the sort button sorts**, in table and Cube popups alike. It is drawn on every sortable column, stays quiet until it carries a direction, and a click anywhere else in the header does nothing.
- **The paintbrush** (the shared `PaintbrushIcon`, the Format Controller's icon) opens the column's Format Controller picks (style, the inherited-format hint, unit) in a dropdown panel, tinted once this node has made a pick. There is no format row under the header; a matrix keeps its one whole-sheet pair above the grid.
- **Fx lives inside the type button.** On a Frame Input the cycle is Number / Text / Date / Boolean / Fx, and leaving Fx lands on a Number Data column. An Fx column has no type to pick, since its type is inferred from the cells, and it grows a second header row holding the column's formula, committed on Enter or blur.
- **LAMBDA inputs have no picker of their own.** While the formula field is focused, the LAMBDA socket names (`λ1`, `λ2`) list below it, and the name typed in the formula reaches that λ. A formula that is only the name binds the λ's parameters to columns by name ([[C50]] lambdaBindsByName), and `λ1(@price, @qty)` calls it with positional arguments like any LAMBDA call. A named socket with nothing wired leaves the column blank. The stored column carries `expr` alone.
- **Both floating panels portal to `<body>`**, fixed under their anchor, above the popup layer and clamped into the viewport. Rendered in place, they would take header space and be clipped by the grid's scroll container (`columnHeadControls.tsx`; `tests/graph/nodes/computedColumn.test.ts` pins the λ naming).

**Reopen if:** a column gains a source control outside the type button, or the format picks return to a row of their own.

## List Input is not one of them

The author's call. List Input's rows are typed on the card and are its only editor, and every row's values concatenate into one flat list. The value box's chip opens the ordinary list value popup view-only: no save callback, but it keeps the shell's resize grip, the Row / Column switcher and copy. A raw-row editor and a dummy chip were once added without an ask and later removed; `tests/graph/listInputChip.test.ts` pins the card's form.

**Reopen if:** the popup gains a save callback for it.
