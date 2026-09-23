# @solenoid/gantt-react

The React 19 Gantt figure over `@solenoid/gantt-layout`. A tree grid beside a timeline, read-only:
the schedule is edited in the source table, never on the chart. `GanttFigure` dispatches to a
calendar month grid (`CalendarView`) when `view.layout === "calendar"`: the same payload, two
ways; both are exported.

## The contract

```ts
GanttFigure({
  payload: GanttPayload,   // from @solenoid/gantt-layout
  width: number,           // total figure width (grid pane + timeline); split at an internal splitter
  height: number,
  virtualize?: boolean,    // true = windowed rows (the popup); false/undefined = capped at 60 (the canvas)
  fontScale?: number,
  colors?: Partial<GanttColors>,  // optional; omitted, the figure reads the app's CSS variables
})
```

- The figure measures nothing itself: the host passes pixel `width`/`height` (a fixed size on the
  canvas card, a `ResizeObserver` region in the popup, mirroring the app's `ChartFigure`).
- SVG shapes are styled by CSS classes that use the app's design tokens (`--surface`, `--text`,
  `--text-dim`, `--accent`, `--sock-chart`, `--sol-error`, `--font-mono`). Custom properties
  resolve in inline SVG because the figure lives in the document, so the on-screen figure needs no
  color resolution; only the headless `ganttSvg` serializer (re-exported here) takes concrete
  colors, for a detached export.
- **Cue vocabulary.** Every state also carries a non-color cue (WCAG 1.4.1), so the figure reads
  without relying on hue:
  - **hatch** (+ darker outline) = on the critical path
  - **dashed outline** = violated (negative float: a floor/pin the predecessors can't honor)
  - **solid outline** = late (finish past its deadline)
  - **pushpin** at the bar start = a manual pin (Manual = TRUE)
  - **pennant** (down-flag at the end of the deadline day) = a Deadline; it turns the error color when late
  - **dotted gap** between bar parts = a split (out-of-sequence progress, `GanttTask.segments`)
  - In the resource histogram, **error color + hatch** on a stacked segment = a resource over one unit on a day (over-allocation); the dashed line marks the 1-unit capacity.
- The resource histogram (`histogram=on` with per-task `resource`/`units`) draws under the timeline:
  per-day stacked unit columns aligned to the day scale, a per-resource legend, a 1-unit capacity
  line, and the over-allocation cue above. Its colors come from `RESOURCE_RAMP` (a brand-neutral
  ramp exported by the layout package).
- The root carries `nowheel nodrag nokeys` (the React Flow surface contract) and `role="treegrid"`
  with row/column/level ARIA. Tooltips are structural only (a link's type, never dynamic
  names/values). `prefers-reduced-motion` is honored.
- The grid is a keyboard treegrid: a roving `tabindex` on the rows, Up/Down move the active row,
  Left collapses a phase (or moves to the parent on a leaf), Right expands (or steps to the first
  child), Home/End jump to the first/last row, Enter or Space toggles a phase, and the timeline
  scrolls the active row's bar into view. Rows carry `aria-expanded`/`aria-selected`. Expand and
  collapse are ephemeral per-viewer state seeded from the `collapse` option; the option is only a
  floor the keyboard can open past.

## How the figure lays out

- **Panes.** The grid pane opens at its content width: the columns that fit within the smaller of
  their natural width and 55% of the figure (at least 96 px), so there is no empty band and never a
  clipped header. The splitter drags it from there. The pane never outgrows the figure: the
  timeline keeps at least 80 px, and columns that no longer fit are dropped from the end, never
  clipped. The name column always stays, even when it alone is too wide.
- **Rows.** On the canvas the figure draws at most the first 60 rows (the Record precedent,
  [[C63]] oneRecordNode); in the popup (`virtualize`) it draws a window around the scroll position
  with a buffer of 6 rows, which works because every row has the same height. Links draw when
  either end is in or near the drawn band. The two panes share one vertical scroll.
- **Collapse.** Per-row collapse is ephemeral viewer state. It is seeded from `view.collapse`, so
  every phase at or below that level starts collapsed, and a click or the keyboard toggles from
  there.
- **Keyboard.** Section bands are skipped by navigation. Right on an expanded phase steps to its
  first child; Left on a leaf or a collapsed phase moves to the parent. The active row scrolls into
  view in both panes and its bar into view horizontally, instantly rather than smoothly, so there
  is nothing to gate on reduced motion. DOM focus moves onto the active row once it has rendered,
  keyed only on the active row and the scroll offset, so an unrelated re-render never steals focus.
- **Type.** Text sizes are DESIGN.md's rungs in em of the root, which is 12 px times `fontScale`,
  so the text scale moves the labels with the rows.
- **Hit testing.** The links overlay keeps pointer events, because its wide invisible hit paths
  carry the hover; its empty regions pass clicks through since an unpainted SVG background
  captures nothing. The drawn links and arrows themselves take no pointer events.
- **The calendar view** scrolls vertically when the span runs to several months, and it ellipsizes
  chip labels at about 6 px per character, matching the layout package's estimator.

## Option keys

Persisted view state rides the node's `options` string (`key=value;…`, parsed by
`parseGanttViewOptions` in the layout package):

- `layout`: `gantt` (default) or `calendar` (the month grid, `CalendarView`)
- `zoom`: `day` / `week` / `month` / `quarter` / `year` / `fit`; `fit=page` (export) fits the
  whole span to one width with the finest label-wide tier, overriding `zoom`
- `minutes`: minutes-precision serials (a midnight finish draws on the previous day, § 6.5)
- `histogram`: draw the resource band
- `tiers`, `window`, `collapse`, `week` (iso/us), `fiscal_start`, `columns`, and the boolean
  toggles `critical` / `baseline` / `arrows` / `today` / `status` / `weekends` / `group_by` / `labels`

## What was written here vs studied

Written fresh: the whole component (`GanttFigure.tsx`), the injected stylesheet (`styles.ts`), the
splitter, the synced two-pane scroll, and the row windower (a ~30-line index range over uniform
rows, no virtualization dependency).

Studied for design only (`docs/v2.0/25-gantt.md` § 4.3/§ 5, `tree/specs/computation/schedule-and-gantt.md`): the **SVAR / Bryntum /
Syncfusion** hybrid of DOM/HTML for the grid and labels with SVG for bars and one overlay SVG for
links (a wide invisible hit-path carries the hover), and **TanStack Virtual**'s windowing
proportions (its range math, not its code). The chrome (CSS variables, the popup shell, the
`[Chart]` chip) is the app's own, reused rather than re-invented.

## Dependencies

Only a `react` / `react-dom` `^19` peer, plus `@solenoid/gantt-layout`. No charting or
virtualization library.
