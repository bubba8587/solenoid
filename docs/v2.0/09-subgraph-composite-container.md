# Bundle 09 — The subgraph/composite container + the five run-mode hooks

**Source:** scope-features #5 (container, IN as document-local only), #1 (simulation,
IN as a hook), #4 (what-if family, IN — all of it joins this container). **Depends on:**
bundle 02 (shape-checking) for the typed boundary. **Gates:** bundle 10 (needs the Monte
Carlo hook).

## Scope boundary (author's explicit ruling — don't relitigate)

OUT as an ecosystem — no sharing/export/import/registry layer. IN as the container:
document-local, distributed only via packs.

## Grounding — existing design + machinery to build on

**`docs/pack-architecture.md:98-104` — the existing "Composite pack node" design note
(quote in full):**
> "Composite pack node (a subgraph / macro node). An encapsulated subgraph with a
> declared boundary. Build it as a real subgraph, **not as a Group variant.** A Group has
> no sockets, no `data()`, spatial/hybrid membership, and an inferred boundary, which is
> the opposite of a pack node on every axis: a pack node has a declared contract and
> computes. Ship the simple shape first and grow into the composite one without changing
> how packs appear, how restrictions attach, or how errors surface. The simple pack is
> just the degenerate single-node case of the composite one."

Surrounding context (`pack-architecture.md:106-129`, "Locked to the user, open to the
author" / "Exposing internals: per-port promotion") defines the port-promotion contract
(`hidden`/`exposed`, `basic`/`advanced` tier) — **the composite node's typed boundary
should reuse this exact promotion contract**, not invent a new one.

**Why NOT a Group** — confirmed in code: `src/graph/nodes/group.ts:11-40`, `GroupNode`
has `members: string[]`, `color`, `collapsed`, `width/height`, and `data()` returns `{}`
— explicitly non-computing. This is the concrete evidence backing the pack-architecture
warning above: a Group is a spatial container, a composite node is a computing one, and
they must stay two different classes.

**The existing "select N → make one unit" gesture to mirror** —
`createGroupFromSelection(editor, area)` at `src/graph/groupLogic.ts:63-94`: filters
`editor.getNodes().filter(n => n.selected && !(n instanceof GroupNode))`, computes
bounding box via `nodeBox`, constructs `new GroupNode({members, color, width, height})`,
`editor.addNode(group)`, positions it, `sendGroupToBack`. Bound to hotkey `KeyG`
(`Canvas.tsx:717-721`). **Copy this exact selection-read + bounding-box pattern for a new
"make composite" command, constructing the new composite-node class instead of
`GroupNode`.**

**Multi-select API** (for reading the current selection): `AreaExtensions.selector()`
(`Canvas.tsx:1211`), wired via `AreaExtensions.selectableNodes(area, nodeSelector,
{accumulating})` (`Canvas.tsx:1333`). Selected state is each node's ambient `.selected`
boolean (read the same way `groupLogic.ts:70` does). Programmatic select:
`selectable.select(id, accumulate)` (`Canvas.tsx:1312`).

**The Expression cap's `#SHAPE!` escape hatch (this container is its designated
successor):** the cap-enforcing block lives in `src/graph/nodes/expression.ts:133-146`
inside `ExpressionNode.data()` — rejects any 2-D matrix input:
```ts
solError("#SHAPE!", "A formula works on values and 1-D lists, not a 2-D matrix — use MAP / BYROW / REDUCE to run it over a table.")
```
(Note: the `toList` coercion helper it depends on actually lives in
`src/graph/nodes/coerce.ts:52-61`, not in `expression.ts` itself — don't look for it
there.) This is the exact ceiling the subgraph container is meant to sit above.

**Cycle detection (`#CIRC!`) — the mechanism a Simulate mode must special-case:**
`src/graph/process.ts:336-395`, `loopMembers(editor)` — an explicit iterative Tarjan's
SCC (comment names it, line 338), builds adjacency from `editor.getConnections()`,
tracks self-loops separately, returns a `Set<string>` of true cycle members only
(self-loop or SCC size > 1) — deliberately excluding downstream-innocent nodes. Cached
as `_cachedLoop` (line 412), only reruns on topology-changing passes.
`downstreamClosure` (418-429, reused by bundle 11 too) is the companion targeted-
invalidation walk. **The `#CIRC!` error itself:** `process.ts:496` —
```ts
solError("#CIRC!", "This node is part of a circular dependency — the calculation feeds back into itself")
```
seeded only onto `loopMembers()` results (comments at lines 484-486, 520). **A Simulate
container that tolerates a loop must special-case membership in this exact `Set<string>`
before the `#CIRC!` seeding step** — i.e., a loop fully contained inside an opted-in
Simulate container should be excluded from the seeding, while a loop anywhere else still
errors normally.

**Existing Sensitivity node — confirms this is NOT the Tornado node's base:**
`DecisionSensitivityNode` (`nodes/frame.ts:737-759`) takes `scores`/`scenarios` frames,
outputs a `cube` via `decisionSensitivity(scores, scenarios, normalize)`
(`frameVerbs.ts`). This is a **frame-verb-driven scenario table specific to Decision
Matrix, not a generic parameter sweep** — confirms bundle 11's Tornado node needs
genuinely new one-at-a-time-sweep logic, not an extension of this node.

## Build order

1. **The shell alone:** a new composite-node class (NOT `GroupNode`) with a typed
   boundary reusing `pack-architecture.md`'s port-promotion contract. Build the "select N
   → make composite" command mirroring `createGroupFromSelection`
   (`groupLogic.ts:63-94`) exactly (selection read, bounding box, `editor.addNode`), but
   constructing the new class. Ship this alone, no run mode, before adding any driver.
2. **Scenarios** — named input sets, run the container once per set, lay outputs side by
   side. No solver math — the easiest driver, proves multi-run infrastructure.
3. **Data tables** — parameter-grid driver, same "run N times, collect" shape.
4. **Simulation** — the loop-as-feedback driver. Special-case the container's internal
   loop against `loopMembers`'s `Set<string>` (`process.ts:336-395`) so `#CIRC!`
   (`process.ts:496`) isn't seeded for a loop fully inside an opted-in Simulate
   container. First concrete test: a two-node population model, step count as a
   container parameter.
5. **Goal-seek** — needs an actual numerical solver; scope to numeric inputs/outputs,
   fail loudly with `#CONV!` (an existing convergence-error code from the finance
   nodes — reuse the code, don't mint a new one).
6. **Monte Carlo** — driver slot built now; distribution representation deferred to
   bundle 12 (don't block this bundle's other four modes on that landing).

## Exit criteria

A user can select a node set and collapse it into a named, typed composite card (a new
node class, not a `GroupNode`) that behaves like a built-in node — document-local only,
no export/import; the same container supports scenarios, data tables, simulation
(loop-as-feedback, correctly bypassing `#CIRC!` only inside the container), and goal-seek
(`#CONV!` on failure) as run modes; the Monte Carlo driver slot exists, ready for bundle
12's distribution representation.
