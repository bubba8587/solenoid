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
| 4 | ~~b0-python-r-gap-remainder~~ | — | landed 2026-08-24 (683cf86d, 2df21a82, 46c71976, 88c8a724; docs a69a487f) |
| 5 | ~~a4-xlookup-rawinputs~~ | — | landed 2026-08-24 (ec15cdf2) |
| 6 | ~~a6-drill-in-drag-guard~~ | — | landed 2026-08-24 (aea271a1 + 6acb5b1c) |
| 7 | ~~a3-popup-grid-keyboard~~ | — | landed 2026-08-24 (f66d3281) |
| 8 | ~~b8-cube-unnest-timesavers~~ | — | landed 2026-08-24 (B8.1 5a5b3ab6, B8.2 2567631d/f42b42d0, B8.3 a03eeba3) |
| 9 | ~~a5-node-sweep~~ | — | COMPLETE 2026-08-24 (all 23 families; 3 bugs fixed, ~34 pins) |
| 10 | ~~b7-tidy-options~~ | — | COMPLETE 2026-08-24 (engine 055fd1c9/9d2aca24/96968206 + chrome; elkjs stays 0.8.2) |
| 11 | ~~c2-chart-multi-series~~ | — | landed 2026-08-24 (68a96766 … 179ba3a5, docs 43a22615) |
| 12 | ~~c3-set-cell~~ | — | landed 2026-08-24 (af64d772 + 2ebb4a65) |
| 13 | ~~c4-grid-axes~~ | — | landed 2026-08-24 (d01f6d10 + 4184d711; nodeCatalog copy in baae4eb4; grep-bordered-empty met) |
| 14 | ~~c5-correlated-outputs~~ | — | COMPLETE 2026-08-24 (7 nodes → one frame each; Series-inclusive + REDUCE copy; ETS dbff6936) |

Not planned here (author-present or needs a device): everything under "Bugs &
verifications" in `../backlog.md`, the Vite 8 bump, `rete-area-plugin` 2.3.2, lazy handles (B9).
