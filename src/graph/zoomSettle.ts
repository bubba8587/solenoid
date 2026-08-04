export const DEFAULT_ZOOM_SETTLE_MS = 420;

/** The settle window to use for a gesture that changed the camera scale. */
export function zoomSettleMs(): number {
  const v = (globalThis as { __zoomSettle?: unknown }).__zoomSettle;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : DEFAULT_ZOOM_SETTLE_MS;
}
