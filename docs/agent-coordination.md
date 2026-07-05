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

- **Agent 2**: Cube-cell XLOOKUP mode (Queue #2) **DONE → Ready to commit.** NEXT = Queue #3 (reconcile audit fixes) — but #3 edits `frameVerbs.ts` + `nodes/frame.ts`, the SAME files as the cube-lookup handoff. **@Agent 3: please commit the cube-lookup entry BEFORE I start #3** so the diffs don't mix; I'll hold #3 until it's committed (picking it up next cycle on a clean base).
- **Agent 1 (Lead)**: fixing confirmed audit findings (2 review agents + own pass) — files: `Canvas.tsx`, `persistence.ts`, `reportStore.ts`/`ReportOverlay.tsx`, `presentationStore.ts`, `nodes/quality.ts`, `modelFuzz.ts`, `problemsStore.ts`/`errorValue.ts`, `textForm.ts`. **Agent 2: two further confirmed findings live in YOUR files (`frameVerbs.ts` `reconcileFrames` + `nodes/frame.ts`) — queued below as your #3 so we don't cross-edit; take them after Cube XLOOKUP lands.**

## Queue

**Agent 2 (substantive):**
1. **Composite drill-in follow-ups** — (b) outer-cable drop notice DONE (Ready to commit). (a) toolbar reroute DEFERRED — @Lead decision (see Claims + dev-notes 2026-07-05 for the proposed architecture). Backlog item split accordingly.
2. ~~**Cube-cell XLOOKUP mode**~~ — DONE (Ready to commit). Frame Lookup source → `any`, takes a Cube, returns the matched top-level cell whole via `lookupCubeCell`; +12 tests.
3. **Reconcile audit fixes (after Cube XLOOKUP — your files)**, from tonight's review pass, both confidence ≥80, verified against code:
   (a) `reconcileFrames` (frameVerbs.ts ~390-621) silently DROPS any row whose key is null/SolError from output AND summary counts (`keyIndex` excludes them; `allKeys` built only from the index) — surface them (added/removed rows like `joinFrames` does, or a "N rows skipped — blank/invalid key" count in the summary; pick the one that keeps the Reconcile output honest).
   (b) The price/volume/mix breakdown treats an errored price/qty cell as 0 (`bn ?? 0` at ~648-652) — a bogus volume swing with no error surfaced. Propagate/exclude+flag instead of silently zeroing; keep PVM summing to the true delta or say it can't.
4. **Quick-wire socket-signature memoization** (backlog "Follow-ups surfaced"): `filterByCompatibleSocket` instantiates every catalog leaf per drop; memoize a per-type socket signature. Small.

**Agent 3 (mechanical + git — commit duty first):**
1. **Commit duty**: when "Ready to commit" below has entries, diff the named files, commit project-style (short imperative summary), delete the entry. NEVER push. Doc files (`dev-notes.md`/`backlog.md`/this board) are co-edited by everyone — sweep them into whichever commit goes last, or a trailing `docs:` commit.
2. **cargo-audit CI workflow** (backlog "1.0-tail" item 3, approved 2026-07-02): workflow running `cargo audit` on `src-tauri/Cargo.lock` on pushes to develop; `audit.toml` ignore list for triage noise.
3. **Per-doc autosave keys** (backlog ~line 635, author confirmed): one localStorage key per doc + a light index, each with its own two-slot rotation; NO migration (pre-alpha — old whole-library autosaves abandoned); disk saves untouched. Keep tests green.

## Ready to commit

_(empty — Agent 2, clean base is committed, go ahead with Queue #3.)_

## Recently done

- Agent 2 — align/distribute selection action bar. Committed `3172bc8`.
- Agent 2 — ELK auto-arrange lazy-loaded (bundle split). Committed `4635e54`.
- Agent 1 — Frame Filter case-insensitive text matching + "Match case" (D12). Committed `9ffc8e0` (docs swept in with it).
- Agent 2 — surface dropped outer cables when a drill-in port is deleted (Queue #1b). Committed `d06517d`.
- Agent 1 — Fill node full N-ary coalesce (extensible Else rows). Committed `540bba0`.
- Agent 1 — sketch bookkeeping leak fix (audit finding). Committed `75c62c9`.
- Agent 2 — Frame Lookup gains a Cube half (Queue #2, cube-cell XLOOKUP). Committed `5d4eac6`.
