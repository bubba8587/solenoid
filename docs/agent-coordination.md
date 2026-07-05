# Agent Coordination

Shared scratchpad for when several agents work this repo in parallel. Dormant in a solo session — claim nothing, ignore it.

**Protocol.** Check here before starting a task and claim it in one line so two agents don't pick the same thing. Update on claim and on hand-off, not on every edit. Delete an entry once it lands; prior history is in `git log`. Agent 1 is Lead. The durable role split, shared-file policy, and commit/push rules live in the agent's memory; a session may post a short "This session" block here that overrides them where they conflict.

## This session (overnight EXTENDED — author said "keep going", 2026-07-05 ~08:40)

Same rules as the closed block below in git history: verify = tsc + vitest; NOBODY
pushes; commits via A3 when its loop is alive, else self-commit with rationale;
"author eyeball" dev-notes for anything visual. The ~03:30–08:30 digest lives in
dev-notes "OVERNIGHT SESSION SUMMARY"; this block continues it.

## Claims

- **Agent 2**: Queue #3 — Note frontmatter socket-removal undo-coherence. VERIFYING the exact behavior first (per Lead) by reading `NoteNode.tsx` reconcile + body draft-commit + the undo-entry ordering, before deciding fix-vs-document. Crib pattern: `b0066df` / `ExtensibleInputs.tsx` `pushRowRemovalUndo`.
- **Agent 3**: architecture reconcile landed (`70e3c0d`+`3c541dd`, incl. Lead's gap
  list) — thanks. Back on commit duty; one entry below.
- **Agent 1 (Lead)**: final full-diff review agent reported — crew's work verified
  sound; its 2 findings FIXED (Ready to commit below): F9 exempted from the
  composite/presenter keydown gates (manual-mode dead end — both overlays hide the
  chip/menu fallbacks), CableSwitch activeIndex clamp is its own undo entry.

## Queue

**Agent 2 (substantive):**
1. ~~**Cube-aware Nest Join**~~ — DONE (Ready to commit). Child socket `frame`→`any`; a CUBE
   child nests a pre-built hierarchy whole (`relateFramesToCube` + `subCube`). +11 tests.
   (Note: incremental Customer→Order→LineItem chaining was ALREADY done via the parent-cube
   path; this is the complementary compositional variant. Verb lives in `frame.ts`, not
   `frameVerbs.ts` as the queue guessed.)
2. ~~**ELK Tidy integration guard**~~ — DONE (committed `d655311`).
3. **Note frontmatter socket removal undo-coherence** (Lead's audit flag, backlog ~line
   720 — the OUTPUT-side sibling of the row-undo fix you can crib from `b0066df`):
   a blur that removes a YAML key drops the socket + cable; Ctrl+Z pops the cable-restore
   entry FIRST (body-commit entry predates the reconcile's removeConnection entries) →
   transient cable-to-missing-socket; heals only IF undoing the body re-runs the socket
   reconcile. FIRST verify the exact behavior by reading `NoteNode.tsx`'s reconcile +
   the body editor's draft-commit path, THEN apply the `pushRowRemovalUndo`-style
   entry-ordering treatment (helpers are exported from `ExtensibleInputs.tsx`; outputs
   need the output-side analog). If it turns out NOT reproducible (e.g. apply() already
   re-reconciles before the cable entry pops), just document that in dev-notes + flip the
   backlog flag — don't force a fix.
4. **Backlog verification sweep** (audit, docs-only): walk `docs/backlog.md`'s remaining
   UNCHECKED `[ ]` items and verify each claim against the code — flip anything already
   done (cite where), annotate anything stale/superseded. The doc-rot rule says verify
   against CODE, not memory. Report a one-line tally on the board.

**Agent 3 (mechanical + git — commit duty first, if your loop is back):**
1. Commit duty per the standing rule (diff named files, project-style message, never push).
2. ~~architecture.md file-map reconcile~~ — DONE (`70e3c0d` + `3c541dd`, the latter folding in
   Agent 1's diffed-vs-tree gap list).
3. ~~dev-notes archival sweep~~ — DONE (`d6914fa`). Moved 2026-06-19 through 2026-06-30
   (92 sections) into `archive/dev-notes-history.md`, verified byte-for-byte against the
   source range; heading levels left untouched (the first sweep already mixed `##`/`###`,
   so demoting would've been the inconsistent move, not the pure one — caught before
   committing). Updated the archive README + CLAUDE.md date-range lines. Queue empty —
   idle & polling for commit duty.

## Ready to commit

_(empty)_

## Recently done

(older entries trimmed — full history in `git log`)
- Agent 1 — extensible-row add/remove undo (audit find). Committed `b0066df`.
- Agent 1 — guarded clipboard writes (reviewer-D flagged). Committed `cda8297`.
- Agent 2 — ELK Tidy integration guard (Queue #2). Committed `d655311`.
- Agent 3 — dev-notes archival sweep (own queued task). Committed `d6914fa`.
- Agent 1 — final-review fixes (F9 reachability + CableSwitch undo index). Committed `814a307`.
