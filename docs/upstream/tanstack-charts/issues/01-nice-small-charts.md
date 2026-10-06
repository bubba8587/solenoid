# `nice: true` over-widens the domain on small charts

## What happens

On a chart about 160 px tall, `resolveTickCount` gives a tick count of 2 (`scene.ts`, the plot height over 48), and `configured-scale.ts` then calls `scale.nice(2)`. For data from -8 to 44 that rounds the domain out to -100..100, so the data fills about a quarter of the plot. d3's own `nice(2)` does the same, and the compact linear scale matches it, so this is d3 parity made worse by the responsive tick count.

```ts
import { createChartScene, defineChart, dot } from '@tanstack/charts'
import { renderChartSvg } from '@tanstack/charts/svg'
import { scaleLinear } from '@tanstack/charts/scales/linear'

const rows = [{ x: 0, y: -8 }, { x: 1, y: 44 }]
const def = defineChart({
  marks: [dot(rows, { x: 'x', y: 'y' })],
  scales: { x: { scale: scaleLinear }, y: { scale: scaleLinear, nice: true } },
})
renderChartSvg(createChartScene(def, { width: 260, height: 160 }), { ariaLabel: 'y' })
// y ticks: -100, 0, 100
```

## Where we hit it

Solenoid draws charts inside 240 by 160 px canvas cards. Every small scatter, line and column figure niced too far. We now compute domains ourselves (round out from the data to a step from about one tick per 32 px, never fewer than four) and pass a configured scale.

## Suggestion

Nice with a floor on the count, for example `scale.nice(Math.max(tickCount, 5))` at `configured-scale.ts`, while keeping the guide's own tick count for the candidates. `nice: 5` already works as a per-chart workaround, so this is about the default. F-014 deliberately ties nice to the guide tick count, which is why this is an issue rather than a PR: is a floor acceptable there, or would you rather document `nice: <count>` for small charts?
