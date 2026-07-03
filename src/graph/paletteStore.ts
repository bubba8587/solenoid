import { createToggleStore } from "./storeKit";

// Open/close state for the command palette (CommandPalette.tsx) — a module
// store (not Canvas useState) so surfaces outside Canvas's React tree can
// drive it: the mobile bottom bar's palette button, and any future MenuBar
// entry. Canvas renders the palette off this store and its keydown handler
// reads it directly (always fresh — no stale-closure issue).
export const paletteStore = createToggleStore();
