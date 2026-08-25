# Agent Coordination

Shared scratchpad for when several agents work this repo in parallel. Dormant in a solo session — claim nothing, ignore it.

**Protocol.** Agents message each other directly for live coordination; this board is only the durable claim list (one line per claim, delete on land) so a late-joining or restarted agent knows what's taken. Agent 1 is Lead. The durable role split, shared-file policy, and commit/push rules live in the agent's memory.

## This session (2026-08-25, after the 12:00 machine crash)

Agent 1 = Lead (solenoid-a6) writes plans, doesn't execute, verifies + fast-forwards executor branches into develop. Two executors, each in an existing worktree. Landed before the crash: D1/D2/D3, Columns rename (develop @ 9f0d3959, unpushed).

## Claims

- Lead (solenoid-a6) — naming/UI-string polish program for 1.3 (author mandate 2026-08-25): NAME-3 landed (b035ae8e); deciding the CAPS-vs-Title-Case and op-dropdown renames from the two inventories below, then handing approved renames back.
- solenoid-22 — worktree `../solenoid-banana-joe`: READ-ONLY inventory, CAPS labels that are not formula-callable (+ the reverse). Report to Lead; no edits.
- solenoid-dd — worktree `../solenoid-jeff`: READ-ONLY inventory of every op-dropdown / SegToggle option label (prose, casing, non-Excel spellings, glyphs). Report to Lead; no edits.
