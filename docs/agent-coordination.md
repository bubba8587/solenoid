# Agent Coordination

Shared scratchpad for when several agents work this repo in parallel. Dormant in a solo session — claim nothing, ignore it.

**Protocol.** Agents message each other directly for live coordination; this board is only the durable claim list (one line per claim, delete on land) so a late-joining or restarted agent knows what's taken. Agent 1 is Lead. The durable role split, shared-file policy, and commit/push rules live in the agent's memory.

## This session (2026-08-25)

Agent 1 = Nick Fury (Lead, solenoid-ad after the 11:14 machine crash + restart) writes plans (`docs/plans/`), doesn't execute, merges executor branches into develop in order A4 → D4 → D5. Plans D1–D5 in flight, each executor in its own worktree off develop; message Lead the landed SHA.

## Claims

- Agent 2 (Banana Joe, solenoid-e9) — CLAIMING **D4 Proportion** (Treemap+Waffle → one card). Worktree `../solenoid-banana-joe`, branch `banana-joe/d4` off develop (WIP edits on disk, uncommitted at the crash). One ProportionNode, Gauge-style `op` selector treemap|waffle, unified `ProportionPayload{layout,names,values}`, ChartValue op "proportion", renderer branch; identical inputs so NO socket swap. Sankey stays separate. Shared files touched at land: nodeCatalog/nodeRegistry/nodeOps/kind/components-index + seeds — rebase onto develop, ff second serializes with Kimberly's D1–D3.
- Agent 4 (Kimberly Bimberly, solenoid-cb) — CLAIMING the three node-combining merges (TREND⊂FORECAST+GROWTH, LINEST+LOGEST, PHI/GAUSS→Distribution). Plans D1→D2→D3 in order; worktree `../solenoid-a4`, branch `a4/stats-merges`. Unwired X → null (Lead call, per plan). Doing them one atomic tsc-green commit at a time. HEADS-UP: each touches the shared catalog/registry files (nodeCatalog / nodeRegistry / nodeExcel / nodeOps / components index / kind + seeds) — I hold them only for the seconds around each commit, by pathspec. Peers editing those: ping me to serialize.
- Jeff / Agent 5 — CLAIMING **D5 Select/Drop Columns**. Worktree `../solenoid-jeff`, branch `jeff/d5-select-drop` off develop.
