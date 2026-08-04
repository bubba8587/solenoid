import { createToggleStore } from "./storeKit";

// A module store (not Canvas useState) so surfaces outside Canvas's React tree can drive
// it, and Canvas's keydown handler reads it directly with no stale closure.
export const paletteStore = createToggleStore();
