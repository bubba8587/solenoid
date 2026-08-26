# Renderer performance — the settled policies

The perf policies for the render stack: the React Flow DOM surface and the
HTML-in-Canvas gesture layer over it (author ruling 2026-08-26: HIC is IN —
it survived the rete cutover, ported to the RF surface). The rete-only
machinery (holder GPU promotion, the `--panning` quality-drop system) died
with that surface; git has it.

## Zoom settle window (`zoomSettle.ts`)

`DEFAULT_ZOOM_SETTLE_MS = 420` — how long after the last zoom event the
HTML-canvas layer holds its gesture state before restoring the live DOM at
the new scale. A scale change REPAINTS the visible DOM at the new raster
scale while a translate only re-composites, and wheel zoom is notchy with no
held-pointer signal — a short timer would exit + re-enter the gesture PER
NOTCH and pay that repaint repeatedly mid-zoom. `window.__zoomSettle = <ms>`
overrides live (read at timer-set time). A LONGER settle is NOT the lever for
choppy zoom — ruled out by a deployed 3000ms A/B (dev-notes archive).

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

The same budget shapes the HTML-canvas layer's promotion rules: the viewport
gets a gesture-scoped `will-change: transform` layer on fine pointers only —
NEVER on coarse (`IS_COARSE`, not `IS_MOBILE` — a tablet runs the desktop UI
on a mobile-class GPU, where a layer that size fails tile allocation); on
coarse pointers only the small DOM-only elements are promoted per-element,
size-capped at 1024px.

## HTML-in-Canvas capture pipeline (`rasterAtlas.ts`, `htmlCanvasRenderer.ts`, `HtmlCanvasLayer.tsx`)

**Engage gate:** `RENDERER_MIN_NODES = 100`, in KIND-WEIGHTED DOM units
(`nodeDomWeight`), not a raw node count — a chart/mermaid/inlined-SVG/frame-grid
card is far more DOM than a scalar (~10 charts ≈ the threshold; a plain scalar graph
still needs ~100 nodes). Below the threshold the layer stays fully inert even with
render mode 'html' ON: the native DOM pans/zooms fine there and the capture/swap
cost (plus any momentary stale-clone flash) isn't worth it. Tunable live via
`window.__hcMinNodes`.

**WICG spec-drift the engine is built around** (verified 2026-07; Chromium origin
trial 148–150, Android DevTrial since 138; behind
`chrome://flags/#canvas-draw-element`):
- `ElementImage` is only `{width, height, close()}` — NOT an ImageBitmapSource, by
  spec, permanently. Neither `createImageBitmap(refImg)` nor a scratch-canvas bitmap
  path works on shipping builds; the mip pyramid must build via in-paint raster +
  region snapshot.
- The paint model: a snapshot of the canvas children is recorded just prior to the
  `paint` event, so a `drawElementImage` OUTSIDE the paint handler draws the
  PREVIOUS snapshot. Every frame that must call it routes through `requestPaint`,
  and the paint handler re-reads the freshest camera (the paint can land a frame
  after the rAF that scheduled it — the "canvas a frame behind the DOM" bug at its
  source).
- `drawElementImage` returns (and `getElementTransform` computes) the CSS matrix
  that places the element exactly where it was drawn — what reports the PRESENTED
  camera for domSync. Spec home for `getElementTransform` is the 2D context, but
  some builds hang it off the canvas — probe both.

**Reference capture resolution `REF = 1`** (CSS `zoom` on the clone): kept at 1 so
the clone lays out at true 1×. REF>1 supersamples for zoom-in crispness BUT rounds
text line-boxes differently than the live DOM — a measured ~0.9px text drift. At
REF=1 zooming past 100% softens (upscaled capture); accepted trade for faithful
text/alignment. The crisp escape hatch is `live` mode (`window.__hcLive`), which
re-rasterizes at the exact CTM per frame.

**One read-back per paint.** The shelf packer exists solely to collapse GPU
read-backs: snapshotting each node's raster with its own
`createImageBitmap(canvas, region)` is a canvas read-back PER NODE (~16 per paint),
the expensive pattern on mobile GPUs. Packing the batch into one atlas region lets
the whole paint be snapshotted with ONE canvas read-back; per-node textures then
come from bitmap→bitmap crops (`createImageBitmap(atlas, x, y, w, h)` — no canvas
read-back).

## DOM↔canvas transform sync (`domSync.ts`)

During a gesture the canvas draws the graph while DOM-only content (conduits, their
cables, the standoff svg) stays live DOM — two presentation pipelines that can skew
by a frame or more (the "conduit trails the pan" complaint): the canvas presents the
camera it PAINTED with, while the RF viewport composites the freshest CSS transform.
The fix: while gesturing, steer the viewport's transform to the camera the canvas
actually presented (`holderSyncTransform`), deriving that presented camera from the
WICG API itself when the build exposes it — `drawElementImage` returns (and
`getElementTransform` computes) the CSS matrix that places an element exactly where
the canvas drew it, browser rounding included (`camFromDrawMatrix`): for a capture
box drawn at world (anchorX, anchorY) at natural size (REF=1, dest == padded box)
the matrix is `translate(k·anchor + t) scale(k)`, so `k = a` and `t = (e,f) −
k·anchor`. The WICG surface is experimental — a build could hand back backing-store
px or an unexpected origin — so a native-derived camera is trusted only within
tolerance of our own bookkeeping (`plausibleNativeCam`, defaults 2% of scale / 4
CSS px); anything further is treated as a misparse and the bookkeeping wins. Pure
math, no DOM; covered by `domSync.test.ts`. On exit the layer hands the transform
back by re-serializing the live camera (`holderTransform`); React Flow's next
viewport commit overwrites it with its own equivalent.

**Clone position (`cloneFor`).** Do NOT set `position` on the clone — let each
root's own CSS class govern it, exactly like the original. `.solenoid-node` is
static (chrome climbs to the `rel` stand-in div); `.solenoid-note` is
`position: relative` (its resize handle anchors to the note card). Forcing a single
value breaks whichever root doesn't match it — a forced `static` shifted the note's
resize handle to the border box (a measured 1.75px shift), a forced `relative`
shifted node chrome inside the border; both proven 2026-06-28.
