// When true, Canvas's pointerdown listener swallows every native pointerdown in the
// canvas area — no node drag, area pan, or cable/socket interaction.
import { createToggleStore } from "./storeKit";

export const canvasLockStore = createToggleStore();
