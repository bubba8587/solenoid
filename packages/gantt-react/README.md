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
- Critical/violated/late/manual each carry a NON-color cue (WCAG 1.4.1): a hatch + darker outline
  for critical, a dashed outline for violated, a solid outline and error-tinted deadline flag for
  late, a pushpin glyph for a manual pin.
- The root carries `nowheel nodrag nokeys` (the React Flow surface contract) and `role="treegrid"`
  with row/column/level ARIA. Tooltips are structural only (a link's type, never dynamic
  names/values). `prefers-reduced-motion` is honored.
- The grid is a keyboard treegrid: a roving `tabindex` on the rows, Up/Down move the active row,
  Left collapses a phase (or moves to the parent on a leaf), Right expands (or steps to the first
  child), Home/End jump to the first/last row, Enter or Space toggles a phase, and the timeline
  scrolls the active row's bar into view. Rows carry `aria-expanded`/`aria-selected`. Expand and
  collapse are ephemeral per-viewer state seeded from the `collapse` option; the option is only a
  floor the keyboard can open past.

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
