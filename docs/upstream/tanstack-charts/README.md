# TanStack Charts: what Solenoid needed that 1.0.0 lacked

Moving Solenoid's charts from Recharts to TanStack Charts 1.0.0 (branch `tan`, `docs/v2.0/26-tanstack.md`) turned up eighteen candidate gaps. Each was checked against the upstream source (TanStack/charts at `e6a51a8`). Seven became patches, four became issues, and the rest turned out to be supported already, deliberate, or not worth sending.

Nothing here has been submitted. Each patch is `git format-patch` output against upstream `main` with a PR description beside it. Every branch adds its friction-log entry as F-309, the next free id, so several landing together need renumbering.

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

## Things Solenoid keeps on its side

`compactTick` and `valueTickFormat` (step-aware compact ticks), `valueDomain` (round-out domains with a tick floor), `minMaxDecimate`, the XY ramp-line gradients, and the DOM series legend with click-to-spotlight. These live in `src/graph/components/chartCore.ts` and `src/graph/components/charts/kit.tsx`.
