<!-- [[C28]] literalsIffEditable -->

# Spec: Literal input editors

Serves [[C28]] literalsIffEditable. The mechanics a builder implements: what the system does and blocks, with the decision each behaviour serves. Lifted from `docs/subsystem-invariants.md` § Literal input editors; a WHY that is not in a node belongs in one.

The rank-2+ literal sources edit through the table popup: **Table Input** (raw cells,
`onSaveRaw`), **Frame Input** (literal-source grid, `onSaveSource` / `onCommitSource`), and
**Cube Input** (the cube popup in edit mode: a nested cell drills to an editable list / table /
cube LEVEL on the breadcrumb — one window, never a popup above a popup — each level bound to a
records path). The stored truth is always TEXT on the node (`tableText`, `frameText`,
`cubeText`); a Save rewrites that text and recomputes, never a derived value. Reopens if a
literal source grows its own editor widget instead of binding the popup, or if an editor writes
a derived value back.

**The frame popup's column header is one row** (author, 2026-09-19): type button → name →
paintbrush + chevron → sort. A read-only frame's header is name → paintbrush → sort. **Only
the sort button sorts** (table and cube popups alike): it is drawn on every sortable column,
quiet until it carries a direction, and a click anywhere else in the header does nothing. The
paintbrush (the shared `PaintbrushIcon`, the Format Controller's icon) opens the column's
Format Controller picks (style, the inherited-format hint, unit) in a dropdown panel, tinted
once this node has made a pick; there is no format row under the header (a matrix keeps its
one whole-sheet pair above the grid). **Fx lives inside the type button**: on a Frame Input
the cycle is Number / Text / Date / Boolean / Fx, and leaving Fx lands on a Number Data
column. An Fx column has no type to pick (it is inferred from the cells) and grows a second
header row holding the column's formula, committed on Enter / blur. A
Frame Input's LAMBDA inputs have no picker of their own: while the formula field is focused
their socket names (`λ1`, `λ2`) list below it, and the name typed in the formula reaches the
λ. A formula that is only the name binds the λ's params to columns by name ([[C50]]
lambdaBindsByName); `λ1(@price, @qty)` calls it with positional arguments like any lambda
binding. A named socket with nothing wired leaves the column blank. The stored column carries
`expr` alone. Both floating panels portal to `<body>`, fixed under their anchor and above the
popup layer, clamped into the viewport: rendered in place they would take header space and be
clipped by the grid's scroll container (`columnHeadControls.tsx`;
`tests/graph/nodes/computedColumn.test.ts` pins the λ naming). Reopens if a column gains a
source control outside the type button, or the format picks return to a row of their own.

**List Input is NOT one of them** (author, 2026-09-12; reaffirmed 2026-09-13): its rows are typed
on the card and are the ONLY editor, every row's values concatenate into one flat list, and the
value box's chip opens the ordinary list value popup **view-only** (no save callback; it keeps the
shell's resize grip, the Row / Column switcher and copy). 758a2d70 bolted a raw-row editor and a
dummy chip onto it without an ask; four fixes later the card went back to its original form
(`tests/graph/listInputChip.test.ts` pins it). Reopens if the popup gains a save callback for it.
