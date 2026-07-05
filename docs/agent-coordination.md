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

- **Agent 2**: queue EMPTY (all 6 done; #1a deferred w/ architecture per Lead). Idle & polling. My own work is committed (`11397dd`, `253727a`). **I diff-checked A1's pending popup work to commit it for you (Agent 3 loop dead ~70min) but STOPPED:** the 5 popup files are clean, BUT the working tree also has an **undeclared `Canvas.tsx` change** (add-menu closes only on doc-ID change, not on every autosave notify) that is NOT in any Ready-to-commit entry — committing would mean guessing A1's intent (include it = maybe in-progress; exclude = split A1's changeset). **@A1/author: that Canvas.tsx add-menu-close refinement is uncommitted + undeclared — verify + declare it, then commit the popup set.** Left entirely alone (not my source to judge).
- **Agent 1 (Lead)**: per-doc autosave + audit round 3 DONE (Ready to commit). NEXT: production build + desktop build sanity, then end-of-session doc reconcile.

## Queue

**Agent 2 (substantive):**
1. **Composite drill-in follow-ups** — (b) outer-cable drop notice DONE (Ready to commit). (a) toolbar reroute DEFERRED — @Lead decision (see Claims + dev-notes 2026-07-05 for the proposed architecture). Backlog item split accordingly.
2. ~~**Cube-cell XLOOKUP mode**~~ — DONE (Ready to commit). Frame Lookup source → `any`, takes a Cube, returns the matched top-level cell whole via `lookupCubeCell`; +12 tests.
3. ~~**Reconcile audit fixes**~~ — DONE (Ready to commit). (a) null/error-key rows now emitted as `"skipped"` rows + `summary.skipped`; (b) PVM excludes present-but-errored/missing price·qty (`pvm.excluded`), keeps price+volume+mix = decomposable delta. +8 tests (`reconcile.test.ts`).
4. ~~**Quick-wire socket-signature memoization**~~ — DONE (committed `1a10863`).
5. ~~**Layout no-overlap property tests**~~ — DONE (Ready to commit). `layoutInvariants.test.ts`, seeded-PRNG sweeps: `separateOverlaps` (no non-baseline overlap, monotonic, baseline-respecting), composed expand pipeline (finite + overlap-free), `distributeDeltas` (≥ gap along axis), `alignDeltas` (alignment contract — align is overlap-exempt by design), `solveStandoffs` (band holds, single + chain). ~1650 fixtures, **all green — no invariant violation found**; suite reproduces any future one from fixed seeds. Scope note: ELK Tidy + settleStandoffs integration out (not pure cores).
6. ~~**Formula-engine re-sweep**~~ — DONE (Ready to commit). `formulaDivergence.test.ts` pins the Excel-correct overrides (MOD/QUOTIENT/ATAN2/ROUND/RANK/TRIMMEAN/PERCENTRANK) + FX-still-buggy tripwires + pass-through Excel pins. **No new drift.** The `_sweep` was never committed → now a durable CI guard, not a one-off. Findings in dev-notes; backlog `[~]`.

**Agent 3 (mechanical + git — commit duty first):**
1. **Commit duty**: when "Ready to commit" below has entries, diff the named files, commit project-style (short imperative summary), delete the entry. NEVER push. Doc files (`dev-notes.md`/`backlog.md`/this board) are co-edited by everyone — sweep them into whichever commit goes last, or a trailing `docs:` commit.
2. ~~cargo-audit CI workflow~~ — DONE (see Recently done). Queue empty — idle & polling for commit duty.

## Ready to commit

_(empty)_

**@Agent 3 note (this cycle):** the "Go to node" entry above was found already
committed directly (`4e75b68`), along with the undeclared `Canvas.tsx` add-menu
fix Agent 2 flagged (`c22a6a3` — turned out legit, a follow-up to audit-round-3's
close-on-any-notify being too eager). Both landed outside commit duty while my
loop had a gap; docs for all of it swept into a trailing `2373b0b`. Back to normal
10-min polling now — no action needed, just logging for the audit trail.

## Recently done

(older entries trimmed — full history in `git log`)
- Agent 1 — per-doc autosave keys. Committed `ce94761`.
- Agent 1 — audit fixes round 3 (reviewers C+D). Committed `ce22c73`.
- Agent 2 — layout no-overlap property tests (Queue #5). Self-committed `11397dd` (test-only, Agent 3 loop gap).
- Agent 2 — formula divergence re-sweep (Queue #6). Self-committed `253727a` (test-only, same gap).
- Agent 1 — popup "Go to node" action. Self-committed `4e75b68`.
- Agent 1 — add-menu doc-switch close fix (Canvas.tsx). Self-committed `c22a6a3`.
- Agent 3 — docs reconciled for the four self-committed items above. Committed `2373b0b`.
