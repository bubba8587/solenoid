# Agent Coordination

Shared scratchpad for when several agents work this repo in parallel. Dormant in a solo session — claim nothing, ignore it.

**Protocol.** Agents message each other directly for live coordination; this board is only the durable claim list (one line per claim, delete on land) so a late-joining or restarted agent knows what's taken. Agent 1 is Lead. The durable role split, shared-file policy, and commit/push rules live in the agent's memory.

**Sessions (ListAgents names): A1 = solenoid-f9; peers solenoid-c7 / solenoid-ca (A2/A3 self-identify below). Message directly via SendMessage; the board is the durable record only.**

**Standing order (author, 2026-08-25): every agent runs a session cron `*/10 * * * *` → `/continue` (CronCreate on your first sync; A1 has cc889131).**

## Claims (session 2026-08-25b)

### Agent 1 (Lead)
- DONE — plans written: `docs/plans/vite-8-upgrade.md` (queued to A3), `docs/plans/lazy-handle-on-cable.md` (unassigned; large). `zIndexNodesOrder` closed as won't-do (decision domOrderStacking, 0918be94). Plans README index rewritten with plain names.

### Agent 2 (solenoid-ca) — CLAIMED: Merge Plots node (item 1, in progress; author add: inherit each source chart's kind + options). Staged QUEUE below.
1. **Merge Plots node** (backlog "Small builds"): ExtensibleInputs of `chart` sockets; planar kinds overlay on one plot, shared axes, legend from source card names; non-planar inputs → #TYPE! naming the input. Chart kind, Options via Chart Builder. Reuse the multi-series path. `add-node` skill; pin with tests; run nodeOps/formulaNodeCoverage/seeds tests.
2. **Per-card CSS conversion — Step 1 census ONLY**: probe script (playwright, dev page) counting elements per card type, split value/handler vs paint-only. Output = a table in dev-notes + the script under `scripts/`. Build nothing in step 2.

### Agent 3 (solenoid-c7) — QUEUE (FIFO; flush Commit queue first; never push)
2. **OS-dropdown rule, MOBILE half** (IN PROGRESS): rerun `scripts/dropdown-reorder-probe.mjs` under the mobile viewport (`is-mobile`, tapSelect path); record the result in the backlog item + dev-notes digest.
3. **Mermaid description trim + catalog sweep** (author-flagged 2026-08-25, RULE: a description never mentions sockets, cables, wiring, "typed on the node or wired in", "flows out/in", "wire X" — wiring IS the app; nor socket types, nor how a value travels). Mermaid → "Draws a diagram from Mermaid text: flowchart, sequence, class, state, gantt, or pie." Then sweep EVERY `nodeCatalog.ts` description (Record's "wire Row" / "The shown row flows back out" are the same sin) and `src/graph/help/*.md` for the same and cut it; keep only what the node computes/draws, its modes, and genuine Excel deviations. DESIGN.md §7 first; run `uiCopy.test.ts` + catalog tests. One commit; list every edited node in the message.
4. **Vite 8 upgrade** — follow `docs/plans/vite-8-upgrade.md` exactly (the persisted-type gate is the point; stop and report if class names mangle or the license file goes empty).

## Commit queue
(empty)

## Recently done
- **Hygiene C — code→archive pointers evicted (A3, 2026-08-25).** `c12b7bf0`: dropped stale `v2.0/`
  citations of archived specs from 3 code comments (broadcastRules.test, frameVerbCorpus.test,
  engine/tests.rs). Sweep confirms zero archived-doc citations remain in code. Not pushed.
- **anydata glyph landed (A1 design → A3, 2026-08-25).** code `907b7527` (8 files), docs `f9b46bb2`
  (backlog item deleted + dev-notes digest). NOTE: A1's uncommitted socketReference.test.ts was
  corrupted (a stray `|chart|document|any rank[^|]*|anything) |` prefix on all 241 lines from a
  botched find/replace); A3 recovered A1's intended edit from the fragment — widened the glyph-row
  regex to admit the new "any rank ≤ 2" doc row. Full `vitest` (4835) + `tsc` green. Not pushed.
