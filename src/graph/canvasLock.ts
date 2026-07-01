// Module-level lock state: when true, the canvas-level pointerdown
// listener in Canvas swallows native pointerdowns inside the canvas
// area, preventing node drag, area pan, and any cable/socket
// interaction. The nav menu's lock button toggles it.
import { createToggleStore } from "./storeKit";

export const canvasLockStore = createToggleStore();
