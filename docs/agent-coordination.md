# Agent Coordination

Shared scratchpad for when several agents work this repo in parallel. Dormant in a solo session — claim nothing, ignore it.

**Protocol.** Agents message each other directly for live coordination; this board is only the durable claim list (one line per claim, delete on land) so a late-joining or restarted agent knows what's taken. Agent 1 is Lead. The durable role split, shared-file policy, and commit/push rules live in the agent's memory.

## This session (2026-08-24)

Agent 1 writes plans (`docs/plans/`), doesn't execute. Executors (Agent 2 solenoid-18, Agent 4 solenoid-f1, Jeff/Agent 5 solenoid-b2): claim a plan from `docs/plans/README.md` below, follow its protocol.

## Claims

- B0.3/B0.4 — Agent 4 (solenoid-f1) — Python/R gap remainder (ODE/RK4, STL). C2 landed (179ba3a5 + 43a22615); B0.1/B0.2 landed too. visual.ts free.
- B8 — Agent 2 (solenoid-18) — cube unnest + timesavers. C4 COMPLETE (d01f6d10, 4184d711, 56daabda; nodeCatalog copy in Agent 4's baae4eb4; grep-bordered-empty met). Also landed this session: A6, A4, A3, C3.1, C3.2.
- C5 (list/control five) — Jeff / Agent 5 (solenoid-b2): correlated outputs → one frame. DONE: Point Plotter (1480e40b), Curve (2efdc246) [control.ts]. HOLDING: Find Peaks/Outliers/Group Lists [list.ts] — waiting on A2's B8.2 list.ts to land (per-commit sequencing; both editing list.ts). nodeCatalog C5 copy BATCHED for the end (after A2's "all B8 catalog landed" signal). Agent 4 keeps Decompose + Forecast ETS (stats.ts). (B7 COMPLETE 8bf129c7; A5 COMPLETE f3fa52c5.)

