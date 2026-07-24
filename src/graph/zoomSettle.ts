// Zoom-gesture settle window — how long after the last zoom event a renderer holds its
// gesture state before restoring the live DOM at the new scale.
//
// Why it's shared: a scale change REPAINTS the visible DOM at the new raster scale
// (measured p95 117ms / worst 283ms per notch on Personal Finance — dev-notes
// 2026-07-20d), while a translate only re-composites (p95 17ms). Wheel zoom is notchy
// and has no held-pointer signal the way a pan has `pointerDown`, so a short timer
// exits + re-enters the gesture PER NOTCH and pays that repaint over and over mid-zoom.
// Both renderers hit the identical thrash and must hold for the SAME window — hence one
// constant here rather than two copies that drift apart.
//
// EXPERIMENT (2026-07-24): raised 420 -> 3000 to test the author's report that MID and
// CLOSE zoom chop while far-out zoom stays smooth — which rules out element count (at
// far zoom EVERY card is on screen and painted, since `semanticZoom` defaults off, and
// that's the smooth case). The settle fits the symptom instead: a nudge-look-nudge
// rhythm at working zoom has gaps far longer than 420ms, so every nudge pays a full
// settle repaint — and pays it exactly where that repaint is most expensive, since at
// high scale text falls off the glyph-atlas fast path into outline rasterization and
// borders/radii are antialiased over a much larger area. A long hold collapses a whole
// zoom session into ONE repaint at the end.
//
// A/B it live in a deployed preview, no redeploy needed:
//   window.__zoomSettle = 420    // restore the old behaviour, then zoom
//   window.__zoomSettle = 3000   // back to the experiment
//   window.__solenoidPerf = true // pair with the fpsProbe for frame numbers
// Read at timer-set time, so an override takes effect on the very next gesture.
export const DEFAULT_ZOOM_SETTLE_MS = 3000;

/** The settle window to use for a gesture that changed the camera scale. */
export function zoomSettleMs(): number {
  const v = (globalThis as { __zoomSettle?: unknown }).__zoomSettle;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : DEFAULT_ZOOM_SETTLE_MS;
}
