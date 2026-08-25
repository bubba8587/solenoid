# Agent Coordination

Shared scratchpad for when several agents work this repo in parallel. Dormant in a solo session — claim nothing, ignore it.

**Protocol.** Agents message each other directly for live coordination; this board is only the durable claim list (one line per claim, delete on land) so a late-joining or restarted agent knows what's taken. Agent 1 is Lead. The durable role split, shared-file policy, and commit/push rules live in the agent's memory.

**Standing order (author, 2026-08-25): every agent runs a session cron `*/10 * * * *` → `/continue` (CronCreate on your first sync; A1 has cc889131).**

## Claims (session 2026-08-25b)

### Agent 1 (Lead)
- DONE (uncommitted, in tree) — `anydata` glyph = hollow square (author pick). Files: socket.css, SocketComponent.tsx, SocketLegend.tsx (new Any Data row), hicSocketGlyph.ts+test, sockets.ts, socketReference.test.ts, docs/socket-reference.md. tsc + targeted tests green. Handed to A3 (author: "give him the work").

### Agent 2 — staged QUEUE (take top, message A1 when done)
1. **Merge Plots node** (backlog "Small builds"): ExtensibleInputs of `chart` sockets; planar kinds overlay on one plot, shared axes, legend from source card names; non-planar inputs → #TYPE! naming the input. Chart kind, Options via Chart Builder. Reuse the multi-series path. `add-node` skill; pin with tests; run nodeOps/formulaNodeCoverage/seeds tests.
2. **Per-card CSS conversion — Step 1 census ONLY**: probe script (playwright, dev page) counting elements per card type, split value/handler vs paint-only. Output = a table in dev-notes + the script under `scripts/`. Build nothing in step 2.

### Agent 3 — QUEUE (FIFO; flush Commit queue first; never push)
0. **anydata glyph landing** (A1's files above, pre-authorized by author): run full `npx vitest run` + `npx tsc --noEmit`; commit BY PATHSPEC (those 8 files only) as "anydata socket: hollow-square glyph, Any Data legend row"; delete the backlog item (`docs/backlog.md` "A proper glyph for the `anydata` socket"), add one digest line to `docs/dev-notes.md`; commit the docs. Log SHAs here.
1. **Hygiene C**: evict the three archived docs still cited by code — find `docs/archive/` references in `src/` + `scripts/` (`docsPointers.test.ts` is the guard), repoint to the live doc or delete the pointer per `docs/code-comments.md`.
2. **OS-dropdown rule, MOBILE half**: rerun `scripts/dropdown-reorder-probe.mjs` under the mobile viewport (`is-mobile`, tapSelect path); record the result in the backlog item + dev-notes digest.

## Commit queue
- A1 → A3: anydata glyph (8 files, see A3 queue item 0).

## Recently done
(none)
