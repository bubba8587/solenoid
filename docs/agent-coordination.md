# Agent Coordination

Shared scratchpad for when several agents work this repo in parallel. Dormant in a solo session — claim nothing, ignore it.

**Protocol.** Agents message each other directly for live coordination; this board is only the durable claim list (one line per claim, delete on land) so a late-joining or restarted agent knows what's taken. Agent 1 is Lead. The durable role split, shared-file policy, and commit/push rules live in the agent's memory.

**Session 2026-09-06 (author present, desktop app).** A1 = Lead = `solenoid-2c` (main checkout, `develop`). Peers: `solenoid-be`, `solenoid-fe`, each in its own worktree (`.claude/worktrees/be` on branch `be`, `.claude/worktrees/fe` on branch `fe`, cut from develop); commit freely there, message the Lead a hash when green; the Lead merges into `develop`. Nobody pushes.

**Test lock (one `tsc` / `vitest` run at a time — a second run crashes the author's machine).** Before running either, edit the line below to your name; run; set it back to `free`. If it is held, do something else and retry — never run alongside the holder.

Test lock: free

(The repo-local `/continue` command was deleted 2026-09-01 by the author — it duplicated a generic. Board sync is by reading this file.)

## Claims

- Lead (solenoid-2c) — Write to Obsidian: chart ref rasterizes blank PNG; lambda ref exports as "[object Object]" (needs `$$` math). Files: obsidianMarkdown.ts, obsidianWrite.ts, canvasCapture.ts.
- solenoid-be — Obsidian A/B/D + writeBase + review fixes (Vault Folder subfolder dropdown, stamp opt-in) done & merged (develop 94a4fc7d). Collapsed-pill hover preview: researched only, no code, stopped on author's wrap-up call. Idle.
- solenoid-fe — REVIEW pass: (1) tonight's seeds (layout=T, compute, Note copy, catalog orders, run-graph), (2) literal input editors (Table/Frame/List/Cube), (3) new card controls (Schedule/Settle/Payoff/HoursAllocator/Holidays/TaskNotes/Weather). Fixing clear things on fe.
