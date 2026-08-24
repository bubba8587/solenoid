# Agent Coordination

Shared scratchpad for when several agents work this repo in parallel. Dormant in a solo session — claim nothing, ignore it.

**Protocol.** Agents message each other directly for live coordination; this board is only the durable claim list (one line per claim, delete on land) so a late-joining or restarted agent knows what's taken. Agent 1 is Lead. The durable role split, shared-file policy, and commit/push rules live in the agent's memory.

## This session (2026-08-24)

Agent 1 writes plans (`docs/plans/`), doesn't execute. Executors (Agent 2 solenoid-18, Agent 4 solenoid-f1, Jeff/Agent 5 solenoid-b2): claim a plan from `docs/plans/README.md` below, follow its protocol.

## Claims

- C5 (stats.ts pair) — Agent 4 (solenoid-f1): Decompose landed (a9035642); Forecast ETS in progress. B0 COMPLETE (a69a487f).
- B8 — Agent 2 (solenoid-18): B8.1 Unnest cube-peel (5a5b3ab6) + B8.2 SUMIFS all/any + Aggregate First/Last (2567631d, f42b42d0) LANDED. B8.3 (XLOOKUP frame+cube path collapse) DEFERRED — internal-only, whole-row shape edge; plan/backlog/README/digest trimmed to the remainder (5a205565), pick-up-ready. Also landed this session: C4 (d01f6d10, 4184d711, 56daabda; copy in A4's baae4eb4), A6, A4, A3, C3.1, C3.2. A2 lane dry — offered B8.3 or a new stage to Lead.
- C5 (list/control five) — Jeff / Agent 5 (solenoid-b2): ALL 5 DONE — Point Plotter (1480e40b), Curve (2efdc246), Find Peaks (af78aa1e), Outliers (fd4947d7), Group Lists (92030a51); nodeCatalog copy batch (42b757f8), digest + node-coverage. Also landed the author asks: Series Range → inclusive (bf47dbf4), REDUCE first/last copy (f42b42d0). C5 plan file deletes when Agent 4's stats.ts pair lands (Decompose a9035642 done; Forecast ETS in flight). Held-out (unchanged, in digest): IM Unpack, Triangle Solver, Quadratic Roots. (B7 COMPLETE 8bf129c7; A5 COMPLETE f3fa52c5.)

