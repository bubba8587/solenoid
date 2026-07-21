// Renderer spike (Pixi) open/closed flag. A buried Edit-menu item flips it; the
// RendererSpike overlay (rendered in App) reads it and, when on, covers the whole
// app with a standalone PixiJS scene — a throwaway proof that nodes-on-GPU holds
// fps at high node/cable counts during pan/zoom/drag. Nothing of the real graph is
// touched; the overlay just sits on top (z-index) and disables interaction beneath.
// See docs/archive/renderer-decision.md.
import { createToggleStore } from "./storeKit";

export const rendererSpikeStore = createToggleStore();
