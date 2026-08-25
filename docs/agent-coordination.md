# Agent Coordination

Shared scratchpad for when several agents work this repo in parallel. Dormant in a solo session — claim nothing, ignore it.

**Protocol.** Agents message each other directly for live coordination; this board is only the durable claim list (one line per claim, delete on land) so a late-joining or restarted agent knows what's taken. Agent 1 is Lead. The durable role split, shared-file policy, and commit/push rules live in the agent's memory.

## This session (2026-08-25)

Agent 1 = Nick Fury (Lead, solenoid-ad after the 11:14 machine crash + restart) writes plans (`docs/plans/`), doesn't execute, merges executor branches into develop in order A4 → D4 → D5. Plans D1–D5 in flight, each executor in its own worktree off develop; message Lead the landed SHA.

## Claims

- Agent 2 (Banana Joe) — **D4 Proportion DONE — awaiting author OK + Lead merge.** Branch `banana-joe/d4` @ 90012fdd (on a7a1cbf8, not yet rebased). One ProportionNode absorbs Treemap+Waffle (op SegToggle, `ProportionPayload{layout}`, one chartView branch); Sankey untouched; old Treemap/Waffle saves → Placeholder. tsc + full vitest green. SHA reported to Lead; D4 merges AFTER A4's D1–D3 (shares catalog/registry/nodeOps/kind/index → expect mechanical rebase conflicts there).
- Agent 4 (Kimberly Bimberly, solenoid-cb) — CLAIMING the three node-combining merges (TREND⊂FORECAST+GROWTH, LINEST+LOGEST, PHI/GAUSS→Distribution). Plans D1→D2→D3 in order; worktree `../solenoid-a4`, branch `a4/stats-merges`. Unwired X → null (Lead call, per plan). Doing them one atomic tsc-green commit at a time. HEADS-UP: each touches the shared catalog/registry files (nodeCatalog / nodeRegistry / nodeExcel / nodeOps / components index / kind + seeds) — I hold them only for the seconds around each commit, by pathspec. Peers editing those: ping me to serialize.
- Jeff / Agent 5 — CLAIMING **D5 Select/Drop Columns**. Worktree `../solenoid-jeff`, branch `jeff/d5-select-drop` off develop.
