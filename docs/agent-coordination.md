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

- **Agent 2**: Cube-cell XLOOKUP mode (Queue #2) — Frame Lookup's cube half (look INTO a cube's nested cells). Reading `cube-node-scope.md`; engine + node + tests. (Queue #1(b) done → Ready to commit; #1(a) deferred per Lead.)
- **Agent 1 (Lead)**: next — audit pass over the calc-mode/perf surfaces (see Queue note when posted).

## Queue

**Agent 2 (substantive):**
1. **Composite drill-in follow-ups** — (b) outer-cable drop notice DONE (Ready to commit). (a) toolbar reroute DEFERRED — @Lead decision (see Claims + dev-notes 2026-07-05 for the proposed architecture). Backlog item split accordingly.
2. **Cube-cell XLOOKUP mode** ← taking this next unless Lead redirects (cube-node-scope.md's named follow-up, v1.1 tail — fair game post-1.0): Frame Lookup's cube half — look INTO a cube's nested cells. Read `docs/cube-node-scope.md` first; engine + node + tests.
3. **Quick-wire socket-signature memoization** (backlog "Follow-ups surfaced"): `filterByCompatibleSocket` instantiates every catalog leaf per drop; memoize a per-type socket signature. Small.

**Agent 3 (mechanical + git — commit duty first):**
1. **Commit duty**: when "Ready to commit" below has entries, diff the named files, commit project-style (short imperative summary), delete the entry. NEVER push. Doc files (`dev-notes.md`/`backlog.md`/this board) are co-edited by everyone — sweep them into whichever commit goes last, or a trailing `docs:` commit.
2. **cargo-audit CI workflow** (backlog "1.0-tail" item 3, approved 2026-07-02): workflow running `cargo audit` on `src-tauri/Cargo.lock` on pushes to develop; `audit.toml` ignore list for triage noise.
3. **Per-doc autosave keys** (backlog ~line 635, author confirmed): one localStorage key per doc + a light index, each with its own two-slot rotation; NO migration (pre-alpha — old whole-library autosaves abandoned); disk saves untouched. Keep tests green.

## Ready to commit

_(empty)_

## Recently done

- Agent 2 — align/distribute selection action bar. Committed `3172bc8`.
- Agent 2 — ELK auto-arrange lazy-loaded (bundle split). Committed `4635e54`.
- Agent 1 — Frame Filter case-insensitive text matching + "Match case" (D12). Committed `9ffc8e0` (docs swept in with it).
- Agent 2 — surface dropped outer cables when a drill-in port is deleted (Queue #1b). Committed `d06517d`.
- Agent 1 — Fill node full N-ary coalesce (extensible Else rows). Committed `540bba0`.
