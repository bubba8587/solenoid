# docs: name the guide line style fields and where grid opacity is set

## Summary

The axis docs describe a grid style's fields as "stroke, opacity, width, dash, and line-cap". The `ChartGuideLineStyle` fields are `stroke`, `strokeOpacity`, `strokeWidth`, `strokeDasharray` and `lineCap`. This names them exactly in both places and says where the default grid opacity lives.

## Motivation

While moving Solenoid's charts from Recharts to TanStack Charts we passed `grid: { opacity: 1 }` from the prose, saw no change, then tried `strokeOpacity` and inspected the SVG. The grid group still read `stroke-opacity="0.11"`, so we concluded the style was ignored and worked around it in CSS. In fact each grid line carries the style's `strokeOpacity`, which overrides the group's default. Both steps were documentation problems: the field name, and not knowing that the default sits on the group.

## Changes

- `docs/concepts/layout-axes-and-coordinates.md`: list the style fields by their names.
- `docs/reference/scales-guides-and-color.md`: list the fields by name, and add two sentences saying the default grid opacity is set on the grid group while a style's `strokeOpacity` is written on each line.
- `pnpm docs:sync` regenerated `packages/charts-core/docs`.

No package code changes, so no changeset.

## Validation

- `pnpm docs:sync`: clean.
- `pnpm docs:check`: passes.
