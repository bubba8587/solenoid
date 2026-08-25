# Agent Coordination

Shared scratchpad for when several agents work this repo in parallel. Dormant in a solo session — claim nothing, ignore it.

**Protocol.** Agents message each other directly for live coordination; this board is only the durable claim list (one line per claim, delete on land) so a late-joining or restarted agent knows what's taken. Agent 1 is Lead. The durable role split, shared-file policy, and commit/push rules live in the agent's memory.

## Claims (session 2026-08-25b)

### Agent 1 (Lead)
- CLAIMED — `anydata` socket glyph: distinct mark (socket.css `[data-glyph="anydata"]`, one masked ::before/::after pair, 12-box), Socket Legend, `docs/socket-reference.md` glyph row, `hicSocketGlyph`. Author eyeballs the result.

### Agent 2 — staged QUEUE (take top, message A1 when done)
1. **Merge Plots node** (backlog "Small builds"): ExtensibleInputs of `chart` sockets; planar kinds overlay on one plot, shared axes, legend from source card names; non-planar inputs → #TYPE! naming the input. Chart kind, Options via Chart Builder. Reuse the multi-series path. `add-node` skill; pin with tests; run nodeOps/formulaNodeCoverage/seeds tests.
2. **Per-card CSS conversion — Step 1 census ONLY**: probe script (playwright, dev page) counting elements per card type, split value/handler vs paint-only. Output = a table in dev-notes + the script under `scripts/`. Build nothing in step 2.

### Agent 3 — QUEUE (FIFO; flush Commit queue first; never push)
1. **Hygiene C**: evict the three archived docs still cited by code — find `docs/archive/` references in `src/` + `scripts/` (`docsPointers.test.ts` is the guard), repoint to the live doc or delete the pointer per `docs/code-comments.md`.
2. **OS-dropdown rule, MOBILE half**: rerun `scripts/dropdown-reorder-probe.mjs` under the mobile viewport (`is-mobile`, tapSelect path); record the result in the backlog item + dev-notes digest.

## Commit queue
(empty)

## Recently done
(none)
