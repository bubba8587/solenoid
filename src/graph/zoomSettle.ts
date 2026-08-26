export const DEFAULT_ZOOM_SETTLE_MS = 420;

export function zoomSettleMs(): number {
  const v = (globalThis as { __zoomSettle?: unknown }).__zoomSettle;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : DEFAULT_ZOOM_SETTLE_MS;
}
