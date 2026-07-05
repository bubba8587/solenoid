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

- **Agent 2**: Queue #4 — quick-wire socket-signature memoization (`filterByCompatibleSocket` instantiates every catalog leaf per drop). Separate file from my uncommitted reconcile handoff, no overlap. (#3 reconcile still in Ready to commit.)
- **Agent 1 (Lead)**: audit round 2 fixes DONE (Ready to commit). NOW: **Per-doc autosave keys** (taking A3's Queue #3 — A3, cargo-audit is still yours; drop autosave from your queue). Files: `documentStore.ts`/`documentStoreCore.ts` + tests. Two more review agents (interaction-feel + timers/sinks) still running; their findings come to me.

## Queue

**Agent 2 (substantive):**
1. **Composite drill-in follow-ups** — (b) outer-cable drop notice DONE (Ready to commit). (a) toolbar reroute DEFERRED — @Lead decision (see Claims + dev-notes 2026-07-05 for the proposed architecture). Backlog item split accordingly.
2. ~~**Cube-cell XLOOKUP mode**~~ — DONE (Ready to commit). Frame Lookup source → `any`, takes a Cube, returns the matched top-level cell whole via `lookupCubeCell`; +12 tests.
3. ~~**Reconcile audit fixes**~~ — DONE (Ready to commit). (a) null/error-key rows now emitted as `"skipped"` rows + `summary.skipped`; (b) PVM excludes present-but-errored/missing price·qty (`pvm.excluded`), keeps price+volume+mix = decomposable delta. +8 tests (`reconcile.test.ts`).
4. **Quick-wire socket-signature memoization** (backlog "Follow-ups surfaced"): `filterByCompatibleSocket` instantiates every catalog leaf per drop; memoize a per-type socket signature. Small.

**Agent 3 (mechanical + git — commit duty first):**
1. **Commit duty**: when "Ready to commit" below has entries, diff the named files, commit project-style (short imperative summary), delete the entry. NEVER push. Doc files (`dev-notes.md`/`backlog.md`/this board) are co-edited by everyone — sweep them into whichever commit goes last, or a trailing `docs:` commit.
2. **cargo-audit CI workflow** (backlog "1.0-tail" item 3, approved 2026-07-02): workflow running `cargo audit` on `src-tauri/Cargo.lock` on pushes to develop; `audit.toml` ignore list for triage noise.
3. ~~Per-doc autosave keys~~ — reassigned to Agent 1 (Lead call, keeping A3 on commits + cargo-audit).

## Ready to commit

_(empty)_

## Recently done

(older entries trimmed — full history in `git log`)
- Agent 1 — Fill node full N-ary coalesce (extensible Else rows). Committed `540bba0`.
- Agent 1 — sketch bookkeeping leak fix (audit finding). Committed `75c62c9`.
- Agent 2 — Frame Lookup gains a Cube half (Queue #2, cube-cell XLOOKUP). Committed `5d4eac6`.
- Agent 2 — Reconcile audit fixes (Queue #3). Committed `94bcbd9`.
- Agent 1 — audit fixes round 2. Committed `3141e10`.
