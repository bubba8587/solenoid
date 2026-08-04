import { loadGraph } from "./persistence";
import type { SavedGraph } from "./persistence";

// Seeds are plain JSON in ./seedGraphs/ — the SAME shape serializeGraph produces,
// plus two menu-only fields (`label`, `order`) that loadGraph ignores.
type SeedFile = SavedGraph & { label?: string; order?: number };
const DEFAULT_ORDER = 1000;

// Vite inlines every matching JSON at build time.
const modules = import.meta.glob<SeedFile>("./seedGraphs/*.json", {
  eager: true,
  import: "default",
});

function idFromPath(path: string): string {
  return path.replace(/^.*\//, "").replace(/\.json$/, "");
}

// Fallback when the file declares no label.
function labelFromId(id: string): string {
  return id.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export type SeedId = string;

// Insertion order IS the menu order (the menu maps Object.entries).
export const SEEDS: Record<string, { label: string; graph: SavedGraph }> = {};
const ordered = Object.entries(modules)
  .map(([path, mod]) => ({ id: idFromPath(path), mod, order: mod.order ?? DEFAULT_ORDER }))
  .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
for (const { id, mod } of ordered) {
  SEEDS[id] = { label: mod.label ?? labelFromId(id), graph: mod };
}

// The seed loaded on a fresh start (no autosave).
export const DEFAULT_SEED_ID: SeedId =
  "getting-started" in SEEDS ? "getting-started" : Object.keys(SEEDS)[0] ?? "getting-started";

/** Replace the current graph with the named seed. Returns false if unknown. */
export async function clearAndLoadSeed(id: SeedId): Promise<boolean> {
  const seed = SEEDS[id];
  if (!seed) return false;
  await loadGraph(seed.graph);
  return true;
}
