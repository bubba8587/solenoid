# feat(vector): per-datum stroke width and head length, optional filled head

## Summary

`vector` now accepts `VisualChannel<TDatum, number>` for `strokeWidth` and
`headLength`, so one mark can size each arrow's stroke and head per datum.
Constant numbers work as before. A new `head: 'open' | 'filled'` option
(default `'open'`) draws a closed, filled triangular head.

## Motivation

Solenoid draws vector fields (quiver plots) with `vector`. Short arrows need a
thinner stroke and a shorter head: at full stroke width and full head length,
a short arrow reads as a blob. Before this change `strokeWidth` and
`headLength` were one number per mark. To work around that, Solenoid's
`QuiverView` (`src/graph/components/charts/fieldFigures.tsx`):

- computes a stroke width and head length for each cell,
- rounds them to 0.1 px and 0.25 px steps,
- groups rows by the rounded pair,
- emits one `vector` mark per group, with synthetic ids (`sol-arrows-${gi}`).

So one field becomes many marks, sizes are quantized, and the mark list
changes shape whenever the data does. With this change the field is one
`vector` mark with two accessors.

Quiver plots usually draw filled heads, and `vector` only had open chevrons.
The filled head turned out small and self-contained, so it is in this PR.

## Changes

- `packages/charts-core/src/vector.ts`
  - `strokeWidth?: VisualChannel<TDatum, number>` (default `1.5`) and
    `headLength?: VisualChannel<TDatum, number>` (default `5`, still clamped to
    at least zero), resolved per datum with `visualValue`. This matches how
    `link` handles `strokeWidth` and how `vector` handles `stroke`.
  - `head?: VectorHead` with `export type VectorHead = 'open' | 'filled'`.
  - A private `filledVectorGeometry` takes the same options as
    `arrowGeometry`. It emits the shaft rule (class `ts-chart__arrow-shaft`),
    ended at the head's base, plus one `area` node (class
    `ts-chart__arrow-head`) with three points, painted with
    `fill: stroke` and `fillOpacity: strokeOpacity`. Ending the shaft at the
    base keeps a wide stroke from blunting the tip.
- `index.ts` and `universal-types.ts` export the `VectorHead` type.
- `arrow-geometry.ts` and `arrow.ts` are unchanged. The filled helper is in the
  vector module on purpose. Putting it in `arrow-geometry.ts` left the arrow
  bundle the same minified size, but esbuild renamed identifiers and the gzip
  size went up by 2 bytes. The arrow budget had no headroom left.
- Docs: `docs/reference/marks/rules-links-arrows-vectors-and-ticks.md` (option
  table, an accessor example, filled-head behavior), synced into
  `packages/charts-core/docs` with `pnpm docs:sync`.
- Changeset: `.changeset/vector-datum-stroke-and-head.md` (minor).
- `API-FRICTION.md`: new entry F-309 and its index row.

## API

Before (one mark per rounded size bucket):

```ts
const groups = new Map<string, { sw: number; hl: number; rows: Arrow[] }>()
// ...bucket rows by rounded strokeWidth/headLength...
marks: [...groups.values()].map((g, i) =>
  vector(g.rows, {
    id: `arrows-${i}`,
    x: 'x',
    y: 'y',
    length: 'length',
    rotate: 'rotate',
    strokeWidth: g.sw,
    headLength: g.hl,
  }),
)
```

After:

```ts
vector(field, {
  x: 'x',
  y: 'y',
  length: 'length',
  rotate: 'rotate',
  strokeWidth: (cell) => cell.strokeWidth,
  headLength: (cell) => cell.headLength,
  head: 'filled',
})
```

The new options are additive. A constant `strokeWidth` or `headLength` gives
the same output as before.

## Tests

`packages/charts-core/src/vector.test.ts`:

- `resolves stroke width and head length per datum`: two rows with different
  accessor results. Checks each rule's `strokeWidth` and the head-segment
  extent for each vector.
- `draws filled heads as closed triangles that end the shaft`: checks a single
  shaft rule, a 3-point `area` head with `fill`/`fillOpacity` from the stroke
  paint, the shaft shortened by `headLength * cos(headAngle)`, the tip at the
  vector end, and the `ts-chart__arrow-head` class in SVG output.

The existing vector and arrow tests pass unchanged.

## Validation

- `pnpm vitest run packages/charts-core/src/vector.test.ts packages/charts-core/src/arrow.test.ts`: pass (4 tests)
- `pnpm typecheck`: RESULT_TYPECHECK
- `pnpm test`: RESULT_TEST
- `pnpm docs:check`: RESULT_DOCS
- `pnpm package:check`: RESULT_PACKAGE
- `pnpm bundle:check`: RESULT_BUNDLE

Bundle measurements (exact gzip bytes):

| Entry                         | main   | this PR | Delta |
| ----------------------------- | -----: | ------: | ----: |
| D3-scale arrows + static SVG  | 22,136 |  22,136 |     0 |
| D3-scale vectors + static SVG | 22,218 |  22,341 |  +123 |

The vector delta is 2 bytes for the per-datum channels and 121 bytes for the
filled head. The vector budget in `scripts/measure-bundles.mjs` is
`21.698` KiB (22,218.75 bytes), so this PR needs it raised to `21.818` KiB.
**That budget change is not in this patch and needs a maintainer decision.** If
121 bytes is too much for an option that some vector consumers will never use,
`head` can come out and go to a follow-up. The channels alone measure 22,220
bytes, which still exceeds the current cap by 1.25 bytes, so the budget needs
some increase either way (about `21.701` KiB without `head`).

## Friction log

F-309, "Vector stroke and head size were fixed per mark".
