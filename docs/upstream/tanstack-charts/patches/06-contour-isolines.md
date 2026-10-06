# feat(charts): add contourLines for interior iso-lines

## Summary

`contour` emits filled level-set polygons, and stroking them also traces the grid border and the edges beside missing samples, so it can't draw clean iso-lines. This adds `contourLines` to `@tanstack/charts/spatial/contour`: the same grid input and levels, stroked as polylines, with ring edges along the grid border and beside missing samples dropped and unbroken interior rings kept closed. The level generation is shared with `contour`.

## Motivation

Moving Solenoid's charts from Recharts to TanStack Charts, our contour figure draws filled bands with iso-lines over them at chosen levels (`src/graph/components/charts/fieldFigures.tsx`). Stroking `contour`'s polygons outlined the plot edge and every hole, so we wrote our own marching-squares mark for the lines.

## API

```ts
import { contour, contourLines } from '@tanstack/charts/spatial/contour'

marks: [
  contour(grid, { width: w, height: h, thresholds: 64 }),
  contourLines(grid, { width: w, height: h, thresholds: [0.25, 0.5, 0.75], stroke: 'currentColor' }),
]
```

`ContourLinesOptions` is `ContourOptions` without the fill options.

## For the reviewer

- Friction entry F-309 (renumber if several of our PRs land); minor changeset; reference docs and `llms.txt` synced.

## Validation

- `spatial-contour.test.ts`, `spatial-contour-internal.test.ts` (a field with a hole and a level touching the border), `api-friction.test.ts`, `pnpm typecheck`: pass.
- Not run here: full `pnpm test`, `bundle:check`, `package:check` (see PR 04's notes on what our environment can't run).
