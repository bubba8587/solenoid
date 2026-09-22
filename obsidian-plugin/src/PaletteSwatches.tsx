// [[C107]] obsidianPlugin
import { useSyncExternalStore } from "react";
import { SwatchGrid } from "../../src/graph/components/SwatchGrid";
import { paletteStore } from "../../src/graph/palette";
import { themeVersion } from "./shadow";

/** The app's accent picker (the toolbar's swatch grid), following the active palette and the
 *  plugin's accent; the gray swatch cycles the neutrals as it does there. */
export function PaletteSwatches({ accent, onPick }: { accent: () => string; onPick: (slot: string) => void }) {
  useSyncExternalStore(paletteStore.subscribe, paletteStore.version);
  useSyncExternalStore(themeVersion.subscribe, themeVersion.get);
  return <SwatchGrid value={accent()} onPick={onPick} />;
}
