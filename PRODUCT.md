# Product

## Register

product

## Users

People who know Excel and want to build the same kind of computations as a visual graph instead of a grid of cells. They are analysts, modelers, and tinkerers, not programmers. They reach for Solenoid when a spreadsheet's hidden formula logic gets hard to follow and they want to see the structure of a calculation laid out as connected nodes. Their working context is focused and exploratory: building or debugging one model at a time, often iterating on values and watching results recompute.

## Product Purpose

Solenoid is a node-based computation graph tool, an Excel alternative for data tables. Each node is one operation; cables carry typed values (scalars, lists, tables, frames) between them, and the graph recomputes reactively as inputs change. It exists to make the logic of a computation visible and editable in a way a spreadsheet hides. Unit awareness is a flagship trait: values carry units, the Format Controller propagates them, and conversion is a first-class operation, so a model stays unit-honest end to end. Success is an Excel user building a working, correct graph without Googling anything.

## Brand Personality

Precise, calm, trustworthy. The feel is an engineering instrument, not a consumer app: quiet confidence, nothing flashy, every element earning its place. The voice is plain and direct, never marketing-toned. The interface should read as a careful tool that respects the user's attention and gets out of the way of the graph.

## Anti-references

- Generic SaaS / AI-startup look: no purple gradients, hero-metric cards, glassmorphism, or rounded-everything dashboard template.
- Childish or playful no-code: not Scratch-like bubbly blocks, not toy-ish. This is a serious computation tool.
- Skeuomorphic or cluttered chrome: no faux-3D bevels, no shadow overload, no busy UI competing with the graph for attention.

## Design Principles

- **Zero learning curve from Excel.** Every element that might need explaining is self-documenting: socket-type legend, hover tooltips with Excel equivalents, node descriptions, a function reference. Someone who knows Excel but has never seen a node graph should figure it out with no outside help.
- **The graph is the subject; chrome stays quiet.** Toolbars, menus, and panels recede so the nodes and cables hold focus. Calm over busy.
- **Edits commit on Enter or blur, never per keystroke.** Typed fields keep a local draft and propagate only on commit, Escape reverts. The same mental model as editing an Excel cell.
- **Unit-honest.** Units propagate through the graph and conversion is explicit. New nodes are built to respect units, not ignore them.
- **Accessibility is structural, not decorative.** The legibility typeface and colorblind-considerate socket palette are part of how the tool works, not a coat of paint. Motion is never used as a crutch and never degrades clarity (cables keep full fidelity during interaction).

## Accessibility & Inclusion

- Target WCAG AA contrast for body and UI text in both dark and light themes.
- Type is Atkinson Hyperlegible Next (UI) and Atkinson Hyperlegible Mono (code/values), the Braille Institute's legibility family. This is a fixed constraint.
- Socket-type colors are chosen to stay distinguishable across common color-vision deficiencies; the existing palette is kept and only tweaked minorly, never replaced with hue pairs that collapse under colorblind simulation.
- Tooltips carry structural meaning only (what a thing is / its Excel equivalent), never dynamic data, so screen-reader and hover affordances stay predictable.
- Respect reduced-motion: any added animation needs a non-motion equivalent.
