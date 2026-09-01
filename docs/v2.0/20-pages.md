# Bundle 20 — Pages: tabs are pages in ONE document

**Source:** the document-tabs audit + author ruling 2026-08-30 (`../archive/dev-notes-history.md`,
sweep 2026-08-31). **Verdict:** IN, whole feature deferred to 2.0. **Score:** Strong · Core ·
High · Wide. **Written:** 2026-09-01, plan-only.

## The ruling, restated once

One save file. Tabs are canvas PAGES of it. Pages reference each other's nodes. Explicitly
NOT concurrently-loaded library documents with cross-document links — that fork was weighed
and rejected. The library (`documentStore`, the doc switcher in `MenuBar`) stays what it is: a
list of separate documents; the tab strip becomes the page strip of the OPEN document.

## The decision to make first: one engine, or one per page

The audit named it: one-doc-one-file means a SINGLE editor/engine can plausibly serve all
pages. **Recommend: one editor, one engine, pages as view scopes.**
- FOR: cross-page references are then REAL connections (no bridge machinery, no second
  recompute path — rules targetedEqualsFull holds untouched); `nodeNameStore`'s one flat
  per-document namespace is exactly right (a name is unique in the document, which is what a
  cross-page reference needs); `forgetAllNodes()` wiping node-keyed stores on document switch
  stays correct; save/load stays one `rebuildGraph`; undo stays one snapshot history.
- AGAINST: the RF surface renders one node set — pages need a filter at the projection, and
  every positional subsystem must respect it. That is the Wide blast radius, and it is
  mechanical rather than architectural.
- The per-page-editor alternative inherits the composite drill-in's machinery (cached stacks,
  one mounted `FlowSurface` that swaps) but reintroduces the blockers the audit listed and
  makes cross-page references a bridge. Reject unless the single-engine filter proves
  unworkable at the RF layer.

## Model

- **A node carries `page: string`** (a page id; default page for every existing seed). It is
  VISUAL state → it lives in the text form's sidecar block beside `positions`, never inline in
  the per-node line (subsystem-invariants § Addressable model). New top-level `pages:
  [{id, name, order}]` in `SavedGraph` — add to BOTH `writeTextForm` and `readTextForm`
  (rules saveViaTextForm) or it is silently dropped on every save.
- **Groups, standoffs, docked FCs, conduits are single-page**: a group's members share its
  page (moving a group moves its page); a standoff between two pages is refused; a docked FC
  lives on its host's page. Enforce in the edit verbs (`flowModel.ts` `moveNode`/`connect`
  are the choke points), not in the components.
- **Connections may cross pages.** They are ordinary connections in the model. At the
  surface, a cross-page cable renders as a **portal stub** at each end: an exit stub on the
  source page (the socket's cable ends in a labeled chip naming the target page + node) and
  an entry stub on the target page. Clicking a stub flies to the other end (page switch +
  `flyToNode`). The archived Portal idea (`../archive/isolate-pin-multiview-scoping.md`) is
  this, with the "named store" replaced by a real connection.
- **Composites are orthogonal**: a drill-in substitutes the surface (`activeGraph.ts`); a
  composite's internal graph has no pages (one canvas), and a composite instance sits on one
  page like any node.

## Surface

- **The projection filters by the active page**: `toFlowNodes` / `toFlowEdges` take the
  active page id; a node off-page projects nothing; an edge with one end off-page projects a
  stub edge to a synthetic stub node (RF nodes, cheap, non-selectable, not in the model).
  `syncTopology`'s identity preservation must survive the filter (survivors keep object
  identity across page switches, or every switch re-renders the whole page).
- **Page switch = a view change, not a rebuild**: no `rebuildGraph`, no engine reset; the
  camera per page is remembered (`flowView` viewport map keyed by page); `pendingFit` on
  first visit.
- **Everything positional becomes page-scoped by reading the filtered set**: Tidy
  (`tidyArrange.ts` — arrange the active page; a cross-page cable contributes no edge to
  ELK), Cleanup, minimap (RF's, already fed by the projected nodes), lasso, isolate (the cone
  crosses pages — isolate switches to a page-local render with stubs, or shows the cone
  across pages with a page badge; recommend local + badge), standoffs and group push
  (single-page by model), `zoomAt`/fit-all (active page), quick-wire placement, paste (onto
  the active page), the HIC gesture layer (captures the active page's cards only),
  `flyToNode` (switch page first — one shared action, one place to change).
- **Search crosses pages**: the command palette, Navigator/Outline, where-used, Problems,
  Pins, Alerts, Comments panels list the page beside the node and fly across pages. Report and
  Presentation references are name-addressed already and work unchanged; Presentation steps
  gain the page implicitly from the node.
- **The page strip**: a `layout-chrome.md` decision — recommend the strip lives in the top
  bar's middle gap on desktop (the empty div the art slot was reserved for — the author
  decides which wins) and as a row in the mobile menu bar; rename inline, reorder by drag,
  add/close with the usual guards (closing a page with nodes asks; nodes move to a page, never
  vanish). Mermaid/Report/Note nodes are pages' citizens like any other.

## Text form and AI

- Line grammar unchanged (a page is not a node); the sidecar gains `page` per node and the
  `pages` list. The AI palette's whole-document rewrite (aiWholeDocRewrite) carries pages
  through the sidecar untouched; the grounding spec (`aiGrounding.ts`) states the page field.
- The strict validator (`graphValidate.ts`): unknown page id → repair-grade issue (assign to
  the first page), duplicate page names → issue.

## Build order

1. Model + persistence: `page` on the node, `pages` in `SavedGraph`, sidecar both ways, the
   default-page fill on load, round-trip and fuzz tests (`textForm`, `textFormFuzz`, seeds).
2. Projection filter + stubs + camera-per-page; `syncTopology` identity across switches
   (perf probe at 200 nodes).
3. Edit-verb guards (single-page groups/standoffs/docks); paste onto the active page.
4. The page strip (desktop + mobile), rename/reorder/add/close, `layout-chrome.md` row.
5. Page-scoped Tidy/Cleanup/fit/isolate/lasso; `flyToNode` page switch; panels show pages.
6. Validator + grounding; a seed with two pages and a cross-page reference; What's-New.

## Exit criteria

A document with several pages saves as one file, round-trips byte-stable through the text
form, computes as one graph, renders one page at a time with cross-page cables as clickable
stubs, and every chrome verb (Tidy, fit, search, fly-to, undo) behaves per page without a
rebuild on switch. `seeds.test.ts`, `textForm*.test.ts`, `flowModel*.test.ts` pin the model;
the author eyeballs the strip and the stubs.

## Downstream customers

The Excel transpiler maps sheets → pages (`08-excel-transpiler.md`, updated in `../2.0-plan.md`
Arc 3); multiplayer awareness shows who is on which page (`21-collaboration.md`).
