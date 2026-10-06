# Give `axis.ticks.format` the tick step (for compact labels that stay distinct)

## What we needed

Solenoid writes value-axis ticks in a compact form: three significant figures with K, M, B or T above a thousand, rounding before the unit is picked, so 999,999 reads 1M rather than 1000K. When three figures can't tell neighbouring ticks apart, it writes them to two places past the step: ticks 100000 and 100250 read 100K and 100.25K, not 100K and 100K.

```ts
export function compactTick(n: number, step?: number): string {
  if (!Number.isFinite(n)) return ''
  const r = Number(n.toPrecision(3))
  const a = Math.abs(r)
  const unit = a >= 1e12 ? 1e12 : a >= 1e9 ? 1e9 : a >= 1e6 ? 1e6 : a >= 1e3 ? 1e3 : 1
  const suffix = unit === 1e12 ? 'T' : unit === 1e9 ? 'B' : unit === 1e6 ? 'M' : unit === 1e3 ? 'K' : ''
  if (step && step > 0 && n !== 0 && step < 10 ** (Math.floor(Math.log10(Math.abs(n))) - 2)) {
    const places = (x: number, cap: number) => {
      let d = 0
      while (d < cap && Math.abs(Math.round(x * 10 ** d) - x * 10 ** d) > 1e-6) d++
      return d
    }
    return `${Number((n / unit).toFixed(places(n / unit, places(step / unit, 12) + 2)))}${suffix}`
  }
  return `${Number((r / unit).toPrecision(3))}${suffix}`
}
```

`Intl.NumberFormat` with `notation: 'compact'` covers the first half but not the step-aware half, because a formatter called with one value can't know its neighbours.

## Today

`axis.ticks.format` is `(value) => string`. To be step-aware we precompute the ticks ourselves (`ticks.values`) so we know the step before formatting. `configured-scale.ts` does call `scale.tickFormat(count)` when a scale has one, so a scale factory that attaches its own `tickFormat` is a workaround, but it means wrapping every scale.

## Suggestion

Pass a context to the formatter, matching the repo's one-data-plus-one-context callback rule: `format?: (value: TValue, context: { index: number; ticks: readonly TValue[] }) => string`. That lets an application derive the step without precomputing ticks. A compact formatter helper could follow, but the context alone unblocks it.
