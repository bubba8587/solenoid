---
aliases: ["Schedule and Gantt"]
tags: [spec, computation]
---
<!-- [[C70]] oneScheduleRule, [[C69]] ganttPackages, [[C71]] noBarEditing, [[D65]] serialsNeverDate, [[D66]] daysMinutesModes, [[D67]] grammarOnlyAtBorder, [[D68]] importUnsupportedIsNamed, [[E10]] pickVsAggregateErrors, [[D13]] widenNeverNarrow, [[C63]] oneRecordNode, [[C8]] declareOnce, [[C38]] sinkRunButtonOnly -->

# Spec: Schedule and Gantt

Serves [[C70]] oneScheduleRule and [[C69]] ganttPackages. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

A plan in Solenoid is a table of tasks, one row per task, and the schedule is a pure function of that table. The Schedule node reads the table and appends the computed dates; the Gantt node reads the scheduled table and draws it. The figure never writes back ([[C71]] noBarEditing), so the table is the only thing a user edits.

Code: `src/graph/nodes/schedule.ts` (the Schedule node), `src/graph/scheduleCpm.ts` (reads the tasks cube into the engine's model and writes the computed columns back), `src/graph/nodes/gantt.ts` with `src/graph/ganttPayload.ts` (the Gantt node and its payload), `src/graph/planImport.ts` (plan files into the tasks cube, used by Local File in `nodes/connection.ts`). The engine and the figure are the three in-repo packages of [[C69]] ganttPackages, each with its own contract: `packages/schedule-engine/README.md` (the passes, the calendar, the file formats), `packages/gantt-layout/README.md` (the payload fields and the layout) and `packages/gantt-react/README.md` (the figure and its option keys). The Gantt node's place among the figure nodes, its option defaults, its popup and its export are in [[chart-figures]]. This spec does not restate them.

## The tasks cube

A plan is a Cube. Names are the keys: every task name is unique, matched trimmed and case-insensitive, and there are no numeric ids, which would be ambiguous with row numbers and break under Sort or Filter ([[D67]] grammarOnlyAtBorder). A Frame wired into the `tasks` socket widens to a Cube ([[socket-lattice]]).

Columns are found by name, case-insensitive; the first alias in each row below that matches wins.

| Column (aliases) | Read as | Meaning |
|---|---|---|
| Task (`name`, `title`; else the first column holding text) | text | The task's name. Required, unique, never blank. |
| Duration (`days`; else the first numeric or united column that is not a date column and not named in this table) | number | Working days. Blank or 0 is a milestone. A cell holding a time unit value converts through hours per day; any other unit is an error. A parent's Duration is ignored, since it rolls up. |
| Predecessors (`predecessor`, `after`, `depends on`, `blockedby`, `blocked by`) | list, text or nested table | The tasks that come first. See [Predecessors](#predecessors). |
| Tasks (`children`, `subtasks`, `steps`; else a column of nested tables that have a Task column) | nested table | The row's children. See [Hierarchy](#hierarchy). |
| Start | date, optional | A floor: the task starts no earlier. |
| Finish (`end`) | date, optional | A ceiling: caps the late finish. A task that cannot meet it shows negative float and nothing moves. |
| Deadline (`due`) | date, optional | A flag. It caps the late dates and marks the task late; it never moves the task. |
| Manual (`pinned`) | logical, optional | Pins Start and Finish (Start plus Duration when Finish is blank) and ignores the task's predecessors. The pinned task still drives its successors. |
| Complete (`% complete`, `percent complete`, `done`, `progress`) | number, optional | 0 to 100. Drawn as the bar's fill. With a status date it drives the remaining work. A non-number reads as 0. |
| Project (`section`, `group`) | text, optional | One Mermaid `section` and one figure band per value. |
| ALAP (`as late as possible`, `late as possible`) | logical, optional | The task starts at its late start. |
| Actual start (`started`, `started on`) | date, optional | The day work began; pins the early start. |
| Elapsed | logical, optional | The duration counts every calendar day. |
| Work (`effort`, `work (h)`, `hours of work`) and Units (`assignment`, `fte`) | number, optional | With no Duration, the duration is Work ÷ (Units × hours per day) days. Units defaults to 1 and is at least 0.01. |
| Weekend (`weekend code`), Hours (`hours per day`), Holidays (`days off`) | number, number, date list | The task's own calendar, layered over the project's. |
| Active (`included`) | logical, optional | A row whose Active cell is set and false is left out of the schedule, and its computed cells are blank. |
| Repeat (`occurrences`, `times`) and Every (`every (days)`, `interval`, `period`) | number, optional | A childless row with Repeat above 1 becomes a parent of that many occurrences, named `<Task> 1`, `<Task> 2` and so on, each starting Every calendar days (default 7) after the one before. The first occurrence takes the row's predecessors. |
| Anything else (color, notes, url, resource names) | passthrough | Never read by the engine. |

Logical cells read true for `true`, a nonzero number, or the text `true`, `yes`, `y`, `1` or `on` (`readLogicalCell`, which the Gantt also reads its Summary, Critical, Late and Manual cells with). A date cell may be a serial or text; text that parses two ways or not at all is an error.

### Predecessors

A Predecessors cell takes one of three shapes:

1. **A list of task names.** Each is a finish-to-start (FS) link with lag 0. This is the TaskNotes `blockedBy` shape.
2. **Text.** The whole text is one task name, FS with lag 0. A Frame cannot hold a list, so a frame-only plan names one predecessor per cell.
3. **A nested table** with a Task column and optional Type, Lag and Elapsed columns (`link` or `kind` for Type; `lead` or `offset` for Lag). Type is `FS`, `SS`, `FF` or `SF` (default `FS`); Lag is in working days on the successor's calendar, negative for a lead, and counts calendar days when Elapsed is true. An unknown type or a lag that is not a number is an error naming the task.

A predecessor is never a grammar string inside a cell. `3FS+2d` exists only at the import border, where row numbers resolve to names ([[D67]] grammarOnlyAtBorder).

The Schedule node's `links` socket takes the same dependencies as a flat Frame, one link per row: a Successor column (`task`, `to`), a Predecessor column (`predecessors`, `from`, `after`, `depends on`), and optional Type (`link`, `kind`) and Lag (`lead`, `offset`) columns. A row with a blank successor or predecessor is skipped. Its links are added to each task's Predecessors, and the output cube's Predecessors column carries the merged list (a level with no Predecessors column gains one), so a Gantt downstream draws them. A missing Successor or Predecessor column, a successor that is not in the plan, an unknown type or a non-numeric lag is an error. This flat form is what `Unnest` of the cube on Predecessors produces, and it is the shape of the import and export formats.

### Hierarchy

Hierarchy is nesting. A parent row holding its children as a nested table is the work breakdown, at any depth, which Cube Input already edits (drill in on the breadcrumb, `+ Col`). The engine flattens the cube for the dependency graph. A parent's dates roll up from its children, and a link to a parent applies to every leaf beneath it. Because names are global, a dependency may name a task in any subtree.

There is no `parent_id`, indent level or `1.2.3` WBS column in a plan. Those exist only in import formats (MSPDI `OutlineLevel`, XER's PROJWBS) and are converted to nesting in one pass. There is no `order` column: row order is the order, and Sort exists.

A portfolio is a cube of projects, one row per project with its tasks nested. The composite by-row mode iterates a cube's rows (`byRowValues`), so a portfolio can be scheduled one project at a time.

## The Schedule node

The Schedule node is in the Add menu's Plan category.

| Input | Type | Default and meaning |
|---|---|---|
| `tasks` | cube | The tasks cube. Anything that is not a cube after coercion gives null on every output. |
| `links` | frame | Optional flat dependencies, added to Predecessors. |
| `start` | date | The project start. Unwired, it is today's local day (`todaySerial`). A wired value that is not a finite number gives null on every output. |
| `holidays` | date list | Days to skip alongside the weekend. Read only in Working days mode. The Holidays node feeds it. |
| `weekend_code` | number | Excel's `WORKDAY.INTL` code: 1 is Saturday and Sunday (the default), 2 is Sunday and Monday, 11 to 17 a single day off. |
| `status` | date | The status date. Work left on a started task is scheduled after it. Unwired, Complete only fills the bars. |
| `hours` | number | Hours in a working day, default 8 (a value of 0 or less reads as 8). It converts hour durations and Work, and in Minutes mode it is the length of the working day from 08:00 (a day longer than 16 hours starts earlier, so it ends at midnight). |

The calendar is not a new socket type and not a separate node. The Schedule node takes what the Workdays node takes, `weekend_code` and `holidays`, over the one working-day implementation the app shares.

The card has four options, each persisted with the node:

| Option | Values | Meaning |
|---|---|---|
| Mode | Working days (default), Calendar days | Whether durations skip the weekend and holidays or count every day. |
| Precision | Days (default), Minutes | See [Dates and precision](#dates-and-precision). |
| Critical | One path (default), Every path, Longest path | One path measures float against the project finish. Every path makes each task with no successor its own tail, so each independent chain is critical (Project's multiple critical paths). Longest path marks the driving chain that ends at the project finish, whatever its float (Primavera's definition). |
| Progress | Split the rest (default), Move the whole | With a status date, a started task either keeps its done part in place and schedules the rest as a second piece after the status date, or moves as one piece. |

| Output | Type | Meaning |
|---|---|---|
| `cube` | cube | The input cube with the computed columns. |
| `finish` | date | The project finish. |
| `diagnostics` | frame | One row per finding, columns Check, Task and Detail. Its shape is declared statically (`frameShape`). |
| `gantt` | string | Mermaid `gantt` source: what Obsidian renders natively. |
| `mspdi` | string | The schedule as Microsoft Project XML, for a writer node to save. |

The Tasks socket's doc is the column contract for the AI palette, since a cube input has no `frameHints` mechanism. The `links` socket carries a `frameHints` example.

### The one rule

Every run recomputes the whole schedule from the table, and four visible columns carry one rule each ([[C70]] oneScheduleRule): Start is a floor, Finish is a ceiling, Deadline is a flag, and Manual is a pin. A gap between two tasks is a lag on the link between them. There are no constraint-type columns, no per-task scheduling mode and no project-wide shift switch. The passes that apply the rule are in the schedule-engine README.

### Computed columns

The output is always a Cube, even when a Frame came in ([[D13]] widenNeverNarrow). Computed columns are appended after the input columns. Each level of the nesting gets its own:

| Column | Type | Meaning |
|---|---|---|
| Start, Finish | date | The scheduled dates. They replace the input's Start and Finish columns. A typed Start that held reads as typed. Finish is inclusive. |
| Float | number | Total float in working days: the slip that keeps the finish. Negative under a Finish or Deadline the predecessors cannot honor. |
| Critical | logical | On the critical path, by the card's Critical option. |
| Free Float | number | The slip that moves no successor. |
| Early Start, Early Finish, Late Start, Late Finish | date | The forward and backward passes. |
| Driving | text | The predecessor that set the start, answering "why is this task here?". Blank when none did. |
| Late | logical | The finish is past the Deadline. |
| Segments | nested table | Only when some task is split around the status date: each task's Start and Finish parts. |
| WBS, Level, Summary | text, number, logical | Only when the plan nests: the outline number (`1.2.3`), the depth, and whether the row is a parent. |

A parent's Duration cell is replaced by its rolled-up duration; a level with parents but no Duration column gains one at the front. A row generated by Repeat gains a Tasks column holding its occurrences. In Minutes mode the date columns carry a date-time format.

A cube output has no static shape (`frameShape.ts` has none for cubes), so Computed Column and Get Column pickers downstream see nothing until the value flows. Get Column on the nested Predecessors column errors `#SHAPE!`.

### Errors

Every error the Schedule node raises is one `#VALUE!` on every output, `diagnostics` included, and its message names the task or row ([[E10]] pickVsAggregateErrors). That covers:

- structural failures: a dependency loop, an unknown predecessor name, a duplicate name, a row with no name, and a Links frame that names a task not in the plan;
- row faults: a Duration that is negative, not a number or a non-time unit, a date that parses two ways or not at all, and an unknown link type or non-numeric lag;
- a table with no Task column ("Schedule needs a Task column (text) naming each task"), or with no Duration, Work or child column.

No task in a loop has a defined start, so nothing downstream of one does either. A constraint conflict is not an error: it shows as negative float, a Negative float diagnostic, and the Late flag.

### Diagnostics

The checks are the DCMA assessment's that fit a table of tasks, under plain names. They run over leaf tasks and links:

| Check | When |
|---|---|
| Manual | The task is pinned; its predecessors are ignored. |
| No predecessor, No successor | The task (or a parent above it) has no incoming or outgoing link, in a plan of more than one leaf. Not raised for a Manual task. |
| Held by a typed start | A typed Start held the task later than its predecessors needed. |
| Negative float | Float is below 0. |
| High float | Float is over 44 working days. |
| Past deadline | The finish is past the Deadline. |
| Long task | The duration is over 44 working days. |
| Should have started, Should have finished, Finished early | With a status date: no progress on a task that starts on or before it; a task that finishes before it but is not complete; a complete task scheduled to finish after it. |
| Lead, Lag | A link with a negative or positive lag. |
| Link type | A link that is not FS. |
| Broken link | A floor or a pin overrode the link, so the successor breaks it. |

### What is not a node

- Checks are the `diagnostics` output, not a separate node ([[C8]] declareOnce).
- A baseline is a second scheduled table (a pasted Frame or Cube Input, or a pinned value) wired into the Gantt's `baseline`, not a node that stamps a clock inside `data()`.
- A work calendar is `weekend_code` and `holidays`, not a socket kind.
- There is no Predecessors node; the cell is the predecessor list.
- Reading a plan file is a format on Local File, not an Import Project node. Writing one is the `mspdi` output into a writer, which acts only from its Run button ([[C38]] sinkRunButtonOnly).

## Import at the border

Local File reads a Microsoft Project XML (MSPDI), GanttProject `.gan` or Primavera XER file (`planFileToPlan`) and emits its tasks twice: as a tasks cube on the `plan` socket (`planToCube`) and as a flat frame on `frame` (`planToFrame`, one row per task with Task, Level, Duration, Predecessors, Start, Finish, Deadline and Complete). A CSV whose Predecessors column (`predecessor`, `depends on`, `after`) uses the row-number grammar in every filled cell, Smartsheet's export, also comes out as a plan (`csvPlanToCube`): each token resolves through the row-to-name list to a task name. A CSV that is not a plan gives a null plan and stays a frame.

In the cube, a task whose dependencies are all FS with lag 0 gets a list of names; any typed, lagged or elapsed dependency makes the cell a nested Task, Type, Lag (and Elapsed) table. Optional columns (Start, Finish, Deadline, Manual, Complete, Actual start, ALAP, Elapsed, Weekend, Hours, Holidays, Project, Tasks) appear only when some task uses them. A field the reader cannot model is named in `unsupported` and shown on the card as "Not carried over: …", never dropped and never a new column ([[D68]] importUnsupportedIsNamed). The per-format rules (link codes, constraint mapping, calendars) are in the schedule-engine README.

### Link grammar stays at the border

Inside the engine a predecessor is a structured record keyed by task name (`{task, type, lag}`). The `3FS+2d` link grammar, the vendors' integer link-type codes (MSPDI, .gan and XER each number them differently), and row numbers or UIDs are parsed at each importer and never become an internal key or a stored string. An importer is a parser to that one record shape, and an exporter renders from it. Three vendors number link types three different ways, and a row number breaks as soon as the table is sorted or filtered, while a name survives both; the author also ruled out lists stored as strings inside a cell ([[C70]] oneScheduleRule). **Reopen if:** a plan needs links to tasks that have no name; ids would then be minted, and they would still not be row numbers.

## The Gantt figure

The Gantt node reads a scheduled table and emits a `chart` value of kind `gantt`. Its sockets, its column reading and its title are in [[chart-figures]] § Gantt; its inputs are `schedule`, `baseline`, `holidays`, `weekend_code` (default 1), `status` and `options`. It computes no dates, and it reads the computed columns by name, so a Filter or Sort between Schedule and Gantt still draws.

### The payload is data

The value's payload is data, not geometry: scheduled rows as serials, links, non-working spans, the critical, violated and late flags, the nesting and the view options. The figure lays itself out at the width it is given, because a precomputed pixel frame would be wrong at three of the four places a figure draws (the 240 pixel card, the resizable Display, the popup, the Report column). `gantt-layout` runs inside `ChartFigure` against the measured width, and the headless export is the same layout at a chosen width.

`ganttPayloadFromSchedule` also decides these edges:

- A baseline is a second scheduled table joined to the plan by task name. A baseline that is not a plan draws no ghost bars.
- A link is critical when it is the successor's Driving link and both ends are Critical. A link is violated only where the break is visible on the dates: on whole-day serials an FS successor that starts on its predecessor's finish day breaks the link, except for a milestone and in Minutes mode. A lead is never violated.
- The shaded non-working spans and holidays extend 14 days beyond the plan on each side, so a padded window still reads right. The shading follows the Gantt's own `weekend_code` and `holidays`, which the same Holidays node can feed.
- The view is in Minutes mode when any start or finish carries a clock fraction.
- An ambiguous or unreadable `window` bound means no window, since it is a view option, not a value.

### Where it draws

The Gantt card shows only the `[Chart]` chip, as Record does, because the figure would be squashed at card width ([[C63]] oneRecordNode). The figure draws in the resizable Display, the expand popup and a Report embed. Outside the popup it draws at most 60 rows (`CANVAS_CAP`), because the HTML-in-Canvas renderer rasterizes a figure card ([[html-in-canvas]]) and a scrolled virtualized child would clone blank. The popup virtualizes, so it is where thousands of rows scroll.

### How it draws

The tree grid and labels are HTML with the ARIA `treegrid` roles and a keyboard map. The timeline is three layered SVGs over the content: the non-working shading, the bars (bars, diamonds, summary brackets, progress and baseline ghosts), and an overlay for dependency paths, where each path has a wide invisible hit path that carries the pointer events. A resource histogram, when on, is a fourth SVG below.

The figure's root carries `nowheel`, `nodrag` and `nokeys`, so wheel, drag and keys stay in the figure ([[react-flow-surface-contract]]). `canvasKeyboard.ts` ignores keys whose target is inside a `.nokeys` element, except F9, so a focused grid cell does not nudge nodes or open the Add menu.

Colors follow DESIGN.md. A critical bar carries a hatch pattern and a violated or late bar a dashed or solid flag outline as well as a color (WCAG 1.4.1). Weekend and holiday shading use the neutral ramp. The figure is one lazy chunk, `@solenoid/gantt-react`, reached only by dynamic import.

### Options

View options ride the `options` string and the Chart Builder's `gantt` target, with matplotlib-style keys (`zoom`, `tiers`, `fit`, `window`, `collapse`, `critical`, `baseline`, `arrows`, `today`, `status`, `weekends`, `group_by`, `labels`, `week`, `fiscal_start` and the rest). The key list and defaults are in [[chart-figures]] and the gantt-react README. Those keys are the only persisted view state; zoom, scroll and expand or collapse beyond them are ephemeral React state.

### Export

The webpage export and Write to Obsidian take a figure's SVG from a registered serializer. The Gantt registers `ganttSvg`, a second, pure renderer from payload to a standalone SVG string at a fixed width, which the popup's Copy SVG also uses ([[chart-figures]] § Exports). A PDF is the browser's print of the exported page; the app has no PDF path.

## The figure never writes

There is no bar editing: edits happen in the table ([[C71]] noBarEditing). It is also the only rule that can be built. A chart value is flat JSON on a cable, the figure is drawn by a different node than the one that owns the literal, values carry no provenance, and a plan that arrives through Filter or Join has no literal at all. The editor is the Cube Input popup, which already has drill levels and commits on Enter or blur, and snapshot undo covers it. What is lost is one gesture (dragging from one bar to another to make a link); the Predecessors cell covers its function.

## Dates and precision

Dates are Excel serials with a fractional day, zone-less local days. The engine converts a serial to integer working-day or working-minute indices once at the boundary, never compares two serials directly, and never constructs a `Date` ([[D65]] serialsNeverDate), which removes the daylight-saving bug class. The ISO date-times and `xsd:duration` strings at the MSPDI boundary are parsed by hand; no Temporal is needed.

### Integer serials, never a Date

The schedule engine and the Gantt layout compute on day serials with integer arithmetic and never construct a JS `Date`. A serial converts once, at the border (import and display), and serials are never compared as floating-point numbers. Minutes mode works in whole minutes within the day, still on the serial. Every Gantt library surveyed has the daylight-saving off-by-an-hour class of bug, because it schedules with `Date`; integer serials can't have it. This is [[C44]] dateSerials applied where it matters most. **Reopen if:** a time-zone-aware schedule is wanted; the border would then grow a time zone, and the engine still wouldn't.

Precision is an engine mode, chosen on the card, never a display snap ([[D66]] daysMinutesModes):

- **Days** (the default) schedules whole working days. An FS link with lag 0 starts the successor on the next working day, and a finish is the last working day of the task, so `Finish − Start + 1 = Duration` holds on the cells, the `WORKDAY(Start, Duration − 1)` every Excel template computes.
- **Minutes** schedules in working intervals of `hours` per day from 08:00 (with a lunch hour for a day of more than 4 and at most 8 hours), so an FS successor may start the same afternoon and a duration may be a fraction of a day.

Finish is inclusive on the cell in both modes: a cell is the value, Get Column returns what the engine wrote, and there is no internal and display split. In Minutes mode a finish at midnight shows on the previous day, so a finish of 00:00 on a 24-hour calendar lands on the right day. The figure adds one day when it draws a bar's end.

## Tests

`packages/schedule-engine/src/*.test.ts` (the engine, the rules, Minutes mode, the file formats and the regression corpus in `fixtures/schedule/`), `packages/gantt-layout/src/*.test.ts`, `tests/graph/scheduleCpm.test.ts`, `tests/graph/nodes/schedule.test.ts`, `tests/graph/planImport.test.ts`, `tests/graph/ganttPayload.test.ts`, `tests/graph/nodes/gantt.test.ts` and `tests/graph/ganttBuilder.test.ts`.
