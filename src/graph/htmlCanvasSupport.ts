// [[C42]] htmlInCanvasRenderer
export function supportsHtmlInCanvas(): boolean {
  try {
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d") as (CanvasRenderingContext2D & { drawElementImage?: unknown }) | null;
    return !!ctx && typeof ctx.drawElementImage === "function";
  } catch {
    return false;
  }
}
