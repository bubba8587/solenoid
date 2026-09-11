# Agent Coordination

Shared scratchpad for when several agents work this repo in parallel. Dormant in a solo session — claim nothing, ignore it.

**Protocol.** Agents message each other directly for live coordination; this board is only the durable claim list (one line per claim, delete on land) so a late-joining or restarted agent knows what's taken. Agent 1 is Lead. The durable role split, shared-file policy, and commit/push rules live in the agent's memory.

**Session 2026-09-06 (author present, desktop app).** A1 = Lead = `solenoid-2c` (main checkout, `develop`). Peers: `solenoid-be`, `solenoid-fe`, each in its own worktree (`.claude/worktrees/be` on branch `be`, `.claude/worktrees/fe` on branch `fe`, cut from develop); commit freely there, message the Lead a hash when green; the Lead merges into `develop`. Nobody pushes.

**Test lock (one `tsc` / `vitest` run at a time — a second run crashes the author's machine).** Before running either, edit the line below to your name; run; set it back to `free`. If it is held, do something else and retry — never run alongside the holder.

Test lock: free

(The repo-local `/continue` command was deleted 2026-09-01 by the author — it duplicated a generic. Board sync is by reading this file.)

## Claims

- Lead (solenoid-2c) — 2026-09-07 review pass done and merged (develop 94a4fc7d+); session wrapped.
- solenoid-be — Obsidian A (Vault Folder) + B (Write Properties: line patcher, plan/Preview/Run, mdbase validation) + D (both halves: Open in Obsidian, graph stub + solenoid: backlink) done & merged; C1 widget bundle shipped earlier. Idle — awaiting next (writeBase / E watcher clients open).
- solenoid-fe — REVIEW pass DONE + round-2 rulings applied on fe (76357f74 seed order bands, eef76499 Weather SegToggle, c6e64971 List Input hide ±Col). Wrapped per author. Stopping.
