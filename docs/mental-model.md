# The mental model: how Solenoid runs, end to end

Read this second, after CLAUDE.md and before touching code. Every other doc is reference:
rules, invariants, per-subsystem mechanics. This one tells the story of what happens
between a keystroke and a rendered value, and where each piece lives. Claims here are
summaries; the docs they point to are authoritative.

## One React tree, two libraries

The app is one React tree. **React Flow** (`@xyflow/react`) is the view. It renders every
card, cable, the minimap and the viewport. `flow/FlowSurface.tsx` is the one surface,
shared by the main canvas and the composite drill-in ([[C43]] oneFlowSurface). **rete
core** (`NodeEditor` + `ClassicPreset`) plus `rete-engine` (`DataflowEngine`) is the
headless model and compute spine, kept on purpose; no rete render package exists
([[B10]] reactFlowView).

- `flow/SolNodeAdapter.tsx` binds a rete node instance to its registered card component.
- `flow/flowView.ts` is the one implementation of the `View` seam (`view.ts`), turning the
  model's camera, move and re-render verbs into React Flow state.
- `graphCompute.ts` is the model-level compute pass, one definition shared by the app, the
  composite engine, the CLI and the tests.
- Cross-surface state lives in module-singleton stores (`storeKit.ts`, read through
  `useSyncExternalStore`). That's app-wide state, not a workaround; plain React context
  and props work everywhere too.

The module singletons `_editor`, `_engine` and `_area` live in `process.ts`. A composite
drill-in doesn't open a new page. It swaps the active surface through the `activeGraph.ts`
seam (`getActive*`, `getOwningEditor`), so the same chrome drives whichever canvas is on
top. `getEditor()` and persistence always mean the main graph ([[C33]] saveBindsMain). The
full surface contract (what React Flow owns, what the model owns, and the conversions at the
boundary) is `../specs/react-flow-surface-contract.md`.

## One edit, one recompute

The compute path, in order:

1. **Commit.** Text edits commit on Enter or blur (`useDraftCommit`), never per keystroke;
   discrete picks apply immediately (DESIGN.md § Inputs). The committed value lands in the
   node's `literals` / `stringLiterals` map (values edited on the card) or its init fields,
   then calls `processGraph()`.
2. **processGraph** (`process.ts`) resets or targets the rete `DataflowEngine` and pulls
   outputs. Manual calc mode stops here unless F9 forces a pass. Cycles are found up front
   (Tarjan SCC) and pre-seeded as `#CIRC!`, so the engine never deadlocks. A topology change
   recomputes only the target's downstream closure.
3. **Per node, the wrappers run first.** Every `data()` is wrapped at `nodecreated` in two
   layers: `coerceInputs` inside, `installErrorGuards` outside.
   - The guard short-circuits: an error on any input becomes the output and `data()` never
     runs. Nodes that must see errors (IFERROR, Display, figure sinks) register for raw
     delivery.
   - Coercion normalizes each arriving value to the socket's declared type: widening,
     singleton collapse, the logical ↔ number bridge, `#SHAPE!` on failure. It strips
     `UnitCell`s to display magnitudes unless the node is `unitAware` or a declared
     passthrough.
   - For the three CSV-typeable list rungs, and a `numlist` whose node opted in with a
     `stringLiterals` key, coercion injects the parsed `stringLiterals` text on an unwired
     input. The general "unwired falls back to the literal" read is `readInput`, inside
     `data()`.
4. **`data()` computes, pure.** It reads inputs through `readInput`: a wired null propagates,
   and only an unwired slot falls back to the literal. Mixing those two up is the most common
   historical bug. Results carry the value model: first-class `null` (missing), per-cell
   `SolError`s, three-valued logic, and units as data on the value.
5. **Render.** The node stashes its result (`cachedResult` and similar), the adapter bumps
   the card's version, and React Flow re-renders that card. Value boxes format through the
   display pipeline below. Components never call `data()` themselves ([[C27]]
   noDataInComponents); display logic that needs computation gets a pure extracted helper.

## Where types come from

Sockets have declared types, and `accepts()` (the lattice) decides what may connect. Element
families never cross on their own (that takes a Cast; the one bridge is logical ↔ number),
and values flow up in rank. The spec is `../specs/socket-lattice.md` ([[C10]]
socketLattice).

On top of that, derived types resolve again after every wiring or config change.
`settleWildcardTypes` alternates two systems until both settle: trueany adoption (a
hollow-ring port adopts the wired type) and Conduit lane tracing. FC adaptation then runs
once downstream against the settled result ([[E8]] waitForTypeSettle). Derived types are
never saved; they're worked out again on load. A node that retypes a socket in place
(Cast's target, read-as, Note frontmatter) must call `reconcileFcTypes` or
`retypeOutputCables`, because no connection event fires. The spec is
`../specs/type-propagation-on-in-place-socket-retype.md` ([[D16]] retypeReconciles).

## Frames are different

Scalars, lists and matrices are plain JS values on cables. A Frame on a cable is usually a
lazy `FrameRef`, a handle to a verb chain living in the engine behind the `FrameBackend`
seam: `JsFrameBackend` on web (the pure `frameVerbs.ts` oracle) or `PolarsBackend` on
desktop (native Rust, with verb chains fused into one round trip). Data materializes only
at the boundary: `preview` (cards show the first N rows), `column` (the bridge to scalars and
lists) and `collect`. A shared fixture corpus, run from both vitest and cargo, keeps the two
backends identical. There is one definition per verb (`frameVerbs.ts`); node code never
re-implements one ([[C16]] polarsEngine).

Formulas stop at matrices: Frames and Cubes never enter them ([[C15]] matricesInFormulas).
Per-row math on a Frame is a **computed column**, either Frame Input's **Fx** column or the
Computed Column node, both running `computedColumnCore.ts`. Inside one, a bare name is the
whole column and `@name` is this row's cell, as in Excel tables ([[C22]] rowFormulaRefs).

## What a value box shows

Display is a separate, read-side pipeline: the raw result, then type-default formatting
(dates render `DD-MMM-YYYY` everywhere, with no FC needed), then the FC layer.

- An FC's **unit** isn't display. It changes the value (`applyFcUnit`, a base-SI
  `UnitCell`). Units are set only where a value starts (FC, Convert, Table Input, the
  column-unit surfaces), and an FC downstream of a value with a unit locks to mirror it
  ([[C25]] firstClassUnits).
- An FC's number **format** is a display annotation, resolved by walking passthroughs in
  both directions and through transforms that keep the value's meaning
  (`makeAnnotationResolver`, [[D41]] formatFlowsDownstream). The spec is
  `../specs/unit-flow.md`.
- Errors render as the red `#CODE!` badge. A scalar null renders as a muted em dash; the
  word `null` appears only for list and Frame cells. NaN is quiet residue, never "N/A".

## Save, load, and the text form

Every node has a stable, user-editable `name`. Rete `id`s are random and regenerated on
load, so never save or compare ids across loads ([[C19]] namingModel). The text form
(`textForm.ts`: one node per line, name-addressed, in topological order, byte-stable
writes) is the canonical projection, and the JSON save derives from it ([[C30]]
saveViaTextForm).

Load (`rebuildGraph`) constructs the nodes, remaps ids, restores state, then runs the
ordered tail: hydrate, settle wildcard types, dock FCs. The strict validator
(`graphValidate.ts`) is a separate gate for the AI palette and the CLI; the interactive
loader stays permissive, loading an unknown type as a lossless Placeholder.

Autosave is per document, two localStorage slots per doc, diffed by object identity, so
store transforms must return new objects or nothing saves ([[C31]] immutableDocStore;
the slot rotation is [[C32]] autosaveSlotOrder). The full format and load algorithm are
`../specs/save-format.md`.

## What exists (orientation only; verify in code before relying on detail)

- **Canvas:** cables and ribbons, groups, standoffs, Conduits, Tidy (ELK), isolate, the
  minimap, lasso, snapshot undo, copy and paste, single-key shortcuts (F9 calculates), the
  command palette, presenter mode, per-doc autosave with multiple documents, the Navigator,
  the HUD stack, semantic zoom, the HTML-in-Canvas gesture layer (a Setting; DOM is the
  permanent default), and the AI palette ([[B13]] aiInScope, [[C55]] aiWholeDocRewrite).
- **Value model:** Frames, Cubes (recursive), matrices, lists and scalars; first-class
  null, logicals and `SolError`s; units by dimension with `#UNIT!` algebra; the FC, which
  sets units and display formats.
- **Engine:** the full relational verb set as lazy `FrameRef` chains; calc modes; the
  headless runner (`npm run run-graph`); the Write CSV, JSON and Obsidian sinks; live
  connections (Web Source, CSV, Data Feed).
- **Nodes:** current-Excel function parity up to matrices ([[C15]] matricesInFormulas);
  Equation (solves for any one variable); computed columns; composites (drill-in, with run
  modes including Monte Carlo and by-row; Query is a manual-mode preset, [[C53]]
  queryIsCompositePreset); charts; Note (a pure source), Report (a pure sink) and Mermaid;
  about ten domain packs; and Placeholder for unknown types.
- **Desktop:** the Tauri shell (Windows portable exe; Linux AppImage and .deb), native
  Polars and the CSV reader, F12 devtools, the accent window border, and images bundled
  beside the document.

The curated selling list is `release-notes-features.md`; the file map is `architecture.md`.

## Reflexes that prevent the recurring bugs

- Check the Code → spec routing table (`docs/README.md`) before editing any routed file,
  and cite the governing node (`[[<ID>]] name`) in comments and commits.
- Anything visual: `DESIGN.md` first. Any gesture: `touch-gestures.md` is the inventory.
  Any bar or overlay: `layout-chrome.md`. Anything on the canvas surface:
  `../specs/react-flow-surface-contract.md`.
- Socket and type questions: the per-variant tables in `socket-reference.md`. A new node's
  `data()`: `value-semantics.md` "Reading an input", deciding each input's role.
- Trust tests over prose: `python3 tools/dte.py show <ID>` derives "enforced by" from the
  tests that cite a rule node, so a doc claim without a test is a claim to verify.
