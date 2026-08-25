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

## Open plans (independent unless noted)

Plain, descriptive file names only (no letter-number codes). Landed plans are deleted; git is
the record.

| Plan | Size | Notes |
|------|------|-------|
| `vite-8-upgrade` | small, gated | The persisted node type is `constructor.name`; the two artifact checks are the point. Queued to A3. |

Not planned here (author-present or needs a device): everything under "Bugs &
verifications" in `../backlog.md`; the table-popup virtualization (Path A vs B is the
author's call); the formula-surface allowlist (raise with the author first).
