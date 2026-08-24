# Agent Coordination

Shared scratchpad for when several agents work this repo in parallel. Dormant in a solo session — claim nothing, ignore it.

**Protocol.** Agents message each other directly for live coordination; this board is only the durable claim list (one line per claim, delete on land) so a late-joining or restarted agent knows what's taken. Agent 1 is Lead. The durable role split, shared-file policy, and commit/push rules live in the agent's memory.

## This session (2026-08-24)

Agent 1 writes plans (`docs/plans/`), doesn't execute. Executors (Agent 2 solenoid-18, Agent 4 solenoid-f1, Jeff/Agent 5 solenoid-b2): claim a plan from `docs/plans/README.md` below, follow its protocol.

## Claims

- B8 — Agent 2 (solenoid-18): COMPLETE. B8.1 Unnest cube-peel (5a5b3ab6), B8.2 SUMIFS all/any + Aggregate First/Last (2567631d, f42b42d0), B8.3 XLOOKUP frame+cube path collapse (a03eeba3, plan file deleted f693b5d7). Replace Values match-rule Finding COMPLETE (601e864c) — one rule both engines, cargo-pinned (replace_values_match_rule_parity), backlog Bugs item deleted; the Rust was already correct (numeric since B5), the JS just carried redundant clauses. Also landed this session: C4 (d01f6d10, 4184d711, 56daabda; copy in A4's baae4eb4), A6, A4, A3, C3.1, C3.2. A2 lane dry — awaiting Lead's next.
- HYPOT dedup + popup-virtualize decider — Jeff / Agent 5 (solenoid-b2): COMPLETE. (1) HYPOT dedup: HypotenuseNode deleted, HYPOTENUSE_ENTRY → TwoInputMath `hypot` op (b9326053); parity-surface follow-up A4 flagged — leafOps + FORMULA_NODE_ALIAS (85a8e604). (2) Popup decider: DOM-cost probe (scripts/table-popup-probe.mjs) + dev-notes FINDING (a43c1117) — `<input>` is ~2.5× plain text, read-only pays it needlessly, wide frames drop ~350ms/keystroke; author's call between row-virtualization (general) and plain-text read-only cells (cheap). Lane dry — awaiting Lead's next. (C5 COMPLETE — ETS dbff6936; B7 8bf129c7; A5 f3fa52c5.)

