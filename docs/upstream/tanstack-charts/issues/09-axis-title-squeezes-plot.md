# A long axis title collapses the plot

## What happens

An axis title wider than the plot grows the margins to fit it, and on a small chart the plot shrinks to nothing. On 1.1.0, a 218 × 160 scatter:

```ts
import { createChartScene, defineChart, dot } from '@tanstack/charts'
import { scaleLinear } from '@tanstack/charts/scales/linear'

const chart = (label?: string) => defineChart({
  marks: [dot([{ x: 0, y: 1 }, { x: 10, y: 5 }], { x: 'x', y: 'y' })],
  scales: {
    x: { scale: scaleLinear().domain([0, 10]), axis: { label: label ? { text: label } : undefined } },
    y: { scale: scaleLinear().domain([0, 5]) },
  },
})
createChartScene(chart(), { width: 218, height: 160 }).chart
// { x: 18, width: 192, ... }
createChartScene(chart('Short title'), { width: 218, height: 160 }).chart
// { x: 18, width: 192, ... }
createChartScene(chart("Monthly street prices from PCPartPicker, Tom's Hardware, TechSpot and archived store listings"), { width: 218, height: 160 }).chart
// { x: 245, width: 1, ... }: a 1 px plot that starts past the chart's right edge
```

## Where we hit it

Solenoid's chart cards are about 220 px wide, and a user-written x label of a sentence is common. The card's x axis lost all but one tick label. We now cut titles to the plot's width with an ellipsis before handing them over (`axisLabel` in `src/graph/components/charts/kit.tsx`).

## Suggestion

Never let a title move the plot sideways: clip it to the plot's extent (with an ellipsis, or a `maxWidth`/`overflow` option), or wrap it onto more lines and take the extra height instead. Growing the margins for a title's height is fine; for its width it can't end well.
