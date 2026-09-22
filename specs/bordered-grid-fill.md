<!-- [[C102]] gridFillThenForecast -->

# Spec: Bordered-grid fill

Serves [[C102]] gridFillThenForecast. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

Grid fill is the Interpolate card's `grid` mode and the matrix form of the `INTERPOLATE` formula. It takes a table of Z values with some cells blank and returns the same table with the blanks filled. Each column has an X coordinate and each row a Y coordinate, and a cell's value is treated as a height at that (X, Y) point. The code is `gridAxes` and `fillGrid` in `nodes/mathUtils.ts`, with the forecast surface in `nodes/surfaceFit.ts`; `stats.test.ts` pins the behavior.

## Inputs and coordinates

The coordinates ride beside the table, never inside it: the card has three inputs, `z` (Table), `xs` (one X per column) and `ys` (one Y per row), and the output `result` (Filled). The formula form is `INTERPOLATE(table, xs, ys, forecast)`, chosen over the list form when the first argument is a matrix. `gridAxes` normalizes the inputs:

- The table becomes a rectangle as wide as its longest row. A cell that is not a finite number (a blank, an error, text) becomes blank.
- An empty table, or one with no columns, gives a null result.
- An unwired axis counts 1, 2, 3 and so on, the 1-based index. In the formula form, an omitted or blank axis argument counts the same way.
- A wired axis whose cable carries a blank leaves the shape unknown, so the whole result is null.
- A wired axis must hold exactly one finite number per column (Xs) or row (Ys). A count mismatch is `#SHAPE!` ("Xs has 3 values for 4 columns"); a non-finite entry is `#VALUE!`.
- A table that arrives as an error passes the error through.

Filling keeps every cell in the input table's unit (`carryMatrixUnit`).

## The two passes

The known cells are the ones holding numbers. The **coarse grid** is the set of rows and columns that carry at least one known cell. Known cells always pass through unchanged.

**Pass 1, bilinear interpolation.** For each blank cell at (qx, qy):

1. Find the coarse rows at or above qy and at or below it, each sorted nearest first; do the same for columns and qx. If any side is empty, the cell sits past the data on that axis and cannot be enclosed. Pass 1 leaves it for pass 2.
2. Keep at most the nearest `WIDEN = 4` lines on each side.
3. Try every box formed by one line from each side, nearest lines first. Skip a box when any of its four corners is blank, and skip it when it is contested (below). The first box that survives wins, so the closest box with four known corners fills the cell. Widening past blank corners is what lets a run of holes interpolate across the missing samples; the query always stays inside the box, so this is still interpolation.
4. Fill the cell by true bilinear interpolation of the four corners, the same answer as MATLAB `interp2` or SciPy `RegularGridInterpolator` with `"linear"`: interpolate along X on the top and bottom edges, then along Y between them. When the box has zero width or height, that direction's weight is 0.

**Pass 2, forecast.** With `forecast` on, the default, every cell pass 1 left blank fills from a smooth surface fitted through all the known points (`fitSurface`). This covers scattered gaps and extrapolates past the data with a linear trend at the edges. A surface value that is not finite leaves the cell blank. With `forecast` off, only cells pass 1 enclosed are filled and every other blank stays null; a lookup table does not extrapolate.

## The widening cap

`WIDEN = 4` is load-bearing, not a tidy constant. Without a cap, scattered data (a diagonal, for one) rejects every candidate box, and the four nested loops try every combination of lines, O(lines⁴) per cell, which takes seconds on a modest grid. Four lines still cross runs of several consecutive holes. Anything sparser is scattered data, which the surface handles anyway.

## Contested boxes

A box is **contested** when some known point other than its four corners sits inside it. A contested box is skipped, so the cell falls through to a wider box or to the surface rather than ignoring nearer data ([[C102]] gridFillThenForecast).

- **A full box** (two different rows and two different columns) is contested by any known point inside it or exactly on its edge.
- **A degenerate box** is a segment on one row (when the query row is itself a coarse row) or on one column. It is contested only by a known point on that same row or column strictly between its two ends. Known data on other rows or columns does not contest a segment.

The effect is that edges defer to the surface: an uncontested segment along the table's border fills as a straight line between its two known ends, while interior cells whose boxes hold data curve with the surface. The rule prevents the sine-diagonal failure, where the only box with four known corners was the table's four zero corners and every blank would otherwise fill flat zero with the whole diagonal sitting inside that box.

## The forecast surface

`fitSurface(points)` returns a function of (x, y), or nothing when there are no points.

1. Scale x and y to 0 to 1 over the points' range, for numerical stability. An axis with no spread scales to 0.
2. With 3 to 220 points (`TPS_MAX_POINTS`), fit a thin-plate spline: exact through every point, with kernel r²·log r and an affine term a₀ + a₁x + a₂y, solved by Gauss-Jordan elimination with partial pivoting. Past 220 points the O(n³) solve is not worth it.
3. With fewer than 3 points, more than 220, or a singular system (collinear points), fall back to a least-squares plane. The slope terms are regularized by 10⁻⁶ times the matrix trace plus one, so the plane always solves; if it still cannot, the surface is flat at the mean of the known values.
