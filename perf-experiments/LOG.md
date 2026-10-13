# Perf experiment log (no commits)

Snapshot: personal-finance at zoom 0.1, static page (no React), 60 frames of 1px viewport slides. Paint/layerize/raster = trace ms per 60 frames.

## E1 — do cards re-record on a pure pan?
- as-is paint ~500-580, no cards ~30, "poke" (repaint without camera move) ~33.
- Mock cards (text, nested divs, relative children) under the same transform: paint 6-9. Chrome caches fine; our cards defeat it.

## Finding 1 — `.solenoid-node--grouped::before` clip-path corner tag (CONFIRMED static, n=7)
- desktop: as-is 506 [468-562] → mask 180 [174-232] / border-triangle 214 [170-242] / removed 201 [175-230]; layerize unchanged.
- phone-size viewport @2.625: 106 [98-119] → 70-76.
- Visual (mask): 8x crop identical, diffs only on the diagonal AA (≤24 levels).
- Open: live-app phone single run showed layerize ×2 with mask → verifying n=5 (live-ab).

## Candidate 2 — scalar value box clip (`.solenoid-node__display-value` overflow hidden), n=5
- fix1 193 → value box overflow visible 106. Not: ellipsis, copy icon, position, rounding, stacking.
- Can't just drop: the clip truncates long values with "…". Needs a clip only where text overflows.

## Ruled out (n=2-3)
- shadows, filters, opacity, transforms, transitions, z-index, text, svg clip-path attrs on sockets, masks (on icons), hidden group members (paint), scroll containers.

## Mechanism (SOURCE-VERIFIED, chromium main, third_party/blink/renderer/core/paint + platform/graphics/paint)
1. paint_layer_painter.cc Paint(): `if (!contents_cull_rect.Contains(contents_visual_rect)) result = kMayBeClippedByCullRect;` (also for cull_rect vs visual_rect).
2. cull_rect.cc ApplyPaintPropertiesWithoutExpansion: cull rect is intersected with LocalToAncestorClipRect -> a layer's own overflow clip / clip-path shrinks its (contents) cull rect, so clipped-overflowing content can never be "contained".
3. paint_layer_painter.cc PaintChildren(): a child's kMayBeClippedByCullRect makes the parent's result kMayBeClippedByCullRect -> one flagged descendant flags the whole card.
4. cull_rect_updater.cc ShouldUseInfiniteCullRect(): non-composited transforms whose layer is kFullyPainted skip cull rect updates (infinite); flagged ones don't.
5. cull_rect_updater.cc SetLayerNeedsRepaintOnCullRectChange(): cull rect change + kMayBeClippedByCullRect -> SetNeedsRepaint -> card re-recorded.
6. Also: HasActiveTransformAnimation -> infinite cull rect (explains the earlier "hold animation" result).
=> Prediction: a card stops re-recording on pan/zoom only when EVERY flagging descendant is fixed.

## Live phone, n=5 (paint+layerize+script per run)
- Finding 1 alone (corner tag mask/triangle/removed): no paint gain; layerize ~x2 (1.9s -> 3.5s). Control (no-op injected CSS) = baseline. REJECTED alone.
- Candidate 2 alone (value box inner clip, local code): no gain. Consistent with prediction (cards still flagged by others).
- Census (rule from mechanism): 64/65 cards flagged by >=1: corner tag ::before (41), frame-head svg overflow hidden (28), transformed svgs (28).
- ALL flaggers neutralized together (corner tag, frame-head svg overflow, every card svg overflow; + value box inner clip), live phone n=5 @0.2:
  paint 1880 [1856-1963] vs baseline 1825 [1639-1957] -> NO CHANGE. layerize 3615 vs 1921 (x2 again, as with any removal of the ::before).
  => Prediction FAILED in the live phone app. The source mechanism is real (static pages obey it) but is not what drives live phone paint.
     Hypotheses: (a) at 0.2 on a 412px screen most cards are partly off-screen, so they are legitimately kMayBeClippedByCullRect
     (cull_rect does not contain visual_rect) whatever their contents; (b) live paint comes from genuine invalidations. NEXT: trace invalidations during a live touch pan.
  Open (unexplained, reproducible): removing the corner-tag ::before doubles layerize in the live phone app.

## Live phone: what actually costs (dev, 4x CPU, personal-finance @0.1-0.2, pane pans, 160 frames)
- Invalidation tracking: the ONLY invalidation per frame is the viewport's inline transform. Live paint = cull-rect re-recording (no app-side invalidations).
- Production build (vite build + preview, ?seed=personal-finance) @0.1: script 5572, paint 4177, layerize 2293, raster 1560 -> JS is the largest cost on phone pans, prod too.
  (A prod run "@0.2" via hidden zoom buttons is INVALID: the click left scale at 0.1 and the canvas painted nothing - likely covered by an overlay.)
- JS profile: ~all script is touchmoved (d3) -> React Flow store.setState(transform) -> zustand listeners.forEach -> every useStore subscriber's selector:
  checkIfSnapshotChanged / with-selector overhead per subscriber, EdgeWrapper getEdgePosition (all 172 cables), NodeWrapper, Handle connectingSelector, StandoffLayer.

## Finding 3 — React Flow <Handle> subscribes every socket to the store (SOURCE-VERIFIED, MEASURED)
- Source (@xyflow/react 12.12.0 dist): zustand setState -> `listeners.forEach(listener)`; HandleComponent: `useStore(connectingSelector(nodeId, handleId, type), shallow)` per handle (466 sockets here); useHandleConfig is a shared context (no per-handle sub).
  The connecting classes it maintains (connectingfrom/to, valid, connectionindicator) only switch pointer-events in RF's CSS; app CSS never uses them; @xyflow/system checks only static classes (source/target/connectable/connectableend).
- Experiment: FlowSocketHandle renders RF's handle markup itself (same classes/data attrs, static idle classes) and starts connections with XYHandle.onPointerDown exactly as RF does; no store subscription.
- Correctness: scripts/socket-drag-probe.mjs passes identically (hit, crosshair, cable drag starts not node drag, input->output drop lands); only diff: origin socket lacks `connectingfrom` (unused).
- Synthetic store transform update, phone emulation 4x, n=15 alternating rounds: lean 7.32 ms median [3.04-10.02] vs RF Handle 10.98 [5.52-13.71] => ~-33% per-frame store work.
- Live net A/B (paint+layerize+script) n=5: RUNNING.
- Live net A/B n=5 (phone 4x): zoom 0.2 net 9991 [8891-10534] -> 8494 [7908-9387] (-15%, script 6047 -> 4575); zoom 0.5 9248 -> 8567 (-7%). Paint/layerize unchanged, as predicted. CONFIRMED.
- Direct listener count (Set.forEach wrap during one store update): RF Handle 1374 listeners vs lean 908 -> difference exactly 466 = socket count.

## Remaining per-frame store subscribers (lean sockets)
- Phone 752 = cables 516 (EdgeWrapper x3 per edge: edgeLookup.get, defaultEdgeOptions, getEdgePosition selector) + cards 154 (NodeWrapper) + resize grips 41 + ~41 other.
- Desktop 908 = phone + 154 minimap nodes (minimap mounted on desktop only).
- Upper bound for cables (throwaway hack: ReactFlow edges={[]}):
  synthetic store update, phone 4x, n=5: ~9-10 ms -> 1.3 ms;
  live phone net n=5 @0.2: script 4795 [4283-5171] -> 2765 [2687-3466] (-42%). (paint also drops but only because cables aren't drawn.)
  => Candidate 4 (architecture, author's call): draw cables in one app layer that subscribes once and recomputes endpoints only on node/edge changes, not on transform.
