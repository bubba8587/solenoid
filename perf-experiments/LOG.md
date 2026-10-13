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
