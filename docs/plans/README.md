# Execution plans (2026-08-24)

Task plans written so a SMALLER model can do the routine work without re-deriving the
codebase. Each plan is self-contained: exact `file:line` pointers (verified 2026-08-24),
the steps in order, the tests to add, and a done-definition. Delete a plan when its
backlog line is deleted; git is the record.

## Protocol for the implementing agent

1. Work on `develop`. Commit after each plan step that leaves `tsc` + `vitest` green;
   never push (the author pushes). Never leave uncommitted edits.
2. Before editing a file, read it. Line numbers in a plan are anchors, not truth — grep
   for the symbol if the line has drifted.
3. Read `CLAUDE.md` in full, then the docs a plan names under "Read first". Do NOT read
   the whole `docs/` tree.
4. `npx tsc --noEmit` and `npx vitest run <the test files the plan names>` after every
   step; the full `npx vitest run` before the final commit of a plan.
5. Comments: none unless the plan says so (`docs/code-comments.md`). Rulings go in
   `docs/rules.md` / `docs/decisions.md` only where the plan says.
6. Stay on scope. A tempting adjacent fix → one line under "Findings" in the plan's
   digest entry, not a change.
7. When the plan is done: one terse line in the current `docs/dev-notes.md` digest,
   delete the backlog line, delete the plan file, commit.
8. UI changes: do NOT browser-automate to verify; run the checks, then list what the
   author should eyeball at http://localhost:1420 in the final message.

## Order (independent unless noted)

| # | Plan | Size | Depends on |
|---|------|------|-----------|
| 1 | ~~a2-formula-containment~~ | — | landed 2026-08-24 (fc34ae03) |
| 2 | [c-archive-evictions.md](c-archive-evictions.md) | S | — |
| 3 | [b6-popup-summary-footer.md](b6-popup-summary-footer.md) | M | — |
| 4 | [b0-python-r-gap-remainder.md](b0-python-r-gap-remainder.md) | M (4 sub-items) | — |
| 5 | [a4-xlookup-rawinputs.md](a4-xlookup-rawinputs.md) | S–M | — |
| 6 | [a6-drill-in-drag-guard.md](a6-drill-in-drag-guard.md) | M | — (largest model available) |
| 7 | [a3-popup-grid-keyboard.md](a3-popup-grid-keyboard.md) | M | — (B6 touches the same file; coordinate if both are in flight) |
| 8 | [b8-cube-unnest-timesavers.md](b8-cube-unnest-timesavers.md) | M (3 sub-items) | B8.3 needs A4 |
| 9 | [a5-node-sweep.md](a5-node-sweep.md) | L, claimed PER FAMILY | — (skip Cubes while B8.1 is in flight) |

Not planned here (author-present or needs a device): everything under "Bugs &
verifications" in `../backlog.md`, the Vite 8 bump, `rete-area-plugin` 2.3.2, Tidy
options (B7), lazy handles (B9).
