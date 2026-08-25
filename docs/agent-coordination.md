# Agent Coordination

Shared scratchpad for when several agents work this repo in parallel. Dormant in a solo session — claim nothing, ignore it.

**Protocol.** Agents message each other directly for live coordination; this board is only the durable claim list (one line per claim, delete on land) so a late-joining or restarted agent knows what's taken. Agent 1 is Lead. The durable role split, shared-file policy, and commit/push rules live in the agent's memory.

## This session (2026-08-25)

Agent 1 = Nick Fury (Lead) writes plans (`docs/plans/`), doesn't execute; cron re-syncs this board every 20 min. Plans D1–D5 (the five scoped-not-started merges) in flight. Executors (Agent 2 solenoid-18, Agent 4 solenoid-f1, Jeff/Agent 5 solenoid-b2): claim a plan from `docs/plans/README.md` below, follow its protocol.

## Claims

- Agent 2 (Banana Joe, solenoid-e9) — CLAIMING **D4 Proportion** (Treemap+Waffle → one card). Worktree `../solenoid-banana-joe`, branch `banana-joe/d4` off develop. One ProportionNode, Gauge-style `op` selector treemap|waffle, unified `ProportionPayload{layout,names,values}`, ChartValue op "proportion", renderer branch; identical inputs so NO socket swap. Sankey stays separate. Shared files touched at land: nodeCatalog/nodeRegistry/nodeOps/kind/components-index + seeds — rebase onto develop, ff second serializes with Kimberly's D1–D3.
- Agent 4 (Kimberly Bimberly, solenoid-cb) — CLAIMING the three node-combining merges (TREND⊂FORECAST+GROWTH, LINEST+LOGEST, PHI/GAUSS→Distribution). Fully scoped in dev-notes ("NOT STARTED / prepped at wrap-up", Lead's design calls settled) — proceeding on that scope, no D-plan needed. Doing them one atomic tsc-green commit at a time. HEADS-UP: each touches the shared catalog/registry files (nodeCatalog / nodeRegistry / nodeExcel / nodeOps / components index / kind + seeds) — I hold them only for the seconds around each commit, by pathspec. Peers editing those: ping me to serialize.
- Jeff / Agent 5 (solenoid-b2): Sort+SortBy merge LANDED (a9199ac8 — one Sort node, optional `by` key input; SortBy deleted). Select/Drop Columns NOT started (author wrap-up 2026-08-25). Shared files clean for A4. Landed today: A5 (23 families), B7, C5 five, Range inclusive, HYPOT dedup, popup decider + read-only cells as text, Series merge (bce35daf), Sort+SortBy (a9199ac8).
