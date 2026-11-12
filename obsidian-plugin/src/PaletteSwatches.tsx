// [[obsidian-plugin#An Obsidian plugin shows Solenoid's values with the app's own chips]]
import { useSyncExternalStore } from "react";
import { SwatchGrid } from "../../src/graph/components/SwatchGrid";
import { paletteStore } from "../../src/graph/palette";
import { themeVersion } from "./shadow";

export function PaletteSwatches({ accent, onPick }: { accent: () => string; onPick: (slot: string) => void }) {
  useSyncExternalStore(paletteStore.subscribe, paletteStore.version);
  useSyncExternalStore(themeVersion.subscribe, themeVersion.get);
  return <SwatchGrid value={accent()} onPick={onPick} />;
}
