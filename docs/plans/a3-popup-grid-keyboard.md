# A3 (remainder) — the popup grid's keyboard path

**Goal.** The table popup's grid moves like a spreadsheet: Enter commits and moves down,
Tab/Shift+Tab move right/left (skipping computed cells), arrows move between cells, Home/End
jump to the first/last column, Escape reverts the cell being edited (and only closes the
popup when nothing is mid-edit). Movement follows the SORTED visual order and stays inside
the rendered window (the first 1,000 rows). No new strings, no new chrome.

**Read first.** `DESIGN.md` §5 "Inputs / Fields" + §7 (only if you add a tooltip — you
shouldn't); `docs/code-comments.md`. The mechanism template is
`src/graph/components/columnSort.tsx` + `src/graph/columnSort.test.ts` — pure part in a
module, tested in node; the component only wires it.

**Backlog line to delete when done:** `docs/backlog.md` "A3 (remainder)". Leave the
AUTHOR EYEBALL sentence's intent in your final message (it is still unverified).

## Where it is

- The grid cell `<input>`: `src/graph/components/TablePopup.tsx:845-865`. Its entire
  keyboard path is `:861-864` (Enter → blur; Escape → reset draft, blur). Draft model:
  `editCell` `:146`, `editDraft` ref `:150`, `bumpDraft` `:151`, `setCell` `:388-390`
  (writes local `grid` only; Save persists at `:569-575`). Read the comment at `:143-145`
  — it is why the draft is a ref.
- `canEdit` `:816`; computed cells early-return a `readOnly tabIndex={-1}` input at
  `:826-832` (already Tab-skipped — keep that behaviour in the navigator).
- Row order: `sortOrder` / `visibleOrder` `:365-367`; rows render in sort order but carry
  their SOURCE index `r` (`:794-798`). `MAX_VISIBLE_ROWS = 1000` `:224`.
- The form view repeats the same Enter/Escape handlers at `:942-952` — leave it alone
  except as noted in step 5.
- **The Escape conflict:** `src/graph/components/PopupShell.tsx:60`
  `useEscapeToClose(onEscape ?? onClose, true, { capture: true })` →
  `src/graph/components/useEscapeToClose.ts:14-23` is a WINDOW capture listener with no
  editable-target guard, so today Escape mid-edit closes the popup (and discards the
  unsaved grid) before the cell's handler runs. Precedent for intercepting it:
  `CubePopup.tsx:129-132` passes `onEscape` to pop a drill level.
- Canvas shortcuts are safe: `src/graph/canvasKeyboard.ts:142` gates arrows/Enter/Tab
  behind `!editable` (INPUT/TEXTAREA/SELECT). No focus trap on `PopupShell` (only the
  dialogs use `useFocusTrap`) — do not add one.
- No 2-D keyboard grid exists anywhere else in `src/` (checked); nothing to reuse and
  nothing else to keep in sync.
- Hook-order constraint: everything below `TablePopup.tsx:211` (`if (!state) return null`)
  must be plain computation; new hooks go above it.

## Design (decided — don't re-open)

- New module `src/graph/components/gridKeyboard.ts`, pure, exported:
  `type GridKey = "Enter" | "ShiftEnter" | "Tab" | "ShiftTab" | "ArrowUp" | "ArrowDown" |
  "ArrowLeft" | "ArrowRight" | "Home" | "End"`;
  `gridKeyOf(e: {key, shiftKey, ctrlKey, metaKey, altKey}): GridKey | null` (modifiers other
  than Shift → null);
  `nextCell(key, pos: {vi, c}, dims: {rows, cols}, skip: (vi, c) => boolean): {vi, c} | null`
  where `vi` is the VISUAL row position (index into `visibleOrder`), not the source row.
  Rules: Enter/ShiftEnter = down/up one row, same column; Tab/ShiftTab = next/prev cell
  wrapping to the next/prev row, skipping `skip()` cells, `null` off either end (let the
  browser do its default Tab); arrows = one step, clamp at edges (return the same cell,
  never null); Home/End = column 0 / `cols-1` on the same row. Arrows/Home/End do NOT skip
  computed cells (you can land on them; they're read-only).
- **Arrows navigate unless the cell is mid-edit** (draft ≠ committed value); mid-edit they
  move the caret as normal. Enter/Tab always commit-then-move. This is Excel's Enter-mode /
  Edit-mode split, without an F2. Home/End follow the same rule as arrows.
- Focus targeting via DOM attributes, not refs: every cell input gets `data-vi={vi}`
  `data-c={c}`; the mover does
  `gridRef.current?.querySelector<HTMLInputElement>(\`input[data-vi="${vi}"][data-c="${c}"]\`)?.focus()`
  then `select()`. Add a `ref` on the `.table-popup__grid` table (or its scroll wrapper) —
  one ref, not one per cell.
- Commit-then-move ordering: call `setCell(r, c, editDraft.current)` + `setEditCell(null)`
  explicitly BEFORE focusing the target (do not rely on the blur handler — it runs, but
  make the commit explicit and make blur a no-op when `editCell` is already null). A commit
  can re-rank the row under the caret (sort); the move targets the VISUAL position computed
  BEFORE the commit — accept that; note it in the digest.
- Escape: TablePopup passes `onEscape` to `PopupShell`: if `editCell` is set → revert draft
  (`editDraft.current = grid[r]?.[c] ?? ""`), `setEditCell(null)`, blur the active element,
  stay open; else `tablePopup.close()`. Delete the per-cell Escape branch at `:863` (the
  shell now owns it; the capture listener fires first anyway). Same for the form view's
  Escape at `:948-951` — the shell path handles it because `editCell` is set there too;
  verify before deleting.
- Movement is bounded by the rendered window (`visibleOrder.length`), not `rows`. No
  virtualization here (that's the separate "Virtualize the table/cube popups" backlog
  item — don't start it).
- `ShortcutsOverlay.tsx` gets NO popup section (decision: the keys are the universal
  spreadsheet set; listing them is Captain-Obvious copy).

## Steps

1. `gridKeyboard.ts` + `src/graph/gridKeyboard.test.ts` first (pure; node env). Cases:
   every key from every edge/corner of a 3×3; Tab wraps rows and skips a computed column;
   Tab off the last cell → null; ShiftTab off the first → null; arrows clamp; modifiers
   (Ctrl+Enter, Alt+Arrow) → null; Home/End; 1×1 grid; `cols = 0`.
2. Wire the grid cell (`TablePopup.tsx:845-865`): `data-vi`/`data-c`; replace the
   `onKeyDown` with: `const k = gridKeyOf(e); if (!k) return;` arrows/Home/End bail when
   mid-edit; otherwise `e.preventDefault()`, commit if editing, compute `nextCell` with
   `skip = (vi, c) => isComputed(c)`, focus. The cell needs to know its `vi` — it's the map
   index at `:796`. `mid-edit` = `editingHere && editDraft.current !== (grid[r]?.[c] ?? "")`.
3. Escape via `PopupShell` `onEscape` as designed; delete the cell-level Escape.
4. `tsc` + `columnSort.test.ts` + the new test + `uiCopy.test.ts` (no strings changed, but
   it's cheap) + `sourceInvariants.test.ts` (a new module in `components/` must not trip its
   allowlists — `gridKeyboard.ts` calls nothing guarded, so it should pass unchanged).
5. Form view: Enter/Escape stay as they are (`:942-952`) except the Escape deletion in
   step 3. Arrow-key record paging is a deferral (`docs/deferrals.md:92-94`) — leave it.
6. Full suite. Commit.

## Done when

- New test green; full suite + `tsc` green; no new UI strings.
- Digest line in `docs/dev-notes.md`; backlog line deleted; this file deleted.
- Final message lists for the author to eyeball at http://localhost:1420: open a Table
  Input popup → type in a cell, Enter moves down and keeps the value; Tab walks right and
  wraps; arrows move when not typing, move the caret when typing; Escape mid-edit reverts
  and keeps the popup open, Escape again closes; a sorted column still navigates in the
  visual order; plus the standing >1,000-row sort/Copy CSV check from the backlog line.
