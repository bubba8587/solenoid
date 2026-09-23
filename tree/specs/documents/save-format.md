---
aliases: ["Save format and load path"]
tags: [spec, documents]
---
<!-- [[B12]] losslessSaves, [[C30]] saveViaTextForm, [[C29]] plainJsonInit, [[D50]] everyFieldClassified, [[C28]] literalsIffEditable, [[C31]] immutableDocStore, [[C32]] autosaveSlotOrder, [[C33]] saveBindsMain, [[C34]] classNameIsType, [[C35]] unknownViaPlaceholder, [[C36]] captureBeforeSwap, [[C58]] tableInputRawText -->

# Spec: Save format and load path

Serves [[B12]] losslessSaves, with its save-path rules [[C30]] saveViaTextForm, [[C29]] plainJsonInit, [[D50]] everyFieldClassified, [[C28]] literalsIffEditable, [[C31]] immutableDocStore, [[C32]] autosaveSlotOrder, [[C33]] saveBindsMain, [[C34]] classNameIsType, [[C35]] unknownViaPlaceholder, [[C36]] captureBeforeSwap and [[C58]] tableInputRawText. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

A document has three representations: the live graph (rete editor plus side stores), the `SavedGraph` JSON object, and the text form (one node per line plus a JSON sidecar). The JSON is always produced by passing the live capture through the text form, so the text form is the one canonical projection. This spec defines both serialized shapes, the capture, the load algorithm, the strict validator, and how documents are stored. Names and their rules belong to [[addressable-model]]; the autosave slot mechanics to [[per-doc-autosave-persistence]]; the literal-map convention to [[inline-literal-maps]].

## Where the code lives

| File | Role |
|---|---|
| `src/graph/persistence.ts` | `SavedGraph` types, `serializeGraph`, `loadGraph`, `rebuildGraph`, the autosave debounce |
| `src/graph/persistenceCore.ts` | Pure helpers: `CURRENT_SAVE_VERSION`, `validateSavedGraph`, `deriveMissingNodeSockets`, slot choice |
| `src/graph/textForm.ts` | `writeTextForm`, `readTextForm`, `parseNodeLine` |
| `src/graph/copyPaste.ts` | `extractInit`, `INIT_FIELD_ORDER`, `INIT_EXTRA_FIELD_ORDER` (shared by paste and save) |
| `src/graph/graphValidate.ts` | The strict validator (`validateGraph`, `validateText`) |
| `src/graph/documentStore.ts`, `documentStoreCore.ts` | The document library and its localStorage persistence |
| `src/graph/fileSession.ts`, `fileBridge.ts` | Disk save and open (desktop dialogs, browser download and upload) |
| `src/graph/imageAssets.ts` | Image bytes written beside the file instead of into it |
| `src/graph/saveTimeStore.ts` | The save-clock read seam node classes use |
| `src/graph/nodes/placeholder.ts` | `PlaceholderNode`, the stand-in for an unknown type |
| `src/graph/nodeCtorRegistry.ts` | `ctorRegistry()`, class name to constructor |

## The persisted type is the class name

A node's `type` is its JavaScript `constructor.name` (for example `NumberInputNode`), and loading resolves `type` through `ctorRegistry()` ([[C34]] classNameIsType). The registry is built once, lazily, by calling every factory in `FLAT_CATALOG` and mapping each instance's `constructor.name` to its constructor; the first class registered under a name wins, and a factory that throws is skipped (its type then loads as a Placeholder). Production builds must keep class names: `vite.config.ts` pins `build.minify: "esbuild"` with `esbuild.keepNames: true`. No two catalog classes may share a name.

Every constructor accepts one optional `init` object and must rebuild the node's full configuration from it. `PlaceholderNode` is not in the catalog; only the loader builds one.

## `SavedGraph`

The top-level object. Optional fields are omitted when empty, never written as empty arrays or `null`.

| Field | Type | Meaning |
|---|---|---|
| `v` | number | Format version. `CURRENT_SAVE_VERSION` is `2`. Required. |
| `nodes` | `SavedNode[]` | Every node on the main canvas, including Groups, Format Controllers and Notes. Required. |
| `connections` | `SavedConnection[]` | Every cable. Required in a written save; the structural gate accepts it missing. |
| `standoffs` | `SavedStandoff[]`? | Arrangement constraints between two nodes ([[standoffs]]). |
| `drawnCables` | `SavedDrawnCable[]`? | Free-drawn annotation curves ([[drawn-cables]]). They reference no node. |
| `pins` | `Pin[]`? | Pinned output values: `{ nodeId, outputKey }`. |
| `comments` | `SavedCommentData[]`? | Node-anchored comment threads: `{ id, nodeId, author, text, resolved, time? }`. `id` is the comment's own id (digits in it seed the comment counter on load); `time` is epoch ms, defaulting to the load time when missing. |
| `frameFormats` | `FrameColumnFormat[]`? | Per-column display formats on a Frame: `{ nodeId, column, ann }`, where `ann` is a Format Controller annotation object ([[format-model]]). |
| `palette` | `{ base?, overrides? }`? | The document's palette choice layered over the app-wide one. `overrides` maps slot id to hex. |
| `reportPalette` | `{ base?, overrides? }`? | The same, scoped to report and export surfaces. |
| `meta` | `{ author?, tags?, foreign?, networkAllowed? }`? | Document properties. `foreign` and `networkAllowed` carry the per-document network permission ([[C103]] untrustedContentSeams). The document title is not here; it is the library name. |
| `savedAt` | number? | Epoch ms of the disk write that produced this file. Stamped only by the file-write path, never by `serializeGraph`, so autosaves, undo snapshots and seeds stay stable. |
| `packs` | string[]? | Ids of the packs active at save time, a provenance record. Nothing reads it on load. |

Seed files in `src/graph/seedGraphs/*.json` are `SavedGraph` objects plus menu-only fields (`label`, `order`, `group`, `hidden`) that the loader ignores.

### `SavedNode`

| Field | Type | Meaning |
|---|---|---|
| `id` | string | The node's id within this save. After a text-form round trip it equals `name`. It is never a live rete id across loads. |
| `type` | string | The class name. |
| `name` | string? | The addressable name, an identifier matching `^[A-Za-z_][A-Za-z0-9_]*$`, unique per document. Always written; optional only in the type. |
| `x`, `y` | number | Canvas position of the node's top-left corner, rounded to integers on capture. Missing means `0`. |
| `init` | object | Constructor arguments, the output of `extractInit`. Plain JSON only. |
| `literals` | `Record<string, number>`? | Inline numeric input values, keyed by input socket key. |
| `stringLiterals` | `Record<string, string>`? | Inline text input values (text, CSV-typed lists, column picks), keyed by input socket key. |
| `size` | `{ w, h }`? | Manual resize from `nodeSizeStore` (the Display resize grip, [[resizable-content-nodes]]), rounded. |
| `collapsed` | `true`? | The card body is collapsed (`collapseStore`). Distinct from `init.collapsed`, which is a Group's own field. |
| `flipped` | `true`? | Sockets mirrored left and right (`socketFlipStore`). |

### `SavedConnection`

`{ source, sourceOutput, target, targetInput }`: source and target are node ids within the save; the other two are socket keys.

### Side tables

`SavedStandoff` is `{ a: { nodeId, anchor }, b: { nodeId, anchor }, min, max, locked? }`. `anchor` is one of `n e s w ne nw se sw`; `min` and `max` are rounded on capture; `locked` is written only when true.

`SavedDrawnCable` is `{ points, shape, arrows, width, headScale, color }`. `points` has at least two entries `{ x, y, angle? }` with integer `x` and `y`; `angle` (degrees clockwise from +X) is present only when the user overrode the heading. `shape` is `spline | straight | diagonal`; `arrows` is `none | start | end | both`; `color` is a palette slot id. On load a malformed entry is skipped, an entry with fewer than two valid points is dropped, a missing or invalid style field takes its default (`spline`, `end`, width 2.4, head scale 1, `gray`), and an out-of-range width or head scale is clamped. Drawn cable ids are regenerated.

Groups are not a side table. A Group is an ordinary node (`GroupNode`) whose `init.members` lists member node ids; group membership in the live model is rebuilt from those lists on load.

A Composite's subgraph is not a side table either. It rides inside the Composite's `init.internal` as `{ nodes: [{ id, type, init, literals?, stringLiterals?, x?, y? }], connections: [...] }`, alongside `init.inputPorts` and `init.outputPorts` (each port names the internal boundary marker it feeds by `internalNodeId`). Internal ids are saved ids that survive a round trip ([[composite-nodes]]); the text form does not translate them.

## Capturing a node's `init`

`extractInit(node)` builds `init` from the live instance ([[C29]] plainJsonInit). Paste uses the same function, so a paste and a save see the same configuration.

1. Every key in `INIT_FIELD_ORDER` that exists on the node with a value other than `undefined` is copied as is. This list is the whitelist of scalar and simple settings (`label`, `op`, `value`, `expr`, `tableText`, `members`, `hostNodeId`, `width`, `height`, and so on).
2. Object-valued extras are deep-copied, several filtered to live keys so an orphan left behind for undo does not reach the save:
   - `funcs`, `fieldTypes`: shallow copies.
   - `filterExclude`: each array copied.
   - `condConfig`: only rows `k` whose `value<k>` or `column<k>` input still exists.
   - `titles`, `selectedKeys`: only keys that are live inputs; omitted when none remain.
   - `varDescriptions`: only live variables (`varNames`) with non-blank text.
   - `bindings`: only live definition variables (`defVars`) with a non-empty value, sorted by key.
   - `inputPorts`, `outputPorts`: each port copied. `scenarios`: `{ id, name, overrides }` each. `dataTableValues`: each array copied. `goalSeek`, `monteCarlo`: copied when set (a `null` config is omitted).
   - `uncertainty` only when it is a positive number, with `distribution: "uniform"` only when not normal.
   - `internal`: the node's `snapshotInternal()` result, when it has one.
3. When the node grows value rows (`addValueInput` or `addValuePair` exists), `init.valueKeys` lists every current input key so the constructor rebuilds exactly those rows.

Literal values never enter `init`: they live only in `SavedNode.literals` and `stringLiterals`, restored after construction. A literal key can share a name with an init field (Pad Text's `width` input beside its card `width`, a Script parameter named `label`), so one flat namespace would let either overwrite the other. A constructor may still accept a literal key in its `init` to seed a catalog preset or a hand-written text form; the saved map wins on load.

The capture must be a fixed point: `extractInit(new Ctor(extractInit(n)))` equals `extractInit(n)`, and every value must survive `JSON.parse(JSON.stringify(v))`. A `Map`, `Set`, class instance, `NaN` or `Infinity` breaks the second rule silently, because the text form stringifies each field (`Infinity` becomes `null`).

Every own field of a catalog node is classified ([[D50]] everyFieldClassified): captured as above, transient by name (`cached*` derived display state, `_*` private machinery), or listed with a reason in the `DELIBERATELY_TRANSIENT` table of `tests/graph/persistenceSweep.test.ts`. Examples of deliberately transient fields: compiled `ast` and `evaluator` (rebuilt from `expr`), per-pass error and result state, frozen random rolls, fetch handles, the image `dataUrl` (its `assetPath` persists instead), and a sink's `enabled` arm flag, so every load starts disarmed ([[C38]] sinkRunButtonOnly).

Table Input and the paint grid store the raw typed text (`tableText`) as the saved truth; the matrix is derived from it on compute, and blank lines survive in every position ([[C58]] tableInputRawText).

## Capturing the graph: `serializeGraph()`

`serializeGraph()` always reads the main graph through `getEditor()` and `getView()`, never the surface a Composite drill-in has made active ([[C33]] saveBindsMain). It returns `null` when no editor exists. Otherwise it returns `readTextForm(writeTextForm(raw))` ([[C30]] saveViaTextForm), where `raw` is built by `buildRawSavedGraph`:

- One `SavedNode` per editor node, in editor order. `name` comes from `nodeNameStore.ensure`, which assigns a default name if the node has none. `x` and `y` are the view position, rounded. `literals` and `stringLiterals` are copied when the node declares them (even when empty). `size`, `collapsed` and `flipped` come from their stores.
- A `PlaceholderNode` is written as the node it stands for: `type` is its `missingType`, `init` is a copy of its `savedInit`, and its saved literal maps are copied back ([[C35]] unknownViaPlaceholder).
- `connections` from the editor, then `standoffs`, `drawnCables`, `pins`, `comments`, `frameFormats` from their stores, `palette`, `reportPalette`, `meta` from their stores, and `packs` from the active pack set. Empty lists are omitted.

The round trip through the text form renames every `id` to the node's name, orders nodes topologically, and canonicalizes field order. Any top-level field that `writeTextForm` or `readTextForm` does not carry is deleted from every save, so a new `SavedGraph` field must be added to both.

## The text form

A document in the text form is a header of node lines, a separator line of exactly `---`, and a JSON sidecar.

```
<node line>
<node line>
...
---
<sidecar JSON>
```

### Node lines

```
node-line   = name ": " type { " " field }
field       = init-field | num-literal | str-literal | empty-map | connection
init-field  = key "=" json
num-literal = "lit:" key "=" json-number
str-literal = "str:" key "=" json-string
empty-map   = "lit:{}" | "str:{}"
connection  = key "<-" source-name "." output
output      = bare-output | json-string
key         = bare-key | json-string
bare-key    = [A-Za-z_][A-Za-z0-9_:]*
bare-output = one or more characters, none of which is a space, `"` or `\`
```

Reading rules (`parseNodeLine`):

- The name is everything before the first `": "` (colon then space); a line without one is malformed. The type is the text up to the next space.
- The rest is split into tokens at spaces that are outside a JSON string. Inside a string, a backslash escapes the next character. Runs of spaces are allowed; tabs are not separators.
- Each token must start with a key followed by `=` or `<-`, or the line is malformed. A bare key may contain `:` only as part of the `lit:` and `str:` prefixes in practice; the regex allows it anywhere. A quoted key is taken as is: `"lit:x"=1` is an `init` field, never a literal, and a quoted key on a connection takes no prefix.
- `key=value` parses `value` with `JSON.parse`. A `lit:` key goes to `literals`, a `str:` key to `stringLiterals`, anything else to `init`. Values must be valid JSON: `label=Months` is an error, `label="Months"` is correct.
- `input<-Source.output` splits at the first `.` after `<-`. The source name therefore cannot contain a dot (names never do), while the output key can. An output that starts with `"` is decoded as a JSON string; otherwise it is taken verbatim. An input key off the bare pattern is JSON-quoted, like any other key.
- Empty lines in the header are skipped. The header ends at the first line that is exactly `---`; a document without one is refused.
- Two lines with the same name are refused.

Writing rules (`writeTextForm`), which make two writes of an unchanged graph byte-identical:

- **Names.** Nodes are named in array order: a node's saved `name` is kept when it is a valid identifier not already taken; otherwise it gets the next free default `<Prefix>_<n>`, where the prefix is the type with a trailing `Node` removed (`Filter_1`, `Filter_2`) and `n` counts up per prefix from 1, skipping taken names. This is the same algorithm as the live `nodeNameStore` (`nodeNaming.ts`).
- **Line order.** Topological: Kahn's algorithm over the connections, always emitting the ready node whose name sorts first (plain JavaScript string comparison, so uppercase sorts before lowercase). Nodes left in a cycle follow, sorted by name. Connections naming a node that is not in the save are ignored for ordering.
- **Field order on a line.** Name, type, then `init` fields: first the keys of `INIT_FIELD_ORDER` in that order, then `INIT_EXTRA_FIELD_ORDER` (`funcs`, `filterExclude`, `condConfig`, `fieldTypes`, `titles`, `selectedKeys`, `varDescriptions`, `bindings`), then every other key sorted. `undefined` values are dropped. Then `lit:` keys sorted, then `str:` keys sorted, then incoming connections sorted by target input key. A map the node declares but holds empty is written as `lit:{}` or `str:{}` in its place, so the load keeps it empty; without it the constructor's defaults would come back, turning a cleared slot on IF or SWITCH into a typed 0 ([[B12]] losslessSaves). An absent map (a hand-written seed) still takes the defaults.
- **Values** are `JSON.stringify` output: compact, no spaces outside strings, numbers in shortest round-trip form, newlines in strings as `\n`.
- **References become names.** In `init`, `hostNodeId` (a Format Controller's host), every entry of `members` (a Group), and every entry of each `steps[].nodeIds` (a Presentation) is rewritten from id to name. A reference to an id not in the save is written unchanged.
- **Keys.** An `init`, `lit:`, `str:` or input key is written bare when it matches `[A-Za-z_][A-Za-z0-9_]*` and JSON-quoted otherwise (`lit:"rate.annual"=2`, `"λ1"<-Rate.value`), since socket keys can be user text: a formula variable may hold `.` or `λ`, a Knap variable `-` ([[B12]] losslessSaves). `tests/graph/textFormCatalog.test.ts` carries every catalog node, with a cable on every socket, through the text form.
- **Output keys** are written bare when they contain no space, `"` or `\`, and JSON-quoted otherwise (a Note's frontmatter keys are user text).
- An empty graph has no node lines, so the document starts with `---`.

The text form carries no `id`: on read, each node's `id` is its name.

### The sidecar

`JSON.stringify(sidecar, null, 2)` followed by a newline. Keys appear in this order, each only when present or non-empty:

| Key | Content |
|---|---|
| `v` | The version. Read back as `CURRENT_SAVE_VERSION` when absent. |
| `positions` | Object keyed by name, in line order: `{ x, y, size?, collapsed?, flipped? }`. A node missing here reads at `(0, 0)`. |
| `standoffs` | As saved, with both `nodeId`s as names. |
| `drawnCables` | As saved (no node references). |
| `pins` | `{ nodeId, outputKey }` with `nodeId` as a name. |
| `comments` | As saved, with `nodeId` as a name. |
| `frameFormats` | As saved, with `nodeId` as a name. |
| `palette`, `reportPalette`, `meta`, `savedAt` | As saved. `savedAt` is read back only when it is a number. |
| `packs` | As saved. |

An empty or whitespace-only sidecar reads as `{}`. Invalid sidecar JSON throws.

## Example

Two Number Inputs multiplied and displayed, inside a Group, with one comment:

```
budget: NumberInputNode label="Monthly budget" value=50 width=180 height=76
grp: GroupNode label="Budget" members=["budget","months","annual","shown"] color="blue" collapsed=false width=560 height=282
months: NumberInputNode label="Months" value=12 width=180 height=76
annual: ArithmeticNode label="Annual total" op="mul" width=180 height=177 lit:a=0 lit:b=0 a<-budget.value b<-months.value
shown: DisplayNode label="Annual budget" unitSuffix="none" width=180 height=88 in<-annual.result
---
{
  "v": 2,
  "positions": {
    "budget": {
      "x": -150,
      "y": 1180
    },
    "grp": {
      "x": -177,
      "y": 1144
    },
    "months": {
      "x": -150,
      "y": 1290
    },
    "annual": {
      "x": 115,
      "y": 1211
    },
    "shown": {
      "x": 380,
      "y": 1242
    }
  },
  "comments": [
    {
      "id": "c1",
      "nodeId": "shown",
      "author": "You",
      "text": "Check against last year.",
      "resolved": false,
      "time": 1790000000000
    }
  ]
}
```

`grp` sorts before `months` because both are ready once `budget` is emitted. The JSON save of this document has `nodes` in the same order with `id` equal to `name`, `connections` in line order (`budget.value → annual.a`, `months.value → annual.b`, `annual.result → shown.in`), and the sidecar's other keys at the top level.

## The version gate

`CURRENT_SAVE_VERSION` is `2`, and exactly one version loads. `loadGraph` refuses a save whose `v` differs, before touching the canvas, with a sticky error notice:

- newer: "This file was saved by a newer version of Solenoid (format v*N*) and can't be opened here. Update the app to load it."
- older: "This file uses an old save format (v*N*) that this build no longer opens."

There is no migration in either direction ([[B7]] preAlphaBreakFreely). A change to the format bumps `CURRENT_SAVE_VERSION` and updates the seeds and tests.

## The load path: `loadGraph(g, { curtain? })`

`loadGraph` returns `true` on success and `false` when it refused or rolled back; in both failure cases the previous graph is on screen.

1. **Structural gate.** `validateSavedGraph(g)` runs first, before anything is torn down, so a malformed file cannot fail partway through a rebuild after the user's graph is gone. It requires an object with a numeric `v`, a `nodes` array whose entries are objects with string `id` and `type` and numeric-or-absent `x` and `y`, a `connections` array (when present) of objects with four string fields, and `standoffs` (when present) an array. Failure: sticky notice "Couldn't open this graph: *reason*. Your current work is unchanged." Unknown types and bad cables are not structural failures.
2. **Version gate**, as above.
3. **Snapshot** the live graph with `serializeGraph()` for rollback.
4. **Enter rebuild mode**: suspend autosave, `beginGraphRebuild()` (which suppresses live-creation behavior such as group absorb, and makes `isGraphRebuilding()` true).
5. **Rebuild** (`rebuildGraph`, below). If it reports Placeholders, push a warning naming the count and the distinct missing types.
6. **On a throw**, rebuild the snapshot and notify "That graph couldn't be loaded, so your previous work was restored." If the rollback also throws, suspend autosave once more without a matching resume, so the wreckage is never autosaved over the good copy, and ask the user to reload.
7. **Always**: finish the load reveal, `endGraphRebuild()`, resume autosave, and clear undo history (the load itself must not be undoable).

### `rebuildGraph`

`rebuildGraph` assumes the graph passed the structural gate and that its caller holds the autosave suspension and the rebuild scope, because the rollback in step 6 calls it a second time inside the same scope.

1. **Curtain.** When `curtain` is allowed (the default) and the old plus new node and connection count exceeds 300, the "Loading graph" overlay shows before teardown, and teardown and build yield to a paint every 24 items to advance its progress bar ([[graph-load-teardown-performance]]). Undo and redo pass `curtain: false`: a restore is a reload underneath, but it must feel like an edit, not a document open.
2. **Teardown.** Remove every connection, then every node; each `noderemoved` undocks any Format Controller, so no extra cleanup is needed. Then `forgetAllNodes()` clears every per-node store in one pass. Close the report overlay and stop any presentation, so no overlay keyed to an outgoing node id keeps its chrome (the docked report's canvas squeeze) across a switch. Close any Composite drill-in, which would otherwise keep rendering a Composite from a graph that no longer exists; closing also unmounts its internal views and stops their timers.
3. **Document-level state first**: set the document palette, report palette and `meta` (each `null` when absent), so node colors resolve through the right palette as nodes are built.
4. **Placeholder sockets.** For each saved node whose `type` is not in the registry, `deriveMissingNodeSockets` collects the input keys its saved connections target and the output keys they leave from, each in first-seen order.
5. **Construct** every node synchronously, in save order:
   - Known type: `new Ctor({ ...init })`. Then, only if the new instance declares a `literals` object, replace it with a copy of the saved `literals`; likewise `stringLiterals` ([[C28]] literalsIffEditable). A saved map on a class that does not declare it is dropped.
   - Unknown type: `new PlaceholderNode({ missingType, savedInit, savedLiterals, savedStringLiterals, inputKeys, outputKeys, label })`, where `label` is `init.label` when it is a string, else the type.
   - Record `savedId → freshId`. rete mints a fresh random id for every node, so saved ids never survive a load.
   - `nodeNameStore.claim(freshId, name, type)`: a valid, unclaimed saved name is kept (and bumps that prefix's counter past it); otherwise a default name is assigned.
   - Restore `size`, `collapsed` and `flipped` into their stores.
6. **Add and position** the nodes to the editor in concurrent batches of 24.
7. **Remap references** (`remapNodeRefs`) on every constructed node through the id map: `hostNodeId`; `members`, dropping any id that does not resolve to a live node; each Presentation step's `nodeIds`, likewise filtered. A Placeholder's `savedInit` (a copy of the saved `init`) is remapped the same way, so its references follow a rename of the node they name to the next save. The remap never writes into the `SavedGraph` it loads from, which may be a library document or a seed that loads again.
8. **Reconnect**, in save order. A connection whose source or target does not resolve is skipped. A connection the editor refuses (incompatible sockets, duplicate) is skipped silently. Each successful connection fires `connectioncreated`.
9. **Hydrate Composites**: each `CompositeNode` builds its internal editor from `init.internal` with the same registry, applying the same literal-map gate, then remaps its internal nodes' references (as in step 7) and its ports' `internalNodeId`s to the fresh internal ids. `snapshotInternal` maps both back to saved ids, so a Group or Format Controller inside a Composite finds its members and host after every load. An unknown internal type loads as a Placeholder, as on the main canvas, and re-saves as the original type.
10. **Settle wildcard types**: `settleWildcardTypes(editor)` alternates Conduit lane typing and trueany adoption to a joint fixpoint ([[socket-lattice]], [[type-propagation-on-in-place-socket-retype]]). This must precede step 11.
11. **Format Controllers and Convert**: every constructed Format Controller docks to its host; every Convert node syncs its unit arrows; every Format Controller refreshes its annotation.
12. **Side tables**, each remapped through the id map and filtered to live nodes: standoffs (skipped when either end is missing or both ends are the same node), drawn cables (loaded as is), pins, comments, frame formats.
13. `rebuildGroupMembership(editor)` from the Groups' `members`.
14. `processGraph()` computes every node.
15. Fit the camera to the nodes (skipped for an empty graph, where `zoomAt` would produce a NaN transform), then `syncGroupCollapse` re-hides collapsed Groups' members.
16. Two animation frames later, reposition every docked Format Controller against its host, once heights have settled (a Decimal chip lays out a frame late).

The saved-id to live-id map from the last load stays readable through `getLastLoadIdMap()`. `seedTune.ts` reads seed geometry back by saved id through it, and `aiReveal.ts` uses it to find the nodes an AI apply added.

### Unknown types: the Placeholder

A `PlaceholderNode` ([[C35]] unknownViaPlaceholder) keeps the original type (`missingType`), `init` (`savedInit`) and literal maps verbatim, has one adoptive input per derived input key and one `trueany` output per derived output key, and sizes itself 200 wide by `104 + 24 × rows` high, where rows is the larger socket count. Every output evaluates to `#REF!` with the message that the node isn't available here and naming the fix (turn its pack on, or open in a build that has it). Because it re-saves as the original type, opening a document with a pack off and saving it keeps the pack's nodes intact; a later load in a build that has the type restores the real node. The loader's notice after such a load says how many nodes were placeholdered and of which types.

## What a save deliberately omits

- Live rete ids. Every load mints new ones; only names are stable.
- Adopted socket types. A wildcard socket's settled type is derived from the wiring by step 10 on every load, never stored.
- Derived display and runtime state, per the field classification above: `cached*` and `_*` fields and the `DELIBERATELY_TRANSIENT` list.
- A node's measured size for most classes. `width` and `height` are captured in every node's `init`, but only size-owning classes (annotation frames, the Composite card, Groups, overlay hosts) read them back ([[C37]] observerOwnsSize); for other classes the saved values are inert and a fresh measure wins.
- Image bytes. On desktop, `bundleLocalImages` runs before `serializeGraph`, so the JSON carries the fresh paths. It writes each unsaved image into an `images/` folder beside the file (reusing a same-content file, else `name (2).ext` up to `(9)`, else a content-hash suffix) and records a document-relative `assetPath`; the Image card re-reads it on mount, which covers a document load, a paste and a Placeholder restore with no hook per load path. A path that climbs out of the document's folder is never read, and a missing file is not an error, since the folder is the user's and files move. The card shows a "not saved" hint until its image is bundled. On the web an attached image stays session-only.
- Selection, camera, undo history, open overlays, drill-in state, and the sink arm flag.
- The document's own name, file path and clocks: these live on the library entry (`SolDoc`), not in the graph.

## The strict validator

`graphValidate.ts` is the strict counterpart to the forgiving loader: every condition the loader would repair or silently drop is an issue. It serves the AI palette (a candidate rewrite must be free of hard issues before it applies) and the CLI (`scripts/validate-graph.ts`, `scripts/run-graph.ts`). The interactive loader does not call it.

`validateText(text)` reports every malformed line rather than stopping at the first: a missing separator, each line `parseNodeLine` rejects, duplicate names (salvage keeps the first), and invalid sidecar JSON. When the grammar is clean it reads the text with `readTextForm`; otherwise it salvages the parsable lines at `(0, 0)`. It then runs `validateGraph` and checks that every sidecar reference (`positions` keys, standoff ends, pins, comments, frame formats) names a real node, since a misspelled name silently loses that entry on load.

`validateGraph(g, lineOf?)` reports, each anchored to the node's line when known (the line is null for a sidecar or whole-graph issue, and for a graph validated straight from JSON). An error is a condition the loader would repair or the editor refuse; a warning is legal to load and run but almost certainly unintended. Each node is judged against its own headless instance, never a per-class cache, because `init` can change the socket set (op-selected and row-driven sockets).

| Check | Severity |
|---|---|
| `v` is not `CURRENT_SAVE_VERSION` | error |
| a `name` that is not an identifier | error |
| an unknown type, with the nearest registry names | error |
| the constructor throws on this `init` | error |
| an `init` key the constructed instance does not carry (the whitelists, instance fields, literal and input keys, `valueKeys` for row-growing nodes and `internal` for Composites are accepted) | error |
| an `op` outside the class's op vocabulary, when that vocabulary has two or more entries (an unknown op constructs without complaint and then miscomputes; a single entry asserts too little) | error |
| a `lit:` or `str:` key on a class that does not declare that map, or a value of the wrong JSON type | error |
| a connection to or from an unknown node, to a missing input, or from a missing output (skipped when the instance has no sockets of that side) | error |
| a connection `canConnect` refuses, with the reason phrased as the fix (the loader would drop it without a word) | error |
| a single-cable input wired twice | error |
| issues inside a Composite's `internal` subgraph, prefixed "inside the composite"; the name check is skipped there (internal ids are not user names) and the version is checked once, on the outer graph | inherited |
| a dependency cycle, listing the nodes (they compute as `#CIRC!`) | warning |

Suggestions use Levenshtein distance within a budget of `max(2, ceil(len / 4))`, showing the two closest. `hardIssues` drops warnings; `formatIssues` renders `line N [name]: message`, or `graph: message` when there is no line.

## Where documents are stored

The document library is the working store; files are exports and imports of one document.

**The library.** `DocLibrary` is `{ v, documents, currentId }`, most recently changed first. Each `SolDoc` is `{ id, name, graph, updatedAt, filePath?, fileSavedAt? }`: `id` is a random UUID, `name` is unique in the library ("Untitled", "Untitled 2", ...), `graph` is a `SavedGraph`, `updatedAt` is the epoch ms of the last capture, `filePath` binds the document to a disk file (desktop), and `fileSavedAt` is the last file write. Every transform in `documentStoreCore.ts` returns a new `SolDoc` for each document it changes, because `persist()` skips a document whose object is identical to the one it last wrote ([[C31]] immutableDocStore). A duplicated document gets a new id and name and no `filePath` or `fileSavedAt`.

**localStorage.** Each document has its own two-slot pair `solenoid.docs.doc.<id>.a` / `.b` holding `{ seq, doc }`, and the library has one index pair `solenoid.docs.index.a` / `.b` holding `{ seq, currentId, docs: [{ id, name, updatedAt, filePath? }] }`. Every write goes to the older slot; every read takes the newer structurally valid one; `seq` is a strictly rising in-session counter and must be the first key of the payload ([[C32]] autosaveSlotOrder). A failed write raises a sticky notice until a write fully succeeds. Restore reads the index, then each document's slots through `validateDoc` (which applies `validateSavedGraph`), skipping a missing or corrupt document. The mechanics are in [[per-doc-autosave-persistence]].

**Autosave.** Any settled edit calls `scheduleAutosave()`, which debounces 700 ms and then calls `documentStore.captureCurrent()`: serialize the main graph, write it into the current document with a fresh `updatedAt`, float that document to the top, persist. A capture is skipped while autosave is suspended or while a rebuild is in progress. A capture whose serialize throws writes nothing, raises one sticky error notice (dismissed by the next capture that succeeds) and returns false ([[B12]] losslessSaves). A pending autosave is flushed synchronously on `pagehide`. In the dev server each capture is also mirrored to `.dev/current-graph.json`.

**Switching documents.** Every `documentStore` verb that changes which document is on screen (`newBlank`, `newFromTemplate`, `open`, `saveAs`, `duplicate`, `importAsDocument`) first returns early if a rebuild is running, then captures the outgoing document, and stays on it when that capture fails ([[C36]] captureBeforeSwap). The sanctioned exceptions are `restore` (nothing live at startup), `remove` (capturing would resurrect the deleted edits) and `reloadCurrent` (gated on the load reveal instead). When the incoming document's load is refused, the library reverts `currentId` to the document still on screen, or, with nothing to revert to, adds and shows a blank "Untitled", so an autosave never writes one document's graph into another. Deleting the last document replaces it with a blank one. A fresh profile starts from the default seed.

**Save clocks.** `saveTimeStore` is the leaf module node classes read the clocks through (`autosavedAt`, the current document's `updatedAt`, and `fileSavedAt`), since a node class cannot import `documentStore`. `documentStore` registers itself as its provider at load and bumps it on every library change; in a headless run nothing registers, so both read null.

**Undo.** The undo history records `JSON.stringify(serializeGraph())` after each settled mutation; undo and redo restore with `loadGraph(snapshot, { curtain: false })`, put the camera back, and schedule an autosave.

**Files on disk.** A file is the `SavedGraph` JSON (not the text form), written with `JSON.stringify(g, null, 2)` and a `.json` extension.

- *Save* (`saveToDisk`) captures the current document, then on desktop resolves the destination (the bound `filePath`, or a save dialog for a new document or Save As), bundles images into it, serializes, stamps `savedAt` with the write instant, and writes through a `<path>.tmp` sibling renamed over the target (a direct write when the temp file is outside the granted scope). A new destination binds the document to the path and renames it to the file name. It then captures again (so the library copy carries the new `assetPath`s) and sets `fileSavedAt` to the same instant as `savedAt`. In the browser the file is offered as a download, with no image bundling.
- *Open* (`openFromDisk`) parses the JSON (error notice when it is not JSON), applies `validateSavedGraph` (error notice when it fails), and adopts it with `importAsDocument(graph, fileName, path)`: the graph's `meta` is marked `foreign: true` with `networkAllowed` cleared, so a shared file cannot pre-grant network access; the new document takes the file name, binds to the path on desktop, and seeds both `updatedAt` and `fileSavedAt` from the file's `savedAt` when present. `saveToDisk` captures right before it writes, so at that instant the last autosave and the write coincide, and a document opened on another machine shows when its content was really saved rather than when it was imported. A load refused by the version gate reverts to the previous document.
