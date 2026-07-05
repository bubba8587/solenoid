# Agent Coordination

Shared scratchpad for when several agents work this repo in parallel. Dormant in a solo session — claim nothing, ignore it.

**Protocol.** Check here before starting a task and claim it in one line so two agents don't pick the same thing. Update on claim and on hand-off, not on every edit. Delete an entry once it lands; prior history is in `git log`. Agent 1 is Lead. The durable role split, shared-file policy, and commit/push rules live in the agent's memory; a session may post a short "This session" block here that overrides them where they conflict.

## This session (overnight autonomous, 2026-07-05)

Author asleep ~8h. Agent 1 (Lead) works continuously; Agents 2 (Opus) + 3 (Sonnet) poll every 10 min.
- **Verify = tsc + vitest.** Local web dev server session — **NOBODY pushes.** Commits go through Agent 3 (standing policy).
- Tauri/cargo builds allowed when a task needs the desktop half.
- No UI eyeballing tonight — leave a one-line "author eyeball" note in dev-notes for anything visual.
- When free: claim the top Queue item for your role, move it to Claims, go.

## Claims

- **Agent 2**: Queue #5 — layout no-overlap property tests over the pure cores (`groupPushCore`, `standoffSolver`, `distributeDeltas`). Seeded-PRNG randomized fixtures; report violations, don't fix. NEW test file only (`selectionOps.ts` etc. untouched), no overlap with A1's audit files.
- **Agent 1 (Lead)**: per-doc autosave + audit round 3 DONE (Ready to commit). NEXT: production build + desktop build sanity, then end-of-session doc reconcile.

## Queue

**Agent 2 (substantive):**
1. **Composite drill-in follow-ups** — (b) outer-cable drop notice DONE (Ready to commit). (a) toolbar reroute DEFERRED — @Lead decision (see Claims + dev-notes 2026-07-05 for the proposed architecture). Backlog item split accordingly.
2. ~~**Cube-cell XLOOKUP mode**~~ — DONE (Ready to commit). Frame Lookup source → `any`, takes a Cube, returns the matched top-level cell whole via `lookupCubeCell`; +12 tests.
3. ~~**Reconcile audit fixes**~~ — DONE (Ready to commit). (a) null/error-key rows now emitted as `"skipped"` rows + `summary.skipped`; (b) PVM excludes present-but-errored/missing price·qty (`pvm.excluded`), keeps price+volume+mix = decomposable delta. +8 tests (`reconcile.test.ts`).
4. ~~**Quick-wire socket-signature memoization**~~ — DONE (committed `1a10863`).
5. **Layout no-overlap property tests** (the author's standing rule: nodes/groups must NEVER overlap after a layout op — a hard invariant with no machine check today; the standoff "heavy-overlap edge-case sweep" was deferred 2026-06-19). Build a randomized-fixture vitest suite over the PURE layout cores (`groupPushCore.ts`, `standoffSolver.ts`, the align/distribute `selectionOps.ts` deltas): generate node boxes (varied sizes, overlapping starts, standoff clusters), run each op, assert no two result boxes overlap + standoff bands hold. Seeded PRNG (mulberry32 pattern in modelFuzz.ts) so failures reproduce. Report — don't fix — any genuine violation you find (post it on the board for triage).
6. **Formula-engine re-sweep** (author flagged 2026-06-25 as periodic): re-run the node-vs-Formula.js divergence sweep (the `_sweep` harness is in git history around 2026-06-25) against today's code — text matching, numberToText, guardFinite all changed since. Record findings in dev-notes; fix only byte-obvious drift, flag judgment calls.

**Agent 3 (mechanical + git — commit duty first):**
1. **Commit duty**: when "Ready to commit" below has entries, diff the named files, commit project-style (short imperative summary), delete the entry. NEVER push. Doc files (`dev-notes.md`/`backlog.md`/this board) are co-edited by everyone — sweep them into whichever commit goes last, or a trailing `docs:` commit.
2. ~~cargo-audit CI workflow~~ — DONE (see Recently done). Queue empty — idle & polling for commit duty.

## Ready to commit

_(empty)_

## Recently done

(older entries trimmed — full history in `git log`)
- Agent 1 — audit fixes round 2. Committed `3141e10`.
- Agent 3 — cargo-audit CI workflow (own queued task). Committed `7c069a7`.
- Agent 2 — quick-wire socket-signature memoization (Queue #4). Committed `1a10863`.
- Agent 1 — per-doc autosave keys. Committed `ce94761`.
- Agent 1 — audit fixes round 3 (reviewers C+D). Committed `ce22c73`.
