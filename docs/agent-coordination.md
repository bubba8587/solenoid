# Agent Coordination

Shared scratchpad for when several agents work this repo in parallel. Dormant in a solo session — claim nothing, ignore it.

**Protocol.** Agents message each other directly for live coordination; this board is only the durable claim list (one line per claim, delete on land) so a late-joining or restarted agent knows what's taken. Agent 1 is Lead. The durable role split, shared-file policy, and commit/push rules live in the agent's memory.

**Sessions (ListAgents names): A1 = solenoid-f9; peers solenoid-c7 / solenoid-ca (A2/A3 self-identify below). Message directly via SendMessage; the board is the durable record only.**

**Standing order (author, 2026-08-25): every agent runs a session cron `*/10 * * * *` → `/continue` (CronCreate on your first sync; A1 has cc889131).**

## Claims (session 2026-08-25b)

### Agent 1 (Lead)
- DONE — awaiting author OK: Pivot reads only its field columns on a lazy upstream (+ ipcBridge single import); `WireOp::pivot` ruled won't-do (digest). No claim.

### Agent 2 (solenoid-ca) — CLAIMED: Discount securities → ONE DiscountSecurityNode (node-combining). (Set merge DONE 8d77cf7f, in Recently-done; awaiting author eyeball on the 8-op card + socket-driven accent.)
Staged QUEUE:
1. **Discount securities → ONE card** (same parked list, next pair; author may veto). `finance.ts` `TBillNode` (~L774, TBILLEQ/TBILLPRICE/TBILLYIELD), `SecurityDiscNode` (~L851, DISC/PRICEDISC/YIELDDISC/RECEIVED/INTRATE family), `PriceDiscNode` (~L1037), `PriceMatNode` (~L1086, PRICEMAT/YIELDMAT). All settlement/maturity/basis-shaped: one `DiscountSecurityNode`, `kind: "operation"`, spec-table the per-op extra inputs (`DIST_SPECS` pattern; prune departing keys via `dropInputCables` BEFORE `removeInput`), `fx` per op = the Excel name. Carry state across switches by meaning. Keep `financeInvariants.test.ts` round-trips green (PRICEMAT↔YIELDMAT etc.); parity corpus + nodeOps / formulaNodeCoverage / seeds / catalogRegistry / uiCopy. Old saves → Placeholder.
- **DONE — awaiting author OK: Per-card CSS census, step 1.** `bbcf9e52`: `window.__solenoidCardCensus` (census.ts, Canvas.tsx) + `scripts/card-css-census.mjs`. 687 card types, 59% paint-only, but most is structural (io-rows, skeleton) or the deliberate CardFrame SVG (stays SVG). Real step-2 target = the socket-dot ring (2,221 elems); smaller = corner badge/lock, section divider. Finding in dev-notes; backlog step-1 marked done. Step 2 not started (author "for later"). Not pushed.

### Agent 3 (solenoid-c7) — QUEUE (FIFO; flush Commit queue first; never push)
- DONE (8d5c8f74) — awaiting author eyeball on copy: catalog description sweep (item 3). Per A1's confirmed reading (A): cut socket mentions / how-a-value-travels / affordance narration / "typed or wired"; Mermaid also drops its third-party diagram-kind list; KEPT each node's function + op/mode list + Excel/library notes. 42 descriptions. `help/*.md` reviewed = out (Reference lattice/wiring teaching, sanctioned). uiCopy + full vitest (4855) + tsc green.
- DONE (8e3b10a8 deps, 2653f36a config, 4529b5df gate+docs) — awaiting author OK: Vite 8 upgrade (item 4). Class names survive minification (esbuild minifier + keepNames; oxc has none); prod-bundle grep + built-app autosave both confirm real class-name `type`s. License 3733/96 (was 3695/94). New postbuild `check-dist-classnames.mjs` + catalogRegistry shape test pin it. Plan deleted. NOT done: desktop `tauri build` ride-along (step 6) — left to author (native toolchain; Tauri only copies dist/, web build is the gate).
- DONE (c41588e6) — awaiting author OK: coerceInputs FrameRef bridge tests (item 5). 5 tests on `wrapNodeData` (readFrame stubbed): lazy class gets the raw ref, non-lazy collects to a value, only the ref element in a mixed array is read, no-ref stays sync. Green in isolation (34 in-file). NOTE: full-project `tsc` is transiently RED from A2's in-flight Set→SetNode rename (SetOpNode/SET_OP_META refs), NOT my file — my file has zero tsc errors; clears when A2 commits the merge.
- DONE (51b2fee7) — awaiting author OK: deferrals reconcile (item 6). Removed the "(1) summary footer → backlog B6" sub-item (landed: TablePopup per-column footer) + renumbered; fixed the Fusion-indicator entry's stale "parked lazy-handle" ref (landed today); dropped the dead "Timesavers → backlog B8" pointer (autonomous idioms landed in packs/timesavers.ts, config idioms stay author-call). out-of-scope.md untouched. Doc-only.

7. **Rust suite** (IN PROGRESS) (mechanical): `cargo test` in `src-tauri/` (cargo 1.94 is installed). Hygiene C edited `engine/tests.rs` and the day's frame work must not have moved the parity corpus. Report pass/fail counts; if red, stop and report the failing test names, don't fix.
8. **Desktop build ride-along under Vite 8** (Vite plan step 6, verify only): `npm run tauri build` (no tag, no publish, not `release:desktop`). Wait for A2's Set merge to land first (tsc must be green). Report whether it completes and the output path; if it fails on the Vite/Rolldown side, stop and report the error verbatim. Don't launch or ship anything.

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
