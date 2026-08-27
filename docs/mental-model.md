# The mental model — how Solenoid runs, end to end

Read this SECOND (after CLAUDE.md, before touching code). Every other doc is
reference — rules, invariants, per-subsystem mechanics. This one is the story:
what happens between a keystroke and a rendered value, and where each piece
lives. Claims here are summaries; the pointed-to docs are authoritative.

## One React tree, two libraries

The app is ONE React tree. **React Flow** (`@xyflow/react`) is the view: it
renders every card, cable, the minimap and the viewport (`flow/FlowSurface.tsx`
is THE surface, shared by the main canvas and the composite drill-in — decisions
oneFlowSurface). **rete core** (`NodeEditor` + `ClassicPreset`) plus
`rete-engine` (`DataflowEngine`) is the headless MODEL and compute spine — kept
on purpose; no rete render package exists (decisions reactFlowView). `flow/SolNodeAdapter.tsx`
binds a rete node instance to its registered card component; `flow/flowArea.ts`
is the one implementation of the `Area` seam (`area.ts`), turning the model's
camera/move/re-render verbs into RF state. The model-level compute pass is
`graphCompute.ts`, one definition shared by the app, the composite engine, the CLI
and the tests. Cross-surface state lives in module-singleton stores (`storeKit.ts`, read
via `useSyncExternalStore`) — app-wide state, not a workaround; plain React
context/props work everywhere too.

Module singletons `_editor/_engine/_area` live in `process.ts`. A composite
drill-in does NOT open a new page — it substitutes the active surface via the
`activeGraph.ts` seam (`getActive*`/`getOwningEditor`), so the same chrome drives
whichever canvas is on top. `getEditor()` and persistence always mean the MAIN
graph (rules saveBindsMain). The full surface contract — what RF owns, what the
model owns, and the conversions at the boundary — is
`subsystem-invariants.md` § React Flow surface contract.

## One edit, one recompute

The compute path, in order:

1. **Commit.** Text edits commit on Enter/blur (`useDraftCommit`), never per
   keystroke; discrete picks apply immediately (DESIGN.md § Inputs). The
   committed value lands in the node's `literals`/`stringLiterals` map
   (card-edited values) or its init fields, then calls `processGraph()`.
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
   CSV-typeable list rungs, plus a `numlist` its node opted in with a `stringLiterals`
   key — injects the parsed `stringLiterals` text on an
   unwired input. (The GENERAL unwired-falls-back-to-literal read is `readInput`,
   inside `data()` — the next step.)
4. **`data()` computes, pure.** It reads inputs via `readInput` (a WIRED null
   propagates; only an UNWIRED slot falls back to the literal — the single most
   common historical bug is conflating those). Results carry the value model:
   first-class `null` (missing), per-cell `SolError`s, Kleene logicals, units
   as data on the value.
5. **Render.** The node stashes its result (`cachedResult` etc.); the adapter
   bumps the card's version and React Flow re-renders that card; value boxes
   format through the display pipeline (below). Components NEVER call `data()`
   themselves (rules noDataInComponents) — display logic that needs computation
   gets a pure extracted helper.

## Where types come from

Sockets are DECLARED types; `accepts()` (the lattice) decides what may connect:
element families never auto-cross (Cast; sole bridge logical↔number),
dimensionality flows up. On top of that, derived types re-resolve after every
wiring/config change: `settleWildcardTypes` alternates TWO systems — trueany
adoption (a hollow-ring port adopts the wired type) and Conduit lane tracing —
to a joint fixpoint, and FC adaptation then runs ONCE downstream against the
settled result (waitForTypeSettle: consumers run only after the settle). Derived types are never
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
mirror it (firstClassUnits). An FC's number FORMAT is a display annotation,
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
the ORDERED tail: hydrate → settle wildcard types → dock FCs (waitForTypeSettle). The
strict validator (`graphValidate.ts`) is a separate gate used by the AI palette
and CLI — the interactive loader stays permissive (unknown type → Placeholder,
lossless).

Autosave is per-document, two localStorage slots per doc, diffed by OBJECT
IDENTITY — store transforms must return new objects or nothing persists.

## What exists (orientation only — verify in code before relying on detail)

- **Canvas**: cables/ribbons, groups, standoffs, Conduits, Tidy (ELK), isolate,
  minimap, lasso, snapshot undo, copy/paste, single-key shortcuts (F9 calculate),
  command palette, presenter mode, per-doc autosave + multi-doc tabs, Navigator,
  HUD stack, semantic zoom, the HTML-in-Canvas gesture layer (a Setting; DOM is
  the permanent default), the AI palette (aiInScope / aiWholeDocRewrite).
- **Value model**: frames / cubes (recursive) / matrices / lists / scalars;
  first-class null / logical / SolError; units by dimensionality with `#UNIT!`
  algebra; the FC (unit author + display-format annotations).
- **Engine**: the full relational verb set as lazy `FrameRef` chains; calc modes;
  headless runner (`npm run run-graph`); Write CSV/JSON/Obsidian sinks; live
  connections (Web Source, CSV, Data Feed).
- **Nodes**: current-Excel function parity at rank ≤ 2 (matricesInFormulas),
  Equation (acausal), composites (drill-in; run modes incl. Monte Carlo/by-row;
  Query = a manual-mode preset, queryIsCompositePreset), charts, Note (pure
  SOURCE) / Report (pure SINK) / Mermaid, ~10 domain packs, Placeholder for
  unknown types.
- **Desktop**: Tauri shell (Windows portable exe), native Polars + CSV reader,
  F12 devtools, accent window border, image bundling beside the doc.

The curated selling list is `release-notes-features.md`; the file map is
`architecture.md`.

## Reflexes that prevent the recurring bugs

- Check the "Code → spec routing" table (`docs/README.md`) before editing any
  routed file; cite rule IDs (rules.md) in comments and commits.
- Anything visual: `DESIGN.md` first. Any gesture: `touch-gestures.md` is the
  inventory. Any bar/overlay: `layout-chrome.md`. Anything on the canvas
  surface: `subsystem-invariants.md` § React Flow surface contract.
- Socket/type questions: `socket-reference.md` per-variant tables. New node
  `data()`: `value-semantics.md` "Reading an input" — decide each input's ROLE.
- Trust tests over prose: the enforcement column in rules.md names what is
  machine-checked; a doc claim without a test is a claim to verify.
