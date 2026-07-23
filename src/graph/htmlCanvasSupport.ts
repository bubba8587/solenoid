// Feature-detect the WICG HTML-in-Canvas API — `ctx.drawElementImage`, the primitive
// the canvas renderer is built on (hand the browser the real node DOM, draw it into a
// <canvas>, crisp at any zoom). Chromium-only: behind chrome://flags/#canvas-draw-element,
// origin trial Chrome 148–150 (Android DevTrial since 138); not yet in stable. The
// renamed surface (drawElementImage/texElementImage2D, old names dead past M145) is the
// one we detect; `ElementImage` is a minimal {width, height, close()} interface — by
// spec NOT an ImageBitmapSource (see htmlCanvasRenderer's paint-raster pyramid path).
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
