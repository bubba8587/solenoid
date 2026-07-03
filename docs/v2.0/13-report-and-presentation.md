# Bundle 13 — The report file, the object socket family, and presentation nodes

**Source:** scope-features #13 (IN, corrected), #47 (IN), #50 (IN, scoped way down), #51
(IN, light), #52 (IN, colors only), #49 (IN, as a node). **Depends on:** loosely on
bundle 01.

## #13 — The report projection: one editable markdown file (IN, corrected scope)

**NOT "canvas Notes rendered in reading order."** One editable markdown file,
independent of the graph, reusing the Note body's inline-ref span mechanism.

**Grounding — Note frontmatter (the OUTPUT-socket half, already built):**
`src/graph/noteFrontmatter.ts` — pure parser, `parseNoteFrontmatter(text):
ParsedFrontmatter` (line 129), splits `---`-fenced YAML into `FrontmatterField[]`
(key/value/guessed-type, lines 35-40) + remaining `body`. Type guessing via
`parseScalar` (58), `listType` (104). **Reconciliation-on-blur is NOT in this file** —
it's owned by `NoteNode.tsx`'s `commitFields(force=false)` (lines 121-152), which calls
the node's `syncFields()` method, walks `editor.getConnections()` dropping/keeping
cables per `canConnect`, bumps `setFieldsVersion`, calls `area.update`,
`reconcileFcTypes`, `bumpConnectionVersion()`, `processGraph()`. Triggered on `onBlur` of
the body `<textarea>` (`NoteNode.tsx:348`) — never per-keystroke.

**Note markdown rendering:** `NoteNode.tsx` uses `marked.parse(data.renderBody || "",
{async: false, gfm: true, breaks: true})` piped through `DOMPurify.sanitize` (lines
219-224), rendered via `dangerouslySetInnerHTML` (line 362). **CONFIRMED: no existing
inline-code-span special-casing exists** (no regex for `` `=name` `` or similar
anywhere) — step 1 below (Note INPUT sockets via inline refs) is genuinely new work, not
an extension of something partial.

**`ValueDisplay` — the exact rendering stack to reuse verbatim for inline refs:**
`src/graph/components/nodeKit.tsx:409`, `export function ValueDisplay({...})`. Resolves
format via `formatAnnotationStore.getForNode(ctxNodeId)` (line 433) or, for pass-through
nodes, `sharedAnnotationResolver(editor).outAnnotation(nodeId, outputKey)` (445-449).
Scalar formatting via `formatNumberWithAnnotation(v, ann)` (line 477). Date coercion via
`dateFormatDisplay`/`nodeOutputIsDate` (`components/valueDisplayFormat.ts:58,75`).

**Three-step design (already settled 2026-07-02/03):**

1. **Note INPUT sockets via inline refs.** Build the `` `=name` `` span-detection +
   input-socket-minting from scratch (confirmed nothing exists to extend), mirroring the
   ExpressionNode bare-name pattern, reconciled on blur the same way `commitFields`
   (`NoteNode.tsx:121-152`) already reconciles frontmatter output sockets. The span
   renders its connected value using `ValueDisplay`'s exact resolver stack
   (`nodeKit.tsx:409-477`) so an FC-locked value shows its format in the prose. A frame
   input renders as a compact table capped at preview size.
2. **The "object" socket category.** `lambda` already exists:
   `SocketDataType` union includes `"lambda"` (`src/graph/sockets.ts:42`), color
   `SOCKET_COLORS.lambda = "var(--sock-lambda)"` (line 76, "teal-green — circle with λ"),
   socket instance `export const lambdaSocket = new SolenoidSocket("lambda")` (line
   282). **`chart` does NOT exist** — confirmed absent from the `SocketDataType` union
   and `FAMILIES`/`MATRIX_TYPES`/`FAMILY_VALUE_TYPES` (lines 17-132) — this is genuinely
   new, matching the plan's original framing. Add `chart` alongside `lambda` following
   the identical definition pattern (color var, socket instance, connects only to self +
   `any`).
   **Lattice test to extend:** `src/graph/socketConnect.test.ts` — confirmed real,
   `describe("lattice invariants — TYPE separation + DIMENSIONAL flow (full sweep)", ...)`
   at line 192, iterating all family/dimension pairs (209, 216-218) plus dedicated
   `cube`/`lambda`/`frame` edge checks (226-285, `lambda` explicitly at line 250). Add
   `chart`'s edge cases to this same sweep block.
   **LaTeX rendering (for `lambda` values, already built — reuse verbatim):**
   `formulaToLatex(expr): string|null` (`src/graph/excelFormula.ts:695`), consumed by
   `components/FormulaField.tsx:52,55` and `FormulaPopup.tsx:174,177`, both calling
   `katex.renderToString(latex, {throwOnError: false, ...})` (package.json:25,30 has the
   `katex` dependency).
3. **The report file itself.** Standalone, blank-by-default markdown document, separate
   from the graph's node set, gets the inline-ref span from step 1 directly, can embed a
   Note node as a placed object.

**Scope discipline:** plain markdown source + inline refs + embeds — no WYSIWYG toolbar.

**Build order:** step 1 first (nearly-free groundwork, though genuinely new code — see
correction above), step 2 (object family) next, step 3 (the file itself) last.

## #47 — Static HTML export (IN — confirmed easy... with one correction)

**Correction:** `drawElementImage` (`src/graph/htmlCanvasRenderer.ts:28`) is the WICG
HTML-in-Canvas API — Chrome-only, behind `chrome://flags/#canvas-draw-element` (module
comment, lines 10-12). **This is NOT directly reusable for a portable static HTML
export** (the export needs to work in any browser the recipient opens it in, not just a
flagged Chrome). Export needs its own DOM→image capture path (e.g. render via an offline
`foreignObject`/rasterize step, or a headless-browser screenshot at export time) — the
existing renderer's `drawElementImage` usage in `buildMips` (530-564) and `drawFrame`
(614-647) is for the LIVE canvas rendering pipeline, a different problem.

**What IS reusable directly:** charts already render as SVG (no new export path needed
for those); the report (#13) is markdown with live refs — freezing it means rendering
the same markdown with today's values substituted as plain text, reusing `ValueDisplay`'s
formatting stack one more time.

**Build:** "Export as webpage" → one self-contained `.html` file: the frozen report
markdown (values substituted, not live), key charts as inline SVG, a canvas image via a
NEW capture path (not `drawElementImage`) — inline CSS/images as data URIs.

## #50 — Auto-documentation node (IN — scoped way down, gated on confidence)

Attaches to Groups only (`nodes/group.ts:11-40`'s `GroupNode`, `members: string[]`).
**Explicit caution:** only build if confident the composition approach works — prove on
a handful of node types before catalog-wide authoring. Uses the catalog's existing short
node `description` strings (`nodeCatalog.ts`) as source material.

## #51 — Presenter mode: the Presentation node (IN — keep it very light)

**Correction:** the camera choreography to reuse is `flyToNode(nodeId): void`
(`src/graph/flyToNode.ts:14`) — resolves collapsed-group ancestors then
`AreaExtensions.zoomAt(area, [ref])` (line 43) — NOT `loadReveal.ts`, which only handles
node/cable fade-in SEQUENCING (`revealWaves(nodeIds, edges)` at line 72, plus a phase
machine) and has no camera movement at all. **There is no existing "sequence-through-
nodes" camera function** — build one for the Presentation node by calling `flyToNode`
per step (or a new variant skipping the collapsed-group resolution and directly
`zoomAt`-ing a raw node list, since a Presentation step's node set is explicit, not a
single target). `revealWaves` is reusable only for topological step ORDERING ideas, not
camera motion.

**Build:** a Presentation node stores an ordered list of steps (title text + an
explicit node-id set per step, picked like a navigator list). Stepping calls the
per-step camera function above — zoom-and-pan only, no isolate/highlight/dim.

## #52 — Branded output: colors only (IN — colors only)

**Grounding:** `src/graph/palette.ts` — `paletteStore.setDocPalette(p?: {base?; overrides?:
Record<string,string>} | null)` (line 324), `paletteStore.docPalette()` (line 336).
Internal state `_docBase`/`_docOverrides`, merged via `recompute()` (~line 300) into
`_effective`. **Today overrides apply globally to `_effective`, with no surface
scoping.** To scope a brand-color override to report/export surfaces only (not the whole
editing canvas): add a PARALLEL override map (e.g. `_reportOverrides`) and a new
`docPalette()`/`setDocPalette()`-style pair specifically for report/export rendering —
don't reuse `_effective` directly, since that also drives the canvas.

## #49 — Session History node (IN — as a node)

**Grounding:** `rete-history-plugin`, wired `Canvas.tsx:1178-1186` (`new
HistoryPlugin<Schemes>()`, `history.addPreset(HistoryPresets.classic.setup())`, stack
capped to 200 via a private-field reach-in, line 1183). Undo/redo bound at lines 791-793.
**No current code reads snapshot state** (confirmed — `getHistorySnapshot` is never
introspected outside the ref itself). Plugin exposes `getHistorySnapshot():
HistoryRecord<A>[]` (`HistoryRecord = {time, action, separated?}` per
`node_modules/rete-history-plugin/_types/history.d.ts`). Classic-preset actions:
`AddNodeAction`/`RemoveNodeAction`/`DragNodeAction` (carrying `nodeId`/`node`/
`position`), `AddConnectionAction`/`RemoveConnectionAction` (carrying `connection`). All
fields are `private` — **only `instanceof` checks + the few public fields
(`DragNodeAction.nodeId/prev/new`) are accessible without patching the plugin.**

**Build:** a Session History node reads `history.getHistorySnapshot()` (needs a reference
to the plugin instance, likely threaded via a module-level singleton per CLAUDE.md's
Rete-separate-React-root pattern), pattern-matches `action instanceof AddNodeAction` etc.
via `instanceof`, distills into a dated human-readable digest string. Doesn't persist,
autogenerates whenever it's on canvas, has a copy button — that's the whole UI.

## Exit criteria

Note bodies support inline-ref input sockets (built fresh, per the correction above); the
`chart` socket type exists alongside `lambda`, lattice-checked in
`socketConnect.test.ts`'s existing full-sweep block; a standalone editable markdown
report file exists with working inline refs and Note-embedding; static HTML export uses
a NEW DOM-capture path (not `drawElementImage`) for the canvas image, freezing the report
+ SVG charts; an auto-doc node exists on Groups only if the composition approach proved
out; a Presentation node steps through camera-only views via a new per-step
`flyToNode`-based function; report/export surfaces support a color-only brand override
via a new parallel palette-override map; a Session History node renders a copyable digest
from `history.getHistorySnapshot()`.
