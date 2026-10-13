# Let `nice` round only the open end of a domain

## What we needed

Solenoid's charts take an optional y min and y max. When the user sets one and leaves the other open, the bound they typed has to stay exactly where it is, and only the open end rounds out to a tick. A chart with `ymin: 3` over data up to 44 should run 3..50, not 0..50.

## Today

`nice` rounds both ends of whatever domain it gets (`packages/charts-scales/src/linear.ts`, `scale.nice`; applied in `packages/charts-core/src/scale-input.ts`). Checked on 1.1.0:

```ts
import { scaleLinear } from '@tanstack/charts/scales/linear'
const s = scaleLinear().domain([3, 44])
s.nice(5)
s.domain() // [0, 50]: the 3 the user set is gone
```

So a chart with one fixed bound can't use `nice` at all. We compute the whole domain ourselves (`valueDomain` in `src/graph/components/charts/kit.tsx`): pick a step, round only the open ends, and emit ticks on that step so a rounded end always carries a tick.

## Suggestion

Let the axis say which ends are fixed, for example `nice: { count?: number, ends?: 'both' | 'min' | 'max' }`, or have `nice` leave alone an end the spec pins (a `domain: [3, undefined]` form, if partial domains are on the table). The tick candidates then need to include the fixed end's neighbourhood, which the existing tick planner already handles for configured domains.

## A smaller, separate question

Tick steps come from `[1, 2, 5, 10]` (`packages/charts-scales/src/ticks.ts`, `preferredMultiples`), as in d3. Ours also allows 2.5, so 0..10 at four ticks reads 0, 2.5, 5, 7.5, 10 rather than 0, 2, 4, 6, 8, 10 (one tick more than asked for). That's a taste call and d3 parity is a fair reason to say no; we mention it only so the register is complete.
