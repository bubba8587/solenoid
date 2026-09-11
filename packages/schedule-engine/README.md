# @solenoid/schedule-engine

Headless project scheduling over a name-keyed task graph. Pure TypeScript, no `Date` object
anywhere: dates are whole-day serials (Excel's), time is an integer index on a working
calendar, and every pass is integer arithmetic on those indices. MIT.

## What it does

- **Calendar** (`calendar.ts`): a weekend pattern (Excel's `WORKDAY.INTL` codes), a holiday
  set, and a unit index space — the k-th working day at or after the anchor, negative for
  days before it (a lead can put a successor before the project start). **Minutes mode** adds
  a minute layer: working intervals inside the day (08:00–12:00, 13:00–17:00 by default), so an
  FS successor may start the same afternoon and a finish is the end of the last working minute.
- **Graph** (`graph.ts`): flattens a nested task tree (nesting = the work breakdown), builds
  the name-keyed DAG, expands a link whose successor is a parent onto every leaf beneath it,
  and refuses a cycle by naming a member.
- **Passes** (`cpm.ts`): forward and backward with FS / SS / FF / SF links and lags; the one
  rule — a typed Start is a floor, a typed Finish a ceiling (negative float, nothing moves), a
  Deadline a flag, Manual a pin that still drives successors; summaries roll up; Complete
  against a status date moves the remaining work; total float, free float per link, the
  driving predecessor, the critical set.
- **Diagnostics** (`diagnostics.ts`): the DCMA-style checks under plain names.
- **Mermaid** (`mermaid.ts`): a `gantt` block with exact dates, `excludes`, sections and tags.
- **Predecessor grammar** (`predecessors.ts`): `3FS+2d, 5SS-1w` parsed at the import border
  (row numbers resolve to names there and never become a key); the inverse for a grid.
- **MSPDI read** (`mspdi.ts`, `xml.ts`): Microsoft Project XML (pj14) — outline nesting, link
  codes (0 = FF, 1 = FS, 2 = SF, 3 = SS), lag in tenths of a minute, the eight constraint types
  onto Start / Finish / Manual, the base calendar's weekdays, exceptions and working times. The
  file's stored dates come back as `golden` for a parity test; unmodelled fields are named.

`fixtures/schedule/` in the repo root holds the corpus: hand-authored MSPDI files whose stored
dates the engine reproduces in both modes, and `divergences.json` for any field it may not.

## What was studied

Microsoft's "How Project schedules tasks" pages and the MSPDI schema; MPXJ's
`MicrosoftScheduler` (read for its rules on lag calendars, free slack per link and milestone
late dates — no code taken; MPXJ is LGPL); Bryntum's published scheduling scenarios and
DHTMLX 10's changelog as a list of edge cases; the DCMA 14-point assessment; Excel's
`WORKDAY.INTL` / `NETWORKDAYS`. The design and the rules it implements are recorded in the
Solenoid repo's `docs/v2.0/25-gantt.md` § 3 and § 6.

## Not in this package

Per-task calendars, split remainders for out-of-sequence progress, ALAP and multiple critical
paths, resource assignments and leveling, XER / `.gan` read, MSPDI write.
