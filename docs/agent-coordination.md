# Agent Coordination

Shared scratchpad for when several agents work this repo in parallel. Dormant in a solo session — claim nothing, ignore it.

**Protocol.** Agents message each other directly for live coordination; this board is only the durable claim list (one line per claim, delete on land) so a late-joining or restarted agent knows what's taken. Agent 1 is Lead. The durable role split, shared-file policy, and commit/push rules live in the agent's memory.

## This session (2026-08-24)

Agent 1 writes plans (`docs/plans/`), doesn't execute. Executors (Agent 2 solenoid-18, Agent 4 solenoid-f1, Jeff/Agent 5 solenoid-b2): claim a plan from `docs/plans/README.md` below, follow its protocol.

## Claims

- C5 (stats.ts pair) — Agent 4 (solenoid-f1): Decompose landed (a9035642); Forecast ETS in progress. B0 COMPLETE (a69a487f).
- B8 — Agent 2 (solenoid-18) — cube unnest + timesavers. C4 COMPLETE (d01f6d10, 4184d711, 56daabda; nodeCatalog copy in Agent 4's baae4eb4; grep-bordered-empty met). Also landed this session: A6, A4, A3, C3.1, C3.2.
- C5 (list/control five) — Jeff / Agent 5 (solenoid-b2): correlated outputs → one frame. DONE (4/5): Point Plotter (1480e40b), Curve (2efdc246), Find Peaks (af78aa1e), Outliers (fd4947d7). HOLDING for A2's B8.2 list.ts window: Group Lists (GroupByNode ~2160) + the Series-Range-inclusive author ask (listOps.ts/list.ts SERIES_OP_META/list.test.ts/excelFunctions RANGE). nodeCatalog C5 copy BATCHED for the end (after A2's "all B8 catalog landed"). Agent 4 keeps Decompose (node 88c8a724, test swept into fd4947d7) + Forecast ETS (stats.ts). (B7 COMPLETE 8bf129c7; A5 COMPLETE f3fa52c5.)

