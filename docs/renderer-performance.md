# Renderer performance — the settled policies

The domain spec for how the canvas renderers (the DOM default and the HTML-in-Canvas
layer) stay fast: gesture handling, GPU layer promotion, semantic zoom, and the HIC
capture pipeline. Settled policy lives HERE; the open investigation (the choppy zoom
BAND, its instrumentation and test queue) stays in `dev-notes.md` — read that entry
before tuning anything in this file's domain.

## Zoom settle window (`zoomSettle.ts`)

`DEFAULT_ZOOM_SETTLE_MS = 420` — how long after the last zoom event a renderer holds
its gesture state before restoring the live DOM at the new scale. Shared constant:
a scale change REPAINTS the visible DOM at the new raster scale while a translate
only re-composites, and wheel zoom is notchy with no held-pointer signal — a short
timer would exit + re-enter the gesture PER NOTCH and pay that repaint repeatedly
mid-zoom. Both renderers hit the identical thrash and must hold the SAME window.
`window.__zoomSettle = <ms>` overrides live (read at timer-set time). A LONGER
settle is NOT the lever for the choppy-zoom band — ruled out by a deployed 3000ms
A/B; see dev-notes "choppy zoom BAND".

## GPU layer promotion (`Canvas.tsx`) — pan never, desktop pinch only

The holder is deliberately NOT promoted to a GPU layer for PAN: promoting made
collapsed pan smooth, but the holder surface is larger than the mobile GPU max
texture, so the layer tiles and re-rasterizes as a translate reveals new tiles —
flickering the visible heavy content (recharts/cards) with a group expanded. Pan
relies on culling instead (few elements painted → cheap un-layered repaint). ZOOM is
the exception, on DESKTOP only: a transient `will-change: transform` layer for the
duration of the pinch (a bounded scale stays within already-rastered tiles; the
scale runs as a cheap GPU scale of the cached bitmap — smooth, slightly soft — then
drops on settle to re-rasterize crisp). NOT on touch devices — the gate is
IS_COARSE, not IS_MOBILE (a tablet runs the desktop UI on the same mobile-class
GPU): the promoted layer wants holder-bounds × zoom × dpr texture memory, which
tiles/flickers mid-pinch and on tablets fails raster-tile allocation outright
(Chrome's green placeholder squares). Touch zoom stays un-layered: a touch
choppier, but stable.

**Negative result — do NOT also drop raster quality on the desktop zoom path.**
Desktop pinch/wheel zoom is PROMOTED, so content is rasterized once and GPU-scaled,
not re-rastered per frame: the quality drops save nothing, and toggling them forces
extra re-rasters plus a box-shadow transition that made desktop zoom measurably
WORSE. The gesture-time quality-drop system was then removed entirely
(2026-07-04): the `--panning` class is no longer applied and DOM mode stays
full-quality while panning — `Canvas.tsx`'s pan tracking is telemetry only.

## Semantic zoom gate (`semanticZoomStore.ts`) — raw CSS scale, not the mip level

The gate is the RAW CSS scale (threshold 0.3), never
`computeIdealMipLevel(scale·dpr)`. The mip gate is a measured negative result:
`mip >= 4` only fired below ~6% zoom on a dpr-1 display (~3% on dpr-2) — so far out
the body is already sub-pixel and hiding it does nothing visible — and folding in
dpr made it trigger at a DIFFERENT apparent zoom per display. Apparent size is what
legibility depends on; dpr is a texture-resolution concern that belongs to the mip
renderer. 0.3 ≈ a card drawn at ~30% (a ~200px card → ~60px): body text unreadable,
card still a clear block — conservative (far-overview only) but actually reachable
and visible.

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
cables, the standoff svg) stays live DOM inside rete's holder — two presentation
pipelines that can skew by a frame or more (the "conduit trails the pan" complaint):
the canvas presents the camera it PAINTED with, while the holder composites rete's
freshest CSS transform. The fix: while gesturing, steer the holder's transform to
the camera the canvas actually presented (`holderSyncTransform`), deriving that
presented camera from the WICG API itself when the build exposes it —
`drawElementImage` returns (and `getElementTransform` computes) the CSS matrix that
places an element exactly where the canvas drew it, browser rounding included
(`camFromDrawMatrix`): for a capture box drawn at world (anchorX, anchorY) at
natural size (REF=1, dest == padded box) the matrix is `translate(k·anchor + t)
scale(k)`, so `k = a` and `t = (e,f) − k·anchor`. The WICG surface is experimental —
a build could hand back backing-store px or an unexpected origin — so a
native-derived camera is trusted only within tolerance of our own bookkeeping
(`plausibleNativeCam`, defaults 2% of scale / 4 CSS px); anything further is treated
as a misparse and the bookkeeping wins. Pure math, no DOM; covered by
`domSync.test.ts`.

**Clone position (`cloneFor`).** Do NOT set `position` on the clone — let each
root's own CSS class govern it, exactly like the original. `.solenoid-node` is
static (chrome climbs to the `rel` rete-div stand-in); `.solenoid-note` is
`position: relative` (its resize handle anchors to the note card). Forcing a single
value breaks whichever root doesn't match it — a forced `static` shifted the note's
resize handle to the border box (a measured 1.75px shift), a forced `relative`
shifted node chrome inside the border; both proven 2026-06-28.
