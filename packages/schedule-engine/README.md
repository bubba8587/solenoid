# @solenoid/schedule-engine

Headless project scheduling over a name-keyed task graph. Pure TypeScript, no `Date` object
anywhere: dates are whole-day serials (Excel's), time is an integer index on a working
calendar, and every pass is integer arithmetic on those indices. MIT.

## What it does

- **Calendar** (`calendar.ts`): a weekend pattern (Excel's `WORKDAY.INTL` codes), a holiday
  set, and a unit index space: the k-th working day at or after the anchor, negative for
  days before it (a lead can put a successor before the project start). **Minutes mode** adds
  a minute layer: working intervals inside the day (08:00 to 12:00 and 13:00 to 17:00 by
  default), so an FS successor may start the same afternoon and a finish is the end of the last
  working minute.
- **Graph** (`graph.ts`): flattens a nested task tree (nesting is the work breakdown), builds
  the name-keyed DAG, expands a link whose successor is a parent onto every leaf beneath it,
  and refuses a cycle by naming a member.
- **Passes** (`cpm.ts`): forward and backward with FS, SS, FF and SF links and lags, under one
  rule ([[C70]] oneScheduleRule): a typed Start is a floor, a typed Finish a ceiling (negative
  float, nothing moves), a Deadline a flag, Manual a pin that still drives successors. Summaries
  roll up; Complete against a status date moves the remaining work; ALAP tasks start late; the
  output carries total float, free float per link, the driving predecessor and the critical set.
- **Diagnostics** (`diagnostics.ts`): the DCMA-style checks under plain names.
- **Mermaid** (`mermaid.ts`): a `gantt` block with exact dates, `excludes`, sections and tags.
- **Predecessor grammar** (`predecessors.ts`): `3FS+2d, 5SS-1w` parsed at the import border
  (row numbers resolve to names there and never become a key); the inverse for a grid.
- **File formats**: Microsoft Project XML (MSPDI) read (`mspdi.ts`, over the small reader in
  `xml.ts`) and write, GanttProject `.gan` read and Primavera XER read (`formats.ts`).

## The model

Names are the keys: a task is found by its name, trimmed and case-insensitive
(`nameKey`), so spelling is the only thing that can fail to match. Dates are whole-day serials,
durations and lags are working days, and nothing is a `Date`.

**A task** (`PlanTask`):

| Field | Meaning |
|---|---|
| `duration` | Working days; 0 is a milestone. |
| `predecessors` | `{ task, type, lag, elapsed? }`. `lag` is working days on the successor's calendar, negative for a lead; with `elapsed` it counts every calendar day (Project's `ed`). |
| `start` | A floor: the task starts no earlier (Project's SNET). |
| `finish` | A ceiling: caps the late finish (FNLT). Missing it shows negative float; nothing moves. |
| `deadline` | Caps the late dates and flags the task as late; never moves it. |
| `manual` | Pins start and finish (start plus duration when finish is blank) and ignores predecessors; successors are still driven. |
| `complete` | 0 to 100. |
| `group` | The section or project label. |
| `alap` | As late as possible: the task starts at its late start; a deadline pulls it earlier. |
| `actualStart` | The day work began; pins the early start and starts the done part. |
| `elapsed` | The duration counts every day, on a 24-hour calendar. |
| `work`, `units` | Effort-driven: with no duration, the duration is `work ÷ (units × 8)` days. `units` 1 is one full-time resource. |
| `calendar` | The task's own calendar layered over the project's (a different weekend, its own holidays, its own hours). Every task has a calendar. |
| `children` | The work breakdown. A parent's own duration is ignored (it rolls up); its own predecessors are kept for the DAG. |
| `row` | The source row, set by the caller for error messages. |

**The calendar spec** (`CalendarSpec`): `workingDays` (skip weekends and holidays, or count every
day), `weekendCode` (Excel `WORKDAY.INTL`: 1 is Saturday and Sunday through 7 Friday and
Saturday, 11 to 17 a single day), `holidays`, `precision` and `intervals`.

- **Days** (the default): whole working days. An FS lag of 0 means the next working day, and a
  finish is the last working day.
- **Minutes**: Project's model. `intervals` are the working spans of a day in minutes from
  midnight (default 08:00 to 12:00 and 13:00 to 17:00), and durations in days convert through
  their sum. `intervalsForHours(h)` builds a day of `h` hours from 08:00, with Project's lunch
  hour when the day is over 4 and at most 8 hours; a day over 16 hours starts earlier so it
  ends at midnight. An FS successor may start at 13:00 the same
  day, and a finish is 17:00.

**The input** (`ScheduleInput`): the tasks, the project `start`, the project calendar, and:

- `statusDate`: when set, Complete drives the remaining duration from this day.
- `criticalSlack`: the total-float threshold at or below which a task is critical (default 0).
- `multipleCriticalPaths`: Project's "Calculate multiple critical paths". Every task with no
  successor is its own tail (its late finish is its own early finish), so each independent chain
  is critical. Off by default: one project finish.
- `longestPath`: P6's definition. Critical means on a driving chain that ends at the project
  finish, whatever the float, so a task with float from a constraint can still be critical. Off
  by default: critical is total float at or below `criticalSlack`.
- `splitInProgress`: Project's "Split in-progress tasks", on by default. A started task's remaining
  work is a second segment after the status date and the done part stays where it was; off, the
  whole task runs contiguously from where its remainder can start.

**The output** (`ScheduleOutput`): tasks depth-first over the work breakdown in input order
within a level, links, the project span, diagnostics, and the non-working spans (inclusive, across
the project span), weekend days and holidays.

- A scheduled task's `start` is a whole-day serial in Days mode and a start instant (day plus
  clock) in Minutes mode. `finish` is inclusive: the last working day, or the end of the last
  working minute.
- `float` is total float in working days; it may be negative under a ceiling or deadline, and it
  is a fraction of a day in Minutes mode. `driving` is the predecessor that set the start, else
  null. `segments` holds the inclusive work parts when a task is split around the status date.
  `late` means the finish is past the deadline, `floored` that a typed Start held the task, and
  `wbs` is the `1.2.3` outline number.
- A link's `driving` means it set the successor's early start; `violated` means the successor's
  date breaks it because a floor or manual pin overrode it.

**Errors.** A whole-graph failure (a cycle, an unknown name, a duplicate name, a missing name, a
negative or non-numeric duration or Complete) throws one `ScheduleError` naming a member
([[E10]] pickVsAggregateErrors).

## How the passes work

1. **The graph** (`buildGraph`). The tree is flattened, names are checked for duplicates, and
   effort-driven durations are derived. A link whose successor is a summary is expanded onto every
   leaf beneath it (and collapses back to one authored link in the output). A parent depends on its
   children through its roll-up. Kahn's algorithm orders the tasks, children before parents and
   predecessors before successors; a leftover task names a member of the loop.
2. **Calendars.** One `Calendar` exists per distinct spec (`calendarKey`), so equal specs share an
   index space. A task's own spec layers over the project's, an elapsed task lives on the all-days
   calendar, and a summary uses the project calendar.
3. **Index space.** A unit is a working day (Days) or a working minute (Minutes). A task of
   duration d occupies units `[ES, EF)` with `EF = ES + d`. A milestone occupies nothing: it sits
   at the end of the unit before ES (its predecessors' finish) or on its own start.
4. **Links cross calendars through instants.** A predecessor's exclusive end is an instant (a
   serial). It maps onto the successor's calendar as the first unit at or after it, and the lag
   then counts on the successor's calendar, or in calendar days when elapsed. A sub-day lag counts
   in Minutes mode and rounds in Days mode.
5. **Forward pass.** A task with no links starts at the project start; a linked task's early
   start is the latest of its links and its floor, so a lead can put it before the project start. A summary's dates are the span of its children on its own calendar. An actual start
   pins the early start. With a status date, the remaining part cannot start before it; a done part
   of zero units is nothing to split off, so the whole task moves.
6. **Backward pass.** Every late finish starts at the project finish, on the task's own calendar,
   and is capped by a ceiling or a deadline, which shows as negative float rather than moving
   anything. A summary's late finish (from its FS and FF successors, its ceiling, its deadline)
   bounds each child's, mapped onto the child's calendar. A summary's late start cannot be pushed
   onto one child; it narrows the summary's float instead.
7. **ALAP** takes a third pass: the task starts at its late start, then everything downstream
   follows.
8. **Float, critical and dates.** Total float, free float per link, and the critical set follow
   from the passes (by threshold, or by P6's longest path). A milestone shows at its predecessors'
   finish: the end of the unit before its index, or a predecessor's own finish instant when that is
   later (another calendar's Saturday, say); in Days mode that is the finish day, the exclusive end
   less one. Its early and late dates read the same way.
9. **Links out**, one per authored dependency.

## The calendar in detail

- A serial's day is `Math.floor(serial + 1e-9)` (`dayKey`), absorbing float drift from round trips
  through milliseconds. `dayOfWeek` is 0 for Sunday to 6 for Saturday.
- `indexCeil(serial)` is the first counted unit at or after the serial: a typed date on a weekend
  snaps forward, the `WORKDAY` convention, and a snapped date takes the next day's first minute.
- `indexFloor(serial)` is the last counted unit at or before it. In Minutes mode a date-only
  serial means the end of that day, its last working minute.
- `indexFloorStart(serial)`, a link's late-start bound, is the last unit that starts at or before the instant.
- `exclusiveEnd(k)`, the instant work on unit k is over, is the next day (Days) or the following clock minute
  (Minutes). A successor may begin at the first unit at or after that instant on its own calendar.
- A ceiling "by 15:00" allows the minute 14:59 to 15:00 and no later, and 17:00 is the end of the
  16:59 minute.
- `nonWorkingSpans(a, b)` returns merged spans inside `[a, b]`, empty in calendar-days mode;
  `holidaysBetween(a, b)` returns the holidays inside it, ascending. `countBetween(a, b)` counts
  units inclusive of both ends, 0 when b is before a.

## File formats

**MSPDI read** (`readMspdi`, Project XML pj14).

- Tasks nest by `OutlineLevel`: a task at level L is the child of the nearest earlier task at
  L − 1. The level-0 project summary row and deleted rows (`IsNull`) are skipped.
- Link codes: 0 FF, 1 FS, 2 SF, 3 SS. `LinkLag` is in tenths of a minute and converts to working
  days, or to calendar days for an elapsed `LagFormat` (the even codes, `ed` and its kin);
  formats 19 and 51 are percent lags and 20 and 52 elapsed percent lags. An elapsed
  `DurationFormat` is stored in 24-hour days.
- The eight constraint types map onto the one rule: SNET (4) is a floor; MSO (2) a floor plus a
  pin; SNLT (5) and FNLT (7) a ceiling; ALAP (1) sets `alap`; ASAP (0) is the default. MFO (3)
  pins the finish and takes the start from the file, and FNET (6) is not modelled; both are named
  in `unsupported`.
- Calendars: the base calendar's weekdays (`DayType` 1 is Sunday), exceptions and working times.
  A derived calendar inherits its base's week, and its own weekdays and exceptions override it. A
  weekend no `WORKDAY.INTL` code can express falls back to Saturday and Sunday and is named in
  `unsupported`. A task with its own `CalendarUID` gets that calendar.
- A date reads as its whole day (Project's day is what the cell shows). With no `StartDate`, the
  project starts at the earliest stored task start, else serial 0.
- The file's stored dates and slack come back as `golden`, for a parity test. Every field the
  reader sees but does not model (a recurring task, a link to a missing task) is named in
  `unsupported`, so a divergence is visible ([[D68]] importUnsupportedIsNamed).

**`.gan` read** (`readGan`, GanttProject). Data sits in attributes: `<task id name start duration
complete>` nested by element nesting, and `<depend id type difference>` under the predecessor
(type 1 SS, 2 FS, 3 FF, 4 SF; `difference` is the lag in days). A repeated task name becomes
`Review (2)`, since names are keys. The calendar is the `<default-week>` flags under
`<day-types>`, with holidays as `<date>` under `<calendars>`.

**XER read** (`readXer`, Primavera). Tab-separated `%T` table, `%F` fields and `%R` rows. It
reads PROJECT, PROJWBS (the hierarchy), TASK, TASKPRED (`PR_FS` and kin, `lag_hr_cnt`) and
CALENDAR. A WBS node with children is a summary; one without is dropped. A calendar's
`clndr_data` blob is walked as balanced parenthesized groups (a lazy regex stops at the first
day's `))`): a weekday with no work times is off (P6 numbers Sunday 1), an exception with no work
times is a holiday (`d|` is the day serial, on Excel's epoch), and work times become the
intervals. Anything unparsable leaves the standard week.

**MSPDI write** (`writeMspdi`). Tasks by outline level, links as `PredecessorLink` with the
integer codes above, durations in hours, dates at 08:00 and 17:00, and the computed fields
alongside so a reader sees the same schedule. The whole holiday list is written (the caller passes
it, since the output holds only the holidays inside the span). In Minutes mode a finish exactly at
midnight is written as the end of the previous day, where the figure and the cells draw it.

**The XML reader** (`parseXml`) has no dependencies, since the test environment has no DOM. It
handles elements, text, CDATA, comments and entities, and no attributes, because MSPDI carries
everything as child elements. A mismatched close tag throws.

## Mermaid, diagnostics and the grammar

- **Mermaid** (`mermaidGantt`, the Obsidian path) writes exact dates on every bar and never
  `after`, which cannot carry a lag or a link type. Task names are labels, so Mermaid's syntax
  characters are removed. Summaries are skipped (their children draw), and each bar runs to the
  day after Finish, since Mermaid's end is exclusive.
- **Diagnostics** (`diagnose`) are the DCMA 14-point checks that fit a table of tasks, one row per
  finding (Check, Task, Detail) under plain names. A link on a phase counts for every task beneath
  it, so a leaf whose phase waits on something is not "unlinked". A long task is over 44 working
  days, DCMA's high-duration threshold, and so is high float.
- **The predecessor grammar** (`parsePredecessorText`) splits a cell at commas and semicolons.
  Each token is `<row><type><±lag><unit>`: a row number resolves through the 1-based row-to-name
  list (a token that is not a number is taken as a name, so a typed name list works too), the type
  defaults to FS, and the unit is `d` (default), `w` or `wk` (5 days), `h` (8 per day) or `ed` (an
  elapsed lag). An unreadable token is returned as an error. `predecessorText` is the inverse for a
  grid: names, with the type and lag only when they differ from FS with lag 0
  (`Demolition, Framing SS+2`).

## Fixtures

`fixtures/schedule/` in the repo root holds the corpus: hand-authored MSPDI files whose stored
dates the engine reproduces in both modes, and `divergences.json` for any field it may not.

## What was studied

Microsoft's "How Project schedules tasks" pages and the MSPDI schema; MPXJ's
`MicrosoftScheduler` (read for its rules on lag calendars, free slack per link and milestone
late dates; no code taken, MPXJ is LGPL); Bryntum's published scheduling scenarios and
DHTMLX 10's changelog as a list of edge cases; the DCMA 14-point assessment; Excel's
`WORKDAY.INTL` and `NETWORKDAYS`. The design and the rules it implements are recorded in the
Solenoid repo's `docs/v2.0/25-gantt.md` § 3 and `tree/specs/computation/schedule-and-gantt.md`.

## Not in this package

Resource leveling.
