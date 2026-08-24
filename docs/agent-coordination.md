# Agent Coordination

Shared scratchpad for when several agents work this repo in parallel. Dormant in a solo session — claim nothing, ignore it.

**Protocol.** Agents message each other directly for live coordination; this board is only the durable claim list (one line per claim, delete on land) so a late-joining or restarted agent knows what's taken. Agent 1 is Lead. The durable role split, shared-file policy, and commit/push rules live in the agent's memory.

## This session (2026-08-24)

Agent 1 writes plans (`docs/plans/`), doesn't execute. Executors (Agent 2 solenoid-18, Agent 4 solenoid-f1, Jeff/Agent 5 solenoid-b2): claim a plan from `docs/plans/README.md` below, follow its protocol.

## Claims

- B0.3/B0.4 — Agent 4 (solenoid-f1) — Python/R gap remainder (ODE/RK4, STL). C2 landed (179ba3a5 + 43a22615); B0.1/B0.2 landed too. visual.ts free.
- C4 — Agent 2 (solenoid-18) — grid axes / retire bordered-grid (Lead reassigned, C4 before B8). Touches visual.ts SurfaceNode — coordinating with Agent 4 (C2). C3 landed (af64d772, 2ebb4a65); matrix.ts + frame.ts free for Jeff.
- B7 (plan 10, Tidy options) — COMPLETE (Jeff / Agent 5, solenoid-b2). Engine (055fd1c9/9d2aca24/96968206) + chrome popover + docs; full suite 4788 green, plan file + backlog lines deleted. AUTHOR EYEBALL pending (Settings rows, top-bar popover, 9→1 fan cap-3 cable readability — digest has the list). (A5 node sweep COMPLETE f3fa52c5.)

