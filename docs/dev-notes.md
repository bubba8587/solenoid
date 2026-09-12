# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### SESSION DIGEST (2026-09-12 — the Gantt surface: engine, figure, nodes, import; three agents)

The author's order at 01:15: build the entirety of the Gantt surface from `v2.0/25-gantt.md`,
no questions, all night. Three agents: the Lead (engine + Schedule binding + import + seeds +
docs), Agent 2 (the layout and React packages), Agent 3 (the Gantt node and every app surface).
Everything landed on `develop`; nothing pushed. The plan's § 10 calls were taken as recommended.

- **`packages/`** — three in-repo MIT workspaces resolved by alias (tsconfig `paths` relative,
  the TypeScript 7 rule; Vite + vitest aliases), so `npm ci` and the desktop build are untouched
  (decisions ganttPackages). `schedule-engine`: calendar in unit index space (negative indices
  for leads; a day layer and a minute layer), WBS flatten + Kahn, the CPM passes with the one
  rule (decisions oneScheduleRule), typed links with lag and lead, summary roll-ups with links
  both ways, Complete against a status date, total + free float per link, the driving
  predecessor, plain-named diagnostics, Mermaid, the predecessor grammar (border only), MSPDI
  read with its own small XML reader. **Days and Minutes modes** — Minutes is Project's
  08:00–17:00 model; the hand-authored MSPDI in `fixtures/schedule/` reproduces in both.
  `gantt-layout` / `gantt-react`: the data-only payload contract (`payload.ts`), fit zoom,
  tiers, brackets, diamonds, pennants, hatch + outline cues, arrows, virtualized popup rows, the
  headless SVG.
- **Schedule** rebound to the engine: new inputs `weekend_code` / `status` / `hours`, a
  `diagnostics` frame, the Days | Minutes toggle (`precision` persists), fifteen appended
  columns (+ WBS / Level / Summary when nested), a typed Start / Finish replaced in place, text
  dates through `parseDate` (an ambiguous one is the schedule's error). **Gantt** node (Agent 3):
  the chip-on-card figure with Holidays / Weekend / Status inputs, the `gantt` Chart Builder
  target, `.nokeys`, the `data-chart-svg-provider` seam so a Report's webpage export and Write
  to Obsidian pull the figure's SVG even though the card draws nothing. **Local File** gained a
  `plan` cube socket: a Project XML or a row-number-grammar CSV comes out as the nested tasks
  cube (`planImport.ts`), the flat outline on `frame`.
- Seeds: `product-launch-gantt` (phases, SS+2, FS−3, deadline, pin, status date), a Gantt in
  `remodel-gantt` and `kitchen-remodel-tasknotes`; all three tuned. Screenshots of the live app
  (dev server, headed Edge) drove three review rounds on the figure: columns drop instead of
  clipping, content-width split, critical hatch, brackets, the Days column from the payload's
  working-days duration. Found by looking, not by tests: the Cube Input's ISO date strings were
  not parsed (Board review fell to the project start) and Diagnostics called a phase's children
  unlinked.
- Export verified on the live app by probing the app's own module instance (a Vite dev
  server serves an HMR-invalidated module under a `?t=` URL, so a bare dynamic import from a
  probe is a SECOND instance with an empty provider map — the first probe's false alarm): the
  Gantt node and its Display both serve the whole-chart SVG through the provider seam. Two
  more mapper fixes from looking: a milestone on its predecessor's finish day is not a broken
  link (the calendar-day rule was too strict), and a phase's Duration is filled with its
  rolled-up working days so the grid's Days column is right.
- Engine additions after the ledger was first written: `multipleCriticalPaths` (every
  successor-less leaf is its own tail; no card control yet) and a summary's SS/SF successors
  bounding the summary's own late start (its float, never a child's late dates).
- Late slices: the Schedule card's One path | Every path toggle (Agent 3) and the tree grid's
  keyboard map (Agent 2: roving tabindex, arrows / Home / End, Left / Right fold and unfold a
  phase, Enter / Space toggle, the active row's bar scrolled into view, aria-level / -selected /
  -expanded, all behind `.nokeys`).
- Second wind (the author: "the entirety, both solutions"): the engine gained per-task calendars
  (each task its own index space, links crossing by instant), elapsed time, ALAP, split
  remainders with an Actual start (Project's split-or-move option as the card's fourth toggle),
  MSPDI's ALAP / elapsed / ActualStart / CalendarUID; Agent 3 built the § 10 call-2 alternative
  (a Links frame input) and found Unnest lacked a list-cell branch (the plan assumed it); Agent
  2 built split bars, minutes-mode midnight finishes and the calendar month-grid sibling.
  Then the formats: GanttProject and Primavera XER read, MSPDI write with a pinned round trip;
  P6's longest path on the card, Work ÷ Units durations, inactive rows, recurring rows, XER's
  calendar blob; the known-bug regression list and DCMA checks over the corpus as tests; Agent
  2's resource histogram and fit=page export; the launch seed names who does each task; Agent 3's
  Earned Value node (holidays honored through the engine's Calendar; `unitAware` so the Cost
  currency carries) and Write File's Text target (the MSPDI sink), the By-Row cube branch for
  portfolios. Wrapped 02:55: full suite 5676 green, tsc clean, 90-odd commits on develop, nothing
  pushed. After the wrap, two backlog items off the Obsidian list (Agent 2): the mail-merge batch
  cap surfaced ("Wrote 500 of N" on the sink, "first 500 of N" on the stepper) and the Knap help tab
  (`help/knap.md`). Agent 3: frame-only verbs (Window / GROUPBY / Chart) now take a live cube —
  the LATTICE allows cube→frame and coerceInputs flattens a flat cube (a nested cell is a loud
  #SHAPE! naming the column). A lattice change: for the author to confirm in the morning.
- Test lock between agents moved from a doc line (per-worktree, signals nobody) to the shared
  file `.dev/test-lock` in the main checkout.
- Open for the author: the eyeball list and the engine follow-ups in `backlog.md` § Gantt;
  Project-exported goldens for the corpus; whether Minutes-mode cells should carry a datetime
  format.

