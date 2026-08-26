// Feature-detect the WICG HTML-in-Canvas API (`ctx.drawElementImage`) — Chromium
// only, behind a flag; synchronous and cheap, so it is safe at startup.
export function supportsHtmlInCanvas(): boolean {
  try {
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d") as (CanvasRenderingContext2D & { drawElementImage?: unknown }) | null;
    return !!ctx && typeof ctx.drawElementImage === "function";
  } catch {
    return false;
  }
}
