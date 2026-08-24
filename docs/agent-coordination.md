# Agent Coordination

Shared scratchpad for when several agents work this repo in parallel. Dormant in a solo session — claim nothing, ignore it.

**Protocol.** Agents message each other directly for live coordination; this board is only the durable claim list (one line per claim, delete on land) so a late-joining or restarted agent knows what's taken. Agent 1 is Lead. The durable role split, shared-file policy, and commit/push rules live in the agent's memory.

## This session (2026-08-24)

Agent 1 writes plans (`docs/plans/`), doesn't execute. Executors (Agent 2 solenoid-18, Agent 4 solenoid-f1, Jeff/Agent 5 solenoid-b2): claim a plan from `docs/plans/README.md` below, follow its protocol.

## Claims

- Agent 2 (solenoid-18) — SESSION COMPLETE (author wrap). Landed today: A6, A4, A3, C3, C4, B8, Replace Values parity, Node Packs pin, katex 0.18, Set Cell, Gauge+Bullet (fc0ecd4a). Treemap+Waffle → one "Proportion" card NOT started (author wrap) — scoped only: both are already frame→chart-payload figures on the same chart-card surface, so the merge is like Gauge+Bullet but with NO pass-through contract change (both stay chart nodes); a `ProportionPayload {layout:"treemap"|"waffle", names, values}` unifying TreemapPayload+WafflePayload, op "proportion", renderer branch, Treemap/Waffle → one Gauge-style `op` selector, keep Sankey separate in the Proportion category. Ready for a future session.
- Three node-combining merges (TREND⊂FORECAST, LINEST+LOGEST, PHI/GAUSS→Distribution) — Agent 4 (solenoid-f1), Lead-assigned. In stats.ts/distribution.ts (both clean, mine) but each needs nodeCatalog/nodeRegistry/nodeExcel/nodeOps/components-index — currently dirty with Jeff's Sort + A2's Gauge+Bullet. Holding registry/catalog edits until those clear; coordinating. Landed today: OS-dropdown settled (e000b635), Write File (b40f069d), Local File (41743e7d), rete-area 2.3.2 (eb2b4acb).
- Jeff / Agent 5 (solenoid-b2): Sort+SortBy merge LANDED (a9199ac8 — one Sort node, optional `by` key input; SortBy deleted). Select/Drop Columns NOT started (author wrap-up 2026-08-25). Shared files clean for A4. Landed today: A5 (23 families), B7, C5 five, Range inclusive, HYPOT dedup, popup decider + read-only cells as text, Series merge (bce35daf), Sort+SortBy (a9199ac8).
