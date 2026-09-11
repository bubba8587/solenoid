# 25 — Gantt and project scheduling: the landscape, the spec, the plan

> **STATUS: BUILT 2026-09-12 (phases 0–4 of § 8; the twelve § 10 calls taken as recommended).**
> § 9 is the landed ledger and names what is not built; the rest stays live as the engine and
> figure spec (§ 3 the correctness bar, § 4.1 the one rule, § 6 the contracts, § 12 the scope).
> What stands in code is recorded in `../node-coverage.md` § Schedule / § Gantt. Originally the
> research bundle for `../2.0-plan.md` Arc 8 (PROPOSAL 2026-09-07, revised the same day after two
> adversarial reviews and a user-pain sweep; § 13 records what changed).
> Written from the outside in: what the best software in this space does, what a correct engine
> and figure must compute, what real users complain about and refuse to give up, and how that
> maps onto Solenoid's basics (typed nodes, Frames, the nested Cube). Every recommendation is
> the bundle's default until the author rules (§ 10 lists the calls). Effort is deliberately
> not a criterion anywhere in this document (author's direction).

Nine passes fed this: six research passes (embeddable libraries; scheduling semantics, engines
and formats; open-source and data-first applications; commercial benchmarks and UX; text and
plotting approaches; library internals and headless precedents), a sweep of ~95 user threads,
reviews and issue trackers, and two red-team reviews of the first draft (product fit against
Solenoid's own rules; engineering claims verified against live sources and clones). Facts below
were verified on live pages on 2026-09-07 unless marked *[unverified]*; § 14 is the source list.

---

## 0. The verdict in one page

**There is no standout permissive repo to adopt as a whole.** The entire market, open and
commercial, puts its seam in the same place: the renderer is free, and *anything that computes
dates* (auto-scheduling, constraints, calendars, critical path, undo) is the paid or copyleft
part. DHTMLX Community (MIT since 10.0), SVAR (MIT), Frappe (MIT), VTable-Gantt (MIT) are
renderers with drag handlers. The only open engines with real semantics are Java, C++ or Ruby
desktop code under CPAL/GPL (ProjectLibre, Calligra Plan, TaskJuggler, GanttProject), MPXJ
(LGPL, Java) and one TypeScript core inside Huly (EPL-2.0). No maintained permissive package
computes Gantt geometry and arrow routing without owning the DOM either.

**The standout to MATCH is not a repo but a spec: Microsoft Project's scheduling semantics.**
Everything else half-remembers Project's vocabulary (FS/SS/FF/SF, lag, float, "start no earlier
than"). The test material is free: a Project-authored MSPDI file stores the computed dates beside
the inputs, so it is a golden test; MPXJ's `MicrosoftScheduler` is an open *second opinion*
(self-declared "not guaranteed" to match Project, validated privately) with a ready-made
comparator; Bryntum publishes a 14-scenario correctness suite; DCMA's 14 checks are a
plan-quality test list.

**What users actually want is narrower and sharper than any feature list** (§ 11). The
top complaint everywhere is *dates that move when I didn't ask, or don't when I did*, caused by
hidden state: a constraint silently attached because someone typed a date, a per-task "manual"
mode, a project-wide shift toggle. The keepers are: everything downstream follows a change,
predecessors typed in the grid, a gap that is kept in both directions, an anchor that *flags*
instead of moving, weekends and holidays honored by the math and the drawing, milestones, a
today line, a baseline ghost, and a chart that prints. The things that look important but go
unused are resource leveling, exotic link types, and critical-path highlighting outside the PMO.

**Recommendation.** Build it as a **pure function of a tasks Cube** (the author's ruled shape:
one row per task, Predecessors a list cell or a nested Task · Type · Lag table, hierarchy by
nesting) plus a **read-only Gantt figure** on the `chart` socket, with the engine, the headless
layout, the React view and the codecs as **separately publishable packages inside this repo**
(npm workspaces under `packages/`, own LICENSE and README each), extracted to their own repo
only when a second consumer exists. Not a separate repo now: the docs-as-spec routing, the
vitest source scans that enforce the design rules, the one-corpus discipline and the single
author's release path all live here, and every headless precedent the first draft cited
(xyflow, TanStack) is itself a monorepo. The scope (§ 12) is the spreadsheet user's and the
tinkerer's: correct day-precision scheduling with working calendars, floors and deadlines,
milestones, nesting, float and critical, a chart that prints and embeds in a Report, MSPDI read.
Not a PMO tool: no resource leveling, no effort-driven task types, no XER, no bar dragging (the
author's "never" stands), no per-task modes.

"Combine the best of a bunch of mid-tier repos" is right as *lineage* and, for the layout
layer, partly literal: DHTMLX 10 relicensed to MIT with readable TypeScript, so the design of
its Gantt-independent scale engine and its four-type link router can be ported beside SVAR's
MIT store code, `d3-time` and TanStack Virtual. For the engine it is lineage only: everything
that computes dates correctly is GPL, CPAL, EPL or commercial and is re-derived from the spec.
§ 5 names what can be ported, what can only be studied, and what each contributes.

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

---

## 3. The spec: what "correct" means

### 3.1 Microsoft Project is the de facto standard (with sources)

The rules a full engine must implement to match Project on the common cases, each sourced to
Microsoft docs or, where Microsoft is silent, to MPXJ's `MicrosoftScheduler` (marked *[MPXJ]*).
Which of these v1 implements is § 12; the list is the whole bar, so nothing is silently dropped.

1. Time is stored in **tenths of a minute** (Project's native unit; MSPDI `LinkLag` is in tenths
   of a minute); every task has a working **calendar** = base weekly pattern + exceptions + up to
   five working intervals per weekday.
2. Duration in d/w/mo converts through the project's *Hours per day / Hours per week / Days per
   month* options, **independent of the task's calendar** (a "3d" task on a 24-hour calendar is
   24 h of work). Elapsed units (`ed`, `eh`…) count clock time.
3. A start snaps forward to the next working instant; the finish is reported at the end of the
   last working period (17:00), not the next morning *[MPXJ]*.
4. Unlinked, unconstrained tasks start at the project start. A task *with* predecessors is not
   clamped to the project start: a lead longer than the predecessor can put it before it *[MPXJ]*.
5. Forward pass per link: FS `ES ≥ pred.EF + lag`; SS `ES ≥ pred.ES + lag`; FF `EF ≥ pred.EF +
   lag`; SF `EF ≥ pred.ES + lag`; each link converts to an ES, then max over predecessors. Lag is
   measured on the **successor's** calendar *[MPXJ; Microsoft does not say]*; elapsed lag on a
   24-hour calendar; percent lag = percent of the predecessor's duration in the predecessor's
   units; FF/SF on a started task use its *remaining* duration *[MPXJ]*. Project 2010+ forbids
   two links between one pair.
6. Eight constraints with Microsoft's formulas (ASAP, ALAP, SNET, SNLT, FNET, FNLT, MSO, MFO).
   With *Tasks will always honor their constraint dates* (default on), SNLT/FNLT/MSO/MFO win over
   links and produce **negative slack**; off, the link wins. Typing a date silently applies
   SNET/FNET. MPXJ implements only the "on" half; the "off" half is pinned by a Project file.
7. Backward pass from LF = project finish (max EF), or from each successor-less task's own EF
   under *Calculate multiple critical paths*; MSO/MFO/SNLT/FNLT cap late dates. A **deadline**
   caps LF; for an ASAP task that only changes slack, but for an **ALAP task** Start := LS, so a
   deadline earlier than the task's EF schedules it before its predecessors finish, with negative
   slack *[MPXJ; Microsoft: a deadline "can affect how tasks are scheduled" under ALAP]*.
8. **Total slack** = min(LS−ES, LF−EF) in working time on the task's calendar. **Free slack** is
   computed per link on the *predecessor's* calendar in its duration units, minus the lag: FS
   compares the predecessor's finish with the successor's start, SS start with start, FF finish
   with finish, SF start with finish; take the min; equals total slack with no successors;
   clamped at 0; 0 when complete; ALAP tasks substitute late dates *[MPXJ; Microsoft for the
   no-successor clause]*.
9. **Critical** ⇔ total slack ≤ *CriticalSlackLimit* (default 0) and not 100% complete; MSO/MFO
   and ALAP-in-a-forward-project tasks are critical too.
10. ALAP: ES := LS in a third pass; start slack reported as 0.
11. Milestone ⇔ duration 0 (a non-zero task may be *flagged* one); a started 0-duration milestone
    has LF = actual start *[MPXJ]*.
12. Summary: start = min child start, finish = max child finish, **duration = working time between
    them on the summary's own calendar** (so a summary over a 24-hour-calendar child reports a
    duration that is not the child's; Microsoft's answer is "give the summary the same
    calendar"), critical if any child is, % complete = Σ actual duration / Σ duration; a link on
    a summary bounds all its children *[MPXJ]*; a constraint on a summary is documented as
    unsupported by MPXJ and needs a Project file to pin.
13. Progress: actual start pins ES, actual finish pins EF; the *remaining* duration is what gets
    scheduled. **Out-of-sequence progress** (an actual start before a predecessor allows) keeps
    the link: with *Split in-progress tasks* (default on) the remaining portion is split to after
    the predecessor's finish; off, the remainder runs contiguously from the actual start. The
    status-date options move completed/remaining parts. MPXJ does neither split; a Project file
    pins it.
14. Leveling delay (elapsed units at task level) is added before the forward-pass ES.
15. **Manually scheduled** tasks are never moved, yet still act as predecessors.
16. Task types matter only with resources: Work = Duration × Units, with Project's recalculation
    table (Fixed Units / Fixed Duration / Fixed Work; effort-driven).

Where the tools genuinely disagree (and where § 6.5 picks): the lag calendar (Project successor,
P6 configurable with successor as Oracle's stated default, Smartsheet the sheet's working days);
day vs minute granularity (Project/P6 08:00–17:00; Smartsheet, OpenProject, Redmine and
GanttProject work in whole working days where "FS, lag 0" means *the next working day*); Excel's
`NETWORKDAYS` is endpoint-inclusive while `WORKDAY` excludes the start; critical = total-float
threshold vs P6's longest path; whether successors may move *earlier* (Redmine and pre-15.4
OpenProject push only); percent lag (Project only).

### 3.2 The correctness test list, and what it really consists of

- **Project-authored MSPDI files are golden tests.** A file exported by desktop Project holds
  `Start/Finish/EarlyStart/EarlyFinish/LateStart/LateFinish/TotalSlack/FreeSlack/Critical` per
  task *next to* the inputs. Strip the computed fields, run the engine, diff. **Where they come
  from, honestly:** MPXJ's public `junit/data` is mostly binary `.mpp` (225 at top level, 320
  more under `generated/`); its Project-authored MSPDI files with links and slack number about
  a dozen, all trivial; the files named `PredecessorCalendar*` / `SuccessorCalendar*` are
  Primavera PMXML, not Project. Those `.mpp` files are readable by MPXJ in CI (LGPL running in
  CI creates no obligation) but their provenance is unstated, so they are derived from, never
  redistributed. The real scenario corpus is **authored**: a Project Plan 3 trial (30 days,
  includes the desktop client, needs a work/school tenant) or Project Professional 2024
  (purchasable) exports MSPDI; Planner Premium / Project for the web cannot export it. One
  scenario per rule above, per Bryntum scenario, per divergence, per known bug.
- **MPXJ as a second opinion, not an oracle.** `mpxj` on PyPI bundles the jars and runs from
  Python via JPype on any JRE ≥ 11 (GitHub runners ship Temurin 17), so a CI job can regenerate
  expected values. Its `MicrosoftSchedulerComparator` already does "strip, reschedule, diff" on
  exactly the eight fields above. But MPXJ's own docs say results "will match in most cases,
  but this is not guaranteed"; it does not schedule from a finish date, split tasks, recurring
  tasks or constrained summaries, has no *honor constraints = off* path, and validates itself on
  private files with exclusion lists. Keep its idea: a `divergences.json` naming which files and
  fields the second opinion is known to miss, so Project-vs-MPXJ-vs-ours disagreements are
  triaged, not hidden.
- **Bryntum's 14 scenarios** (published): SS, FF, SF links; FS with lag; MSO resisting dependency
  pressure; SNET as a soft floor; weekend calendar; a resource calendar extending duration; an
  ALAP chain from a deadline; critical path; a conflict/cycle surfaced to the user; an intra-day
  calendar with a lunch break; effort-driven recalculation; an inactive task excluded but
  keeping its position.
- **DHTMLX 10.0 changelog** (~20 fixed edge cases): SS/SF slack, negative lag beyond duration,
  MSO/MFO ping-pong, calendar inheritance across levels.
- **DCMA 14-point assessment** as structural invariants on every corpus file (missing logic,
  leads, lags, relationship-type mix, hard constraints, high/negative float, high duration,
  invalid dates vs status date, the +600-day critical-path test, CPLI, BEI), surfaced to the
  user under plain names (§ 6.2).
- **Layout goldens.** Tier and viewport fixtures for DST switches, ISO-vs-US week 1, leap years,
  month columns proportional to day count, hidden weekend ranges; the DST patches in DHTMLX
  `date.ts`, Syncfusion `timeline.ts` and Frappe `date_utils.diff` are the regression list.
- **Known-bug regression list** (from public trackers): DST off-by-one-hour drift (Frappe #616,
  Bryntum #13336), lag ignoring the calendar (Bryntum #12454), milestone drag anchor under
  working time, a parent keeping a duration with zero-duration children, undo restoring the
  wrong duration, one-day bars not drawn, circular links hanging the renderer (DHTMLX #109),
  Mermaid's `excludes` off-by-one (#6421, #314, #2147).

### 3.3 Interchange formats

| Format | Openness | Notes |
|---|---|---|
| **MSPDI** (Project XML) | pj12 served live at schemas.microsoft.com; pj14 checked into nasa/CertWare on GitHub (has the manual-scheduling fields); pj15 ships only in the Project 2013 SDK and is *not* in MPXJ's repo; Microsoft Learn documents pj12 element by element | `Task{UID, OutlineLevel, OutlineNumber, Duration as PT8H0M0S, DurationFormat codes, ConstraintType 0–7, PredecessorLink{Type 0=FF 1=FS 2=SF 3=SS, LinkLag in tenths of a minute, LagFormat}, Baseline 0..10}`, `Calendars{WeekDays, Exceptions, WorkWeeks}`, `Assignments`; the one format every desktop tool reads and writes; write the codec against pj14 + the Learn pages |
| `.mpp` | binary OLE; MPXJ is the only open reader | read-only through MPXJ; not a target |
| **Primavera XER** | tab-delimited `%T/%F/%R`; Oracle publishes the data map | `TASK`, `TASKPRED{pred_type PR_FS…, lag_hr_cnt}`, `PROJWBS{parent_wbs_id, seq_num}`, `CALENDAR{clndr_data blob}`; **all durations in hours**; `xer-parser` (npm, MIT, TS, 2.1.0, streaming, calendar utils); construction/enterprise, a pack candidate |
| P6 PMXML, ProjectLibre `.pod` (Java serialization), Asta, Phoenix, SDEF | MPXJ | out |
| GanttProject `.gan` | XML: nested `task`, `depend{type 1=SS 2=FS 3=FF 4=SF, difference, hardness}` | trivial reader; a pack candidate |
| iCalendar | RFC 5545 VTODO + **RFC 9253** (`RELTYPE=FINISHTOSTART…`, `GAP` lag) | the one standards-track link encoding |
| CSV | Smartsheet exports predecessors verbatim in its grammar, **row-number based** | the grammar is parsed at import and resolved to task names; never an internal key |

Dependency-type integer coding is a trap: MSPDI 0=FF/1=FS/2=SF/3=SS, DHTMLX 0=FS/1=SS/2=FF/3=SF,
Bryntum 0=SS/1=SF/2=FS/3=FF. Store two-letter strings; map at the codec. ISO date-times and
`xsd:duration` at this boundary are ~30 lines of parsing; no Temporal polyfill is needed.

---

## 4. Behavior to match: UX

### 4.1 Auto-shift: the product-defining choice, and the one rule that replaces it

Consumer tools converged on a three-way switch: *shift only on conflict* (consume slack: Asana
default, monday Flexible, Notion overlap, Airtable Flexible, DHTMLX default, Hive On), *shift
always keeping the gap* (Asana maintain buffer, monday Strict, Notion maintain, Airtable Fixed,
ClickUp, TeamGantt pref 1, Wrike), *never* (manual). Professional tools (Project, P6, Bryntum,
Smartsheet) instead model the gap **explicitly as lag** and always recompute; "conflict-only" is
the un-modeled case. The user sweep (§ 11) shows the switch itself is the top source of support
threads: Asana's 2025 change to it produced "renders dependencies useless for us", Project's
silent SNET-on-typed-date produces "why is Project doing this?", ClickUp's push-later-only rule
has been "planned" since 2018.

In a pure-function model the switch disappears and is replaced by **one rule with no modes**:

- The schedule is *always* recomputed from the table. A gap is a **lag** on the dependency.
- A **Start** cell is a floor (Project's SNET): the task starts no earlier than it, and later if
  a predecessor forces it. A **Finish** cell is a ceiling (FNLT): it caps the late finish and
  produces negative float rather than moving anything. A **Deadline** cell caps late dates and
  flags, never moves (the "flag it, don't move it" that Smartsheet users ask for).
- **Manual = TRUE** pins both dates and ignores predecessors; the row still drives its
  successors.
- No `constraint` / `constraint_date` columns in the user's table (MSPDI's eight types map onto
  Start / Finish / Manual at import); no per-row task mode; no project-wide shift toggle.
- "How much of the plan is held by hand" is a diagnostics row: the count of non-blank Start cells.

Every consumer mode is expressible: keep-the-gap is a lag; shift-on-conflict is a floor; never is
Manual. And every date on screen traces to a visible cell, which is exactly the property the
complaints are about.

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
The ruling itself is not reopened by this doc (§ 6.4); the list above records the cost so the
call, if ever made, is made with it in view.

---

## 5. Standouts by layer, and what can be taken from each

| Layer | Standout | License | Take |
|---|---|---|---|
| Engine spec | Microsoft Project | docs | the 16 rules; option names (`HonorConstraints`, `CriticalSlackLimit`, `MultipleCriticalPaths`, `MinutesPerDay`) |
| Engine second opinion | MPXJ `MicrosoftScheduler` + `MicrosoftSlackCalculator` + `MicrosoftSchedulerComparator` (16.7.0, Java; `mpxj` on PyPI bundles the jars) | LGPL-2.1 | run in CI as the **second opinion**, never vendored (running it creates no LGPL obligation; copying its MSPDI writer would); its `.mpp` files derived into goldens in CI, never redistributed |
| Engine design | Huly `gantt/lib` (TS) | EPL-2.0 | read only: pure functions over plain records, calendar injected, "a primary edit is authoritative, a cascade never overwrites it", violated-vs-critical precedence, tests |
| Engine design | Bryntum engine / ChronoGraph | commercial / MIT | read only: `direction`, `dependenciesCalendar`, conflict resolution surface, the 14 scenarios |
| Engine, small | `@korastd/critical-path-method` (imlargo/cpm, 0.1.0, 2026-08) | MIT | may vendor: 4 types, min/max lags, injectable calendar, free/total float, cycles; too new to depend on |
| Engine, second opinion | ProjectLibre `CriticalPath.java`; Calligra Plan `kptrelation.h`/`kptnode.h`; GanttProject `SchedulerImpl` | CPAL / GPL / GPL | read only: ALAP third pass, honor-required-dates, hardness bit |
| Text model | TaskJuggler manual | GPL (docs) | vocabulary only |
| Layout: scale/ticks | **DHTMLX v10** `src/core/ui/timeline/scale_manager/{scale_manager,size_distribution}.ts` (normalize tiers coarsest-first, `ScaleLayout{trace_x, left[], width[], ignore_x}`, month columns proportional to days, upper tiers snapped to the primary tier's pixels, `posFromDate`/`dateFromPos` by binary search); SVAR `store/src/scales.ts` (`resetScales`, `normalizeZoom`, `zoomScale`); `d3-time` `src/ticks.js` interval table; vis-timeline `TimeStep`/`Stack` | MIT / MIT / ISC / MIT-or-Apache | **port**, not vendor: both scale files are `Date`- and DST-bound and read their library's singleton, so what transfers is the tier-normalization design and `size_distribution.ts` (~350 lines rewritten on serial math); `d3-time`'s tick table (already in the tree through Recharts); vis-timeline's stacking for multi-item rows |
| Layout: arrows | **DHTMLX** `src/core/ui/render/link_render.js` `path_builder.get_points` (orthogonal point lists for SS/FS/FF/SF incl. backward loops and milestone endpoints; ~150 lines of geometry once the 14 `gantt.` references are detangled; drop the div drawer); SVAR `links.ts#getLineCoords` (6-point polyline + bounding box for culling); IBM `constraintgraph/constraintlayout.js` (connector slots per side, side switching to reduce crossings); Highcharts `PathfinderAlgorithms.ts` (`fastAvoid`); Vikunja arrows | MIT / MIT / Apache-2.0 / proprietary / AGPL | port the DHTMLX + SVAR geometry; copy IBM's slot idea; study `fastAvoid` only |
| Layout: culling | DHTMLX `render_factory.js`, `viewport/{get_visible_bars_range,is_bar_in_viewport,is_link_in_viewport}.js`, `row_position_fixed_height.js`; `@gantt-chart/core` `LayoutResult` shape; TanStack `virtual-core` range math | MIT | vendor the culling protocol (row band first, then x ± padding) and the result shape |
| Gestures (only if the "never" ruling is ever reopened) | `dnd-timeline` hooks; `@wamra/gantt-task-react` typed links + holiday rounding; Frappe `move_dependencies` + `ignore` periods; `@xyflow/system` `XYDrag`/`XYPanZoom` | MIT | pattern only: xyflow's machines are React-Flow-store-coupled 0.0.x internals (their README says so); copy the `install(domNode, callbacks) → dispose()` shape, depend on nothing |
| Store / derivation | SVAR `DataStore.ts` `DataRouter` (declarative `{in, out, exec}` rules over state keys); ChronoGraph `Transaction`/`Effect`/`CycleResolver` (ProposedOrPrevious, commit/reject, the start/end/duration cycle table) | MIT / MIT | copy the ideas into a small purpose-built incremental scheduler; do not build on ChronoGraph (frozen 2021, generator-effect style, the Gantt logic on top is closed) |
| Dates / DST | DHTMLX `src/core/common/date.ts` and `_correct_dst_change`; Syncfusion `date-processor.ts`; Frappe `date_utils.js` | MIT / study / MIT | use as the checklist of everything the engine avoids by never touching `Date` |
| Grid a11y | Syncfusion's ARIA role map + shortcut map; DHTMLX `src/core/ui/wai_aria.js` (the concrete role set) and keyboard scopes; W3C APG treegrid | docs / MIT | copy the maps |
| Conflict UX | OmniPlan Violations window; Bryntum popup (remove / deactivate / cancel); Syncfusion `respectLink / removeLink / preserveLinkWithEditing` | docs | copy the vocabulary |
| Interchange | MPXJ (formats), `xer-parser` (MIT TS), `@svar-ui/lib-mspx` (MIT MSPX↔SVAR), RFC 9253 | LGPL / MIT / MIT / std | write the MSPDI reader against pj14 (nasa/CertWare) + pj12 (schemas.microsoft.com) + the Learn pages; `xer-parser` behind the pack flag |
| Data-first spec | Airtable Date Dependencies; Smartsheet grammar; NocoDB Gantt settings | docs | the column set and the predecessor grammar |
| Renderer to embed if one were embedded | SVAR React Gantt (MIT) or DHTMLX Community ≥10 (MIT) | MIT | rejected as the base (§ 7.1); the interim figure is the Mermaid `gantt` output the Schedule node already emits |

---

---

## 6. The Solenoid fit

### 6.1 A plan is a Cube (the author's ruled shape), and a flat table only at the border

The author ruled the shape on 2026-09-06/07: one row per task, Predecessors a **list cell** naming
the tasks that must finish first, "no in-cell string lists, that is what the cube is for". The
first draft of this bundle silently replaced that with MS Project's relational schema
(`id`, `parent_id`, `order`, `pred_id`/`succ_id`, `constraint`, `duration_unit`, `lag_unit`) and
proposed `"3FS+2d"` tokens inside the list cell; the product review caught it, and it is
withdrawn. The canonical model:

**Tasks Cube, input columns** (names are the key: unique, matched trimmed and case-insensitive;
no numeric ids, which would be ambiguous with row numbers and fragile under Sort/Filter):

| Column | Type | Meaning |
|---|---|---|
| Task | text | the name; unique |
| Duration | number | working days; 0 or blank = milestone; a plain number, never a united value (a `3 day` `UnitCell` is 259,200 s and breaks date arithmetic through the FC); an hour-denominated column arrives as `Duration (h)` through the existing per-column unit header and is converted by hours-per-day |
| Predecessors | list cell **or** nested table | a list of task names = FS with lag 0 (the TaskNotes `blockedBy` shape); a nested table `Task · Type · Lag` (Type `FS|SS|FF|SF`, Lag in working days, negative = lead) when a plan needs types or lags. Never a grammar string; `3FS+2d` exists only in the CSV/MSPDI importer, which resolves Smartsheet's row numbers to names |
| Start | date, optional | a floor (§ 4.1) |
| Finish | date, optional | a ceiling |
| Deadline | date, optional | flags, never moves |
| Manual | logical, optional | pins Start and Finish, ignores predecessors |
| Complete | number, optional | 0–100, drawn as bar fill; drives remaining duration when a status date is set |
| Project | text, optional | one Mermaid `section` / one figure group per value; passthrough |
| color, notes, url, resource names | passthrough | never read by the engine |

**Hierarchy is nesting.** A parent row holding its children as a nested frame *is* the WBS, at
any depth, exactly what Cube Input already edits (drill in on the breadcrumb, `+ Col`). The
engine flattens the cube for the DAG (every nested-format library does the same before
scheduling: Bryntum, SVAR, TaskJuggler), roll-ups land on the parent rows, and dependencies may
name a task in any subtree because names are global. `parent_id`, indent levels and `"1.2.3"`
WBS strings exist only at import (MSPDI `OutlineLevel`, CSV indent) and are converted to nesting
in one pass. There is no `order` column: row order is order, and Sort exists.

**The flat two-frame form** (Tasks + Dependencies with `pred`/`succ`/`type`/`lag`) is `Unnest`
of the cube on Predecessors, an existing verb. It is the import/export shape (MSPDI, XER, CSV)
and the shape a user who prefers two Frame Inputs can wire; a Frame Input alone cannot carry a
list column, so a frame-only plan is FS/0 with Predecessors as one name per cell, which is what
the shipped Frame widening rule already does.

**Computed columns**, appended, never overwriting inputs (`widenNeverNarrow`: a cube in is a cube
out; a frame in is a frame out with a declared `frameShape()` of input shape + these columns):
`Start` and `Finish` (scheduled, filled where the user left them blank; a user-typed Start is
shown as typed since it is the floor that held), `Early Start`, `Early Finish`, `Late Start`,
`Late Finish`, `Float` (working days), `Free Float`, `Critical` (logical), `Driving` (the
predecessor that set the start, the answer to "why is this task here?"), `Late` (finish past
Deadline), `Level` and `WBS` (display strings from the nesting), `Summary` (logical). A cube
output is static-shape blind (no cube shape exists in `frameShape.ts`), so Computed Column and
Get Column pickers downstream see nothing until the value flows; Get Column on the nested
Predecessors column errors `#SHAPE!`, which is the loud, correct refusal.

**Errors follow the value model, not the first draft.** A cycle, an unknown predecessor name or
a duplicate name is a whole-graph failure: no member has a defined start and nothing downstream
of the loop does either, so it is **one `#VALUE!` naming a member, on every output** (the
aggregate rule, `pickVsAggregateErrors`; also what Project, P6, MPXJ and Huly do: they refuse
the link or the run). Diagnostics lists the loop's members. Per-cell `SolError` is reserved for
per-row faults with a per-row answer: a non-numeric Duration, an unparseable date, and a
constraint conflict (negative float from a Finish or Deadline the predecessors cannot honor).
That per-row channel is the one thing MSPDI never had.

**Where the Cube fits, three places:** the Predecessors cell (a list, or a nested table when
types and lags matter); the WBS (nesting); and a **portfolio** as a cube of projects, one row per
project with its tasks nested. Scheduling a portfolio row by row needs by-row iteration over a
cube, which the composite by-row mode does not do today (it iterates a frame's rows or a list),
so the portfolio case is a listed prerequisite, not a free gift.

**Calendar.** Not a new socket type (that would be a lattice change) and not a Work Calendar
node: the Schedule node takes what the Workdays node takes, a `weekend_code` (Excel's
`WORKDAY.INTL` codes, the one working-day implementation the app already shares) and a
`holidays` date list (the Holidays node feeds it). A per-task calendar, working hours and
recurring exceptions are engine capabilities exercised by the MSPDI importer and by minute
mode, not v1 columns.

### 6.2 The nodes: Schedule and Gantt, nothing else in v1

| Node | In | Out |
|---|---|---|
| **Schedule** (Table verbs › Plan) | `tasks` (cube or frame), `start` (date socket; unwired = today), `holidays` (date list), `weekend_code`; card options: precision (Days, the default | Minutes), hours per day (8), `status date` (date socket, optional) | `schedule` (the input cube with the computed columns), `finish` (date), `diagnostics` (a frame: one row per finding under plain names such as "tasks with no predecessor", "negative float", "held by a typed start", "lead", "long task"; the DCMA checks without the acronym), `gantt` (Mermaid `gantt` source, kept: it is what Obsidian renders natively and what feeds the vault write-back today) |
| **Gantt** (figure) | `schedule` (the cube or frame above), optional `baseline` (a second scheduled frame, pasted or pinned), `options` string | a `chart` value of kind `gantt` |

What the first draft listed and this one deletes, with the rule each broke: *Schedule Check*
duplicated the `diagnostics` output (`declareOnce`); *Baseline* stamped a wall clock inside
`data()` (volatile) and reopened the ruled-out snapshots item #6 (a baseline is a pasted second
Frame or Cube Input, or the 1.4 pin store); *Work Calendar* was a new socket kind; *Predecessors*
re-legitimized the in-cell string list; *Import Project* / *Write Project* duplicated Local File,
Import XML and Write File (MSPDI read is a **format** on the existing readers; Write, if ever, is
a sink under `sinkRunButtonOnly`); *Assign* / *Level* / *Earned Value* are § 12 later-or-out.

The AI palette needs the column contract on the node (`socketDocs`; a cube input has no
`frameHints` mechanism, so the words in the Tasks socket doc are the contract). Tests to touch
when this lands: `seeds.test.ts`, `nodeOps.test.ts`, `formulaNodeCoverage.test.ts`,
`catalogRegistry.test.ts`, `chartPopupCoverage`, `frameHint.test.ts`, `scheduleCpm.test.ts`,
`nodes/schedule.test.ts`, the two seeds; the TaskNotes feed (`blockedBy` as a list of titles,
Duration = `timeEstimate` ÷ hours per day) is the one live consumer and is checked against the
column set above.

### 6.3 The figure

A `chart`-socket value (`kind: "gantt"`) whose **payload is data, not geometry**: scheduled rows
as serials, dependencies, non-working spans, critical/violated/late flags, the nesting, the
options. Every existing payload ships data and lets the view lay out at its width; a
pre-computed pixel frame would be wrong at three of the four places a figure draws (240 px card,
resizable Display, popup, Report column). `gantt-layout` therefore runs inside `ChartFigure`
against the measured width, and headless export is the same function called at a chosen width.

**Where it draws.** The Gantt node's card carries the `[Chart]` chip, exactly the Record
precedent (`oneRecordNode`: the card never draws its grid, squished at card width); the figure
draws in the resizable Display, the expand popup and the Report embed. The canvas Display shows a
capped snapshot (rows capped like Record's 60-card cap; the HTML-in-Canvas renderer weighs a
chart card at 10 units and rasterizes it, and a scrolled virtualized child would clone blank, an
unprobed risk); the **popup** is where thousands of rows virtualize, mirroring the TablePopup
ruling (card capped, popup carries the window).

**How it draws.** HTML for the tree grid and labels; one SVG per row band for bars, diamonds,
brackets and progress; one overlay SVG for dependency paths with `pointer-events` on a wide
invisible hit-polyline (the SVAR/Bryntum/Syncfusion hybrid). The grid carries `nowheel` and
`nodrag` (the surface rule that already covers Mermaid, Note and TablePopup) and needs a
`nokeys` opt-out in `canvasKeyboard.ts` mirroring `nowheel`, because a focused grid cell today
leaks arrow keys into node nudging and single letters into the Add menu. The ARIA treegrid roles
and the keyboard map are Syncfusion's; their real home is the 2.0 accessibility baseline (P6).

**Options** ride the existing `options` string / Chart Builder path with matplotlib-style keys:
`zoom` (day/week/month/quarter/year), `tiers`, `fit`, `window` (date range), `collapse`
(nesting level), `critical`, `baseline`, `arrows`, `today`, `status`, `weekends`, `group_by`,
`labels`, `week` (iso/us), `fiscal_start`. Those keys are the *only* persisted view state; zoom,
scroll and expand/collapse beyond them are ephemeral React state, which the 1.4 B7 note ("the
first figure that would carry per-viewer state") already anticipated. New keys are added to
`CHART_BUILDER_TARGETS`.

**Export.** The Report embed is the live `ChartFigure`; the webpage export serializes *the
single largest SVG* in a node's DOM (`nodeChartSvg`), which a grid-plus-banded-SVG figure
defeats. So a headless `payload → standalone SVG string` serializer is a **second, pure
renderer** (small, shared with the popup's "copy as SVG"), and the `nodeChartSvg` seam changes
to ask a figure for its serialization. "PDF" is the browser's print of that exported page; no
PDF path exists in the app and none is added. Colors follow DESIGN.md: critical and violated
bars carry a pattern or icon as well as a color (WCAG 1.4.1); non-working shading is the
neutral ramp; the accent stays on op pickers. The whole figure is one lazy chunk on the
`chartRender` pattern (~50–70 kB gzipped by the engineering review's estimate; `d3-time` and
`d3-scale` are already in the tree through Recharts).

### 6.4 Interaction: the figure never writes

The author's ruling stands: **no bar editing, ever; edits happen in the table.** The first draft
softened it to "decide at phase 5"; that was reopening a ruling without saying so, and it is
withdrawn. The user sweep supports the ruling more than it undermines it: the most-reacted
issue on the most popular free Gantt library is "disable drag", Workfront users lose hours to a
finger slip that re-parents a subtree, and Smartsheet users screenshot their plan before a big
edit because a drag has no undo. What is genuinely lost is one gesture's discoverability
(dragging a handle to another bar to make a link); the predecessor cell covers the function.

The rule is also the only one that is implementable: a chart value is flat JSON on a cable, the
figure is drawn by a different node than the one that owns the literal, values carry no
provenance, and a plan that arrives through Filter or Join has no literal at all (Smartsheet's
answer to the same problem is that dependency columns refuse formulas; Solenoid's is that the
source is the only writable thing). The editor is the Cube Input popup, already an editor with
drill levels and Enter/blur commit; snapshot undo covers it. If the author ever wants a gesture
on the figure, it is B7's model (a display-only focused record that a second node follows by
name, an option key, never a cable), written as a reopening.

### 6.5 Dates, units, precision

Solenoid dates are Excel serials with a fractional day, which are already zone-less local days:
the representation a scheduling engine should compute in. The engine converts a serial to
`(day, minute)` integers **once at the boundary and never compares serials** (a 2026 serial's
double resolution is well under a minute, but two sums of fractions can differ by one ULP);
internally it works in serial day + tenths of a minute against a calendar (rule 1) and never
touches `Date`, which removes the DST bug class every surveyed library carries. Temporal is not
needed anywhere; the ISO date-times and `xsd:duration` strings at the MSPDI boundary are a few
lines of parsing.

**Day precision is an engine mode, not a display option.** In *Days* (the default and the
Excel user's model) every duration is whole working days, "FS, lag 0" means the next working
day, and a finish is the last working day of the task, so `Finish − Start + 1 = Duration` holds
on the cells (the `WORKDAY(Start, Duration − 1)` every Excel template computes). In *Minutes*
(for MSPDI parity and hour durations) the engine works in Project's 08:00–17:00 model and an FS
successor may start at 12:00 the same day. A display-only snap would show two tasks on one day
and read as an overlap; snapping inside the engine breaks parity on any file with hour durations,
so the two are modes, chosen on the card. **Finish is inclusive on the cell in both modes**: a
frame cell *is* the value, Get Column returns what the engine wrote, and there is no
internal/display split to hide behind. In Minutes mode the displayed day is the day of
(finish − one minute), so a finish of 00:00 on a 24-hour calendar lands on the right day. The
figure adds one day when it draws a bar.

---

## 7. The decision: separately publishable packages inside this repo

### 7.1 Why not embed SVAR or DHTMLX Community

Both are honest, maintained, MIT renderers, and both fail the same three tests: their free tier
computes nothing (scheduling, calendars, critical path, undo are PRO, and the seam moves with
each release); they own their DOM, CSS and state (an imperative singleton in DHTMLX, a private
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

### 7.3 Why headless, and why not a separate repository (yet)

The headless split is the proven shape and it stays: engine separated from layout, layout
emitting plain numbers, the view a thin adapter. The libraries that fused engine and view
(Syncfusion's 6,636-line `gantt.ts`, Frappe's `index.js`, gantt-task-react's `bar-helper` with
twelve color parameters) are the ones that became untestable; the ones that separated
(DHTMLX's `scale_manager.ts` "gantt-independent, injected dependencies", SVAR's store computing
geometry) are the ones worth porting; Bryntum's engine runs in Node with no DOM.

The first draft put that split in a **separate repository**. Both reviews refuted it on facts,
none of them effort:

- Every precedent the draft cited is a **monorepo**: xyflow (`@xyflow/system` beside
  `@xyflow/react`), TanStack Table and Virtual, Floating UI all ship from one pnpm workspace with
  changesets. The draft proposed the opposite topology in their name.
- Solenoid's design rules are **enforced by vitest source scans over this tree**
  (`noDataInComponents`, `frameLabelGrammar`, `uiCopy` for DESIGN § 7, `catalogRegistry`,
  `chartPopupCoverage`), the spec is routed by file path in `docs/README.md`, and the
  relapse guard is `decisions.md`. A `gantt-react` in another repo escapes all of it: its strings,
  tooltips, CSS variables and node docs would be the first Solenoid mechanisms with no routed
  home and no scan.
- The **one-corpus discipline** (`fixtures/frame-verbs/`, one fixture directory, two runners) is
  the thing the draft praised and then placed where neither vitest here nor cargo could see it.
- The **release path** is `npm ci` in both workflows and `npm run build` under Tauri; a second
  repo means publish-or-git-URL for every engine change while the API churns, `npm link` that
  does not survive `npm ci` on the Windows build, and two CI matrices for one author. The
  bus-factor mitigation in the decisions log (the doc series, machine-checked seeds, the
  reconcile rule) would be halved.
- The "contributor boundary" that keeps GPL/EPL code out is a directory with its own LICENSE,
  README source list and a lint rule forbidding imports from `src/`, not a repository.

The strongest case *for* a separate repo is real and is the extraction trigger: no MIT toolkit
that computes schedules correctly and lays out a Gantt without a DOM exists; the author's own
TaskNotes/Obsidian ecosystem is a plausible second consumer; a published engine invites MSPDI
golden files and bug reports from people who own Project licenses. **Extract when that second
consumer exists**, not before.

### 7.4 Package boundaries and how Solenoid consumes them

```
solenoid/                       (npm workspaces; npm ≥ 7, no pnpm migration)
├─ packages/
│  ├─ schedule-engine/          MIT, own LICENSE + README (source list of what was studied);
│  │    calendars/              weekly template + exceptions + intervals; serial day + tenths of a
│  │                            minute; duration ↔ working-time conversion; the lag calendar
│  │    graph/                  flatten the cube, name-keyed DAG, Tarjan SCC, topological order,
│  │                            dirty-set incremental recompute (DHTMLX 10.0.3: cost scales with
│  │                            tasks that moved)
│  │    cpm/                    forward/backward passes, float, critical set, floors/ceilings/
│  │                            deadlines/manual, ASAP/ALAP, direction, roll-ups on the summary
│  │                            calendar, actuals/status date, out-of-sequence + split remainder,
│  │                            diagnostics; Days and Minutes modes
│  │    codecs/                 MSPDI read (pj14), the predecessor grammar (import only), CSV
│  │                            dialects; XER and .gan behind a pack flag
│  ├─ gantt-layout/             pure TS: time scale (the DHTMLX tier design + size distribution,
│  │                            ported to serial math; d3-time tick tables), rows and stacking,
│  │                            bars, links (DHTMLX/SVAR geometry ported), viewport culling →
│  │                            a plain-number RenderFrame; golden-JSON tests
│  └─ gantt-react/              React 19 adapter (TanStack-Virtual proportions): hooks + SVG/HTML
│                               components, the headless payload → SVG serializer, --gantt-*
│                               custom properties, nowheel/nodrag/nokeys; Playwright goldens
├─ fixtures/schedule/           JSON scenarios (inputs + expected early/late/float/critical),
│                               the MSPDI goldens the author exports, Bryntum's 14, DCMA
│                               invariants, divergences.json; one directory, read by vitest and
│                               by the MPXJ second-opinion CI job
└─ src/graph/…                  nodes/schedule.ts binds Frames/Cubes to the engine's column
                                arrays; chartValue.ts gains kind "gantt"; the figure component
                                wraps gantt-react in a lazy chunk
```

`gantt-dom` (framework-free drag / resize / link machines) is deleted from the plan: the ruling
is no bar editing, and `@xyflow/system`'s `XYDrag`/`XYPanZoom`, which the draft named as its
base, are React-Flow-store-coupled 0.0.x internals whose own README says they are "probably
not too interesting to use with other libraries". If a gesture is ever reopened, copy the
`install(domNode, callbacks) → dispose()` shape and depend on nothing. A Rust twin of the engine
behind `FrameBackend` is not planned: the engine is an eager verb over a materialized value
(like Decision Matrix), `oneVerbCorpus` does not apply, and the same fixture directory pins a
twin if a desktop workload ever forces one.

---

## 8. The plan (phases, no effort estimates)

0. **Corpus first.** `fixtures/schedule/`: authored JSON scenarios (one per rule in § 3.1, per
   Bryntum scenario, per divergence, per known bug); MSPDI goldens exported by the author from
   desktop Project (a Plan 3 trial or Professional 2024); a CI job that runs MPXJ's
   `MicrosoftSchedulerComparator` over the corpus and over MPXJ's own `.mpp` files (derived,
   never redistributed) and writes `divergences.json`; DCMA invariants as a second layer;
   fast-check properties (a task never starts before a predecessor plus lag in working time;
   float ≥ 0 without floors or ceilings; summary bounds children; a cycle always names a member;
   incremental equals full recompute). This is the acceptance test for everything after it.
1. **`schedule-engine` v1 in Days mode.** The cube contract of § 6.1 (nesting, names, list or
   nested Predecessors), the one rule of § 4.1, FS/SS/FF/SF with lag, milestones, summary
   roll-up on the summary calendar, deadlines, Complete and status date, Manual, float and free
   float per link, critical, multiple critical paths, diagnostics under plain names, `finish`,
   the Mermaid `gantt` source, whole-graph `#VALUE!` for structural failures and per-cell errors
   for per-row faults. Minutes mode with intra-day calendars and elapsed units lands in the
   same package but is exercised by the MSPDI corpus, not by the card.
2. **`gantt-layout` + `gantt-react`, read-only.** Port the DHTMLX tier design and the
   DHTMLX/SVAR link geometry to serial math; tiers and zoom presets; virtualized rows and time
   axis in the popup, a capped snapshot on the canvas; bars, diamonds, brackets, progress,
   baseline ghost; orthogonal arrows with the endpoint conventions; today and status lines;
   non-working shading; labels with ellipsis; critical and violated styling with non-color
   cues; the treegrid roles and keyboard map with `nokeys`; the headless SVG serializer and the
   `nodeChartSvg` seam; reduced motion. Golden SVG tests and Playwright screenshots.
3. **Solenoid integration.** The Schedule node on the § 6.2 contract (the shipped class name
   kept, so the P1 save-format freeze is not crossed), `kind: "gantt"`, the option keys in
   `CHART_BUILDER_TARGETS`, the Report embed, the popup, three seeds (a remodel with a diamond
   and a holiday; a plan with a nested Predecessors table carrying an SS link and a lead; a
   Smartsheet CSV imported through the grammar), catalog copy in the § 7 voice, docs reconciled
   (`node-coverage.md`, `subsystem-invariants.md` for the `nokeys` mechanism and the figure
   payload contract, `2.0-plan.md` Arc 8's "both backends" line corrected), the tests in § 6.2.
4. **MSPDI read** as a format on the existing readers (pj14), round-trip fixtures; the
   predecessor grammar and CSV dialects behind it.
5. **Later, by author promotion** (§ 12): XER and `.gan` read as a pack; MSPDI write as a sink;
   earned value as a pack on top of a baseline frame and a status date; resources and
   assignments, Work = Duration × Units with the recalculation table, a resource histogram;
   inactive and recurring tasks; P6 longest-path and float-path options; a by-row mode over
   cubes for portfolios.

Throughout: no GPL, EPL or commercial code enters the tree; each package README records what
was studied; the fixture directory is the contract.

---

## 9. What stands in the tree (the landed ledger, 2026-09-12)

**Built** (three agents in one session; the mechanics are in `../node-coverage.md` § Schedule /
§ Gantt, `../subsystem-invariants.md` § React Flow surface contract (figure payload + SVG
provider seam) and § Pointer gestures (`nokeys`)):
- `packages/schedule-engine` — § 6.1's cube contract (names, nesting as WBS, list or nested
  Task · Type · Lag predecessors), § 4.1's one rule, FS/SS/FF/SF with lag and lead, milestones,
  summary roll-ups with links both ways, deadlines, Complete against a status date, Manual, total
  and free float, the driving predecessor, plain-named diagnostics, `finish`, the Mermaid source,
  one `#VALUE!` for structural failures; **Days and Minutes modes** (§ 6.5: Minutes is Project's
  08:00–17:00 model with working intervals, same-afternoon FS starts, 17:00 finishes); MSPDI
  read (pj14; nesting, link codes, lag tenths, constraint types onto the one rule, the base
  calendar with working times); the predecessor grammar at the border; `fixtures/schedule/`
  with a hand-authored MSPDI whose stored dates reproduce in both modes and `divergences.json`.
- `packages/gantt-layout` + `packages/gantt-react` — the data-only payload
  (`payload.ts`), tiers and zoom presets with `fit`, rows with collapse and section bands,
  bars / diamonds / brackets / progress / baseline ghost / deadline pennant, orthogonal arrows
  with the endpoint conventions, today and status lines, non-working shading, labels with
  ellipsis, critical hatch + outline and late / violated cues (WCAG 1.4.1), a tree grid whose
  columns drop rather than clip, virtualized rows in the popup, the headless SVG serializer.
- Solenoid — the Schedule node on § 6.2's contract (class name kept; `weekend_code`, `status`,
  `hours`, a `diagnostics` frame, the precision toggle); the Gantt node (`kind: "gantt"`, the
  [Chart] chip on the card, Display / popup / Report, "Copy SVG", the `data-chart-svg-provider`
  seam feeding the webpage export and Write to Obsidian), the `gantt` Chart Builder target, the
  `.nokeys` opt-out; Local File's `plan` socket (MSPDI and grammar-CSV import); three seeds.

**Not built, by name:** per-task calendars and hours beyond one working pattern (Minutes mode
takes one interval set from `hours`); split remainders for out-of-sequence progress (the whole
bar moves after the status date); late bounds from a summary's SS/SF successors; multiple
critical paths and ALAP; a 24-hour calendar's midnight finish display; Project-exported goldens
(the author's trial — the corpus is hand-authored until then); a Rust twin (not planned, § 7.4);
the § 12 adjacent packs (XER / `.gan` read, MSPDI write, earned value, resources, inactive and
recurring tasks, P6 float definitions, a by-row portfolio mode); the calendar figure sibling.

## 10. Author calls

1. **Where the packages live**: in-repo npm workspaces (recommended, § 7.3) vs an in-tree module
   with no package boundary vs a separate repository now. The extraction trigger (a second
   consumer) is written into the doc either way.
2. **Predecessors with types and lags**: a nested `Task · Type · Lag` table in the cube
   (recommended: it is the cube ruling applied) vs a separate Dependencies frame wired as a
   second input. Both are accepted by the engine; the question is which the seeds and the copy
   teach.
3. **The one rule** (§ 4.1): Start = floor, Finish = ceiling, Deadline = flag, Manual = pin.
   Recommend as stated; the alternative is Project's eight constraint types as user columns,
   which the sweep says is the top source of "why did it move".
4. **Days as the default engine mode**, Minutes as the card option for MSPDI parity and hour
   durations. Recommend yes (it is what the accepted verb already does).
5. **Structural failures as one `#VALUE!`** (the accepted ruling and the aggregate rule) vs
   error cells on the loop's members and their descendants (what the engineering review would
   force if partial results were wanted). Recommend the former.
6. **Figure home**: `[Chart]` chip on the card, drawing in Display / popup / Report, canvas
   snapshot capped, popup virtualized. Recommend as stated (the Record precedent).
7. **The "no bar editing, ever" ruling** is kept as written; this doc does not reopen it. If the
   author wants to, it is B7's focused-record model and a separate call.
8. **v1 interchange**: MSPDI read only, grammar at import. XER, `.gan`, MSPDI write are pack
   candidates that reopen if a user arrives with such a file (out-of-scope test 4).
9. **Keep the Mermaid `gantt` output** on the Schedule node (it is the interim figure and the
   Obsidian path). Recommend yes; no Recharts interim.
10. **Baseline** = a pasted second Frame/Cube Input or the 1.4 pin store, never a node that
    stamps a clock. Recommend as stated.
11. **Summary roll-ups** computed inside the engine on the nested form (recommended, so Float
    and Critical roll up too) vs left to Cube Rollup downstream.
12. **Sequencing**: the Schedule class name is kept so nothing crosses the P1 save-format
    freeze; the figure lands after Arc 5's "figure rasterize-at-rest" step or with the canvas
    snapshot cap in place. Recommend the cap now, no wait on Arc 5.

---

## 11. What users complain about, and what they refuse to give up

About 95 threads, reviews and issues were read (Asana Forum, Smartsheet Community, ClickUp's
vote board, monday, Airtable, Atlassian, Microsoft Q&A and Tech Community, Workfront, Zoho,
OpenProject, Omni Group, MacRumors, Planning Planet, Hacker News, Capterra, SourceForge,
GitHub issue trackers of the popular libraries, practitioner blogs and the "Gantt charts are a
lie" genre). Reddit was unreachable from the research environment; no Reddit quote is used.
Quotes are verbatim; sources are in § 14.

### 11.1 Pain points, by recurrence

1. **Dates move when I didn't ask, or don't when I did.** The top complaint in every product
   class. Asana's 2025 change to its shift setting: "renders dependencies useless for us",
   "destroys one of the most fundamental aspects of Asana that we rely on". Project's
   moderators explaining the same mystery for years: "if you entered any start dates manually,
   Project will automatically set a 'start-no-earlier-than' constraint"; "Why is project doing
   this? It's annoying." ClickUp's most-voted scheduling request since 2018 is that a task
   moved *earlier* should pull its dependents: "this borderline makes the tool unusable".
   OpenProject's own post-mortem: its engine could "push a successor to the future but [was]
   unable to pull a successor earlier". *Implication:* the objection is to hidden state and
   asymmetry, not to computation. Every date must trace to a visible cell; a typed date becomes
   a visible floor, never a silent constraint; shifting is symmetric; the gap is a lag. § 4.1 is
   built on this.
2. **Weekends, holidays and calendars mishandled.** ClickUp: "we have to manually move any
   tasks that fall on weekends", "on here since 2018, an almost-universal feature"; a toggle
   that "reduced tasks to one day"; Zoho paywalls working days ("insane"); Excel templates
   count seven-day weeks; Mermaid's `excludes` is off by one in four open issues with the
   highest reaction counts in its Gantt tracker. *Implication:* working-day arithmetic is core,
   one calendar feeds both the math and the drawn grid, durations survive a shift across a
   weekend, and the words are `WORKDAY` / `NETWORKDAYS`.
3. **Cells that won't take input; formulas at war with dependencies; locked parents.**
   Smartsheet: "When dependencies are enabled you cannot change the start and finish dates";
   "Stop assuming that FS means the next task has to start the next business day!"; formulas
   banned in the date columns; "can't schedule an end date of a parent task" (GanttPRO); "I
   can't set a task to depend on an aggregate task's end" (Instagantt). *Implication:* there are
   no locked cells in a pure function, only input and computed columns, visibly distinct;
   parents are derived; a user states facts ("starts 1 March and depends on 115") and the tool
   derives the consequence instead of overwriting.
4. **Can't pin a milestone; no floors.** Smartsheet, 2025: "no way to lock a milestone. It is
   one of the most critical features of scheduling. Can I upvote more than once?"; the ask is
   "FLAG it vs. moving the date". Migrants miss "start no earlier than". The professionals warn
   the other way: too many constraints "mask the logic". *Implication:* exactly two anchors,
   both visible data: a floor that participates in the start, a deadline that flags.
5. **Dependencies are hard to express.** Lag guessed in working days by hand; negative lags
   ("event date minus 20 weeks") that break critical-path highlighting; Airtable refusing
   same-day sequences and sub-day durations ("it doesn't take an entire day to purchase paint");
   Asana's link types that "don't currently seem to do anything"; ClickUp's top three requests
   are lag (932 votes), link types (814) and a dependency graph (853); the engineer's version:
   "if only I could find a tool that supports durations and not dates". *Implication:* `12FS+2d`
   is the lingua franca and its failure modes are fixable in a table: lag as a typed number,
   predecessors as a list, a computed *Driving* column answering "why is this task here?",
   durations first-class with zero-duration milestones and same-day sequences legal, the project
   start a single parameter so a plan is relative and re-anchors.
6. **Printing and sharing a readable chart.** "I can't tell you how many hours of my life I've
   spent resizing MS Project schedules to print"; "to print large projects I have to export to
   MSP and then print"; consultants who "do not accept this as a format"; the most-asked
   question on an MVP's blog is why a schedule prints across so many pages. *Implication:* the
   figure needs fit-to-width, a date window, a legible axis at every zoom, and clean SVG/PNG
   export. Contract submission formats (XER, MPP) are a segment this product does not serve, and
   the doc says so.
7. **Unreadable at scale; performance.** "600+ lines and over 1000 linked dependencies"; the
   Power BI visual caps at 1,000 rows; ProjectLibre and GanttProject choke past a thousand;
   "only 8% of the average gantt chart is used to actually tell a story". *Implication:*
   collapse by nesting and filter through the table are the primary legibility tools; the
   engine is tested at 1–5k rows.
8. **Undo, autosave, one slip.** "This auto save is so scary that I have to make screenshots of
   my plan"; "hours of work can be wiped out by the slip of a finger during a drag-and-drop";
   the most-reacted issue on Frappe Gantt is "disable drag". *Implication:* a functional model
   has nothing to undo but an input edit, provided the chart is not a drag surface with implicit
   re-parenting. Supports the "never" ruling.
9. **Percent complete means different things.** Smartsheet's duration-weighted roll-up
   surprises users; MPUG's 50% vs 37.5% worked example. *Implication:* no roll-up unless the
   weighting is a visible choice; `Complete` is bar fill and drives remaining duration.
10. **Modes and defaults that surprise.** Project defaults new tasks to manual ("a recipe for
    chaos" per an MVP); Asana's "don't auto-shift" switches off the whole project; a buffer
    setting that only activates after an "Update" click. *Implication:* one mode.
11. **Too heavy for small or solo work; cost; platform lock.** "A full Microsoft Project file is
    overkill, a spreadsheet doesn't paste well into chat"; OmniPlan is Apple-only and pricey;
    Project needs every reader to hold a license. *Implication:* the tinkerer's bar is "type
    five rows, see a chart, paste it in chat": zero-config defaults (five-day week, FS/0, start =
    today), a table first.
12. **DST, touch, accessibility** are the recurring library-level bugs (Frappe #110/#616,
    Bryntum's dozen DST issues, keyboard bar drag as an open request everywhere). *Implication:*
    integer calendar days, a today line that is a parameter, read-only on touch.
13. **"The plan is fiction after week two."** The anti-Gantt genre's point, and the defenders'
    answer (a plan that is cheap to regenerate from a table survives its second week) is the
    pure-function model's whole case.

### 11.2 Keepers (what users defend when they switch)

Everything downstream follows a change ("saves us a LOT of time"; "I will have to manually
reschedule roughly 200 tasks"; a blocker for Jira migrations from Project). Predecessors typed in
the grid. A gap kept in both directions ("the holy grail"). Anchors that flag rather than move.
A working-day calendar the math *and* the grid respect. The tree grid with Excel-style fill and
copy down (cloud is why people leave Excel; the grid is not). Milestones. Critical path and float
(the PMO segment: "the last thing I really miss"). A baseline ghost ("a schedule is not a
schedule unless it is baselined"). Print to one page, export as an image. The today line
(superintendents used "a fishing line and plumb" on the printout). Zoom levels and a date window.
Durations and relative dates rather than absolute dates (engineers). Excel round-trip. Dependency
arrows drawn on the chart. Simplicity itself, for solo users ("a free version of MS Project").

### 11.3 Segments, and which one this product is for

- **PMO and construction schedulers** (P6, Project): full CPM, constraints with documentation,
  per-resource calendars, baselines and a data date, contract deliverables in XER/XML, DCMA
  checks. Their complaints are about other people's misuse; their tools are dictated by
  contract; they actively avoid resource leveling ("do NOT use resource leveling, it causes too
  many problems that you're not able to decipher"). Not the buyer; the definition of correct.
- **Small teams** (Asana, monday, ClickUp, Notion, Jira Plans): cascade, buffer, weekends,
  re-anchoring a template to a due date, roll-ups. They never ask for critical path or baselines;
  they ask "why didn't it move". A warning about what not to build: modes, toggles, overlap-only
  rules.
- **Spreadsheet users** (Excel, Smartsheet, Airtable, Sheets): type in cells, use formulas, see
  conditional-format bars, copy down, export to Excel and PowerPoint. Their complaints begin the
  moment dependencies are switched on and cells lock. "The spreadsheet is the escape hatch from
  the scheduler."
- **Solo engineers and tinkerers** (Mermaid, text tools, GanttProject, OmniPlan): plain-text or
  table input, durations and relative dates, weekends handled, milestones, an exportable SVG, no
  accounts, local files. Mermaid's tracker holds the largest concentration of engineer Gantt
  complaints found (97 issues).

**This product is for the last two.** Their complaints converge on one sentence: *the schedule
should be data they can see and compute on, with a chart that follows*, which is what a pure
function of a tasks Cube gives for free (traceable dates, formulas anywhere, copy-down, Excel
export, durations not dates) plus a short deliberate list (a working-day calendar, a lag column,
floor and deadline columns, milestones, a baseline as a second frame, fit-to-page export).

### 11.4 Looks important, isn't used

Gantt charts inside general-purpose PM tools (Capterra's 2021 survey lists them among the
most-ignored features by those who have them). Resource leveling (practitioner consensus is to
avoid it and model contention with explicit links instead). Baselines are advocated by everyone
and done by about half (Wellingtone). Link types other than FS (Plan Academy: "stick to FS with
0 lag"; ClickUp's SS/FF request has 2 votes against 932 for plain lag): users want *lag*, not
exotic types. Critical-path highlighting outside the PMO. Percent-complete roll-ups (used,
distrusted). Mobile *editing* (people want to see the chart on a phone, not reschedule on one).

---

## 12. Scope

Run against the standing four tests and the mirror test ("inspectable, typed computation over
data, in a file the user owns"): the free incumbents (Google Sheets timeline, Excel templates)
*draw*; Project *computes* and costs $10–55 per seat per month, so the Alteryx pattern applies
and Project's product is one Solenoid verb. Test 4 (maintenance treadmill) is what bounds the
interchange list.

**In: the core (v1, phases 0–4).** A correct Days-mode schedule over a tasks Cube: names as
keys, nesting as WBS, Predecessors as a list or a nested Task · Type · Lag table, FS/SS/FF/SF
with lag, working calendars with holidays and the weekend code, floors, ceilings, deadlines,
Manual, milestones, Complete with a status date, summary roll-ups, float and free float,
critical and multiple critical paths, the driving predecessor, plain-named diagnostics, one
`#VALUE!` for structural failures and per-cell errors for per-row faults, the Mermaid `gantt`
source, `finish` as a date. Minutes mode in the engine, exercised by the MSPDI corpus. A
read-only Gantt figure on the `chart` socket: chip on the card, Display/popup/Report, tiers and
zoom presets, virtualized in the popup, capped on the canvas, bars/diamonds/brackets/progress/
baseline ghost, arrows, today and status lines, non-working shading, critical and violated with
non-color cues, options keys, SVG/PNG export through the existing webpage export, the treegrid
keyboard map behind `nokeys`. MSPDI read as a format, the predecessor grammar and Smartsheet CSV
at import. Scenarios as a second tasks frame; a baseline as a pasted or pinned frame joined back.

**Adjacent: packs, promoted by the author one at a time.** XER and `.gan` read; MSPDI write as a
sink; earned value (BCWS/BCWP/ACWP/SPI/CPI/EAC/VAC/TCPI over a baseline frame, a Complete column
and a status date, typed arithmetic that passes the mirror test); resources and assignments with
Work = Duration × Units, effort-driven recalculation and a resource histogram; inactive and
recurring tasks; P6's longest-path and float-path definitions; a by-row mode over cubes so a
portfolio Cube schedules row by row.

**Out.** Resource leveling (a heuristic, not an exact answer; Track H's rule; anything
solver-shaped belongs to the Optimize run mode; the practitioners avoid it). Bar dragging and
link drawing on the figure (the "never" ruling; the sweep's undo horror stories). Per-task
scheduling modes and project-wide shift toggles. Project's constraint types as user columns.
A calendar socket type. XER write, `.mpp`, PMXML, Asta, Phoenix, SDEF. PDF pagination. Mobile
editing. Multi-user live editing of a plan beyond what 2.0's document collaboration gives every
document. Being a PMO tool at all: contract-format submission is a segment this product does
not serve.

**The bar for "done" in v1:** every rule in § 3.1 that Days mode exercises passes its authored
scenario; the MSPDI corpus in Minutes mode agrees with Project's stored values, with every
disagreement named in `divergences.json`; the DCMA invariants hold on every fixture; the
remodel seed and the nested-Predecessors seed render in the popup and the Report and export as
SVG; Obsidian renders the Mermaid output of both.

---

## 13. Adversarial review record (what the first draft got wrong, and what changed)

Two red teams read the first draft: one against Solenoid's own rules, decisions and code, one
verifying the engineering claims against live sources and clones. The findings that changed the
doc, ranked by severity, so that the next reader does not relitigate them:

1. **The data model contradicted the author's Cube ruling** (`"3FS+2d"` tokens in a list cell
   are an in-cell string list; `id`/`parent_id`/`order`, `constraint`, `duration_unit`,
   `lag_unit` are MS Project's form). Fixed: § 6.1 is the Cube with nesting and a nested
   Task · Type · Lag table; the flat form is `Unnest` and the import shape.
2. **The figure cannot edit its source.** A chart value is flat JSON on a cable drawn by another
   node; values carry no provenance; derived tables have no literal. Fixed: § 6.4, the figure
   never writes; "no bar editing, ever" stands and is no longer softened.
3. **The corpus was misdescribed.** MPXJ's `junit/data` is mostly binary `.mpp`; the files the
   draft named are Primavera; the public Project-authored MSPDI-with-links set is about a dozen
   trivial files; provenance is unstated. Fixed: § 3.2, the corpus is authored, `.mpp` files
   are derived in CI and never redistributed, Planner Premium cannot export MSPDI.
4. **MPXJ is a second opinion, not an oracle.** "Not guaranteed" by its own docs; no finish-date
   scheduling, splits, constrained summaries, leveling or honor-constraints-off; validated on
   private files with exclusion lists. Fixed: § 3.2 uses its comparator and copies its
   `divergences` idea.
5. **Four rules were wrong or incomplete**: free slack is per link on the predecessor's
   calendar (not "min over successors minus own EF"); a deadline moves an ALAP task; rule 13
   lacked out-of-sequence progress and the split-remainder option; Project's unit is tenths of
   a minute. Fixed in § 3.1.
6. **A separate repository defeats the enforcement this project runs on** (path-routed docs,
   source-scan tests, one corpus directory, `npm ci` release path) and every cited precedent is
   a monorepo. Fixed: § 7, in-repo workspaces with an extraction trigger.
7. **Geometry in the payload cannot serve four widths; per-viewer state had no home.** Fixed:
   § 6.3, payload is data, layout runs in the view, options keys are the only persisted state.
8. **Day precision cannot be a display option; "exclusive internally" breaks cell arithmetic.**
   Fixed: § 6.5, Days and Minutes are engine modes, Finish is inclusive on the cell.
9. **Two ways to say "start no earlier than" with no precedence** (Start-as-floor and a
   `constraint` column). Fixed: § 4.1, one rule.
10. **Per-cell errors for cycles** contradicted the aggregate rule and would leave downstream
    tasks undefined. Fixed: § 6.1.
11. **Duration carrying a `day` unit through the FC** collides with date arithmetic; the
    `duration_unit`/`lag_unit` text columns were a second unit system. Fixed: § 6.1.
12. **The node family violated declare-once and reopened ruled-out items** (Schedule Check,
    Baseline, Work Calendar, Predecessors, Import/Write Project). Fixed: § 6.2, Schedule and
    Gantt only.
13. **Wrong figure home** (a 240-px wide card), no canvas-keyboard opt-out, no lazy chunk, no
    export path for a grid-plus-SVG figure, `@xyflow/system` named as a reusable base. Fixed:
    § 6.3, § 7.4.
14. **Sequencing against the P1 save-format freeze, the 2.0-plan Arc 8 "both backends" line,
    the AI palette's column contract, the tests to touch, the TaskNotes consumer** were missing.
    Fixed: § 6.2, § 8.

What the reviews confirmed and this doc keeps untouched: the § 0 landscape verdict; the four-part
decomposition; the pure-function model and the dissolution of the shift switch; serial and
minute integers with no `Date`; two-letter dependency types mapped at the codec; rejecting the
SVAR/DHTMLX embeds and the mid-tier forks; the § 5 port/study/never table and the license
discipline; the correctness test list as in-repo fixtures; options through Chart Builder keys;
WCAG 1.4.1 cues; keeping the Mermaid output; "a bar gesture would be a table edit" as the
principle if editing were ever reopened.

---

## 14. Sources (compact)

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

User sweep (§ 11): Asana Forum threads 1044376, 1048003, 1043731, 1027938, 98773, 66541, 98593,
1107285, 741136, 1053756, 215172, 65503; Smartsheet Community 76053, 29061, 133289, 98573, 44381,
87133, 28136, 90170; ClickUp Canny (limit-rescheduling-dependencies-to-business-days,
reschedule-dependencies-when-moving-the-task-to-an-earlier-date, category leaderboard); monday
community (problems-with-dependencies-and-lag); Airtable community 9375, 31874; Atlassian
community qaq-p/2245731 and JPOSERVER-3104; Microsoft Q&A 5295380, 5171631, Tech Community
3615903, excelgeneral 4294150, issues-with-leveling 3975482, Fabric m-p/2857881; Adobe Workfront
community 138267, 123247, 141267; Zoho exclude-weekends-from-task-dates; OpenProject
new-automatic-scheduling-mode; Omni Group discourse 10978, 42594; MacRumors 2294116; Planning
Planet 633970, 504350; Hacker News 1997442, 37766460, 42762699, 25564919, 26030879, 39881976,
7805029, 6611691, 25988635, 41546672, 24670475, 24081248, 39731795, 39626257, 39638505, 41035810;
Capterra reviews for TeamGantt, GanttPRO, Smartsheet, Instagantt, OmniPlan, GanttProject,
ProjectLibre, Gantter; SourceForge GanttProject; SoftwareFinder ProjectLibre; GitHub issues
frappe/gantt #110 #113 #151 #102 #136 #183 #221 #407 #598 #616, bryntum/support #289 #2847
#3613 #7885 #8517 #9437 #9440 #11591 #11659 #11769 #12076 #12913 #12974 #13119 #13167 #13321,
DHTMLX/gantt #109, mermaid #254 #314 #540 #1301 #2128 #2147 #2424 #2850 #3290 #3761 #6421;
sarahmhoban.com gantt-chart; and.digital trouble-with-gantt-charts; planandmanage.substack.com;
Yaniv Shor on LinkedIn; nordantech; scrum.org; dougfredericks.net ganttdown; planacademy
cringe-worthy-p6; tensix constraints logic masking; mpug top-five mistakes, 3-incorrect-ways,
percentage-complete, physical-complete, resource-leveling-explained; dalehowardmvp
manually-scheduled-tasks, printing-tips; Wellingtone State of Project Management 2024;
Capterra 2021 PM software user research.
Review verification (§ 13): mpxj.org howto-use-cpm; joniles/mpxj `src/main/java/org/mpxj/cpm/
MicrosoftScheduler.java`, `MicrosoftSlackCalculator.java`, `MicrosoftSchedulerComparator.java`,
`DepthFirstGraphSort.java`, `src/test/java/org/mpxj/junit/CustomerDataTest.java`, `build.xml`,
`junit/data` inventory; pypi.org/project/mpxj; jpype.readthedocs.io install; GitHub
actions/runner-images #10636; learn.microsoft.com answers 5849815, 5529307, 5025108,
tasks-not-scheduled, circular-relationship-error; Microsoft Store Project Professional 2024;
Tech Community Project Online retirement; schemas.microsoft.com mspdi_pj12.xsd; nasa/CertWare
mspdi_pj14.xsd; docs.oracle.com P6 schedule log 88257; managementyogi and
boyleprojectconsulting on out-of-sequence progress; Smartsheet help 765727, 504748; Microsoft
Unique ID Predecessors and Free Slack field pages; DHTMLX/gantt LICENSE.md, AGENTS.md,
CONTRIBUTING.md, `scale_manager.ts`, `link_render.js`; `@svar-ui/gantt-store` 2.7.2 tarball
and svar-widgets/gantt `store/src`; `@xyflow/system` 0.0.82 registry entry and README,
`XYDrag.ts`; igalia.com Temporal Stage 4; tc39/proposal-temporal; webkit.org STP 247/251;
bryntum.com javascript-temporal-is-it-finally-here; bundlephobia temporal-polyfill; Solenoid
`src/graph/canvasKeyboard.ts`, `flow/flowWheel.ts`, `flow/FlowSurface.tsx`, `canvasCapture.ts`,
`components/inlineRefDisplay.tsx`, `htmlCanvasRenderer.ts`, `nodes/kind.ts`, `nodes/dateSerial.ts`,
`docs/renderer-performance.md`, `docs/deferrals.md`, and a measured `vite build`.
