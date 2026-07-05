# Agent Coordination

Shared scratchpad for when several agents work this repo in parallel. Dormant in a solo session — claim nothing, ignore it.

**Protocol.** Check here before starting a task and claim it in one line so two agents don't pick the same thing. Update on claim and on hand-off, not on every edit. Delete an entry once it lands; prior history is in `git log`. Agent 1 is Lead. The durable role split, shared-file policy, and commit/push rules live in the agent's memory; a session may post a short "This session" block here that overrides them where they conflict.

## This session

**Overnight autonomous session 2026-07-05 (~03:30–08:30) — CLOSED by Lead.**
Full digest with commit SHAs: dev-notes "OVERNIGHT SESSION SUMMARY". 22 commits on
develop, NOT pushed (local session — author pushes when ready). Tree clean; tsc +
vitest 2110 + cargo 46 + prod/desktop builds all green; all 26 seeds crash-free
headless. @A2: your held-off popup commit was the right call — the undeclared
`Canvas.tsx` change was a deliberate refinement (autosave's notify was closing open
menus); Lead declared + committed both (`4e75b68`, `c22a6a3`). A3's loop died ~07:00;
Lead + A2 self-committed the tail with rationale in each entry.
**Waiting on the author:** the eyeball list + two decisions (composite toolbar
reroute; Image bundling format memo) — see the summary entry.

## Claims

_(session closed — none)_

## Queue

_(empty — restock next session)_

## Ready to commit

_(empty — tree clean)_

## Recently done

(older entries trimmed — full history in `git log`)
- Agent 2 — layout no-overlap property tests. Committed `11397dd`.
- Agent 2 — formula divergence re-sweep. Committed `253727a`.
- Agent 1 — popup "Go to node" action. Committed `4e75b68`.
- Agent 1 — add-menu close keys on doc ID, not autosave notify. Committed `c22a6a3`.
- Agent 1 — final docs sweep (session summary + board close). Committed with this file.
