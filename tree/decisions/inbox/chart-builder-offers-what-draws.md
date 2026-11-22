---
title: The Chart Builder offers US Map, and Merge Plots keeps its XY-only options
proposed_ring: C
ask: human
date: 2026-11-21
parents:
  - "[[C96]]"
---
## Decision

Two gaps found by reading every chart against what the Chart Builder offers it (backlog: "Nothing lists what a chart
renderer reads"). The other charts offer exactly what they draw.

1. **US Map gets a Chart Builder target.** Today the map reads a title, colors, a color scale, marker size and opacity,
   but the builder has no US Map entry, so those can only be typed by hand.
2. **Merge Plots keeps offering Aspect, Log y, X min and max, and Break lines over gaps**, which only change the figure
   when one of the merged plots is a Scatter, XY Line or Bubble. The builder can't see which plots are wired, so the
   choice is to offer them always (and say so in the spec's list of options that can do nothing) or to split Merge
   Plots into two builder targets, one for category plots and one for XY plots.

## Why

The rule is that a chart is offered exactly the options it draws. US Map breaks it one way (options it draws, not
offered); Merge Plots the other (options offered that do nothing on a merge of columns and lines). The spec already
accepts the second kind where the builder can't know the data: Color does nothing on a chart with several series.

## What ratifying means

- **Lean:** Ratify both. A US Map target is plain missing work. Two Merge Plots targets would ask people to know in
  advance whether their plots are XY, which is harder than ignoring four rows.
- **Ratify:** Add a US Map target; keep Merge Plots' rows and list them as the data-dependent exception.
- **Reject (1):** US Map options stay typed-only.
- **Reject (2):** Merge Plots splits into a category target and an XY target, each offering only what it draws.
