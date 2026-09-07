# 25 — Gantt and project scheduling: the landscape, the spec, the plan

> **STATUS: PROPOSAL (2026-09-07).** Research bundle for `../2.0-plan.md` Arc 8. Written from the
> outside in: what the best software in this space does, what a correct engine and figure must
> compute, and how that maps onto Solenoid's basics (typed nodes, Frames, the nested Cube). It
> does not build on anything already in the tree; the one-line "what stands today" is § 9.
> Every recommendation is the bundle's default until the author rules (§ 10 lists the calls).
> Effort is deliberately not a criterion anywhere in this document (author's direction).

Six research passes fed this (embeddable libraries; scheduling semantics, engines and formats;
open-source and data-first applications; commercial benchmarks and UX; text and plotting
approaches; library internals and headless-core precedents). Facts below were verified on live
pages on 2026-09-07 unless marked *[unverified]*; the compact source list is § 11.

---

## 0. The verdict in one page

**There is no standout permissive repo to adopt as a whole.** The entire market, open and
commercial, puts its seam in the same place: the renderer is free, and *anything that computes
dates* (auto-scheduling, constraints, calendars, critical path, undo) is the paid or copyleft
part. DHTMLX Community (MIT since 10.0), SVAR (MIT), Frappe (MIT), VTable-Gantt (MIT) are
renderers with drag handlers. The only open engines with real semantics are Java or Ruby desktop
code under CPAL/GPL (ProjectLibre, Calligra Plan, TaskJuggler, GanttProject), MPXJ (LGPL, Java)
and one TypeScript core inside Huly (EPL-2.0). No maintained permissive package computes Gantt
geometry and arrow routing without owning the DOM either.

**The standout to MATCH is not a repo but a spec: Microsoft Project's scheduling semantics**,
with MPXJ's `MicrosoftScheduler` as the open oracle that reproduces them, and every
Project-authored MSPDI file as a golden test (it stores the computed dates beside the inputs).
Bryntum's engine is the commercial benchmark for how that spec looks as a headless TypeScript
library; Huly's `gantt/lib` is the modern open design reference for the same shape.

**Recommendation: a separate, MIT, headless project-scheduling toolkit** (working name in this
doc: *the scheduling repo*), consumed by Solenoid as a dependency, with four packages:

| Package | Owns | Copies its shape from |
|---|---|---|
| `schedule-engine` | pure functions: tables in → tables out; CPM with calendars, constraints, lag units, actuals, baselines, diagnostics; propose → validate → commit | MS Project semantics; MPXJ as oracle; Huly and Bryntum/ChronoGraph for API shape (studied) |
| `gantt-layout` | headless geometry: time scale + tiers, row/bar rects, arrow paths, virtual windows, hit-testing; emits a plain-number `RenderFrame` | DHTMLX v10 `scale_manager.ts` + `link_render.js` and SVAR `scales.ts`/`links.ts` (both MIT, vendorable), `d3-time` ticks, vis-timeline stacking |
| `gantt-dom` | framework-free interaction machines: drag, resize, draw-a-link, pan/zoom, as classes with callbacks | `@xyflow/system` (`XYDrag`, `XYPanZoom`), already in Solenoid's tree |
| `gantt-react` | thin adapter: hooks + SVG-in-DOM components, ARIA treegrid grid half, CSS variables, slots | TanStack Virtual's 279-line React adapter; Syncfusion's ARIA map; DHTMLX keyboard map |
| `project-io` | MSPDI read/write, XER read, GanttProject `.gan`, Smartsheet-style predecessor grammar, CSV conventions | MPXJ (formats), `xer-parser` (MIT), `@svar-ui/lib-mspx` (MIT) |

Solenoid's own contribution stays thin: a **Plan** node family that binds Frames/Cubes to those
tables, and a **Gantt figure** on the `chart` socket. The schedule stays a pure function of the
tables (pinned by the corpus), the figure stays a view of it, and bar editing, if the author
allows it, is an input device for the *source* literals, never state of its own (§ 6.4).

"Combine the best of a bunch of mid-tier repos" is right as *lineage* and, for the layout layer,
partly literal: DHTMLX 10 relicensed to MIT and now publishes readable TypeScript, so its
Gantt-independent scale engine and its four-type orthogonal link router can be vendored beside
SVAR's MIT store code, `d3-time`, xyflow's interaction machines and TanStack Virtual. For the
engine it is lineage only: everything that computes dates correctly is GPL, CPAL, EPL or
commercial and must be re-derived from the spec. § 5 names what can be vendored, what can only
be studied, and what each contributes.

---

## 1. What a "Gantt" is (four separable things)

Every product surveyed decomposes the same way, and the seams are where the money and the
licenses sit:

1. **The engine.** Tasks + dependencies + calendars + constraints → dates, float, critical set,
   diagnostics. Deterministic, DOM-free. This is where MS Project, P6, Bryntum, Huly, TaskJuggler
   and Calligra Plan spend their code, and where every open-core vendor draws the paid line.
2. **The layout.** A time scale with stacked header tiers, row geometry, bar rectangles, milestone
   diamonds, summary brackets, orthogonal arrow routes, virtual windows. Highcharts' `pathfinder`
   and vis-timeline's `TimeAxis` are the only mature open implementations, and both are bound to
   their renderer.
3. **The view.** Two panes (a tree grid and a timeline) sharing row height and vertical scroll;
   gestures (drag, resize, draw-a-link); keyboard and ARIA.
4. **Interchange.** MSPDI XML is the de facto exchange format every desktop tool reads and writes;
   XER for Primavera; predecessor strings (`3FS+2d`) are the lingua franca of the grid cell.

For a dataflow tool the split is even cleaner than for an app: (1) is a verb, (2)+(3) are a
figure, (4) are source and sink nodes.

---

## 2. The landscape

### 2.1 Embeddable JavaScript libraries (verified on npm/GitHub, 2026-09-07)

**Permissive and maintained**

| Library | License | Size (gz) | Engine? | What it has | What it lacks |
|---|---|---|---|---|---|
| SVAR React Gantt `@svar-ui/react-gantt` 2.7.2 | MIT (XB Software, same company as DHTMLX) | ~28 kB entry + `gantt-store` 25 kB + 16 sibling packages; well over 100 kB total | none (auto-schedule, CPM, calendars, undo are PRO; the store's calendar types are literal stubs) | hand-written React components mirroring the Svelte ones one-to-one over a shared framework-free store (`DataStore.ts`, a declarative in/out derivation router); geometry (`$x/$y/$w/$p`) computed in the store, DOM bars + one SVG overlay for links with a hit polyline; row windowing; 4 link types drawn by drag; summary/milestone; inline editors; zoom levels; `columns={false}` hides grid; CSS vars; `api.intercept` | any date computation; local-`Date` arithmetic only; 2026 issues show drag/scroll regressions with no public replies; a11y unverified |
| DHTMLX Gantt Community 10.0.3 | **MIT since 10.0** (≤9.x GPLv2); readable TS/JS/LESS sources now in the repo (466 files) | 175 kB | none (28 PRO-only features; the work-time *calculator* shape is visible but its strategy is a two-line stub, and the auto-scheduling engine ships only its config normalizer) | the most complete free renderer: tree grid + inline editors, 4 link types with lag (drawn, not enforced), summary/milestone, smart rendering with per-layer DOM caches and row/bar culling (delays from 10–20k tasks), keyboard plugin, WAI-ARIA, layout config, a **Gantt-independent `scale_manager.ts`** with injected dependencies, 7.5k lines of typings | imperative global singleton with its own DOM/CSS world; links drawn as divs with CSS-border corners; React wrapper is PRO; export via DHTMLX's online service; no unit tests in the public repo |
| Frappe Gantt 1.2.2 | MIT | 14.5 kB | `move_dependencies` cascades transitive dependents by the drag delta; nothing else | SVG, zero deps, custom view modes, holidays + `ignore` periods excluded from duration, CSS vars, popup API | hierarchy, milestones, link types/lag, grid, keyboard, ARIA, virtualization, TS types |
| VTable-Gantt (ByteDance) 1.26.7 | MIT | 557 kB | none | canvas; 4 link types by drag; tree/summary/milestone; multi-level scales; React wrapper | canvas = no DOM theming/ARIA; Chinese-first docs; heavy |
| jsGantt-improved 3.0.0 | ISC/BSD (metadata inconsistent) | 47 kB | none | planned vs actual (baseline) bars, 4 link types by suffix, resources, cost, hierarchy | DOM tables, jQuery-era API, fixed 532 px panel |
| vis-timeline 8.5.4 | Apache-2.0 OR MIT | 123 kB + moment | none | pan/zoom/stacking, nested groups, editable ranges, custom time bars | dependencies (only via `timeline-arrows`), hierarchy, progress; a timeline, not a Gantt |
| react-calendar-timeline 0.30 beta | MIT | — | none | controlled React resource timeline, React 19 in beta | dependencies, hierarchy; rewrite has not left beta |
| 2025–26 React micro-libs: `@jaeungkim/gantt-chart` 1.3.0, `@art-tools/react-gantt` 0.2.1, `@bluemillstudio/gantt` 0.11.1, `@haro/react-gantt`, `gantt-lib` | MIT | 24–90 kB | `@art-tools` claims cascade + working calendars + undo transactions; `@bluemillstudio` claims CPM/critical path/baselines | controlled-input models (`tasks` in, `onTasksChange` out), 4 link types, virtualization, ARIA treegrid (`@jaeungkim`) | ~0 stars, single authors, months old |
| Headless alphas: `@gantt-chart/core`, `@bimetal/gantt-headless`, `gantt-renderer`, `dnd-timeline` | MIT / Apache-2.0 | 5–90 kB | `@bimetal` FS + cycle rejection; others none | DOM-free layout (`@gantt-chart/core`: rows → layout → virtualize, binary-searchable `LayoutResult`), headless controller with framework bindings (`@bimetal`), rows×items drag hooks (`dnd-timeline`, 250★) | maturity |

**Permissive but stale:** gantt-task-react 0.3.9 (MIT, 1.1k★, last commit 2023-01, React 18 peer,
129 open issues) and its forks; the `@wamra` fork adds typed four-way links, a critical-path
flag and holiday-aware rounding but is MUI-bound and frozen since 2024-11. Twproject jQueryGantt
(MIT, dead 2020) carries a readable cascade + CPM `ganttMaster`. IBM gantt-chart (Apache-2.0,
dormant, 31 MB).

**Not embeddable in an MIT app:** gantt-schedule-timeline-calendar (NEURONET free/trial terms,
license key), Planby (all rights reserved), ApexGantt (watermark/key), `wx-react-gantt` 1.x
(GPLv3), DHTMLX ≤9 (GPLv2), `@fluidence/react-gantt` (GPL-3), Google Charts Gantt (loader may
not be self-hosted, so it cannot run offline in Tauri).

**Commercial benchmarks (list prices):** Bryntum Gantt 7.3.5 ($940/dev, min 3; engine on
ChronoGraph, DOM-free, runs in Node; 14-scenario correctness suite published; there is no open
`@bryntum/engine` package, the engine ships inside the product, and ChronoGraph itself has been
frozen since its 2021 npm release); DHTMLX PRO
($799–$5,999/yr; v10 changelog enumerates ~20 fixed scheduling edge cases); Syncfusion 34.2
($959/dev/yr min 5; community license under $1M revenue; `'2FS+3d'` grammar; three link
validation modes; WCAG 2.2 ARIA treegrid); Highcharts Gantt ($366 + $73/seat; SVG; `pathfinder`
arrow routing; explicitly no scheduling logic); DevExtreme ($900/dev/yr; `validateDependencies`
prompt cancel / delete link / create gap); Kendo, Webix, AnyChart.

### 2.2 Full applications: who has a real engine

| Real engine (forward pass + calendars + constraints) | Push-only (FS propagate) | Draw only |
|---|---|---|
| ProjectLibre (CPAL, Java): MS Project clone, 8 constraints, 4 types, calendars, CPM | OpenProject (GPL-3): per-work-package **manual / automatic** mode (15.4, 2025), FS only, lag in working days, parent roll-up in auto | Leantime (bundled Frappe fork), Vikunja (arrows, no shift; clean SVG arrow router), Nextcloud Deck (Frappe), Tuleap Roadmap (a "timeframe semantic" on the schema), Odoo (dependency = status gate), ZenTao (4 types stored, no cascade), Wekan, Kanboard |
| Calligra Plan 4.0 (GPL-2, C++/Qt6, 2026-01): FS/FF/SS + lag, ASAP/ALAP/MSO/MFO/SNET/FNLT, calendars, pluggable schedulers incl. an embedded TaskJuggler | Redmine (GPL-2): `follows` + delay, forward push | Grist widgets (table is the model, view is an iframe that reads it) |
| TaskJuggler 3.8.4 (GPL-2, Ruby text DSL): effort / duration / length, `gapduration` vs `gaplength`, `onstart`/`onend`, ASAP/ALAP, leveling, scenarios | ERPNext (GPL-3): forward push, never pull, recursive-CTE cycle check | Google Sheets timeline view (2022): no dependencies |
| GanttProject 3.3 (GPL-3, Kotlin): 4 types, ± lag, dependency **hardness** (strong `=` vs rubber `≥`), earliest-begin, continuous rescheduling | APITable/AITable (AGPL-3): the one AGPL data-first app shipping self-link dependencies + working days + auto-push in the open (Konva canvas) | Baserow timeline (paid), Teable (roadmap), NocoDB (Gantt is Business-plan only, May 2026) |
| LibrePlan 1.6.1 (AGPL, Java, alive again 2026): allocation-driven durations, generic allocation by criteria, Monte Carlo on the critical path | Baserow date dependency (maintain gap), Notion (three shift modes), dotpm Obsidian plugin (push, optional pull) | |
| **Huly** (EPL-2.0, TypeScript): `plugins/tracker-resources/src/components/gantt/lib/` — `scheduler.ts`, `critical-path.ts`, `calendar-state.ts`, undo manager, tests; FS/SS/FF/SF + lag pill, per-issue auto vs pinned, BFS push/pull with cycle pre-check, "a primary issue's dates are authoritative, never let a cascade overwrite them", violated relations drawn red-dashed and winning over critical red-solid | | |

No Gantt at all by policy or fact: Taiga ("Gantt is not Agile"), AppFlowy, Focalboard, Twenty,
Budibase, Nextcloud Tables, Kanboard core.

### 2.3 Data-first tools: the converged "Gantt over a table" spec

Airtable's Date Dependencies is the model everyone copied (NocoDB May 2026 is a near copy;
Baserow, Notion, Coda, APITable approximate it):

- Fields: **Start**, **End**, **Duration** (days; edit start → end moves, edit end or duration →
  the other recomputes), **Predecessor or Successor as a self-link column** (the view is told
  which direction the link means), optional **buffer/lag per link**.
- **Milestone** = a record with an end date only, drawn as a diamond.
- Link **type** lives on the link, defaults to FS; SS/FF/SF only in "Fixed" mode. Everyone else
  is FS-only.
- **Shift policy is a table-level enum**, not per task: *None | Flexible (push only when the
  constraint is violated; slack is consumed first) | Fixed (preserve the exact buffer; moving a
  predecessor earlier pulls successors back too)*. Notion: *do not shift | only when dates
  overlap | maintain time between*. Baserow: maintain-gap only.
- **Calendar is a boolean**: "omit weekends and holidays" (Airtable), "avoid weekends" (Notion),
  `onlyCalcWorkDay` (APITable). Only OpenProject and Smartsheet denominate *duration itself* in
  working days.
- Etiquette: duration is preserved when a bar moves; Shift-drag suppresses the cascade; cycles are
  refused at edit time; a manual edit of a driven date **removes the predecessor** (Smartsheet).

Smartsheet is the Excel-refugee benchmark: dependency-enabled sheets lock Start/End/Duration to
the engine (formulas not allowed there), predecessors typed as `3FS +2d, 5SS -1d`, elapsed `e3d`,
parents are read-only duration-weighted roll-ups, critical path in red.

### 2.4 Text specs and what each gets right

| Spec | Scheduling it does | Worth copying |
|---|---|---|
| Mermaid `gantt` (MIT, already in-tree) | forward chaining via `after a b c`, weekend/date `excludes` that *extend* bars; `crit` is a hand tag; no lag (#818 open since 2019), no arrows (#3290 open since 2022), no SS/FF/SF, no hierarchy, no zoom, static SVG | `after a b c` and "start after the previous row" as predecessor sugar; `excludes`; `todayMarker`; `vert` markers |
| PlantUML gantt (GPL, Java) | forward pass with all four anchors (`starts at [A]'s end/start`, `ends at…`), `starts 3 [working] days after`, closed/open days, `pauses on`, resources `{Bob:50%}` + `is off on`, `Print between` | explicit *working* vs *calendar* lag words; re-openable closed days; resource leave as calendar exceptions |
| Markwhen (parser MIT) | `after !id 2 weeks:`, `by !id`, `.start/.end` anchors, "business days" | the compact `!id` back-reference grammar with negative direction |
| TaskJuggler (GPL) | full CPM + leveling; `effort` vs `duration` vs `length`; `gaplength`/`gapduration`; `minstart/maxend` soft warns; `scheduling asap|alap`; scenarios as a column prefix `delayed:start` | the three estimate kinds; soft constraints that warn; a scenario is literally a second Start column |
| org-gantt | outline = WBS, `:ORDERED:` children chain implicitly, effort + hours/day derive dates | the "nested document → schedule" reading |
| pgfgantt / Typst `gantty` | draw only | the minimum *print* spec: rows, groups, milestones, four link types, progress; `link bulge/mid` routing |

### 2.5 Plotting-library Gantts, and Recharts honestly

Every charting library reduces a Gantt to a horizontal range bar (Plotly `px.timeline`,
Vega-Lite `x`/`x2`, Observable Plot `barX`, ECharts `custom` series, matplotlib `broken_barh`,
the Power BI Gantt visual which is MIT and has good data roles but no dependency lines). None
has dependencies, roll-ups, multi-tier headers or drag.

Recharts (in-tree) can draw a *snapshot* Gantt: ranged bars (`dataKey` → `[start, end]`, verified
in the official Ranged Bar example), `layout="vertical"`, numeric `XAxis` in serials, category
`YAxis`, `ReferenceLine` today, `ReferenceArea` weekends, `Bar shape` for diamonds. Where it
breaks: arrows need a `<Customized>` layer reading semi-internal axis maps that changed between
Recharts 2 and 3; no tree/collapse; no drag; no virtualization (hundreds of rows, not
thousands); `Brush` zooms category indices, not time; a second tier is a faked second `XAxis`.
Verdict: fine for a "picture in a Report" of a few hundred rows; not a base. A bespoke SVG layer
on `d3-scale`/`d3-time` costs the same and owns its contract, which is what the one credible
Recharts-Gantt example on GitHub effectively does.

---

## 3. The spec: what "correct" means

### 3.1 Microsoft Project is the de facto standard (with sources)

The sixteen rules a v1 engine must implement to match Project on the common cases. Each is
sourced to Microsoft docs or, where Microsoft is silent, to MPXJ's `MicrosoftScheduler`, which
was engineered against Project's outputs (marked *[MPXJ]*).

1. Time is stored in **minutes**; every task has a working **calendar** = base weekly pattern +
   exceptions + up to five working intervals per weekday.
2. Duration in d/w/mo converts through the project's *Hours per day / Hours per week / Days per
   month* options, **independent of the task's calendar** (a "3d" task on a 24-hour calendar is
   24 h of work). Elapsed units (`ed`, `eh`…) count clock time.
3. A start snaps forward to the next working instant; the finish is reported at the end of the
   last working period (17:00), not the next morning *[MPXJ]*.
4. Unlinked, unconstrained tasks start at the project start.
5. Forward pass per link: FS `ES ≥ pred.EF + lag`; SS `ES ≥ pred.ES + lag`; FF `EF ≥ pred.EF +
   lag`; SF `EF ≥ pred.ES + lag`; multiple predecessors ⇒ max. Lag is measured on the
   **successor's** calendar *[MPXJ; Microsoft does not say]*; elapsed lag on a 24-hour calendar;
   percent lag = percent of the predecessor's duration. Project 2010+ forbids two links between
   one pair.
6. Eight constraints with Microsoft's formulas (ASAP, ALAP, SNET, SNLT, FNET, FNLT, MSO, MFO).
   With *Tasks will always honor their constraint dates* (default on), SNLT/FNLT/MSO/MFO win over
   links and produce **negative slack**; off, the link wins. Typing a date silently applies
   SNET/FNET.
7. Backward pass from LF = project finish (max EF), or from each successor-less task's own EF
   under *Calculate multiple critical paths*; a **deadline** caps LF without moving the task;
   MSO/MFO/SNLT/FNLT cap late dates.
8. **Total slack** = min(LS−ES, LF−EF) in working time on the task's calendar; **free slack** =
   min over successors of (their limit − own EF), equals total slack with no successors, clamped
   at 0, and 0 when complete *[MPXJ]*.
9. **Critical** ⇔ total slack ≤ *CriticalSlackLimit* (default 0) and not 100% complete; MSO/MFO
   and ALAP-in-a-forward-project tasks are critical too.
10. ALAP: ES := LS in a third pass; start slack reported as 0.
11. Milestone ⇔ duration 0 (a non-zero task may be *flagged* one); a started 0-duration milestone
    has LF = actual start *[MPXJ]*.
12. Summary: start = min child start, finish = max child finish, **duration = working time between
    them on the summary's own calendar**, critical if any child is, % complete =
    Σ actual duration / Σ duration; a link or constraint on a summary bounds all its children.
13. Progress: actual start pins ES, actual finish pins EF; remaining duration is what gets
    scheduled; the *status date* options move completed/remaining parts and optionally split
    in-progress tasks.
14. Leveling delay (elapsed units at task level) is added before the forward-pass ES.
15. **Manually scheduled** tasks are never moved, yet still act as predecessors.
16. Task types matter only with resources: Work = Duration × Units, with Project's recalculation
    table (Fixed Units / Fixed Duration / Fixed Work; effort-driven).

Where the tools genuinely disagree (and where the doc must pick, § 10): the lag calendar
(Project successor, P6 configurable with successor as Oracle's stated default, Smartsheet the
sheet's working days); day vs minute granularity (Project/P6 08:00–17:00; Smartsheet, OpenProject,
Redmine and GanttProject work in whole working days where "FS, lag 0" means *the next working
day*); Excel's `NETWORKDAYS` is endpoint-inclusive while `WORKDAY` excludes the start;
critical = total-float threshold vs P6's longest path; whether successors may move *earlier*
(Redmine and pre-15.4 OpenProject push only); percent lag (Project only).

### 3.2 The correctness test list (free, from the industry)

- **MSPDI golden files.** A file exported by Project holds `Start/Finish/EarlyStart/EarlyFinish/
  LateStart/LateFinish/TotalSlack/FreeSlack/Critical` per task *next to* the inputs (calendars,
  links, constraints, deadlines, actuals, options). Strip the computed fields, run the engine,
  diff. MPXJ's `junit/data` holds ~200 such files (`PredecessorCalendar*`, `SuccessorCalendar*`,
  `relations*`, `calendar-exception-precedence*`); MPXJ 14+ can regenerate expected values for
  any input file; a Project trial can author edge cases.
- **Bryntum's 14 scenarios** (published): SS, FF, SF links; FS with lag; MSO resisting dependency
  pressure; SNET as a soft floor; weekend calendar; a resource calendar extending duration; an
  ALAP chain from a deadline; critical path; a conflict/cycle surfaced to the user; an intra-day
  calendar with a lunch break; effort-driven recalculation; an inactive task excluded but
  keeping its position.
- **DHTMLX 10.0 changelog** (~20 fixed edge cases): SS/SF slack, negative lag beyond duration,
  MSO/MFO ping-pong, calendar inheritance across levels.
- **DCMA 14-point assessment** as structural invariants on every corpus file: missing logic,
  leads, lags, relationship-type mix, hard constraints, high/negative float, high duration,
  invalid dates vs status date, the +600-day critical-path test, CPLI, BEI.
- **Layout goldens.** Tier and viewport fixtures for DST switches, ISO-vs-US week 1, leap years,
  month columns proportional to day count, hidden weekend ranges; the DST patches in DHTMLX
  `date.ts`, Syncfusion `timeline.ts` and Frappe `date_utils.diff` are the regression list.
- **Known-bug regression list** (from public trackers): DST off-by-one-hour drift (Frappe #616,
  Bryntum #13336), lag ignoring the calendar (Bryntum #12454), milestone drag anchor under
  working time, parent keeping a duration with zero-duration children, undo restoring the wrong
  duration, one-day bars not drawn, circular links hanging the renderer (DHTMLX #109).

### 3.3 Interchange formats

| Format | Openness | Notes |
|---|---|---|
| **MSPDI** (Project XML, `mspdi_pj15.xsd`) | schema documented element by element on Microsoft Learn (2007 edition); pj15 ships with the SDK; MPXJ uses a corrected copy | `Task{UID, OutlineLevel, OutlineNumber, Duration as PT8H0M0S, DurationFormat codes, ConstraintType 0–7, PredecessorLink{Type 0=FF 1=FS 2=SF 3=SS, LinkLag in tenths of a minute, LagFormat}, Baseline 0..10}`, `Calendars{WeekDays, Exceptions, WorkWeeks}`, `Assignments`; the one format every desktop tool reads and writes |
| `.mpp` | binary OLE; MPXJ is the only open reader | read-only through MPXJ; not a v1 target |
| **Primavera XER** | tab-delimited `%T/%F/%R`; Oracle publishes the data map | `TASK`, `TASKPRED{pred_type PR_FS…, lag_hr_cnt}`, `PROJWBS{parent_wbs_id, seq_num}`, `CALENDAR{clndr_data blob}`; **all durations in hours**; `xer-parser` (npm, MIT, TS, 2.1.0, streaming, calendar utils) |
| P6 PMXML, ProjectLibre `.pod` (Java serialization), Asta, Phoenix, SDEF | MPXJ | not v1 |
| GanttProject `.gan` | XML: nested `task`, `depend{type 1=SS 2=FS 3=FF 4=SF, difference, hardness}` | trivial reader |
| iCalendar | RFC 5545 VTODO + **RFC 9253** (`RELTYPE=FINISHTOSTART…`, `GAP` lag) | the one standards-track link encoding |
| CSV | Smartsheet exports predecessors verbatim in its grammar | the grid cell grammar is the real interchange |

Dependency-type integer coding is a trap: MSPDI 0=FF/1=FS/2=SF/3=SS, DHTMLX 0=FS/1=SS/2=FF/3=SF,
Bryntum 0=SS/1=SF/2=FS/3=FF. Store two-letter strings; map at the codec.

---

## 4. Behavior to match: UX

### 4.1 Auto-shift: the single product-defining choice, and why a pure function dissolves it

Consumer tools converged on a three-way switch: *shift only on conflict* (consume slack: Asana
default, monday Flexible, Notion overlap, Airtable Flexible, DHTMLX default, Hive On), *shift
always keeping the gap* (Asana maintain buffer, monday Strict, Notion maintain, Airtable Fixed,
ClickUp, TeamGantt pref 1, Wrike), *never* (manual). Professional tools (Project, P6, Bryntum,
Smartsheet) instead model the gap **explicitly as lag** and always recompute; "conflict-only" is
the un-modeled case. In a pure-function model the switch disappears: the schedule is *always*
recomputed from the table, and the three consumer modes become three ways an edit is written
back:

| Consumer mode | Table equivalent |
|---|---|
| Fixed / Strict / maintain gap | the gap *is* a lag on the dependency row |
| Flexible / consume slack | a typed start becomes a **SNET** constraint (Project's own behavior) |
| None / manual | `manual = true` on the task row |

No "shift mode" setting is needed on the node; the columns carry it, and the DCMA checks report
how much of the plan is being held by constraints.

### 4.2 Conventions that are effectively mandatory (users assume them)

1. Two panes: a tree grid (name, duration, start, finish, predecessors, % complete) and the
   timeline, sharing row height and vertical scroll, with a draggable splitter.
2. A multi-tier time header (≥2 tiers) with presets (day/week/month/quarter/year) and "fit".
3. A today line; non-working days shaded.
4. Bar grammar: rectangle task, diamond milestone, bracket summary with rolled-up dates,
   progress fill.
5. Orthogonal arrows with the endpoint conventions (FS right→left, SS left→left, FF right→right,
   SF left→right), arrowheads, and a red plus non-color cue on violation.
6. The predecessor cell grammar `<row><type><±lag><unit>`.
7. A critical-path toggle defined as total slack ≤ 0, with `critical` and `totalSlack` as data.
8. Working-day durations and lags with an elapsed escape hatch (`e` prefix).
9. A visible statement of the successor rule and the lag calendar.
10. Cycle detection that refuses or flags, never hangs.
11. Undo of any date edit.
12. A baseline ghost bar.
13. Row virtualization in the low thousands; timeline virtualization for multi-year day spans.
14. An ARIA treegrid grid; WCAG 1.4.1 (color is not the only cue for critical/conflict);
    `prefers-reduced-motion` on cascades and smooth zoom.

Nice-to-have: status-date progress line, slack visualization, deadline/constraint icons, labels
outside bars with ellipsis, resource histogram, split and inactive tasks, ISO vs US week
numbering and fiscal tiers, infinite scroll, multiple baselines with variance columns, PDF
fit-to-width, cascade preview while dragging, multi-select move, ALAP/backward, multiple
critical paths, versions.

Controversial (the author decides): successors on conflict vs always (moot here, § 4.1); a drag
silently adding a constraint (Project, DHTMLX) vs switching the task to manual (OmniPlan) vs
overwriting and dropping the link (Smartsheet); the lag calendar; total float vs longest path;
completed tasks as critical; automatic conflict resolution vs a violations list (OmniPlan's
Violations window with clickable fixes is the best of these); bar editing at all.

### 4.3 Rendering and performance facts from the vendors

DHTMLX, Syncfusion and Bryntum all render **DOM bars + SVG links** and virtualize rows (DHTMLX
slows at 10–20k tasks; Syncfusion renders ~50 DOM rows for 10k tasks and ~3× the viewport of
timeline; Bryntum claims 10k+ and has public scroll regressions). Highcharts is pure SVG with no
row virtualization. VTable is canvas. The ECharts guidance is canvas above ~1,000 *visible*
elements, SVG for crisp zoom and memory; a published 10k-task SVG implementation reached 55–60
fps with object pooling and a 5-row virtual buffer. Arrow geometry is rebuilt only when
dependencies, row order or scale change. Keyboard-only bar drag exists in no vendor (Bryntum has
it as an open request); keyboard link creation exists only through the predecessor cell.

### 4.4 What "no bar editing, edit in the table" loses

Lost: dependency drawing by drag (the most common link gesture in every consumer Gantt; the
predecessor cell covers the function, not the discoverability), direct manipulation with
snapping and live cascade feedback (the grid gives the result after commit, which matches the
Enter/blur rule), resize-as-duration and progress-grip (minor, both are one cell), multi-select
move preserving spacing, split-task segment dragging. **Nothing is lost on correctness**: every
product documents that a bar drag is a date edit plus an implied constraint or predecessor
removal, i.e. the same fields the grid exposes. The minimal set if the rule is relaxed, in order
of value: (1) drag a bar-end handle onto another bar → FS (SS/FF by which ends), lag 0, cycle
refused; (2) drag the bar to move start, snapped, Esc cancels, commit on drop; (3) drag the right
edge for duration; (4) click a line to select, Delete or edit lag; (5) optional progress grip and
Shift-drag without dependents.

---

## 5. Standouts by layer, and what can be taken from each

| Layer | Standout | License | Take |
|---|---|---|---|
| Engine spec | Microsoft Project | docs | the 16 rules; option names (`HonorConstraints`, `CriticalSlackLimit`, `MultipleCriticalPaths`, `MinutesPerDay`) |
| Engine oracle | MPXJ `MicrosoftScheduler` + `MicrosoftSlackCalculator` (16.7.0, Java) | LGPL-2.1 | run as a **test oracle** in CI (Python/JPype or Java), never vendored; its `junit/data` corpus |
| Engine design | Huly `gantt/lib` (TS) | EPL-2.0 | read only: pure functions over plain records, calendar injected, "primary edit authoritative", violated vs critical precedence, tests |
| Engine design | Bryntum engine / ChronoGraph | commercial / MIT | read only: `direction`, `dependenciesCalendar`, conflict resolution surface, the 14 scenarios |
| Engine, small | `@korastd/critical-path-method` (imlargo/cpm, 0.1.0, 2026-08) | MIT | may vendor: 4 types, min/max lags, injectable calendar, free/total float, cycles; too new to depend on |
| Engine, second opinion | ProjectLibre `CriticalPath.java`; Calligra Plan `kptrelation.h`/`kptnode.h`; GanttProject `SchedulerImpl` | CPAL / GPL / GPL | read only: ALAP third pass, honor-required-dates, hardness bit |
| Text model | TaskJuggler manual | GPL (docs) | vocabulary only |
| Layout: scale/ticks | **DHTMLX v10** `src/core/ui/timeline/scale_manager/{scale_manager,size_distribution}.ts` (normalize tiers coarsest-first, `ScaleLayout{trace_x, left[], width[], ignore_x}`, month columns proportional to days, upper tiers snapped to the primary tier's pixels, `posFromDate`/`dateFromPos` by binary search); SVAR `store/src/scales.ts` (`resetScales`, `normalizeZoom`, `zoomScale`); `d3-time` `src/ticks.js` interval table; vis-timeline `TimeStep`/`Stack` | MIT / MIT / ISC / MIT-or-Apache | **vendor** the DHTMLX scale manager as the tier engine (port to serial-day math), `d3-time` for tick selection, vis-timeline's stacking for multi-item rows |
| Layout: arrows | **DHTMLX** `src/core/ui/render/link_render.js` `path_builder.get_points` (orthogonal point lists for SS/FS/FF/SF incl. backward loops and milestone endpoints; keep the geometry, drop the div drawer); SVAR `links.ts#getLineCoords` (6-point polyline + bounding box for culling); IBM `constraintgraph/constraintlayout.js` (connector slots per side, side switching to reduce crossings); Highcharts `PathfinderAlgorithms.ts` (`fastAvoid`); Vikunja arrows | MIT / MIT / Apache-2.0 / proprietary / AGPL | vendor DHTMLX + SVAR geometry; copy IBM's slot idea; study `fastAvoid` only |
| Layout: culling | DHTMLX `render_factory.js`, `viewport/{get_visible_bars_range,is_bar_in_viewport,is_link_in_viewport}.js`, `row_position_fixed_height.js`; `@gantt-chart/core` `LayoutResult` shape; TanStack `virtual-core` range math | MIT | vendor the culling protocol (row band first, then x ± padding) and the result shape |
| Gestures | `@xyflow/system` `XYDrag`/`XYPanZoom` (already a Solenoid dependency); `dnd-timeline` hooks; `@wamra/gantt-task-react` typed links + holiday rounding; Frappe `move_dependencies` + `ignore` periods | MIT | vendor selectively |
| Store / derivation | SVAR `DataStore.ts` `DataRouter` (declarative `{in, out, exec}` rules over state keys); ChronoGraph `Transaction`/`Effect`/`CycleResolver` (ProposedOrPrevious, commit/reject, the start/end/duration cycle table) | MIT / MIT | copy the ideas into a small purpose-built incremental scheduler; do not build on ChronoGraph (frozen 2021, generator-effect style, the Gantt logic on top is closed) |
| Dates / DST | DHTMLX `src/core/common/date.ts` and `_correct_dst_change`; Syncfusion `date-processor.ts`; Frappe `date_utils.js` | MIT / study / MIT | use as the checklist of everything the engine avoids by never touching `Date` |
| Grid a11y | Syncfusion's ARIA role map + shortcut map; DHTMLX `src/core/ui/wai_aria.js` (the concrete role set) and keyboard scopes; W3C APG treegrid | docs / MIT | copy the maps |
| Conflict UX | OmniPlan Violations window; Bryntum popup (remove / deactivate / cancel); Syncfusion `respectLink / removeLink / preserveLinkWithEditing` | docs | copy the vocabulary |
| Interchange | MPXJ (formats), `xer-parser` (MIT TS), `@svar-ui/lib-mspx` (MIT MSPX↔SVAR), RFC 9253 | LGPL / MIT / MIT / std | `xer-parser` may be a dependency; write the MSPDI codec against Microsoft's schema pages |
| Data-first spec | Airtable Date Dependencies; Smartsheet grammar; NocoDB Gantt settings | docs | the column set and the predecessor grammar |
| Renderer to embed if one were embedded | SVAR React Gantt (MIT) or DHTMLX Community ≥10 (MIT) | MIT | rejected as the base (§ 7.2) but the fallback if the author wants a Gantt on screen before the toolkit's renderer exists |

---

## 6. The Solenoid fit

### 6.1 A plan is tables (and one Cube)

The canonical model is **relational and flat**, exactly as P6's XER and MSPDI are underneath:

**Tasks** (input columns): `id` (any scalar; users will use row numbers like Smartsheet), `name`,
`parent_id` (null = root), `order`, `duration` (working days; 0 = milestone; blank = derive),
`duration_unit` (`d` default; `h`, `w`; `e`-prefix = elapsed), `start`, `finish` (both given and no
predecessors ⇒ manual; one given ⇒ acts as SNET/FNET), `manual`, `constraint` (`ASAP|ALAP|SNET|
SNLT|FNET|FNLT|MSO|MFO`), `constraint_date`, `deadline`, `calendar_id`, `pct_complete`,
`actual_start`, `actual_finish`, `active`, `priority`, plus pass-through presentation columns
(`color`, `group`, `resource_names`, `notes`, `url`).
**Tasks** (computed, appended, never overwriting inputs): `level`, `wbs` ("1.2.3"), `is_summary`,
`es`, `ef`, `ls`, `lf`, `start_sched`, `finish_sched`, `duration_days`, `total_float`,
`free_float`, `critical`, `driving_pred_id`, `late` (finish past deadline), `status`, and a
per-cell **error** where a row is in a cycle, names an unknown predecessor, or has a constraint
conflict. Solenoid's per-cell `SolError` is the error channel MSPDI never had.
**Dependencies**: `pred_id`, `succ_id`, `type` (FS default), `lag` (working days on the
successor's calendar; negative = lead), `lag_unit` (`d`, `h`, `ed`, `eh`, `%`), `active`;
computed `driving`, `error`.
**Calendars**: `id`, `name`, `base_id`, `hours_per_day` (8), `working_week` (a 7-char mask, the
`WORKDAY.INTL` idea users already know), optional `day_hours`.
**Calendar exceptions**: `calendar_id`, `date_from`, `date_to`, `working` (a holiday is
`false`; PlantUML's "is open" is `true`), `name`. Resource leave is an exception row on the
resource's calendar.
Optional: **Resources** (`id`, `name`, `type`, `max_units`, `calendar_id`, `rate`), **Assignments**
(`task_id`, `resource_id`, `units`; computed `work`, `overallocated`), **Baselines** (`task_id`,
`baseline_no` 0–10, `start`, `finish`, `duration`, `work`, `cost`, `saved_on`).
Options on the node: `project_start`, `project_finish`, `direction`, `status_date`,
`critical_float_threshold`, `finish_inclusive` (exclusive internally, inclusive for display, the
Smartsheet/Excel convention), `hours_per_day`, `lag_calendar`.

**Where the Cube fits (three places, all of them natural):**

1. **Predecessors as a list cell.** A tasks Cube whose `Predecessors` column holds a list per row
   is the compact one-table form of the two-frame model; the engine accepts either and
   normalizes (a list cell of `"3FS+2d"` strings, or of plain names meaning FS/0). This is the
   author's own ruling against in-cell string lists applied to the shape TaskNotes and Obsidian
   plugins already emit.
2. **The nested WBS as a derived output.** `parent_id` is the *input* hierarchy because it is the
   only representation that survives Filter/Sort/Join/Append and keeps cross-subtree
   dependencies as plain id pairs; CPM float crosses subtrees, so the engine needs the flat DAG.
   The Cube form (a parent row holding its children as a nested frame) is what the figure's
   collapsible rows and a Report's outline want, produced by the existing Nest verb over the
   scheduled frame. Every nested-format library (Bryntum, SVAR, TaskJuggler) flattens before
   scheduling and nests only for the UI or the file.
3. **A portfolio is a Cube of projects.** One row per project, each cell a tasks frame; mapping
   Schedule over the rows (by-row composite run mode) schedules independent projects with no
   special hierarchy support at all. Cross-project links need the flat form.

Indent levels and `"1.2.3"` WBS strings are accepted at the boundary (Frame Input, CSV, MSPDI)
and converted to `parent_id` + `order` in one pass; `wbs` is a display string, never a key.

### 6.2 The node family (a **Plan** submenu)

| Node | In | Out | Notes |
|---|---|---|---|
| **Schedule** | tasks (frame or cube), dependencies (frame, optional if the tasks carry a Predecessors column), calendar (value or defaults), start date, options | the tasks frame with computed columns appended; `dependencies` with `driving`; `finish` (date); `diagnostics` (a frame of violations, DCMA-style, one row per finding) | the engine verb; eager JS, oracle-pinned; a Polars twin only if a real workload forces it (§ 7.4) |
| **Predecessors** | a tasks frame with a text column in Smartsheet/Syncfusion grammar (`3FS+2d, 5SS`), or Mermaid's `after a b` | a Dependencies frame | and the inverse: dependencies → a text column, for Smartsheet/Excel export |
| **Work Calendar** | working-week mask, hours per day, a Holidays date list (the existing Holidays node feeds it), exceptions frame | a calendar value | the value type reused by WORKDAY/NETWORKDAYS |
| **Baseline** | a scheduled frame | the same frame stamped `saved_on`; `variance` when joined back | a baseline is a snapshot; scenarios are a second tasks frame through the same Schedule |
| **Schedule Check** | a scheduled frame + dependencies | the 14 DCMA checks as a frame (check, count, share, threshold, pass) | free from the corpus work; a genuine "is my plan sane" answer spreadsheet users never had |
| **Gantt** (figure) | the scheduled frame (or the nested cube), optional baseline frame, `options` string | a `chart` value of kind `gantt` | § 6.3 |
| **Import Project** / **Write Project** | file (MSPDI, XER, `.gan`, CSV) | tasks + dependencies + calendars frames / a file | codecs live in the scheduling repo |
| Later: **Assign**, **Level**, **Earned Value** | resources, assignments, baseline, status date | work, over-allocation, leveled dates, BCWS/BCWP/ACWP/SPI/CPI/EAC | § 8 phase 6 |

### 6.3 The figure

A `chart`-socket value (`kind: "gantt"`) rendered by `gantt-react` as **SVG inside DOM**: HTML for
the tree grid and labels, one SVG per virtualized row band (or one SVG with a translated group
per visible row) for bars, diamonds, brackets and progress, one overlay SVG for dependency
paths above the bars with `pointer-events` on a wide invisible hit-polyline (the SVAR/Bryntum/
Syncfusion hybrid, minus DHTMLX's div-drawn arrows). The layout emits a plain-number
`RenderFrame`; the same frame serialized headlessly is the Report embed and the PDF/PNG export,
so there is no second renderer (Syncfusion's `pdf-*` modules and Bryntum's puppeteer export
server are the cost of not doing this). Card view (wide card, `nodeWide`), expand popup and
Report embed all read one payload. The grid half is a real ARIA treegrid; the timeline half virtualizes
rows and the time axis. Options ride the existing `options` string / Chart Builder path with
matplotlib-style keys: `zoom` (day/week/month/quarter/year), `tiers`, `critical`, `baseline`,
`arrows`, `today`, `status_date`, `weekends`, `group_by`, `labels`, `week` (iso/us), `fiscal_start`.
Colors follow DESIGN.md: critical and violated bars carry a pattern or icon as well as a color
(WCAG 1.4.1); non-working shading is the neutral ramp; the accent stays on op pickers.

### 6.4 Interaction, and the "no bar editing" ruling

The figure is a pure view; nothing it does is state. If the author keeps the ruling, the grid
half still edits the *source* literal exactly like the frame popup does (the row is a Frame or
Cube Input row; Enter/blur commits; the engine reruns). If the author relaxes it, the minimal set
from § 4.4 applies with one rule copied from every professional tool: **a bar gesture is a table
edit** (drag start = write `start` and, per Project, set `constraint = SNET`; draw a link = append
a Dependencies row; resize = write `duration`), committed on drop, undoable through the existing
snapshot undo. The figure never re-schedules locally; it shows the engine's result after the
commit, which is what the Enter/blur rule already promises everywhere else.

### 6.5 Dates, units, precision

Solenoid dates are Excel serials with a fractional day, which are already zone-less local
days: exactly the representation a scheduling engine should compute in. The engine works in
**serial day + minute-of-day integers** against a calendar (rule 1), so MSPDI parity holds and
hour durations work, and it never touches `Date`; that alone removes the DST patch class every
surveyed library carries. Temporal (TC39 Stage 4, March 2026; Chrome/Edge 144 and Firefox 139
ship it, Safari still incomplete in August 2026, so the web build would need the ~20 kB
`temporal-polyfill`) is only needed at the I/O boundary in `project-io` for ISO date-times,
and can wait. Two
presentation conventions are exposed as options rather than baked in: *finish inclusive*
(Smartsheet and every Excel template show the last working day; Project shows 17:00 of it;
internally the finish is exclusive) and *day precision* (whole-day snapping, "FS lag 0 = next
working day", the Smartsheet/OpenProject reading that spreadsheet users expect). Durations
carry the day unit through the FC like any other unit. DST does not exist inside the engine:
serials are naive wall-clock days, as Project's own file format is.

---

## 7. The decision: a separate repo

### 7.1 Why not embed SVAR or DHTMLX Community

Both are honest, maintained, MIT renderers, and both fail the same three tests: their free tier
computes nothing (scheduling, calendars, critical path, undo are PRO, and the seam moves with
each release); they own their DOM, CSS and state (imperative singleton in DHTMLX, a private
store web in SVAR), so a table-driven, Report-embeddable, theme-following figure fights them
rather than uses them; and their exports route through vendor cloud services. Embedding one
would buy a picture, not the product, and the product is the engine. The same applies to
VTable (canvas, no ARIA) and Frappe (no grid, no hierarchy, no types).

### 7.2 Why not fork a mid-tier repo and grow it

`@wamra/gantt-task-react`, `@jaeungkim/gantt-chart`, `@art-tools/react-gantt` and
`@bluemillstudio/gantt` each have one right idea (typed links; a controlled `tasks` prop; undo
transactions and calendars; CPM) and each is a single-author React component with the engine and
the view in one tree. Growing any of them into a corpus-pinned engine means rewriting the part
that matters and inheriting the part that doesn't. Their ideas are taken (§ 5); their trees are
not.

### 7.3 Why separate, and why headless

- **The gap is real and reusable.** Nothing permissive computes schedules correctly or lays out a
  Gantt without a DOM. A toolkit that does both is useful to every one of the 2025–26
  micro-libraries' authors and to the data-first apps that keep re-implementing Airtable's
  model. That audience is the maintenance model.
- **The correctness work is app-independent.** The MSPDI corpus, the MPXJ oracle, the DCMA
  invariants and the vendor edge-case lists are tests of an engine, not of a canvas. They belong
  beside the engine.
- **Licensing forces a clean room anyway.** The code worth reading is GPL, CPAL, EPL or
  commercial; nothing can be copied into an MIT tree. A separate repo with its own contributor
  boundary keeps that discipline visible.
- **The headless split is the proven shape.** TanStack Table and Virtual (a 2,183-line
  `virtual-core` under a 279-line React adapter), xyflow (`@xyflow/system` holds the drag and
  pan/zoom machines and the edge geometry under `@xyflow/react`, which Solenoid already uses),
  Floating UI (`core` → `dom` → `react-dom`), CodeMirror 6 and ProseMirror (immutable state +
  transactions, the view a separate package), ELK and dagre (pure layout), `d3-time` (pure
  ticks). Bryntum's engine-versus-view split is the same idea inside one commercial product, and
  the libraries that fused engine and view (Syncfusion's 6,636-line `gantt.ts`, Frappe's
  `index.js`, gantt-task-react's `bar-helper` with twelve color parameters) are the ones that
  became untestable.
- **Parity is a corpus, not a port.** Automerge's `interop/exemplar`, DuckDB's `sqllogictest`
  and Yjs's golden files are language-neutral fixtures every implementation runs; nodejs-polars'
  separate suites are the documented anti-pattern. Solenoid's `oneVerbCorpus` is already this
  shape.
- **Solenoid's own rules already say so.** One definition per verb, frames as pure data, figures
  as values on the `chart` socket, no code in the graph: the engine as a library that takes and
  returns tables is the shape those rules describe.

### 7.4 Package boundaries and how Solenoid consumes them

```
scheduling repo (MIT, TypeScript; pnpm workspaces + turbo, tsup or Vite lib mode, changesets,
vitest, Playwright, publint + arethetypeswrong + size-limit per package)
├─ schedule-engine   pure TS, zero DOM, zero Date
│    calendars/      weekly template + exceptions, inheritance project→resource→task, the lag
│                    calendar; serial-day + minute arithmetic; duration ↔ working-time conversion
│    graph/          task tree + dependency DAG, cycle detection, topological order, dirty-set
│                    incremental recompute (DHTMLX 10.0.3: cost scales with tasks that moved)
│    cpm/            forward/backward passes, slack, critical set, constraints, ASAP/ALAP,
│                    direction, roll-ups, actuals/status date, diagnostics
│    transaction/    propose → validate → commit/reject with a conflict report
│    fixtures        JSON scenarios (inputs + expected ES/EF/LS/LF/slack/critical), the MSPDI
│                    corpus, DCMA invariants, fast-check properties, the MPXJ oracle run in CI
├─ gantt-layout      pure TS: time-scale (vendored DHTMLX scale manager + d3-time), rows and
│                    stacking, bars, links, viewport culling → RenderFrame {rows, cells, bars,
│                    paths, headers} of plain numbers and strings; golden-JSON tests
├─ gantt-dom         framework-free drag / resize / link-create / pan-zoom machines with callbacks
│                    (the @xyflow/system pattern); no React import
├─ gantt-react       React 19 adapter: hooks + SVG/HTML components, ARIA treegrid, CSS custom
│                    properties (--gantt-*), slots for bar and cell renderers; Playwright goldens
└─ project-io        MSPDI read/write (Microsoft's schema pages), XER read (xer-parser), .gan read,
                     predecessor grammar, Smartsheet/Asana CSV; round-trip fixtures
```

Solenoid depends on the five packages. `nodes/plan.ts` binds Frames/Cubes to the engine's column
arrays and back (dates stay serials, units ride the FC); `chartValue.ts` gains `kind: "gantt"`;
the figure component wraps `gantt-react`. A Rust twin of `schedule-engine` behind
`FrameBackend` is *not* part of the plan: the engine is an eager verb over a materialized frame
(like Decision Matrix), so `oneVerbCorpus` does not apply; if a desktop workload ever forces it,
the same corpus pins the twin. The engine's calendar module is integer arithmetic on serials and minutes and never
touches `Date` (§ 6.5).

---

## 8. The plan (phases, no effort estimates)

0. **Corpus first.** Collect MSPDI golden files (MPXJ `junit/data`, Microsoft sample templates,
   hand-authored edge cases exported from a Project trial covering every one of the 16 rules and
   Bryntum's 14 scenarios); a script that strips computed fields and diffs; an MPXJ oracle run
   (Python `mpxj` via JPype) that regenerates expected values so disagreements are visible as
   Project-vs-MPXJ-vs-ours; DCMA invariants as a second layer. This is the acceptance test for
   everything after it.
1. **`schedule-engine` v1.** Rules 1–15 without resources: four link types; lag in d/h/%/elapsed on
   the successor calendar; eight constraints with *honor constraints*; calendars with exceptions
   and intra-day intervals; milestones; summary roll-up on the summary calendar; deadlines;
   actuals and status date; manual tasks; multiple critical paths; total and free slack; ALAP
   third pass and backward (finish-date) scheduling; diagnostics as per-row errors and a
   findings table; the predecessor grammar; the day-precision and finish-inclusive presentation
   options. Property tests (forward ≤ backward, float ≥ 0 without constraints, summary bounds
   children, a cycle always names a member).
2. **`gantt-layout` + `gantt-react`, read-mostly.** Vendor and port the DHTMLX scale manager,
   the DHTMLX/SVAR link geometry and the culling protocol; tiers and zoom presets; virtualized rows and
   time axis; bars, diamonds, brackets, progress, baseline ghost, split segments; orthogonal
   arrows with the endpoint conventions; today and status-date lines; non-working shading;
   labels with ellipsis; critical and violated styling with non-color cues; the ARIA treegrid
   grid half with the Syncfusion/DHTMLX keyboard map; SVG/PNG export; reduced motion. Golden
   SVG tests and Playwright screenshots.
3. **Solenoid integration.** The Plan node family (§ 6.2), `kind: "gantt"`, the options keys,
   Report embed, the wide card and popup, three seeds (a remodel with a diamond and a holiday; a
   two-project portfolio Cube; a Smartsheet CSV import), catalog copy in the § 7 voice, docs
   reconciled (`node-coverage.md`, `subsystem-invariants.md` if a mechanism lands,
   `socket-reference.md` only if a socket variant is added).
4. **`project-io`.** MSPDI read and write with round-trip fixtures; XER read; `.gan` read;
   Smartsheet and Asana CSV; Import Project / Write Project nodes; the Predecessors node's inverse.
5. **`gantt-dom` + interaction (gated on the author's bar-editing call).** Link drawing, drag with snapping and
   cascade preview, resize, line selection with a lag inspector, Shift-drag; all as source-literal
   edits committed on drop; keyboard equivalents through the grid; snapshot undo.
6. **Resources and the rest of Project.** Resources, assignments, Work = Duration × Units with
   the recalculation table, effort-driven, resource histogram, a priority-rule leveler (never an
   optimizer; OR-Tools CP-SAT stays a reference), earned value (BCWS/BCWP/ACWP, SPI/CPI/EAC/VAC/
   TCPI), eleven baselines with variance, versions, inactive tasks, recurring tasks, task
   calendars ignoring resource calendars, P6 float-path and longest-path options.

Throughout: no GPL/EPL/commercial code enters the tree; the source list in each package's README
records what was studied.

---

## 9. What stands in the tree today (one line)

`develop` carries a Schedule verb (FS-only CPM over a tasks cube, working days, holidays, float,
critical, a Mermaid `gantt` string) and no figure; this bundle supersedes it rather than extends
it, and its seeds and tests migrate to the Plan family in phase 3.

## 10. Author calls

1. **The separate repo**: name, ownership, whether it is public from day one.
2. **Day precision as the Solenoid default** (Smartsheet reading: whole working days, FS lag 0 =
   next working day) with minute precision as the option, or Project's 08:00–17:00 default.
   Recommend day precision.
3. **Finish inclusive by default** (Excel/Smartsheet convention). Recommend yes.
4. **Hierarchy input**: `parent_id` as canonical with indent/WBS-string acceptance at the
   boundary, nested Cube as output only. Recommend as stated.
5. **Lag calendar**: successor (Project, P6 default). Recommend successor, with `lag_calendar` as
   an option later.
6. **Critical definition**: total float ≤ 0 (Project/Smartsheet); longest path as a later option.
7. **Bar editing**: keep the ruling (read-only figure, grid edits the source) or allow the § 4.4
   minimal set. The bundle's default is to keep it for phases 1–4 and decide at phase 5.
8. **v1 formats**: MSPDI both ways, XER read, `.gan` read, CSV grammar. Recommend as stated.
9. **Whether a Recharts snapshot Gantt ships as an interim figure** before `gantt-react` exists.
   Recommend no: it would be a second figure to delete.
10. **Node names** under Plan: Schedule, Predecessors, Work Calendar, Baseline, Schedule Check,
    Gantt, Import Project, Write Project.

## 11. Sources (compact)

Microsoft: support.microsoft.com "How Project schedules tasks behind the scenes", "Link tasks",
"Add lead or lag time", "Set a task constraint", "Show the critical path", "Show slack", the
Total/Free Slack, Type, Percent Complete, Milestone, Task Mode, Priority, Leveling Delay,
Baseline and EV field pages; learn.microsoft.com "Definition of Project constraints",
"Tasks aren't scheduled as expected" (KB 175457), the MSPDI schema pages (Project, Tasks,
Calendars, Assignments, PredecessorLink, ConstraintType, DurationFormat, LagFormat), the
summary-tasks blog; Eastwood Harris "MSP Duration in Days Calculation" (PDF); MPUG calculation
options and EV fields; Ten Six on elapsed lag and multiple critical paths. Oracle P6 client help
(activity types, schedule options General and Advanced tabs, define critical activities, XER
data map PDF, SDEF guide); Ten Six on P6 multi-calendar float. Ron Winter "DCMA 14-Point
Assessment" (PDF); Deltek and ScheduleReader DCMA pages. RFC 5545, RFC 9253. Smartsheet help
765727/765737/765753/765755/1979152/765675; Airtable 9146034701, 1295490370, working with
records; Notion tasks-and-dependencies, timelines; Asana forum 215172/767416/1027897/885797;
monday 360007402599/360015643840; ClickUp 6304547785367/6310440099479/34358881283863; TeamGantt
8/48; Wrike 209604229/1500005126941; Hive 5408023/1048382/3341605/5124782; OmniPlan 4.2.2 manual
(task inspector, resolving violations, Gantt view); Merlin Project reference; Jira Plans
sequential/concurrent and auto-schedule; Google Sheets timeline (docs 12935277, Workspace
Updates 2022-11); Excel WORKDAY.INTL / NETWORKDAYS pages; Peltier and Vertex42 Gantt templates.
Libraries: GitHub and npm registry pages plus LICENSE files for frappe/gantt, DHTMLX/gantt,
svar-widgets/react-gantt and gantt, MaTeMaTuK and wamra gantt-task-react, jsGanttImproved,
visjs/vis-timeline, javdome/timeline-arrows, namespace-ee/react-calendar-timeline,
VisActor/VTable, xpyjs/gantt, ANovokmet/svelte-gantt, Xeyos88/HyVueGantt, robicch/jQueryGantt,
IBM/gantt-chart, neuronetio/gantt-schedule-timeline-calendar (LICENSE, #298), karolkozer/planby,
samuelarbibe/dnd-timeline, itisaram-personal/react-gantt-chart, haydenbleasel/kibo,
apexcharts/apexgantt, bryntum/chronograph and support issues, microsoft/powerbi-visuals-gantt,
recharts (Ranged Bar example, #753, #813), rudrodip/recharts-gantt-chart, echarts #19579,
observablehq/plot #457, mermaid #552/#818/#3290/#3793; bundlephobia. Vendor docs: bryntum.com
(product, store, changelog, examples, engine typedoc, correctness benchmark blog),
docs.dhtmlx.com (editions comparison, auto-scheduling, critical path, working time, baselines,
export, keyboard, accessibility, performance, 10.0 blog and whatsnew), ej2.syncfusion.com
(scheduling, dependency, critical path, timeline, virtual scroll, baseline, resource view,
undo/redo, PDF, accessibility), highcharts.com (Gantt docs, pathfinder, shop), devexpress
(Gantt validation API, pricing), telerik (Kendo Gantt, pricing), svar.dev (pricing, docs),
webix, anychart. Engines and formats: mpxj.org (supported formats, CPM how-to, changelog),
MPXJ `src/main/java/org/mpxj/cpm/*.java` and `junit/data`; ProjectLibre SourceForge and
`CriticalPath.java`; bardsoftware/ganttproject `SchedulerImpl` and scheduler docs;
opf/openproject 15.4 scheduling blog and docs; redmine `issue_relation.rb`; hcengineering/platform
gantt lib; KDE/calligraplan `kptrelation.h`; LibrePlan libreplan.dev; taskjuggler.org manual;
imlargo/cpm; HassanEmam/cpm.js; crates.io cpm-rs, workdays, bdays; google/or-tools rcpsp_sat.py;
Timefold quickstarts; PSPLIB; npm xer-parser; PyPI xerparser; Plan Academy XER; source trees
read directly: DHTMLX/gantt (whatsnew.md, AGENTS.md, src/core/ui/timeline/scale_manager,
src/core/ui/render, src/core/worktime, src/core/common/date.ts, wai_aria.js), svar-widgets/gantt
and react-gantt (store/src, react-gantt/src/components/chart), frappe/gantt, bryntum/chronograph,
MaTeMaTuK/gantt-task-react, visjs/vis-timeline, namespace-ee/react-calendar-timeline,
highcharts (ts/Gantt/PathfinderAlgorithms.ts, TreeGridAxis.ts), syncfusion ej2 controls/gantt,
IBM/gantt-chart, xyflow/xyflow (packages/system), TanStack/virtual and table, floating-ui,
d3/d3-time, codemirror/state, automerge/automerge; npm and bundlephobia metadata for each;
Bryntum engine typedoc and Temporal blog; TC39 Temporal status (Chrome 144 / Firefox 139 /
Safari), temporal-polyfill, @date-fns/tz; prosemirror.net and codemirror.net guides;
automerge.org, duckdb sqllogictest, reearth/ygo, nodejs-polars #30; MDN devicePixelRatio and
canvas hit regions; plantuml.com
gantt; mark-when/parser and docs; typst gantty/timeliney; CTAN pgfgantt; W3C APG treegrid; WCAG
1.4.1 and 2.3.3; ECharts canvas-vs-SVG guide.
