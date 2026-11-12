// [[A1]] visualGraphCalculator, [[html-in-canvas#Big graphs can optionally pan and zoom on pictures of their nodes]]
// Mechanics: [[html-in-canvas#Keeping the capture fresh]].

/** Fired, bubbling, by a figure's `<canvas>` after it draws: new pixels change no DOM, so nothing else tells the
 *  HTML-in-Canvas layer that the card's capture is stale. */
export const CANVAS_DRAWN = "sol-canvas-drawn";

export function canvasDrawn(canvas: HTMLCanvasElement): void {
  canvas.dispatchEvent(new Event(CANVAS_DRAWN, { bubbles: true }));
}
