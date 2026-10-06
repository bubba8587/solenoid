# Stroke a line with a per-point colour ramp

## What we needed

Solenoid's XY Line can colour points by a numeric column through a colormap, and the line between two points fades from the first point's colour to the second's, as matplotlib's coloured line collections do.

## Today

`lineY` takes its stroke from the first row of each series (`line.ts`), and gradient resources are `objectBoundingBox` only. We draw one `link` per segment, each painted with its own `linearGradient` whose x1/y1/x2/y2 follow the segment's direction in its bounding box. That breaks on a perfectly horizontal or vertical segment: its bounding box has zero height or width, so SVG doesn't paint the gradient at all. We fall back to a solid colour for those segments, and to solid colours past 400 segments.

## Suggestion

Either of these would remove the workaround:

1. Gradient resources with `units: 'userSpaceOnUse'` in plot coordinates, so a segment's gradient can run from point to point regardless of its box.
2. A line option that interpolates a per-row stroke along the path (for example `stroke` as a per-row channel with `strokeInterpolate: true`), rendered as segments with gradients in SVG and as per-segment `createLinearGradient` on Canvas.

Option 1 is the smaller, more general primitive.
