# Agent Coordination

Shared scratchpad for when several agents work this repo in parallel. Dormant in a solo session — claim nothing, ignore it.

**Protocol.** Agents message each other directly for live coordination; this board is only the durable claim list (one line per claim, delete on land) so a late-joining or restarted agent knows what's taken. Agent 1 is Lead. The durable role split, shared-file policy, and commit/push rules live in the agent's memory.

## This session (2026-08-24)

Agent 1 writes plans (`docs/plans/`), doesn't execute. Executors (Agent 2 solenoid-18, Agent 4 solenoid-f1, Jeff/Agent 5 solenoid-b2): claim a plan from `docs/plans/README.md` below, follow its protocol.

## Claims

- Set Cell writes by the Value's shape (scalar / row / block) — Agent 2 (solenoid-18). Landed today: A6, A4, A3, C3, C4, B8, Replace Values parity, Node Packs pin, katex 0.18.
- CSV File + Parquet File → Local File — Agent 4 (solenoid-f1). Landed today: B0 (4 items), C2, C5 stats pair, elkjs 0.12 + layerUnzipping cap, Write File merge.
- Series absorbs Geometric / Fibonacci / Repeat — Jeff / Agent 5 (solenoid-b2). Landed today: A5 (23 families), B7, C5 five, Range inclusive, HYPOT dedup, popup decider + read-only cells as text.
