# The mental model — how Solenoid runs, end to end

Read this SECOND (after CLAUDE.md, before touching code). Every other doc is
reference — rules, invariants, per-subsystem mechanics. This one is the story:
what happens between a keystroke and a rendered value, and where each piece
lives. Claims here are summaries; the pointed-to docs are authoritative.

## The two React worlds

The app is ONE page but TWO kinds of React root. The app root renders the chrome
(bars, panels, popups, Settings). Rete renders **each node's component in its own
separate React root** — no app context reaches a card. Everything shared between
the worlds is a module-level singleton store (`storeKit.ts` patterns), read via
`useSyncExternalStore`. This is why "just use a context/provider" never works
here, and why every popup, toggle, and cross-cutting state you see is a
`*Store.ts` module.

The canvas itself is a rete `NodeEditor` + `AreaPlugin` bootstrapped in
`Canvas.tsx`, with module singletons `_editor/_engine/_area` in `process.ts`.
A composite drill-in does NOT open a new page — it substitutes the active
surface via the `activeGraph.ts` seam (`getActive*`/`getOwningEditor`), so the
same chrome drives whichever canvas is on top. `getEditor()` and persistence
always mean the MAIN graph.

## One edit, one recompute

The compute path, in order:

1. **Commit.** Text edits commit on Enter/blur (`useDraftCommit`), never per
   keystroke; discrete picks apply immediately. The committed value lands in the
   node's `literals`/`stringLiterals` map (card-edited values) or its init
   fields, then calls `processGraph()`.
2. **processGraph** (`process.ts`) resets/targets the rete `DataflowEngine` and
   pulls outputs. Manual calc mode short-circuits here (F9 forces). Cycles are
   found up front (Tarjan SCC) and pre-seeded as `#CIRC!` so the engine never
   deadlocks. A topology change recomputes only the target's downstream closure.
3. **Per node, wrappers run first.** Every `data()` is wrapped at `nodecreated`
   by TWO layers: `coerceInputs` (inside) then `installErrorGuards` (outside).
   The guard short-circuits: an error on any input → that error out, `data()`
   never runs (nodes that must SEE errors — IFERROR, Display, figure sinks —
   register for raw delivery). Coercion normalizes each arriving value to the
   socket's declared type (widening, singleton collapse, logical↔number
   bridge, `#SHAPE!` on failure), strips `UnitCell`s to display magnitudes
   unless the node is `unitAware` or a declared passthrough, and — for the three
   CSV-typeable list rungs only — injects the parsed `stringLiterals` text on an
   unwired input. (The GENERAL unwired-falls-back-to-literal read is `readInput`,
   inside `data()` — the next step.)
4. **`data()` computes, pure.** It reads inputs via `readInput` (a WIRED null
   propagates; only an UNWIRED slot falls back to the literal — the single most
   common historical bug is conflating those). Results carry the value model:
   first-class `null` (missing), per-cell `SolError`s, Kleene logicals, units
   as data on the value.
5. **Render.** The node stashes its result (`cachedResult` etc.); rete
   re-renders the card's React root; value boxes format through the display
   pipeline (below). Components NEVER call `data()` themselves — display logic
   that needs computation gets a pure extracted helper.

## Where types come from

Sockets are DECLARED types; `accepts()` (the lattice) decides what may connect:
element families never auto-cross (Cast; sole bridge logical↔number),
dimensionality flows up. On top of that, derived types re-resolve after every
wiring/config change: `settleWildcardTypes` alternates TWO systems — trueany
adoption (a hollow-ring port adopts the wired type) and Conduit lane tracing —
to a joint fixpoint, and FC adaptation then runs ONCE downstream against the
settled result (SOCK-13: consumers run only after the settle). Derived types are never
persisted — they re-derive on load. A node that retypes a socket IN PLACE
(Cast target, read-as, Note frontmatter) must call
`reconcileFcTypes`/`retypeOutputCables` because no connection event fires.

## Frames are different

Scalars/lists/matrices are plain JS values on cables. A FRAME on a cable is
(ideally) a lazy `FrameRef` — a handle to a verb chain living in the engine
behind the `FrameBackend` seam: `JsFrameBackend` (web — the pure `frameVerbs.ts`
oracle) or `PolarsBackend` (desktop — native Rust, verb chains fused into one
round trip). Data materializes only at the boundary: `preview` (cards show
head-N), `column` (scalar/list bridge), `collect`. The two backends are held
identical by a shared fixture corpus run from both vitest and cargo. One
definition per verb (`frameVerbs.ts`) — node code never re-implements one.

## What a value box shows

Display is a separate, read-side pipeline: the raw result → type-default
formatting (dates render `DD-MMM-YYYY` anywhere, no FC needed) → the FC layer.
An FC's UNIT is not display — it MUTATES the value (`applyFcUnit`, base-SI
`UnitCell`); units are authored only at value origins (FC, Convert, Table Input,
the column-unit surfaces), and an FC downstream of a united value locks to
mirror it (D26). An FC's number FORMAT is a display annotation,
resolved by walking passthroughs both directions (`makeAnnotationResolver`).
Errors render as the red `#CODE!` badge; a scalar null renders as the muted
em-dash (the word `null` appears only for list/frame CELLS); NaN is quiet
residue, never "N/A".

## Save, load, and the text form

The addressable model: every node has a stable user-editable `name`; rete `id`s
are random and REGENERATED on load — never persist or compare ids across loads.
The text form (`textForm.ts`, one node per line, name-addressed, topological
order, byte-stable writes) is the canonical projection; the JSON save derives
from it. Load (`rebuildGraph`) constructs, remaps ids, restores state, then runs
the ORDERED tail: hydrate → settle wildcard types → dock FCs (SOCK-13). The
strict validator (`graphValidate.ts`) is a separate gate used by the AI palette
and CLI — the interactive loader stays permissive (unknown type → Placeholder,
lossless).

Autosave is per-document, two localStorage slots per doc, diffed by OBJECT
IDENTITY — store transforms must return new objects or nothing persists.

## Reflexes that prevent the recurring bugs

- Check the "Code → spec routing" table (`docs/README.md`) before editing any
  routed file; cite rule IDs (rules.md) in comments and commits.
- Anything visual: `DESIGN.md` first. Any gesture: `touch-gestures.md` is the
  inventory. Any bar/overlay: `layout-chrome.md`.
- Socket/type questions: `socket-reference.md` per-variant tables. New node
  `data()`: `value-semantics.md` "Reading an input" — decide each input's ROLE.
- Trust tests over prose: the enforcement column in rules.md names what is
  machine-checked; a doc claim without a test is a claim to verify.
