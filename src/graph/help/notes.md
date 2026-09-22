<!-- [[B14]] oneDesignSystem (DESIGN.md § Voice) -->
# Notes

What doesn't fit in a tooltip: design choices, current limits, and how it works underneath.

## Small things you might not find

- **Edits commit on Enter or click-away, never on each keystroke**, the way a spreadsheet cell does. The graph doesn't recompute while you're mid-type, and Escape reverts the field.
- A dropped node **snaps to the dot grid** when snap is on, from the grid button in the top bar.
- The **lasso's direction decides what it catches**: clockwise grabs anything it touches, counter-clockwise only what's fully inside.
- **One Format Controller at the end of a row of Displays formats every box in front of it**, since its format reaches back through anything that just passes the value along.
- **A Cube cell holds a whole table of its own**, which you can drill into in place.
- Dates default to **DD-MMM-YYYY**. ISO and other styles are one pick away on a Format Controller.

## Where the edges are

What Solenoid doesn't do yet:

- **Formulas don't support Frames or Cubes.** Use the Frame nodes, such as JOIN. For row-by-row math, use a computed column: an **Fx** column in Frame Input, or the Computed Column node.
- **Lambdas don't recurse.**
- **An attached image persists on the desktop app**, saved as a file beside the document, but in the browser it lasts only for the session. A pasted web-image URL persists either way.
- The **desktop app is a work in progress**. It's where native files and the native table engine live.

## What to expect of performance

- In the browser everything computes in JavaScript, so very large data hits the browser's limits. The **desktop app runs table operations on a native engine**, so that's the place for memory-heavy joins, groups and pivots.
- Cables always draw as full curves. The app never straightens or hides them mid-drag to save frames.

## How it's meant to feel

- **No learning curve coming from a spreadsheet.** Anything that needs explaining is explained in place, in a tooltip, the legend or this reference, so you shouldn't have to search the web.
- **A wiring mistake should rarely become a wrong number.** Typed sockets refuse a bad connection and the shape rules refuse a bad dimension, so a mistake shows up as a refused cable or a red box, not a quietly wrong total three nodes later.
- **Nothing important is hidden** behind a menu you'd have to know to open.

## Under the hood

A calculation is a real dependency graph. Change one input and only what depends on it recomputes, and a shared step is evaluated once per pass. The same app runs in the browser with no install, and as a desktop app that adds local files and a native engine for heavy table work.
