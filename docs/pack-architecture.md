# Solenoid — Pack Architecture

> **Status (2026-07-05): the framework described here is BUILT** — `packsStore` +
> pack registration, FC unit/format extensions (`fcExtensions.ts`), dormant-pack
> persistence (an unknown type loads as a Placeholder, wiring kept), the
> **Geometry** pack as the worked example, and the **Composite** subgraph
> container (`nodes/composite.ts`, drill-in editor, the full run-mode set incl.
> Monte Carlo and manual Refresh). This doc
> remains the design rationale + the guide for authoring NEW packs; the open pack
> work (more packs, Timesavers idioms, distribution/deps, variant-switch
> reconcile, port aliasing) lives in `backlog.md`.

The principle: a small, lean core app plus a large library of optional add-ons
(Packs) that are turned off by default. Almost everything in the reference-packs
doc and the big node brainstorm is a Pack, not a core feature.

## The idea in one line

Ship a lean core. Make most node families optional add-ons that the user switches on only
if they want them. The goal is that someone opening Solenoid for the first time sees a
clean, simple tool, not a wall of two hundred specialist nodes they will never use.

## What can never be an add-on

Some things are shared foundation. Every pack uses them, but no pack owns them or is
allowed to ship its own version, because if two packs disagreed on these the whole graph
would stop fitting together. These stay in the core, always:

- The canvas and the calculation engine (the thing that runs the graph).
- The unit system. This is the flagship feature and it cuts across everything. A steam
  pack and a finance pack have to speak the same units, or you could not wire one into the
  other. Units live in the core.
- Socket types and the socket legend (the shapes and colors that say what each wire carries).
- The small formula compiler that already powers the Expression node. A lot of packs will
  reuse it.
- The basic look of a node (the card, the sockets, the header) and the save/load system.

Taken together, this list is the "toolkit" that a pack is allowed to build on. Pinning
down exactly what is in that toolkit is the real design work, because it is the promise the
core makes to every pack: build on these and we will not break you. If packs are allowed to
reach past the toolkit and grab at the core's internals, they stop being isolated, and the
core can never be changed again without breaking them.

## What a pack is mostly made of: pre-set Expression nodes

The default shape of a pack node is a pre-set Expression node. The Expression node already
takes a formula, turns its named variables into input sockets, and computes the result
through the core formula compiler. A pack node is usually that same machinery with the
formula and the sockets fixed and named for a purpose, so the user gets "Antoine vapor
pressure" instead of having to type the Antoine equation themselves. Nothing new runs at
calculation time; it is the core compiler evaluating a formula we shipped instead of one the
user typed.

This is the preferred way to build a pack node, and most of the reference and brainstorm
nodes can be built this way. It keeps packs cheap, keeps them honest about units (they run
through the same compiler the unit system already understands), and has a payoff for the
dormant-pack problem below.

Concretely, the target is that a formula-based pack is one JSON file: a list of formula
text strings plus their metadata (name, description, socket names and units, Excel mapping
if any), which base Solenoid compiles. It is not new node code. When we build the example
domain packs (Geometry, or converting the electromagnetism nodes in the Flux Calculator seed
into a pack), the default move is to author that JSON, not to write and register new real
nodes. Reach for actual node code only when a node trips one of the custom-logic cases
below. The point of this doc is to stop that reflex to build a new node when a formula entry
in a pack file would do.

A pack must declare when a node needs more than the Expression node can evaluate. Some
nodes genuinely cannot be a pre-set formula:

- It binds to a native compiled library (steam and water, refrigerants, linear algebra).
- It root-finds or otherwise iterates (the implicit correlations like Colebrook, property
  inversions).
- It interpolates an embedded dataset (the Interpolated Lookup primitive).
- It needs a custom widget or any behavior the node toolkit does not already provide.

These are fine, but they are the exception and they carry real weight: they ship actual
code that runs during calculation, they are the nodes that make level-2 isolation and
eventually level-3 safety hard, and they are usually desktop-only because of the library
binding (see [reference-packs.md](archive/reference-packs.md) and
[archive/compute-architecture.md](archive/compute-architecture.md)). So a pack states, per node, whether the
node is a pre-set formula or custom logic, and the custom-logic ones are the short list that
gets the scrutiny.

This also sharpens the dormant-pack case below. A pure pre-set-formula node is essentially
data: a formula string plus its socket declarations. The core compiler can evaluate it even
when the pack that named it is switched off, so a saved file using only formula-based pack
nodes can in principle still compute with the pack absent. A custom-logic node cannot; with
its pack off it can only fall back to a harmless placeholder. The formula-versus-custom line
is therefore not just a build-cost distinction, it is what decides whether a dormant pack
degrades gracefully or goes inert.

## One face to the user, two ways to build a pack node

Whatever a pack node is made of, it presents to the person on the canvas the same way:
declared input sockets (each with restriction metadata and a default), declared output
sockets, and a locked body. That single contract has two implementations:

- **Simple pack node.** A single compiled expression, optionally with a **variant dropdown**
  that switches between a few closely-related formulas. This is the op-selector
  composability pattern the core already uses (Aggregate, Arithmetic), not multi-node internals.
  Its variables become input sockets exactly as the Expression node already derives them, and
  its restrictions are metadata validated in `data()`. It must not materialize boolean-gate
  or clamp sub-nodes to enforce a restriction. That hand-wired approach is the user-land
  workaround for a plain Expression node; a pack expresses the restriction as data, not as
  real nodes. This is the pre-set-Expression shape from the section above.

- **Composite pack node (a subgraph / macro node).** An encapsulated subgraph with a declared
  boundary. Build it as a real subgraph, **not as a Group variant.** A Group has no sockets,
  no `data()`, spatial/hybrid membership, and an inferred boundary, which is the opposite of a
  pack node on every axis: a pack node has a declared contract and computes. Ship the simple
  shape first and grow into the composite one without changing how packs appear, how
  restrictions attach, or how errors surface. The simple pack is just the degenerate
  single-node case of the composite one.

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

Aliasing (many internal ports collapsing to one shell parameter, e.g. a single "confidence
level" feeding several internal nodes rather than N identical ports) is an open follow-up,
tracked in the backlog.

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

Two things, orthogonal to the above:

- **Typed error values** (`#NUM!` and friends) as a foundation. Today an error is a bare `NaN`
  or `Infinity` (with `null` meaning NA), so a violated input gives no signal of which input or
  why. Introducing typed errors is a cross-cutting change to every `data()`, to IFERROR and the
  IS-checks, and to display formatting.
- In a composite pack, an internal error has to **propagate cleanly to the boundary output**.

How a restriction violation should read to the user (a typed error out the socket, versus the
node flagging the offending input locally) is still open, tracked in the backlog.

## Keeping it legible is the governing constraint

As packs and subgraphs add power, keeping the UI obvious is the top priority, not a polish pass
at the end. This is the same reason Conduit reroute nodes exist: so bundles do not turn into
spaghetti. Blender's node graph is the cautionary tale, powerful and illegible. The feature
bends to the UI, not the reverse. Concretely:

- **Signal the exception, not the rule.** Locked is the silent default with no chrome. Only an
  exposable or promoted port gets an accent affordance, so the eye lands on the few interactive
  points instead of a field of padlocks. Never stamp a lock icon on every locked wire or port.
- **Separate layout from structure.** "Adjust spacing" and "rewire" are different permissions.
  A subgraph's arrangement can be freely movable while its wiring stays locked. "Can move" is
  not "can rewire."
- **Convey the mode at the frame, not per element.** "You are viewing locked internals" is said
  once, as a tinted inner-canvas frame or a mode pill, reusing the existing canvas-lock and
  layout-pill chrome, not per-wire badges.

## What "isolated" can mean (three levels, lightest to heaviest)

"Fully isolated" could mean any of three things, and they are very different amounts of work:

1. **On/off switch, with the pack loading only when switched on.** When a pack is off, its
   code is not loaded into the app at all, and its nodes do not show up in the Add menu or
   the Function Reference. This is the lightest version and it is enough to get the "clean
   core, most things dormant" outcome. All packs are still made by us, still in one project.

2. **Each pack is its own self-contained piece.** A pack can only use the shared toolkit and
   nothing else, enforced by how the project is structured rather than by good manners. Same
   idea as level 1, but the wall between pack and core is real instead of a convention. Still
   all made by us.

3. **Packs made by other people, loaded while the app is running.** This is an add-on store.
   It brings a safety problem: a node runs real code when it calculates, so a pack from a
   stranger is running a stranger's code on your machine. That needs a way to fence the pack
   off from the rest of your system, which is a whole project of its own.

Best read of the plan: aim for level 1 now, but draw the wall cleanly enough that getting to
level 2 later is a tidy-up and not a rewrite. Level 3 is a someday question and is mostly
about safety and trust, not about how the code is organized.

## The one genuinely tricky part: saved files that use a pack you do not have on

This is the problem a normal spreadsheet never has to deal with. If you save a graph that
uses a steam node, and later open it with the steam pack switched off, the app has to do
something sensible instead of crashing or silently throwing your work away. So:

- Saved files record which packs they need (and which version of each).
- Opening a file checks that list and offers to switch on anything missing, rather than just
  dropping the nodes it does not recognize.
- If a pack truly is not available, the missing nodes become harmless placeholders that keep
  your numbers and your wiring intact, so nothing is lost and nothing crashes.
- Packs change over time, so a saved file also records the version it was built against.

This is the part that makes a pack system real work rather than just a folder convention. It
is worth designing before there are saved files out in the world, not after.

### Current code vs this plan (2026-06-21 audit — none of the above is built yet)

A read of `persistence.ts` + `persistenceCore.ts` shows the dormant-pack handling above is
**still entirely aspirational**, and the gap is sharper for some pack node shapes than others:

- **Saves do NOT record which packs (or versions) they need.** There is only a save-format
  ceiling `v` (`persistenceCore.ts` `CURRENT_SAVE_VERSION`, forward-safety — refuse a
  newer-than-current file), no per-graph pack-provenance list. So bullets 1 and 4 above don't
  exist.
- **A missing node type loads as a PLACEHOLDER (shipped in 1.0.0).** On load, an
  unregistered `type` becomes a `PlaceholderNode` (`nodes/placeholder.ts` +
  `persistence.ts`): inert, keeps its wiring AND its captured init data, and
  re-serializes as the ORIGINAL type — lossless round-trip. `SavedGraph.packs`
  carries the provenance breadcrumb. The "harmless placeholders that keep your
  numbers and your wiring intact" promise (bullet 3) is met.
- **Registration is eager** (`nodeRegistry.ts` is a static map of all ctors), and pack
  activation is a presentation filter only (`packs.ts` — "Activation is a PRESENTATION filter
  only"). So level-1 "code not loaded when off" isn't built; this is known/expected, not a bug.

**The shape-dependent nuance that matters for the node proposals:** a **formula-data** pack
node serializes as a core `ExpressionNode` (always registered), so a dormant *formula* pack
survives load fine — it reloads as a locked Expression and still computes. The drop-not-
placeholder gap therefore only bites **custom-logic / code packs** — i.e. the visual & input
**code packs** in `archive/io-visual-control-node-proposal.md` (the first real code packs) and the
`[C]` nodes in `archive/timesavers-pack-proposal.md`. Net: the formula-pack thesis degrades gracefully
*today*; the code-pack story needs the placeholder + pack-provenance work before the first code
pack ships, or deactivating a pack silently severs wiring in saved graphs.

## The current code already does half of this

A recent change moved each node's description and Excel mapping onto the node itself, and
made the Add menu and the Function Reference build themselves from that information. That is
exactly the seam a pack system extends. Right now every node registers itself the moment the
app starts. The pack change is to make that happen only when a pack is switched on. Because
the menus already build themselves from node information, they mostly need a filter for
"only show packs that are on," not a rewrite.

## Rough order of work, if this ever gets picked up

1. Decide exactly what is in the shared toolkit (the core-vs-pack line above).
2. Change node registration from "everything loads at startup" to "load when switched on."
3. Solve the saved-file-needs-a-dormant-pack case.
4. Carve the existing node families into packs, and ship most of them switched off.

The reference packs and the big brainstorm all come after this. See
[archive/compute-architecture.md](archive/compute-architecture.md) for how this ties into the (since-shipped) split
between the browser version and the desktop version.
