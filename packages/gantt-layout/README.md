# @solenoid/gantt-layout

Pure Gantt geometry. A data payload plus a width in, a plain-number render frame out (time-scale
tiers, rows, bars, links, non-working shading), and a standalone SVG serializer for headless
export. No DOM, no React, and no `Date`: every date is an Excel day serial and all calendar math
is integer, so no timezone or DST can shift a column.

## The contract

- `payload.ts` defines `GanttPayload`, the figure's input, data and never geometry. Tasks in WBS order
  (depth-first, `level`/`summary`/`milestone`/`start`/`finish`/`duration`/`complete`/`critical`/
  `late`/`violated`/`float`/`deadline`/`baseline*`/`manual`/`group`/`color`/`segments` (split
  bars)/`resource`/`units`), links (`FS|SS|FF|SF` with
  lag), non-working spans, holidays, today, status date, project span, per-task predecessor text,
  and the resolved view options. `finish` is inclusive (the last day the task occupies); the
  figure adds one day when it draws a bar. The app's `schedule-engine` and `ganttPayload.ts` build
  this; nothing in this package parses dates (a `parseDate` is injected for window bounds).
- `layoutGantt(payload, { width, height?, rowHeight?, scrollTop?, viewportHeight? })` →
  `RenderFrame` (`frame.ts`): scale tiers, rows, bars, links, shading, grid lines, today/status
  x, in plain pixels, and, when `view.histogram` is on, a resource histogram band (`buildHistogram`:
  units summed per day per resource into stacked columns aligned to the day scale, a legend, a
  1-unit capacity line, and an over-allocation flag where a resource exceeds one unit on a day).
  Viewport culling when `scrollTop`/`viewportHeight` are given.
- Options of note: `layout=calendar` (the month grid), `minutes` (§ 6.5 finish rule), `histogram`
  (the resource band), and `fit=page` (export: fit the whole span to one width with the finest
  tier whose labels still read, overriding any `zoom` preset).
- `ganttSvg(payload, { width, height?, colors? })` → a standalone SVG string (the popup's
  "copy as SVG", the webpage export, a Report snapshot). Colors are passed in because an SVG can
  not read CSS variables; omitted, a light-legible default is used so text is never invisible.
  When `view.layout === "calendar"` it serializes the calendar month grid instead of the timeline.
- `layoutCalendar(payload, { width })` → a `CalendarFrame` (the sibling figure, § 6.3): the same
  payload as month blocks (weeks grouped by each week's mid day so months never duplicate a
  boundary week), one cell per day, multi-day tasks as chips stacked in lanes across the days they
  span (clipped at week edges), milestones as dots, weekends/holidays shaded, today flagged.
  Reuses the scale window + the `drawnLastDay` rule so both figures agree. Option key
  `layout=calendar`.

## The payload in detail

`GanttPayload` carries data, never geometry. Rows arrive in display order, depth-first over the
work breakdown.

**A task** (`GanttTask`):

- `id` is the task's name, which the engine matches trimmed and case-insensitive. `level` is the
  nesting depth, 0 at the top.
- `start` and `finish` are whole-day serials. `finish` is inclusive and equals `start` on a
  milestone. `duration` is working days (the Schedule's Duration, or a summary's rolled-up span);
  when it is absent the grid shows the calendar span instead.
- `segments` splits the bar for out-of-sequence progress: inclusive `[start, finish]` pairs, in
  order, inside the task's own span. The engine fills it; absent means one contiguous bar.
- `complete` is 0 to 100 and draws as the bar's fill. `late` means the finish is past the
  deadline. `violated` means negative float: a ceiling or deadline the predecessors cannot honor.
  `float` is total float in working days, null on a summary. `floored` means a typed Start held
  the task; `manual` means Manual = TRUE pinned it.
- `baselineStart` / `baselineFinish` draw a ghost bar from a second scheduled table. `group` is
  the section label (the Project column). `color` is any CSS color, passed through.
- `resource` names the assignee and `units` its assignment units (default 1). Units are summed
  per day per resource for the histogram, and more than 1 on one resource on one day is an
  over-allocation.

**A link** (`GanttLink`): `lag` is in working days, negative for a lead. `critical` means both
ends are critical and this link drove the successor's date. `violated` means the successor starts
earlier than the link allows, because a floor or a manual pin broke it.

**The rest of the payload:** `nonWorking` is inclusive day spans, already merged, covering the
drawn window. `weekend` lists the non-working weekdays (0 is Sunday, 6 is Saturday) and is empty
in calendar-days mode. `holidays` are serials inside the window. `today` null hides the today line;
`statusDate` is set when the Schedule node has one. `predecessorText` is the grid's text per task
(`Demolition, Framing SS+2`).

**View options** (`GanttViewOptions`, the Gantt node's `options` string resolved). The defaults
when a key is absent: two header tiers; `critical`, `baseline`, `arrows`, `today`, `weekends` and
`labels` on; `status` on when a status date exists; `group_by` on when any task has a group;
`fiscal_start` 1; `columns` name, start, finish, duration; `window` the padded project span.
`collapse` hides nesting below that level (0 collapses to the top-level rows). `week` numbers the
week tier ISO or US.

`parseGanttViewOptions(text, parseDate?)` reads the shared `key=value;…` string. It leaves
unknown keys for `parseChartOptions`, since the two parsers read one string. Booleans accept `on`,
`true`, `1`, `yes`, `y` and `off`, `false`, `0`, `no`, `n`; any other value is ignored, as is an
out-of-range number (`tiers` other than 1 or 2, `fiscal_start` outside 1 to 12, a negative or
fractional `collapse`). `window=a,b` needs the injected `parseDate`; without it, or when either
bound does not parse, there is no window, and reversed bounds are swapped. `columns` keeps only
the known keys.

## The render frame in detail

`RenderFrame` is plain pixels in the timeline's own space: x from the drawn window's left edge, y
from row 0. It holds no DOM and no colors; the React view and the SVG serializer both draw from it.

- `scale.tiers` run coarsest first. `scale.from` / `scale.to` bound the drawn window in whole-day
  serials, and `to` is exclusive (one past the last drawn day).
- A row with `section` is a group band, not a task, and its `taskIndex` is -1. `hasChildren`
  marks a phase and drives `aria-expanded` and the disclosure caret.
- A bar's rectangle is the diamond's bounding box for a milestone. `progressW` is 0 with no
  progress. `segments` holds each split part's rectangle. `deadlineX` is the deadline day's flag.
- A link's `points` are an orthogonal polyline and `arrow` is its tip and pointing direction.
- `gridColumns` are vertical lines at each primary-tier boundary. `todayX` and `statusX` are null
  when hidden or outside the window.
- `GanttColors` is the serializer's only color source, because an SVG cannot read CSS variables.
  The React figure resolves every field from the app's tokens; `DEFAULT_COLORS` is a
  light-theme-legible set for a call with only a width (headless export tests).

## How the layout works

**The window** (`resolveWindow`). An explicit `window` draws exactly those days. Otherwise the
project span is padded by one week on each side, so bars never touch the frame. An empty or
degenerate plan draws a two-week window starting at today (or the project start, or serial 0),
padded the same way.

**The zoom** (`resolveZoom`). An explicit preset wins, unless `fit=page`. With `zoom=fit` or no
zoom, the choice is the finest preset whose pixels per day the width affords. With `fit=page`
(export) the choice is the finest tier whose cells stay at least 24 px wide at the fill density,
so a long plan still gets a detailed, readable axis (months over quarters, not one year label).
The fixed presets are 28 px per day for day zoom, 12 for week, 4 for month, 2 for quarter and 0.9
for year, chosen so a day cell fits "31" and a month cell fits "September". When the window fits
the width (fit, no zoom, or `fit=page`) the days stretch to fill it; otherwise the preset holds
and the host scrolls.

**The tiers.** The primary tier is the zoom's own unit (days for day zoom, weeks for week, and so
on). The upper tier is one step coarser; year zoom has none, since its coarser band would be a
decade. The band over days names the month and year. Quarter and year cells start at the fiscal
year's first month.

**The drawn last day** (`drawnLastDay`), shared by bars, the calendar and the Finish cell. In Days
mode the finish is already the inclusive last day. In Minutes mode the finish is a clock instant,
and the drawn day is the day of the finish minus one minute, so a finish exactly at midnight lands
on the previous day (§ 6.5). A bar's right edge is this day plus one.

**Serial math** (`serial.ts`). Serial 25569 is 1970-01-01, and a serial's civil date and weekday
are its UTC ones. Division floors toward negative infinity, because window padding can reach
before the epoch. An ISO week starts Monday, and week 1 holds the year's first Thursday. A US week
starts Sunday, and week 1 contains January 1. A fiscal year is named by the calendar year in which
it starts.

**Rows** (`buildRows`). A task is a phase when the next task nests one level deeper. There are two
collapse modes: the `view.collapse` level (the serializer and tests), which skips every row deeper
than the level, or a set of collapsed summary ids (the interactive figure), which hides a row
under any collapsed ancestor. When the id set is given it replaces the level entirely, so the
keyboard can open past the option's floor. A section band precedes each run of a new `group`
value. `cullRows` returns index bounds for rows overlapping a viewport, plus a buffer of five rows so
a row scrolling in is already drawn.

**Bars** (`buildBars`). A bar fills a fixed fraction of its row, leaving a gap above and below. A
milestone is a diamond centered on its start day's midpoint, with a square bounding box. A summary
is a bracket: a thin top rail with legs dropping the full bar height at each end, and no progress
fill. A split bar draws each part, with a dotted gap between parts and no separate progress
overlay. The baseline ghost and the deadline flag (at the end of the deadline day; a flag, never a
move, [[C70]] oneScheduleRule) draw when the task carries them. The label sits right of the bar, or
left of it for a milestone or near the right frame, and is ellipsized to an assumed 240 px of room
using a deliberately generous glyph estimate at 12 px. The live view re-measures; a headless SVG
needs a fair guess.

**Links** (`buildLinks`). Anchors are computed for every row, so a link still routes when a
neighbor is culled; a link whose endpoint is collapsed draws nothing. The route is six points: a
horizontal stub off the source edge, then orthogonal segments to a stub into the target edge,
which handles forward links and backward loops alike. Collinear points are then dropped.

**The histogram** (`buildHistogram`). Resources are taken in first-seen order from leaf tasks
(not summaries or milestones) that name one. Each day's units stack per resource; the band has a
legend (its x positions are the renderer's), a body, and a capacity line at 1 unit. `RESOURCE_RAMP`
is a brand-neutral categorical ramp that reads on light and dark; the serializer uses it directly
and a renderer may override it.

**Grid columns** (`buildColumns`). The pane shows `view.columns` in order, de-duplicated, and the
name column is always present and first. Widths are suggestions the view may override; the name
column is the flexible one. The date columns are exactly 11 monospace characters wide at the 12 px
value size, plus the cell padding, since dates print as `DD-MMM-YYYY` ([[C44]] dateSerials). The
Finish cell shows the drawn last day, and the Days cell shows working days when the payload
carries them, else the inclusive calendar span.

**The calendar** (`layoutCalendar`). Whole weeks cover the window. Each week belongs to the month
of its fourth day, so adjacent months never both show a boundary week. Chips go into lanes
greedily by start column; a month's row height is fixed by its busiest week, and lanes past the cap
(default 4) fold into a "+N more" marker. Summaries are not drawn as chips. A chip that continues
past a week edge gets a flat end instead of a rounded one.

**Viewport culling** (`layoutGantt`). With `scrollTop` and `viewportHeight` (else `height`) the
frame keeps only the rows, bars and links near the viewport. `width` is the timeline alone; the
grid pane's width comes from its columns.

**The SVG serializer** (`ganttSvg`). The grid pane is as wide as its columns unless `gridWidth` is
given. The timeline draws back to front: non-working shading, grid lines, header tiers, faint row
baselines, baseline ghosts, bars (with the dotted split connectors, a hatch and darker outline on
the critical path, and a pushpin at a manual task's start), links, the today and status lines, and
the histogram band. The grid pane and its divider follow. The calendar serializer reuses the
critical hatch.

## What was written here vs studied

Written fresh, on serial math:

- `serial.ts`: Excel-serial civil-date math (civil↔serial by Howard Hinnant's days↔civil
  algorithms, weekday, ISO/US week numbering, fiscal quarters), anchored on the app's epoch
  (serial 25569 = 1970-01-01, a Thursday), matching `serialToJsDate(...).getUTCDay()` without a
  `Date`.
- `frame.ts` (the RenderFrame shape and the theme-color set), `bars.ts`, `rows.ts`, `columns.ts`,
  `cell.ts`, `layout.ts`, `calendar.ts` (the month grid), `histogram.ts` (the resource band), and
  `svg.ts` (the headless serializer, dispatching to the calendar when `layout=calendar`). All
  original.

Studied for design only, MIT sources, no code copied (the licence boundary in
`docs/v2.0/25-gantt.md` § 5/§ 7):

- **DHTMLX v10** `scale_manager` + `size_distribution`: the tier-normalization design (coarser
  tier snapped to the primary tier's pixels; month columns proportional to their day count),
  re-derived in `scale.ts` on serials rather than its `Date`-bound singleton.
- **DHTMLX** `link_render` `path_builder` and **SVAR** `links.ts#getLineCoords`: the orthogonal
  endpoint conventions (FS right→left, SS left→left, FF right→right, SF left→right) and the
  six-point polyline, rebuilt in `links.ts`.
- **SVAR** `scales.ts` (zoom presets) and **d3-time**'s tick-interval idea: the zoom/fit ladder
  in `scale.ts` (the tick tables are hand-written here; d3-time is not a dependency).

## Tests

Golden JSON, run by the repo's vitest (`packages/**/*.test.ts`): serial round-trips and DST
weekday parity, ISO vs US week 1, leap years, month columns proportional to day count, hidden
weekend ranges, one-day bars, a milestone on a non-working day, FS endpoint routing, baseline/
deadline/late/group/color/collapse, interactive collapse + `hasChildren`, the working-day Days
column, split bars, the minutes-mode midnight-finish rule, `fit`/`fit=page` fill without tier-label
collision, the calendar month grid (grouping, weekend flags, week-clipped chips, milestone dots,
today), the resource histogram (per-day sums, over-allocation, legend), and SVG
well-formedness/escaping/colors.
