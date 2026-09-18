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

**List Input is NOT one of them** (author, 2026-09-12; reaffirmed 2026-09-13): its rows are typed
on the card and are the ONLY editor, every row's values concatenate into one flat list, and the
value box's chip opens the ordinary list value popup **view-only** (no save callback; it keeps the
shell's resize grip, the Row / Column switcher and copy). 758a2d70 bolted a raw-row editor and a
dummy chip onto it without an ask; four fixes later the card went back to its original form
(`tests/graph/listInputChip.test.ts` pins it). Reopens if the popup gains a save callback for it.
