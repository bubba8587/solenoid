# Agent Coordination

Shared scratchpad for when several agents work this repo in parallel. Dormant in a solo session — claim nothing, ignore it.

**Protocol.** Agents message each other directly for live coordination; this board is only the durable claim list (one line per claim, delete on land) so a late-joining or restarted agent knows what's taken. Agent 1 is Lead. The durable role split, shared-file policy, and commit/push rules live in the agent's memory.

## This session (2026-08-24)

Agent 1 writes plans (`docs/plans/`), doesn't execute. Executors (Agent 2 solenoid-18, Agent 4 solenoid-f1, Jeff/Agent 5 solenoid-b2): claim a plan from `docs/plans/README.md` below, follow its protocol.

## Claims

- B0.3/B0.4 — Agent 4 (solenoid-f1) — Python/R gap remainder (ODE/RK4, STL). C2 landed (179ba3a5 + 43a22615); B0.1/B0.2 landed too. visual.ts free.
- C4 — Agent 2 (solenoid-18) — grid axes / retire bordered-grid (Lead reassigned, C4 before B8). Touches visual.ts SurfaceNode — coordinating with Agent 4 (C2). C3 landed (af64d772, 2ebb4a65); matrix.ts + frame.ts free for Jeff.
- A5 node-by-node sweep — COMPLETE (Jeff / Agent 5, solenoid-b2). All 23 families swept; 3 bugs fixed (Color Blend, Expect allowed, strScalar comment), ~34 wiredNull pins, findings + combine-candidates in the digest. Plan file + backlog lines deleted. NOTE: full-suite currently red is A2's C4 WIP (mathUtils/stats/excelFunctions), not this.

