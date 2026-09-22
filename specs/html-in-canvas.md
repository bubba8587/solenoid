<!-- [[C42]] htmlInCanvasRenderer, [[C75]] gpuTextureBudget -->

# Spec: HTML-in-Canvas gesture layer

Serves [[C42]] htmlInCanvasRenderer; its GPU limits are [[C75]] gpuTextureBudget. It covers what the layer does, when it runs, and the number behind each knob. The knobs are tuning, not decisions: change one freely, and record the measurement that justified the change here.

The layer makes pan and zoom cheap on a big graph. During a gesture it hides React Flow's viewport and draws captured bitmaps of the cards on a canvas instead; at rest the real DOM is back. It is never a DOM replacement: every click, edit and hover lands on the real cards.

## When it runs

- **The setting.** Render mode `html` (`renderMode.ts`; the default is `dom`, and only `html` persists) is offered only where `supportsHtmlInCanvas()` finds the WICG API, which today means Chromium behind `chrome://flags/#canvas-draw-element`.
- **The size gate.** Even with the setting on, the layer stays inert until the graph weighs at least `RENDERER_MIN_NODES = 100` DOM units. The unit is kind-weighted (`nodeDomWeight`, `nodes/kind.ts`): a full figure (Chart, Mermaid, Record…) weighs 10, a heatmap or tornado 6, a sparkline or gauge 3, a plain scalar card 1. So about ten charts engage it, while a scalar-only graph needs about a hundred cards. Below the gate the native DOM pans fine and the capture cost isn't worth paying. The weight is recounted on bind and on every node add or remove, even while inert, so crossing the line is noticed. `window.__hcMinNodes` overrides it live.
- **Both canvases.** `FlowSurface` mounts `HtmlCanvasLayer` for the main canvas and for a composite drill-in alike.

## The lifecycle

1. **Build.** On engaging, the layer starts in the gesture state (holder hidden, canvas active), so the DOM and the canvas never show as a double image, and it retries the capture every 120 ms until it succeeds. It then drops to idle.
2. **Gesture.** Any camera change, or a held pointer while gesturing, enters the gesture: the React Flow viewport ("the holder") gets `visibility: hidden`, never `display: none`, so its layout stays measurable and an in-flight drag survives. DOM-only elements stay visible through it (below). Cable flow animation freezes to match the static canvas. On fine pointers the holder gets a gesture-scoped `will-change: transform` layer; on coarse pointers it never does ([[C75]] gpuTextureBudget).
3. **Settle.** A gesture ends on a timer that each camera change re-arms: 140 ms after a pan, and `DEFAULT_ZOOM_SETTLE_MS = 420` after any gesture that zoomed (`zoomSettle.ts`; `window.__zoomSettle` overrides live). A scale change repaints the whole visible DOM at the new raster scale, while a pan only recomposites, and wheel zoom is notchy with no held-pointer signal. A short zoom settle would leave and re-enter the gesture on every notch and pay that repaint each time. A longer settle doesn't cure choppy zoom: a deployed 3000 ms A/B ruled it out.
4. **Held.** If the gesture ends below `HOLD_ZOOM = 0.4`, the canvas keeps drawing at rest. The DOM comes back muted (by opacity, so it still hit-tests) and the selected or focused cards show as live DOM on top. At that zoom DOM text is unreadable anyway, every card is in view so the settle repaint would be at its most expensive, and holding removes the pop at gesture end. `window.__hcHoldZoom` overrides it.
5. **Idle.** Above the hold zoom the holder is fully restored and the canvas draws nothing.

A lasso never enters the gesture: it moves no camera, so the swap would only show a stale snapshot.

## Capture

- **Clone, then capture.** Each card's live element is cloned into the canvas (`layoutSubtree`) and captured with the WICG API. The capture box is padded by 10 px because sockets straddle the card edge.
- **The clone never sets `position`.** Each root's own CSS class governs it, exactly like the original: `.solenoid-node` is static with its chrome anchored to a relative stand-in div, and `.solenoid-note` is relative so its resize handle anchors to the card. Forcing one value breaks the other root: a forced `static` shifted the note's handle by a measured 1.75 px, and a forced `relative` shifted node chrome.
- **Capture at 1×.** `REF = 1`: the clone lays out at true size (CSS `zoom`). A higher REF would supersample for crisp zoom-in, but it rounds text line boxes differently from the live DOM, a measured 0.9 px drift. The accepted trade is a softer image past 100% zoom. `live` mode (`window.__hcLive`) re-rasterizes at the exact transform every frame for anyone who needs it crisp.
- **The mip pyramid.** Each card gets a pyramid of bitmaps halving from REF down to about 6 px. A frame draws the level `computeIdealMipLevel(scale, quality, dpr)` picks, `floor(log2(REF / (quality × scale × dpr)))`, where quality 1 is roughly one texture pixel per screen pixel.
- **Built in the paint event.** The shipped API's `ElementImage` is only `{width, height, close()}` and is not an `ImageBitmapSource`, by spec and permanently. So neither `createImageBitmap(refImg)` nor a scratch-canvas path works, and the pyramid is rastered into the main canvas inside the `paint` event and snapshotted from there.
- **One read-back per paint.** Every card captured in a paint packs into one atlas (`rasterAtlas.ts`, a shelf packer). The paint takes one canvas read-back, and each card's bitmap is cropped from the atlas bitmap (`createImageBitmap(atlas, x, y, w, h)`), which needs no further read-back. A read-back per card (about 16 per paint) is the expensive pattern on mobile GPUs.
- **The slow path.** A card whose pyramid can't be built is drawn with `drawElementImage` on every frame instead. It stays correct, just slower, and `getStats()` counts both slow draws and permanent failures.

## Drawing and the camera

- **Only inside `paint`.** A snapshot of the canvas children is recorded just before the `paint` event, so `drawElementImage` called outside the handler draws the previous snapshot. That is the "canvas a frame behind the DOM" bug at its source. Every frame that draws routes through `requestPaint`, and the paint handler re-reads the freshest camera, because the paint can land a frame after the animation frame that asked for it.
- **Probe both homes.** `getElementTransform` belongs on the 2D context by spec, but some builds hang it off the canvas, so the renderer looks in both places.
- **The DOM follows the presented camera.** Mid-gesture the canvas draws the cards while DOM-only content (conduits, their cables, the standoff layer) stays live DOM, and the two pipelines can skew by a frame or more ("the conduit trails the pan"). So the holder's transform is steered to the camera the canvas actually presented (`holderSyncTransform`, `domSync.ts`). That camera comes from the matrix `drawElementImage` returns: for a box drawn at world anchor `a` at natural size the matrix is `translate(k·a + t) scale(k)`, so `k` is its `a` entry and `t = (e, f) − k·a` (`camFromDrawMatrix`). The API is experimental, so a derived camera is trusted only within 2% of scale and 4 CSS px of the layer's own bookkeeping (`plausibleNativeCam`); anything further is treated as a misparse and the bookkeeping wins. When the gesture ends the layer hands the transform back by re-serializing the live camera (`holderTransform`), so React Flow's next write is a no-op.

## Keeping the capture fresh

Every change to how a card looks must reach a re-capture, by one of two channels: `view.rerenderNode(id)` through the flow view's `render` pipe, or a store the layer subscribes to. The subscribed stores are connection topology, collapse, manual size, group membership, theme and palette, format annotations, and cable shape. A new store that changes how a card paints joins this list. Socket hover highlights, format mismatches and pack toggles are deliberately left out: one churns on every hover, and the others are rare and too small to see. A re-capture touches only the changed cards (`updateNodes`), and selection changes re-capture only the cards whose ring toggled, so a lasso sweep stays cheap.

## DOM-only elements

Conduits and the cables touching them are never captured. They stay live DOM through a gesture, shown through the hidden holder with inline `visibility: visible`, and the canvas skips them. On coarse pointers, where the holder gets no compositor layer, each DOM-only element is promoted on its own instead, capped at 1024 px (`PROMOTE_MAX`, [[C75]] gpuTextureBudget).

## Debugging

`window.__hcProbe()` logs which WICG paths the build supports. The debug overlay draws the canvas at half opacity over the live DOM, to compare capture and position by eye.
