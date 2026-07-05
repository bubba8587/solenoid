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

- **A1 (Lead):** orchestration + **Tier B**. DONE: B-1(a) oracle key (`1efa87d`),
  B-1(b) __nf sentinel + aggregate guard (queued #2), B-4a codegen retirement
  (queued #3). NEXT: B-4b TEXT-family divergence sweep + GroupBy total_depth,
  then B-2 AND/OR Filter + B-3 CSV dates AFTER the queue flushes (they re-enter
  the queued files). (`engine.rs` stays MINE — nobody else touches it.)
- **A2:** **C-1 COMPLETE RECHARTS** — IN PROGRESS. Owns `nodes/visual.ts`, chart
  components, `nodeCatalog.ts` chart entries, showcase seed. Committed: Slices 1+2
  (`09bc120`, 5 ops + Histogram), Slices 3+4 (`7315441`, KPI/Bullet/Treemap/Sankey).
  Date-range picker DONE + READY (queued). **Remaining: Bubble/Composed multi-series
  (needs a matrix input on Chart — the one invasive piece, own commit), then the
  showcase seed wiring every new type.** Pausing for A3 to commit date-range before
  the seed re-touches shared files.
- **A3:** A-1/A-3/A-4 DONE. A-2 a11y batch DONE + committed (`c556b84`). FIFO
  queue fully flushed: A2's Slices 3+4 (`7315441`), A1's B-1b (`aa2a623`, cargo
  54/54), A1's B-4a (`aa5ab34`), A2's date-range picker (`5bd7105`). Pushed
  `develop` to origin per direct author confirmation in my session (relayed
  second-hand notes alone don't trigger a push — confirmed live this time):
  `f926fa6..aa5ab34` (a stale ref at push time; `5bd7105` landed after and is
  NOT yet pushed — will push again once more READY items land, or on request).
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
1. ~~A-1~~ DONE. ~~A-3~~ DONE. ~~A-4~~ DONE. ~~A-2 a11y~~ DONE (`c556b84`).
2. ~~Push develop~~ DONE (`f926fa6..aa5ab34`, confirmed live with the author).
   NOTE: `5bd7105` (date-range picker) landed after that push — still
   unpushed. Push again once the queue empties, or if the author asks.

**Unstaffed pool (claim freely when a lane empties):** C-2 Input Switcher
upgrade · C-4 unified XLOOKUP merge · Tier D composite (D-1..D-4, ONE agent,
serial — shared files) · E-1 Obsidian vault trio · Tier F (F-1 palette editor +
F-2 Document Properties, ONE agent, serial).

## Ready to commit

_(empty)_

## Recently done

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
