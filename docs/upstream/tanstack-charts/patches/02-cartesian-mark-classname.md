# feat(charts): accept className on cartesian marks

## Summary

Polar, geo and sunburst marks accept `className`; the Cartesian marks hard-code their group class. This adds `className?: string` to every Cartesian mark that renders a classed group (line, area, areaX, bar, rect, dot, hexagon, text, rule, tick, vector, arrow, link, band, waffle, violin, ridgeline, contour, density contour, Voronoi), appended to the base class exactly as polar marks do. The `classes()` helper moves from `polar.ts` to `class-name-internal.ts` so both share it.

## Motivation

Moving Solenoid's charts from Recharts to TanStack Charts, we wanted CSS hover styling for funnel stages (`areaX`), Sankey flows (`link`) and pie slices. Pie slices could take a class; the others couldn't, so our stylesheet targets substrings of generated keys instead (`[data-ts-key*="sol-flow"] line:hover`), which couples app CSS to internal key formats.

## API

```ts
link(flows, { x1: 'x1', y1: 'y1', x2: 'x2', y2: 'y2', className: 'flow' })
// <g class="ts-chart__link flow">
```

The Canvas renderer ignores the class, as it already does for polar marks (a test covers it).

## For the reviewer

- Friction entry F-309 (renumber if several of our PRs land); minor changeset.

## Validation

- `svg-renderer.test.ts`, `canvas.test.ts`, `api-friction.test.ts`, `pnpm typecheck`: pass. Docs synced.
- Not run here: full `pnpm test`, `bundle:check`, `package:check` (see PR 04's notes on what our environment can't run).
