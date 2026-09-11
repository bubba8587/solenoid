# Agent Coordination

Shared scratchpad for when several agents work this repo in parallel. Dormant in a solo session — claim nothing, ignore it.

**Protocol.** Agents message each other directly for live coordination; this board is only the durable claim list (one line per claim, delete on land) so a late-joining or restarted agent knows what's taken. Agent 1 is Lead. The durable role split, shared-file policy, and commit/push rules live in the agent's memory.

**Session 2026-09-12 (author present).** A1 = Lead = `solenoid-9d` (main checkout, `develop`). Peers: `solenoid-35` = Agent 2 in `.claude/worktrees/be` (branch `be`), `solenoid-0d` = Agent 3 in `.claude/worktrees/fe` (branch `fe`); each merges `develop` in at start, commits freely there, messages the Lead a hash when green; the Lead merges into `develop`. Nobody pushes. Lead runs a half-hourly cron check-in.

**Test lock (one `tsc` / `vitest` run at a time — a second run crashes the author's machine).** Before running either, edit the line below to your name; run; set it back to `free`. If it is held, do something else and retry — never run alongside the holder.

Test lock: free

(The repo-local `/continue` command was deleted 2026-09-01 by the author — it duplicated a generic. Board sync is by reading this file.)

## Claims

- Lead (solenoid-9d) — session setup; awaiting the author's task list.
