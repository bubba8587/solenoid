# feat(charts): add contourLines for scalar-grid iso-lines

## Summary

Adds `contourLines` to the optional `@tanstack/charts/spatial/contour` subpath. It strokes the same scalar-grid level sets as `contour`, but as polylines that keep only interior level crossings. It drops ring edges that run along the grid border or through cells with missing samples. Unbroken interior rings stay closed.

## Motivation

Solenoid's contour figure (`src/graph/components/charts/fieldFigures.tsx`) draws 64 filled bands for shading and stroked iso-lines at a few chosen levels on top. A stroked `contour` cannot provide those lines. Each level is a filled ring, so its stroke also traces the grid border wherever the level reaches the edge, and it outlines every null cell. For example, a ramp `[0,0,0,0, 2,2,2,2, 4,4,4,4]` (4 x 3) at level 1 strokes the whole region above the level, including both side borders and the top border, not just the crossing at y = 1. To get clean lines, the application had to write its own marching-squares pass over the source grid and a raw `createMark` that builds SVG path strings for each level.

## Changes

- `spatial-contour-internal.ts`: new `contourIsolines(coordinates, grid, level, smooth)`. It takes unsmoothed `d3-contour` rings, so each ring edge lies in exactly one marching-squares cell. An edge is dropped when both of its endpoints lie on the grid border, or when any in-grid corner sample of its cell is missing. The remaining edges are split into runs. A ring that loses no edge stays closed by repeating its first point. Kept vertices are then smoothed with `d3-contour`'s linear rule (`x + (level - v0) / (v1 - v0) - 0.5`). Because the rule is identical, every line vertex is also a vertex of the smoothed fill at that level.
- `spatial-contour.ts`: grid validation, value extraction, threshold normalization, generation and level identity move from `contour` into one private `generateContours` helper. `contour` uses it with unchanged behavior. New `contourLines` mark and `ContourLinesOptions<TDatum>` (`ContourOptions` without `fill` and `fillOpacity`). Each run becomes a `polyline` scene node (`fill: 'none'`, round caps and joins), keyed by `[id, levelIdentity, lineIndex]`. `stroke` defaults to the resolved color, and the mark adds no focus points.
- Docs: an "Iso-lines" section in `docs/reference/marks/contour.md`, plus rows in `docs/reference/index.md`. Regenerated through `pnpm docs:sync`.
- `.changeset/contour-isolines.md` (minor).
- `API-FRICTION.md`: F-313 and its index row.

A sibling export was chosen over a `lines: true` option on `contour`:

- it emits a different scene primitive, and `fill`/`fillOpacity` would be meaningless;
- its stroke default differs from `contour`'s;
- it tree-shakes out of existing `contour` bundles;
- band levels and line levels usually differ, so they are two marks anyway.

## API

Before (application code):

```ts
contour(field, { width: m, height: k, thresholds: bands, fill })
// plus a custom createMark running marching squares and emitting path strings
```

After:

```ts
import { contour, contourLines } from '@tanstack/charts/spatial/contour'

contour(field, { width: m, height: k, thresholds: bands, fill })
contourLines(field, {
  width: m,
  height: k,
  thresholds: levels,
  stroke: 'rgba(0,0,0,0.45)',
  strokeWidth: 0.8,
})
```

## Tests

- `spatial-contour-internal.test.ts`:
  - a level touching the border becomes one open line whose ends stop on the border, with no border edges;
  - an interior ring stays closed and equals the smoothed fill ring;
  - a field with a NaN hole produces four open lines that avoid the hole, and every vertex is a fill vertex.
- `spatial-contour.test.ts`:
  - validation errors carry the `contourLines` mark name;
  - on a field with a null hole and two levels: the stroke callback is called once per level, the source lineage excludes the hole, `fill: 'none'` is set, the outer level stays closed, the inner level splits into four open lines away from the hole, and every point lies inside the plot;
  - the border-touching level projects to the expected plot coordinates.

## Validation

VALIDATION_PLACEHOLDER

## Friction log

F-313 (Filled contours could not draw clean interior iso-lines).
