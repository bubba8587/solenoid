# 26 — TanStack libraries: charts first

Branch `tan`, 2026-10-06. Started as an investigation; the charts half is now built (§ 6). `spikes/tanstack-charts/` is now a gallery of every figure (`npx vite --config spikes/tanstack-charts/vite.config.ts`, then `shot.mjs`, `hover.mjs`, `eval.mjs`); `@tanstack/charts@1.0.0` is pinned.

## 1. The question

Is `@tanstack/charts` (1.0.0, published 2026-10-03, MIT, github.com/TanStack/charts) a better
renderer than Recharts 3.10.1 for Solenoid? Secondary: where do the other TanStack libraries fit?

## 2. What Recharts carries today

- One importer, `src/graph/components/chartRender.tsx` (938 lines, pinned by
  `sourceInvariants.test.ts`), loaded lazily behind `chartView.tsx` (`tree/specs/floors/engineering.md`
  § Heavy libraries load lazily).
- It draws: Chart ops (line, area, column, bar, pie, radar, radial, funnel), multi-series, Merge
  Plots overlay, XY (scatter / XY line / bubble), Histogram, Sparkline, Gauge dial, Treemap, Sankey,
  Tornado. The rest of the figures are already off Recharts: canvas (`chartCanvasViews.tsx`: waffle,
  waterfall, candlestick, boxplot, heatmaps, contour, quiver, surface), CSS (KPI, bullet, record),
  `@solenoid/gantt-react`, Mermaid. Render table: `tree/specs/computation/chart-figures.md`.
- Workarounds it costs: a DOM legend instead of `<Legend>`; colours resolved to hex by hand
  (`chartCore.ts` `useChartColors`); custom shapes for scatter size, treemap cells, Sankey nodes,
  gradient lines; CSS to undo its focusable marks; fractional index ticks rounded by hand.
- Export has no static path: `canvasCapture.ts` scrapes the live DOM, so a chart that is not on the
  canvas exports nothing (`tree/specs/documents/reports-and-notes.md`).

## 3. Measured (this branch, 2026-10-06)

| | Recharts 3.10.1 | TanStack Charts 1.0.0 |
|---|---|---|
| Bundle for our figure set, min+gzip (esbuild, React external) | **150 KB** | **64 KB** (incl. polar, treemap, Sankey, tooltip, static SVG); a bare line chart is 32 KB |
| Mount 36 line charts × 250 points, production build | 1.6–2.6 s | **0.23–0.25 s** |
| Re-render the same 36 (width nudge) | 1.1–1.4 s | **0.23–0.27 s** |
| 12 charts × 2000 points, both min/max-decimated | mount 0.85 s, re-render 0.5 s | mount **0.16 s**, re-render 0.14–0.18 s |
| DOM elements, 36 × 250 | 13 213 | 9 937 |
| Static SVG string with no DOM (Node) | **No**: `renderToStaticMarkup` yields an empty `recharts-wrapper` div (its Redux store fills after mount) | **Yes**: `renderChartSvg(createChartScene(def, {width, height}))`, 6–13 ms per figure |
| Colours | Hex only, resolved per theme change | Writes `var(--token, #fallback)` into SVG; follows the theme with no rebuild |

Dev-build numbers are worse for Recharts (3–4 s mount) because of Redux dev checks; the table uses
`vite build` + `vite preview`. The comparison harness was removed with Recharts; git history has it.

Visual parity on the shapes ported (line, area, column, bar, pie, sparkline, scatter, tornado):
`spikes/tanstack-charts/comparison.png`.  The tornado
needs no transparent-offset-bar trick: `barX` takes an explicit `x1..x2` interval.

## 4. Problems found in the first hour

- **Grid `opacity` is ignored.** `scales.y.grid: { opacity: 1 }` is documented but the group keeps
  `stroke-opacity="0.11"` (`stroke` in the same object is honoured). Worked around with CSS
  `.ts-chart__grid { stroke-opacity: 1 }`. Upstream bug.
- **`nice: true` over-widens small charts.** Scatter data spanning −8..44 at 160 px tall niced to
  −100..100. We would keep our own `niceTicks` and pass a fixed domain, as Recharts needs today.
- **Types are strict to the point of friction.** A helper returning one of several `defineChart`
  results (a union) does not typecheck against `<Chart definition>`; the docs forbid casts, so each
  figure wants its own component. Fine for a real port, awkward for a dispatcher.
- **Young.** 1.0 is three days old, ~800 stars, and the author says it was "almost all" written
  by AI agents under supervision. Some docs pages still describe the alpha policy.
- `ariaLabel` is required (crashes without it), and the default `tabindex="0"` would need the same
  focus override Recharts does.

## 5. Coverage of what we draw

Every Recharts figure has a TanStack primitive: `lineY`/`areaY`/`barY`/`barX`/`dot` (with an `r`
channel for bubbles), `polar()` with `radialArc`/`radialLine` (pie, radar, radial, gauge),
`hierarchy/treemap`, `network/sankey`, gradients, dashes, null gaps, custom React tooltip bodies.
It also covers most of what `chartCanvasViews.tsx` hand-draws (waffle, waterfall transform, box,
cell heatmap, contour, candlestick intervals) with an opt-in per-mark Canvas renderer, so one
library could own both paths. Not checked: funnel and dual axes (named scales exist).

## 6. Verdict on charts

TanStack Charts is the better engine for Solenoid on every axis measured: under half the bytes,
5–10× faster mount and re-render, CSS-variable theming, and above all a real static SVG path, which
would let reports and Obsidian notes export a chart that is not on screen and retire the DOM
scrape. Against it: three days at 1.0, a bug and a bad default found in an hour, a smaller
community.

**Taken, all in** (author 2026-10-06: `tan` is not a production branch, so no gradual path). Recharts is removed and every plot draws with TanStack Charts ([[D98]] tanstackDrawsCharts; mechanics in `tree/specs/computation/chart-figures.md` § The TanStack figures). The chart chunk is 76 KB gzipped for all 14 renderers. Off-canvas export landed with it: an Obsidian write or report export draws a chart value that isn't on screen through the same figure (`chartSvgOffscreen.tsx`). Left: the canvas figures (waffle, waterfall, candlestick, boxplot, heatmaps, contour) and new chart types.

Upstream defects to report: the grid style's `opacity`/`strokeOpacity` is ignored (worked around in `chartView.css`); `nice: true` over-widens small charts (we compute domains ourselves, `valueDomain`).

## 7. The other TanStack libraries

| Library | Fit | Where |
|---|---|---|
| **Virtual** 3.x | Strong | Table and Cube popups cap at 1000 rows/columns (`TablePopup.tsx`, `CubePopup.tsx`); Gantt hand-windows its rows (`GanttFigure.tsx`). It is the parked "Path A" in `docs/deferrals.md` without hand-writing it. Needs the author to lift the deferral. |
| Query (`query-core`) | Medium | `connectionStore.ts` + `nodes/connection.ts` hand-roll a keyed cache, in-flight dedupe, stale-answer guard, refetch timer. The spec's no-retry and sync-`data()` rules stay custom, so only worth it if more connection kinds come. |
| Hotkeys 0.x | Medium, later | Shortcuts are spelled three times (`canvasKeyboard.ts`, `menuModel.ts`, `ShortcutsOverlay.tsx`); one registry would end the drift. Wait for 1.0. |
| Table v9 | Weak | The popup is mostly editing, computed columns and alternate views, which Table does not supply. |
| Pacer, Store, Form, Router/Start, AI, DB, Ranger | None | Each duplicates a small helper we already have or fights a seam (`storeKit.ts`, `useDraftCommit`, plain-path routing, the `FrameBackend` seam). |
