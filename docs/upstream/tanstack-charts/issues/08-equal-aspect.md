# Equal units on x and y (`aspect: 'equal'`)

## What we needed

Some plots only read right when a unit spans the same pixels on both axes: a circle of points should draw round, a map-like scatter shouldn't stretch, a vector field's arrows shouldn't skew. matplotlib calls this `set_aspect('equal')`, and Solenoid's XY charts take `aspect=equal` for it.

## Today

There's no way to tie the two position scales together. The domains have to be widened to the plot box's proportions, but the plot box is only known after layout, and the layout depends on the tick labels, which depend on the domains. `aspectRatio` on the adapters sizes the container, not the scales.

Our workaround (`src/graph/components/chartRender.tsx`, the XY view) lays the chart out to learn the box, widens the shorter domain to it, and lays out again because the new ticks can move the gutters:

```ts
let def = build(width - 50, height - 34)            // a guess at the plot box
for (let k = 0; k < 2; k++) {
  const box = createChartScene(def, { width, height }).chart
  def = build(box.width, box.height)                 // equal domains for the real box
}
```

Three layouts for one chart, and the second pass can still drift if a tick label changes width again.

## Suggestion

An option on the chart, for example `aspect: 'equal' | number` (data units of y per unit of x, matplotlib's sense), applied inside layout after the plot box is known: widen the shorter domain about its centre, or, with something like matplotlib's `adjustable: 'box'`, shrink the plot box instead. Niced or pinned domains would need a rule (widen only an open side, or decline to nice). Happy to help with a PR once the shape is settled.
