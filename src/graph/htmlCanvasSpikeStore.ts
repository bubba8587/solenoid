// HTML-in-Canvas spike open/closed flag. A buried Edit-menu item flips it; the
// HtmlCanvasSpike overlay (rendered in App) reads it and, when on, covers the app
// with a 2D <canvas layoutsubtree> that draws the REAL node DOM via the native
// `ctx.drawElementImage()` API — auto-capturing all CSS fidelity (no hand-built
// reproduction), crisp at any zoom because the browser re-rasterizes each node's
// display list at the camera transform. Chrome-only, behind
// chrome://flags/#canvas-draw-element (Canary 149+). See docs/renderer-decision.md.
import { createToggleStore } from "./storeKit";

export const htmlCanvasSpikeStore = createToggleStore();
