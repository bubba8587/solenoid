# Agent Coordination

Shared scratchpad for when several agents work this repo in parallel. Dormant in a solo session — claim nothing, ignore it.

**Protocol.** Agents message each other directly for live coordination; this board is only the durable claim list (one line per claim, delete on land) so a late-joining or restarted agent knows what's taken. Agent 1 is Lead. The durable role split, shared-file policy, and commit/push rules live in the agent's memory.

**Sessions (ListAgents names): A1 = solenoid-f9; peers solenoid-c7 / solenoid-ca (A2/A3 self-identify below). Message directly via SendMessage; the board is the durable record only.**

**Standing order (author, 2026-08-25): every agent runs a session cron `*/10 * * * *` → `/continue` (CronCreate on your first sync; A1 has cc889131).**

## Claims (session 2026-08-25b)

### Agent 1 (Lead)
- CLAIMED — `WireOp::pivot` (author go-ahead on lazy-handle follow-ons 2026-08-25): Pivot runs lazy on both engines. Files: src-tauri/src/engine.rs (+tests.rs), frameVerbs.ts, nodes/frame.ts PivotNode, frameVerbCorpus fixtures.

### Agent 2 (solenoid-ca) — CLAIMED: Set + Set relation → ONE SetNode (node-combining). Files: list.ts (SetOpNode+SetRelationNode → SetNode), Set*Node component(s), nodeRegistry, nodeCatalog, kind.ts, tests. (Slicer-goes-lazy DONE 7c34d874, in Recently-done.)
Staged QUEUE:
1. **Set + Set relation → ONE card** (backlog "Node-combining parked → Smaller pairs"; the author's standing merge program, maximal merge, `kind: "operation"`). `list.ts` `SetOpNode` (~L1198, ops union/intersection/difference/symmetric → list) + `SetRelationNode` (~L1332, ops equal/subset/superset/disjoint → logical). One `SetNode`: op selector spans all eight; the OUTPUT socket swaps list↔logical per op (Split Frame precedent; prune departing cables via `dropInputCables` BEFORE `removeOutput`/retype, and call `retypeOutputCables` — fcReconcile). Declare `fx` per op where the label isn't the formula name. Old saves load as Placeholder (pre-alpha, no shim). Update nodeCatalog (one entry, description per (A) rule: function + Excel note, no plumbing), seeds if any reference the old types, and run nodeOps / formulaNodeCoverage / seeds / catalogRegistry / uiCopy tests.
- **DONE — awaiting author OK: Per-card CSS census, step 1.** `bbcf9e52`: `window.__solenoidCardCensus` (census.ts, Canvas.tsx) + `scripts/card-css-census.mjs`. 687 card types, 59% paint-only, but most is structural (io-rows, skeleton) or the deliberate CardFrame SVG (stays SVG). Real step-2 target = the socket-dot ring (2,221 elems); smaller = corner badge/lock, section divider. Finding in dev-notes; backlog step-1 marked done. Step 2 not started (author "for later"). Not pushed.

### Agent 3 (solenoid-c7) — QUEUE (FIFO; flush Commit queue first; never push)
- DONE (8d5c8f74) — awaiting author eyeball on copy: catalog description sweep (item 3). Per A1's confirmed reading (A): cut socket mentions / how-a-value-travels / affordance narration / "typed or wired"; Mermaid also drops its third-party diagram-kind list; KEPT each node's function + op/mode list + Excel/library notes. 42 descriptions. `help/*.md` reviewed = out (Reference lattice/wiring teaching, sanctioned). uiCopy + full vitest (4855) + tsc green.
- DONE (8e3b10a8 deps, 2653f36a config, 4529b5df gate+docs) — awaiting author OK: Vite 8 upgrade (item 4). Class names survive minification (esbuild minifier + keepNames; oxc has none); prod-bundle grep + built-app autosave both confirm real class-name `type`s. License 3733/96 (was 3695/94). New postbuild `check-dist-classnames.mjs` + catalogRegistry shape test pin it. Plan deleted. NOT done: desktop `tauri build` ride-along (step 6) — left to author (native toolchain; Tauri only copies dist/, web build is the gate).
5. **coerceInputs.test.ts: FrameRef bridge cases** (IN PROGRESS) (lazy-handle plan step 2, skipped by A1): pin that (a) a class in `LAZY_FRAME_NODES` receives the raw `FrameRef` in `data()`, (b) a non-lazy class receives a collected `FrameValue`, (c) a ref nested inside an input array is collected (`coerceInputs.ts` ~L284). Harness pattern: `lazyChain.test.ts` (dispatching invoke stub + editor/engine). Test-only; one commit.

## Commit queue
(empty)

## Recently done
- **Lazy handles, whole plan (A1 + A2 Slicer, author OK 2026-08-25).** fa7fffb1 / c20249be / d09917e7 / 039dc56d / 7c34d874; plan file deleted 3e0a9d0b. Not pushed.
- **Merge Plots node landed (A2, 2026-08-25).** `320009d4`: MergePlotsNode + "overlay" chart op, per-series inherited kind/style, non-plot inputs #TYPE!. 14 tests. Author eyeball the merged figure. Not pushed.
- **OS-dropdown MOBILE half settled (A3, 2026-08-25).** `577d7d37`: added `--mobile` mode to the
  reorder probe; desktop pick re-appends the node (precaution REAL), mobile tapSelect selects without
  a `nodepicked`/re-append → no popup-closer on mobile, precaution is desktop-only. Backlog item
  closed, dev-notes digest added. Not pushed.
- **Hygiene C — code→archive pointers evicted (A3, 2026-08-25).** `c12b7bf0`: dropped stale `v2.0/`
  citations of archived specs from 3 code comments (broadcastRules.test, frameVerbCorpus.test,
  engine/tests.rs). Sweep confirms zero archived-doc citations remain in code. Not pushed.
- **anydata glyph landed (A1 design → A3, 2026-08-25).** code `907b7527` (8 files), docs `f9b46bb2`
  (backlog item deleted + dev-notes digest). NOTE: A1's uncommitted socketReference.test.ts was
  corrupted (a stray `|chart|document|any rank[^|]*|anything) |` prefix on all 241 lines from a
  botched find/replace); A3 recovered A1's intended edit from the fragment — widened the glyph-row
  regex to admit the new "any rank ≤ 2" doc row. Full `vitest` (4835) + `tsc` green. Not pushed.
