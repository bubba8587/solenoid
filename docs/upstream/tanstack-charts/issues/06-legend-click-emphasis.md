# A legend click that pins the emphasis instead of hiding the series

## What we needed

In Solenoid a click on a legend entry spotlights that series: every other series fades to about 18% opacity, and a second click (or a click on another entry) releases or moves it. Nothing is hidden, so the axes don't rescale and the faded series still give context. On a canvas of small chart cards, hover is a poor fit (the pointer is usually on its way somewhere else), so the click has to stick.

## Today

`interactiveColorLegend` (`packages/charts-core/src/interactive-legend.ts`) has two behaviours: a click toggles visibility through the `visible` signal, and `hover: 'series'` emphasises the hovered or focused series by setting a state focus with `source: 'legend', pinned: false`. There's no way to make the click set that emphasis and keep it.

We draw our own DOM legend (`SeriesLegend` in `src/graph/components/charts/kit.tsx`) and fade the marks ourselves (`fade`, `useSeriesSpotlight` in `chartCore.ts`). Part of that is ours to keep regardless: the legend sits in the card's DOM so the node editor's drag doesn't steal its clicks, and our series are separate marks rather than one color channel.

## Suggestion

A click mode on the interactive legend, for example `click: 'toggle' | 'emphasize'`, where `'emphasize'` sets the same legend state focus with `pinned: true` and a second click on the same entry clears it. The pinned flag already exists on the state focus, so this looks like a small change; we'd be happy to send it as a PR if the shape suits you.
