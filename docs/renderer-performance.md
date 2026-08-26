# Renderer performance — the settled policies

The live perf policies for the one renderer (React Flow). The rete-era
sections — zoom settle window, HIC capture pipeline, DOM↔canvas transform
sync, gesture-time GPU promotion — died with their subjects in the 2026-08-26
cutover; git has them.

## Semantic zoom gate (`semanticZoomStore.ts`) — raw CSS scale, not dpr-folded

The far-zoom simplification class (`html.solenoid-semantic-zoom`, plain CSS
does the swap) gates on the RAW CSS scale, threshold 0.3. Folding dpr in is a
measured negative result: it made the gate trigger at a DIFFERENT apparent
zoom per display, and apparent size is what legibility depends on. 0.3 ≈ a
card drawn at ~30% (a ~200px card → ~60px): body text unreadable, card still
a clear block — conservative (far-overview only) but actually reachable.
Whichever surface is being zoomed owns the toggle (`syncSemanticZoomFor` runs
from that surface's viewport drivers).

## GPU texture budget — a covered canvas must stop painting

An occluded subtree is not reliably dropped from raster, so a live canvas
under a full-viewport opaque overlay keeps its layers and textures resident —
two surfaces' worth on a mobile GPU whose max texture the canvas bbox × dpr
can already overrun on its own. The composite drill-in carries the rule
(`compositeEditor.css`): `html.sol-drilled-in
.sol-rf-appcanvas:not(.solenoid-composite-editor__host) { visibility: hidden }`;
any future canvas-covering surface owes the same. It must be `visibility`,
not `display: none` — the covered area is still asked to re-render and
re-measure cards while drilled in, and measurement needs a real layout box.

The same budget is why the rete surface never promoted its holder to a GPU
layer for pan on touch devices (the layer tiled and re-rasterized past the
max-texture size, flickering heavy content). React Flow manages its own
transforms; if a promotion lever ever comes back, gate it on `IS_COARSE`, not
`IS_MOBILE` — a tablet runs the desktop UI on a mobile-class GPU.
