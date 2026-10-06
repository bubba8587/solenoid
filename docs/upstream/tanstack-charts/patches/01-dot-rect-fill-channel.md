# feat(charts): accept per-datum fill and stroke on dot and rect

## Summary

`dot` and `rect` (and so `cell`) take `fill` and `stroke` as constant strings, while `bar`, `area`, `line`, `link` and `text` take a `VisualChannel`. This makes both channels on `dot` and `rect` a `VisualChannel<TDatum, string>`, resolved per datum with `visualValue` as `bar` does.

## Motivation

Moving Solenoid's charts from Recharts to TanStack Charts, two figures need a paint per datum that isn't a category:

- XY points coloured by a numeric column through a colormap (`src/graph/components/chartRender.tsx`, the XY view).
- Heatmap and calendar cells coloured per value (`src/graph/components/charts/heatFigures.tsx`).

Today the only route is the color scale: a pass-through scale whose domain equals its range, or a custom `color.resolver` that returns the value unchanged. Both work, but they put paint that is already resolved through a scale for no reason, and they compete with any real categorical color scale on the same chart.

## Changes

- `DotOptions.fill` / `.stroke` and `RectOptions.fill` / `.stroke`: `VisualChannel<TDatum, string>`.
- `fill` resolves per datum, falling back to the resolved color as before; `stroke` stays undefined when unset (as in `area`), else resolves per datum.
- The interaction point's `color` follows the resolved fill.
- Tests in `point-color.test.ts` for per-datum dot and cell fill and stroke.
- Docs for both marks; friction entry F-309; minor changeset.

## API

```ts
// Before: per-datum paint went through the color scale
dot(rows, { x: 'x', y: 'y', color: (d) => d.paint })
// with color: { domain: paints, range: paints } on the chart

// After
dot(rows, { x: 'x', y: 'y', fill: (d) => d.paint })
```

## For the reviewer

- `resolveColor` now runs even when `fill` is a constant, which matches `bar`.
- If several of our PRs land, the friction ids will need renumbering (each branch uses F-309).

## Validation

- `point-color.test.ts`, `api-friction.test.ts`, `pnpm typecheck`: pass.
- Not run here: full `pnpm test`, `bundle:check`, `package:check` (see PR 04's notes on what our environment can't run).
