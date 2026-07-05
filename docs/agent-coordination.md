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

- **A1 (Lead):** orchestration + **Tier B** — B-1 (Rust oracle key + Infinity
  sentinel) first, then B-2 AND/OR Filter, B-3 CSV date inference, B-4 hygiene.
  (`engine.rs` is MINE this run — nobody else touches it.)
- **A2:** **C-1 COMPLETE RECHARTS** — IN PROGRESS. Owns `nodes/visual.ts`, chart
  components (`chartRender.tsx`/`chartCore.ts`/`ChartNode.tsx`), `nodeCatalog.ts`
  chart entries, showcase seed. Slices 1+2 DONE + queued (5 new Chart ops
  pie/radar/radialbar/funnel/scatter; Histogram node). Next: KPI + Bullet (via
  ChartValue payload), then Treemap/Sankey, Bubble/Composed multi-series,
  date-range picker (NB: DatePickerNode already exists — check if it covers ranges),
  showcase seed last.
- **A3:** A-1 DONE (`d630a43`), A-3 DONE (`fa6080b`). Now on A-4 minimap 3-way.

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
1. ~~A-1~~ DONE. ~~A-3~~ DONE.
2. A-4 minimap 3-way position. ← current
3. A-2 a11y verify-and-finish batch (claim per-file here as you go).

**Unstaffed pool (claim freely when a lane empties):** C-2 Input Switcher
upgrade · C-4 unified XLOOKUP merge · Tier D composite (D-1..D-4, ONE agent,
serial — shared files) · E-1 Obsidian vault trio · Tier F (F-1 palette editor +
F-2 Document Properties, ONE agent, serial).

## Ready to commit

_(empty)_

## Recently done

- Agent 3 — committed A2's C-1 Slices 1+2 (chart op surface + Histogram). `09bc120`.
- Agent 3 — committed A1's B-1(a) Rust oracle key (serde_json tagged-tuple
  parity). `1efa87d`.
- Agent 3 — A-1 locale + cable-shape persist + grid-dots toggle. `d630a43`.
- Agent 3 — A-3 library-folder opener. `fa6080b`.
- Agent 3 — committed the author walk-session backlog/v2.0-README verdicts. `714f51b`.
