// Feature-detect the WICG HTML-in-Canvas API — `ctx.drawElementImage`, the primitive
// the canvas renderer is built on (hand the browser the real node DOM, draw it into a
// <canvas>, crisp at any zoom). Chrome-only today, behind
// chrome://flags/#canvas-draw-element (Canary 149+); stable ~late 2026.
//
// Shared by the render-mode harness (gate whether "html" mode is selectable / restorable)
// and the HTML-in-Canvas spike. Synchronous + cheap; safe to call at startup.
export function supportsHtmlInCanvas(): boolean {
  try {
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d") as (CanvasRenderingContext2D & { drawElementImage?: unknown }) | null;
    return !!ctx && typeof ctx.drawElementImage === "function";
  } catch {
    return false;
  }
}
