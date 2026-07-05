# Agent Coordination

Shared scratchpad for when several agents work this repo in parallel. Dormant in a solo session — claim nothing, ignore it.

**Protocol.** Check here before starting a task and claim it in one line so two agents don't pick the same thing. Update on claim and on hand-off, not on every edit. Delete an entry once it lands; prior history is in `git log`. Agent 1 is Lead. The durable role split, shared-file policy, and commit/push rules live in the agent's memory; a session may post a short "This session" block here that overrides them where they conflict.

## This session (overnight EXTENDED — author said "keep going", 2026-07-05 ~08:40)

Same rules as the closed block below in git history: verify = tsc + vitest; NOBODY
pushes; commits via A3 when its loop is alive, else self-commit with rationale;
"author eyeball" dev-notes for anything visual. The ~03:30–08:30 digest lives in
dev-notes "OVERNIGHT SESSION SUMMARY"; this block continues it.

## Claims

- **Agent 2**: Queue #2 — ELK Tidy integration guard. Investigating feasibility first: the real arrange pipeline is DOM-coupled (area views/`offsetWidth`/`area.translate`), vitest env is node. Will drive elkjs directly on a realistic fixture (app's ELK options + port preset) then apply the standoff-settle + separateOverlaps post-pass, asserting no-overlap — the integration the pure property tests scoped out. NEW test file only. (#1 done → Ready to commit.)
- **Agent 3**: architecture reconcile landed (`70e3c0d`+`3c541dd`, incl. Lead's gap
  list) — thanks. Back on commit duty; one entry below.
- **Agent 1 (Lead)**: undo audit found + fixed the extensible-row hole (Ready to
  commit below). NEXT: pick the next audit/build target.

## Queue

**Agent 2 (substantive):**
1. ~~**Cube-aware Nest Join**~~ — DONE (Ready to commit). Child socket `frame`→`any`; a CUBE
   child nests a pre-built hierarchy whole (`relateFramesToCube` + `subCube`). +11 tests.
   (Note: incremental Customer→Order→LineItem chaining was ALREADY done via the parent-cube
   path; this is the complementary compositional variant. Verb lives in `frame.ts`, not
   `frameVerbs.ts` as the queue guessed.)
2. **ELK Tidy integration guard** ← taking next: your layout property tests scoped out the ELK+
   settleStandoffs integration path. elkjs runs under node — build a small integration
   test (real editor + arrange on a fixture with a standoff cluster + a group) asserting
   the no-overlap invariant post-Tidy. If elkjs-in-vitest proves too heavy/flaky, gate it
   like perfScaling (`describe.runIf(!!process.env.SLOW)`) and document the run command.

**Agent 3 (mechanical + git — commit duty first, if your loop is back):**
1. Commit duty per the standing rule (diff named files, project-style message, never push).
2. ~~architecture.md file-map reconcile~~ — DONE (`70e3c0d` + `3c541dd`, the latter folding in
   Agent 1's diffed-vs-tree gap list).
3. **dev-notes archival sweep** (the standing lean-log policy, see the file's own tail
   note + docs/archive/README.md): move entries dated 2026-06-30 and EARLIER from
   `docs/dev-notes.md` into `docs/archive/dev-notes-history.md` (append, keep order),
   leaving the live window = 2026-07-01 onward. Pure move, no rewording; update the
   archive README's date range line.

## Ready to commit

_(empty)_

## Recently done

(older entries trimmed — full history in `git log`)
- Agent 1 — perf bench + invariants docs + reader fuzz. Committed `6770bc5`, `2d162e0`.
- Agent 3 — architecture.md file-map reconcile (own queued task, 2 passes). Committed `70e3c0d`, `3c541dd`.
- Agent 2 — Nest Join accepts a CUBE child (Queue #1). Committed `313f03a`.
- Agent 1 — extensible-row add/remove undo (audit find). Committed `b0066df`.
- Agent 1 — guarded clipboard writes (reviewer-D flagged). Committed `cda8297`.
