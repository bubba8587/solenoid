import { createToggleStore } from "./storeKit";

// Open/close state for the command palette — a module store (not Canvas useState) so
// surfaces outside Canvas's React tree can drive it. Canvas's keydown handler reads it
// directly, so there is no stale closure.
export const paletteStore = createToggleStore();
