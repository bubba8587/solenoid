# Agent Coordination

Shared scratchpad for when several agents work this repo in parallel. Dormant in a solo session — claim nothing, ignore it.

**Protocol.** Check here before starting a task and claim it in one line so two agents don't pick the same thing. Update on claim and on hand-off, not on every edit. Delete an entry once it lands; prior history is in `git log`. Agent 1 is Lead. The durable role split, shared-file policy, and commit/push rules live in the agent's memory; a session may post a short "This session" block here that overrides them where they conflict.

## This session

**AUTONOMOUS BUILD RUN (opened 2026-07-05 evening) — work `docs/build-plan.md`.**
Every bundle is author-ratified this session; NO design forks remain — pick the
spec-consistent option and note it, don't stall. Rules: tsc + full vitest green
per commit (cargo where Rust moves); NEVER push; **anything visual ships/extends
a demo SEED** (author order — the eyeball vehicle; seed polish comes in a
last-minute cleanup pass, just make them load clean); eyeball notes accumulate in
the daytime digest; DELETE a backlog line when its bundle lands; one editor per
code file; commits FIFO through A3's queue.
NOT in scope (author-present, later): A4 units, D2 reroute, D4 cond-fmt, the
border seam, grid system, collision avoidance, transpiler, seed-cleanup.

## Claims

- **A1 (Lead):** orchestration + **Tier B**. DONE: B-1(a) `1efa87d`, B-1(b)
  `aa2a623`, B-4a `aa5ab34`, B-4b (queued READY below). NOW: **B-2 AND/OR
  multi-predicate Filter** — starting with the engine/oracle half
  (`frameVerbs.ts` + `engine.rs` + parity tests, files now free); the node-UI
  half (`nodes/frame.ts` + `FrameNodes.tsx`) WAITS until my B-4b commit lands
  (those files are in its stage list). Then B-3 CSV dates.
  (`engine.rs` stays MINE — nobody else touches it.)
- **A2:** **C-1 fully committed** (`09bc120`/`7315441`/`5bd7105`/`6841167`/`1e71d66` +
  finale). Now: **C-3 (popup ⋯ + collapsed previews)** — part 1 (⋯ menu) committed
  `6841167`; **part 2 (Slicer/Sparkline collapsed previews) DONE + READY**; Gauge left
  non-collapsible (build-only-if-clean — needs a live socket check). **Also fixed the
  author-reported Treemap/Sankey BLANK-BOX bug** (recharts 3.x needs the function-form
  content/node prop — root-caused against the installed types) → READY, needs author
  re-eyeball (no-puppeteer). **Now on E-2 (Finance/FRED)** — slice 1 (apiKeyStore, tested)
  DONE + READY. Remaining E-2: Settings keys section, provider-preset connection node
  (FRED + Stooq/Alpha Vantage), FRED demo seed. Discipline: always full `vitest` pre-READY.
- **A3:** All FIFO items flushed through this check-in: A2's C-1 FINALE
  (`1e71d66`), C-3 part 1 (`6841167`), A1's B-4b (`a2c6fdd`), A1's B-2 engine
  half (`2eb65a4`), **A2's Treemap/Sankey blank-box BUGFIX** (`d824373` — A2
  root-caused it: recharts 3.x needs the function-form `content`/`node` prop
  for per-node geometry; static element = 0×0 everywhere. Confirms my earlier
  investigation was on the right track but hadn't found the exact API gap —
  backlog line kept open pending the author's live eyeball, not deleted), C-3
  part 2 (`bde3e12`, Slicer/Sparkline collapsed previews), E-2 slice 1
  (`7cdcea0`, apiKeyStore foundation). `develop` unpushed past `5bd7105`
  (10 commits since) — will push once the queue empties again or on request.
  Idle on the commit queue now.

## Queue

**A2 (staged — take the top one now):**
1. **C-1 COMPLETE RECHARTS** — the plan's big bundle: every recharts type into
   the Chart family (Pie/Scatter/Bubble/Radar/RadialBar/Funnel/Composed in the op
   surface; Treemap + Sankey as new nodes), Histogram (binned), KPI/Stat card,
   Bullet, date-range picker; lazy chunk; **ships the showcase seed**. See
   `build-plan.md` C-1. Footprint: `visual.ts`, chart components, catalog, seed.
2. C-3 popup `⋯` overflow + per-node collapsed previews (popup files only).
3. E-2 Finance/FRED connection (API-key store + FRED + Stooq).

**A3 (commit duty FIRST — flush "Ready to commit" FIFO — then):**
1. ~~Push develop~~ DONE (`f926fa6..aa5ab34`). NOTE: commits after that push are
   unpushed; push again once the queue empties (standing author OK from the same
   order), or if the author asks.
2. **C-2 Input Switcher upgrade** (staged by A1): editable per-slot titles
   (draft-commit via `useDraftCommit` — never per-keystroke) + a multi-select
   mode collecting the selected inputs into a Cube (reuse the existing Cube
   builders — see `nodes/cube.ts`). Seed row in the chart-showcase (or a small
   dedicated seed if cleaner). See `build-plan.md` C-2. Footprint: the switcher
   node + component, catalog, seed — no overlap with A1 (frame/engine) or A2
   (popup files).

**Unstaffed pool (claim freely when a lane empties):** C-2 Input Switcher
upgrade · C-4 unified XLOOKUP merge · Tier D composite (D-1..D-4, ONE agent,
serial — shared files) · E-1 Obsidian vault trio · Tier F (F-1 palette editor +
F-2 Document Properties, ONE agent, serial).

## Ready to commit

_(empty)_

## Recently done

- Agent 3 — A2's E-2 slice 1, apiKeyStore foundation. `7cdcea0`.
- Agent 3 — A2's C-3 part 2, Slicer/Sparkline collapsed previews. `bde3e12`.
- Agent 3 — A2's Treemap/Sankey blank-box bugfix (recharts function-form
  content/node prop). `d824373`. Backlog line kept open pending author eyeball.
- Agent 3 — A1's B-2 engine half, filterMulti verb (cargo 63/63). `2eb65a4`.
- Agent 3 — A1's B-4b, TEXT-family sweep + Group By totals. `a2c6fdd`.
- Agent 3 — A2's C-3 part 1, popup overflow menu. `6841167`.
- Agent 3 — A2's C-1 FINALE, Composed/Bubble + chart-showcase seed. `1e71d66`.
- Agent 3 — logged the Treemap/Sankey blank-box bug in `backlog.md` (author-reported,
  needs a browser console check to pin down — see backlog "Nodes / engine").
- Agent 3 — A2's date-range picker (DateRangeNode). `5bd7105`.
- **Pushed `develop` to origin** — direct author confirmation in-session.
  `f926fa6..aa5ab34`.
- Agent 3 — A1's B-4a, compileFormula codegen retired. `aa5ab34`.
- Agent 3 — A1's B-1(b), Infinity wire sentinel + aggregate guard (cargo 54/54). `aa2a623`.
- Agent 3 — A2's C-1 Slices 3+4 (KPI/Bullet/Treemap/Sankey). `7315441`.
- Agent 3 — A-2 a11y batch (7 items). `c556b84`.
- Agent 3 — committed A2's C-1 Slices 1+2 (chart op surface + Histogram). `09bc120`.
- Agent 3 — committed A1's B-1(a) Rust oracle key (serde_json tagged-tuple
  parity). `1efa87d`.
- Agent 3 — A-1 locale + cable-shape persist + grid-dots toggle. `d630a43`.
- Agent 3 — A-3 library-folder opener. `fa6080b`.
- Agent 3 — committed the author walk-session backlog/v2.0-README verdicts. `714f51b`.
