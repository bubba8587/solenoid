# Bundle 01 — The addressable model + text projection (Bet 2)

**Source:** `future-directions.md` Bet 2. **Verdict:** IN, whole (no phased export/
import-first route — lands as one build). **Depends on:** nothing. **Gates:** bundle 07
(CLI `--set name=val`), bundle 08 (transpiler emits into a clean text form), bundle 09
(subgraphs need stable references for their typed boundary), bundle 13 (report file's
inline-refs want stable names), and every "verdict pending" item that needs it (#2, #6,
#11, #59 if ever revisited).

## Why this is Tier 0

Today a save is one JSON blob keyed by opaque, regenerated-on-every-load IDs — not
diffable, not git-friendly, not something an AI (or a human) can reliably address by
name. Almost every "second-wave" feature in the 2.0 set assumes a graph can be addressed
by stable, human-readable names. Build this first.

## Grounding — exact current state

**Save shape** (`src/graph/persistence.ts`):
- `SavedNode`: `persistence.ts:32-43` — `{ id, type, x, y, init, literals?, stringLiterals?, size?, collapsed? }`.
- `SavedConnection`: `persistence.ts:45-50` — `{ source, sourceOutput, target, targetInput }`, all plain **id** strings.
- `SavedGraph`: `persistence.ts:60-87` — `{ v, nodes, connections, standoffs?, pins?, seedId?, palette?, packs? }`. `v: number` is the format version (`CURRENT_SAVE_VERSION = 2`, `persistenceCore.ts:9`).
- `serializeGraph()`: `persistence.ts:116-188`. Placeholder nodes re-emit as their *original* `missingType` (lines 126-140 — the lossless-round-trip precedent to follow). Real nodes emit `type: n.constructor.name`, `init: extractInit(n)` (line 149, from `./copyPaste`).
- `rebuildGraph()`: `persistence.ts:287-500`. Builds `ctorRegistry()` (name→ctor map, lines 94-112, derived from `FLAT_CATALOG`), constructs `idMap: Map<oldId,newId>` (line 349) — **ids are always regenerated on load, never reused.** A stable-name scheme must NOT assume id stability either; names ride separately from ids.
- `loadGraph()` public entry: `persistence.ts:195-279` — validates via `validateSavedGraph` (`persistenceCore.ts:25-57`), refuses `g.v > CURRENT_SAVE_VERSION` (lines 216-223), snapshots + rolls back on throw.

**No node name/title field exists today.** `ClassicPreset.Node`'s base constructor
(`node_modules/rete/rete.esm.js:773-792`) takes a `label` and auto-assigns
`this.id = getUID()` (line 791, random hex — not content-derived). Every Solenoid node
class calls `super("<Fixed Type String>")` (e.g. `src/graph/nodes/scalar.ts:116`
`super("Arithmetic")`) — `label` is a **per-class constant**, not per-instance/unique
(confirmed across all `nodes/*.ts`). Only `PlaceholderNode` (`nodes/placeholder.ts:16-57`)
takes an instance `label` (line 34, defaults to `missingType` at line 38), purely to
preserve the original saved label. **The stable-name field is wholly new — nothing to
repurpose.**

**Connections reference nodes by id, not name.** `SolenoidConnection =
ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>` (`src/graph/schemes.ts:16`).
Base `Connection` ctor stores only `source.id`/`target.id` strings
(`rete.esm.js:880-891`). The text-form writer's only translation job: for each
connection, map id → the node's stable name using the same kind of lookup
`rebuildGraph` already does for its `idMap` (`persistence.ts:349,391,419-420`), just
inverted (name→id on read, id→name on write).

**Round-trip test precedent** — `src/graph/seeds.test.ts` (seeds loaded via
`import.meta.glob`, line 24) already runs four assertions per seed: every node type
constructs (lines 46-58), every connection lands on compatible sockets via the
*directional* `canConnect` guard not the laxer `areCompatible` (lines 60-85, comment
notes a real regression this caught), group boxes contain their members' centers
(92-138), and group/FC-host/standoff cross-references resolve (140-159). Mirror this
exact pattern for the new round-trip test: load a seed → write text → re-read → re-write
→ assert byte-identical second write.

**Zero-byte bug — investigate before "step zero."** `future-directions.md:99,120`
mention "hidden zero-bytes that make git treat [some source files] as binary" as
something to kill first. No root-cause file/line was found in the archived audit
(`docs/archive/outside-review-2026-06-12.md` doesn't spell out which files or the
mechanism). **Before treating this as done-when-mentioned:** run `git grep -lP '\x00'`
across the repo (or check `file`/`.gitattributes` output) to name the actual affected
files. If nothing turns up, this line item may already be stale — don't invent a fix for
a bug that isn't reproducible; note that finding in the design-session writeup either way.

## NEEDS AUTHOR INPUT before code — the design session

The VERDICT explicitly requires this FIRST (name scheme, line grammar, visual-state
carriage, round-trip guarantees) — not optional groundwork, the first deliverable:

1. **The stable-name scheme.** Recommend: user-editable name, defaulted to a
   type-scoped counter (e.g. `Filter_2`), validated unique per document — closest to
   how a node already shows a title (there isn't one today, see grounding above), least
   new UI surface.
2. **The text-form grammar.** One node per line, predictable order (topological? canvas
   position? alphabetical-by-name?) for clean diffs. Must represent: node type, name,
   literal inputs, cable connections (by name), and enough visual state (at minimum
   position) to round-trip losslessly into the `SavedGraph` shape above.
3. **Round-trip guarantee.** Text → graph → text must be idempotent — decide what's
   canonicalized (number formatting, key ordering) up front.
4. **What visual state travels in the text form vs. a JSON-only sidecar** — position/size
   probably belongs in a trailing block or sidecar, not inline in the readable node lines.

## Build order

1. Investigate + (if reproducible) kill the zero-bytes issue — standalone, low risk,
   independent of everything else.
2. Run the design session; write the settled scheme into a NEW `docs/subsystem-invariants.md`
   section ("Addressable model") before touching code.
3. Add the stable-name field to the node data model (new — see grounding above); default
   from type + counter, editable, validated unique, persisted through `SavedNode`/`init`.
4. Text-form writer: graph → text, walking `editor.getNodes()`/`getConnections()`,
   translating connection endpoints from id to name via a fresh id→name map (mirror
   `persistence.ts:349`'s `idMap` pattern, inverted).
5. Text-form reader: text → graph, reusing `ctorRegistry()` (`persistence.ts:94-112`)
   for type resolution and the `PlaceholderNode` pattern (`nodes/placeholder.ts:16-57`)
   for anything unresolvable.
6. Round-trip test in the style of `seeds.test.ts` (lines 46-159): load every seed, write
   text, re-read, re-write, assert second write is byte-identical. Keep it green
   permanently, same discipline as `cablePaths.test.ts`'s continuity gate.
7. Wire the text form as the generator source for `serializeGraph`'s JSON output (JSON
   becomes derived, not hand-maintained — per the Bet-2 risk note).
8. Re-run `seeds.test.ts` and confirm nothing regressed.

## Exit criteria

Every node has a stable, user-editable, unique name (new field, not repurposed from
`label`); a text projection round-trips losslessly (idempotent second write, verified
against every seed); the JSON save is generated from the text form; old saves still load
via the existing `rebuildGraph`/`loadGraph` path; the design decisions are written into
`subsystem-invariants.md`.
