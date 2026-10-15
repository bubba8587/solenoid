# `rect` between two band categories spans centre to centre

## What happens

On a band scale, a `rect` whose `x1` and `x2` name the same category covers that whole band, but one whose ends name different categories runs from the first band's centre to the second's (`rect.ts`: `categoricalWidth` applies only when the two values are equal; otherwise `Math.min(x1, x2)` of the mapped centres). On 1.1.0, four categories with padding 0.2 on a 400 px chart:

```ts
rect([{ a: 'B', b: 'C', y1: 0, y2: 1 }], { x1: 'a', x2: 'b', y1: 'y1', y2: 'y2', inset: 0 })
// band B: 133..203, band C: 221..291
// rect:   168..256 (B's centre to C's centre)
```

## Where we hit it

Solenoid draws reference bands ("shade May to July") on column charts. Users expect the band to cover May's and July's columns, as it did in Recharts (`ReferenceArea` takes the first band's start and the last band's end). We draw those rects against a hidden linear scale lined up with the band scale's layout (`catScale` in `src/graph/components/charts/refs.ts`), which works but depends on d3's band arithmetic.

## Suggestion

Make a band interval span band edges: `x1` at its band's start and `x2` at its band's end (ordered by position), which also covers the equal-ends case you have now. If centre-to-centre is wanted somewhere, an option such as `interval: 'centers' | 'bands'` could keep it.
