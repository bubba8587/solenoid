# feat(charts): add a halo option to text

## Summary

Adds `halo?: boolean | { stroke?: string; strokeOpacity?: number; strokeWidth?: number }` to `text`. When set, each label gets a stroked copy painted beneath it (default 3 px, `var(--ts-chart-text-halo, Canvas)`), the way the crosshair already keeps its labels legible. SVG and Canvas both render it. Off by default.

## Motivation

Moving Solenoid's charts from Recharts to TanStack Charts, our pie inside-labels and heatmap annotations sit on arbitrarily coloured slices and cells. To keep them legible we layered a translucent `rect` under every label, sized by guessing glyph widths (`src/graph/components/chartRender.tsx`, `pieLabelMarks`). F-220 declines a label background box for now; a halo needs no measurement and covers most of the same need.

## API

```ts
text(slices, { x: 'x', y: 'y', text: 'name', halo: true })
text(cells, { x: 'x', y: 'y', text: 'label', halo: { stroke: '#000', strokeOpacity: 0.6, strokeWidth: 2 } })
```

## For the reviewer

- Updates F-220 with this evidence rather than adding an entry; minor changeset; docs updated and synced.

## Validation

- `text.test.ts`, `svg-renderer.test.ts`, `canvas.test.ts`, `api-friction.test.ts`, `pnpm typecheck`: pass.
- Not run here: full `pnpm test`, `bundle:check`, `package:check` (see PR 04's notes on what our environment can't run).
