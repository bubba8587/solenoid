// Which seed the live document came from ("custom" once edited), plus the load slot
// the surface registers.
import { isGraphRebuilding } from "./process";
import type { SeedId } from "./seeds";

// "custom" = the live graph no longer matches any seed (edited, restored, or imported).
export type SeedSelection = SeedId | "custom";

let _loadSeed: (id: SeedId) => Promise<void> = async () => {};
let _currentSeedId: SeedSelection = "getting-started";
const _seedListeners = new Set<() => void>();

export function setLoadSeed(fn: (id: SeedId) => Promise<void>) {
  _loadSeed = fn;
}

export async function loadSeed(id: SeedId) {
  await _loadSeed(id);
  setSeedSelection(id);
}

export function setSeedSelection(sel: SeedSelection) {
  if (_currentSeedId === sel) return;
  _currentSeedId = sel;
  for (const l of _seedListeners) l();
}

export function getCurrentSeedId(): SeedSelection {
  return _currentSeedId;
}

// No-op while a graph is loading: loadGraph wraps the whole rebuild in
// begin/endGraphRebuild, so seed and autosave loads don't self-mark custom.
export function markGraphCustom() {
  if (isGraphRebuilding()) return;
  setSeedSelection("custom");
}

export const seedStore = {
  get: (): SeedSelection => _currentSeedId,
  subscribe: (l: () => void) => {
    _seedListeners.add(l);
    return () => { _seedListeners.delete(l); };
  },
};

