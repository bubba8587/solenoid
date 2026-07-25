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
// NEGATIVE RESULT — do NOT retry a long settle for the choppy-zoom BAND (2026-07-24).
// Held this at 3000ms on a deployed preview to test whether the chop was the gesture
// exiting per notch and paying the scale-change repaint over and over. It is not: the
// author reports the choppy band survives the long hold unchanged. The 420ms value from
// 2026-07-20d stays because it fixes its OWN symptom (per-notch promote↔demote thrash),
// but it is not the lever for the band. See the "choppy zoom BAND" open problem in
// dev-notes for what is actually ruled out and what to test next.
//
// The override below is kept — it is the cheap way to re-A/B the settle from a deployed
// preview during that investigation, with no redeploy:
//   window.__zoomSettle = 3000   // long hold
//   window.__zoomSettle = 420    // back to the default
//   window.__solenoidPerf = true // pair with the fpsProbe for frame numbers + the k band
// Read at timer-set time, so an override takes effect on the very next gesture.
export const DEFAULT_ZOOM_SETTLE_MS = 420;

/** The settle window to use for a gesture that changed the camera scale. */
export function zoomSettleMs(): number {
  const v = (globalThis as { __zoomSettle?: unknown }).__zoomSettle;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : DEFAULT_ZOOM_SETTLE_MS;
}
