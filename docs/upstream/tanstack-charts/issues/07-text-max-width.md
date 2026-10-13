# `maxWidth` with an ellipsis on `text`

## What we needed

Heatmap row and column headers in Solenoid come from user data and are often longer than a cell is wide. They need to be cut to the space they have, with an ellipsis, so labels don't run into each other.

## Today

The `text` mark (`packages/charts-core/src/text.ts`) has `fontSize`, `fontWeight`, `anchor`, `rotate` and offsets, but no width limit. We measure on a canvas and cut the string ourselves before handing it over (`fitLabel` and `measureText` in `src/graph/components/charts/kit.tsx`).

## Suggestion

`maxWidth?: VisualChannel<TDatum, number>` on `text`, cutting with `…` using the same text measurement the layout already does for axis gutters (`scene.ts`, `legend-static.ts`). Keeping the full string in the accessible label would avoid losing it for screen readers.

The open question is SSR: where no measurer is available, an estimate (or leaving the string whole) would need to be documented.
