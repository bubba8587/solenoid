# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### SESSION DIGEST (2026-09-12b — adversarial review of the whole history; 59 fix commits)

The author's order: "adversarial review mode, walk commits backward, don't stop." Every
substantive commit from HEAD down to 1.0.0 was reviewed in chunks by read-only forks (each
confirming a finding with a throwaway probe where it could), findings were fixed by the Lead or
a fixer fork, and every fix carries a pin in `tests/graph/reviewPins.test.ts` or the nearest
suite. Nothing pushed. The suite is green (tsc + vitest) on the combined tree.

- **What stands, by class.** Security: an imported file can never grant itself network access;
  Data Feed and the SVG Picker's URL fetch go through the per-document gate; vault-relative
  and image-asset paths refuse `..` / roots; the SVG Picker scrubs markup at intake; the
  exported webpage escapes every user-typed name; Mermaid renders strict; Write File CSV
  neutralizes formula-trigger cells (one rule in `csvSafety.ts`); a File Link to a program or
  from a foreign document asks first. Value semantics: a wired blank is never 0 (computed-column
  side values, Monte Carlo ports, Waterfall / Candlestick / Calendar / Sparkline gaps); a
  sample spread of one value, a non-positive exponential fit, DROP of everything, SAVGOL with an
  even window, EWMA outside (0, 1], a negative RUNNING window are loud. Excel parity on the
  formula surface: CHOOSE / INDEX / SUBSTITUTE truncate; the T-bill trio, the *IFS family
  (wildcards, `~`, date-shaped criteria), WORKDAY.INTL masks, GCD / LCM / MULTINOMIAL /
  PERCENTRANK.* and the workday trio's holiday list, SORTBY length, COMBINA(0,0), DIAGONAL of a
  matrix, XIRR's date-order error, STDEV.S of one value, DATEDIF order, CONTAINS on a matrix, a
  blank optional argument as Excel's 0, numberToText's General thresholds. Engines: the Window
  verb's zero denominator and Replace Values' NaN agree across JS and Polars; the aggregate
  guard rides a rebased flush; Slicer's lazy path matches exactly. Schedule engine: milestone
  dates, empty splits, elapsed lags, MSPDI start / minutes finish, the XER calendar parser,
  GanttProject duplicate names, Repeat phases. Layout: a locked group's members hold under a
  standoff; Lock canvas gates every mutator; group shrink clamps to members; a stored card size
  clamps to the content minimum; drawn cables delete from the keyboard; the HIC snapshot routes
  flipped endpoints like the DOM. Units: two absolute temperatures combine to a delta, ×/÷/^ on
  an offset unit is refused, the reshaping verbs keep column units. Composite: goal seek keeps
  solver precision, Monte Carlo over a blank is blank, drill-in undo runs one at a time, chrome
  acts on the active graph, a marker is never copied. Nest Join blank keys never match. Knap
  template locals render. Cube Rollup takes a cube child. Write JSON dates are ISO.
- **List Input** — the popup-editor commit (758a2d70) was an unasked-for generalization; four
  fixes in one day each broke the card a new way. The card is back to its pre-editor form
  (`listInputChip.test.ts` pins rows-concatenate + the plain value box); the invariant and the
  backlog carry the author's later ruling (harmonize only if the behaviors hold; Save-to-rows is
  the open question).
- **Also this session:** the Gantt figure pass (type on the design rungs, fontsize scales text,
  the popup minimum, the grid pane follows the width; the hero chip centred through ONE shared
  row, `heroChipRow` pins it) and the Gantt Chart Builder target with every view key; the copy
  cut of every tooltip and description the new nodes added (63 strings; the Schedule column
  vocabulary and the Gantt option grammar moved to Help › Plans).
- **Documented, not changed (author's rules):** the three-valued logic cards vs Excel's AND/OR/
  NOT/IF, the distribution inverses' blank outside (0,1), UNIQUE 1-D only, SEQUENCE ≤ 0.
- **Surfaced for the author (backlog):** the List Input editor design; Manual / goal-seek
  composites solving on first load; the percent format carrying through arithmetic
  (formatFlowsDownstream as written); the Triangle Solver's bare-degree angle inputs; TEXTJOIN's
  blank ignore_empty; older long strings (the same copy class, a separate sweep).

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
  (`src/graph/help/knap.md`). Agent 3: frame-only verbs (Window / GROUPBY / Chart) now take a live cube —
  the LATTICE allows cube→frame and coerceInputs flattens a flat cube (a nested cell is a loud
  #SHAPE! naming the column). The author REFUSED the lattice change ("upgrade the sockets on each
  node, not vice versa"): reverted, and the three nodes got cube-adoptive inputs instead, the
  flatten inside data() (rules cubeNeverNarrowsToFrame). Last, Agent 3's Input Switch
  pending-reconnect store: a One↔Many retype-drop is remembered and the cable re-materializes on
  the flip back (same key, else label); the dashed ghost RENDER layer is the deferred last piece
  (backlog). Then
  Add Column made cube-adoptive like Computed Column (cube in → cube out, nested cells by reference);
  Minutes-mode date cells show their clock (a `CubeColumn.format` seam, the cube twin of the frame
  column's; Schedule stamps the datetime pattern in Minutes mode).
- Test lock between agents moved from a doc line (per-worktree, signals nobody) to the shared
  file `.dev/test-lock` in the main checkout.
- Open for the author: the eyeball list and the engine follow-ups in `backlog.md` § Gantt;
  Project-exported goldens for the corpus; whether Minutes-mode cells should carry a datetime
  format.

