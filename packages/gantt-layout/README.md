# @solenoid/gantt-layout

Pure Gantt geometry. A data payload plus a width in, a plain-number render frame out (time-scale
tiers, rows, bars, links, non-working shading), and a standalone SVG serializer for headless
export. No DOM, no React, and no `Date`: every date is an Excel day serial and all calendar math
is integer, so no timezone or DST can shift a column.

## The contract

- `payload.ts` — `GanttPayload`: the figure's input, data and never geometry. Tasks in WBS order
  (depth-first, `level`/`summary`/`milestone`/`start`/`finish`/`duration`/`complete`/`critical`/
  `late`/`violated`/`float`/`deadline`/`baseline*`/`manual`/`group`/`color`/`segments` (split
  bars)/`resource`/`units`), links (`FS|SS|FF|SF` with
  lag), non-working spans, holidays, today, status date, project span, per-task predecessor text,
  and the resolved view options. `finish` is INCLUSIVE (the last day the task occupies); the
  figure adds one day when it draws a bar. The app's `schedule-engine` and `ganttPayload.ts` build
  this; nothing in this package parses dates (a `parseDate` is injected for window bounds).
- `layoutGantt(payload, { width, height?, rowHeight?, scrollTop?, viewportHeight? })` →
  `RenderFrame` (`frame.ts`): scale tiers, rows, bars, links, shading, grid lines, today/status
  x, in plain pixels, and — when `view.histogram` — a resource histogram band (`buildHistogram`:
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

## What was written here vs studied

Written fresh, on serial math:

- `serial.ts` — Excel-serial civil-date math (civil↔serial by Howard Hinnant's days↔civil
  algorithms, weekday, ISO/US week numbering, fiscal quarters), anchored on the app's epoch
  (serial 25569 = 1970-01-01, a Thursday), matching `serialToJsDate(...).getUTCDay()` without a
  `Date`.
- `frame.ts` (the RenderFrame shape and the theme-color set), `bars.ts`, `rows.ts`, `columns.ts`,
  `cell.ts`, `layout.ts`, `calendar.ts` (the month grid), `histogram.ts` (the resource band), and
  `svg.ts` (the headless serializer, dispatching to the calendar when `layout=calendar`). All
  original.

Studied for design only, MIT sources, no code copied (the licence boundary in
`docs/v2.0/25-gantt.md` § 5/§ 7):

- **DHTMLX v10** `scale_manager` + `size_distribution` — the tier-normalization design (coarser
  tier snapped to the primary tier's pixels; month columns proportional to their day count),
  re-derived in `scale.ts` on serials rather than its `Date`-bound singleton.
- **DHTMLX** `link_render` `path_builder` and **SVAR** `links.ts#getLineCoords` — the orthogonal
  endpoint conventions (FS right→left, SS left→left, FF right→right, SF left→right) and the
  six-point polyline, rebuilt in `links.ts`.
- **SVAR** `scales.ts` (zoom presets) and **d3-time**'s tick-interval idea — the zoom/fit ladder
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
