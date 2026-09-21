// [[C107]] obsidianPlugin
import { useSyncExternalStore } from "react";
import { SwatchGrid } from "../../src/graph/components/SwatchGrid";
import { paletteStore } from "../../src/graph/palette";

/** The app's Settings palette legend: the read-only swatch grid, following the active palette. */
export function PaletteSwatches() {
  useSyncExternalStore(paletteStore.subscribe, paletteStore.version);
  return <SwatchGrid readOnly />;
}
