// [[C42]] htmlInCanvasRenderer
/** The shipped API: the canvas's `content` attribute (155 renamed `layoutsubtree`) and the 2D context's `drawElementImage`. */
export function supportsHtmlInCanvas(): boolean {
  try {
    if (!("content" in HTMLCanvasElement.prototype)) return false;
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d") as (CanvasRenderingContext2D & { drawElementImage?: unknown }) | null;
    return !!ctx && typeof ctx.drawElementImage === "function";
  } catch {
    return false;
  }
}
