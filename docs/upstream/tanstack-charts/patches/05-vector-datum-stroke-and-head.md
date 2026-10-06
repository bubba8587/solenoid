# feat(charts): per-datum vector stroke width and head length, filled heads

## Summary

`vector` takes one `strokeWidth` and one `headLength` per mark, and draws open chevron heads only. This makes both a `VisualChannel<TDatum, number>` (a number still works) and adds `head?: 'open' | 'filled'` (default `'open'`), where `'filled'` closes the head into a filled triangle and stops the shaft at its base.

## Motivation

Moving Solenoid's charts from Recharts to TanStack Charts, our vector-field figure thins the stroke and shortens the head on short arrows, because a full-width stroke on a short arrow reads as a blob (`src/graph/components/charts/fieldFigures.tsx`). With one width per mark we split the arrows into many marks grouped by rounded width and head length. Our original canvas figure drew filled heads; the port had to settle for open ones.

## API

```ts
vector(cells, {
  x: 'x', y: 'y', length: 'len', rotate: 'angle',
  strokeWidth: (d) => 0.7 + 1.3 * d.t,
  headLength: (d) => Math.min(4.5, d.len * 0.55),
  head: 'filled',
})
```

## For the reviewer

- `headAngle` stays per mark.
- Friction entry F-309 (renumber if several of our PRs land); minor changeset; docs updated and synced.

## Validation

- `vector.test.ts` (per-datum widths and lengths, filled head geometry), `api-friction.test.ts`, `pnpm typecheck`: pass.
- Not run here: full `pnpm test`, `bundle:check`, `package:check` (see PR 04's notes on what our environment can't run).
