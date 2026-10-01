# Solenoid — Pack Architecture (authoring guide)

> **Status: the framework is BUILT** — `packsStore` + pack registration, FC unit/format
> extensions (`fcExtensions.ts`), dormant-pack persistence, the **Geometry** pack as the worked
> example, and the **Composite** subgraph container (`nodes/composite.ts`). The settled calls
> live in the decision tree: [[B15]] leanCore and its children [[C76]] formulaPackDefault, [[C77]] compositeIsSubgraph,
> [[C78]] packLegibility and [[C79]] packActivationIsPresentation
> (`python tools/dte.py tree --under B15`). This doc is the guide for authoring packs; the open
> pack work (more packs, distribution/deps, variant-switch reconcile, port aliasing) lives in
> `backlog.md`.

## The core toolkit

What every pack builds on is always in the core, never an add-on ([[B15]] leanCore): the canvas
and the engine, units, the socket types and their legend, the formula language, the basic look of
a node, and saving and loading. A pack never ships its own units or socket types: two packs that
disagreed on units would break wiring between them. Most node families, by contrast, are packs
that can be switched on or off.

## Building a pack node

Default to a pre-set formula ([[C76]] formulaPackDefault): author the formula text and its
metadata (name, description, socket names and units, Excel mapping if any) as pack data, and
reach for real node code only when the node needs a native library, root-finding or
iteration, an embedded dataset to interpolate, or a custom widget. State, per node, which of
the two it is; the custom-logic nodes are the short list that gets the scrutiny (see
[reference-packs.md](archive/reference-packs.md) and
[archive/compute-architecture.md](archive/compute-architecture.md) for the library-bound
cases). A simple node that grows into several internal nodes becomes a composite
([[C77]] compositeIsSubgraph), never a Group.

A formula pack node saves as a plain locked Expression, so a document that uses one still
opens and computes with its pack switched off ([[C76]] formulaPackDefault). Formula nodes get
units right because the formula engine already understands them; custom code is harder to
trust from a third party and often runs only on desktop, which is why it is the short list.

### Input coercion — the default widens, opting out is one line
A custom-logic node's `data()` receives every input already coerced to its socket's
declared rank: a scalar widens into a `[scalar]` list, a list into a matrix, and so on
(the socket lattice guarantees lower-rank values *can* flow in; `coerceInputs.ts` does
the widening so 95% of nodes can assume their shape). Two painless opt-outs exist for the
node that handles shape itself — the socket is UNCHANGED either way (same glyph, same
accepted types), only the value handed to `data()` differs:
- `noWidenInputs = new Set([...keys])` — keep each listed input at its NATURAL rank (a
  scalar stays a scalar) but still get element coercion (logical→number). This is what a
  **broadcaster** wants (an element-wise op that returns a scalar for scalar inputs, a
  list for a list — the Expression node uses it for exactly this).
- `rawInputs = new Set([...keys])` — pass the value entirely uncoerced, for a node that
  branches on the raw runtime shape (frame-vs-cube, etc.).

Both are captured once, so a node with dynamic keys keeps the same Set and mutates it in
place. See the per-input coercion policy note in `coerceInputs.ts`.

## Locked to the user, open to the author

"Locked" and "let me control the internals" reconcile through two roles:

- The **pack author**, at authoring time, has full edit of the internals.
- The **end user**, on the canvas, sees a locked node, but with the parameters the author
  chose to promote.

## Exposing internals: per-port promotion

This is the mechanism behind "control the internals." For each internal input that is not
already satisfied by an internal wire, the author sets:

- **Exposure**: `hidden` (baked to its default) or `exposed`.
- **Tier**: `basic` or `advanced`. Advanced parameters tuck behind a disclosure so the
  default node stays clean. Confidence intervals on a stats node, for instance, should not
  clutter the face for someone who does not know what they mean. This is the zero-learning-curve
  principle applied to the node face.
- An `exposed` port is just a **normal Solenoid input**: an inline field with an optional
  overriding cable. No new widget, it reuses the existing inline-field-plus-socket idiom. So
  `hidden` versus `exposed` plus the tier are the only genuinely new pieces.
- Every promotable port needs an **author-defined default**: what `hidden` bakes in, and the
  fallback for an unwired `exposed` port. It lives next to that variable's restriction
  metadata, so restriction and promotion share one per-variable spec.

How promoted ports and locked internals read on screen follows [[C78]] packLegibility: as
packs add power, keeping the UI obvious comes first (a powerful node editor easily becomes
unreadable; Blender's is the cautionary tale), so the feature bends to the UI.

- **Mark the exception, not the rule.** Locked is the silent default; only a port the user can
  expose or has promoted gets an accent mark. No lock icon on every locked cable or port.
- **Moving is not rewiring.** A pack's insides can be rearranged freely while their wiring
  stays locked.
- **Say the mode once.** Viewing locked insides is shown once, as a tinted frame or a mode pill
  reusing the canvas-lock and layout pills, never as badges on each cable.

Aliasing
(many internal ports collapsing to one shell parameter, e.g. a single "confidence level"
feeding several internal nodes rather than N identical ports) is an open follow-up, tracked
in the backlog.

## Input restrictions

Restrictions are per-variable metadata on the node, validated in `data()`, authored mostly by
packs (a pack author knows a radius is non-negative and a polygon's side count is an integer;
a user typing `a*b+1` usually does not). The axes worth supporting: type (scalar vs list),
domain and range (min, max, nonzero), integer, required-versus-default, and eventually units
(which lean on the core unit system and are a larger track). Enforcement is validate-and-warn,
surfacing a clear message about which input and why, rather than clamping (silently wrong,
against the unit-honest ethos) or only rejecting at connect time (covers type alone). The
default that an unwired or hidden port falls back to lives in the same per-variable spec, so
restriction and promotion are one piece of metadata, not two.

## Errors

In a composite pack, an internal error has to **propagate cleanly to the boundary output**
(error values: `tree/specs/values/error-values.md`). How a restriction violation should
read to the user (a typed error out the socket, versus the node flagging the offending input
locally) is still open, tracked in the backlog.

## Saved files that use a pack you do not have on

Activation is a presentation filter and every pack stays registered ([[C79]]
packActivationIsPresentation), so a document using an inactive pack still loads and computes;
a type no build registers at all loads through Placeholder, lossless ([[C35]]
unknownViaPlaceholder). `SavedGraph.packs` rides the sidecar as an activation breadcrumb. NOT
built: a required-packs/versions record with an offer-to-enable flow on open, parked with the
pack-distribution system (`deferrals.md` "Pushed to 1.4/2.0"); it must land before the first
third-party or code pack ships.

Isolation levels: this is level 1 (every pack's constructors registered and its formula
functions resolving, activation filtering only the Add menu and autocomplete). A switched-off
pack still ships with the app; leaving it out of the build is deliberately not done. Level 2 (each
pack self-contained, enforced by structure) is a later tidy-up the pack/core wall is drawn for;
level 3 (third-party packs loaded at runtime) is a safety project of its own ([[C79]]
packActivationIsPresentation).
