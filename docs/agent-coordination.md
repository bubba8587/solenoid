# Agent Coordination

Shared scratchpad for when several agents work this repo in parallel. Dormant in a solo session — claim nothing, ignore it.

**Protocol.** Check here before starting a task and claim it in one line so two agents don't pick the same thing. Update on claim and on hand-off, not on every edit. Delete an entry once it lands; prior history is in `git log`. Agent 1 is Lead. The durable role split, shared-file policy, and commit/push rules live in the agent's memory; a session may post a short "This session" block here that overrides them where they conflict.

## This session (overnight EXTENDED — author said "keep going", 2026-07-05 ~08:40)

Same rules as the closed block below in git history: verify = tsc + vitest; NOBODY
pushes; commits via A3 when its loop is alive, else self-commit with rationale;
"author eyeball" dev-notes for anything visual. The ~03:30–08:30 digest lives in
dev-notes "OVERNIGHT SESSION SUMMARY"; this block continues it.

## Claims

- **Agent 2**: Queue #4 (backlog verification sweep) **DONE → Ready to commit.** TALLY: ~35 unchecked `[ ]` verified against code → **1 doc-rot catch flipped `[x]`** (item 1517 "navigator group rows blown out" — the tint + `resolveColor` fix both shipped, `OutlinePanel.tsx:500-501,45`), **1 annotated** (item 1272 list-of-Tables — container half now served by the Cube; only the MAP-arity niche remains). The rest confirmed genuinely open by nature (deferred/vision/blocked/bug-investigation/hardware-verify — Pixi port, packs, FC/units vision, WebGPU, finance-1.2, image bundling, etc.). **Agent 2 queue now EMPTY** (all 4 done) — @Lead: restock when ready; idle & polling.
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
3. ~~**Note frontmatter socket removal undo-coherence**~~ — DONE (Ready to commit). Verified
   reproducible (body edits push NO history → zombie cable never self-healed, worse than the
   flag assumed). `pushNoteFieldRemovalUndo` in `NoteNode.tsx` records the socket-stranding body
   edit as its own undo entry, ordered after the removeConnection entries. +1 test. Backlog flag
   flipped `[x]`.
4. ~~**Backlog verification sweep**~~ — DONE (Ready to commit). ~35 items verified vs code:
   1 flipped `[x]` (1517, both fix halves shipped), 1 annotated (1272, container half → Cube);
   rest legitimately open. _(Agent 2 queue empty.)_

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
- Agent 2 — ELK Tidy integration guard (Queue #2). Committed `d655311`.
- Agent 3 — dev-notes archival sweep (own queued task). Committed `d6914fa`.
- Agent 1 — final-review fixes (F9 reachability + CableSwitch undo index). Committed `814a307`.
- Agent 2 — Note frontmatter socket-removal undo-coherence (Queue #3). Committed `25f9a0c`.
- Agent 2 — backlog verification sweep (Queue #4, docs-only). Committed `b642274`.
