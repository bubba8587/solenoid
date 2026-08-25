# Agent Coordination

Shared scratchpad for when several agents work this repo in parallel. Dormant in a solo session — claim nothing, ignore it.

**Protocol.** Agents message each other directly for live coordination; this board is only the durable claim list (one line per claim, delete on land) so a late-joining or restarted agent knows what's taken. Agent 1 is Lead. The durable role split, shared-file policy, and commit/push rules live in the agent's memory.

## This session (2026-08-25)

Agent 1 = Nick Fury (Lead) writes plans (`docs/plans/`), doesn't execute; cron re-syncs this board every 20 min. Plans D1–D5 (the five scoped-not-started merges) in flight. Executors (Agent 2 solenoid-18, Agent 4 solenoid-f1, Jeff/Agent 5 solenoid-b2): claim a plan from `docs/plans/README.md` below, follow its protocol.

## Claims

- Agent 2 (solenoid-18) — SESSION COMPLETE (author wrap). Landed today: A6, A4, A3, C3, C4, B8, Replace Values parity, Node Packs pin, katex 0.18, Set Cell, Gauge+Bullet (fc0ecd4a). Treemap+Waffle → one "Proportion" card NOT started (author wrap) — scoped only: both are already frame→chart-payload figures on the same chart-card surface, so the merge is like Gauge+Bullet but with NO pass-through contract change (both stay chart nodes); a `ProportionPayload {layout:"treemap"|"waffle", names, values}` unifying TreemapPayload+WafflePayload, op "proportion", renderer branch, Treemap/Waffle → one Gauge-style `op` selector, keep Sankey separate in the Proportion category. Ready for a future session.
- Agent 4 (solenoid-f1) — SESSION COMPLETE (author wrap). Landed today: Write File merge (b40f069d), Local File merge (41743e7d), rete-area-plugin 2.3.2 (eb2b4acb), OS-dropdown rule settled + probe (e000b635). Three node-combining merges (TREND⊂FORECAST+GROWTH, LINEST+LOGEST, PHI/GAUSS→Distribution) NOT started — fully scoped with Lead's design calls settled, zero code written (shared-file window opened only at wrap-up). Pick-up-cold detail in the dev-notes digest ("NOT STARTED / prepped at wrap-up"). Tree clean, no half-work.
- Jeff / Agent 5 (solenoid-b2): Sort+SortBy merge LANDED (a9199ac8 — one Sort node, optional `by` key input; SortBy deleted). Select/Drop Columns NOT started (author wrap-up 2026-08-25). Shared files clean for A4. Landed today: A5 (23 families), B7, C5 five, Range inclusive, HYPOT dedup, popup decider + read-only cells as text, Series merge (bce35daf), Sort+SortBy (a9199ac8).
