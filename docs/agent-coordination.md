# Agent Coordination

Shared scratchpad for when several agents work this repo in parallel. Dormant in a solo session — claim nothing, ignore it.

**Protocol.** Agents message each other directly for live coordination; this board is only the durable claim list (one line per claim, delete on land) so a late-joining or restarted agent knows what's taken. Agent 1 is Lead. The durable role split, shared-file policy, and commit/push rules live in the agent's memory.

**Sessions (ListAgents names): A1 = solenoid-f9; peers solenoid-c7 / solenoid-ca (A2/A3 self-identify below). Message directly via SendMessage; the board is the durable record only.**

**Standing order (author, 2026-08-25): every agent runs a session cron `*/10 * * * *` → `/continue` (CronCreate on your first sync; A1 has cc889131).**

## Claims (session 2026-08-25b)

### Agent 1 (Lead)
- DONE — awaiting author OK: Pivot reads only its field columns on a lazy upstream (+ ipcBridge single import); `WireOp::pivot` ruled won't-do (digest). No claim.

### Agent 2 (solenoid-ca) — staged QUEUE (take top, message A1 when done)
1. **Desktop window controls missing (backlog "Bugs"): investigate.** `tauri-plugin-decorum` `create_overlay_titlebar()` renders no min/max/close. A3's item 8 is producing a fresh `tauri build`; run that exe (the `desktop` skill; F12 devtools work), inspect whether the decorum overlay DOM mounts at all, check the decorum/tauri version pair against decorum's changelog in node_modules / cargo registry, and read `src-tauri/src/lib.rs`'s setup order (accent border ruled out already). Deliverable: root cause + the fix if it's one-line, otherwise a precise finding in dev-notes and the fallback recommendation (native decorations). Non-gated.
2. **Formula-surface allowlist — PLAN ONLY, no build** (backlog "Formula surface is open-by-default", raise-first): write `docs/plans/formula-surface-allowlist` per the plans README protocol: inventory the ~445 FX names vs the ~377 with declared meta, classify the undeclared ones (array-taking → the #VALUE!-broadcast hazard), and lay out the two-step fix (short-circuit an undeclared FX name at the matrix gate to a clean SolError; then flip to an allowlist and delete the fallthrough). The author decides whether to run it.

HELD pending the author's eyeball of the Set card (A2 raised it, correctly: the backlog marks this list "review with the author"; A1 staged them on initiative): discount securities → one card; ACCRINT + ACCRINTM; BondPrice + OddCoupon. Specs are in git (68bf5679).
- **DONE — awaiting author OK: Per-card CSS census, step 1.** `bbcf9e52`: `window.__solenoidCardCensus` (census.ts, Canvas.tsx) + `scripts/card-css-census.mjs`. 687 card types, 59% paint-only, but most is structural (io-rows, skeleton) or the deliberate CardFrame SVG (stays SVG). Real step-2 target = the socket-dot ring (2,221 elems); smaller = corner badge/lock, section divider. Finding in dev-notes; backlog step-1 marked done. Step 2 not started (author "for later"). Not pushed.

### Agent 3 (solenoid-c7) — QUEUE (FIFO; flush Commit queue first; never push)
- DONE (8d5c8f74) — awaiting author eyeball on copy: catalog description sweep (item 3). Per A1's confirmed reading (A): cut socket mentions / how-a-value-travels / affordance narration / "typed or wired"; Mermaid also drops its third-party diagram-kind list; KEPT each node's function + op/mode list + Excel/library notes. 42 descriptions. `help/*.md` reviewed = out (Reference lattice/wiring teaching, sanctioned). uiCopy + full vitest (4855) + tsc green.
- DONE (8e3b10a8 deps, 2653f36a config, 4529b5df gate+docs) — awaiting author OK: Vite 8 upgrade (item 4). Class names survive minification (esbuild minifier + keepNames; oxc has none); prod-bundle grep + built-app autosave both confirm real class-name `type`s. License 3733/96 (was 3695/94). New postbuild `check-dist-classnames.mjs` + catalogRegistry shape test pin it. Plan deleted. NOT done: desktop `tauri build` ride-along (step 6) — left to author (native toolchain; Tauri only copies dist/, web build is the gate).
- DONE (c41588e6) — awaiting author OK: coerceInputs FrameRef bridge tests (item 5). 5 tests on `wrapNodeData` (readFrame stubbed): lazy class gets the raw ref, non-lazy collects to a value, only the ref element in a mixed array is read, no-ref stays sync. Green in isolation (34 in-file). NOTE: full-project `tsc` is transiently RED from A2's in-flight Set→SetNode rename (SetOpNode/SET_OP_META refs), NOT my file — my file has zero tsc errors; clears when A2 commits the merge.
- DONE (51b2fee7) — awaiting author OK: deferrals reconcile (item 6). Removed the "(1) summary footer → backlog B6" sub-item (landed: TablePopup per-column footer) + renumbered; fixed the Fusion-indicator entry's stale "parked lazy-handle" ref (landed today); dropped the dead "Timesavers → backlog B8" pointer (autonomous idioms landed in packs/timesavers.ts, config idioms stay author-call). out-of-scope.md untouched. Doc-only.

- DONE (no commit — read-only run) — awaiting author OK: Rust suite (item 7). `cargo test` in `src-tauri/` GREEN: 30 passed, 0 failed, 0 ignored (+ two empty test binaries). Hygiene C's `engine/tests.rs` comment edit and the day's frame work did not move the parity corpus.
8. **Desktop build ride-along under Vite 8** (IN PROGRESS) (Vite plan step 6, verify only): `npm run tauri build` (no tag, no publish, not `release:desktop`). A2's Set merge landed (`8d77cf7f`), tsc green — build running. Report completion + output path; if it fails on the Vite/Rolldown side, stop and report the error verbatim. Don't launch or ship anything.

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
