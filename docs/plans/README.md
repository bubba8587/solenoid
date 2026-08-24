# Execution plans (2026-08-24)

Task plans written so a SMALLER model can do the routine work without re-deriving the
codebase. Each plan is self-contained: exact `file:line` pointers (verified 2026-08-24),
the steps in order, the tests to add, and a done-definition. Delete a plan when its
backlog line is deleted; git is the record.

## Protocol for the implementing agent

1. Work on `develop`. Commit after each plan step that leaves `tsc` + `vitest` green;
   never push (the author pushes). Never leave uncommitted edits. The working tree AND
   the index are shared with other agents: commit by pathspec in one command —
   `git commit -m "…" -- <your files>` — never a bare `git commit` after `git add`, never `-a`/`-A`.
   A NEW file must be `git add <file>`ed first (pathspec can't see untracked files); the
   `-- <paths>` on the commit still limits it to exactly those paths.
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
| 2 | ~~c-archive-evictions~~ | — | landed 2026-08-24 (0cf70611) |
| 3 | ~~b6-popup-summary-footer~~ | — | landed 2026-08-24 (753c6c6c) |
| 4 | [b0-python-r-gap-remainder.md](b0-python-r-gap-remainder.md) | M (4 sub-items) | — |
| 5 | ~~a4-xlookup-rawinputs~~ | — | landed 2026-08-24 (ec15cdf2) |
| 6 | ~~a6-drill-in-drag-guard~~ | — | landed 2026-08-24 (aea271a1 + 6acb5b1c) |
| 7 | ~~a3-popup-grid-keyboard~~ | — | landed 2026-08-24 (f66d3281) |
| 8 | [b8-cube-unnest-timesavers.md](b8-cube-unnest-timesavers.md) | M (3 sub-items) | B8.3 needs A4 |
| 9 | ~~a5-node-sweep~~ | — | COMPLETE 2026-08-24 (all 23 families; 3 bugs fixed, ~34 pins) |
| 10 | [b7-tidy-options.md](b7-tidy-options.md) | M (engine then chrome) | — (elkjs stays 0.8.2) |
| 11 | [c2-chart-multi-series.md](c2-chart-multi-series.md) | M | — (author ask 2026-08-24; edits visual.ts — coordinate with B0.2 and the A5 Visuals row, both done) |
| 12 | ~~c3-set-cell~~ | — | landed 2026-08-24 (af64d772 + 2ebb4a65) |
| 13 | [c4-grid-axes.md](c4-grid-axes.md) | M (2 commits) | — (author ask; touches stats.ts, mathUtils.ts, visual.ts SurfaceNode, INTERPOLATE/HISTOGRAM2D formulas; coordinate with C2 on visual.ts) |
| 14 | [c5-correlated-outputs.md](c5-correlated-outputs.md) | M (7 small commits) | Decompose after B0.4 (author rule; stats.ts, list.ts, control.ts) |

Not planned here (author-present or needs a device): everything under "Bugs &
verifications" in `../backlog.md`, the Vite 8 bump, `rete-area-plugin` 2.3.2, lazy handles (B9).
