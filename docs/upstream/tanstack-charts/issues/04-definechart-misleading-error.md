# A wrongly typed `focus` makes `defineChart` blame `marks`

## What happens

A custom focus strategy typed without its x/y value generics on a numeric-x chart is correctly rejected (F-087), but TypeScript reports the error from the last single-argument overload, the responsive builder:

```ts
import { defineChart, dot, type ChartFocusStrategy } from '@tanstack/charts'
import { scaleLinear } from '@tanstack/charts/scales/linear'

interface P { x: number; y: number }
const rows: P[] = [{ x: 1, y: 2 }]
const focus: ChartFocusStrategy<P> = {   // value generics left at ChartValue
  resolve: (points) => points.slice(0, 1),
  group: (_points, { point }) => [point],
  navigation: (points) => points,
}

defineChart({
  marks: [dot(rows, { x: 'x', y: 'y' })],
  scales: { x: { scale: scaleLinear }, y: { scale: scaleLinear } },
  focus,
})
// error TS2769: No overload matches this call. ... Object literal may only specify known
// properties, and 'marks' does not exist in type '(context: ChartBuildContext) => CheckedChartSpec<...>'
```

The real problem is `focus` (`ChartValue` is not assignable to `number`), but the message points at `marks`, the one property that is correct.

## Where we hit it

Solenoid's contour figure (`src/graph/components/charts/fieldFigures.tsx`) uses a pointer-following focus strategy; the misleading message cost a while before we spelled out `ChartFocusStrategy<Datum, number, number>`.

## What we tried

Moving the static-spec overload of `defineChart` after the config and function overloads does make this case report the `focus` mismatch. It is not a fix: with that order, an ordinary static spec is matched by the responsive config overload first and loses its inferred type (`configured-scale.test.ts` and `type-contract.test.ts` fail typecheck: "Property 'marks' does not exist on type 'Omit<ResponsiveChartDefinition…>'"). So overload order alone can't do it.

## Suggestion

Options we can see, all needing a maintainer's view of the overload set:

- Narrow the config overload so an object with `marks` can never match it, then reorder.
- Keep the order and add a dedicated diagnostic overload (or a conditional type on `focus`) that names the value-type mismatch.
- Document the generic requirement next to `ChartFocusStrategy` in the focus reference, which is the cheap mitigation.
