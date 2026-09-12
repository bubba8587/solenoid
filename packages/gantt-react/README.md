# @solenoid/gantt-react

The React 19 Gantt figure over `@solenoid/gantt-layout`. A tree grid beside a timeline, read-only:
the schedule is edited in the source table, never on the chart. `GanttFigure` dispatches to a
calendar month grid (`CalendarView`) when `view.layout === "calendar"` — the same payload, two
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
- **Cue vocabulary** — every state also carries a NON-color cue (WCAG 1.4.1), so the figure reads
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

## Option keys

Persisted view state rides the node's `options` string (`key=value;…`, parsed by
`parseGanttViewOptions` in the layout package):

- `layout` — `gantt` (default) or `calendar` (the month grid, `CalendarView`)
- `zoom` — `day` / `week` / `month` / `quarter` / `year` / `fit`; `fit=page` (export) fits the
  whole span to one width with the finest label-wide tier, overriding `zoom`
- `minutes` — minutes-precision serials (a midnight finish draws on the previous day, § 6.5)
- `histogram` — draw the resource band
- `tiers`, `window`, `collapse`, `week` (iso/us), `fiscal_start`, `columns`, and the boolean
  toggles `critical` / `baseline` / `arrows` / `today` / `status` / `weekends` / `group_by` / `labels`

## What was written here vs studied

Written fresh: the whole component (`GanttFigure.tsx`), the injected stylesheet (`styles.ts`), the
splitter, the synced two-pane scroll, and the row windower (a ~30-line index range over uniform
rows, no virtualization dependency).

Studied for design only (`docs/v2.0/25-gantt.md` § 4.3/§ 5/§ 6.3): the **SVAR / Bryntum /
Syncfusion** hybrid of DOM/HTML for the grid and labels with SVG for bars and one overlay SVG for
links (a wide invisible hit-path carries the hover), and **TanStack Virtual**'s windowing
proportions (its range math, not its code). The chrome (CSS variables, the popup shell, the
`[Chart]` chip) is the app's own, reused rather than re-invented.

## Dependencies

Only a `react` / `react-dom` `^19` peer, plus `@solenoid/gantt-layout`. No charting or
virtualization library.
