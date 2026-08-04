// Feature-detect the WICG HTML-in-Canvas API (`ctx.drawElementImage`) that the
// html-canvas render mode is built on. Chromium-only, behind a flag / origin trial.
// Synchronous + cheap; safe to call at startup.
export function supportsHtmlInCanvas(): boolean {
  try {
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d") as (CanvasRenderingContext2D & { drawElementImage?: unknown }) | null;
    return !!ctx && typeof ctx.drawElementImage === "function";
  } catch {
    return false;
  }
}
