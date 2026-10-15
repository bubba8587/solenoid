# TanStack Charts: where Solenoid differs, and what to send upstream

TanStack Charts is new and open source, so every place Solenoid keeps its own code instead of TanStack's is a candidate fix for them. This folder is the running register of those places (below), with a patch or an issue draft for each one worth sending. Moving the charts from Recharts (branch `tan`, `docs/v2.0/26-tanstack.md`) turned up eighteen candidate gaps, each checked against the upstream source; later finds were added the same way.

**Keeping it current.** A new helper in Solenoid that does a job TanStack nearly does gets a row in the register in the same commit, with its upstream item or the reason there isn't one. Each TanStack release is checked against the open rows, and a row whose gap closes means switching to TanStack's version and deleting ours. None of the gaps is closed in 1.1.0, which `tan` runs (upstream `main` last checked at `9d80699`, 2026-10-15). Nothing here has been submitted. Each patch is `git format-patch` output against upstream `main` with a PR description beside it. Every branch adds its friction-log entry as F-309, the next free id, so several landing together need renumbering.

## The register

| Ours | Where | Why not TanStack's | Upstream |
|---|---|---|---|
| `valueDomain`: round-out domain, tick floor, one fixed bound | `charts/kit.tsx` | `nice` rounds both ends and ties its count to the guide (over-wide on small cards) | [issue 01](issues/01-nice-small-charts.md), [issue 05](issues/05-nice-fixed-bound.md) |
| `compactTick`, `valueTickFormat`: step-aware 100K / 100.25K labels | `chartCore.ts` | `ticks.format` gets one value, not the step | [issue 02](issues/02-tick-format-context.md) |
| XY ramp-line gradients, one `link` per segment | `chartRender.tsx` (XY) | a line strokes from its first row; gradients are bounding-box only | [issue 03](issues/03-line-color-ramp.md) |
| `SeriesLegend` + `useSeriesSpotlight`: click pins a spotlight | `charts/kit.tsx`, `chartCore.ts` | the interactive legend's click hides a series; emphasis is hover-only | [issue 06](issues/06-legend-click-emphasis.md) (the DOM placement stays ours) |
| `fitLabel`: ellipsis-cut heatmap headers | `charts/kit.tsx`, `heatFigures.tsx` | `text` has no width limit | [issue 07](issues/07-text-max-width.md) |
| Per-datum point and cell paint through a pass-through color scale | `chartRender.tsx` (XY), `heatFigures.tsx` | `dot` and `rect` take one fill per mark | [patch 01](patches/01-dot-rect-fill-channel.md) |
| CSS hover keyed on generated `data-ts-key` substrings | `chartView.css`, `charts/heatFigures.tsx` | Cartesian marks take no `className` | [patch 02](patches/02-cartesian-mark-classname.md) |
| Vector arrows split into marks by width and head length; open heads only | `charts/fieldFigures.tsx` | `vector` takes one width and head per mark | [patch 05](patches/05-vector-datum-stroke-and-head.md) |
| Contour iso-lines drawn by our own marching squares | `charts/fieldFigures.tsx` (`isoLinesMark`) | `contour` draws band outlines, border included | [patch 06](patches/06-contour-isolines.md) |
| A translucent `rect` under each pie and heatmap label, sized by guessed glyph widths | `chartRender.tsx` (`pieLabelMarks`) | `text` has no halo | [patch 07](patches/07-text-halo.md) |
| `minMaxDecimate`, `envelopeRows`, `thinXY`, `keptTicks`: drawing a dense series from the points that land on distinct pixels | `chartCore.ts`, `charts/kit.tsx` | a documented non-goal (large-data guide) | none: stays ours |
| `dateTicks`: date ticks on DATETRUNC's calendar boundaries | `chartCore.ts` | time scales tick `Date` values; our axis holds date serials and must agree with the formula language's calendar | none: stays ours |
| `axisLabel` cuts an axis title to the plot's width with an ellipsis | `charts/kit.tsx` | a title wider than the plot widens the margins to fit it, collapsing a small plot | [issue 09](issues/09-axis-title-squeezes-plot.md) |
| `vlinePlaces` and the pie's label column: labels that flip sides and step down rows to clear each other | `charts/refs.ts`, `chartRender.tsx` (`pieLabelMarks`) | `dodge` lays out dots only; `text` has no collision avoidance | [issue 11](issues/11-text-label-dodging.md) |
| `catScale`: a hidden linear scale so a reference area spans whole category bands | `charts/refs.ts` | a `rect` between two band categories spans centre to centre | [issue 10](issues/10-rect-band-endpoints.md) |
| `aspect=equal`: lay out with `createChartScene`, fit the domains to the plot box, lay out again | `chartRender.tsx` (XY) | no way to tie x and y to equal units per pixel | [issue 08](issues/08-equal-aspect.md) |
| `textWidth` and `chartTextMeasurer`: text widths from the bundled fonts' metrics, handed to TanStack | `textWidth.ts`, `charts/kit.tsx` | nothing missing: TanStack takes a `measureText` hook (host and `createChartScene`); without it a static layout estimates and the DOM host measures a canvas | none: ours plugs into theirs |

## Patches

| # | Change | Kind | Size |
|---|---|---|---|
| [01](patches/01-dot-rect-fill-channel.md) | `dot` and `rect` take per-datum `fill` and `stroke`, as bar, area and text already do | feature | S |
| [02](patches/02-cartesian-mark-classname.md) | `className` on every Cartesian mark, as polar, geo and sunburst already have | feature | M (many marks, small each) |
| [04](patches/04-arialabel-required-error.md) | A missing or empty `ariaLabel` throws an error that names it, instead of failing inside attribute escaping | fix | S |
| [05](patches/05-vector-datum-stroke-and-head.md) | `vector` takes per-datum `strokeWidth` and `headLength`, plus `head: 'filled'` | feature | S |
| [06](patches/06-contour-isolines.md) | `contourLines`: interior iso-lines without the grid border and hole edges | feature | M |
| [07](patches/07-text-halo.md) | `halo` on `text`, the crosshair's legibility trick as an option | feature | S |
| [08](patches/08-docs-grid-strokeopacity.md) | Name the grid style fields (`strokeOpacity`, not "opacity") and say the 11% default sits on the group | docs | XS |

Each was checked with its own tests, the friction-log test and `pnpm typecheck`. The full upstream validation could not run cleanly in our container: `package:check` fails on unmodified `main` there, four `scripts/*.test.mjs` files don't load, and the Solid and Svelte hydration tests time out under parallel load (they pass alone). Bundle budgets are tight; PR 04 adds about 40 bytes and needs a baseline refresh.

## Issues

| # | Issue | Why not a PR |
|---|---|---|
| [01](issues/01-nice-small-charts.md) | `nice: true` widens -8..44 to -100..100 on a 160 px chart | F-014 ties nice to the guide tick count on purpose; a floor needs their call |
| [02](issues/02-tick-format-context.md) | Give `ticks.format` the tick step, for compact labels like 100K / 100.25K | API shape question; includes our `compactTick` |
| [03](issues/03-line-color-ramp.md) | Stroke a line with a per-point colour ramp | Needs `userSpaceOnUse` gradients or a new line option |
| [04](issues/04-definechart-misleading-error.md) | A wrongly typed `focus` makes `defineChart` blame `marks` | Reordering the overloads breaks inference for ordinary static specs; needs an overload redesign |
| [05](issues/05-nice-fixed-bound.md) | `nice` moves a bound the user fixed; let it round only the open end | API shape: which ends a spec pins |
| [06](issues/06-legend-click-emphasis.md) | A legend click mode that pins the emphasis instead of hiding | Small, but the option's shape is theirs to pick; we offer the PR |
| [07](issues/07-text-max-width.md) | `maxWidth` with an ellipsis on `text` | Needs their call on measuring text during SSR |
| [08](issues/08-equal-aspect.md) | `aspect: 'equal'`: equal units on x and y | Layout-order design: domains depend on the plot box, which depends on tick labels |
| [09](issues/09-axis-title-squeezes-plot.md) | A long axis title collapses the plot (a 218 px chart's plot goes to 1 px) | A bug, but clip, wrap or ellipsis is their call |
| [10](issues/10-rect-band-endpoints.md) | `rect` between two band categories spans centre to centre, not band edges | Changes geometry existing charts rely on; may want an option |
| [11](issues/11-text-label-dodging.md) | Collision layout for `text` labels | A new layout primitive |

## Checked and dropped

- **Grid opacity ignored**: wrong. Each grid line carries the style's `strokeOpacity`; only the group holds the default. Became docs PR 08.
- **Fixed-pixel SVG export**: supported by `serializeChartSvg(target, { width, height })` in `@tanstack/charts/export`.
- **Focus ring fill reads black on dark themes**: supported, `focusRing: { fill }` or `--ts-chart-focus-fill` (F-300).
- **Tooltip left in the DOM between charts**: hidden by design and tested.
- **Min/max decimation**: a documented non-goal; the large-data guide leaves it to applications. Ours (`minMaxDecimate`) stays in Solenoid.
- **Pie leader labels and a funnel mark**: composable from `radialText`/`radialRule` and `areaX`, which is how upstream's own examples do it.
- **Hexbin `gridsize`**: pixel `binWidth` is decided (F-049).
- **Stability page still alpha**: deliberate (F-153); 1.0 is `docs/compatibility.md`.
- **Label background box**: declined for now (F-220); the halo (07) covers most of it.
- **Keeping chosen tick labels through thinning**: supported, `tickLabels.thin.keep`; our log axes keep their decades with it.
- **Exact text measurement**: supported through the `measureText` hook; we pass the bundled fonts' metrics.

## Seen, not yet reduced to a repro

- A grouped (`focus: 'group-x'`) tooltip over a line with a `dot` mark on the same rows listed one series twice and the others once. We list each series once (`oncePerSeries` in `chartRender.tsx`); worth an issue once a minimal chart shows it.
