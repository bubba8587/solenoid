# Notes

The things that don't fit in a tooltip — deliberate choices, honest gaps, and a little of what's under the hood.

## Small things you might not find

- **Edits commit on Enter or click-away, never on each keystroke**, the way a spreadsheet cell does. The graph doesn't recompute while you're mid-type, and Escape reverts the field.
- A dropped node **snaps to the dot grid** when snap is on (the grid button in the top bar).
- The **lasso's direction decides what it catches** — clockwise grabs anything it touches, counter-clockwise only what's fully inside.
- A **Format Controller's lock rides the value, not the node**, so a single Controller at the end of a row of Displays formats every box in front of it.
- **A Cube cell holds a nested table of its own**, drilled into in place.
- Dates default to **DD-MMM-YYYY**. ISO and other styles are one pick away on a Format Controller.

## Where the edges are

What Solenoid doesn't do yet, said plainly:

- **Formulas stop at data tables.** Expression and Lambda take scalars, lists, matrices, and complex numbers — frames and cubes stay node-wired on purpose (the table verbs are nodes, and a computed column's `@name` or bare-name references are the row door). The formula box is the quick path, not the whole engine.
- **Lambdas don't recurse.**
- **An attached image persists on the desktop app** — saved as a file beside the document — but in the browser it lasts only for the session. A pasted web-image URL persists either way.
- The **desktop app is a work in progress** — it's where native files and the native table engine live.

## What to expect of performance

- In the browser everything computes in JavaScript, so the browser is the ceiling for very large data. The **desktop app runs the relational table operations on a native engine** — that's where memory-heavy joins, groups, and pivots belong.
- Cables always draw at full curved fidelity. The app never straightens or hides them mid-drag to buy frames. If something has to give under load, it isn't the thing you're looking at.

## How it's meant to feel

- **No learning curve from a spreadsheet.** Anything that might need explaining explains itself in place — a tooltip, the legend, this reference — so you shouldn't have to search the web to use it.
- **A wiring mistake should rarely become a wrong number.** Typed sockets refuse a bad connection and the shape rules refuse a bad dimension, so a mistake shows up as a blocked cable or a red box, not a silently wrong total three nodes later.
- The interface stays out of the way. It won't narrate the obvious, and nothing important hides behind a menu you'd have to know to open.

## Under the hood

A calculation is a real dependency graph: change one input and only what depends on it recomputes, with a shared sub-result evaluated once per pass. The same app runs in the browser with no install, and as a desktop app that wraps it in a small native shell for local files and a native compute engine for heavy table work.
