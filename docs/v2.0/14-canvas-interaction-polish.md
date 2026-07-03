# Bundle 14 — Canvas & interaction polish

**Source:** scope-features #37, #38, #39, #40, #41, #57(b). All IN. Plus a pointer to
`v1.1-plan.md` WS-C.

---

## #37 — Quick-wire: drop a cable on empty canvas, get the next node (IN, with conditions)

**Required pairing:** Settings toggle; socket hit-target-size pass; a distinct
hover/drag cursor icon.

**Grounding — the exact drop handler:** `src/graph/Canvas.tsx:2098-2122`, inside a
`connection.addPipe` callback. Handles `connectionpick` (2103-2114: sets
`cableDragging`, adds `.solenoid-canvas--cabling` class, tracks
`dragOriginKeyRef.current` via `dragSocketKey(nodeId, key)`) and `connectiondrop`
(2115-2120: **today just resets `setCableDragging(false)`, removes the class, clears
`dragOriginKeyRef.current` and `socketHighlightStore.setDrag([])`** — no coordinate
inspection, no menu). **Quick-wire's insertion point is exactly here** — at
`connectiondrop`, before clearing `dragOriginKeyRef.current`, read the origin socket's
type via `editor.getNode(nodeId)?.outputs/inputs[key]?.socket` (the same pattern already
used at lines 2088-2089 with `SolenoidSocket`/`.dataType`/`canConnectTo`), then open the
Add menu filtered to that type.

**Add-menu search to reuse:** `src/graph/catalogSearch.ts` — `scoreLeaf(query, {leaf,
categoryPath}): number|null` (lines 42-65), `searchLeaves(leaves, query):
NodeCatalogEntry[]` (68-76), `flattenLeaves(entries, ancestors?): LeafWithContext[]`
(25-33). Underlying primitives in `src/graph/fuzzy.ts`: `fuzzyScore(query, text):
number|null` (line 4), `fieldScore(query, field)` (22). **None of these take a type
filter today** — quick-wire needs to call `flattenLeaves` then filter `LeafWithContext[]`
by socket compatibility (via the leaf's declared input/output types) before/after
`searchLeaves`, or add a filter param to `searchLeaves` itself. Bridge to open the menu
programmatically: `src/graph/addMenuStore.ts` — `addMenuRequest.register(fn)` /
`.open(screenX, screenY)`.

**Socket CSS** (the hit-target pass) — `src/graph/components/socket.css:14-21` (NOT
`nodeCard.css`, which has no socket selectors):
```css
.input-socket, .output-socket, .input-socket > span, .output-socket > span {
  width: var(--socket-size, 12px);
  height: var(--socket-size, 12px);
  ...
  line-height: 0;
}
```
Shape variants at lines 33-59; cabling-mode hit area at 101-102
(`.solenoid-canvas--cabling .solenoid-conduit .input-socket/.output-socket`);
`--socket-border-width: 1.5px` at line 132.

**Build:**
1. Add a Settings toggle (`settingsStore.ts`, following existing boolean-field pattern).
2. At `Canvas.tsx:2115-2120` (`connectiondrop`), before clearing state: check if the drop
   landed on empty canvas (not on a socket); if so, capture the origin socket type, call
   `addMenuRequest.open(...)` with a type filter derived from
   `flattenLeaves`+`searchLeaves`.
3. Widen the effective hit target for cable-release (via `--socket-size` CSS var scoped
   to cabling mode, or a larger invisible hit-zone) and swap the cursor via a new CSS
   class toggled during `cableDragging`.

## #38 — The command palette (IN — Enter key, not Ctrl+K)

**Grounding — the exact "is typing" guard to reuse:** `Canvas.tsx:646-664`, inside
`onKeyDown`:
```ts
const target = e.target as HTMLElement | null;
const tag = target?.tagName;
const editable = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!target?.isContentEditable;
```
(647-649), then single-key shortcuts gated at line 664: `if (!editable && !e.ctrlKey &&
!e.metaKey && !e.altKey) { ... }`. Also note the compute-overlay guard immediately above
(line 655: `if (computeOverlayStore.visible()) return;`) and the always-global F9 handler
(line 659). **The command palette's bare-Enter trigger must mirror the `editable` check
exactly**, likely sitting in the same `!editable` block so Enter-to-commit in a text
field is never hijacked.

**Build:** one box, bottom-aligned bar, non-persistent. Reuse `catalogSearch.ts`'s
`searchLeaves`/`flattenLeaves` for the node-add half (same as quick-wire above — share
the filtering logic between the two features rather than duplicating it).

## #39 — Scrubbing: drag any number, watch the model move (IN)

**Grounding — `useDraftCommit`:** `src/graph/components/inlineInput.tsx:78-104`:
```ts
export function useDraftCommit<T>(
  committed: T,
  toText: (v: T) => string,
  parse: (text: string) => T | typeof INVALID_DRAFT,
  apply: (v: T) => void,
)
```
Returns `{draft, setDraft, onBlur, onKeyDown}`. Commits on blur/Enter via `parse→apply→
pushHistory(undo,redo)` (line 97); Escape sets a `cancelled` ref, reverts on blur (90,
100-101). Used by `InlineNumberField` (113-136). **This hook only fires on blur/Enter,
not pointer move — scrubbing needs a parallel drag-commit path**, not an extension of
this hook: a new `onPointerDown`/`onPointerMove` gesture on `InlineNumberField`'s input
that calls `field.setDraft` continuously during the drag and reuses `apply`+
`pushHistory` once on pointer-up (mirroring lines 96-97's commit sequence, just
triggered by pointerup instead of blur/Enter).

**Build:** add the pointer-drag gesture to `InlineNumberField`, modifier keys changing
step size, Escape reverting mid-drag (set the same `cancelled` ref the existing hook
uses).

## #40 — Semantic zoom (IN — optional, very conservative trigger)

**Grounding — no named "LOD" property exists; the mip level is computed inline each
frame:** `src/graph/htmlCanvasRenderer.ts`'s `drawFrame` (line 614): `target =
this.quality * cam.scale * dpr` (626), `idealI = Math.max(0, Math.floor(Math.log2(REF /
Math.max(target, 1e-4))))` (627), `this.curMip = useCached ? REF / Math.pow(2, idealI) :
0` (628). `quality` is private (line 99), set via `setQuality(q)` (160). **Semantic zoom
should key off `idealI` (or a newly-exposed `curMip`/getter)**, not raw `cam.scale`
directly — expose a getter if one doesn't exist yet.

**Build:** a Settings toggle; at a genuinely-far `idealI` threshold, swap node cards for
simplified representations.

## #41 — Conditional formatting for tables (IN — own design pass, sequence LATE)

No new grounding beyond bundle 05's Format Controller detail (must not overlap that
territory) — **NEEDS AUTHOR INPUT: the design session itself**, before any code.

## #57(b) — Multi-node operations: align/distribute, batch expand/collapse (IN)

**Explicit scope split:** (a) paste-anywhere OUT. (b) align/distribute + batch collapse
IN. Wrap-in-subgraph explicitly NOT part of this gesture (bundle 09 owns that).

**Grounding — reading the current selection:** `Canvas.tsx:1211`
(`const nodeSelector = AreaExtensions.selector();`), wired at line 1333
(`AreaExtensions.selectableNodes(area, nodeSelector, {accumulating})`). Selected state:
each node's ambient `.selected` boolean, read the same way `nudgeSelection`
(`Canvas.tsx:624-626`) and `groupLogic.ts:70` already do:
`editor.getNodes().filter(n => (n as {selected?:boolean}).selected === true)`.
Programmatic select: `selectable.select(id, accumulate)` (1312),
`nodeSelector.remove({label:"node", id})` (1319, 1325),
`setUnselectAllNodes` (1466). Lasso geometry: `src/graph/lasso.ts`
(`lassoActiveStore`, polygon-crossing test), wired via `applyLasso` in `Canvas.tsx:1065+`
(builds `matched: string[]` via `pointInPolygon`/`polygonIntersectsBBox`, then
`unselectAllNodesFromProcess()` + `selectNodeFromProcess(id, accumulate)`, lines
1087-1091).

**Build:** align/distribute + batch collapse/expand read the current selection via the
exact filter pattern above (`Canvas.tsx:624-626`/`groupLogic.ts:70`'s idiom), operating
over that node-id list — no new selection machinery needed.

---

## Also see: `v1.1-plan.md` WS-C (already fully planned, build as written)

Grid system, cable collision avoidance (guard: `cablePaths.ts`'s route selection —
confirmed the actual winner is picked by globally-shortest LENGTH at lines 266-297
`if (!best || total < best.total - SOLVE_EPS) best = ...`, NOT by turn-count-first
despite candidates being turn-sorted first at line 261 — comment at 267-276 explicitly
warns against gating by turn count; `cablePaths.test.ts` continuity test confirmed real,
reconstructing vertices via `vertsFromPath`), minimap position, palette editor.
`chromeToggle.ts`'s `registerChrome`/`toggleAllChrome` (confirmed at lines 12-15, 22-28)
is the same registration mechanism bundle 11's new panels use.

## Exit criteria

Quick-wire ships as a Settings toggle, inserted at `Canvas.tsx:2115-2120`'s
`connectiondrop` handler, with the socket-size + cursor pass shipped alongside; the
command palette triggers on Enter guarded by the same `editable` check as
`Canvas.tsx:647-649`; scrubbing adds a pointer-drag path to `InlineNumberField`
alongside (not replacing) `useDraftCommit`; semantic zoom keys off `idealI`
(`htmlCanvasRenderer.ts:627`); conditional formatting is NOT built until its design
session has author sign-off; align/distribute and batch collapse read the existing
`.selected`-boolean selection pattern, explicitly without paste-anywhere or
wrap-in-subgraph.
